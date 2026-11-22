import type { AutonomyLevel } from '../agency-intelligence/types.js';

export type AgencyExecutionState = 'READY'|'BLOCKED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'STOPPED';
export type AgencyRetryClass = 'NOT_RETRYABLE'|'SAFE_IDEMPOTENT_RETRY';
export type AgencyExecutionBlockCode =
  | 'PLAN_UNAVAILABLE'|'PLAN_TAMPERED'|'GLOBAL_PAUSED'|'SCOPE_PAUSED'|'AUTONOMY_DENIED'
  | 'APPROVAL_REQUIRED'|'APPROVAL_INVALID'|'DO_NOT_CONTACT'|'CAPABILITY_UNAVAILABLE'
  | 'CAPABILITY_NOT_ALLOWED'|'PROJECT_REQUIRED'|'COOLDOWN_ACTIVE'|'STOPPED';

export interface AgencyExecutionRequest {
  id: string;
  tenantId: string;
  actionPlanId: string;
  actionPlanHash: string;
  requestHash: string;
  capabilityId: string;
  projectId?: string;
  input: Readonly<Record<string, unknown>>;
  approvalId?: string;
  capabilityApprovalReferenceId?: string;
  idempotencyKey: string;
  correlationId: string;
  requestedBy: string;
  requestedAt: string;
  state: AgencyExecutionState;
  /** Monotonic governed invocation/preflight attempt; absent legacy value is zero. */
  attempt?: number;
  stoppedAt?: string;
  stopReason?: string;
}

export interface AgencyPolicyDecision {
  allowed: boolean;
  requiredLevel: AutonomyLevel;
  effectiveLevel: AutonomyLevel;
  code?: AgencyExecutionBlockCode;
  reason: string;
}

export interface AgencyExecutionReceipt {
  id: string;
  tenantId: string;
  executionRequestId: string;
  actionPlanId: string;
  capabilityId: string;
  projectId?: string;
  correlationId: string;
  state: Exclude<AgencyExecutionState,'READY'|'RUNNING'>;
  attempt?: number;
  retryClass: AgencyRetryClass;
  /** A stop cannot undo an already-started capability. */
  completionAfterStop?: 'SUCCEEDED'|'FAILED'|'UNKNOWN';
  capabilityReceiptId?: string;
  capabilityResultHash?: string;
  blockCode?: AgencyExecutionBlockCode;
  errorCode?: string;
  startedAt: string;
  completedAt: string;
  nextRetryAt?: string;
}
