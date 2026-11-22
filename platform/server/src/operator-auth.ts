import { randomBytes } from 'node:crypto';
import { Store, id, now, type RecordData } from './store.js';
import { fail, hashToken, requireAdmin, refresh, type Context } from './security.js';

export const OPERATOR_PERMISSIONS = [
  'READ',
  'CONVERSATIONS',
  'PROJECTS',
  'LEADS',
  'PROPOSALS',
  'DEVICES',
  'JOBS',
  'MESSAGES',
  'PLATFORM_STAGE',
  'PLATFORM_APPROVE',
  'PRIVILEGED_POWERSHELL'
] as const;

export type OperatorPermission = (typeof OPERATOR_PERMISSIONS)[number];

export type OperatorTokenRecord = RecordData & {
  id: string;
  userId: string;
  label: string;
  tokenHash: string;
  tokenPrefix: string;
  permissions: OperatorPermission[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export function normalizeOperatorPermissions(input?: string[] | null): OperatorPermission[] {
  if (!input || !input.length) {
    return [
      'READ',
      'CONVERSATIONS',
      'PROJECTS',
      'LEADS',
      'PROPOSALS',
      'DEVICES',
      'JOBS',
      'MESSAGES',
      'PLATFORM_STAGE'
    ];
  }
  const set = new Set<OperatorPermission>();
  for (const raw of input) {
    const upper = String(raw || '').trim().toUpperCase() as OperatorPermission;
    if (!(OPERATOR_PERMISSIONS as readonly string[]).includes(upper)) {
      fail(`Permisiunea de operator „${raw}” nu este recunoscută.`);
    }
    set.add(upper);
  }
  set.add('READ');
  return [...set];
}

export function issueOperatorToken(
  store: Store,
  ctx: Context,
  options: {
    label: string;
    permissions?: string[] | null;
    ttlHours?: number;
  }
): { token: string; record: OperatorTokenRecord } {
  const admin = requireAdmin(ctx);
  const label = String(options.label || 'CLI Ubuntu').trim().slice(0, 120);
  if (label.length < 2) fail('Eticheta tokenului de operator trebuie să aibă cel puțin 2 caractere.');
  const ttlHours = options.ttlHours !== undefined ? Number(options.ttlHours) : 24 * 14;
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 24 * 90) {
    fail('Durata de valabilitate a tokenului trebuie să fie între 1 oră și 90 de zile.');
  }
  const permissions = normalizeOperatorPermissions(options.permissions);
  const secret = 'starli_op_' + randomBytes(32).toString('hex');
  const tokenHash = hashToken(secret);
  const expiresAt = new Date(Date.now() + Math.round(ttlHours * 3600000)).toISOString();

  const record: OperatorTokenRecord = {
    id: id(),
    ownerId: admin.id,
    userId: admin.id,
    label,
    tokenHash,
    tokenPrefix: secret.slice(0, 16),
    permissions,
    expiresAt,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: now()
  };

  store.put('operator-tokens', record, admin.id);
  store.put('audit', {
    id: id(),
    actor: admin.id,
    action: 'operator.token.issued',
    target: `${record.id} (${label})`,
    createdAt: now()
  });

  return { token: secret, record };
}

export function resolveOperatorBearer(store: Store, headerValue?: string | null): { user: RecordData; tokenRecord: OperatorTokenRecord } | null {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const trimmed = headerValue.trim();
  const rawToken = trimmed.toLowerCase().startsWith('bearer ')
    ? trimmed.slice(7).trim()
    : trimmed;
  if (!rawToken.startsWith('starli_op_') || rawToken.length < 30 || rawToken.length > 200) {
    return null;
  }
  const hashed = hashToken(rawToken);
  const tokenRecord = store
    .list('operator-tokens')
    .find(t => t.tokenHash === hashed) as OperatorTokenRecord | undefined;
  if (!tokenRecord) return null;
  if (tokenRecord.revokedAt) return null;
  if (Date.parse(tokenRecord.expiresAt) <= Date.now()) return null;

  const user = store.user(tokenRecord.userId);
  if (!user || user.disabled || user.role !== 'ADMIN') return null;

  return { user, tokenRecord };
}

export function requireOperator(ctx: Context, requiredPermission: OperatorPermission = 'READ'): { user: RecordData; tokenRecord?: OperatorTokenRecord } {
  refresh(ctx);
  if (!ctx.user) {
    fail('Autentificare de operator necesară.', 'UNAUTHENTICATED');
  }
  if (ctx.user.disabled || ctx.user.role !== 'ADMIN') {
    fail('Accesul la Starli Operator este permis exclusiv contului de administrator activ.', 'FORBIDDEN');
  }
  if (ctx.operatorTokenId) {
    const tokenRecord = ctx.store.get('operator-tokens', ctx.operatorTokenId) as OperatorTokenRecord | undefined;
    if (!tokenRecord || tokenRecord.revokedAt || Date.parse(tokenRecord.expiresAt) <= Date.now()) {
      fail('Tokenul de operator a fost revocat sau a expirat.', 'UNAUTHENTICATED');
    }
    if (!Array.isArray(tokenRecord.permissions) || !tokenRecord.permissions.includes(requiredPermission)) {
      fail(`Tokenul de operator nu are permisiunea necesară (${requiredPermission}).`, 'FORBIDDEN');
    }
    return { user: ctx.user, tokenRecord };
  }
  return { user: ctx.user };
}

export function revokeOperatorToken(store: Store, ctx: Context, tokenId: string): OperatorTokenRecord {
  const admin = requireAdmin(ctx);
  const existing = store.get('operator-tokens', tokenId) as OperatorTokenRecord | undefined;
  if (!existing) fail('Tokenul de operator nu există.', 'NOT_FOUND');
  const updated: OperatorTokenRecord = {
    ...existing,
    revokedAt: existing.revokedAt || now()
  };
  store.put('operator-tokens', updated, existing.userId);
  store.put('audit', {
    id: id(),
    actor: admin.id,
    action: 'operator.token.revoked',
    target: tokenId,
    createdAt: now()
  });
  return updated;
}

export function listOperatorTokens(store: Store, ctx: Context): OperatorTokenRecord[] {
  requireOperator(ctx, 'READ');
  return (store.list('operator-tokens') as OperatorTokenRecord[])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function recordOperatorAudit(
  store: Store,
  actorId: string,
  action: string,
  target: string,
  detail?: Record<string, unknown>
): RecordData {
  const safeTarget = redactSecrets(String(target || '')).slice(0, 280);
  const safeDetail = detail ? JSON.parse(redactSecrets(JSON.stringify(detail))) : undefined;
  const entry = {
    id: id(),
    actor: actorId,
    action,
    target: safeTarget,
    detail: safeDetail,
    createdAt: now()
  };
  store.put('audit', entry);
  return entry;
}

/**
 * Redacts credentials, tokens, hashes, claim codes, OTPs, and provider keys from strings.
 */
export function redactSecrets(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/\bstarli_op_[a-fA-F0-9]{16,128}\b/g, '[REDACTED_OPERATOR_TOKEN]')
    .replace(/\bstarli_dev_[a-fA-F0-9]{16,128}\b/g, '[REDACTED_DEVICE_TOKEN]')
    .replace(/\bstarli_claim_[a-zA-Z0-9_-]{8,128}\b/g, '[REDACTED_CLAIM_SECRET]')
    .replace(/\bSC-[A-Z0-9]{4}-[A-Z0-9]{4}(?:-[A-Z0-9]{4})?\b/g, '[REDACTED_CLAIM_CODE]')
    .replace(/\bPAIR-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, '[REDACTED_PAIRING_CODE]')
    .replace(/\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,200}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bwhsec_[A-Za-z0-9_-]{16,200}\b/g, '[REDACTED_WEBHOOK_SECRET]')
    .replace(/\bre_[A-Za-z0-9_-]{16,200}\b/g, '[REDACTED_RESEND_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(password|parola|passwordHash|token|secret|cookie|csrfToken|otpCode|claimCode)\s*["':=]\s*["']?([^"',\s\n}]+)/gi, '$1="[REDACTED]"');
}
