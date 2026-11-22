import { createHash, randomUUID } from 'node:crypto';
import { Store, id, now, type RecordData } from './store.js';
import { Events } from './events.js';
import { fail } from './security.js';
import { redactSecrets, recordOperatorAudit } from './operator-auth.js';

export type OperatorJobStatus =
  | 'PENDING'
  | 'AWAITING_APPROVAL'
  | 'QUEUED_DEVICE'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'TIMED_OUT'
  | 'INCERT';

export type OperatorJobRecord = RecordData & {
  id: string;
  actorId: string;
  tenantId?: string;
  capabilityId?: string;
  sideEffectLevel?: 'READ' | 'WRITE' | 'HIGH_IMPACT';
  kind: string;
  targetType: string;
  targetId: string | null;
  deviceId: string | null;
  idempotencyKey: string;
  fingerprint: string;
  status: OperatorJobStatus;
  requiresApproval: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  argsJson: string;
  output: string | null;
  error: string | null;
  exitCode: number | null;
  leaseToken: string | null;
  leaseUntil: number;
  heartbeatAt: string | null;
  timeoutMs: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const MAX_OUTPUT_LENGTH = 16000;
const DEFAULT_CONCURRENCY_LIMIT = 4;

function canonicalFingerprint(kind: string, targetId: string | null, args: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind, targetId: targetId || null, args: args ?? {} }))
    .digest('hex');
}

export function sanitizeJobOutput(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const redacted = redactSecrets(String(raw));
  if (redacted.length <= MAX_OUTPUT_LENGTH) return redacted;
  return redacted.slice(0, MAX_OUTPUT_LENGTH) + '\n[Output trunchiat la limita de siguranță]';
}

export function createOperatorJob(
  store: Store,
  events: Events | undefined,
  input: {
    actorId: string;
    tenantId?: string;
    capabilityId?: string;
    sideEffectLevel?: 'READ' | 'WRITE' | 'HIGH_IMPACT';
    kind: string;
    targetType?: string;
    targetId?: string | null;
    deviceId?: string | null;
    idempotencyKey?: string;
    args?: Record<string, unknown>;
    requiresApproval?: boolean;
    timeoutMs?: number;
    maxConcurrent?: number;
  }
): { job: OperatorJobRecord; deduplicated: boolean } {
  const kind = String(input.kind || '').trim();
  if (!kind || kind.length > 80) fail('Tipul lucrării nu este valid.');
  const targetType = String(input.targetType || 'platform').trim().slice(0, 60);
  const targetId = input.targetId ? String(input.targetId).trim().slice(0, 120) : null;
  const deviceId = input.deviceId ? String(input.deviceId).trim().slice(0, 120) : null;
  const safeArgs = input.args ? JSON.parse(redactSecrets(JSON.stringify(input.args))) : {};
  const fingerprint = canonicalFingerprint(kind, targetId, safeArgs);
  const idempotencyKey = input.idempotencyKey
    ? String(input.idempotencyKey).trim().slice(0, 160)
    : `auto:${input.actorId}:${fingerprint.slice(0, 32)}`;

  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs || 120000), 1000), 900000);
  const maxConcurrent = Math.min(Math.max(Number(input.maxConcurrent || DEFAULT_CONCURRENCY_LIMIT), 1), 16);

  const nested = store.db.isTransaction;
  const savepoint = 'op_job_' + randomUUID().replaceAll('-', '');
  store.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  try {
    const existing = (store.list('operator-jobs') as OperatorJobRecord[]).find(
      j => j.idempotencyKey === idempotencyKey
    );
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        fail('Cheia de idempotență a fost deja folosită cu alți parametri.', 'BAD_USER_INPUT');
      }
      store.db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
      return { job: existing, deduplicated: true };
    }

    const activeCount = (store.list('operator-jobs') as OperatorJobRecord[]).filter(
      j => j.kind === kind && (j.status === 'RUNNING' || j.status === 'QUEUED_DEVICE')
    ).length;
    if (activeCount >= maxConcurrent) {
      fail(`Limita de concurență (${maxConcurrent}) pentru lucrările de tip „${kind}” a fost atinsă.`, 'RATE_LIMITED');
    }

    const initialStatus: OperatorJobStatus = input.requiresApproval
      ? 'AWAITING_APPROVAL'
      : deviceId
      ? 'QUEUED_DEVICE'
      : 'PENDING';

    const job: OperatorJobRecord = {
      id: id(),
      ownerId: input.actorId,
      actorId: input.actorId,
      tenantId: input.tenantId,
      capabilityId: input.capabilityId,
      sideEffectLevel: input.sideEffectLevel,
      kind,
      targetType,
      targetId,
      deviceId,
      idempotencyKey,
      fingerprint,
      status: initialStatus,
      requiresApproval: Boolean(input.requiresApproval),
      approvedBy: null,
      approvedAt: null,
      argsJson: JSON.stringify(safeArgs),
      output: null,
      error: null,
      exitCode: null,
      leaseToken: null,
      leaseUntil: 0,
      heartbeatAt: null,
      timeoutMs,
      startedAt: null,
      completedAt: null,
      createdAt: now(),
      updatedAt: now()
    };

    store.put('operator-jobs', job, input.actorId);
    recordOperatorAudit(store, input.actorId, 'operator.job.created', `${job.id} (${kind})`, {
      status: job.status,
      deviceId,
      targetId
    });
    store.db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
    events?.publish('operator-jobs');
    return { job, deduplicated: false };
  } catch (err) {
    if (nested) {
      store.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      store.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } else {
      store.db.exec('ROLLBACK');
    }
    throw err;
  }
}

export function acquireJobLease(
  store: Store,
  events: Events | undefined,
  jobId: string,
  leaseDurationMs = 60000
): { job: OperatorJobRecord; leaseToken: string } | null {
  const nowMs = Date.now();
  const leaseToken = randomUUID();
  const nested = store.db.isTransaction;
  store.db.exec(nested ? 'SAVEPOINT job_lease' : 'BEGIN IMMEDIATE');
  try {
    const current = store.get('operator-jobs', jobId) as OperatorJobRecord | undefined;
    if (!current) {
      store.db.exec(nested ? 'RELEASE SAVEPOINT job_lease' : 'COMMIT');
      return null;
    }
    if (!['PENDING', 'QUEUED_DEVICE', 'RUNNING'].includes(current.status)) {
      store.db.exec(nested ? 'RELEASE SAVEPOINT job_lease' : 'COMMIT');
      return null;
    }
    if (current.status === 'RUNNING' && current.leaseUntil > nowMs) {
      store.db.exec(nested ? 'RELEASE SAVEPOINT job_lease' : 'COMMIT');
      return null;
    }
    const updated: OperatorJobRecord = {
      ...current,
      status: 'RUNNING',
      leaseToken,
      leaseUntil: nowMs + Math.max(5000, leaseDurationMs),
      heartbeatAt: now(),
      startedAt: current.startedAt || now(),
      updatedAt: now()
    };
    store.put('operator-jobs', updated, current.actorId);
    store.db.exec(nested ? 'RELEASE SAVEPOINT job_lease' : 'COMMIT');
    events?.publish('operator-jobs');
    return { job: updated, leaseToken };
  } catch (err) {
    if (nested) {
      store.db.exec('ROLLBACK TO SAVEPOINT job_lease');
      store.db.exec('RELEASE SAVEPOINT job_lease');
    } else {
      store.db.exec('ROLLBACK');
    }
    throw err;
  }
}

export function heartbeatOperatorJob(
  store: Store,
  events: Events | undefined,
  jobId: string,
  leaseToken: string,
  partialOutput?: string,
  leaseDurationMs = 60000
): OperatorJobRecord {
  const current = store.get('operator-jobs', jobId) as OperatorJobRecord | undefined;
  if (!current) fail('Lucrarea nu există.', 'NOT_FOUND');
  if (current.leaseToken !== leaseToken || current.status !== 'RUNNING') {
    fail('Lease-ul lucrării nu mai este valid sau lucrarea a fost anulată.', 'FORBIDDEN');
  }
  const updated: OperatorJobRecord = {
    ...current,
    leaseUntil: Date.now() + Math.max(5000, leaseDurationMs),
    heartbeatAt: now(),
    output: partialOutput !== undefined ? sanitizeJobOutput(partialOutput) : current.output,
    updatedAt: now()
  };
  store.put('operator-jobs', updated, current.actorId);
  events?.publish('operator-jobs');
  return updated;
}

export function completeOperatorJob(
  store: Store,
  events: Events | undefined,
  jobId: string,
  result: {
    status: 'SUCCEEDED' | 'FAILED' | 'INCERT' | 'TIMED_OUT';
    output?: string | null;
    error?: string | null;
    exitCode?: number | null;
    leaseToken?: string | null;
  }
): OperatorJobRecord {
  const current = store.get('operator-jobs', jobId) as OperatorJobRecord | undefined;
  if (!current) fail('Lucrarea nu există.', 'NOT_FOUND');
  if (['SUCCEEDED', 'FAILED', 'CANCELED', 'TIMED_OUT', 'INCERT'].includes(current.status)) {
    return current;
  }
  if (result.leaseToken && current.leaseToken && current.leaseToken !== result.leaseToken) {
    fail('Lease-ul lucrării nu corespunde.', 'FORBIDDEN');
  }
  const updated: OperatorJobRecord = {
    ...current,
    status: result.status,
    output: result.output !== undefined ? sanitizeJobOutput(result.output) : current.output,
    error: result.error !== undefined ? sanitizeJobOutput(result.error) : current.error,
    exitCode: result.exitCode !== undefined ? result.exitCode : current.exitCode,
    leaseToken: null,
    leaseUntil: 0,
    completedAt: now(),
    updatedAt: now()
  };
  store.put('operator-jobs', updated, current.actorId);
  recordOperatorAudit(store, current.actorId, `operator.job.${result.status.toLowerCase()}`, `${jobId} (${current.kind})`, {
    exitCode: updated.exitCode
  });
  events?.publish('operator-jobs');
  return updated;
}

export function approveOperatorJob(
  store: Store,
  events: Events | undefined,
  jobId: string,
  actorId: string
): OperatorJobRecord {
  const current = store.get('operator-jobs', jobId) as OperatorJobRecord | undefined;
  if (!current) fail('Lucrarea nu există.', 'NOT_FOUND');
  if (current.status !== 'AWAITING_APPROVAL') {
    fail(`Lucrarea nu așteaptă aprobare (stare curentă: ${current.status}).`);
  }
  const nextStatus: OperatorJobStatus = current.deviceId ? 'QUEUED_DEVICE' : 'PENDING';
  const updated: OperatorJobRecord = {
    ...current,
    status: nextStatus,
    approvedBy: actorId,
    approvedAt: now(),
    updatedAt: now()
  };
  store.put('operator-jobs', updated, current.actorId);
  recordOperatorAudit(store, actorId, 'operator.job.approved', `${jobId} (${current.kind})`);
  events?.publish('operator-jobs');
  return updated;
}

export function cancelOperatorJob(
  store: Store,
  events: Events | undefined,
  jobId: string,
  actorId: string,
  reason = 'Anulat de operator.'
): OperatorJobRecord {
  const current = store.get('operator-jobs', jobId) as OperatorJobRecord | undefined;
  if (!current) fail('Lucrarea nu există.', 'NOT_FOUND');
  if (['SUCCEEDED', 'FAILED', 'CANCELED', 'TIMED_OUT', 'INCERT'].includes(current.status)) {
    return current;
  }
  const updated: OperatorJobRecord = {
    ...current,
    status: 'CANCELED',
    error: sanitizeJobOutput(reason),
    leaseToken: null,
    leaseUntil: 0,
    completedAt: now(),
    updatedAt: now()
  };
  store.put('operator-jobs', updated, current.actorId);
  recordOperatorAudit(store, actorId, 'operator.job.canceled', `${jobId} (${current.kind})`);
  events?.publish('operator-jobs');
  return updated;
}

/**
 * Reconciles interrupted operator jobs after server restart or lease expiration.
 * Side-effecting device/messaging jobs that were already running become INCERT (never auto-retried).
 */
export function reconcileOperatorJobs(store: Store, events?: Events, isStartup = false): number {
  const nowMs = Date.now();
  let reconciled = 0;
  for (const job of store.list('operator-jobs') as OperatorJobRecord[]) {
    if (job.status !== 'RUNNING' && job.status !== 'QUEUED_DEVICE' && job.status !== 'PENDING') continue;
    const startedMs = job.startedAt ? Date.parse(job.startedAt) : Date.parse(job.createdAt);
    const timedOut = Number.isFinite(startedMs) && nowMs - startedMs > job.timeoutMs;
    const leaseExpired = job.status === 'RUNNING' && job.leaseUntil > 0 && job.leaseUntil <= nowMs;

    if (isStartup && job.status === 'RUNNING') {
      const isExternalSideEffect = job.kind.startsWith('device.') || job.kind.startsWith('sms.') || job.kind.startsWith('platform.apply');
      const nextStatus: OperatorJobStatus = isExternalSideEffect ? 'INCERT' : 'FAILED';
      const updated: OperatorJobRecord = {
        ...job,
        status: nextStatus,
        error: isExternalSideEffect
          ? 'Serverul a repornit în timpul unei execuții externe. Rezultatul este incert; verifică înainte de retrimitere.'
          : 'Serverul a repornit în timpul execuției lucrării.',
        leaseToken: null,
        leaseUntil: 0,
        completedAt: now(),
        updatedAt: now()
      };
      store.put('operator-jobs', updated, job.actorId);
      reconciled++;
      continue;
    }

    if (timedOut || leaseExpired) {
      const isAmbiguousExternal = job.status === 'RUNNING' && (job.kind.startsWith('sms.') || job.kind.startsWith('device.powershell'));
      const nextStatus: OperatorJobStatus = isAmbiguousExternal ? 'INCERT' : 'TIMED_OUT';
      const updated: OperatorJobRecord = {
        ...job,
        status: nextStatus,
        error: isAmbiguousExternal
          ? 'Lease-ul sau timpul de așteptare a expirat în timpul unei acțiuni cu efect extern. Stare marcată INCERT (fără retrimitere automată).'
          : 'Lucrarea a depășit timpul maxim de execuție sau lease-ul a expirat.',
        leaseToken: null,
        leaseUntil: 0,
        completedAt: now(),
        updatedAt: now()
      };
      store.put('operator-jobs', updated, job.actorId);
      reconciled++;
    }
  }
  if (reconciled > 0) events?.publish('operator-jobs');
  return reconciled;
}
