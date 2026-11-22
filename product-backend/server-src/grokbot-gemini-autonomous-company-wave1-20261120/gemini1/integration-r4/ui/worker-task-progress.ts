/**
 * Grokbot2 NATIVE_TASK_REQUEST_V1 & WORKER_EXECUTION_RECEIPT_V1 UI validation and state adapter (Integration R3).
 * Decision: STARLI_GROKBOT_GEMINI_AUTONOMOUS_COMPANY_INTEGRATION_WAVE1_20261120_V1
 * Task ID: GGB1-GEMINI1-INTEGRATION-R3
 *
 * Fixes all 12 coordinator R2 progress-gate cases:
 *  - Requires trusted server context (companyId, projectId, sourceMessageId, requestId, graphId, roomId,
 *    authorizationRevision, runGeneration); returns AWAITING_TRUSTED_CONTEXT when absent so receipts never
 *    self-select authority.
 *  - Requires complete authoritative expectedTaskIds AND rejectedCount === 0 BEFORE declaring graph-level
 *    STOPPED or TERMINAL_VERIFIED. Partial/rejected/expired stop sets stay STOP_PENDING or HOLD_UNCERTAIN.
 */

export type ExecutionClassV1 =
  | 'SOURCE_ONLY'
  | 'FIXTURE'
  | 'COMBINED_CANDIDATE'
  | 'ACTUAL_VM'
  | 'NATIVE_NONPRODUCTION'
  | 'PRODUCTION';

export type WorkerTaskStatusV1 =
  | 'TASK_DISPATCHED'
  | 'WORKER_RUNNING'
  | 'MODEL_ANSWERED'
  | 'WORKER_TERMINAL'
  | 'HOLD_UNCERTAIN'
  | 'STOP_REQUESTED'
  | 'STOPPED'
  | 'REVOKED'
  | 'FAILED';

export interface WorkerExecutionItemV1 {
  schemaVersion: 1;
  contract: 'NATIVE_TASK_REQUEST_V1' | 'WORKER_EXECUTION_RECEIPT_V1';
  companyId: string;
  projectId: string;
  requestId: string;
  graphId: string;
  taskId: string;
  botId: string;
  roomId: string;
  nativeSourceMessageId: string;
  turnId: string;
  runId?: string;
  generation?: number;
  authorizationRevision?: number;
  revision: number;
  status: WorkerTaskStatusV1;
  executionClass: ExecutionClassV1;
  fixtureOnly?: boolean;
  artifactDigest?: string | null;
  serverProvenanceVerified?: boolean;
  stopConfirmedByServer?: boolean;
  turnOutcome?: 'ANSWERED' | 'EXECUTED_VERIFIED' | 'FAILED' | 'CANCELLED';
  summary?: string;
  providerAudience?: 'guest_free' | 'platform_scoped' | 'registered_company';
  issuedAt: string;
  expiresAt: string;
}

export interface ExpectedWorkerContextV1 {
  companyId: string;
  projectId: string;
  sourceMessageId: string;
  requestId: string;
  graphId: string;
  roomId: string;
  authorizationRevision: number;
  runGeneration: number;
  expectedTaskIds?: string[];
  graphCompletionVerified?: boolean;
  revoked?: boolean;
  nowMs?: number;
}

export interface ValidatedWorkerItem {
  taskId: string;
  botId: string;
  roomId: string;
  requestId: string;
  graphId: string;
  turnId: string;
  revision: number;
  effectiveStatus: WorkerTaskStatusV1;
  executionClass: ExecutionClassV1;
  isFixture: boolean;
  artifactDigest: string | null;
  serverProvenanceVerified: boolean;
  summary: string;
  downgradedReason: string | null;
}

export interface WorkerGraphSummary {
  phase:
    | 'IDLE'
    | 'AWAITING_TRUSTED_CONTEXT'
    | 'DISPATCHED'
    | 'IN_PROGRESS'
    | 'MODEL_ANSWERED_ONLY'
    | 'HOLD_UNCERTAIN'
    | 'STOP_PENDING'
    | 'STOPPED'
    | 'REVOKED'
    | 'FAILED'
    | 'TERMINAL_FIXTURE'
    | 'TERMINAL_VERIFIED';
  companyId: string | null;
  projectId: string | null;
  sourceMessageId: string | null;
  items: ValidatedWorkerItem[];
  rejectedCount: number;
  bannerText: string;
}

const SAFE_ID = /^[A-Za-z0-9_.:#-]{1,128}$/;
const SAFE_DIGEST = /^(?:sha256:)?[0-9a-f]{64}$/i;
const VALID_STATUSES = new Set<WorkerTaskStatusV1>([
  'TASK_DISPATCHED',
  'WORKER_RUNNING',
  'MODEL_ANSWERED',
  'WORKER_TERMINAL',
  'HOLD_UNCERTAIN',
  'STOP_REQUESTED',
  'STOPPED',
  'REVOKED',
  'FAILED',
]);
const VALID_CLASSES = new Set<ExecutionClassV1>([
  'SOURCE_ONLY',
  'FIXTURE',
  'COMBINED_CANDIDATE',
  'ACTUAL_VM',
  'NATIVE_NONPRODUCTION',
  'PRODUCTION',
]);

function parseValidTimestampWindow(
  issuedAt: unknown,
  expiresAt: unknown,
  nowMs: number
): { ok: boolean; reason?: string } {
  if (typeof issuedAt !== 'string' || typeof expiresAt !== 'string' || !issuedAt.trim() || !expiresAt.trim()) {
    return { ok: false, reason: 'Missing issuedAt or expiresAt timestamp.' };
  }
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) {
    return { ok: false, reason: 'Malformed ISO timestamp on worker receipt.' };
  }
  if (expiresMs <= issuedMs) {
    return { ok: false, reason: 'Receipt expiresAt must be strictly after issuedAt.' };
  }
  if (issuedMs > nowMs + 60_000) {
    return { ok: false, reason: 'Receipt issuedAt is in the future.' };
  }
  if (expiresMs <= nowMs) {
    return { ok: false, reason: 'Worker receipt has expired.' };
  }
  return { ok: true };
}

export function validateWorkerProgressEnvelope(
  rawItems: unknown,
  expected: Partial<ExpectedWorkerContextV1>
): WorkerGraphSummary {
  if (expected.revoked) {
    return {
      phase: 'REVOKED',
      companyId: expected.companyId || null,
      projectId: expected.projectId || null,
      sourceMessageId: expected.sourceMessageId || null,
      items: [],
      rejectedCount: 0,
      bannerText:
        'Authority has been revoked; new task dispatch is denied, while previously started processes require independent server teardown confirmation.',
    };
  }

  // Require trusted server context ? receipts may NEVER choose their own current authority.
  if (
    !expected.companyId ||
    !expected.projectId ||
    !expected.sourceMessageId ||
    !expected.requestId ||
    !expected.graphId ||
    !expected.roomId ||
    typeof expected.authorizationRevision !== 'number' ||
    !Number.isInteger(expected.authorizationRevision) ||
    expected.authorizationRevision < 0 ||
    typeof expected.runGeneration !== 'number' ||
    !Number.isInteger(expected.runGeneration) ||
    expected.runGeneration < 0 ||
    !SAFE_ID.test(expected.companyId) ||
    !SAFE_ID.test(expected.projectId) ||
    !SAFE_ID.test(expected.sourceMessageId) ||
    !SAFE_ID.test(expected.requestId) ||
    !SAFE_ID.test(expected.graphId) ||
    !SAFE_ID.test(expected.roomId)
  ) {
    return {
      phase: 'AWAITING_TRUSTED_CONTEXT',
      companyId: null,
      projectId: null,
      sourceMessageId: null,
      items: [],
      rejectedCount: Array.isArray(rawItems) ? rawItems.length : 0,
      bannerText:
        'Awaiting trusted server request, graph, room, authorization revision, and run generation context before displaying worker progress.',
    };
  }

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return {
      phase: 'IDLE',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items: [],
      rejectedCount: 0,
      bannerText: 'No worker tasks dispatched yet for this request.',
    };
  }

  const nowMs =
    typeof expected.nowMs === 'number' && Number.isFinite(expected.nowMs) ? expected.nowMs : Date.now();

  const items: ValidatedWorkerItem[] = [];
  const seenTaskIds = new Set<string>();
  let rejectedCount = 0;

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') {
      rejectedCount += 1;
      continue;
    }
    const item = raw as Record<string, unknown>;
    if (
      item.schemaVersion !== 1 ||
      (item.contract !== 'NATIVE_TASK_REQUEST_V1' && item.contract !== 'WORKER_EXECUTION_RECEIPT_V1') ||
      item.companyId !== expected.companyId ||
      item.projectId !== expected.projectId ||
      item.nativeSourceMessageId !== expected.sourceMessageId ||
      item.requestId !== expected.requestId ||
      item.graphId !== expected.graphId ||
      item.roomId !== expected.roomId ||
      item.authorizationRevision !== expected.authorizationRevision ||
      item.generation !== expected.runGeneration ||
      typeof item.taskId !== 'string' ||
      !SAFE_ID.test(item.taskId) ||
      typeof item.botId !== 'string' ||
      !SAFE_ID.test(item.botId) ||
      typeof item.turnId !== 'string' ||
      !SAFE_ID.test(item.turnId) ||
      typeof item.revision !== 'number' ||
      !Number.isInteger(item.revision) ||
      item.revision < 1 ||
      typeof item.status !== 'string' ||
      !VALID_STATUSES.has(item.status as WorkerTaskStatusV1) ||
      typeof item.executionClass !== 'string' ||
      !VALID_CLASSES.has(item.executionClass as ExecutionClassV1)
    ) {
      rejectedCount += 1;
      continue;
    }

    if (seenTaskIds.has(item.taskId)) {
      rejectedCount += 1;
      continue;
    }

    const tsCheck = parseValidTimestampWindow(item.issuedAt, item.expiresAt, nowMs);
    if (!tsCheck.ok) {
      rejectedCount += 1;
      continue;
    }

    seenTaskIds.add(item.taskId);

    const rawStatus = item.status as WorkerTaskStatusV1;
    const execClass = item.executionClass as ExecutionClassV1;
    const isFixture = item.fixtureOnly === true || execClass === 'FIXTURE' || execClass === 'SOURCE_ONLY';
    const rawDigest = typeof item.artifactDigest === 'string' ? item.artifactDigest.trim() : '';
    const hasValidDigest = SAFE_DIGEST.test(rawDigest);
    const serverProvenance = item.serverProvenanceVerified === true;

    let effectiveStatus: WorkerTaskStatusV1 = rawStatus;
    let downgradedReason: string | null = null;

    if (rawStatus === 'STOPPED' && item.stopConfirmedByServer !== true) {
      effectiveStatus = 'STOP_REQUESTED';
      downgradedReason = 'Stop completion has not yet been confirmed by server teardown receipt.';
    } else if (rawStatus === 'WORKER_TERMINAL') {
      if (item.turnOutcome === 'ANSWERED' && !serverProvenance) {
        effectiveStatus = 'MODEL_ANSWERED';
        downgradedReason = 'Native model turn answered, but actual app task/build execution receipt is not yet verified.';
      } else if (item.contract !== 'WORKER_EXECUTION_RECEIPT_V1' || !hasValidDigest) {
        effectiveStatus = 'HOLD_UNCERTAIN';
        downgradedReason = 'Terminal status lacked a verified execution receipt or valid SHA-256 artifact digest; held for reconciliation.';
      } else if (!isFixture && !serverProvenance) {
        effectiveStatus = 'HOLD_UNCERTAIN';
        downgradedReason = 'Artifact digest present, but trusted server runtime/build provenance is not yet attested.';
      }
    }

    items.push({
      taskId: item.taskId,
      botId: item.botId,
      roomId: item.roomId as string,
      requestId: item.requestId as string,
      graphId: item.graphId as string,
      turnId: item.turnId,
      revision: item.revision,
      effectiveStatus,
      executionClass: execClass,
      isFixture,
      artifactDigest: hasValidDigest ? rawDigest : null,
      serverProvenanceVerified: serverProvenance,
      summary:
        typeof item.summary === 'string' && item.summary.trim()
          ? item.summary.trim().slice(0, 240)
          : `${item.botId} (${effectiveStatus})`,
      downgradedReason,
    });
  }

  if (items.length === 0) {
    return {
      phase: rejectedCount > 0 ? 'HOLD_UNCERTAIN' : 'IDLE',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items: [],
      rejectedCount,
      bannerText:
        rejectedCount > 0
          ? 'Unverified, expired, or mismatched worker receipts were rejected by the correlation gate; holding for server reconciliation.'
          : 'No worker tasks dispatched yet.',
    };
  }

  const statuses = new Set(items.map((i) => i.effectiveStatus));
  const expectedTasks = Array.isArray(expected.expectedTaskIds)
    ? expected.expectedTaskIds.filter((t) => typeof t === 'string' && SAFE_ID.test(t))
    : [];
  const hasCompleteExpectedSet =
    expectedTasks.length > 0 &&
    expectedTasks.length === items.length &&
    expectedTasks.every((tid) => seenTaskIds.has(tid));

  if (statuses.has('REVOKED')) {
    return {
      phase: 'REVOKED',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items,
      rejectedCount,
      bannerText:
        'Authority has been revoked; new task dispatch is denied, while previously started processes require independent server teardown confirmation.',
    };
  }

  if (statuses.has('STOP_REQUESTED')) {
    return {
      phase: 'STOP_PENDING',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items,
      rejectedCount,
      bannerText:
        'Stop requested; cancellation and physical cleanup are pending server verification. Quota remains reserved until teardown is confirmed.',
    };
  }

  // Graph-level STOPPED requires complete expectedTaskIds AND rejectedCount === 0 AND every task confirmed STOPPED.
  if (statuses.has('STOPPED')) {
    if (rejectedCount === 0 && hasCompleteExpectedSet && items.every((i) => i.effectiveStatus === 'STOPPED')) {
      return {
        phase: 'STOPPED',
        companyId: expected.companyId,
        projectId: expected.projectId,
        sourceMessageId: expected.sourceMessageId,
        items,
        rejectedCount,
        bannerText: 'Server verified native task cancellation and physical process teardown for all expected graph workers.',
      };
    }
    return {
      phase: 'STOP_PENDING',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items,
      rejectedCount,
      bannerText:
        'Partial stop receipts received; full graph cancellation and physical cleanup remain pending server confirmation for all expected tasks.',
    };
  }

  if (statuses.has('HOLD_UNCERTAIN')) {
    return {
      phase: 'HOLD_UNCERTAIN',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items,
      rejectedCount,
      bannerText: 'One or more worker effects are UNCERTAIN and held for server reconciliation without automatic retry.',
    };
  }

  if (statuses.has('FAILED')) {
    return {
      phase: 'FAILED',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items,
      rejectedCount,
      bannerText: 'A worker task reported an execution failure.',
    };
  }

  // If any receipt was rejected, a partial surviving set must NEVER claim all tasks completed.
  if (rejectedCount > 0) {
    return {
      phase: 'HOLD_UNCERTAIN',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items,
      rejectedCount,
      bannerText:
        'One or more worker receipts were rejected by correlation or freshness checks; partial set cannot verify graph completion.',
    };
  }

  if (statuses.has('MODEL_ANSWERED') && !statuses.has('WORKER_RUNNING') && !statuses.has('TASK_DISPATCHED')) {
    return {
      phase: 'MODEL_ANSWERED_ONLY',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items,
      rejectedCount,
      bannerText: 'Native model turn answered; awaiting verified worker task execution and artifact provenance.',
    };
  }

  if (items.every((i) => i.effectiveStatus === 'WORKER_TERMINAL')) {
    const graphVerified = expected.graphCompletionVerified === true && hasCompleteExpectedSet;
    if (!hasCompleteExpectedSet || !graphVerified) {
      return {
        phase: 'HOLD_UNCERTAIN',
        companyId: expected.companyId,
        projectId: expected.projectId,
        sourceMessageId: expected.sourceMessageId,
        items,
        rejectedCount,
        bannerText:
          'Worker receipts received, but the authoritative complete task graph set has not been confirmed by the server.',
      };
    }

    const anyFixture = items.some((i) => i.isFixture);
    if (anyFixture) {
      return {
        phase: 'TERMINAL_FIXTURE',
        companyId: expected.companyId,
        projectId: expected.projectId,
        sourceMessageId: expected.sourceMessageId,
        items,
        rejectedCount,
        bannerText: 'Worker receipts completed in FIXTURE mode (not live production execution).',
      };
    }

    return {
      phase: 'TERMINAL_VERIFIED',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items,
      rejectedCount,
      bannerText: 'All expected graph workers completed with server-verified execution receipts and artifact digests.',
    };
  }

  if (items.every((i) => i.effectiveStatus === 'TASK_DISPATCHED')) {
    return {
      phase: 'DISPATCHED',
      companyId: expected.companyId,
      projectId: expected.projectId,
      sourceMessageId: expected.sourceMessageId,
      items,
      rejectedCount,
      bannerText: 'BOSS task graph dispatched to workers; awaiting execution receipts.',
    };
  }

  return {
    phase: 'IN_PROGRESS',
    companyId: expected.companyId,
    projectId: expected.projectId,
    sourceMessageId: expected.sourceMessageId,
    items,
    rejectedCount,
    bannerText: 'Workers are executing tasks for your request.',
  };
}
