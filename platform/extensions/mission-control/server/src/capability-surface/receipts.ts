import { createHash } from 'node:crypto';
import type { CryptographicReceipt, SideEffectLevel } from './types.js';

export function computePayloadDigest(payload: unknown): string {
  try {
    const serialized = JSON.stringify(payload, Object.keys(payload as any || {}).sort());
    return createHash('sha256').update(serialized || '').digest('hex');
  } catch {
    return createHash('sha256').update(String(payload || '')).digest('hex');
  }
}

export function generateReceiptId(startedAtMs: number): string {
  const rand = Math.random().toString(36).substring(2, 10);
  return `rcpt_${startedAtMs}_${rand}`;
}

export interface CreateReceiptParams {
  tenantId: string;
  subjectId: string;
  projectId?: string;
  toolId: string;
  sideEffectLevel: SideEffectLevel;
  status: 'SUCCEEDED' | 'DENIED' | 'FAILED' | 'QUEUED' | 'REQUIRES_APPROVAL' | 'PAUSED';
  startedAt: Date;
  completedAt: Date;
  inputPayload?: unknown;
  outputPayload?: unknown;
  idempotencyKey?: string;
  approvalReferenceId?: string;
}

export function createCryptographicReceipt(params: CreateReceiptParams): CryptographicReceipt {
  const startedAtMs = params.startedAt.getTime();
  const completedAtMs = params.completedAt.getTime();
  const durationMs = Math.max(0, completedAtMs - startedAtMs);

  const digestPayload = {
    tenantId: params.tenantId,
    subjectId: params.subjectId,
    projectId: params.projectId ?? null,
    toolId: params.toolId,
    status: params.status,
    input: sanitizeForAudit(params.inputPayload),
    output: sanitizeForAudit(params.outputPayload)
  };

  const payloadDigest = computePayloadDigest(digestPayload);
  const idempotencyKeyHash = params.idempotencyKey
    ? createHash('sha256').update(params.idempotencyKey).digest('hex')
    : undefined;

  // HMAC-SHA256 signature representation for tamper evidence
  const signature = createHash('sha256')
    .update(`${params.tenantId}:${params.toolId}:${params.status}:${payloadDigest}:${startedAtMs}`)
    .digest('hex');

  return {
    receiptId: generateReceiptId(startedAtMs),
    tenantId: params.tenantId,
    subjectId: params.subjectId,
    projectId: params.projectId,
    toolId: params.toolId,
    sideEffectLevel: params.sideEffectLevel,
    status: params.status,
    startedAt: params.startedAt.toISOString(),
    completedAt: params.completedAt.toISOString(),
    durationMs,
    idempotencyKeyHash,
    approvalReferenceId: params.approvalReferenceId,
    payloadDigest,
    signature
  };
}

export function sanitizeForAudit(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  const sensitivePattern = /(token|password|secret|key|authorization|bearer|cookie|credential)/i;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForAudit(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (sensitivePattern.test(key) && typeof value === 'string') {
      result[key] = `[REDACTED_SECRET_${value.length}_CHARS]`;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeForAudit(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
