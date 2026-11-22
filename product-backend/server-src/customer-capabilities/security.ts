import { createHash, randomUUID } from 'node:crypto';
import type {
  CapabilityAuditReceipt,
  CapabilityDefinition,
  CapabilityInputSchema,
  IntegrationConnection,
  PublicIntegrationConnection
} from './types.js';

const RESERVED_CAPABILITY_PATTERNS = [
  /(^|[._-])(admin|operator|shell|exec|server|secret|database|sql|root)([._-]|$)/i,
  /^(outreach|device|platform)[._-]/i
];
const SENSITIVE_KEY = /(secret|password|passwd|token|api.?key|authorization|cookie|credential|private.?key)/i;
const IDENTITY_FIELDS = new Set(['tenantId', 'workspaceId', 'ownerId', 'grantId', 'credentialReference']);
const SECRET_STRING_PATTERNS = [
  /\bsk-(?:(?:proj|svcacct|or-v1)-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{12,}\b/g
];

export function hashOpaque(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function validateCapabilityDefinition(def: CapabilityDefinition): void {
  if (!/^[a-z][a-z0-9_.-]{2,79}$/.test(def.id)) throw new Error('Invalid customer capability ID');
  if (RESERVED_CAPABILITY_PATTERNS.some(pattern => pattern.test(def.id))) throw new Error('Reserved capability family is not customer-exposable');
  if (!def.description || def.description.length > 500) throw new Error('Capability description must be bounded');
  if (!def.inputSchema || def.inputSchema.type !== 'object' || def.inputSchema.additionalProperties !== false) throw new Error('Customer capability schemas must reject additional properties');
  if (def.sideEffectLevel === 'HIGH_IMPACT' && !def.approvalRequired) throw new Error('High-impact capabilities must require approval');
  if (def.approvalRequired && def.autonomousAllowed) throw new Error('Approval-gated capabilities cannot be autonomous');
  if (def.maxOutputBytes < 512 || def.maxOutputBytes > 128 * 1024) throw new Error('Capability output bound is outside platform limits');
  if (!Number.isSafeInteger(def.rateLimit.maxPerMinute) || def.rateLimit.maxPerMinute < 1 || def.rateLimit.maxPerMinute > 600) throw new Error('Invalid customer capability rate limit');
}

export function validateInput(schema: CapabilityInputSchema, input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('INVALID_INPUT: input must be an object');
  const obj = input as Record<string, unknown>;
  const serialized = JSON.stringify(obj);
  if (Buffer.byteLength(serialized,'utf8') > 16 * 1024) throw new Error('INVALID_INPUT: input exceeds 16 KiB');
  for (const key of Object.keys(obj)) {
    if (IDENTITY_FIELDS.has(key)) throw new Error('FORGED_IDENTITY: caller-controlled identity fields are forbidden');
    if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) throw new Error('INVALID_INPUT: unexpected field');
  }
  for (const required of schema.required ?? []) if (obj[required] === undefined || obj[required] === null || obj[required] === '') throw new Error(`INVALID_INPUT: missing ${required}`);
  for (const [key, property] of Object.entries(schema.properties)) {
    const value = obj[key];
    if (value === undefined) continue;
    if(value===null)throw new Error(`INVALID_INPUT: ${key} cannot be null`);
    if (property.type === 'string') {
      if (typeof value !== 'string') throw new Error(`INVALID_INPUT: ${key} must be a string`);
      if (property.maxLength !== undefined && value.length > property.maxLength) throw new Error(`INVALID_INPUT: ${key} is too long`);
      if (property.enum && !property.enum.includes(value)) throw new Error(`INVALID_INPUT: ${key} has an unsupported value`);
    } else if (property.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`INVALID_INPUT: ${key} must be a boolean`);
    } else if (property.type === 'integer') {
      if (!Number.isSafeInteger(value)) throw new Error(`INVALID_INPUT: ${key} must be an integer`);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`INVALID_INPUT: ${key} must be a number`);
    if(property.enum&&!property.enum.some(item=>item===value))throw new Error(`INVALID_INPUT: ${key} has an unsupported value`);
    if(typeof value==='number'&&((property.minimum!==undefined&&value<property.minimum)||(property.maximum!==undefined&&value>property.maximum)))throw new Error(`INVALID_INPUT: ${key} is outside the permitted range`);
  }
  return obj;
}

function redactString(value: string): string {
  let next = value;
  for (const pattern of SECRET_STRING_PATTERNS) next = next.replace(pattern, '[REDACTED_SECRET]');
  return next;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[TRUNCATED_DEPTH]';
  if (typeof value === 'string') return redactString(value.length > 16_384 ? `${value.slice(0, 16_384)}[TRUNCATED]` : value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED_SECRET]' : redact(item, depth + 1);
    return out;
  }
  return String(value);
}

export function redactAndBoundOutput(value: unknown, maxBytes: number): unknown {
  const clean = redact(value);
  const serialized = JSON.stringify(clean);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new Error('OUTPUT_LIMIT_EXCEEDED');
  return clean;
}

export function validateOpaqueCredentialReference(reference: string): void {
  if (!/^connref_[A-Za-z0-9_-]{12,160}$/.test(reference)) throw new Error('Integration credentials must be opaque connector references');
}

export function publicConnection(connection: IntegrationConnection): PublicIntegrationConnection {
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(connection.metadata ?? {})) {
    if (SENSITIVE_KEY.test(key) || /instruction|prompt|system/i.test(key)) continue;
    if (typeof value === 'string') metadata[key] = redactString(value).slice(0, 250);
    else metadata[key] = value;
  }
  return { id: connection.id, provider: connection.provider, status: connection.status, authMode: connection.authMode, grantedScopes: connection.grantedScopes ? [...connection.grantedScopes].slice(0, 100) : undefined, healthCheckedAt: connection.healthCheckedAt, metadata, metadataTrust: 'UNTRUSTED_EXTERNAL_DATA', instructionsAllowed: false, updatedAt: connection.updatedAt };
}

export function receipt(input: Omit<CapabilityAuditReceipt, 'id'>): CapabilityAuditReceipt {
  return { id: `caprec_${randomUUID()}`, ...input };
}
