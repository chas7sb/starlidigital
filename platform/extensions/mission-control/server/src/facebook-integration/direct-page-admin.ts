import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { Store } from '../store.js';
import {
  FacebookDirectPageCredentialStore,
  DIRECT_PAGE_CREDENTIAL_COLLECTION,
} from './openai-image-generation-integration.js';

export interface GraphPageVerificationResult {
  verified: boolean;
  pageId: string;
  pageName: string;
  tasks: string[];
  isPublished?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface OnboardDirectPageOptions {
  store: Store;
  credentialKey: string | Buffer;
  tenantId: string;
  userId?: string;
  pageId: string;
  pageToken: string;
  pageName?: string;
  pilotLabel?: string;
  connectionId?: string;
  tasks?: string[];
  scopes?: string[];
  expiresAt?: string;
  verifyGraph?: boolean;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
}

export interface DirectPageHealthResult {
  connectionId: string;
  tenantId: string;
  userId: string;
  pageId: string;
  pageName: string;
  status: 'CONNECTED' | 'REVOKED' | 'EXPIRED';
  revision: string;
  tasks: string[];
  scopes: string[];
  expiresAt: string;
  tokenFingerprint: string;
  decryptionHealthy: boolean;
  graphHealthy?: boolean;
  graphError?: string;
}

export function sanitizeToken(raw: string): string {
  const token = raw.trim();
  if (!token || token.length < 12 || /[\s\r\n]/.test(token)) {
    throw new Error('DIRECT_PAGE_TOKEN_INVALID');
  }
  return token;
}

export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12) + '...';
}

function normalizeCredentialKey(rawKey: string | Buffer): Buffer {
  return typeof rawKey === 'string'
    ? (Buffer.from(rawKey, 'base64').length === 32
        ? Buffer.from(rawKey, 'base64')
        : createHash('sha256').update(rawKey).digest())
    : rawKey;
}

export async function verifyMetaGraphPage(
  pageId: string,
  pageToken: string,
  options: {
    graphVersion?: string;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<GraphPageVerificationResult> {
  const version = options.graphVersion ?? 'v21.0';
  const fetcher = options.fetchImpl ?? globalThis.fetch;
  const url = `https://graph.facebook.com/${version}/${pageId}?fields=id,name,tasks,is_published&access_token=${encodeURIComponent(pageToken)}`;

  try {
    const res = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok || data.error) {
      const err = (data.error as Record<string, unknown>) || {};
      return {
        verified: false,
        pageId,
        pageName: '',
        tasks: [],
        errorCode: String(err.code ?? res.status),
        errorMessage: String(err.message ?? 'Graph API request failed'),
      };
    }

    const returnedId = String(data.id ?? '');
    const pageName = String(data.name ?? '');
    const tasks = Array.isArray(data.tasks) ? data.tasks.map(String) : [];
    const isPublished = Boolean(data.is_published ?? true);

    if (returnedId !== pageId) {
      return {
        verified: false,
        pageId,
        pageName,
        tasks,
        errorCode: 'PAGE_ID_MISMATCH',
        errorMessage: `Graph returned ID ${returnedId} does not match requested Page ID ${pageId}`,
      };
    }

    const hasCreateContent = tasks.includes('CREATE_CONTENT') || tasks.includes('PROFILE_PLUS_CREATE_CONTENT') || tasks.includes('MANAGE');
    if (!hasCreateContent) {
      return {
        verified: false,
        pageId,
        pageName,
        tasks,
        errorCode: 'CREATE_CONTENT_TASK_MISSING',
        errorMessage: 'Page access token lacks CREATE_CONTENT or MANAGE task permission',
      };
    }

    return {
      verified: true,
      pageId: returnedId,
      pageName,
      tasks,
      isPublished,
    };
  } catch (error: unknown) {
    return {
      verified: false,
      pageId,
      pageName: '',
      tasks: [],
      errorCode: 'NETWORK_ERROR',
      errorMessage: error instanceof Error ? error.message : 'Failed to reach Meta Graph API',
    };
  }
}

export function readTokenFromProtectedFile(filePath: string): string {
  const stat = statSync(filePath);
  if ((stat.mode & 0o077) !== 0) {
    throw new Error('TOKEN_FILE_PERMISSIONS_INSECURE: token file must have mode 0600 (not group or world readable)');
  }
  return sanitizeToken(readFileSync(filePath, 'utf8'));
}

export async function onboardDirectPageCredential(
  options: OnboardDirectPageOptions
): Promise<DirectPageHealthResult> {
  const token = sanitizeToken(options.pageToken);
  const userId = options.userId ?? options.tenantId;

  // 1. Ensure user exists in Store as ordinary USER
  try {
    const existingUser = options.store.db.prepare('SELECT payload FROM users WHERE id=?').get(userId);
    if (!existingUser) {
      options.store.saveUser({
        id: userId,
        username: userId,
        role: 'USER',
        disabled: false,
      });
    }
  } catch {
    // If users table is not initialized, proceed if Store handles it
  }

  // 2. Verify with Meta Graph API if requested
  let detectedPageName = options.pageName ?? 'Managed Facebook Page';
  let detectedTasks = options.tasks ?? ['CREATE_CONTENT', 'MANAGE'];

  if (options.verifyGraph) {
    const graphCheck = await verifyMetaGraphPage(options.pageId, token, {
      graphVersion: options.graphVersion,
      fetchImpl: options.fetchImpl,
    });

    if (!graphCheck.verified) {
      throw new Error(`GRAPH_VERIFICATION_FAILED: ${graphCheck.errorCode} - ${graphCheck.errorMessage}`);
    }

    detectedPageName = graphCheck.pageName || detectedPageName;
    detectedTasks = graphCheck.tasks.length > 0 ? graphCheck.tasks : detectedTasks;
  }

  // 3. Register encrypted credential in FacebookDirectPageCredentialStore
  const directStore = new FacebookDirectPageCredentialStore({
    store: options.store,
    credentialKey: options.credentialKey,
  });

  const existingPage = listDirectPagesForTenant(options.store, options.tenantId, userId)
    .find(page => page.pageId === options.pageId);
  const connectionId = options.connectionId ?? existingPage?.connectionId ?? `fb-direct-${createHash('sha256').update(JSON.stringify([options.tenantId, userId, options.pageId])).digest('hex')}`;

  const grant = directStore.registerDirectPageCredential({
    connectionId,
    tenantId: options.tenantId,
    userId,
    pageId: options.pageId,
    pageName: detectedPageName,
    pageToken: token,
    pilotLabel: options.pilotLabel,
    tasks: detectedTasks,
    scopes: options.scopes,
    expiresAt: options.expiresAt,
  });

  if (grant.status !== "CONNECTED") throw new Error("DIRECT_PAGE_REGISTRATION_INACTIVE");

  // 4. Bind as active selected page in facebook-page-selections
  const choiceId = 'fb-choice-' + createHash('sha256').update(options.tenantId + '\0' + userId).digest('hex');
  const selectionNonce = 'sel-' + randomBytes(16).toString('hex');
  const selectionRecord = {
    id: choiceId,
    tenantId: options.tenantId,
    userId,
    connectionId: grant.id,
    connectionRevision: grant.revision,
    pageId: options.pageId,
    pageName: detectedPageName,
    selectionNonce,
    updatedAt: new Date().toISOString(),
  };

  options.store.put('facebook-page-selections', selectionRecord, userId);

  return {
    connectionId: grant.id,
    tenantId: options.tenantId,
    userId,
    pageId: options.pageId,
    pageName: detectedPageName,
    status: grant.status,
    revision: grant.revision,
    tasks: [...detectedTasks],
    scopes: [...grant.scopes],
    expiresAt: options.expiresAt ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    tokenFingerprint: tokenFingerprint(token),
    decryptionHealthy: true,
    graphHealthy: options.verifyGraph ? true : undefined,
  };
}

export function checkDirectPageHealth(
  store: Store,
  credentialKey: string | Buffer,
  principal: { tenantId: string; userId: string },
  connectionId: string
): DirectPageHealthResult {
  const record = store.get(DIRECT_PAGE_CREDENTIAL_COLLECTION, connectionId) as
    | {
        id: string;
        tenantId: string;
        userId: string;
        pageId: string;
        pageName: string;
        tasks: string[];
        scopes: string[];
        status: 'CONNECTED' | 'REVOKED';
        revision: string;
        expiresAt: string;
        encryptedPageToken: { iv: string; tag: string; ciphertext: string };
      }
    | undefined;

  if (!record || record.tenantId !== principal.tenantId || record.userId !== principal.userId) {
    throw new Error('DIRECT_PAGE_CONNECTION_NOT_FOUND');
  }

  const isExpired = new Date(record.expiresAt).getTime() <= Date.now();
  const status: 'CONNECTED' | 'REVOKED' | 'EXPIRED' = isExpired
    ? 'EXPIRED'
    : record.status;

  let decryptionHealthy = false;
  let tokenFp = 'corrupted';

  if (record.status === 'CONNECTED' && !isExpired) {
    try {
      const key = normalizeCredentialKey(credentialKey);
      const aad = Buffer.from(
        `facebook-direct-page-v1|${record.tenantId}|${record.userId}|${record.id}|${record.pageId}|${record.revision}`,
        'utf8'
      );
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.encryptedPageToken.iv, 'base64'));
      decipher.setAAD(aad);
      decipher.setAuthTag(Buffer.from(record.encryptedPageToken.tag, 'base64'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(record.encryptedPageToken.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      if (plain && plain.length >= 12 && !/[\s\r\n]/.test(plain)) {
        decryptionHealthy = true;
        tokenFp = tokenFingerprint(plain);
      }
    } catch {
      decryptionHealthy = false;
      tokenFp = 'corrupted';
    }
  } else {
    decryptionHealthy = false;
    tokenFp = record.status === 'REVOKED' ? 'revoked' : 'expired';
  }

  return {
    connectionId: record.id,
    tenantId: record.tenantId,
    userId: record.userId,
    pageId: record.pageId,
    pageName: record.pageName,
    status,
    revision: record.revision,
    tasks: record.tasks,
    scopes: record.scopes,
    expiresAt: record.expiresAt,
    tokenFingerprint: tokenFp,
    decryptionHealthy,
  };
}

export function revokeDirectPageCredential(
  store: Store,
  credentialKey: string | Buffer,
  principal: { tenantId: string; userId: string },
  connectionId: string
): void {
  const directStore = new FacebookDirectPageCredentialStore({
    store,
    credentialKey,
  });
  directStore.revokeDirectPageCredential(principal, connectionId);
}

export function listDirectPagesForTenant(
  store: Store,
  tenantId: string,
  userId = tenantId
): DirectPageHealthResult[] {
  const rows = store.db
    .prepare('SELECT payload FROM records WHERE collection=? AND owner=?')
    .all(DIRECT_PAGE_CREDENTIAL_COLLECTION, userId) as Array<{ payload: string }>;

  return rows.map(r => JSON.parse(r.payload))
    .filter(record => record.tenantId === tenantId && record.userId === userId)
    .map(record => {
    const isExpired = new Date(record.expiresAt).getTime() <= Date.now();
    return {
      connectionId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      pageId: record.pageId,
      pageName: record.pageName,
      status: isExpired ? 'EXPIRED' : record.status,
      revision: record.revision,
      tasks: record.tasks,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      tokenFingerprint: 'encrypted-at-rest',
      decryptionHealthy: record.status === 'CONNECTED' && !isExpired,
    };
  });
}
