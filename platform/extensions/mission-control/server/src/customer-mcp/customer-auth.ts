/**
 * Customer-only OAuth trust boundary for the Facebook Pages MCP pilot.
 * Not an HTTP endpoint: the host must supply an authenticated, CSRF-checked
 * customer consent, a server-owned OAuth client registry, and TLS transport.
 * Never accept the administrative /oauth or /mcp tokens here.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Store } from '../store.js';
import { refresh, type Context } from '../security.js';

export const CUSTOMER_MCP_AUDIENCE = 'starli-customer-facebook-mcp' as const;
// A principal cannot be forged by JSON and is revalidated on EVERY tool/resource use.
const TRUSTED_PRINCIPALS = new WeakMap<object, () => boolean>();
const principalIsLive = (principal: unknown): boolean => {
  if (!principal || typeof principal !== 'object') return false;
  const check = TRUSTED_PRINCIPALS.get(principal);
  try { return !!check?.(); } catch { return false; }
};
const ACCESS_PREFIX = 'starli_customer_mcp_';
const REFRESH_PREFIX = 'starli_customer_refresh_';
const CODE_PREFIX = 'starli_customer_code_';
const AUTH_CODES = 'customer-facebook-mcp-auth-codes';
const ACCESS_TOKENS = 'customer-facebook-mcp-access-tokens';
const REFRESH_TOKENS = 'customer-facebook-mcp-refresh-tokens';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const createSecret = (prefix: string) => prefix + randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const CUSTOMER_FACEBOOK_SCOPES = [
  'facebook.pages.read',
  'facebook.pages.publish',
  'facebook.media.write',
  'facebook.social_loop.read',
  'facebook.social_loop.manage',
  'facebook.image.generate',
  'instagram.read',
  'instagram.publish'
] as const;
export type CustomerFacebookScope = typeof CUSTOMER_FACEBOOK_SCOPES[number];
const ALLOWED_SCOPES = new Set<string>(CUSTOMER_FACEBOOK_SCOPES);

/** Tool names are an explicit pilot allowlist, not admin/operator MCP tools. */
export const CUSTOMER_FACEBOOK_TOOL_SCOPES = {
  // Exact LCG10 daaa624 customer MCP contract; no admin or unconstrained tools.
  facebook_pages_publish_now: 'facebook.pages.publish',
  instagram_submit: 'instagram.publish',
  instagram_status: 'instagram.read',
  instagram_cancel: 'instagram.publish',
  facebook_reel_render_spec: 'facebook.pages.publish',
  facebook_reel_render_status: 'facebook.pages.read',
  facebook_reel_render: 'facebook.pages.publish',
  facebook_reel_submit: 'facebook.pages.publish',
  facebook_reel_status: 'facebook.pages.read',
  facebook_reel_cancel: 'facebook.pages.publish',
  facebook_pages_schedule: 'facebook.pages.publish',
  facebook_pages_list: 'facebook.pages.read',
  facebook_pages_cancel: 'facebook.pages.publish',
  facebook_pages_list_managed: 'facebook.pages.read',
  facebook_pages_select: 'facebook.pages.read',
  facebook_pages_current: 'facebook.pages.read',
  facebook_pages_clear: 'facebook.pages.read',
  facebook_media_upload: 'facebook.media.write',
  generate_image: 'facebook.image.generate',
  social_loop_prepare: 'facebook.social_loop.manage',
  social_loop_create: 'facebook.social_loop.manage',
  social_loop_list: 'facebook.social_loop.read',
  social_loop_get: 'facebook.social_loop.read',
  social_loop_pause: 'facebook.social_loop.manage',
  social_loop_resume: 'facebook.social_loop.manage',
  social_loop_update: 'facebook.social_loop.manage',
  social_loop_cancel: 'facebook.social_loop.manage',
  social_loop_history: 'facebook.social_loop.read'
} as const satisfies Record<string, CustomerFacebookScope>;
export type CustomerFacebookTool = keyof typeof CUSTOMER_FACEBOOK_TOOL_SCOPES;

export type TrustedCustomerMcpOAuthClient = {
  clientId: string;
  redirectUris: readonly string[];
  enabled: boolean;
};
export type CustomerMcpPrincipal = Readonly<{
  subjectId: string;
  tenantId: string;
  ownerId: string;
  clientId: string;
  audience: typeof CUSTOMER_MCP_AUDIENCE;
  scopes: readonly CustomerFacebookScope[];
  accessTokenId: string;
  expiresAt: number;
  source: 'CUSTOMER_MCP';
}>;
export type CustomerMcpTokenResponse = Readonly<{
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}>;

type CodeRecord = {
  id: string; ownerId: string; tenantId: string; userId: string; audience: string;
  clientId: string; redirectUri: string; codeChallenge: string;
  scopes: CustomerFacebookScope[]; expiresAt: number;
};
type TokenRecord = {
  id: string; ownerId: string; tenantId: string; userId: string;
  audience: string; clientId: string; familyId: string;
  scopes: CustomerFacebookScope[]; expiresAt: number;
  revokedAt?: number; usedAt?: number;
};

export class CustomerMcpAuthError extends Error {
  constructor(readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_REQUEST' | 'INVALID_GRANT', message: string) {
    super(message);
    this.name = 'CustomerMcpAuthError';
  }
}
const deny = (code: CustomerMcpAuthError['code'], message: string): never => {
  throw new CustomerMcpAuthError(code, message);
};
const parseScopes = (requested: readonly string[]): CustomerFacebookScope[] => {
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > CUSTOMER_FACEBOOK_SCOPES.length ||
      new Set(requested).size !== requested.length || requested.some(scope => typeof scope !== 'string' || !ALLOWED_SCOPES.has(scope))) {
    return deny('INVALID_REQUEST', 'Unsupported customer MCP scope');
  }
  return [...requested] as CustomerFacebookScope[];
};

const cleanRedirect = (uri: string): string => {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || parsed.toString() !== uri)
      return deny('INVALID_REQUEST', 'Untrusted customer OAuth redirect');
    return uri;
  } catch { return deny('INVALID_REQUEST', 'Invalid customer OAuth redirect'); }
};
const tokenPattern = (prefix: string) => new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`);

/** The registry is injected from trusted server config, never a customer request. */
export class CustomerFacebookMcpAuth {
  constructor(
    private readonly store: Store,
    private readonly registeredClients: readonly TrustedCustomerMcpOAuthClient[],
    private readonly clock: () => number = () => Date.now()
  ) {}

  private client(clientId: string, redirectUri?: string) {
    const record = this.registeredClients.find(c => c.clientId === clientId && c.enabled === true);
    if (!record || !record.clientId || record.redirectUris.length === 0) return deny('INVALID_REQUEST', 'Unregistered OAuth client');
    if (redirectUri !== undefined) {
      const clean = cleanRedirect(redirectUri);
      const isExact = record.redirectUris.includes(clean);
      const isChatGptConnector = (record.clientId === 'chatgpt' || record.clientId === 'starlidigital-customer-pilot') &&
        (clean.startsWith('https://chatgpt.com/connector/oauth/') || clean.startsWith('https://chat.openai.com/connector/oauth/'));
      if (!isExact && !isChatGptConnector) {
        return deny('INVALID_REQUEST', 'OAuth redirect not registered');
      }
    }
    return record;
  }

  private customer(userId: string) {
    const user = this.store.user(userId);
    if (!user || user.disabled || user.role !== 'USER' || user.id !== userId)
      return deny('FORBIDDEN', 'Customer account is unavailable');
    return user;
  }

  /** Invoked ONLY after login-cookie validation, consent click and POST CSRF check in the future HTTP adapter. */
  authorizeCustomerConnection(ctx: Context, request: {
    clientId: string; redirectUri: string; codeChallenge: string; codeChallengeMethod: 'S256';
    scopes: readonly string[]; consentConfirmed: boolean;
  }): string {
    if (ctx.store !== this.store || ctx.operatorTokenId || !ctx.sessionHash)
      return deny('UNAUTHENTICATED', 'Customer login session required');
    refresh(ctx);
    if (!ctx.user) return deny('UNAUTHENTICATED', 'Customer login session required');
    const session = this.store.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?')
      .get(ctx.sessionHash, this.clock()) as {user_id?: string} | undefined;
    if (!session || session.user_id !== ctx.user.id)
      return deny('UNAUTHENTICATED', 'Customer login expired');
    this.customer(ctx.user.id);
    if (request.consentConfirmed !== true) return deny('FORBIDDEN', 'Customer consent required');
    this.client(request.clientId, request.redirectUri);
    if (request.codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(request.codeChallenge))
      return deny('INVALID_REQUEST', 'S256 PKCE required');
    const scopes = parseScopes(request.scopes);
    const code = createSecret(CODE_PREFIX);
    const record: CodeRecord = {
      id: sha(code), ownerId: ctx.user.id, tenantId: ctx.user.id, userId: ctx.user.id,
      audience: CUSTOMER_MCP_AUDIENCE, clientId: request.clientId, redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge, scopes, expiresAt: this.clock() + 5 * 60_000
    };
    this.store.put(AUTH_CODES, record, record.ownerId);
    return code;
  }

  private mint(userId: string, clientId: string, scopes: CustomerFacebookScope[], familyId: string): CustomerMcpTokenResponse {
    const now = this.clock();
    const access = createSecret(ACCESS_PREFIX), renewal = createSecret(REFRESH_PREFIX);
    const shared = {ownerId: userId, tenantId: userId, userId, audience: CUSTOMER_MCP_AUDIENCE, clientId, familyId, scopes};
    this.store.put(ACCESS_TOKENS, {...shared, id: sha(access), expiresAt: now + 15 * 60_000}, userId);
    this.store.put(REFRESH_TOKENS, {...shared, id: sha(renewal), expiresAt: now + 30 * 86_400_000}, userId);
    return {access_token: access, refresh_token: renewal, token_type: 'Bearer', expires_in: 900, scope: scopes.join(' ')};
  }

  /** Atomic single-use authorization code + PKCE exchange. */
  exchangeCode(input: {clientId: string; redirectUri: string; code: string; codeVerifier: string}): CustomerMcpTokenResponse {
    this.client(input.clientId, input.redirectUri);
    if (!tokenPattern(CODE_PREFIX).test(input.code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier))
      return deny('INVALID_GRANT', 'Invalid authorization code');
    const challenge = createHash('sha256').update(input.codeVerifier).digest('base64url');
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const record = this.store.get(AUTH_CODES, sha(input.code)) as CodeRecord | undefined;
      if (!record || record.id !== sha(input.code) || record.expiresAt <= this.clock() ||
          record.audience !== CUSTOMER_MCP_AUDIENCE || record.clientId !== input.clientId ||
          record.redirectUri !== input.redirectUri || !equal(record.codeChallenge, challenge) ||
          record.ownerId !== record.userId || record.tenantId !== record.userId)
        return this.rollbackDeny('INVALID_GRANT', 'Invalid authorization grant');
      this.customer(record.userId);
      const scopes = parseScopes(record.scopes);
      this.store.remove(AUTH_CODES, record.id);
      const result = this.mint(record.userId, record.clientId, scopes, createSecret('family_'));
      this.store.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.store.db.isTransaction) this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  private rollbackDeny(code: CustomerMcpAuthError['code'], message: string): never {
    this.store.db.exec('ROLLBACK');
    return deny(code, message);
  }

  /** Refresh token reuse invalidates the entire family, not just the old token. */
  refreshToken(input: {clientId: string; refreshToken: string}): CustomerMcpTokenResponse {
    this.client(input.clientId);
    if (!tokenPattern(REFRESH_PREFIX).test(input.refreshToken)) return deny('INVALID_GRANT', 'Invalid refresh token');
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const record = this.store.get(REFRESH_TOKENS, sha(input.refreshToken)) as TokenRecord | undefined;
      if (!record || record.audience !== CUSTOMER_MCP_AUDIENCE || record.clientId !== input.clientId ||
          record.ownerId !== record.userId || record.tenantId !== record.userId || record.expiresAt <= this.clock() || record.revokedAt)
        return this.rollbackDeny('INVALID_GRANT', 'Invalid refresh token');
      this.customer(record.userId);
      const physical = this.store.db.prepare('SELECT owner FROM records WHERE collection=? AND id=?')
        .get(REFRESH_TOKENS, record.id) as {owner?: string} | undefined;
      if (physical?.owner !== record.userId) return this.rollbackDeny('INVALID_GRANT', 'Invalid refresh token owner');
      if (record.usedAt !== undefined) {
        this.revokeFamily(record.familyId, record.userId);
        this.store.db.exec('COMMIT');
        return deny('INVALID_GRANT', 'Refresh token reuse detected');
      }
      this.store.put(REFRESH_TOKENS, {...record, usedAt: this.clock()}, record.ownerId);
      const result = this.mint(record.userId, record.clientId, parseScopes(record.scopes), record.familyId);
      this.store.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.store.db.isTransaction) this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  private revokeFamily(familyId: string, ownerId: string) {
    for (const collection of [ACCESS_TOKENS, REFRESH_TOKENS]) {
      for (const token of this.store.list(collection, ownerId) as TokenRecord[]) {
        if (token.familyId === familyId && !token.revokedAt)
          this.store.put(collection, {...token, revokedAt: this.clock()}, ownerId);
      }
    }
  }

  /** Customer disconnection revokes access/refresh independently of Facebook Page OAuth. */
  revokeCustomerConnection(principal: CustomerMcpPrincipal): void {
    if (!principal || !principalIsLive(principal)) return deny('UNAUTHENTICATED', 'Verified customer MCP principal required');
    const active = this.verifyRecord(principal.accessTokenId);
    if (!active || active.userId !== principal.subjectId || active.clientId !== principal.clientId)
      return deny('UNAUTHENTICATED', 'Customer connection no longer valid');
    this.store.db.exec('BEGIN IMMEDIATE');
    try { this.revokeFamily(active.familyId, active.userId); this.store.db.exec('COMMIT'); }
    catch (error) { if (this.store.db.isTransaction) this.store.db.exec('ROLLBACK'); throw error; }
  }

  private verifyRecord(id: string): TokenRecord | null {
    const record = this.store.get(ACCESS_TOKENS, id) as TokenRecord | undefined;
    if (!record || record.id !== id || record.audience !== CUSTOMER_MCP_AUDIENCE ||
        record.revokedAt || record.expiresAt <= this.clock() ||
        record.ownerId !== record.userId || record.tenantId !== record.userId ||
        !Array.isArray(record.scopes) || record.scopes.length < 1 || record.scopes.some(s => !ALLOWED_SCOPES.has(s))) return null;
    const row = this.store.db.prepare('SELECT owner FROM records WHERE collection=? AND id=?').get(ACCESS_TOKENS,id) as {owner?:string}|undefined;
    if (row?.owner !== record.userId) return null;
    return record;
  }

  /** Only a distinct customer Bearer token authorizes this MCP, never cookies/admin/op tokens. */
  authenticateBearer(header: unknown): CustomerMcpPrincipal {
    if (typeof header !== 'string' || header.length > 240 || !/^Bearer [^\s]+$/.test(header))
      return deny('UNAUTHENTICATED', 'Customer MCP Bearer token required');
    const raw = header.slice('Bearer '.length);
    if (!tokenPattern(ACCESS_PREFIX).test(raw))
      return deny('UNAUTHENTICATED', 'Not a customer MCP token');
    const record = this.verifyRecord(sha(raw));
    if (!record) return deny('UNAUTHENTICATED', 'Customer MCP token expired or revoked');
    const client = this.registeredClients.find(c => c.clientId === record.clientId && c.enabled && c.redirectUris.length > 0);
    if (!client) return deny('UNAUTHENTICATED', 'Customer connector is unavailable');
    this.customer(record.userId);
    const principal = Object.freeze({
      subjectId: record.userId, tenantId: record.tenantId, ownerId: record.ownerId,
      clientId: record.clientId, audience: CUSTOMER_MCP_AUDIENCE,
      scopes: Object.freeze([...record.scopes]), accessTokenId: record.id,
      expiresAt: record.expiresAt, source: 'CUSTOMER_MCP' as const
    });
    TRUSTED_PRINCIPALS.set(principal, () => {
      const current = this.verifyRecord(record.id);
      return !!current && current.userId === principal.subjectId &&
        !!this.registeredClients.find(c => c.clientId === current.clientId && c.enabled) &&
        !!this.customer(current.userId);
    });
    return principal;
  }
}

/** Reject all admin/MCP/unknown tool families BEFORE discovery or invocation. */
export function assertCustomerFacebookTool(principal: CustomerMcpPrincipal, tool: string): CustomerFacebookScope {
  if (!principal || !principalIsLive(principal) || principal.source !== 'CUSTOMER_MCP' || principal.audience !== CUSTOMER_MCP_AUDIENCE ||
      !principal.tenantId || principal.tenantId !== principal.subjectId || principal.ownerId !== principal.subjectId)
    return deny('UNAUTHENTICATED', 'Verified customer MCP principal required');
  if (!Object.prototype.hasOwnProperty.call(CUSTOMER_FACEBOOK_TOOL_SCOPES, tool))
    return deny('FORBIDDEN', 'Customer tool is unavailable');
  const required = CUSTOMER_FACEBOOK_TOOL_SCOPES[tool as CustomerFacebookTool];
  if (!principal.scopes.includes(required)) return deny('FORBIDDEN', 'Customer scope unavailable');
  return required;
}

/** Require explicit owner/tenant equality for stored Page, media, job and receipt records. */
export function assertOwnedCustomerFacebookResource(principal: CustomerMcpPrincipal, resource: unknown): void {
  if (!principal || !principalIsLive(principal) || principal.source !== 'CUSTOMER_MCP' || principal.audience !== CUSTOMER_MCP_AUDIENCE ||
      !resource || typeof resource !== 'object')
    return deny('FORBIDDEN', 'Customer resource unavailable');
  const record = resource as {ownerId?:unknown;tenantId?:unknown};
  if (typeof record.ownerId !== 'string' || typeof record.tenantId !== 'string' ||
      !record.ownerId || record.ownerId !== principal.subjectId || record.tenantId !== principal.tenantId ||
      principal.ownerId !== principal.subjectId || principal.tenantId !== principal.subjectId)
    return deny('FORBIDDEN', 'Customer resource unavailable');
}

/** OAuth image generation permission is NOT approval to spend.
 * The host must resolve a currently active server-issued owner/tenant approval
 * (and separately enforce provider spend caps + idempotency) for each call.
 */
export function assertActiveCustomerImageGenerationApproval(resource: unknown): void {
  if (!resource || typeof resource !== 'object')
    return deny('FORBIDDEN','Server-owned image generation approval required');
  const approval = (resource as {generationApproval?:unknown}).generationApproval;
  if (!approval || typeof approval !== 'object')
    return deny('FORBIDDEN','Server-owned image generation approval required');
  const a = approval as {approved?:unknown;approvedAt?:unknown;expiresAt?:unknown;
    revokedAt?:unknown;maxImages?:unknown;maxCostUsdCents?:unknown};
  if (a.approved !== true || a.revokedAt !== undefined && a.revokedAt !== null ||
      typeof a.approvedAt !== 'number' || !Number.isSafeInteger(a.approvedAt) ||
      a.approvedAt < 1 || a.approvedAt > Date.now() ||
      typeof a.expiresAt !== 'number' || !Number.isSafeInteger(a.expiresAt) ||
      a.expiresAt <= Date.now() ||
      // Paid generation must have fresh explicit customer approval. OAuth
      // consent by itself never authorizes an indefinitely reusable charge.
      a.expiresAt - a.approvedAt > 15 * 60 * 1000 ||
      a.maxImages !== 1 ||
      typeof a.maxCostUsdCents !== 'number' || !Number.isSafeInteger(a.maxCostUsdCents) ||
      a.maxCostUsdCents < 1 || a.maxCostUsdCents > 1000)
    return deny('FORBIDDEN','Current bounded image generation approval unavailable');
}

/** Server-owned standing consent required to create/resume/update recurring posting.
 * This is additional to OAuth scope; tool JSON cannot supply this record.
 * The durable scheduler must independently recheck live consent and Page grants
 * before EACH due occurrence. Pausing/canceling must remain possible if revoked.
 */
export function assertActiveCustomerFacebookLoopConsent(record: unknown): void {
  if (!record || typeof record !== 'object')
    return deny('FORBIDDEN', 'Verified standing consent required');
  const consent = (record as {standingConsent?:unknown}).standingConsent;
  if (!consent || typeof consent !== 'object')
    return deny('FORBIDDEN', 'Verified standing consent required');
  const c = consent as {approved?:unknown;revokedAt?:unknown;timezone?:unknown;
    maxPostsPerLocalDay?:unknown;approvedAt?:unknown};
  if (c.approved !== true || (c.revokedAt !== undefined && c.revokedAt !== null) ||
      c.timezone !== 'Europe/Bucharest' || c.maxPostsPerLocalDay !== 1 ||
      typeof c.approvedAt !== 'number' || !Number.isSafeInteger(c.approvedAt) ||
      c.approvedAt < 1 || c.approvedAt > Date.now())
    return deny('FORBIDDEN', 'Current bounded standing consent unavailable');
}

/** The host MUST construct this from authenticateBearer(), never JSON params. */
export function customerMcpProtocolSession(principal: CustomerMcpPrincipal, requestId?: string) {
  if (!principal || !principalIsLive(principal) || principal.audience !== CUSTOMER_MCP_AUDIENCE || principal.source !== 'CUSTOMER_MCP' ||
      principal.ownerId !== principal.subjectId || principal.tenantId !== principal.subjectId)
    return deny('UNAUTHENTICATED', 'Verified customer session required');
  return Object.freeze({
    subjectId: principal.subjectId,
    tenantId: principal.tenantId,
    scopes: Object.freeze([...principal.scopes]),
    source: 'CUSTOMER_MCP' as const,
    autonomous: false as const,
    ...(requestId && /^[a-zA-Z0-9_.:-]{1,120}$/.test(requestId) ? {requestId} : {})
  });
}

/** Discover only allowlisted tools with a current live customer session and consent scope. */
export function listCustomerFacebookTools(
  principal: CustomerMcpPrincipal,
  registeredTools: readonly CustomerFacebookTool[] = [
    'facebook_pages_publish_now','facebook_pages_schedule','facebook_pages_list','facebook_pages_cancel'
  ]
): readonly CustomerFacebookTool[] {
  if (!principalIsLive(principal) || principal.audience !== CUSTOMER_MCP_AUDIENCE)
    return deny('UNAUTHENTICATED', 'Verified customer MCP principal required');
  // A caller cannot discover a newly approved tool until the host actually registers it.
  // Unspecified registries preserve the original four-tool contract by default.
  const registered=new Set<string>(registeredTools);
  return Object.freeze((Object.keys(CUSTOMER_FACEBOOK_TOOL_SCOPES) as CustomerFacebookTool[])
    .filter(tool => registered.has(tool) && principal.scopes.includes(CUSTOMER_FACEBOOK_TOOL_SCOPES[tool])));
}

/**
 * HTTP/tool owner integration point: execute this PER MCP request, never accept
 * tenant/owner/subject scopes from method params or a prior request's session.
 * loadStoredResource MUST read from server-owned persistent store using the
 * authenticated principal (not an object copied from untrusted toolArguments).
 * Page administration attestation must also be validated by LCG2/LCG3.
 */
export function authenticateFacebookCustomerToolCall(input: {
  auth: CustomerFacebookMcpAuth;
  authorization: unknown;
  toolName: string;
  loadStoredResource?: (principal: CustomerMcpPrincipal) => unknown;
  requestId?: string;
  toolArguments: unknown;
}) {
  assertNoCustomerFacebookIdentityOverrides(input.toolArguments);
  const principal = input.auth.authenticateBearer(input.authorization);
  const requiredScope = assertCustomerFacebookTool(principal, input.toolName);
  // Existing Page/job targets must be reloaded by the adapter from trusted tenant storage.
  // Missing target is not permission to skip owner verification.
  const targetTools = new Set<string>([
    'facebook_pages_publish_now', 'facebook_pages_schedule', 'facebook_pages_cancel',
    'facebook_pages_select', 'facebook_pages_clear',
    'social_loop_create', 'social_loop_get', 'social_loop_pause',
    'social_loop_resume', 'social_loop_update', 'social_loop_cancel',
    'social_loop_history', 'generate_image'
  ]);
  // Upload BEGIN creates a fresh owned session; every later CHUNK/FINISH/CANCEL
  // must load its immutable tenant-bound session from trusted storage.
  if (input.toolName === 'facebook_media_upload') {
    const args = input.toolArguments as {action?:unknown} | null;
    if (!args || typeof args !== 'object' || !['BEGIN','CHUNK','FINISH','CANCEL'].includes(String(args.action)))
      return deny('INVALID_REQUEST','Invalid customer media upload action');
    if (args.action !== 'BEGIN') targetTools.add('facebook_media_upload');
  }
  if (targetTools.has(input.toolName) && typeof input.loadStoredResource !== 'function')
    return deny('FORBIDDEN', 'Trusted server-side Page or job lookup required');
  if (input.loadStoredResource !== undefined) {
    const stored = input.loadStoredResource(principal);
    assertOwnedCustomerFacebookResource(principal, stored);
    // An OAuth grant permits management, but NEVER grants standing autonomous
    // posting consent. A host must resolve live, tenant-owned approval from
    // persistent storage for creating, resuming or changing an ongoing loop.
    if (['social_loop_create','social_loop_resume','social_loop_update'].includes(input.toolName))
      assertActiveCustomerFacebookLoopConsent(stored);
    if (input.toolName === 'generate_image')
      assertActiveCustomerImageGenerationApproval(stored);
  }
  return Object.freeze({
    principal,
    requiredScope,
    session: customerMcpProtocolSession(principal, input.requestId)
  });
}


/** Inspect untrusted JSON tool arguments; they are NEVER an authentication authority. */
export function assertNoCustomerFacebookIdentityOverrides(args: unknown): void {
  const forbidden = new Set([
    'ownerid','tenantid','workspaceid','subjectid','userid','role','scopes',
    'accesstoken','refreshtoken','pagetoken','credentialreference','operatortokenid',
    'audience','session','principal','apikey','clientsecret',
    'openaiapikey','providerapikey','xapikey','authorization','authorizationheader',
    'bearertoken','secretkey','providercredential',
    'standingconsent','consentapproved','consentgrantedat','consentrevokedat',
    'generationapproval','generationconsent','maxcostusdcents',
    '__proto__','prototype','constructor'
  ]);
  const walk = (value: unknown, depth: number): void => {
    if (depth > 8) return deny('INVALID_REQUEST', 'Customer tool arguments are too deeply nested');
    if (value === null || ['string','number','boolean'].includes(typeof value)) return;
    if (typeof value !== 'object') return deny('INVALID_REQUEST', 'Unsupported customer tool arguments');
    if (Array.isArray(value)) {
      if (value.length > 100) return deny('INVALID_REQUEST', 'Too many customer tool values');
      for (const entry of value) walk(entry, depth+1);
      return;
    }
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record);
    if (entries.length > 80) return deny('INVALID_REQUEST', 'Too many customer tool fields');
    for (const [key, entry] of entries) {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      // Treat dotted/bracketed strings as untrusted compound property names,
      // not only as a single key. A downstream parser could otherwise turn
      // `headers[Authorization]` or `generationApproval.approved` into authority.
      const segments = key.split(/[^a-z0-9]+/i).filter(Boolean)
        .map(segment => segment.toLowerCase());
      if (forbidden.has(normalized) || segments.some(segment => forbidden.has(segment)))
        return deny('FORBIDDEN', 'Customer identity or credential overrides are forbidden');
      walk(entry, depth+1);
    }
  };
  walk(args, 0);
}


/** Compatibility with the exact four-tool LCG10 customer MCP facade (daaa624).
 * This projection MUST be constructed only from the real authenticated principal.
 */
export function customerFacebookMcpToolContext(principal: CustomerMcpPrincipal) {
  if (!principalIsLive(principal) || principal.tenantId !== principal.subjectId)
    return deny('UNAUTHENTICATED', 'Verified customer MCP principal required');
  return Object.freeze({principal: Object.freeze({
    subjectId: principal.subjectId,
    tenantId: principal.tenantId,
    role: 'customer' as const,
    permissions: Object.freeze([...principal.scopes])
  })});
}
