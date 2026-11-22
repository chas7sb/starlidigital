import type {
  CapabilityDefinition,
  CapabilityTrust,
  CustomerCapabilityCaller,
  IntegrationConnection
} from '../types.js';

export type ConnectorCategory = 'MAIL' | 'CALENDAR' | 'FILES' | 'CRM' | 'COMMERCE' | 'DEVELOPER' | 'CUSTOM';
export type ConnectorAuthMode = 'OAUTH2' | 'API_KEY' | 'MANAGED' | 'CUSTOM';
export type ConnectorImplementationStatus = 'METADATA_ONLY' | 'TEST_ONLY' | 'AVAILABLE';
export type ConnectorErrorKind =
  | 'AUTHENTICATION'
  | 'REAUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TRANSIENT'
  | 'UNKNOWN';

export interface ConnectorProviderMetadata {
  id: string;
  displayName: string;
  category: ConnectorCategory;
  description: string;
  authMode: ConnectorAuthMode;
  implementationStatus: ConnectorImplementationStatus;
  liveAuthAvailable: boolean;
  supportedScopes: readonly string[];
  requiredConfiguration: readonly string[];
}

export interface ConnectorProviderError {
  code: string;
  kind: ConnectorErrorKind;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export interface ConnectorHealthResult {
  state: IntegrationConnection['status'];
  checkedAt: string;
  reauthRequired: boolean;
  error?: ConnectorProviderError;
}

export interface ConnectorCapabilityDefinition {
  definition: CapabilityDefinition;
  providerScopes: readonly string[];
}

export interface ConnectorAdapterContext {
  tenantId: string;
  subjectId: string;
  projectId?: string;
  connection: IntegrationConnection;
  now: Date;
}

export interface ConnectorInvocationResult {
  data: unknown;
  trust?: CapabilityTrust;
}

export interface ConnectorWebhookEnvelope {
  connectionId: string;
  providerId: string;
  providerEventId: string;
  eventType: string;
  occurredAt?: string;
  signatureVerified: boolean;
  payload: unknown;
}

export interface ConnectorNormalizedEvent {
  type: string;
  occurredAt: string;
  entityRefs?: readonly string[];
  data?: unknown;
  trust: 'UNTRUSTED_EXTERNAL_DATA';
  instructionsAllowed: false;
}

export interface CustomerConnectorAdapter {
  readonly metadata: ConnectorProviderMetadata;
  readonly capabilityCatalog: readonly ConnectorCapabilityDefinition[];
  discoverCapabilities(context: ConnectorAdapterContext): Promise<readonly ConnectorCapabilityDefinition[]>;
  inspectHealth(context: ConnectorAdapterContext): Promise<ConnectorHealthResult>;
  invokeCapability(
    capabilityId: string,
    input: Record<string, unknown>,
    context: ConnectorAdapterContext
  ): Promise<ConnectorInvocationResult>;
  normalizeError(error: unknown): ConnectorProviderError;
  ingestEvent?(envelope: ConnectorWebhookEnvelope, context: ConnectorAdapterContext): Promise<ConnectorNormalizedEvent>;
}

export type ConnectorAuditOperation = 'DISCOVER' | 'HEALTH' | 'INVOKE' | 'WEBHOOK';
export type ConnectorAuditStatus = 'SUCCEEDED' | 'DENIED' | 'FAILED' | 'DUPLICATE';

export interface ConnectorAuditReceipt {
  id: string;
  tenantId: string;
  subjectId: string;
  providerId: string;
  connectionId?: string;
  projectId?: string;
  capabilityId?: string;
  operation: ConnectorAuditOperation;
  status: ConnectorAuditStatus;
  errorCode?: string;
  providerEventIdHash?: string;
  startedAt: string;
  completedAt: string;
}

export interface ConnectorAuditRepository {
  appendConnectorAudit(receipt: ConnectorAuditReceipt): Promise<void>;
  listConnectorAudits?(tenantId: string, limit?: number): Promise<readonly ConnectorAuditReceipt[]> | readonly ConnectorAuditReceipt[];
}

export interface ConnectorDiscoveryItem {
  capabilityId: string;
  displayName: string;
  category: CapabilityDefinition['category'];
  sideEffectLevel: CapabilityDefinition['sideEffectLevel'];
  approvalRequired: boolean;
  autonomousAllowed: boolean;
  estimatedCost: CapabilityDefinition['estimatedCost'];
  rateLimit: CapabilityDefinition['rateLimit'];
  providerScopes: readonly string[];
  state: 'AVAILABLE' | 'PROJECT_REQUIRED' | 'GRANT_REQUIRED' | 'PROVIDER_SCOPE_REQUIRED' | 'CONNECTION_UNAVAILABLE';
  reason?: string;
}

export interface ConnectorDiscoveryRequest {
  caller: CustomerCapabilityCaller;
  connectionId: string;
  projectId?: string;
}
