/**
 * STARLI OS V2 — UNIFIED CAPABILITY SURFACE
 * Authoritative types and schemas for multi-surface tool discovery,
 * invocation, receipt generation, and prompt injection security boundaries.
 */

export type UnifiedToolCategory =
  | 'BUSINESS'
  | 'BUILD'
  | 'OBSERVE'
  | 'REACH'
  | 'OPERATIONS'
  | 'GOVERNANCE';

export type SideEffectLevel = 'NONE' | 'READ' | 'WRITE' | 'HIGH_IMPACT';

export type CapabilityTrust =
  | 'TRUSTED_PLATFORM'
  | 'TRUSTED_TENANT_DATA'
  | 'UNTRUSTED_EXTERNAL_DATA';

export type CapabilityAvailabilityState =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'DISABLED'
  | 'PROJECT_REQUIRED'
  | 'GRANT_REQUIRED'
  | 'CONNECTION_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'PAUSED';

export type SurfaceConsumer =
  | 'ORCHESTRATOR'
  | 'CLI'
  | 'CUSTOMER_AGENT'
  | 'WINDOWS_MCP'
  | 'CHATGPT_MCP';

export type AutonomyLevel =
  | 'OBSERVE'
  | 'RECOMMEND'
  | 'DRAFT'
  | 'EXECUTE_SAFE'
  | 'EXECUTE_APPROVED';

export interface ToolInputProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: readonly (string | number | boolean)[];
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: ToolInputProperty;
  properties?: Record<string, ToolInputProperty>;
  required?: readonly string[];
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolInputProperty>;
  required?: readonly string[];
  additionalProperties: false;
}

export interface ToolRateLimit {
  maxPerMinute: number;
  maxPerHour?: number;
  scope: 'PER_TENANT' | 'PER_USER';
}

export interface ToolEstimatedCost {
  computeLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  financialCost: 'NONE' | 'PLATFORM_CREDITS' | 'EXTERNAL_PROVIDER';
  estimatedCreditUnits?: number;
}

export interface UnifiedToolDefinition {
  id: string;
  displayName: string;
  category: UnifiedToolCategory;
  description: string;
  sideEffectLevel: SideEffectLevel;
  requiredScopes: readonly string[];
  allowedSurfaces: readonly SurfaceConsumer[];
  approvalRequired: boolean;
  autonomousAllowed: boolean;
  projectScoped: boolean;
  connectionRequired: boolean;
  idempotent: boolean;
  async: boolean;
  rateLimit: ToolRateLimit;
  estimatedCost: ToolEstimatedCost;
  inputSchema: ToolInputSchema;
  outputDescription: string;
  promptBoundaryPolicy: {
    untrustedInputSources?: readonly string[];
    outputFencingRequired: boolean;
  };
}

export interface CapabilityCallerContext {
  subjectId: string;
  tenantId: string;
  activeProjectId?: string;
  scopes: readonly string[];
  surface: SurfaceConsumer;
  autonomyLevel: AutonomyLevel;
  requestId?: string;
  isAutonomous?: boolean;
}

export interface CryptographicReceipt {
  receiptId: string;
  tenantId: string;
  subjectId: string;
  projectId?: string;
  toolId: string;
  sideEffectLevel: SideEffectLevel;
  status: 'SUCCEEDED' | 'DENIED' | 'FAILED' | 'QUEUED' | 'REQUIRES_APPROVAL' | 'PAUSED';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  idempotencyKeyHash?: string;
  approvalReferenceId?: string;
  payloadDigest: string;
  signature?: string;
}

export interface DataFenceMetadata {
  untrustedContentDetected: boolean;
  fencedBoundaryCount: number;
  sources: readonly string[];
}

export interface UnifiedExecutionResult<TData = unknown> {
  ok: boolean;
  toolId: string;
  data: TData | null;
  trust: CapabilityTrust;
  instructionsAllowed: false; // Invariant: Tool output is strictly inert data
  dataFences?: DataFenceMetadata;
  receipt: CryptographicReceipt;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface DiscoveredToolDescriptor {
  id: string;
  name: string;
  displayName: string;
  category: UnifiedToolCategory;
  description: string;
  sideEffectLevel: SideEffectLevel;
  inputSchema: ToolInputSchema;
  metadata: {
    category: UnifiedToolCategory;
    sideEffectLevel: SideEffectLevel;
    approvalRequired: boolean;
    autonomousAllowed: boolean;
    projectScoped: boolean;
    connectionRequired: boolean;
    async: boolean;
    idempotent: boolean;
    rateLimit: ToolRateLimit;
    estimatedCost: ToolEstimatedCost;
    availabilityState: CapabilityAvailabilityState;
    promptBoundaryPolicy: {
      outputFencingRequired: boolean;
    };
  };
}
