import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual,
} from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store } from '../store.js';
import { refresh, type Context } from '../security.js';

/**
 * Customer-owned Facebook Login / Pages authorization boundary.
 * This is NOT StarliDigital's admin MCP OAuth server and NEVER publishes posts.
 * Never pass credentials returned by getServerSideFacebookAccessToken to a browser or MCP client.
 */
const STATES = 'facebook-pages-oauth-states';
const ACCOUNTS = 'facebook-pages-user-credentials';
const EPOCHS = 'facebook-pages-oauth-epochs';
const AUDIT = 'facebook-pages-oauth-audit';
const STATE_TTL_MS = 10 * 60_000;
export const FACEBOOK_PAGES_REQUIRED_SCOPES = [
  'pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
] as const;

export type FacebookConnectionState =
  'AUTHORIZED_PENDING_PAGE_SELECTION' | 'REAUTH_REQUIRED' | 'DISCONNECTED';

export interface FacebookOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  credentialKey: string; // exactly 32 bytes, base64-encoded
  graphVersion?: string;
  loginConfigId?: string; // optional Facebook Login for Business configuration
}

interface PendingState {
  id: string;
  tenantId: string;
  sessionHash: string;
  authorizationEpoch: number;
  createdAtMs: number;
  expiresAtMs: number;
}

interface CredentialRecord {
  id: string;
  tenantId: string;
  metaUserId: string;
  cipher?: string;
  iv?: string;
  tag?: string;
  scopes: string[];
  expiresAtMs: number;
  state: FacebookConnectionState;
  revision: number; // monotonic on each reconnect or disconnect
  connectedAt: string;
  refreshedAt: string;
}

export interface FacebookPublicAuthorization {
  connectionRef: string;
  state: FacebookConnectionState;
  pagesVerified: false;
  revision: string;
  grantedScopes: string[];
  expiresAt: string;
  connectedAt: string;
}

export interface FacebookOAuthProvider {
  exchangeCode(code: string): Promise<{ token: string; expiresInSeconds: number }>;
  extendUserToken(token: string): Promise<{ token: string; expiresInSeconds: number }>;
  getUserId(token: string): Promise<string>;
  getGrantedScopes(token: string): Promise<string[]>;
}

export class FacebookOAuthFailure extends Error {
  constructor(public readonly code: string, public readonly httpStatus = 400) {
    super(code);
    this.name = 'FacebookOAuthFailure';
  }
}

function assertConfig(config: FacebookOAuthConfig): {
  appId: string; appSecret: string; redirectUri: string;
  key: Buffer; graphVersion: string; loginConfigId?: string;
} {
  if (!/^\d{6,32}$/.test(config.appId || '') || !config.appSecret?.trim()) {
    throw new FacebookOAuthFailure('FACEBOOK_NOT_CONFIGURED', 503);
  }
  const version = config.graphVersion || 'v26.0';
  if (!/^v\d{1,2}\.\d{1,2}$/.test(version)) {
    throw new FacebookOAuthFailure('FACEBOOK_INVALID_CONFIG', 503);
  }
  let redirect: URL;
  try { redirect = new URL(config.redirectUri); }
  catch { throw new FacebookOAuthFailure('FACEBOOK_INVALID_CONFIG', 503); }
  const testLoopback = process.env.NODE_ENV === 'test'
    && redirect.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname);
  if ((!testLoopback && redirect.protocol !== 'https:')
    || redirect.username || redirect.password || redirect.search || redirect.hash
    || redirect.pathname !== '/customer/facebook/callback') {
    throw new FacebookOAuthFailure('FACEBOOK_INVALID_CONFIG', 503);
  }
  const encoded = (config.credentialKey || '').trim();
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new FacebookOAuthFailure('FACEBOOK_ENCRYPTION_NOT_CONFIGURED', 503);
  }
  const loginConfigId = config.loginConfigId?.trim();
  if (loginConfigId && !/^[0-9]{6,40}$/.test(loginConfigId)) {
    throw new FacebookOAuthFailure('FACEBOOK_INVALID_CONFIG', 503);
  }
  return {
    appId: config.appId, appSecret: config.appSecret, redirectUri: redirect.href,
    key, graphVersion: version, loginConfigId,
  };
}

export function facebookOAuthConfigFromEnv(): FacebookOAuthConfig {
  return {
    appId: process.env.FACEBOOK_APP_ID || '',
    appSecret: process.env.FACEBOOK_APP_SECRET || '',
    redirectUri: process.env.FACEBOOK_OAUTH_REDIRECT_URI || '',
    credentialKey: process.env.FACEBOOK_OAUTH_CREDENTIAL_KEY || '',
    graphVersion: process.env.FACEBOOK_OAUTH_GRAPH_VERSION || 'v26.0',
    loginConfigId: process.env.FACEBOOK_LOGIN_CONFIG_ID || undefined,
  };
}

function customerSession(context: Context) {
  refresh(context);
  if (context.operatorTokenId || !context.sessionHash
    || !context.user || context.user.disabled || context.user.role !== 'USER'
    || !/^[A-Za-z0-9_.:-]{1,200}$/.test(String(context.user.id || ''))) {
    throw new FacebookOAuthFailure('CUSTOMER_SESSION_REQUIRED', 401);
  }
  return { tenantId: String(context.user.id), sessionHash: context.sessionHash };
}

export type FacebookOAuthAuditAction =
  'FACEBOOK_CONSENT_STARTED' | 'FACEBOOK_OAUTH_CONNECTED' |
  'FACEBOOK_OAUTH_DISCONNECTED' | 'FACEBOOK_OAUTH_REAUTH_REQUIRED' |
  'FACEBOOK_PAGE_TOKEN_VERIFIED';
export type FacebookOAuthAuditRecord = Readonly<{
  id: string;
  tenantId: string;
  action: FacebookOAuthAuditAction;
  occurredAt: string;
  connectionRef?: string;
  revision?: string;
  pageId?: string;
}>;
function commitOAuthWithAudit<T>(
  store: Store, tenantId: string, action: FacebookOAuthAuditAction,
  metadata: { connectionRef?: string; revision?: string; pageId?: string },
  update: () => T,
): T {
  // Required evidence must be durable in the SAME SQLite transaction as a
  // credential/state mutation. If the audit fails, the mutation rolls back.
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const result = update();
    const audit: FacebookOAuthAuditRecord = {
      id: 'fbaudit-' + randomBytes(16).toString('hex'),
      tenantId, action, occurredAt: new Date().toISOString(), ...metadata,
    };
    store.put(AUDIT, { ...audit }, tenantId);
    store.db.exec('COMMIT');
    return result;
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}
export function listCustomerFacebookAuthorizationAudit(
  store: Store, trustedTenantId: string,
): FacebookOAuthAuditRecord[] {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(trustedTenantId)) return [];
  return (store.list(AUDIT, trustedTenantId) as unknown as FacebookOAuthAuditRecord[])
    .filter(entry => entry.tenantId === trustedTenantId);
}

function digestState(state: string) {
  return 'fboauth-' + createHash('sha256').update(state).digest('hex');
}

// A local disconnect must invalidate even an in-flight OAuth callback that
// already consumed its CSRF state and is awaiting an external Meta response.
function epochRef(tenantId: string) {
  return 'fbepoch-' + createHash('sha256').update(tenantId).digest('hex');
}
function authorizationEpoch(store: Store, tenantId: string): number {
  const record = store.get(EPOCHS, epochRef(tenantId));
  return record && Number.isSafeInteger(record.epoch) && record.epoch >= 0 ? record.epoch : 0;
}
function revokePendingCustomerAuthorizations(store: Store, tenantId: string) {
  const ref = epochRef(tenantId);
  store.put(EPOCHS, { id: ref, tenantId, epoch: authorizationEpoch(store, tenantId) + 1 }, tenantId);
  for (const row of store.list(STATES, tenantId)) {
    if (row.tenantId === tenantId) store.remove(STATES, String(row.id));
  }
}

function constantMatch(left: string, right: string) {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicRecord(record: CredentialRecord): FacebookPublicAuthorization {
  return {
    connectionRef: record.id,
    state: record.state === 'AUTHORIZED_PENDING_PAGE_SELECTION'
      && record.expiresAtMs <= Date.now()
        ? 'REAUTH_REQUIRED' : record.state,
    pagesVerified: false,
    revision: 'r' + String(record.revision || 1),
    grantedScopes: [...record.scopes],
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    connectedAt: record.connectedAt,
  };
}

function ownedAccount(store: Store, tenantId: string, ref: string): CredentialRecord {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(tenantId)
    || !/^fb-user-[a-f0-9]{32}$/.test(ref)) {
    throw new FacebookOAuthFailure('FACEBOOK_CONNECTION_NOT_FOUND', 404);
  }
  const row = store.get(ACCOUNTS, ref) as unknown as CredentialRecord | undefined;
  if (!row || row.tenantId !== tenantId) {
    throw new FacebookOAuthFailure('FACEBOOK_CONNECTION_NOT_FOUND', 404);
  }
  return row;
}

function seal(token: string, key: Buffer, associatedData: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associatedData));
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    cipher: body.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function open(record: CredentialRecord, key: Buffer) {
  try {
    const decrypt = createDecipheriv(
      'aes-256-gcm', key, Buffer.from(record.iv || '', 'base64'),
    );
    decrypt.setAAD(Buffer.from(record.tenantId + ':' + record.id));
    decrypt.setAuthTag(Buffer.from(record.tag || '', 'base64'));
    return Buffer.concat([
      decrypt.update(Buffer.from(record.cipher || '', 'base64')),
      decrypt.final(),
    ]).toString('utf8');
  } catch {
    throw new FacebookOAuthFailure('FACEBOOK_CREDENTIAL_UNAVAILABLE', 409);
  }
}

export function beginCustomerFacebookOAuth(
  store: Store, context: Context, config: FacebookOAuthConfig,
  atMs = Date.now(),
): { authorizationUrl: string; expiresAt: string } {
  const session = customerSession(context);
  const normalized = assertConfig(config);
  const active = store.list(STATES, session.tenantId) as unknown as PendingState[];
  // Only purge expired state belonging to the initiating tenant.
  for (const record of active) if (record.expiresAtMs <= atMs) store.remove(STATES, record.id);
  if (active.filter(r => r.expiresAtMs > atMs).length >= 5) {
    throw new FacebookOAuthFailure('TOO_MANY_PENDING_FACEBOOK_AUTHORIZATIONS', 429);
  }
  const state = randomBytes(32).toString('base64url');
  const record: PendingState = {
    id: digestState(state), tenantId: session.tenantId,
    sessionHash: session.sessionHash,
    authorizationEpoch: authorizationEpoch(store, session.tenantId),
    createdAtMs: atMs, expiresAtMs: atMs + STATE_TTL_MS,
  };
  commitOAuthWithAudit(store, session.tenantId, 'FACEBOOK_CONSENT_STARTED', {}, () => {
    store.put(STATES, record, session.tenantId);
  });
  const url = new URL('https://www.facebook.com/' + normalized.graphVersion + '/dialog/oauth');
  url.searchParams.set('client_id', normalized.appId);
  url.searchParams.set('redirect_uri', normalized.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (normalized.loginConfigId) url.searchParams.set('config_id', normalized.loginConfigId);
  else url.searchParams.set('scope', FACEBOOK_PAGES_REQUIRED_SCOPES.join(','));
  return { authorizationUrl: url.toString(), expiresAt: new Date(record.expiresAtMs).toISOString() };
}

export async function finishCustomerFacebookOAuth(
  store: Store, context: Context,
  callback: { state?: string | null; code?: string | null; error?: string | null },
  config: FacebookOAuthConfig,
  provider: FacebookOAuthProvider = new MetaGraphFacebookOAuthProvider(config),
  atMs = Date.now(),
): Promise<FacebookPublicAuthorization> {
  const session = customerSession(context);
  const normalized = assertConfig(config);
  const state = callback.state || '';
  if (!/^[A-Za-z0-9_-]{42,70}$/.test(state)) {
    throw new FacebookOAuthFailure('FACEBOOK_INVALID_STATE', 400);
  }
  const id = digestState(state);
  const pending = store.get(STATES, id) as unknown as PendingState | undefined;
  if (!pending || pending.tenantId !== session.tenantId
    || !constantMatch(pending.sessionHash, session.sessionHash)) {
    throw new FacebookOAuthFailure('FACEBOOK_INVALID_STATE', 400);
  }
  // Atomic one-time consume BEFORE the first network await prevents callback replay.
  const result = store.db.prepare(
    'DELETE FROM records WHERE collection=? AND id=? AND owner=?',
  ).run(STATES, id, session.tenantId);
  if (result.changes !== 1) {
    throw new FacebookOAuthFailure('FACEBOOK_INVALID_STATE', 400);
  }
  if (pending.expiresAtMs <= atMs) {
    throw new FacebookOAuthFailure('FACEBOOK_EXPIRED_STATE', 400);
  }
  if (callback.error) throw new FacebookOAuthFailure('FACEBOOK_CONSENT_DECLINED', 400);
  const code = callback.code || '';
  if (!code || code.length > 2048 || /[\s]/.test(code)) {
    throw new FacebookOAuthFailure('FACEBOOK_INVALID_CODE', 400);
  }
  // A provider exception may contain an authorization code or access token.
  // Normalize it before crossing this service boundary, not just at HTTP serialization.
  const providerCall = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) {
      if (error instanceof FacebookOAuthFailure) throw error;
      throw new FacebookOAuthFailure('FACEBOOK_PROVIDER_UNAVAILABLE', 502);
    }
  };
  const initial = await providerCall(() => provider.exchangeCode(code));
  if (!initial.token || !Number.isFinite(initial.expiresInSeconds)) {
    throw new FacebookOAuthFailure('FACEBOOK_INVALID_TOKEN_RESPONSE', 502);
  }
  const extended = await providerCall(() => provider.extendUserToken(initial.token));
  if (!extended.token || !Number.isFinite(extended.expiresInSeconds)
    || extended.expiresInSeconds < 60 || extended.expiresInSeconds > 90 * 86400) {
    throw new FacebookOAuthFailure('FACEBOOK_INVALID_TOKEN_RESPONSE', 502);
  }
  const [providerUserId, granted] = await Promise.all([
    providerCall(() => provider.getUserId(extended.token)),
    providerCall(() => provider.getGrantedScopes(extended.token)),
  ]);
  if (!/^\d{1,50}$/.test(providerUserId)) {
    throw new FacebookOAuthFailure('FACEBOOK_INVALID_IDENTITY', 502);
  }
  if (!Array.isArray(granted)
    || FACEBOOK_PAGES_REQUIRED_SCOPES.some(scope => !granted.includes(scope))) {
    throw new FacebookOAuthFailure('FACEBOOK_PERMISSION_REQUIRED', 403);
  }
  const ref = 'fb-user-' + createHash('sha256')
    .update(session.tenantId + '\0' + providerUserId).digest('hex').slice(0, 32);
  // A disconnect during Meta exchange must not silently reconnect the account
  // from a previously authorized state or a stale pending HTTP callback.
  if (authorizationEpoch(store, session.tenantId) !== pending.authorizationEpoch) {
    throw new FacebookOAuthFailure('FACEBOOK_AUTHORIZATION_REVOKED', 409);
  }
  const previous = store.get(ACCOUNTS, ref) as unknown as CredentialRecord | undefined;
  if (previous && previous.tenantId !== session.tenantId) {
    throw new FacebookOAuthFailure('FACEBOOK_CONNECTION_CONFLICT', 409);
  }
  const currentTime = new Date(atMs).toISOString();
  const record: CredentialRecord = {
    id: ref, tenantId: session.tenantId, metaUserId: providerUserId,
    ...seal(extended.token, normalized.key, session.tenantId + ':' + ref),
    scopes: [...FACEBOOK_PAGES_REQUIRED_SCOPES],
    expiresAtMs: atMs + extended.expiresInSeconds * 1000,
    state: 'AUTHORIZED_PENDING_PAGE_SELECTION',
    revision: (previous?.revision || 0) + 1,
    connectedAt: previous?.connectedAt || currentTime,
    refreshedAt: currentTime,
  };
  commitOAuthWithAudit(store, session.tenantId, 'FACEBOOK_OAUTH_CONNECTED',
    { connectionRef: ref, revision: 'r' + record.revision }, () => {
      // Re-read and compare the epoch inside the write transaction: a local
      // disconnect must not resurrect an older in-flight OAuth callback.
      if (authorizationEpoch(store, session.tenantId) !== pending.authorizationEpoch) {
        throw new FacebookOAuthFailure('FACEBOOK_AUTHORIZATION_REVOKED', 409);
      }
      // Meta exchange can outlive logout, session revocation or account disable.
      // Revalidate the original cookie-backed USER session inside the same
      // transaction as credential persistence; never silently reconnect it.
      const currentSession = customerSession(context);
      if (currentSession.tenantId !== session.tenantId
        || !constantMatch(currentSession.sessionHash, session.sessionHash)) {
        throw new FacebookOAuthFailure('CUSTOMER_SESSION_REQUIRED', 401);
      }
      if (pending.expiresAtMs <= Date.now()) {
        throw new FacebookOAuthFailure('FACEBOOK_EXPIRED_STATE', 400);
      }
      store.put(ACCOUNTS, record, session.tenantId);
    });
  return publicRecord(record);
}

export function listCustomerFacebookAuthorizations(store: Store, tenantId: string) {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(tenantId)) return [];
  return (store.list(ACCOUNTS, tenantId) as unknown as CredentialRecord[])
    .filter(row => row.tenantId === tenantId).map(publicRecord);
}

export function disconnectCustomerFacebook(
  store: Store, tenantId: string, ref: string,
): FacebookPublicAuthorization {
  const current = ownedAccount(store, tenantId, ref);
  return commitOAuthWithAudit(store, tenantId, 'FACEBOOK_OAUTH_DISCONNECTED',
    { connectionRef: ref, revision: 'r' + ((current.revision || 0) + 1) }, () => {
      const latest = ownedAccount(store, tenantId, ref);
      const next: CredentialRecord = {
        ...latest, state: 'DISCONNECTED',
        revision: (latest.revision || 0) + 1,
        cipher: undefined, iv: undefined, tag: undefined,
        refreshedAt: new Date().toISOString(),
      };
      store.put(ACCOUNTS, next, tenantId);
      revokePendingCustomerAuthorizations(store, tenantId);
      // Local token is destroyed; remote Meta deauthorization is not claimed.
      return publicRecord(next);
    });
}

/**
 * LCG3 Page selector adapter. The pilot currently has one authenticated USER
 * account per tenant: tenantId === userId (both derived from session/Customer MCP).
 * This grants only the OAuth-user connection, NEVER actual Facebook Page access.
 * Page inventory, CREATE_CONTENT tasks and selected Page must be verified by LCG3.
 */
export function getCustomerFacebookPageSelectionGrant(
  store: Store, customer: { tenantId: string; userId: string }, ref: string,
): {
  id: string; tenantId: string; userId: string; platform: 'FACEBOOK';
  status: 'CONNECTED' | 'REAUTH_REQUIRED' | 'DISCONNECTED';
  revision: string; scopes: readonly string[]; expiresAt: string;
} | null {
  if (!customer || !customer.tenantId || customer.tenantId !== customer.userId) return null;
  let row: CredentialRecord;
  try { row = ownedAccount(store, customer.tenantId, ref); }
  catch (error) {
    if (error instanceof FacebookOAuthFailure && error.code === 'FACEBOOK_CONNECTION_NOT_FOUND') return null;
    throw error;
  }
  return {
    id: row.id, tenantId: row.tenantId, userId: customer.userId, platform: 'FACEBOOK',
    status: row.state === 'DISCONNECTED' ? 'DISCONNECTED'
      : row.state === 'REAUTH_REQUIRED' || row.expiresAtMs <= Date.now()
        ? 'REAUTH_REQUIRED' : 'CONNECTED',
    revision: 'r' + String(row.revision || 1),
    scopes: [...row.scopes], expiresAt: new Date(row.expiresAtMs).toISOString(),
  };
}

/** Trusted server adapters ONLY: caller tenantId MUST be authenticated, never user-supplied. */
export function getServerSideFacebookAccessToken(
  store: Store, tenantId: string, ref: string, credentialKey: string,
): { token: string; metaUserId: string; expiresAt: string } {
  const row = ownedAccount(store, tenantId, ref);
  if (row.state !== 'AUTHORIZED_PENDING_PAGE_SELECTION'
    || Date.now() >= row.expiresAtMs) {
    throw new FacebookOAuthFailure('FACEBOOK_REAUTH_REQUIRED', 409);
  }
  // Key syntax and length are validated independently of the OAuth app settings.
  const key = Buffer.from(credentialKey || '', 'base64');
  if (key.length !== 32 || key.toString('base64') !== credentialKey) {
    throw new FacebookOAuthFailure('FACEBOOK_ENCRYPTION_NOT_CONFIGURED', 503);
  }
  return {
    token: open(row, key), metaUserId: row.metaUserId,
    expiresAt: new Date(row.expiresAtMs).toISOString(),
  };
}

/**
 * Server-only Meta Page-token resolution for a CURRENT LCG3-selected Page.
 * No Page token is stored: retrieve it anew at execution time so disconnect,
 * Page-role revocation and OAuth rotation cannot silently reuse an old token.
 */
export type FacebookTrustedSelectedPage = Readonly<{
  tenantId: string;
  userId: string;
  connectionId: string;
  connectionRevision: string;
  pageId: string;
}>;
export interface FacebookPageTokenProvider {
  getUserId(token: string): Promise<string>;
  getGrantedScopes(token: string): Promise<string[]>;
  getPageCredential(userToken: string, pageId: string): Promise<{
    pageId: string;
    pageToken: string;
    tasks: readonly string[];
  }>;
}
export type FacebookResolvedPageBinding = Readonly<{
  tenantId: string;
  pageId: string;
  pageToken: string;
  verifiedPageId: string;
  canCreateContent: true;
  scopes: readonly string[];
  connectionRevision: string;
}>;

function expireCompromisedOAuthGrant(
  store: Store, tenantId: string, ref: string, expectedRevision: number,
): void {
  const row = ownedAccount(store, tenantId, ref);
  // A stale/late provider error must never revoke a newly reauthorized grant.
  if (row.revision !== expectedRevision || row.state !== 'AUTHORIZED_PENDING_PAGE_SELECTION') return;
  const next: CredentialRecord = {
    ...row, state: 'REAUTH_REQUIRED',
    revision: expectedRevision + 1,
    cipher: undefined, iv: undefined, tag: undefined,
    refreshedAt: new Date().toISOString(),
  };
  commitOAuthWithAudit(store, tenantId, 'FACEBOOK_OAUTH_REAUTH_REQUIRED',
    { connectionRef: ref, revision: 'r' + next.revision }, () => {
      const latest = ownedAccount(store, tenantId, ref);
      if (latest.revision !== expectedRevision || latest.state !== 'AUTHORIZED_PENDING_PAGE_SELECTION') {
        throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_STALE', 409);
      }
      store.put(ACCOUNTS, next, tenantId);
      revokePendingCustomerAuthorizations(store, tenantId);
    });
}

/**
 * Trusted server callers MUST pass the current result of LCG3
 * requireSelectedPublishPage() and a recheck callback from that same guarded
 * store. Neither pageId nor tenantId may come directly from customer JSON.
 */
export async function resolveServerSideFacebookPageBinding(
  store: Store,
  selected: FacebookTrustedSelectedPage,
  config: FacebookOAuthConfig,
  provider: FacebookPageTokenProvider,
  recheckCurrentSelection: () => Promise<boolean>,
): Promise<FacebookResolvedPageBinding> {
  if (!selected || typeof selected !== 'object'
    || selected.tenantId !== selected.userId
    || !/^[A-Za-z0-9_.:-]{1,200}$/.test(selected.tenantId || '')
    || !/^[0-9]{1,32}$/.test(selected.pageId || '')
    || typeof recheckCurrentSelection !== 'function') {
    throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_UNVERIFIED', 403);
  }
  assertConfig(config);
  if (!await recheckCurrentSelection()) {
    throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_UNVERIFIED', 403);
  }
  const row = ownedAccount(store, selected.tenantId, selected.connectionId);
  if (row.state !== 'AUTHORIZED_PENDING_PAGE_SELECTION'
    || row.expiresAtMs <= Date.now()
    || selected.connectionRevision !== 'r' + String(row.revision)
    || !FACEBOOK_PAGES_REQUIRED_SCOPES.every(s => row.scopes.includes(s))) {
    throw new FacebookOAuthFailure('FACEBOOK_REAUTH_REQUIRED', 409);
  }
  const userToken = getServerSideFacebookAccessToken(
    store, selected.tenantId, selected.connectionId, config.credentialKey,
  ).token;
  const providerCall = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); }
    catch (error) {
      if (error instanceof FacebookOAuthFailure) throw error;
      throw new FacebookOAuthFailure('FACEBOOK_PROVIDER_UNAVAILABLE', 502);
    }
  };
  let identity: string;
  let scopes: string[];
  try {
    [identity, scopes] = await Promise.all([
      providerCall(() => provider.getUserId(userToken)),
      providerCall(() => provider.getGrantedScopes(userToken)),
    ]);
  } catch (error) {
    if (error instanceof FacebookOAuthFailure && error.code === 'FACEBOOK_TOKEN_REVOKED') {
      expireCompromisedOAuthGrant(store, selected.tenantId, selected.connectionId, row.revision);
      throw new FacebookOAuthFailure('FACEBOOK_REAUTH_REQUIRED', 409);
    }
    throw error;
  }
  // A live user-ID mismatch, revoked scope or permissions downgrade is terminal
  // for this OAuth credential; destroy its local ciphertext and increment revision.
  if (identity !== row.metaUserId
    || !Array.isArray(scopes)
    || !FACEBOOK_PAGES_REQUIRED_SCOPES.every(scope => scopes.includes(scope))) {
    expireCompromisedOAuthGrant(store, selected.tenantId, selected.connectionId, row.revision);
    throw new FacebookOAuthFailure('FACEBOOK_REAUTH_REQUIRED', 409);
  }
  let page: Awaited<ReturnType<FacebookPageTokenProvider['getPageCredential']>>;
  try {
    page = await providerCall(() => provider.getPageCredential(userToken, selected.pageId));
  } catch (error) {
    if (error instanceof FacebookOAuthFailure && error.code === 'FACEBOOK_TOKEN_REVOKED') {
      expireCompromisedOAuthGrant(store, selected.tenantId, selected.connectionId, row.revision);
      throw new FacebookOAuthFailure('FACEBOOK_REAUTH_REQUIRED', 409);
    }
    throw error;
  }
  // Meta Page tasks can be returned as CREATE_CONTENT or
  // PROFILE_PLUS_CREATE_CONTENT depending on the Page access model.
  const hasCreateTask = page && Array.isArray(page.tasks) && (
    page.tasks.includes('CREATE_CONTENT') ||
    page.tasks.includes('PROFILE_PLUS_CREATE_CONTENT')
  );
  if (!page || page.pageId !== selected.pageId
    || !hasCreateTask
    || typeof page.pageToken !== 'string'
    || page.pageToken.length < 12 || page.pageToken.length > 8192
    || /[\x00-\x20\x7f]/.test(page.pageToken)) {
    throw new FacebookOAuthFailure('FACEBOOK_PAGE_PERMISSION_REQUIRED', 403);
  }
  // Any disconnect/reconnect, scope change or cleared Page selection during
  // network I/O must invalidate the now-stale Page token before it is returned.
  const latest = ownedAccount(store, selected.tenantId, selected.connectionId);
  if (latest.revision !== row.revision
    || latest.state !== 'AUTHORIZED_PENDING_PAGE_SELECTION'
    || latest.expiresAtMs <= Date.now()
    || !FACEBOOK_PAGES_REQUIRED_SCOPES.every(scope => latest.scopes.includes(scope))
    || !await recheckCurrentSelection()) {
    throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_STALE', 409);
  }
  // Fail closed if the audit sink is unavailable; never leak the token when
  // no durable record exists that this Page token was accessed.
  commitOAuthWithAudit(store, selected.tenantId, 'FACEBOOK_PAGE_TOKEN_VERIFIED',
    { connectionRef: selected.connectionId,
      revision: selected.connectionRevision, pageId: selected.pageId }, () => {
      const current = ownedAccount(store, selected.tenantId, selected.connectionId);
      if (current.revision !== row.revision || current.state !== 'AUTHORIZED_PENDING_PAGE_SELECTION') {
        throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_STALE', 409);
      }
    });
  return {
    tenantId: selected.tenantId,
    pageId: selected.pageId,
    pageToken: page.pageToken,
    verifiedPageId: selected.pageId,
    canCreateContent: true,
    scopes: [...latest.scopes],
    connectionRevision: 'r' + String(latest.revision),
  };
}

/**
 * LCG2's trusted adapter for LCG4 VerifiedFacebookPostNowDependencies.pageTokens.
 * This is ONLY a server-to-server port. The request tuple is a constraint from
 * LCG4's verified principal, NOT proof of ownership from customer MCP JSON.
 * LCG3 must supply its real persisted-selection/permission recheck method.
 */
export type FacebookCurrentPageTokenRequest = Readonly<{
  tenantId: string;
  userId: string;
  pageConnectionId: string;
  pageId: string;
  connectionRevision: string;
}>;
export interface FacebookCurrentSelectedPageProvider {
  requireSelectedDispatchGrant(
    customer: Readonly<{ tenantId: string; userId: string }>,
    expectedConnectionId: string,
  ): Promise<{
    tenantId: string;
    ownerUserId: string;
    connectionId: string;
    pageId: string;
    connectionRevision: string;
    targetType: string;
    status: string;
    tasks: readonly string[];
    scopes: readonly string[];
  }>;
}

/**
 * The only approved way for LCG4's verified post-now publisher to get a Page
 * token: bind the persisted, current selected Page to a still-authorized USER
 * OAuth connection and a fresh Meta Page credential. Never cache or expose its
 * result as MCP output. Due jobs must invoke it again at actual dispatch.
 */
export type FacebookTrustedPageTokenResolver = Readonly<{
  resolveCurrentPageToken(input: FacebookCurrentPageTokenRequest): Promise<FacebookResolvedPageBinding>;
  /**
   * Server-only, immediate pre-provider-write check for the EXACT bound object
   * issued by this resolver. A copy, token from another resolver, revoked Page
   * or same-Page reselection cannot pass. Consumers MUST call this after the
   * final async media step and before invoking the one-attempt Meta publisher.
   */
  assertResolvedPageTokenCurrent(binding: FacebookResolvedPageBinding): Promise<void>;
}>;

export function createTrustedFacebookPageTokenResolver(
  store: Store,
  config: FacebookOAuthConfig,
  provider: FacebookPageTokenProvider,
  selectedPages: FacebookCurrentSelectedPageProvider,
): FacebookTrustedPageTokenResolver {
  if (!selectedPages || typeof selectedPages.requireSelectedDispatchGrant !== 'function') {
    throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_UNVERIFIED', 403);
  }
  // WeakMap prevents callers from forging a post-resolution authorization by
  // copying a token or reconstructing otherwise identical Page metadata.
  const revalidateBoundPage = new WeakMap<FacebookResolvedPageBinding, () => Promise<boolean>>();
  return {
    async assertResolvedPageTokenCurrent(binding: FacebookResolvedPageBinding): Promise<void> {
      const recheck = binding && typeof binding === 'object'
        ? revalidateBoundPage.get(binding) : undefined;
      if (!recheck || !await recheck()) {
        throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_STALE', 409);
      }
    },
    async resolveCurrentPageToken(input: FacebookCurrentPageTokenRequest) {
      if (!input || typeof input !== 'object'
        || !/^[A-Za-z0-9_.:-]{1,200}$/.test(input.tenantId || '')
        || input.tenantId !== input.userId
        || !/^fb-user-[a-f0-9]{32}$/.test(input.pageConnectionId || '')
        || !/^[0-9]{1,32}$/.test(input.pageId || '')
        || !/^r[1-9][0-9]*$/.test(input.connectionRevision || '')) {
        throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_UNVERIFIED', 403);
      }
      const customer = { tenantId: input.tenantId, userId: input.userId };
      // The LCG3 dispatch grant intentionally omits its private selectionNonce.
      // Without pinning that persisted identity, clear+reselect of the SAME
      // Page/revision during Meta I/O would revive an old token lookup.
      // Read only the exact tenant-owned LCG3 selection record. Old/missing
      // nonces fail closed: the customer must explicitly reselect their Page.
      const choiceId = 'fb-choice-' + createHash('sha256')
        .update(input.tenantId + '\0' + input.userId).digest('hex');
      const selectionNonce = (): string | null => {
        try {
          const row = store.db.prepare(
            'SELECT owner,payload FROM records WHERE collection=? AND id=?',
          ).get('facebook-page-selections', choiceId) as {
            owner: unknown; payload: unknown;
          } | undefined;
          if (!row || row.owner !== input.tenantId
            || typeof row.payload !== 'string') return null;
          const choice: unknown = JSON.parse(row.payload);
          if (!choice || typeof choice !== 'object') return null;
          const current = choice as Record<string, unknown>;
          if (current.tenantId !== input.tenantId
            || current.userId !== input.userId
            || current.connectionId !== input.pageConnectionId
            || current.connectionRevision !== input.connectionRevision
            || current.pageId !== input.pageId
            || typeof current.selectionNonce !== 'string'
            || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
              .test(current.selectionNonce)) return null;
          return current.selectionNonce;
        } catch {
          return null;
        }
      };
      const pinnedNonce = selectionNonce();
      if (!pinnedNonce) {
        throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_UNVERIFIED', 403);
      }
      const liveCustomer = () => {
        const current = store.user(input.userId);
        if (!current || current.disabled
          || !['USER', 'CUSTOMER'].includes(String(current.role))) {
          throw new FacebookOAuthFailure('CUSTOMER_ACCOUNT_REQUIRED', 403);
        }
      };
      const matchesCurrentSelection = async (): Promise<boolean> => {
        try {
          liveCustomer();
          // This method MUST come from actual LCG3 selection persistence and
          // current provider inventory; never use a preapproved Boolean.
          const page = await selectedPages.requireSelectedDispatchGrant(
            customer, input.pageConnectionId,
          );
          // The customer may be disabled or promoted to ADMIN while the
          // provider inventory is awaited. Recheck after the final await
          // before authorizing any previously resolved Page-token lease.
          liveCustomer();
          return !!page && page.tenantId === input.tenantId
            && page.ownerUserId === input.userId
            && page.connectionId === input.pageConnectionId
            && page.pageId === input.pageId
            && page.connectionRevision === input.connectionRevision
            && page.targetType === 'PAGE' && page.status === 'CONNECTED'
            && Array.isArray(page.tasks)
            && (page.tasks.includes('CREATE_CONTENT')
              || page.tasks.includes('PROFILE_PLUS_CREATE_CONTENT'))
            && Array.isArray(page.scopes)
            && FACEBOOK_PAGES_REQUIRED_SCOPES.every(scope => page.scopes.includes(scope))
            && selectionNonce() === pinnedNonce;
        } catch {
          // No provider/store error details, customer identity or token escape.
          return false;
        }
      };
      if (!await matchesCurrentSelection()) {
        throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_UNVERIFIED', 403);
      }
      const binding = await resolveServerSideFacebookPageBinding(
        store,
        {
          ...customer,
          connectionId: input.pageConnectionId,
          connectionRevision: input.connectionRevision,
          pageId: input.pageId,
        },
        config,
        provider,
        matchesCurrentSelection,
      );
      // Even if the LCG3 Page was valid during the Meta network awaits,
      // rotation or account disablement between those awaits is disqualifying.
      if (!await matchesCurrentSelection()) {
        throw new FacebookOAuthFailure('FACEBOOK_PAGE_SELECTION_STALE', 409);
      }
      liveCustomer();
      // Do not expose the LCG3 private selectionNonce in Page-token results.
      // Only the exact immutable object below carries an unforgeable in-memory
      // lease tied to its initial persisted selection nonce.
      const bound = Object.freeze({
        ...binding, scopes: Object.freeze([...binding.scopes]),
      });
      revalidateBoundPage.set(bound, matchesCurrentSelection);
      return bound;
    },
  };
}

async function readBoundedMetaResponse(response: Response, maxBytes = 32_768): Promise<string> {
  const stream = response.body;
  if (!stream) throw new FacebookOAuthFailure('FACEBOOK_PROVIDER_INVALID_RESPONSE', 502);
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new FacebookOAuthFailure('FACEBOOK_PROVIDER_INVALID_RESPONSE', 502);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } catch (error) {
    if (error instanceof FacebookOAuthFailure) throw error;
    throw new FacebookOAuthFailure('FACEBOOK_PROVIDER_INVALID_RESPONSE', 502);
  } finally {
    reader.releaseLock();
  }
}

/** Default external transport is only invoked after authenticated customer callback. */
export class MetaGraphFacebookOAuthProvider implements FacebookOAuthProvider {
  private config: ReturnType<typeof assertConfig>;
  constructor(config: FacebookOAuthConfig) { this.config = assertConfig(config); }

  private async get(path: string, params: Record<string, string>, token?: string) {
    const url = new URL('https://graph.facebook.com/' + this.config.graphVersion + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (token) {
      url.searchParams.set('appsecret_proof',
        createHmac('sha256', this.config.appSecret).update(token).digest('hex'));
    }
    // Never log the URL: token exchange includes app secret. No redirects or external hosts.
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET', redirect: 'error',
        headers: token ? {
          Authorization: 'Bearer ' + token,
          'Accept': 'application/json',
        } : { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new FacebookOAuthFailure('FACEBOOK_PROVIDER_UNAVAILABLE', 502);
    }
    // Parse bounded provider errors without ever exposing Meta's response text,
    // which may contain a token, code, Page name or internal diagnostic.
    const content = await readBoundedMetaResponse(response);
    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('object required');
      data = parsed as Record<string, unknown>;
    } catch { throw new FacebookOAuthFailure('FACEBOOK_PROVIDER_INVALID_RESPONSE', 502); }
    const detail = data.error;
    const providerCode = detail && typeof detail === 'object'
      ? (detail as Record<string, unknown>).code : undefined;
    if ((!response.ok || detail) && token && (providerCode === 190 || providerCode === 102)) {
      throw new FacebookOAuthFailure('FACEBOOK_TOKEN_REVOKED', 401);
    }
    if ((!response.ok || detail) && token && (providerCode === 200 || providerCode === 10)) {
      throw new FacebookOAuthFailure('FACEBOOK_PERMISSION_REQUIRED', 403);
    }
    if (!response.ok || detail) throw new FacebookOAuthFailure('FACEBOOK_PROVIDER_REJECTED', 502);
    return data;
  }

  async exchangeCode(code: string) {
    const data = await this.get('/oauth/access_token', {
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: this.config.redirectUri,
      code,
    });
    return this.tokenResponse(data);
  }

  async extendUserToken(token: string) {
    const data = await this.get('/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      fb_exchange_token: token,
    });
    return this.tokenResponse(data);
  }

  private tokenResponse(data: Record<string, unknown>) {
    const token = data.access_token;
    const expires = data.expires_in;
    if (typeof token !== 'string' || token.length < 12 || token.length > 8192
      || typeof expires !== 'number' || !Number.isFinite(expires)) {
      throw new FacebookOAuthFailure('FACEBOOK_INVALID_TOKEN_RESPONSE', 502);
    }
    return { token, expiresInSeconds: expires };
  }

  async getUserId(token: string): Promise<string> {
    const data = await this.get('/me', { fields: 'id' }, token);
    if (typeof data.id !== 'string') throw new FacebookOAuthFailure('FACEBOOK_INVALID_IDENTITY', 502);
    return data.id;
  }

  async getGrantedScopes(token: string): Promise<string[]> {
    const data = await this.get('/me/permissions', { limit: '100' }, token);
    if (!Array.isArray(data.data)) throw new FacebookOAuthFailure('FACEBOOK_PERMISSION_REQUIRED', 403);
    return data.data
      .filter((row: unknown): row is { permission: string; status: string } =>
        !!row && typeof row === 'object' &&
        typeof (row as { permission?: unknown }).permission === 'string' &&
        (row as { status?: unknown }).status === 'granted')
      .map(row => row.permission);
  }

  /** Meta /me/accounts is the Page-token issuance source, NOT user OAuth alone.
   * This resolver never returns other Pages and refuses incomplete pagination.
   */
  async getPageCredential(userToken: string, pageId: string) {
    if (!/^[0-9]{1,32}$/.test(pageId)) {
      throw new FacebookOAuthFailure('FACEBOOK_PAGE_PERMISSION_REQUIRED', 403);
    }
    let after: string | undefined;
    const cursors = new Set<string>();
    let candidate: { pageId: string; pageToken: string; tasks: readonly string[] } | undefined;
    for (let page = 0; page < 4; page++) {
      const result = await this.get('/me/accounts', {
        fields: 'id,access_token,tasks',
        limit: '50',
        ...(after ? { after } : {}),
      }, userToken);
      if (!Array.isArray(result.data)) {
        throw new FacebookOAuthFailure('FACEBOOK_PAGE_INVENTORY_INVALID', 502);
      }
      for (const raw of result.data) {
        if (!raw || typeof raw !== 'object') {
          throw new FacebookOAuthFailure('FACEBOOK_PAGE_INVENTORY_INVALID', 502);
        }
        const row = raw as Record<string, unknown>;
        if (row.id !== pageId) continue;
        if (candidate || typeof row.access_token !== 'string' || !Array.isArray(row.tasks)) {
          throw new FacebookOAuthFailure('FACEBOOK_PAGE_INVENTORY_INVALID', 502);
        }
        candidate = {
          pageId,
          pageToken: row.access_token,
          tasks: row.tasks.filter((task): task is string => typeof task === 'string'),
        };
      }
      const paging = result.paging;
      const cursorsValue = paging && typeof paging === 'object'
        ? (paging as Record<string, unknown>).cursors : undefined;
      const cursor = cursorsValue && typeof cursorsValue === 'object'
        ? (cursorsValue as Record<string, unknown>).after : undefined;
      if (cursor === undefined || cursor === null || cursor === '') {
        if (!candidate) throw new FacebookOAuthFailure('FACEBOOK_PAGE_NOT_MANAGED', 403);
        return candidate;
      }
      if (typeof cursor !== 'string' || !/^[A-Za-z0-9_=-]{1,200}$/.test(cursor)
        || cursors.has(cursor)) {
        throw new FacebookOAuthFailure('FACEBOOK_PAGE_INVENTORY_INVALID', 502);
      }
      cursors.add(cursor);
      after = cursor;
    }
    throw new FacebookOAuthFailure('FACEBOOK_PAGE_INVENTORY_INCOMPLETE', 409);
  }
}

function sendJson(res: ServerResponse, status: number, value: Record<string, unknown>) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(value));
}

/**
 * Host-router bridge. MUST be passed a cookie-backed sessionContext WITHOUT
 * admin operator Bearer authentication. Callback never accepts a returnUrl.
 */
export async function handleCustomerFacebookOAuthHttp(
  req: IncomingMessage, res: ServerResponse, store: Store, context: Context,
  config = facebookOAuthConfigFromEnv(),
  provider?: FacebookOAuthProvider,
): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/customer/facebook/connect'
    && url.pathname !== '/customer/facebook/callback') return false;
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return true;
  }
  try {
    if (url.pathname === '/customer/facebook/connect') {
      const result = beginCustomerFacebookOAuth(store, context, config);
      res.writeHead(302, {
        Location: result.authorizationUrl,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      res.end();
    } else {
      // URLSearchParams.get() silently chooses the first duplicate value.
      // Reject ambiguous OAuth callback parameters before consuming CSRF state:
      // the originally issued valid state remains usable by the real browser.
      if (url.searchParams.getAll('state').length !== 1
        || url.searchParams.getAll('code').length > 1
        || url.searchParams.getAll('error').length > 1) {
        throw new FacebookOAuthFailure('FACEBOOK_INVALID_CALLBACK', 400);
      }
      const result = await finishCustomerFacebookOAuth(
        store, context, {
          state: url.searchParams.get('state'),
          code: url.searchParams.get('code'),
          error: url.searchParams.get('error'),
        }, config, provider,
      );
      sendJson(res, 200, { ok: true, ...result });
    }
  } catch (err) {
    const failure = err instanceof FacebookOAuthFailure
      ? err : new FacebookOAuthFailure('FACEBOOK_AUTHORIZATION_FAILED', 502);
    // Never echo Meta error_description, code/state or access tokens.
    sendJson(res, failure.httpStatus, { error: failure.code });
  }
  return true;
}
