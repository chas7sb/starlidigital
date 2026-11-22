import {assertFacebookCustomerPilotEffectsAllowed} from './pilot-effect-stop.js';
import {resolveBucharestTime, type BucharestLocalInput} from '../facebook-customer/scheduler.js';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { Store } from '../store.js';
import {
  assertActiveCustomerImageGenerationApproval,
  authenticateFacebookCustomerToolCall,
  CustomerMcpAuthError,
  type CustomerFacebookMcpAuth,
} from '../customer-mcp/customer-auth.js';
import type {
  CustomerFacebookImageReceipt,
  CustomerFacebookImageUpload,
  FacebookCustomerMediaService,
} from '../facebook-customer-media/service.js';
import {
  createLcg6OpenAIImagesAdapter,
  Lcg6GenerationError,
  LCG6_OPENAI_IMAGE_KEY_REF,
  LCG6_OPENAI_MODEL,
  LCG6_OPENAI_RESERVE_CEILING_USD,
  type Lcg6GenerationReservation,
} from '../facebook-customer-media/lcg6-openai-images-adapter.js';
import type {
  FacebookCustomer,
  FacebookManagedPage,
  FacebookOAuthConnection,
} from '../facebook-pages/customer-page-selection.js';
import type {
  FacebookCurrentPageTokenRequest,
  FacebookCurrentSelectedPageProvider,
  FacebookResolvedPageBinding,
  FacebookTrustedPageTokenResolver,
} from '../facebook-pages/oauth.js';
import {
  translateFacebookPilotAdapterReceipt,
  type FacebookPublishProviderResult,
} from '../facebook-customer/post-now.js';
import type { FacebookMcpJob } from '../../../control-plane/src/customer-facebook-mcp-contract.js';

export const DIRECT_PAGE_CREDENTIAL_COLLECTION = 'facebook-customer-direct-page-credentials' as const;
const MAX_GENERATION_APPROVAL_TTL_MS = 15 * 60_000;
export const GENERATION_APPROVAL_COLLECTION = 'facebook-customer-image-generation-approvals' as const;
export const GENERATION_JOB_COLLECTION = 'facebook-customer-image-generation-jobs' as const;
export const GENERATION_BUDGET_COLLECTION = 'facebook-customer-image-generation-budgets' as const;
export const GENERATED_PROVENANCE_COLLECTION = 'facebook-customer-generated-image-provenance' as const;
export const GENERATED_PUBLISH_APPROVAL_COLLECTION = 'facebook-customer-generated-publish-approvals' as const;
export const VERIFIED_PERMALINK_COLLECTION = 'facebook-customer-verified-post-permalinks' as const;

const REQUIRED_DIRECT_PAGE_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
] as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const NUMERIC_PAGE_ID = /^\d{5,32}$/;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_RASTER_DECOMPRESSED_BYTES = 16 * 1024 * 1024;

function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function normalizeCredentialKey(rawKey: string | Buffer): Buffer {
  const buf = typeof rawKey === 'string'
    ? (Buffer.from(rawKey, 'base64').length === 32
        ? Buffer.from(rawKey, 'base64')
        : createHash('sha256').update(rawKey).digest())
    : rawKey;
  if (buf.length !== 32) {
    throw new Error('DIRECT_PAGE_CREDENTIAL_KEY_INVALID');
  }
  return Buffer.from(buf);
}

function assertLiveOrdinaryCustomer(store: Store, tenantId: string, userId: string): void {
  if (!tenantId || !userId || tenantId !== userId) {
    throw new Error('CUSTOMER_TENANT_USER_MISMATCH');
  }
  const user = store.user(userId);
  if (!user || user.disabled || user.role !== 'USER') {
    throw new Error('CUSTOMER_USER_INACTIVE');
  }
}

export interface StoredDirectPageCredentialRecord {
  id: string;
  tenantId: string;
  userId: string;
  platform: 'FACEBOOK';
  mode: 'DIRECT_PAGE_TOKEN';
  pilotLabel?: string;
  pageId: string;
  pageName: string;
  tasks: string[];
  scopes: string[];
  status: 'CONNECTED' | 'REVOKED' | 'EXPIRED';
  revision: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  encryptedPageToken: {
    iv: string;
    tag: string;
    ciphertext: string;
  };
}

export interface RegisterDirectPageCredentialInput {
  connectionId?: string;
  tenantId: string;
  userId: string;
  pilotLabel?: string;
  pageId: string;
  pageName: string;
  pageToken: string;
  tasks?: readonly string[];
  scopes?: readonly string[];
  revision?: string;
  expiresAt?: string;
}

export class FacebookDirectPageCredentialStore {
  private readonly store: Store;
  private readonly key: Buffer;
  private readonly now: () => Date;
  private readonly revalidateBoundPage = new WeakMap<FacebookResolvedPageBinding, () => Promise<boolean>>();

  constructor(options: { store: Store; credentialKey: string | Buffer; now?: () => Date }) {
    this.store = options.store;
    this.key = normalizeCredentialKey(options.credentialKey);
    this.now = options.now ?? (() => new Date());
  }

  private aadFor(meta: { tenantId: string; userId: string; connectionId: string; pageId: string; revision: string }): Buffer {
    return Buffer.from(
      `facebook-direct-page-v1|${meta.tenantId}|${meta.userId}|${meta.connectionId}|${meta.pageId}|${meta.revision}`,
      'utf8',
    );
  }

  private encryptToken(
    token: string,
    meta: { tenantId: string; userId: string; connectionId: string; pageId: string; revision: string },
  ) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aadFor(meta));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decryptToken(
    encrypted: { iv: string; tag: string; ciphertext: string },
    meta: { tenantId: string; userId: string; connectionId: string; pageId: string; revision: string },
  ): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAAD(this.aadFor(meta));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    if (!plain || plain.trim().length < 12 || /[\s\r\n]/.test(plain)) {
      throw new Error('DIRECT_PAGE_TOKEN_CORRUPTED');
    }
    return plain;
  }

  registerDirectPageCredential(input: RegisterDirectPageCredentialInput): FacebookOAuthConnection {
    assertLiveOrdinaryCustomer(this.store, input.tenantId, input.userId);
    if (!NUMERIC_PAGE_ID.test(input.pageId)) {
      throw new Error('DIRECT_PAGE_ID_INVALID');
    }
    if (typeof input.pageName !== 'string' || input.pageName.trim().length < 1 || input.pageName.length > 200) {
      throw new Error('DIRECT_PAGE_NAME_INVALID');
    }
    if (typeof input.pageToken !== 'string' || input.pageToken.trim().length < 12 || /[\s\r\n]/.test(input.pageToken)) {
      throw new Error('DIRECT_PAGE_TOKEN_INVALID');
    }
    const connectionId = input.connectionId ?? `fb-direct-${randomBytes(16).toString('hex')}`;
    if (!connectionId.startsWith('fb-direct-') || !SAFE_ID.test(connectionId)) {
      throw new Error('DIRECT_PAGE_CONNECTION_ID_INVALID');
    }
    const existing = this.store.get(DIRECT_PAGE_CREDENTIAL_COLLECTION, connectionId) as
      | StoredDirectPageCredentialRecord
      | undefined;
    if (existing && (existing.tenantId !== input.tenantId || existing.userId !== input.userId)) {
      throw new Error('DIRECT_PAGE_CONNECTION_FOREIGN_OWNER');
    }
    const tasks = [...(input.tasks ?? ['CREATE_CONTENT'])];
    if (!tasks.includes('CREATE_CONTENT') && !tasks.includes('PROFILE_PLUS_CREATE_CONTENT')) {
      throw new Error('DIRECT_PAGE_CREATE_CONTENT_REQUIRED');
    }
    const scopes = [...(input.scopes ?? REQUIRED_DIRECT_PAGE_SCOPES)];
    for (const reqScope of REQUIRED_DIRECT_PAGE_SCOPES) {
      if (!scopes.includes(reqScope)) {
        throw new Error('DIRECT_PAGE_SCOPE_MISSING');
      }
    }
    const nowIso = this.now().toISOString();
    const expiresAt = input.expiresAt ?? new Date(this.now().getTime() + 30 * 24 * 3600 * 1000).toISOString();
    if (new Date(expiresAt).getTime() <= this.now().getTime()) {
      throw new Error('DIRECT_PAGE_CREDENTIAL_EXPIRED');
    }
    const nextRevNumber = existing
      ? (Number.parseInt(String(existing.revision).replace(/^r/, ''), 10) || 1) + 1
      : 1;
    const revision = input.revision ?? `r${nextRevNumber}`;
    const encryptedPageToken = this.encryptToken(input.pageToken, {
      tenantId: input.tenantId,
      userId: input.userId,
      connectionId,
      pageId: input.pageId,
      revision,
    });
    const record: StoredDirectPageCredentialRecord = {
      id: connectionId,
      tenantId: input.tenantId,
      userId: input.userId,
      platform: 'FACEBOOK',
      mode: 'DIRECT_PAGE_TOKEN',
      ...(input.pilotLabel ? { pilotLabel: input.pilotLabel } : {}),
      pageId: input.pageId,
      pageName: input.pageName.trim(),
      tasks,
      scopes,
      status: 'CONNECTED',
      revision,
      expiresAt,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      encryptedPageToken,
    };
    this.store.put(DIRECT_PAGE_CREDENTIAL_COLLECTION, record, input.userId);
    return this.toGrant(record);
  }

  revokeDirectPageCredential(principal: FacebookCustomer, connectionId: string): void {
    const record = this.store.get(DIRECT_PAGE_CREDENTIAL_COLLECTION, connectionId) as
      | StoredDirectPageCredentialRecord
      | undefined;
    if (!record || record.tenantId !== principal.tenantId || record.userId !== principal.userId) {
      throw new Error('DIRECT_PAGE_CONNECTION_NOT_FOUND');
    }
    const nextRevNumber = (Number.parseInt(String(record.revision).replace(/^r/, ''), 10) || 1) + 1;
    this.store.put(
      DIRECT_PAGE_CREDENTIAL_COLLECTION,
      {
        ...record,
        status: 'REVOKED',
        revision: `r${nextRevNumber}`,
        updatedAt: this.now().toISOString(),
      },
      principal.userId,
    );
  }

  getOwnerConnectionGrant(
    principal: FacebookCustomer,
    connectionId: string,
  ): FacebookOAuthConnection | null {
    assertLiveOrdinaryCustomer(this.store, principal.tenantId, principal.userId);
    const record = this.store.get(DIRECT_PAGE_CREDENTIAL_COLLECTION, connectionId) as
      | StoredDirectPageCredentialRecord
      | undefined;
    if (!record || record.tenantId !== principal.tenantId || record.userId !== principal.userId) {
      return null;
    }
    return this.toGrant(record);
  }

  async listManagedPages(
    connection: FacebookOAuthConnection,
  ): Promise<readonly FacebookManagedPage[]> {
    assertLiveOrdinaryCustomer(this.store, connection.tenantId, connection.userId);
    const record = this.store.get(DIRECT_PAGE_CREDENTIAL_COLLECTION, connection.id) as
      | StoredDirectPageCredentialRecord
      | undefined;
    if (
      !record ||
      record.tenantId !== connection.tenantId ||
      record.userId !== connection.userId ||
      record.revision !== connection.revision ||
      record.status !== 'CONNECTED'
    ) {
      throw new Error('DIRECT_PAGE_CONNECTION_INACTIVE');
    }
    if (new Date(record.expiresAt).getTime() <= this.now().getTime()) {
      throw new Error('DIRECT_PAGE_CREDENTIAL_EXPIRED');
    }
    this.decryptToken(record.encryptedPageToken, {
      tenantId: record.tenantId,
      userId: record.userId,
      connectionId: record.id,
      pageId: record.pageId,
      revision: record.revision,
    });
    assertLiveOrdinaryCustomer(this.store, connection.tenantId, connection.userId);
    return Object.freeze([
      Object.freeze({
        id: record.pageId,
        name: record.pageName,
        tasks: Object.freeze([...record.tasks]),
      }),
    ]);
  }

  async resolveCurrentPageTokenForPublish(
    input: FacebookCurrentPageTokenRequest,
    selectedPages: FacebookCurrentSelectedPageProvider,
  ): Promise<FacebookResolvedPageBinding> {
    if (
      !input ||
      typeof input !== 'object' ||
      !SAFE_ID.test(input.tenantId || '') ||
      input.tenantId !== input.userId ||
      !input.pageConnectionId?.startsWith('fb-direct-') ||
      !SAFE_ID.test(input.pageConnectionId) ||
      !NUMERIC_PAGE_ID.test(input.pageId || '') ||
      typeof input.connectionRevision !== 'string' ||
      !input.connectionRevision
    ) {
      throw new Error('FACEBOOK_PAGE_SELECTION_UNVERIFIED');
    }

    const choiceId = 'fb-choice-' + createHash('sha256').update(input.tenantId + '\0' + input.userId).digest('hex');
    const selectionNonce = (): string | null => {
      try {
        const row = this.store.db
          .prepare('SELECT owner,payload FROM records WHERE collection=? AND id=?')
          .get('facebook-page-selections', choiceId) as { owner: unknown; payload: unknown } | undefined;
        if (!row || row.owner !== input.tenantId || typeof row.payload !== 'string') return null;
        const current = JSON.parse(row.payload) as Record<string, unknown>;
        if (
          !current ||
          current.tenantId !== input.tenantId ||
          current.userId !== input.userId ||
          current.connectionId !== input.pageConnectionId ||
          current.connectionRevision !== input.connectionRevision ||
          current.pageId !== input.pageId ||
          typeof current.selectionNonce !== 'string'
        ) {
          return null;
        }
        return current.selectionNonce;
      } catch {
        return null;
      }
    };

    const pinnedNonce = selectionNonce();
    if (!pinnedNonce) {
      throw new Error('FACEBOOK_PAGE_SELECTION_UNVERIFIED');
    }

    const verifyLiveAndSelection = async (): Promise<boolean> => {
      try {
        assertLiveOrdinaryCustomer(this.store, input.tenantId, input.userId);
        const page = await selectedPages.requireSelectedDispatchGrant(
          { tenantId: input.tenantId, userId: input.userId },
          input.pageConnectionId,
        );
        assertLiveOrdinaryCustomer(this.store, input.tenantId, input.userId);
        const record = this.store.get(DIRECT_PAGE_CREDENTIAL_COLLECTION, input.pageConnectionId) as
          | StoredDirectPageCredentialRecord
          | undefined;
        if (
          !record ||
          record.tenantId !== input.tenantId ||
          record.userId !== input.userId ||
          record.pageId !== input.pageId ||
          record.revision !== input.connectionRevision ||
          record.status !== 'CONNECTED' ||
          new Date(record.expiresAt).getTime() <= this.now().getTime()
        ) {
          return false;
        }
        return (
          !!page &&
          page.tenantId === input.tenantId &&
          page.ownerUserId === input.userId &&
          page.connectionId === input.pageConnectionId &&
          page.pageId === input.pageId &&
          page.connectionRevision === input.connectionRevision &&
          page.targetType === 'PAGE' &&
          page.status === 'CONNECTED' &&
          Array.isArray(page.tasks) &&
          (page.tasks.includes('CREATE_CONTENT') || page.tasks.includes('PROFILE_PLUS_CREATE_CONTENT')) &&
          Array.isArray(page.scopes) &&
          REQUIRED_DIRECT_PAGE_SCOPES.every((s) => page.scopes.includes(s)) &&
          selectionNonce() === pinnedNonce
        );
      } catch {
        return false;
      }
    };

    if (!(await verifyLiveAndSelection())) {
      throw new Error('FACEBOOK_PAGE_SELECTION_UNVERIFIED');
    }

    const record = this.store.get(DIRECT_PAGE_CREDENTIAL_COLLECTION, input.pageConnectionId) as
      | StoredDirectPageCredentialRecord
      | undefined;
    if (!record) {
      throw new Error('DIRECT_PAGE_CREDENTIAL_UNAVAILABLE');
    }

    const pageToken = this.decryptToken(record.encryptedPageToken, {
      tenantId: record.tenantId,
      userId: record.userId,
      connectionId: record.id,
      pageId: record.pageId,
      revision: record.revision,
    });

    if (!(await verifyLiveAndSelection())) {
      throw new Error('FACEBOOK_PAGE_SELECTION_STALE');
    }

    const binding: FacebookResolvedPageBinding = Object.freeze({
      tenantId: record.tenantId,
      pageId: record.pageId,
      pageToken,
      verifiedPageId: record.pageId,
      canCreateContent: true as const,
      scopes: Object.freeze([...record.scopes]),
      connectionRevision: record.revision,
    });

    this.revalidateBoundPage.set(binding, verifyLiveAndSelection);
    return binding;
  }

  hasBoundPageBinding(binding: FacebookResolvedPageBinding): boolean {
    return this.revalidateBoundPage.has(binding);
  }

  async assertResolvedPageTokenCurrent(binding: FacebookResolvedPageBinding): Promise<void> {
    const recheck = binding && typeof binding === 'object' ? this.revalidateBoundPage.get(binding) : undefined;
    if (!recheck || !(await recheck())) {
      throw new Error('FACEBOOK_PAGE_SELECTION_STALE');
    }
  }

  private toGrant(record: StoredDirectPageCredentialRecord): FacebookOAuthConnection {
    const expired = new Date(record.expiresAt).getTime() <= this.now().getTime();
    return Object.freeze({
      id: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      platform: 'FACEBOOK' as const,
      status:
        record.status === 'CONNECTED' && !expired
          ? ('CONNECTED' as const)
          : record.status === 'REVOKED'
            ? ('DISCONNECTED' as const)
            : ('REAUTH_REQUIRED' as const),
      revision: record.revision,
      scopes: Object.freeze([...record.scopes]),
      expiresAt: record.expiresAt,
    });
  }
}

export function createHybridFacebookPageTokenResolver(options: {
  oauthResolver: FacebookTrustedPageTokenResolver;
  directCredentials: FacebookDirectPageCredentialStore;
  selectedPages: FacebookCurrentSelectedPageProvider;
}): FacebookTrustedPageTokenResolver {
  return {
    async resolveCurrentPageToken(input: FacebookCurrentPageTokenRequest): Promise<FacebookResolvedPageBinding> {
      if (input?.pageConnectionId?.startsWith('fb-direct-')) {
        return options.directCredentials.resolveCurrentPageTokenForPublish(input, options.selectedPages);
      }
      return options.oauthResolver.resolveCurrentPageToken(input);
    },
    async assertResolvedPageTokenCurrent(binding: FacebookResolvedPageBinding): Promise<void> {
      if (options.directCredentials.hasBoundPageBinding(binding)) {
        return options.directCredentials.assertResolvedPageTokenCurrent(binding);
      }
      return options.oauthResolver.assertResolvedPageTokenCurrent(binding);
    },
  };
}

function pngCrc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function channelsForPngColorType(colorType: number, bitDepth: number): number {
  switch (colorType) {
    case 0:
      if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
      return 1;
    case 2:
      if (![8, 16].includes(bitDepth)) throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
      return 3;
    case 3:
      if (![1, 2, 4, 8].includes(bitDepth)) throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
      return 1;
    case 4:
      if (![8, 16].includes(bitDepth)) throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
      return 2;
    case 6:
      if (![8, 16].includes(bitDepth)) throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
      return 4;
    default:
      throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
  }
}

/**
 * Full PNG chunk CRC + zlib inflate + scanline dimension & filter-byte verifier.
 * Remediates LCG17 IMAGE-RASTER-DECODE-RED (rejects forged IHDR dimensions with smaller IDAT
 * pixel stream and corrupt zlib streams before any private media record is stored).
 */
export function validateFullPngRasterDecode(bytes: Buffer): { width: number; height: number; totalBytes: number } {
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || bytes.length > 8_000_000) {
    throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
  }
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
  }
  let offset = 8;
  let sawIhdr = false;
  let sawPlte = false;
  let sawIend = false;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatParts: Buffer[] = [];
  let sawIdat = false;
  let endedIdat = false;

  while (offset < bytes.length) {
    if (sawIend || offset + 12 > bytes.length) {
      throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
    }
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) ||
        (/^[A-Z]/.test(type) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type))) {
      throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
    }
    if (sawIdat && type !== 'IDAT') endedIdat = true;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length > 8_000_000 || dataEnd + 4 > bytes.length) {
      throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
    }
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = pngCrc32(bytes.subarray(offset + 4, dataEnd));
    if (expectedCrc !== actualCrc) {
      throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
    }
    const chunkData = bytes.subarray(dataStart, dataEnd);
    if (!sawIhdr) {
      if (type !== 'IHDR' || length !== 13) {
        throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
      }
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8]!;
      colorType = chunkData[9]!;
      const compression = chunkData[10]!;
      const filter = chunkData[11]!;
      const interlace = chunkData[12]!;
      if (
        width < 1 ||
        height < 1 ||
        width > 2048 ||
        height > 2048 ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      ) {
        throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
      }
      channelsForPngColorType(colorType, bitDepth);
      sawIhdr = true;
    } else if (type === 'IHDR') {
      throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
    } else if (type === 'PLTE') {
      if (sawPlte || sawIdat || colorType === 0 || colorType === 4 ||
          length < 3 || length > 768 || length % 3 !== 0 ||
          (colorType === 3 && length / 3 > 2 ** bitDepth)) {
        throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
      }
      sawPlte = true;
    } else if (type === 'IDAT') {
      if (endedIdat || (colorType === 3 && !sawPlte)) {
        throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
      }
      sawIdat = true;
      if (length > 0) {
        idatParts.push(chunkData);
      }
    } else if (type === 'IEND') {
      if (length !== 0) {
        throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
      }
      sawIend = true;
    }
    offset = dataEnd + 4;
  }

  if (!sawIhdr || !sawIend || idatParts.length === 0) {
    throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
  }
  if (colorType === 3 && !sawPlte) {
    throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
  }

  const channels = channelsForPngColorType(colorType, bitDepth);
  const scanlineBytes = 1 + Math.ceil((width * channels * bitDepth) / 8);
  const expectedDecompressedBytes = height * scanlineBytes;
  if (expectedDecompressedBytes < 2 || expectedDecompressedBytes > MAX_RASTER_DECOMPRESSED_BYTES) {
    throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
  }

  let decompressed: Buffer;
  try {
    decompressed = inflateSync(Buffer.concat(idatParts), {
      maxOutputLength: expectedDecompressedBytes + 1,
    });
  } catch {
    throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
  }

  if (decompressed.length !== expectedDecompressedBytes) {
    throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
  }

  for (let row = 0; row < height; row++) {
    const filterType = decompressed[row * scanlineBytes]!;
    if (filterType > 4) {
      throw new Lcg6GenerationError('INVALID_PROVIDER_IMAGE');
    }
  }

  return { width, height, totalBytes: bytes.length };
}

export interface StoredCustomerGenerationApprovalRecord {
  id: string;
  ownerId: string;
  tenantId: string;
  generationApproval: {
    approved: boolean;
    approvedAt: number;
    expiresAt: number;
    revokedAt?: number | null;
    maxImages: 1;
    maxCostUsdCents: number;
  };
}

export interface StoredGenerationJobRecord {
  approvalIssuedAt?: number;
  id: string;
  tenantId: string;
  subjectId: string;
  requestKey: string;
  promptSha256: string;
  model: typeof LCG6_OPENAI_MODEL;
  reservedCostUsdCents: number;
  state: 'RESERVED_IN_FLIGHT' | 'COMPLETED' | 'UNCERTAIN' | 'FAILED';
  mediaRef?: string;
  sha256?: string;
  totalBytes?: number;
  contentType?: 'image/png';
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredGenerationBudgetRecord {
  id: string;
  tenantId: string;
  reservedCostUsdCents: number;
  maxBudgetUsdCents: number;
  attemptsCount: number;
  updatedAt: string;
}

export interface StoredGeneratedImageProvenanceRecord {
  id: string;
  mediaRef: string;
  tenantId: string;
  ownerId: string;
  requestKey: string;
  promptSha256: string;
  sha256: string;
  width: number;
  height: number;
  totalBytes: number;
  contentType: 'image/png';
  model: typeof LCG6_OPENAI_MODEL;
  provenance: 'SERVER_OPENAI_GENERATED_VERIFIED';
  provenanceHmac: string;
  createdAt: string;
}

export function readSchedulePageSelection(store: Store, tenantId: string, userId: string, connectionId: string) {
  const row = store.get('facebook-page-selections', 'fb-choice-' + sha256Hex(tenantId + '\0' + userId));
  if (!row || row.tenantId !== tenantId || row.userId !== userId || row.connectionId !== connectionId ||
      typeof row.selectionNonce !== 'string' || !row.selectionNonce ||
      typeof row.connectionRevision !== 'string' || typeof row.pageId !== 'string') {
    throw new Error('GENERATED_SCHEDULE_PAGE_SELECTION_REQUIRED');
  }
  return { selectionNonce: row.selectionNonce, connectionRevision: row.connectionRevision, pageId: row.pageId };
}

type GeneratedScheduleInput = BucharestLocalInput & { idempotencyKey: string };

export interface StoredGeneratedPublishApprovalRecord {
  schedule?: {
    jobId: string;
    scheduledAt: string;
    selectionNonce: string;
    connectionRevision: string;
    pageId: string;
  };
  id: string;
  tenantId: string;
  userId: string;
  pageConnectionId: string;
  mediaRef: string;
  mediaSha256: string;
  captionSha256: string;
  mode: 'NOW' | 'SCHEDULE' | 'BOTH';
  approved: boolean;
  approvedAt: number;
  expiresAt: number;
  revokedAt?: number;
}

export interface GeneratePrivateImageReceipt {
  state: 'STORED_PRIVATE';
  published: false;
  mediaRef: string;
  contentType: 'image/png';
  sha256: string;
  totalBytes: number;
}

export interface GeneratedImagePreviewResult {
  mediaRef: string;
  tenantId: string;
  ownerId: string;
  contentType: 'image/png';
  sha256: string;
  width: number;
  height: number;
  totalBytes: number;
  bytes: Buffer;
  state: 'STORED_PRIVATE';
  publicationState: 'NOT_PUBLISHED';
  provenance: 'SERVER_OPENAI_GENERATED_VERIFIED';
  requiresExplicitPublishApproval: true;
}

export interface FacebookCustomerOpenAIImageGenerationOptions {
  store: Store;
  auth: CustomerFacebookMcpAuth;
  media: FacebookCustomerMediaService;
  enabled: boolean;
  resolveServerCredential: (ref: typeof LCG6_OPENAI_IMAGE_KEY_REF) => string;
  provenanceSecretKey: string | Buffer;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  defaultTenantBudgetUsdCents?: number;
  uncappedCustomerId?: string;
  requireExplicitPublishApprovalForGeneratedMedia?: boolean;
  beforeProviderCallHook?: (context: { tenantId: string; subjectId: string; requestKey: string }) => Promise<void> | void;
  now?: () => Date;
}

export class FacebookCustomerOpenAIImageGenerationService {
  private readonly store: Store;
  private readonly auth: CustomerFacebookMcpAuth;
  private readonly media: FacebookCustomerMediaService;
  private readonly provenanceKey: Buffer;
  private readonly defaultTenantBudgetUsdCents: number;
  private readonly uncappedCustomerId?: string;
  private readonly requireExplicitPublishApproval: boolean;
  private readonly beforeProviderCallHook?: (context: { tenantId: string; subjectId: string; requestKey: string }) => Promise<void> | void;
  private readonly now: () => Date;
  private readonly adapter: ReturnType<typeof createLcg6OpenAIImagesAdapter>;

  constructor(options: FacebookCustomerOpenAIImageGenerationOptions) {
    this.store = options.store;
    this.auth = options.auth;
    this.media = options.media;
    this.provenanceKey = normalizeCredentialKey(options.provenanceSecretKey);
    this.uncappedCustomerId = options.uncappedCustomerId;
    this.defaultTenantBudgetUsdCents = options.defaultTenantBudgetUsdCents ?? 200;
    this.requireExplicitPublishApproval = options.requireExplicitPublishApprovalForGeneratedMedia ?? false;
    this.beforeProviderCallHook = options.beforeProviderCallHook;
    this.now = options.now ?? (() => new Date());

    this.adapter = createLcg6OpenAIImagesAdapter({
      enabled: options.enabled,
      resolveServerCredential: options.resolveServerCredential,
      reserveAttempt: async (reservation) => this.reserveDurableAttempt(reservation),
      fetchImpl: (request, init) => {
        if (process.env.CUSTOMER_MCP_IMAGE_GEN_ENABLED === 'false') {
          throw new Error('IMAGE_GENERATION_DISABLED');
        }
        assertFacebookCustomerPilotEffectsAllowed(this.store);
        return (options.fetchImpl ?? fetch)(request, init);
      },
      timeoutMs: options.timeoutMs,
    });
  }

  grantCustomerImageGenerationApproval(input: {
    tenantId: string;
    ownerId: string;
    maxCostUsdCents?: number;
    ttlMs?: number;
    approvedAt?: number;
  }): StoredCustomerGenerationApprovalRecord {
    assertLiveOrdinaryCustomer(this.store, input.tenantId, input.ownerId);
    const nowMs = this.now().getTime();
    const approvedAt = input.approvedAt ?? Math.max(1, nowMs - 10);
    const ttlMs = input.ttlMs ?? MAX_GENERATION_APPROVAL_TTL_MS;
    if (!Number.isSafeInteger(approvedAt) || approvedAt < 1 || approvedAt > nowMs ||
        !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_GENERATION_APPROVAL_TTL_MS ||
        approvedAt + ttlMs <= nowMs) {
      throw new Error('INVALID_GENERATION_APPROVAL_WINDOW');
    }
    const maxCostUsdCents = input.maxCostUsdCents ?? 5;
    if (!Number.isInteger(maxCostUsdCents) || maxCostUsdCents < 1 || maxCostUsdCents > 1000) {
      throw new Error('INVALID_GENERATION_APPROVAL_COST_CEILING');
    }
    const record: StoredCustomerGenerationApprovalRecord = {
      id: `gen-approval-${input.tenantId}`,
      ownerId: input.ownerId,
      tenantId: input.tenantId,
      generationApproval: {
        approved: true,
        approvedAt,
        expiresAt: approvedAt + ttlMs,
        maxImages: 1,
        maxCostUsdCents,
      },
    };
    this.store.put(GENERATION_APPROVAL_COLLECTION, record, input.ownerId);
    return record;
  }

  revokeCustomerImageGenerationApproval(tenantId: string, ownerId: string): void {
    const existing = this.store.get(
      GENERATION_APPROVAL_COLLECTION,
      `gen-approval-${tenantId}`,
    ) as StoredCustomerGenerationApprovalRecord | undefined;
    if (!existing || existing.tenantId !== tenantId || existing.ownerId !== ownerId) {
      return;
    }
    this.store.put(
      GENERATION_APPROVAL_COLLECTION,
      {
        ...existing,
        generationApproval: {
          ...existing.generationApproval,
          revokedAt: this.now().getTime(),
        },
      },
      ownerId,
    );
  }

  private hasStandingGenerationApproval(tenantId: string, ownerId: string): boolean {
    return Boolean(this.uncappedCustomerId && this.uncappedCustomerId === tenantId && tenantId === ownerId);
  }

  getGenerationApproval(principal: { tenantId: string; ownerId: string }): StoredCustomerGenerationApprovalRecord | null {
    if (this.hasStandingGenerationApproval(principal.tenantId, principal.ownerId)) {
      const approvedAt = Math.max(1, this.now().getTime() - 10);
      return {
        id: `gen-approval-${principal.tenantId}`,
        ...principal,
        generationApproval: {
          approved: true,
          approvedAt,
          expiresAt: approvedAt + MAX_GENERATION_APPROVAL_TTL_MS,
          maxImages: 1,
          maxCostUsdCents: Math.round(LCG6_OPENAI_RESERVE_CEILING_USD * 100),
        },
      };
    }
    const record = (this.store.get(
      GENERATION_APPROVAL_COLLECTION,
      `gen-approval-${principal.tenantId}`,
    ) ??
      this.store.get(
        'qa-generation-approvals',
        `generation-${principal.ownerId}`,
      )) as StoredCustomerGenerationApprovalRecord | undefined;
    if (!record || record.tenantId !== principal.tenantId || record.ownerId !== principal.ownerId) {
      return null;
    }
    const approval = record.generationApproval;
    const nowMs = this.now().getTime();
    if (!approval || !Number.isSafeInteger(approval.approvedAt) || !Number.isSafeInteger(approval.expiresAt) ||
        approval.approvedAt < 1 || approval.approvedAt > nowMs || approval.expiresAt <= nowMs ||
        approval.expiresAt - approval.approvedAt > MAX_GENERATION_APPROVAL_TTL_MS) {
      return null;
    }
    return record;
  }

  setTenantBudgetCeilingUsdCents(tenantId: string, maxBudgetUsdCents: number): void {
    if (!Number.isInteger(maxBudgetUsdCents) || maxBudgetUsdCents < 0 || maxBudgetUsdCents > 100_000) {
      throw new Error('INVALID_TENANT_BUDGET_CEILING');
    }
    const existing = this.store.get(GENERATION_BUDGET_COLLECTION, tenantId) as
      | StoredGenerationBudgetRecord
      | undefined;
    this.store.put(
      GENERATION_BUDGET_COLLECTION,
      {
        id: tenantId,
        tenantId,
        reservedCostUsdCents: existing?.reservedCostUsdCents ?? 0,
        maxBudgetUsdCents,
        attemptsCount: existing?.attemptsCount ?? 0,
        updatedAt: this.now().toISOString(),
      },
      tenantId,
    );
  }

  private uploadServerGeneratedMedia(
    rawAuthHeader: unknown,
    upload: CustomerFacebookImageUpload,
  ): CustomerFacebookImageReceipt {
    const livePrincipal = this.auth.authenticateBearer(rawAuthHeader);
    if (!livePrincipal.scopes.includes('facebook.image.generate')) {
      throw new CustomerMcpAuthError('FORBIDDEN', 'Customer image generation scope required');
    }
    const mediaOptions = (this.media as unknown as {
      options?: { authenticate: (cred: unknown) => unknown };
    }).options;
    const originalAuth = mediaOptions?.authenticate;
    try {
      if (mediaOptions && typeof originalAuth === 'function') {
        mediaOptions.authenticate = (cred: unknown) => {
          const verified = this.auth.authenticateBearer(cred);
          const scopes = verified.scopes.includes('facebook.media.write')
            ? verified.scopes
            : Object.freeze([...verified.scopes, 'facebook.media.write']);
          return Object.freeze({
            source: 'CUSTOMER_MCP' as const,
            audience: 'starli-customer-facebook-mcp' as const,
            tenantId: verified.tenantId,
            ownerId: verified.ownerId,
            subjectId: verified.subjectId,
            scopes,
          });
        };
      }
      return this.media.uploadImage(rawAuthHeader, upload);
    } finally {
      if (mediaOptions && originalAuth) {
        mediaOptions.authenticate = originalAuth;
      }
    }
  }

  private readServerGeneratedMedia(
    rawAuthHeader: unknown,
    mediaRef: string,
  ): { media: CustomerFacebookImageReceipt; bytes: Buffer } {
    const livePrincipal = this.auth.authenticateBearer(rawAuthHeader);
    if (
      !livePrincipal.scopes.includes('facebook.image.generate') &&
      !livePrincipal.scopes.includes('facebook.media.write') &&
      !livePrincipal.scopes.includes('facebook.pages.read')
    ) {
      throw new CustomerMcpAuthError('FORBIDDEN', 'Customer preview scope required');
    }
    const mediaOptions = (this.media as unknown as {
      options?: { authenticate: (cred: unknown) => unknown };
    }).options;
    const originalAuth = mediaOptions?.authenticate;
    try {
      if (mediaOptions && typeof originalAuth === 'function') {
        mediaOptions.authenticate = (cred: unknown) => {
          const verified = this.auth.authenticateBearer(cred);
          const scopes = verified.scopes.includes('facebook.media.write')
            ? verified.scopes
            : Object.freeze([...verified.scopes, 'facebook.media.write']);
          return Object.freeze({
            source: 'CUSTOMER_MCP' as const,
            audience: 'starli-customer-facebook-mcp' as const,
            tenantId: verified.tenantId,
            ownerId: verified.ownerId,
            subjectId: verified.subjectId,
            scopes,
          });
        };
      }
      return this.media.readImage(rawAuthHeader, mediaRef);
    } finally {
      if (mediaOptions && originalAuth) {
        mediaOptions.authenticate = originalAuth;
      }
    }
  }

  private async reserveDurableAttempt(reservation: Lcg6GenerationReservation): Promise<boolean> {
    if (this.beforeProviderCallHook) {
      await this.beforeProviderCallHook({
        tenantId: reservation.tenantId,
        subjectId: reservation.subjectId,
        requestKey: reservation.requestId,
      });
    }
    if (process.env.CUSTOMER_MCP_IMAGE_GEN_ENABLED === 'false') return false;
    assertFacebookCustomerPilotEffectsAllowed(this.store);
    const jobId = `${reservation.tenantId}:${reservation.requestId}`;
    const nowIso = this.now().toISOString();

    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      assertLiveOrdinaryCustomer(this.store, reservation.tenantId, reservation.subjectId);
      const approval = this.getGenerationApproval({
        tenantId: reservation.tenantId,
        ownerId: reservation.subjectId,
      });
      assertActiveCustomerImageGenerationApproval(approval);
      const reserveCents = Math.round(LCG6_OPENAI_RESERVE_CEILING_USD * 100);
      if ((approval?.generationApproval.maxCostUsdCents ?? 0) < reserveCents) {
        throw new Error('GENERATION_APPROVAL_COST_INSUFFICIENT');
      }
      if (!approval) throw new Error('GENERATION_APPROVAL_REQUIRED');
      const approvalIssuedAt = approval.generationApproval.approvedAt;
      const standingApproval = this.hasStandingGenerationApproval(reservation.tenantId, reservation.subjectId);
      const existingByKey = this.store.get(GENERATION_JOB_COLLECTION, jobId) as
        | StoredGenerationJobRecord
        | undefined;
      if (existingByKey) {
        this.store.db.exec('COMMIT');
        return false;
      }

      const tenantJobs = (
        this.store.list(GENERATION_JOB_COLLECTION, reservation.subjectId) as StoredGenerationJobRecord[]
      ).filter((j) => j.tenantId === reservation.tenantId && j.subjectId === reservation.subjectId);
      // Reserve the single approved attempt under the same SQLite write lock
      // as the spend ledger and job. Legacy reservations also consume the
      // current approval when they were made during its lifetime.
      if (!standingApproval && tenantJobs.some(job =>
        (job.approvalIssuedAt ?? Date.parse(job.createdAt)) >= approvalIssuedAt
      )) {
        this.store.db.exec('COMMIT');
        return false;
      }
      if (
        tenantJobs.some(
          (j) =>
            j.promptSha256 === reservation.promptSha256 &&
            (j.state === 'UNCERTAIN' || j.state === 'RESERVED_IN_FLIGHT'),
        )
      ) {
        this.store.db.exec('COMMIT');
        return false;
      }

      const budget = (this.store.get(
        GENERATION_BUDGET_COLLECTION,
        reservation.tenantId,
      ) as StoredGenerationBudgetRecord | undefined) ?? {
        id: reservation.tenantId,
        tenantId: reservation.tenantId,
        reservedCostUsdCents: 0,
        maxBudgetUsdCents: this.defaultTenantBudgetUsdCents,
        attemptsCount: 0,
        updatedAt: nowIso,
      };

      if (!standingApproval && budget.reservedCostUsdCents + reserveCents > budget.maxBudgetUsdCents) {
        this.store.db.exec('COMMIT');
        return false;
      }

      this.store.put(
        GENERATION_BUDGET_COLLECTION,
        {
          ...budget,
          reservedCostUsdCents: budget.reservedCostUsdCents + reserveCents,
          attemptsCount: budget.attemptsCount + 1,
          updatedAt: nowIso,
        },
        reservation.subjectId,
      );

      const job: StoredGenerationJobRecord = {
        id: jobId,
        tenantId: reservation.tenantId,
        subjectId: reservation.subjectId,
        requestKey: reservation.requestId,
        promptSha256: reservation.promptSha256,
        model: reservation.model,
        reservedCostUsdCents: reserveCents,
        approvalIssuedAt,
        state: 'RESERVED_IN_FLIGHT',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.store.put(GENERATION_JOB_COLLECTION, job, reservation.subjectId);
      this.store.db.exec('COMMIT');
      return true;
    } catch (error) {
      try {
        this.store.db.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }

  async generateAndStorePrivateImage(
    rawAuthHeader: unknown,
    rawArgs: { requestKey: string; prompt: string },
  ): Promise<GeneratePrivateImageReceipt> {
    const authResult = authenticateFacebookCustomerToolCall({
      auth: this.auth,
      authorization: rawAuthHeader,
      toolName: 'generate_image',
      toolArguments: rawArgs,
      loadStoredResource: (p) => this.getGenerationApproval(p),
    });
    const principal = authResult.principal;

    const trimmedPrompt = rawArgs.prompt.trim();
    const promptSha256 = sha256Hex(trimmedPrompt);
    const jobId = `${principal.tenantId}:${rawArgs.requestKey}`;

    const existing = this.store.get(GENERATION_JOB_COLLECTION, jobId) as
      | StoredGenerationJobRecord
      | undefined;
    if (existing) {
      if (existing.tenantId !== principal.tenantId || existing.subjectId !== principal.subjectId) {
        throw new Error('CROSS_TENANT_GENERATION_KEY_DENIED');
      }
      if (existing.promptSha256 !== promptSha256) {
        throw new Error('GENERATION_IDEMPOTENCY_PROMPT_MISMATCH');
      }
      if (
        existing.state === 'COMPLETED' &&
        existing.mediaRef &&
        existing.sha256 &&
        existing.totalBytes &&
        existing.contentType
      ) {
        this.verifyServerGeneratedProvenance(principal.tenantId, principal.ownerId, existing.mediaRef);
        return Object.freeze({
          state: 'STORED_PRIVATE' as const,
          published: false as const,
          mediaRef: existing.mediaRef,
          contentType: existing.contentType,
          sha256: existing.sha256,
          totalBytes: existing.totalBytes,
        });
      }
      throw new Error(`GENERATION_REQUEST_NOT_REPLAYABLE_${existing.state}`);
    }

    const verifiedAuth = authenticateFacebookCustomerToolCall({
      auth: this.auth,
      authorization: rawAuthHeader,
      toolName: 'generate_image',
      toolArguments: rawArgs,
      loadStoredResource: (p) => this.getGenerationApproval(p),
    });
    const verifiedPrincipal = verifiedAuth.principal;

    let generated;
    try {
      generated = await this.adapter.generate({
        tenantId: verifiedPrincipal.tenantId,
        subjectId: verifiedPrincipal.subjectId,
        requestId: rawArgs.requestKey,
        prompt: trimmedPrompt,
      });
    } catch (error) {
      const currentJob = this.store.get(GENERATION_JOB_COLLECTION, jobId) as
        | StoredGenerationJobRecord
        | undefined;
      if (currentJob && currentJob.state === 'RESERVED_IN_FLIGHT') {
        const isUncertain =
          error instanceof Lcg6GenerationError && error.code === 'UPSTREAM_TIMEOUT_UNCERTAIN';
        this.store.put(
          GENERATION_JOB_COLLECTION,
          {
            ...currentJob,
            state: isUncertain ? 'UNCERTAIN' : 'FAILED',
            errorCode: error instanceof Lcg6GenerationError ? error.code : 'GENERATION_FAILED',
            updatedAt: this.now().toISOString(),
          },
          verifiedPrincipal.subjectId,
        );
      }
      throw error;
    }

    let decodedDimensions: { width: number; height: number; totalBytes: number };
    try {
      decodedDimensions = validateFullPngRasterDecode(generated.bytes);
    } catch (error) {
      const currentJob = this.store.get(GENERATION_JOB_COLLECTION, jobId) as
        | StoredGenerationJobRecord
        | undefined;
      if (currentJob) {
        this.store.put(
          GENERATION_JOB_COLLECTION,
          {
            ...currentJob,
            state: 'FAILED',
            errorCode: 'INVALID_PROVIDER_IMAGE_RASTER',
            updatedAt: this.now().toISOString(),
          },
          verifiedPrincipal.subjectId,
        );
      }
      throw error;
    }

    const postAwaitAuth = authenticateFacebookCustomerToolCall({
      auth: this.auth,
      authorization: rawAuthHeader,
      toolName: 'generate_image',
      toolArguments: rawArgs,
      loadStoredResource: (p) => this.getGenerationApproval(p),
    });
    const postAwaitPrincipal = postAwaitAuth.principal;

    const storedMedia = this.uploadServerGeneratedMedia(rawAuthHeader, {
      idempotencyKey: `gen-${rawArgs.requestKey}`.slice(0, 120),
      contentType: 'image/png',
      imageBase64: generated.bytes.toString('base64'),
    });

    const createdAt = this.now().toISOString();
    const provenanceHmac = this.computeProvenanceHmac({
      tenantId: postAwaitPrincipal.tenantId,
      ownerId: postAwaitPrincipal.ownerId,
      mediaRef: storedMedia.mediaRef,
      sha256: storedMedia.sha256,
      requestKey: rawArgs.requestKey,
      promptSha256,
    });

    const provenanceRecord: StoredGeneratedImageProvenanceRecord = {
      id: storedMedia.mediaRef,
      mediaRef: storedMedia.mediaRef,
      tenantId: postAwaitPrincipal.tenantId,
      ownerId: postAwaitPrincipal.ownerId,
      requestKey: rawArgs.requestKey,
      promptSha256,
      sha256: storedMedia.sha256,
      width: decodedDimensions.width,
      height: decodedDimensions.height,
      totalBytes: storedMedia.byteSize,
      contentType: 'image/png',
      model: LCG6_OPENAI_MODEL,
      provenance: 'SERVER_OPENAI_GENERATED_VERIFIED',
      provenanceHmac,
      createdAt,
    };
    this.store.put(GENERATED_PROVENANCE_COLLECTION, provenanceRecord, postAwaitPrincipal.ownerId);

    const currentJob = this.store.get(GENERATION_JOB_COLLECTION, jobId) as
      | StoredGenerationJobRecord
      | undefined;
    if (currentJob) {
      this.store.put(
        GENERATION_JOB_COLLECTION,
        {
          ...currentJob,
          state: 'COMPLETED',
          mediaRef: storedMedia.mediaRef,
          sha256: storedMedia.sha256,
          totalBytes: storedMedia.byteSize,
          contentType: 'image/png',
          updatedAt: createdAt,
        },
        postAwaitPrincipal.subjectId,
      );
    }

    return Object.freeze({
      state: 'STORED_PRIVATE' as const,
      published: false as const,
      mediaRef: storedMedia.mediaRef,
      contentType: 'image/png' as const,
      sha256: storedMedia.sha256,
      totalBytes: storedMedia.byteSize,
    });
  }

  private computeProvenanceHmac(input: {
    tenantId: string;
    ownerId: string;
    mediaRef: string;
    sha256: string;
    requestKey: string;
    promptSha256: string;
  }): string {
    return createHmac('sha256', this.provenanceKey)
      .update(
        `server-openai-provenance-v1|${input.tenantId}|${input.ownerId}|${input.mediaRef}|${input.sha256}|${input.requestKey}|${input.promptSha256}|SERVER_OPENAI_GENERATED_VERIFIED`,
      )
      .digest('hex');
  }

  verifyServerGeneratedProvenance(
    tenantId: string,
    ownerId: string,
    mediaRef: string,
  ): StoredGeneratedImageProvenanceRecord {
    assertLiveOrdinaryCustomer(this.store, tenantId, ownerId);
    const record = this.store.get(GENERATED_PROVENANCE_COLLECTION, mediaRef) as
      | StoredGeneratedImageProvenanceRecord
      | undefined;
    if (!record || record.tenantId !== tenantId || record.ownerId !== ownerId || record.mediaRef !== mediaRef) {
      throw new Error('GENERATED_IMAGE_PROVENANCE_UNVERIFIED');
    }
    const expectedHmac = this.computeProvenanceHmac({
      tenantId: record.tenantId,
      ownerId: record.ownerId,
      mediaRef: record.mediaRef,
      sha256: record.sha256,
      requestKey: record.requestKey,
      promptSha256: record.promptSha256,
    });
    if (expectedHmac !== record.provenanceHmac || record.provenance !== 'SERVER_OPENAI_GENERATED_VERIFIED') {
      throw new Error('GENERATED_IMAGE_PROVENANCE_TAMPERED');
    }
    return record;
  }

  hasServerGeneratedProvenance(mediaRef: string): boolean {
    return Boolean(this.store.get(GENERATED_PROVENANCE_COLLECTION, mediaRef));
  }

  previewGeneratedImage(rawAuthHeader: unknown, mediaRef: string): GeneratedImagePreviewResult {
    const principal = this.auth.authenticateBearer(rawAuthHeader);
    assertLiveOrdinaryCustomer(this.store, principal.tenantId, principal.ownerId);
    const provenance = this.verifyServerGeneratedProvenance(principal.tenantId, principal.ownerId, mediaRef);
    const privateMedia = this.readServerGeneratedMedia(rawAuthHeader, mediaRef);
    if (
      privateMedia.media.mediaRef !== mediaRef ||
      privateMedia.media.sha256 !== provenance.sha256
    ) {
      throw new Error('GENERATED_IMAGE_PREVIEW_MISMATCH');
    }
    return Object.freeze({
      mediaRef: provenance.mediaRef,
      tenantId: provenance.tenantId,
      ownerId: provenance.ownerId,
      contentType: 'image/png' as const,
      sha256: provenance.sha256,
      width: provenance.width,
      height: provenance.height,
      totalBytes: provenance.totalBytes,
      bytes: privateMedia.bytes,
      state: 'STORED_PRIVATE' as const,
      publicationState: 'NOT_PUBLISHED' as const,
      provenance: 'SERVER_OPENAI_GENERATED_VERIFIED' as const,
      requiresExplicitPublishApproval: true as const,
    });
  }

  grantGeneratedImagePublishApproval(input: {
    tenantId: string;
    userId: string;
    pageConnectionId: string;
    mediaRef: string;
    caption: string;
    mode?: 'NOW' | 'SCHEDULE' | 'BOTH';
    schedule?: GeneratedScheduleInput;
    ttlMs?: number;
  }): StoredGeneratedPublishApprovalRecord {
    assertLiveOrdinaryCustomer(this.store, input.tenantId, input.userId);
    const provenance = this.verifyServerGeneratedProvenance(input.tenantId, input.userId, input.mediaRef);
    const nowMs = this.now().getTime();
    const mode = input.mode ?? 'NOW';
    let schedule: StoredGeneratedPublishApprovalRecord['schedule'];
    if (mode !== 'NOW') {
      if (!input.schedule || !/^[A-Za-z0-9_.:-]{8,160}$/.test(input.schedule.idempotencyKey)) {
        throw new Error('GENERATED_SCHEDULE_DETAILS_REQUIRED');
      }
      const {scheduledAt} = resolveBucharestTime(input.schedule, new Date(nowMs));
      const jobId = 'fbsc-' + sha256Hex(input.tenantId + '\0' + input.schedule.idempotencyKey);
      if (this.store.get('facebook-customer-schedule', jobId) ||
          nowMs + (input.ttlMs ?? 3600_000) <= Date.parse(scheduledAt)) {
        throw new Error('GENERATED_SCHEDULE_APPROVAL_WINDOW_INVALID');
      }
      schedule = {jobId, scheduledAt, ...readSchedulePageSelection(this.store,input.tenantId,input.userId,input.pageConnectionId)};
    }
    const record: StoredGeneratedPublishApprovalRecord = {
      id: `pub-approval:${input.tenantId}:${input.mediaRef}`,
      tenantId: input.tenantId,
      userId: input.userId,
      pageConnectionId: input.pageConnectionId,
      mediaRef: input.mediaRef,
      mediaSha256: provenance.sha256,
      captionSha256: sha256Hex(input.caption.trim()),
      mode,
      ...(schedule ? {schedule} : {}),
      approved: true,
      approvedAt: nowMs,
      expiresAt: nowMs + (input.ttlMs ?? 3600_000),
    };
    this.store.put(GENERATED_PUBLISH_APPROVAL_COLLECTION, record, input.userId);
    return record;
  }

  revokeGeneratedImagePublishApproval(tenantId: string, userId: string, mediaRef: string): void {
    const id = `pub-approval:${tenantId}:${mediaRef}`;
    const existing = this.store.get(GENERATED_PUBLISH_APPROVAL_COLLECTION, id) as
      | StoredGeneratedPublishApprovalRecord
      | undefined;
    if (!existing || existing.tenantId !== tenantId || existing.userId !== userId) {
      return;
    }
    this.store.put(
      GENERATED_PUBLISH_APPROVAL_COLLECTION,
      {
        ...existing,
        approved: false,
        revokedAt: this.now().getTime(),
      },
      userId,
    );
  }

  assertPublishApprovedForMediaRefs(input: {
    tenantId: string;
    userId: string;
    pageConnectionId: string;
    mediaRefs: readonly string[];
    caption: string;
    mode: 'NOW' | 'SCHEDULE';
    schedule?: GeneratedScheduleInput;
  }): void {
    assertLiveOrdinaryCustomer(this.store, input.tenantId, input.userId);
    for (const mediaRef of input.mediaRefs) {
      const provenance = this.store.get(GENERATED_PROVENANCE_COLLECTION, mediaRef) as
        | StoredGeneratedImageProvenanceRecord
        | undefined;
      if (!provenance) {
        continue;
      }
      const verifiedProvenance = this.verifyServerGeneratedProvenance(input.tenantId, input.userId, mediaRef);
      const approval = this.store.get(
        GENERATED_PUBLISH_APPROVAL_COLLECTION,
        `pub-approval:${input.tenantId}:${mediaRef}`,
      ) as StoredGeneratedPublishApprovalRecord | undefined;
      if (!approval && !this.requireExplicitPublishApproval && input.mode === 'NOW') {
        continue;
      }
      if (input.mode === 'SCHEDULE') {
        const approved = approval?.schedule;
        const current = readSchedulePageSelection(this.store,input.tenantId,input.userId,input.pageConnectionId);
        if (!input.schedule || !approved ||
            approved.jobId !== 'fbsc-' + sha256Hex(input.tenantId + '\0' + input.schedule.idempotencyKey) ||
            approved.scheduledAt !== resolveBucharestTime(input.schedule,new Date(0)).scheduledAt ||
            approved.selectionNonce !== current.selectionNonce ||
            approved.connectionRevision !== current.connectionRevision ||
            approved.pageId !== current.pageId) {
          throw new Error('GENERATED_SCHEDULE_APPROVAL_MISMATCH');
        }
      }
      const nowMs = this.now().getTime();
      if (
        !approval ||
        !approval.approved ||
        approval.revokedAt !== undefined ||
        approval.expiresAt <= nowMs ||
        approval.tenantId !== input.tenantId ||
        approval.userId !== input.userId ||
        approval.pageConnectionId !== input.pageConnectionId ||
        approval.mediaRef !== mediaRef ||
        approval.mediaSha256 !== verifiedProvenance.sha256 ||
        approval.captionSha256 !== sha256Hex(input.caption.trim()) ||
        (approval.mode !== 'BOTH' && approval.mode !== input.mode)
      ) {
        throw new CustomerMcpAuthError(
          'FORBIDDEN',
          'Explicit customer publish approval required for generated image',
        );
      }
    }
  }
}

export interface StoredVerifiedPermalinkRecord {
  id: string;
  tenantId: string;
  providerPostRef: string;
  providerPostUrl: string;
  verifiedAt: string;
}

export function isCanonicalFacebookPermalink(url: unknown, expectedPageId?: string, expectedPostRef?: string): url is string {
  if (typeof url !== 'string' || url.length < 16 || url.length > 512) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      (parsed.hostname !== 'www.facebook.com' && parsed.hostname !== 'facebook.com') ||
      parsed.username ||
      parsed.password || parsed.port || parsed.search || parsed.hash
    ) {
      return false;
    }
    const path = /^\/([0-9]+)\/posts\/([0-9]+)\/?$/.exec(parsed.pathname);
    return !!path &&
      (!expectedPageId || path[1] === expectedPageId) &&
      (!expectedPostRef || expectedPostRef === `${path[1]}_${path[2]}`);
  } catch {
    return false;
  }
}

export class VerifiedFacebookPermalinkStore {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  recordVerifiedPermalink(input: {
    tenantId: string;
    pageId: string;
    providerPostRef: string;
    providerPostUrl: string;
  }): void {
    if (!isCanonicalFacebookPermalink(input.providerPostUrl, input.pageId, input.providerPostRef)) {
      return;
    }
    const id = `${input.tenantId}:${input.providerPostRef}`;
    const record: StoredVerifiedPermalinkRecord = {
      id,
      tenantId: input.tenantId,
      providerPostRef: input.providerPostRef,
      providerPostUrl: input.providerPostUrl,
      verifiedAt: new Date().toISOString(),
    };
    this.store.put(VERIFIED_PERMALINK_COLLECTION, record, input.tenantId);
  }

  getVerifiedPermalink(tenantId: string, providerPostRef: string): string | undefined {
    const record = this.store.get(
      VERIFIED_PERMALINK_COLLECTION,
      `${tenantId}:${providerPostRef}`,
    ) as StoredVerifiedPermalinkRecord | undefined;
    if (!record || record.tenantId !== tenantId || record.providerPostRef !== providerPostRef || !isCanonicalFacebookPermalink(record.providerPostUrl, undefined, providerPostRef)) {
      return undefined;
    }
    return record.providerPostUrl;
  }

  attachVerifiedPermalink(job: FacebookMcpJob): FacebookMcpJob {
    if (job.state !== 'PUBLISHED' || !job.providerPostRef) {
      const { providerPostUrl: _dropped, ...safeJob } = job;
      return safeJob;
    }
    const verifiedUrl = this.getVerifiedPermalink(job.tenantId, job.providerPostRef);
    if (!verifiedUrl) {
      const { providerPostUrl: _dropped, ...safeJob } = job;
      return safeJob;
    }
    return {
      ...job,
      providerPostUrl: verifiedUrl,
    };
  }
}

export function projectVerifiedFacebookPilotReceipt(
  receipt: unknown,
  mediaKind: 'IMAGE' | 'VIDEO' | null = null,
  expectedPageId?: string,
): FacebookPublishProviderResult {
  const projected = translateFacebookPilotAdapterReceipt(receipt, mediaKind);
  const rawUrl = (receipt as { providerPostUrl?: unknown } | null)?.providerPostUrl;
  if (
    projected.state === 'PUBLISHED' &&
    isCanonicalFacebookPermalink(rawUrl, expectedPageId, projected.providerPostId)
  ) {
    return {
      ...projected,
      providerPostUrl: rawUrl,
    };
  }
  if (projected.state === 'PUBLISHED') {
    const { providerPostUrl: _dropped, ...rest } = projected;
    return rest;
  }
  return projected;
}
