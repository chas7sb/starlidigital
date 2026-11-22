export type CapabilityCategory =
  | 'UTILITY'
  | 'PROJECTS'
  | 'ARTIFACTS'
  | 'BRAND'
  | 'BACKENDS'
  | 'FILES'
  | 'COMMUNICATION'
  | 'CALENDAR'
  | 'CRM'
  | 'COMMERCE'
  | 'DEVELOPER'
  | 'SOCIAL'
  | 'CUSTOM';

export type SideEffectLevel = 'NONE' | 'READ' | 'WRITE' | 'HIGH_IMPACT';
export type CapabilityAvailabilityState =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'DISABLED'
  | 'PROJECT_REQUIRED'
  | 'GRANT_REQUIRED'
  | 'CONNECTION_REQUIRED'
  | 'APPROVAL_REQUIRED';
export type CapabilityTrust = 'TRUSTED_PLATFORM' | 'TRUSTED_TENANT_DATA' | 'UNTRUSTED_EXTERNAL_DATA';

export interface CapabilityInputProperty {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  enum?: readonly (string | number | boolean)[];
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface CapabilityInputSchema {
  type: 'object';
  properties: Record<string, CapabilityInputProperty>;
  required?: readonly string[];
  additionalProperties: false;
}

export interface EstimatedCost {
  computeLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  financialCost: 'NONE' | 'PLATFORM_CREDITS' | 'EXTERNAL_PROVIDER';
  estimatedCreditUnits?: number;
}

export interface CapabilityRateLimit {
  maxPerMinute: number;
  maxPerHour?: number;
  scope: 'PER_TENANT';
  throttleBehavior: 'BLOCK';
}

export interface CapabilityDefinition {
  id: string;
  displayName: string;
  category: CapabilityCategory;
  description: string;
  sideEffectLevel: SideEffectLevel;
  requiredScopes: readonly string[];
  approvalRequired: boolean;
  autonomousAllowed: boolean;
  idempotent: boolean;
  async: boolean;
  estimatedCost: EstimatedCost;
  rateLimit: CapabilityRateLimit;
  connectionRequired: boolean;
  projectScoped: boolean;
  availability: 'AVAILABLE' | 'PREVIEW';
  inputSchema: CapabilityInputSchema;
  maxOutputBytes: number;
}

export interface TenantCapability {
  tenantId: string;
  capabilityId: string;
  enabled: boolean;
  connectionId?: string;
  updatedAt: string;
}

export interface ProjectCapabilityGrant {
  id: string;
  tenantId: string;
  projectId: string;
  capabilityId: string;
  scopes: readonly string[];
  enabled: boolean;
  createdAt: string;
  expiresAt?: string;
}

export type IntegrationConnectionStatus = 'CONFIGURATION_NEEDED' | 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'DEGRADED' | 'REAUTH_REQUIRED' | 'REVOKED' | 'ERROR';
export type IntegrationAuthMode = 'OAUTH2' | 'API_KEY' | 'MANAGED' | 'CUSTOM';

export interface IntegrationConnection {
  id: string;
  tenantId: string;
  provider: string;
  status: IntegrationConnectionStatus;
  credentialReference: string;
  authMode?: IntegrationAuthMode;
  grantedScopes?: readonly string[];
  healthCheckedAt?: string;
  lastErrorCode?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
  createdAt: string;
  updatedAt: string;
}

export interface PublicIntegrationConnection {
  id: string;
  provider: string;
  status: IntegrationConnection['status'];
  authMode?: IntegrationAuthMode;
  grantedScopes?: readonly string[];
  healthCheckedAt?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
  metadataTrust: 'UNTRUSTED_EXTERNAL_DATA';
  instructionsAllowed: false;
  updatedAt: string;
}

export interface ApprovalReference {
  id: string;
  tenantId: string;
  projectId?: string;
  capabilityId: string;
  status: 'APPROVED' | 'REVOKED' | 'EXPIRED';
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
}

export interface CapabilityAvailability {
  capabilityId: string;
  state: CapabilityAvailabilityState;
  reason?: string;
  connection?: PublicIntegrationConnection;
}

export interface CapabilityDescriptor extends CapabilityDefinition {
  runtimeAvailability: CapabilityAvailability;
}

export interface CustomerCapabilityCaller {
  subjectId: string;
  tenantId: string;
  scopes: readonly string[];
  source: 'STUDIO' | 'CLI' | 'CUSTOMER_AGENT' | 'CUSTOMER_MCP' | 'CHATGPT_CONNECTION';
  requestId?: string;
  autonomous?: boolean;
}

export interface CapabilityInvocationRequest {
  capabilityId: string;
  projectId?: string;
  input?: Record<string, unknown>;
  approvalReferenceId?: string;
  idempotencyKey?: string;
}

export interface CapabilityAuditReceipt {
  id: string;
  tenantId: string;
  subjectId: string;
  projectId?: string;
  capabilityId: string;
  sideEffectLevel: SideEffectLevel;
  status: 'SUCCEEDED' | 'DENIED' | 'FAILED';
  requestId?: string;
  idempotencyKeyHash?: string;
  resultHash?: string;
  errorCode?: string;
  startedAt: string;
  completedAt: string;
}

export interface CapabilityInvocationResult {
  ok: boolean;
  capabilityId: string;
  data?: unknown;
  trust: CapabilityTrust;
  instructionsAllowed: false;
  receipt: CapabilityAuditReceipt;
  cached?: boolean;
  error?: { code: string; message: string };
}

export interface CapabilityHandlerContext {
  tenantId: string;
  subjectId: string;
  projectId?: string;
  connectionCredentialReference?: string;
  approval?: ApprovalReference;
  now: Date;
}

export interface CapabilityHandlerResult {
  data: unknown;
  trust?: CapabilityTrust;
}

export interface CapabilityHandler {
  isAvailable?: () => boolean;
  execute(input: Record<string, unknown>, context: CapabilityHandlerContext): Promise<CapabilityHandlerResult>;
}

export interface BackendSummary {
  backendProjectId: string;
  serviceId: string;
  name: string;
  stack: 'NODE_EXPRESS_PRISMA';
  environment: 'STAGING' | 'PRODUCTION' | null;
  lifecycle: 'DRAFT' | 'GENERATING' | 'VALIDATING' | 'BUILDING' | 'READY' | 'DEPLOYING' | 'LIVE' | 'BLOCKED' | 'NEEDS_REVIEW' | 'FAILED' | 'ROLLED_BACK';
  versionId: string | null;
  endpoint: string | null;
  health: 'UNKNOWN' | 'HEALTHY' | 'UNHEALTHY';
  readiness: 'UNKNOWN' | 'READY' | 'NOT_READY';
  database: { engine: 'POSTGRESQL'; status: 'PLANNED' | 'BOUND' | 'DISABLED' } | null;
  migrationRisk: 'SAFE_ADDITIVE' | 'REVIEW_REQUIRED' | 'BLOCKED' | null;
  updatedAt: string;
}

export interface CapabilityDataAdapterResult<T = unknown> {
  available: boolean;
  data?: T;
  reason?: string;
  trust?: CapabilityTrust;
}

export interface CustomerCapabilityAdapters {
  readProject?: (input: { tenantId: string; projectId: string; subjectId: string }) => Promise<CapabilityDataAdapterResult>;
  readArtifact?: (input: { tenantId: string; projectId: string; artifactId: string; subjectId: string }) => Promise<CapabilityDataAdapterResult>;
  readBrandContext?: (input: { tenantId: string; projectId: string; subjectId: string }) => Promise<CapabilityDataAdapterResult>;
  readBackendSummary?: (input: { tenantId: string; projectId: string; backendProjectId?: string; subjectId: string }) => Promise<CapabilityDataAdapterResult<BackendSummary>>;
}

export interface IdempotencyCacheEntry {
  tenantId: string;
  capabilityId: string;
  projectId?: string;
  keyHash: string;
  requestHash: string;
  result: CapabilityInvocationResult;
}

export type IdempotencyReservationStatus='CLAIMED'|'COMPLETED'|'IN_PROGRESS'|'CONFLICT';

export interface CapabilityStateRepository {
  /** Atomic synchronous claim before a write; unresolved claims never auto-expire. */
  reserveIdempotency?(entry:Omit<IdempotencyCacheEntry,'result'>):IdempotencyReservationStatus;
  /** Synchronous final gate, after async preflight and immediately before a write. */
  mutationPaused?(tenantId:string):boolean;
  getTenantCapability(tenantId: string, capabilityId: string): Promise<TenantCapability | undefined>;
  getProjectGrant(tenantId: string, projectId: string, capabilityId: string): Promise<ProjectCapabilityGrant | undefined>;
  getConnection(tenantId: string, connectionId: string): Promise<IntegrationConnection | undefined>;
  getApproval(referenceId: string): Promise<ApprovalReference | undefined>;
  appendAudit(receipt: CapabilityAuditReceipt): Promise<void>;
  getIdempotency(tenantId: string, capabilityId: string, projectId: string | undefined, keyHash: string): Promise<IdempotencyCacheEntry | undefined>;
  putIdempotency(entry: IdempotencyCacheEntry): Promise<void>;
}
