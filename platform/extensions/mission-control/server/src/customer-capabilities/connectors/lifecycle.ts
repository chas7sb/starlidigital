import type { IntegrationConnection, IntegrationConnectionStatus } from '../types.js';
import { validateOpaqueCredentialReference } from '../security.js';

const SENSITIVE_METADATA_KEY = /(secret|password|passwd|token|api.?key|authorization|cookie|credential|private.?key|prompt|instruction|system)/i;
const PROVIDER_ID = /^[a-z][a-z0-9-]{1,63}$/;
const CONNECTION_ID = /^[A-Za-z0-9_.:-]{1,220}$/;
const SCOPE = /^[a-z][a-z0-9._:-]{1,79}$/;
const STATUSES = new Set<IntegrationConnectionStatus>(['CONFIGURATION_NEEDED','DISCONNECTED','CONNECTING','CONNECTED','DEGRADED','REAUTH_REQUIRED','REVOKED','ERROR']);
const AUTH_MODES = new Set(['OAUTH2','API_KEY','MANAGED','CUSTOM']);

const TRANSITIONS: Record<IntegrationConnectionStatus, ReadonlySet<IntegrationConnectionStatus>> = {
  CONFIGURATION_NEEDED: new Set(['DISCONNECTED', 'CONNECTING', 'REVOKED']),
  DISCONNECTED: new Set(['CONNECTING', 'REVOKED']),
  CONNECTING: new Set(['CONNECTED', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED', 'REVOKED']),
  CONNECTED: new Set(['DEGRADED', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED', 'REVOKED']),
  DEGRADED: new Set(['CONNECTED', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED', 'REVOKED']),
  REAUTH_REQUIRED: new Set(['CONNECTING', 'DISCONNECTED', 'REVOKED']),
  ERROR: new Set(['CONNECTING', 'DISCONNECTED', 'REVOKED']),
  REVOKED: new Set()
};

function cleanMetadata(metadata: IntegrationConnection['metadata']): IntegrationConnection['metadata'] {
  if (!metadata) return undefined;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 50)) {
    if (SENSITIVE_METADATA_KEY.test(key) || !/^[A-Za-z0-9_.:-]{1,80}$/.test(key)) continue;
    if (typeof value === 'string') clean[key] = value.slice(0, 250);
    else if (typeof value === 'boolean') clean[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
  }
  return clean;
}

export function sanitizeIntegrationConnection(record: IntegrationConnection): IntegrationConnection {
  if (!CONNECTION_ID.test(String(record.id || ''))) throw new Error('Invalid connector connection ID');
  if (!CONNECTION_ID.test(String(record.tenantId || ''))) throw new Error('Invalid connector tenant ID');
  if (!PROVIDER_ID.test(String(record.provider || ''))) throw new Error('Invalid connector provider ID');
  validateOpaqueCredentialReference(record.credentialReference);
  if (!STATUSES.has(record.status)) throw new Error('Invalid connector lifecycle state');
  if (record.authMode && !AUTH_MODES.has(record.authMode)) throw new Error('Invalid connector auth mode');
  const scopes = [...new Set(Array.isArray(record.grantedScopes) ? record.grantedScopes : [])];
  if (scopes.length > 100 || scopes.some(scope => !SCOPE.test(scope))) throw new Error('Invalid connector granted scopes');
  if (record.lastErrorCode && !/^[A-Z0-9_.:-]{1,100}$/.test(record.lastErrorCode)) throw new Error('Invalid connector error code');
  const createdAt = new Date(record.createdAt); const updatedAt = new Date(record.updatedAt);
  if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(updatedAt.getTime())) throw new Error('Invalid connector timestamps');
  if (record.healthCheckedAt && !Number.isFinite(new Date(record.healthCheckedAt).getTime())) throw new Error('Invalid connector health timestamp');
  return {
    id: record.id,
    tenantId: record.tenantId,
    provider: record.provider,
    status: record.status,
    credentialReference: record.credentialReference,
    authMode: record.authMode,
    grantedScopes: scopes,
    healthCheckedAt: record.healthCheckedAt,
    lastErrorCode: record.lastErrorCode,
    metadata: cleanMetadata(record.metadata),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function transitionIntegrationConnection(
  record: IntegrationConnection,
  next: IntegrationConnectionStatus,
  options: { now: string; grantedScopes?: readonly string[]; lastErrorCode?: string; healthCheckedAt?: string } = { now: new Date().toISOString() }
): IntegrationConnection {
  const clean = sanitizeIntegrationConnection(record);
  if (clean.status !== next && !TRANSITIONS[clean.status].has(next)) throw new Error(`Connector lifecycle transition ${clean.status} -> ${next} is not allowed`);
  return sanitizeIntegrationConnection({
    ...clean,
    status: next,
    grantedScopes: options.grantedScopes ?? clean.grantedScopes,
    lastErrorCode: options.lastErrorCode,
    healthCheckedAt: options.healthCheckedAt ?? clean.healthCheckedAt,
    updatedAt: options.now
  });
}
