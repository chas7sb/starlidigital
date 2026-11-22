import { hashOpaque, redactAndBoundOutput } from '../security.js';
import type { CapabilityStateRepository, CustomerCapabilityCaller, IntegrationConnection } from '../types.js';
import type {
  ConnectorAuditRepository,
  ConnectorDiscoveryItem,
  ConnectorDiscoveryRequest,
  ConnectorHealthResult,
  ConnectorNormalizedEvent,
  ConnectorProviderError,
  ConnectorWebhookEnvelope
} from './types.js';
import { CustomerConnectorRegistry, connectionSupportsCapability } from './registry.js';
import { connectorAudit } from './audit.js';

const MAX_WEBHOOK_BYTES = 64 * 1024;

function safeProviderError(error: ConnectorProviderError): ConnectorProviderError {
  return redactAndBoundOutput({
    code: String(error.code).replace(/[^A-Z0-9_.:-]/gi, '_').slice(0, 100),
    kind: error.kind,
    message: String(error.message || 'Connector provider operation failed').slice(0, 240),
    retryable: !!error.retryable,
    retryAfterSeconds: Number.isFinite(error.retryAfterSeconds) ? Math.max(0, Math.min(86_400, Number(error.retryAfterSeconds))) : undefined
  }, 2048) as ConnectorProviderError;
}

export class CustomerConnectorService {
  private readonly seenEvents = new Set<string>();

  constructor(
    private readonly connectors: CustomerConnectorRegistry,
    private readonly state: CapabilityStateRepository,
    private readonly audits: ConnectorAuditRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  private async connection(caller: CustomerCapabilityCaller, connectionId: string): Promise<IntegrationConnection> {
    const connection = await this.state.getConnection(caller.tenantId, connectionId);
    if (!connection || connection.tenantId !== caller.tenantId) throw new Error('CONNECTOR_CONNECTION_UNAVAILABLE');
    return connection;
  }

  async discover(request: ConnectorDiscoveryRequest): Promise<ConnectorDiscoveryItem[]> {
    const started = this.clock();
    const connection = await this.connection(request.caller, request.connectionId);
    const adapter = this.connectors.getAdapter(connection.provider);
    if (!adapter) throw new Error('CONNECTOR_ADAPTER_UNAVAILABLE');
    let status: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED'; let errorCode: string | undefined;
    try {
      const catalog = await adapter.discoverCapabilities({ tenantId: request.caller.tenantId, subjectId: request.caller.subjectId, projectId: request.projectId, connection, now: this.clock() });
      const result: ConnectorDiscoveryItem[] = [];
      for (const item of catalog.slice(0, 100)) {
        let state: ConnectorDiscoveryItem['state'] = 'AVAILABLE'; let reason: string | undefined;
        if (connection.status !== 'CONNECTED') { state = 'CONNECTION_UNAVAILABLE'; reason = `Connection state is ${connection.status}`; }
        else if (!connectionSupportsCapability(connection, item)) { state = 'PROVIDER_SCOPE_REQUIRED'; reason = 'Provider connection lacks required scope'; }
        else if (item.definition.projectScoped && !request.projectId) { state = 'PROJECT_REQUIRED'; reason = 'Project context is required'; }
        else if (item.definition.projectScoped && request.projectId) {
          const grant = await this.state.getProjectGrant(request.caller.tenantId, request.projectId, item.definition.id);
          const scopes = new Set(grant?.scopes ?? []);
          if (!grant || grant.tenantId !== request.caller.tenantId || grant.projectId !== request.projectId || grant.capabilityId !== item.definition.id || !grant.enabled || item.definition.requiredScopes.some(scope => !scopes.has(scope))) {
            state = 'GRANT_REQUIRED'; reason = 'Project capability grant is required';
          }
        }
        result.push({ capabilityId: item.definition.id, displayName: item.definition.displayName, category: item.definition.category, sideEffectLevel: item.definition.sideEffectLevel, approvalRequired: item.definition.approvalRequired, autonomousAllowed: item.definition.autonomousAllowed, estimatedCost: item.definition.estimatedCost, rateLimit: item.definition.rateLimit, providerScopes: [...item.providerScopes], state, reason });
      }
      return result;
    } catch (error) {
      status = 'FAILED'; errorCode = adapter.normalizeError(error).code; throw error;
    } finally {
      const completed = this.clock();
      await this.audits.appendConnectorAudit(connectorAudit({ tenantId: request.caller.tenantId, subjectId: request.caller.subjectId, providerId: connection.provider, connectionId: connection.id, projectId: request.projectId, operation: 'DISCOVER', status, errorCode, startedAt: started.toISOString(), completedAt: completed.toISOString() }));
    }
  }

  async inspectHealth(caller: CustomerCapabilityCaller, connectionId: string): Promise<ConnectorHealthResult> {
    const started = this.clock(); const connection = await this.connection(caller, connectionId); const adapter = this.connectors.getAdapter(connection.provider);
    if (!adapter) throw new Error('CONNECTOR_ADAPTER_UNAVAILABLE');
    try {
      const result = await adapter.inspectHealth({ tenantId: caller.tenantId, subjectId: caller.subjectId, connection, now: this.clock() });
      await this.audits.appendConnectorAudit(connectorAudit({ tenantId: caller.tenantId, subjectId: caller.subjectId, providerId: connection.provider, connectionId, operation: 'HEALTH', status: 'SUCCEEDED', startedAt: started.toISOString(), completedAt: this.clock().toISOString() }));
      return { ...result, error: result.error ? safeProviderError(result.error) : undefined };
    } catch (error) {
      const normalized = safeProviderError(adapter.normalizeError(error));
      await this.audits.appendConnectorAudit(connectorAudit({ tenantId: caller.tenantId, subjectId: caller.subjectId, providerId: connection.provider, connectionId, operation: 'HEALTH', status: 'FAILED', errorCode: normalized.code, startedAt: started.toISOString(), completedAt: this.clock().toISOString() }));
      return { state: normalized.kind === 'REAUTH_REQUIRED' ? 'REAUTH_REQUIRED' : 'ERROR', checkedAt: this.clock().toISOString(), reauthRequired: normalized.kind === 'REAUTH_REQUIRED', error: normalized };
    }
  }

  async ingestWebhook(input: { caller: CustomerCapabilityCaller; envelope: ConnectorWebhookEnvelope }): Promise<{ duplicate: boolean; event?: ConnectorNormalizedEvent }> {
    const started = this.clock();
    const { caller, envelope } = input;
    if (!/^[A-Za-z0-9_.:-]{1,220}$/.test(envelope.connectionId)) throw new Error('CONNECTOR_WEBHOOK_INVALID_CONNECTION');
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(envelope.providerId)) throw new Error('CONNECTOR_WEBHOOK_INVALID_PROVIDER');
    if (!envelope.providerEventId || envelope.providerEventId.length > 300) throw new Error('CONNECTOR_WEBHOOK_INVALID_EVENT_ID');
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(envelope.eventType)) throw new Error('CONNECTOR_WEBHOOK_INVALID_EVENT_TYPE');
    if (envelope.occurredAt && !Number.isFinite(Date.parse(envelope.occurredAt))) throw new Error('CONNECTOR_WEBHOOK_INVALID_TIMESTAMP');
    const connection = await this.connection(caller, envelope.connectionId);
    if (connection.provider !== envelope.providerId) throw new Error('CONNECTOR_PROVIDER_MISMATCH');
    const adapter = this.connectors.getAdapter(connection.provider);
    if (!adapter?.ingestEvent) throw new Error('CONNECTOR_WEBHOOK_UNAVAILABLE');
    if (!envelope.signatureVerified) {
      await this.audits.appendConnectorAudit(connectorAudit({ tenantId: caller.tenantId, subjectId: caller.subjectId, providerId: connection.provider, connectionId: connection.id, operation: 'WEBHOOK', status: 'DENIED', errorCode: 'SIGNATURE_REQUIRED', providerEventIdHash: hashOpaque(envelope.providerEventId), startedAt: started.toISOString(), completedAt: this.clock().toISOString() }));
      throw new Error('CONNECTOR_WEBHOOK_SIGNATURE_REQUIRED');
    }
    const serialized = JSON.stringify(envelope.payload ?? null);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_WEBHOOK_BYTES) throw new Error('CONNECTOR_WEBHOOK_TOO_LARGE');
    const eventKey = hashOpaque(`${caller.tenantId}|${connection.id}|${envelope.providerEventId}`);
    if (this.seenEvents.has(eventKey)) {
      await this.audits.appendConnectorAudit(connectorAudit({ tenantId: caller.tenantId, subjectId: caller.subjectId, providerId: connection.provider, connectionId: connection.id, operation: 'WEBHOOK', status: 'DUPLICATE', providerEventIdHash: hashOpaque(envelope.providerEventId), startedAt: started.toISOString(), completedAt: this.clock().toISOString() }));
      return { duplicate: true };
    }
    const event = await adapter.ingestEvent(envelope, { tenantId: caller.tenantId, subjectId: caller.subjectId, connection, now: this.clock() });
    const bounded = redactAndBoundOutput(event, 32 * 1024) as ConnectorNormalizedEvent;
    this.seenEvents.add(eventKey);
    await this.audits.appendConnectorAudit(connectorAudit({ tenantId: caller.tenantId, subjectId: caller.subjectId, providerId: connection.provider, connectionId: connection.id, operation: 'WEBHOOK', status: 'SUCCEEDED', providerEventIdHash: hashOpaque(envelope.providerEventId), startedAt: started.toISOString(), completedAt: this.clock().toISOString() }));
    return { duplicate: false, event: bounded };
  }
}
