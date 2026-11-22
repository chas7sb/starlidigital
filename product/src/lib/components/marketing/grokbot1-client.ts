/**
 * Typed Grokbot1 wire-contract client and owner-navigation adapter (Fixpass R1).
 * Strictly implements WIRE-CONTRACT-DECISION-R1.md:
 *   - POST /api/v1/starli/public/grokbot1/intents
 *   - GET  /api/v1/starli/public/grokbot1/intents/{intentId}
 *   - POST /api/v1/starli/public/grokbot1/provisional
 *   - GET  /api/v1/starli/public/grokbot1/progress/{intentId}
 *   - POST /api/v1/starli/public/grokbot1/claims
 *   - GET  /api/v1/starli/grokbot1/claims/{intentId}/navigation
 *   - POST /api/v1/starli/grokbot1/claims/{intentId}/resume
 */

export const GROKBOT1_ROUTES = Object.freeze({
  intents: '/api/v1/starli/public/grokbot1/intents',
  intentById: (intentId: string) => `/api/v1/starli/public/grokbot1/intents/${encodeURIComponent(intentId)}`,
  provisional: '/api/v1/starli/public/grokbot1/provisional',
  progress: (intentId: string) => `/api/v1/starli/public/grokbot1/progress/${encodeURIComponent(intentId)}`,
  claims: '/api/v1/starli/public/grokbot1/claims',
  ownerNavigation: (intentId: string) => `/api/v1/starli/grokbot1/claims/${encodeURIComponent(intentId)}/navigation`,
  ownerResume: (intentId: string) => `/api/v1/starli/grokbot1/claims/${encodeURIComponent(intentId)}/resume`,
  reauth: '/api/v1/starli/grokbot1/reauth',
});

const INTENT_ID_RE = /^[0-9a-f]{40}$/;
const SAFE_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const MAX_NAV_TTL_MS = 5 * 60 * 1000;

export interface GuestIntentV1 {
  schemaVersion: 1;
  intentId: string;
  requestId: string;
  idempotencyKey: string;
  originalPrompt: string;
  guestSessionBinding: string;
  status: 'PROPOSED';
  createdAt: string;
  expiresAt: string;
  observedAt: string;
  expectedRevision: number;
  httpStatus: 200 | 201;
}

export interface ProvisionalCompanyV1 {
  schemaVersion: 1;
  contract: 'PROVISIONAL_COMPANY_V1';
  state: 'RESTRICTED_PROVISIONAL_ACTIVE';
  intentId: string;
  companyId: string;
  provisionalProjectId: string;
  projectId: null;
  revision: number;
  expiresAt: string;
  principalKind: 'restricted_guest';
  nativeAuthorityActive: false;
  capabilities: string[];
}

export interface ClaimedNativeCompanyV1 {
  schemaVersion: 1;
  contract: 'CLAIMED_NATIVE_COMPANY_V1';
  state: 'CLAIM_COMMITTED' | 'CLAIM_PREPARED' | 'CLAIM_ABORTED';
  claimId: string;
  intentId: string;
  companyId: string;
  projectId: string | null;
  ownerUserId: string;
  principalKind: 'verified_registered_person';
  bossBotId: string;
  bossDmRoomId: string | null;
  channelRoomId: string | null; // Normalized from server doglovRoomId / channelRoomId at UI boundary
  originalPromptMessageId: string | null;
  originalPromptProvenance: 'system';
  revision: number;
  idempotencyKey: string;
}

export interface OwnerNavigationChecksV1 {
  ownerRole: boolean;
  bossBotMember: boolean;
  dmVisible: boolean;
  doglovVisible: boolean;
  bossInRooms: boolean;
  originalPromptOnce: boolean;
  projectReadable: boolean;
}

export interface NormalizedOwnerNavigationV1 {
  status: 'READY' | 'PENDING' | 'PENDING_FRESHNESS_RECEIPT' | 'ABORTED' | 'REVOKED' | 'DENIED';
  stage: string;
  intentId: string;
  companyId: string | null;
  projectId: string | null;
  channelRoomId: string | null; // Mapped from server roomId
  bossDmRoomId: string | null;  // Mapped from server dmRoomId
  bossBotId: string | null;
  claimRevision: number | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  nextAction: string | null;
  nextHref: string | null;
  originalPromptProvenance: 'system';
  missingPeerFields: string[];
  reason: string;
}

export interface Grokbot1ApiError {
  status: number;
  code: string;
  detail: Record<string, unknown>;
}

function parseErrorBody(status: number, body: unknown): Grokbot1ApiError {
  if (body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object') {
    const err = body.error as Record<string, unknown>;
    const code = typeof err.code === 'string' ? err.code : `HTTP_${status}`;
    return { status, code, detail: err };
  }
  return { status, code: `HTTP_${status}`, detail: {} };
}

export function validateProvisionalDto(raw: unknown, expectedIntentId: string): ProvisionalCompanyV1 {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Provisional response is not an object.');
  }
  const d = raw as Record<string, unknown>;
  if (
    d.schemaVersion !== 1 ||
    d.contract !== 'PROVISIONAL_COMPANY_V1' ||
    d.state !== 'RESTRICTED_PROVISIONAL_ACTIVE' ||
    d.intentId !== expectedIntentId ||
    typeof d.companyId !== 'string' ||
    !SAFE_ID_RE.test(d.companyId) ||
    typeof d.provisionalProjectId !== 'string' ||
    !SAFE_ID_RE.test(d.provisionalProjectId) ||
    d.projectId !== null ||
    typeof d.revision !== 'number' ||
    !Number.isInteger(d.revision) ||
    d.revision < 1 ||
    d.principalKind !== 'restricted_guest' ||
    d.nativeAuthorityActive !== false
  ) {
    throw new Error('Provisional company DTO failed strict schema validation.');
  }
  return {
    schemaVersion: 1,
    contract: 'PROVISIONAL_COMPANY_V1',
    state: 'RESTRICTED_PROVISIONAL_ACTIVE',
    intentId: d.intentId,
    companyId: d.companyId,
    provisionalProjectId: d.provisionalProjectId,
    projectId: null,
    revision: d.revision,
    expiresAt: typeof d.expiresAt === 'string' ? d.expiresAt : '',
    principalKind: 'restricted_guest',
    nativeAuthorityActive: false,
    capabilities: Array.isArray(d.capabilities) ? d.capabilities.filter((c): c is string => typeof c === 'string') : [],
  };
}

export function validateClaimedDto(raw: unknown, expectedIntentId: string): ClaimedNativeCompanyV1 {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Claim response is not an object.');
  }
  const d = raw as Record<string, unknown>;
  if (
    d.schemaVersion !== 1 ||
    d.contract !== 'CLAIMED_NATIVE_COMPANY_V1' ||
    d.intentId !== expectedIntentId ||
    typeof d.claimId !== 'string' ||
    typeof d.companyId !== 'string' ||
    !SAFE_ID_RE.test(d.companyId) ||
    typeof d.ownerUserId !== 'string' ||
    d.principalKind !== 'verified_registered_person' ||
    typeof d.bossBotId !== 'string' ||
    typeof d.revision !== 'number' ||
    !Number.isInteger(d.revision) ||
    d.revision < 1
  ) {
    throw new Error('Claimed native company DTO failed strict schema validation.');
  }
  const state = d.state;
  if (state !== 'CLAIM_COMMITTED' && state !== 'CLAIM_PREPARED' && state !== 'CLAIM_ABORTED') {
    throw new Error(`Unexpected claim state: ${String(state)}`);
  }
  // Normalize misspelled doglovRoomId at one boundary into channelRoomId
  const rawChannelRoom = typeof d.channelRoomId === 'string'
    ? d.channelRoomId
    : typeof d.doglovRoomId === 'string'
      ? d.doglovRoomId
      : null;

  return {
    schemaVersion: 1,
    contract: 'CLAIMED_NATIVE_COMPANY_V1',
    state,
    claimId: d.claimId,
    intentId: d.intentId,
    companyId: d.companyId,
    projectId: typeof d.projectId === 'string' ? d.projectId : null,
    ownerUserId: d.ownerUserId,
    principalKind: 'verified_registered_person',
    bossBotId: d.bossBotId,
    bossDmRoomId: typeof d.bossDmRoomId === 'string' ? d.bossDmRoomId : null,
    channelRoomId: rawChannelRoom,
    originalPromptMessageId: typeof d.originalPromptMessageId === 'string' ? d.originalPromptMessageId : null,
    originalPromptProvenance: 'system',
    revision: d.revision,
    idempotencyKey: typeof d.idempotencyKey === 'string' ? d.idempotencyKey : '',
  };
}

export function validateGrokbot1OwnerNavigation(
  raw: unknown,
  expected: {
    intentId: string;
    companyId?: string | null;
    minClaimRevision?: number;
    nowMs?: number;
  }
): NormalizedOwnerNavigationV1 {
  const baseFail = (
    status: NormalizedOwnerNavigationV1['status'],
    stage: string,
    reason: string,
    missingPeerFields: string[] = []
  ): NormalizedOwnerNavigationV1 => ({
    status,
    stage,
    intentId: expected.intentId,
    companyId: null,
    projectId: null,
    channelRoomId: null,
    bossDmRoomId: null,
    bossBotId: null,
    claimRevision: null,
    verifiedAt: null,
    expiresAt: null,
    nextAction: null,
    nextHref: null,
    originalPromptProvenance: 'system',
    missingPeerFields,
    reason,
  });

  if (!raw || typeof raw !== 'object') {
    return baseFail('DENIED', 'INVALID', 'Owner navigation response is not an object.');
  }
  const d = raw as Record<string, unknown>;
  if (d.schemaVersion !== 1 || d.contract !== 'VERIFIED_ROOM_NAVIGATION_V1') {
    return baseFail('DENIED', 'INVALID', 'Unexpected navigation contract or schemaVersion.');
  }
  if (d.intentId !== expected.intentId) {
    return baseFail('DENIED', String(d.stage || 'UNKNOWN'), 'Navigation receipt intentId does not match expected intent.');
  }
  if (typeof d.proof !== 'string' || !HEX64_RE.test(d.proof)) {
    return baseFail('DENIED', String(d.stage || 'UNKNOWN'), 'Navigation receipt is missing a valid server proof digest.');
  }

  const stage = typeof d.stage === 'string' ? d.stage : 'UNKNOWN';
  const nextObj = d.next && typeof d.next === 'object' ? (d.next as Record<string, unknown>) : {};
  const nextAction = typeof nextObj.action === 'string' ? nextObj.action : null;
  const nextHref = typeof nextObj.href === 'string' && nextObj.href.startsWith('/') && !nextObj.href.startsWith('//')
    ? nextObj.href
    : null;

  if (stage === 'CLAIM_ABORTED') {
    return baseFail('ABORTED', stage, 'Claim saga aborted; retry claim with fresh provisional revision.');
  }
  if (stage === 'EXPIRED_OR_REVOKED') {
    return baseFail('REVOKED', stage, 'Onboarding authority expired or revoked.');
  }
  if (stage === 'CLAIM_PENDING' || stage === 'CLAIM_COMMITTED_MATERIALIZING' || stage === 'RESTRICTED_PROVISIONAL_ACTIVE' || stage === 'INTENT_ACCEPTED') {
    return {
      ...baseFail('PENDING', stage, `Navigation is pending server stage ${stage}.`),
      companyId: typeof d.companyId === 'string' ? d.companyId : null,
      nextAction,
      nextHref,
    };
  }

  if (stage !== 'ROOM_READY') {
    return baseFail('DENIED', stage, `Unsupported navigation stage: ${stage}`);
  }

  if (d.verifiedBy !== 'native-store-readback' || nextAction !== 'open_room') {
    return baseFail('DENIED', stage, 'ROOM_READY must be verified by native-store-readback with next.action=open_room.');
  }

  const companyId = typeof d.companyId === 'string' && SAFE_ID_RE.test(d.companyId) ? d.companyId : null;
  const projectId = typeof d.projectId === 'string' && SAFE_ID_RE.test(d.projectId) ? d.projectId : null;
  const roomId = typeof d.roomId === 'string' && SAFE_ID_RE.test(d.roomId) ? d.roomId : null;
  const dmRoomId = typeof d.dmRoomId === 'string' && SAFE_ID_RE.test(d.dmRoomId) ? d.dmRoomId : null;
  const bossBotId = typeof d.bossBotId === 'string' && SAFE_ID_RE.test(d.bossBotId) ? d.bossBotId : null;

  if (!companyId || !projectId || !roomId || !dmRoomId || !bossBotId) {
    return baseFail('DENIED', stage, 'ROOM_READY is missing canonical company, project, room, DM, or BOSS bot ID.');
  }
  if (expected.companyId && companyId !== expected.companyId) {
    return baseFail('DENIED', stage, 'Navigation receipt companyId does not match expected company.');
  }

  // Typed server readback checks
  const checks = d.checks && typeof d.checks === 'object' ? (d.checks as Record<string, unknown>) : null;
  const requiredChecks: (keyof OwnerNavigationChecksV1)[] = [
    'ownerRole',
    'bossBotMember',
    'dmVisible',
    'doglovVisible',
    'bossInRooms',
    'originalPromptOnce',
    'projectReadable',
  ];
  if (!checks || requiredChecks.some((k) => checks[k] !== true)) {
    return baseFail('DENIED', stage, 'Server native-store-readback checks did not all pass.');
  }

  // WIRE-CONTRACT-DECISION-R1.md:
  // Require committed/current claimRevision, server verifiedAt, and bounded expiresAt.
  // Until these are present, keep navigation pending; NEVER fill them using browser time.
  const missingPeerFields: string[] = [];
  const claimRevision =
    typeof d.claimRevision === 'number' && Number.isInteger(d.claimRevision) && d.claimRevision >= 1
      ? d.claimRevision
      : null;
  if (claimRevision === null) missingPeerFields.push('claimRevision');

  const verifiedAt = typeof d.verifiedAt === 'string' && d.verifiedAt.trim() ? d.verifiedAt : null;
  if (verifiedAt === null) missingPeerFields.push('verifiedAt');

  const expiresAt = typeof d.expiresAt === 'string' && d.expiresAt.trim() ? d.expiresAt : null;
  if (expiresAt === null) missingPeerFields.push('expiresAt');

  if (missingPeerFields.length > 0) {
    return {
      status: 'PENDING_FRESHNESS_RECEIPT',
      stage,
      intentId: expected.intentId,
      companyId,
      projectId,
      channelRoomId: roomId,
      bossDmRoomId: dmRoomId,
      bossBotId,
      claimRevision,
      verifiedAt,
      expiresAt,
      nextAction,
      nextHref,
      originalPromptProvenance: 'system',
      missingPeerFields,
      reason: `Navigation held pending: Grokbot1 receipt is missing required freshness/revision field(s): ${missingPeerFields.join(', ')}.`,
    };
  }

  const nowMs = typeof expected.nowMs === 'number' && Number.isFinite(expected.nowMs) ? expected.nowMs : Date.now();
  const verMs = Date.parse(verifiedAt!);
  const expMs = Date.parse(expiresAt!);
  if (!Number.isFinite(verMs) || !Number.isFinite(expMs) || expMs <= verMs) {
    return baseFail('DENIED', stage, 'Navigation receipt verifiedAt/expiresAt timestamps are invalid.');
  }
  if (verMs > nowMs + 60_000) {
    return baseFail('DENIED', stage, 'Navigation receipt verifiedAt is in the future.');
  }
  if (expMs <= nowMs) {
    return baseFail('REVOKED', stage, 'Navigation receipt has expired; re-fetch required.');
  }
  if (expMs - verMs > MAX_NAV_TTL_MS) {
    return baseFail('DENIED', stage, 'Navigation receipt TTL exceeds maximum bounded window (300s).');
  }
  if (typeof expected.minClaimRevision === 'number' && claimRevision! < expected.minClaimRevision) {
    return baseFail('DENIED', stage, 'Navigation receipt claimRevision is stale.');
  }

  return {
    status: 'READY',
    stage,
    intentId: expected.intentId,
    companyId,
    projectId,
    channelRoomId: roomId,
    bossDmRoomId: dmRoomId,
    bossBotId,
    claimRevision,
    verifiedAt,
    expiresAt,
    nextAction,
    nextHref,
    originalPromptProvenance: 'system',
    missingPeerFields: [],
    reason: 'Server native-store-readback and bounded freshness verified.',
  };
}

export class Grokbot1JourneyClient {
  private readonly fetcher: typeof fetch;
  private readonly getBearerToken: () => string | null;

  constructor(opts: { fetcher?: typeof fetch; getBearerToken?: () => string | null } = {}) {
    this.fetcher = opts.fetcher ?? globalThis.fetch;
    this.getBearerToken = opts.getBearerToken ?? (() => null);
  }

  private async requestJson(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
    const response = await this.fetcher.call(globalThis, url, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  async submitIntent(requestId: string, originalPrompt: string): Promise<{ ok: true; data: GuestIntentV1 } | { ok: false; error: Grokbot1ApiError }> {
    const { status, body } = await this.requestJson(GROKBOT1_ROUTES.intents, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Starli-Guest-Intent': '1',
      },
      body: JSON.stringify({ requestId, originalPrompt }),
    });
    if (status !== 200 && status !== 201) {
      return { ok: false, error: parseErrorBody(status, body) };
    }
    const d = body as Record<string, unknown>;
    if (
      !d ||
      d.schemaVersion !== 1 ||
      typeof d.intentId !== 'string' ||
      !INTENT_ID_RE.test(d.intentId) ||
      d.requestId !== requestId ||
      d.idempotencyKey !== requestId ||
      d.originalPrompt !== originalPrompt ||
      d.status !== 'PROPOSED'
    ) {
      return { ok: false, error: { status: 502, code: 'INVALID_INTENT_RECEIPT', detail: {} } };
    }
    return {
      ok: true,
      data: {
        schemaVersion: 1,
        intentId: d.intentId,
        requestId,
        idempotencyKey: requestId,
        originalPrompt,
        guestSessionBinding: String(d.guestSessionBinding || ''),
        status: 'PROPOSED',
        createdAt: String(d.createdAt || ''),
        expiresAt: String(d.expiresAt || ''),
        observedAt: String(d.observedAt || ''),
        expectedRevision: typeof d.expectedRevision === 'number' ? d.expectedRevision : 0,
        httpStatus: status as 200 | 201,
      },
    };
  }

  async bootstrapProvisional(intentId: string): Promise<{ ok: true; data: ProvisionalCompanyV1 } | { ok: false; error: Grokbot1ApiError }> {
    const { status, body } = await this.requestJson(GROKBOT1_ROUTES.provisional, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Starli-Guest-Intent': '1',
      },
      body: JSON.stringify({ intentId }),
    });
    if (status !== 200 && status !== 201) {
      return { ok: false, error: parseErrorBody(status, body) };
    }
    try {
      return { ok: true, data: validateProvisionalDto(body, intentId) };
    } catch (e) {
      return { ok: false, error: { status: 502, code: 'INVALID_PROVISIONAL_DTO', detail: { message: (e as Error).message } } };
    }
  }

  async readGuestProgress(intentId: string): Promise<{ ok: true; stage: string; raw: Record<string, unknown> } | { ok: false; error: Grokbot1ApiError }> {
    const { status, body } = await this.requestJson(GROKBOT1_ROUTES.progress(intentId), {
      method: 'GET',
    });
    if (status !== 200 || !body || typeof body !== 'object') {
      return { ok: false, error: parseErrorBody(status, body) };
    }
    const d = body as Record<string, unknown>;
    return { ok: true, stage: String(d.stage || 'UNKNOWN'), raw: d };
  }

  async reauthenticate(password: string): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: Grokbot1ApiError }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Starli-Claim': '1',
    };
    const token = this.getBearerToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const { status, body } = await this.requestJson(GROKBOT1_ROUTES.reauth, {
      method: 'POST',
      headers,
      body: JSON.stringify({ password }),
    });
    if (status !== 200) return { ok: false, error: parseErrorBody(status, body) };
    return { ok: true, data: (body && typeof body === 'object' ? (body as Record<string, unknown>) : {}) };
  }

  async claimProvisional(
    intentId: string,
    expectedProvisionalRevision: number,
    idempotencyKey: string
  ): Promise<{ ok: true; data: ClaimedNativeCompanyV1 } | { ok: false; error: Grokbot1ApiError }> {
    if (!Number.isInteger(expectedProvisionalRevision) || expectedProvisionalRevision < 1) {
      return {
        ok: false,
        error: { status: 400, code: 'PROVISIONAL_REVISION_REQUIRED', detail: { expectedProvisionalRevision } },
      };
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Starli-Claim': '1',
      'Idempotency-Key': idempotencyKey,
    };
    const token = this.getBearerToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const { status, body } = await this.requestJson(GROKBOT1_ROUTES.claims, {
      method: 'POST',
      headers,
      body: JSON.stringify({ intentId, expectedRevision: expectedProvisionalRevision }),
    });
    if (status !== 200 && status !== 201) {
      return { ok: false, error: parseErrorBody(status, body) };
    }
    try {
      return { ok: true, data: validateClaimedDto(body, intentId) };
    } catch (e) {
      return { ok: false, error: { status: 502, code: 'INVALID_CLAIM_DTO', detail: { message: (e as Error).message } } };
    }
  }

  async fetchOwnerNavigation(
    intentId: string,
    expected: { companyId?: string | null; minClaimRevision?: number; nowMs?: number } = {}
  ): Promise<{ ok: true; data: NormalizedOwnerNavigationV1 } | { ok: false; error: Grokbot1ApiError }> {
    const headers: Record<string, string> = {};
    const token = this.getBearerToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const { status, body } = await this.requestJson(GROKBOT1_ROUTES.ownerNavigation(intentId), {
      method: 'GET',
      headers,
    });
    if (status !== 200) {
      return { ok: false, error: parseErrorBody(status, body) };
    }
    return {
      ok: true,
      data: validateGrokbot1OwnerNavigation(body, {
        intentId,
        companyId: expected.companyId,
        minClaimRevision: expected.minClaimRevision,
        nowMs: expected.nowMs,
      }),
    };
  }
}
