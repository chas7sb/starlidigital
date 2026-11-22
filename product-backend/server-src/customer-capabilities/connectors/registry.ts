import type { CustomerCapabilityRegistry } from '../registry.js';
import type { CapabilityStateRepository, IntegrationConnection } from '../types.js';
import { validateOpaqueCredentialReference } from '../security.js';
import type {
  ConnectorAuditRepository,
  ConnectorCapabilityDefinition,
  ConnectorProviderMetadata,
  CustomerConnectorAdapter
} from './types.js';
import { connectorAudit } from './audit.js';
import { CUSTOMER_CONNECTOR_PROVIDER_CATALOG } from './catalog.js';

const PROVIDER_ID = /^[a-z][a-z0-9-]{1,63}$/;
const SCOPE = /^[a-z][a-z0-9._:-]{1,79}$/;

export function validateConnectorMetadata(metadata: ConnectorProviderMetadata): void {
  if (!PROVIDER_ID.test(metadata.id)) throw new Error('Invalid connector provider ID');
  if (!metadata.displayName || metadata.displayName.length > 100) throw new Error('Invalid connector display name');
  if (!metadata.description || metadata.description.length > 300) throw new Error('Invalid connector description');
  if (metadata.implementationStatus === 'METADATA_ONLY' && metadata.liveAuthAvailable) throw new Error('Metadata-only connectors cannot claim live authentication');
  if (metadata.supportedScopes.length > 100 || metadata.supportedScopes.some(scope => !SCOPE.test(scope))) throw new Error('Invalid connector scope catalog');
  if (metadata.requiredConfiguration.length > 20 || metadata.requiredConfiguration.some(item => item.length > 160)) throw new Error('Invalid connector configuration metadata');
}

function validateConnectorCapability(provider: ConnectorProviderMetadata, capability: ConnectorCapabilityDefinition): void {
  if (!capability.definition.connectionRequired) throw new Error('Connector capabilities must require a connection');
  if (!capability.definition.id.startsWith(`connector.${provider.id}.`)) throw new Error('Connector capability ID must be provider-namespaced');
  const supported = new Set(provider.supportedScopes);
  if (capability.providerScopes.some(scope => !supported.has(scope))) throw new Error('Connector capability requests an undeclared provider scope');
}

export class CustomerConnectorRegistry {
  private readonly providers = new Map<string, ConnectorProviderMetadata>();
  private readonly adapters = new Map<string, CustomerConnectorAdapter>();

  constructor(metadata: readonly ConnectorProviderMetadata[] = CUSTOMER_CONNECTOR_PROVIDER_CATALOG) {
    for (const item of metadata) this.registerMetadata(item);
  }

  registerMetadata(metadata: ConnectorProviderMetadata): void {
    validateConnectorMetadata(metadata);
    const previous = this.providers.get(metadata.id);
    if (previous && this.adapters.has(metadata.id)) throw new Error(`Connector provider already has an adapter: ${metadata.id}`);
    this.providers.set(metadata.id, structuredClone(metadata));
  }

  registerAdapter(adapter: CustomerConnectorAdapter): void {
    validateConnectorMetadata(adapter.metadata);
    if (adapter.metadata.implementationStatus === 'METADATA_ONLY') throw new Error('Connector adapters cannot be metadata-only');
    if (this.adapters.has(adapter.metadata.id)) throw new Error(`Connector adapter already registered: ${adapter.metadata.id}`);
    for (const capability of adapter.capabilityCatalog) validateConnectorCapability(adapter.metadata, capability);
    this.providers.set(adapter.metadata.id, structuredClone(adapter.metadata));
    this.adapters.set(adapter.metadata.id, adapter);
  }

  getProvider(id: string): ConnectorProviderMetadata | undefined { const value = this.providers.get(id); return value ? structuredClone(value) : undefined; }
  getAdapter(id: string): CustomerConnectorAdapter | undefined { return this.adapters.get(id); }
  listProviders(options: { includeTest?: boolean } = {}): ConnectorProviderMetadata[] {
    return [...this.providers.values()]
      .filter(item => options.includeTest || item.implementationStatus !== 'TEST_ONLY')
      .map(item => structuredClone(item))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}

export function registerConnectorCapabilities(
  registry: CustomerCapabilityRegistry,
  state: CapabilityStateRepository,
  connector: CustomerConnectorAdapter,
  clock: () => Date = () => new Date(),
  audits?: ConnectorAuditRepository
): void {
  for (const projected of connector.capabilityCatalog) {
    validateConnectorCapability(connector.metadata, projected);
    registry.register(projected.definition, {
      isAvailable: () => connector.metadata.implementationStatus !== 'METADATA_ONLY',
      async execute(input, context) {
        const tenantCapability = await state.getTenantCapability(context.tenantId, projected.definition.id);
        if (!tenantCapability?.connectionId) throw new Error('CONNECTOR_CONNECTION_REQUIRED');
        const connection = await state.getConnection(context.tenantId, tenantCapability.connectionId);
        if (!connection || connection.tenantId !== context.tenantId || connection.provider !== connector.metadata.id) throw new Error('CONNECTOR_CONNECTION_INVALID');
        if (connection.status !== 'CONNECTED') throw new Error(`CONNECTOR_${connection.status}`);
        validateOpaqueCredentialReference(connection.credentialReference);
        const granted = new Set(connection.grantedScopes ?? []);
        if (projected.providerScopes.some(scope => !granted.has(scope))) throw new Error('CONNECTOR_PROVIDER_SCOPE_REQUIRED');
        const started = clock();
        try {
          const result = await connector.invokeCapability(projected.definition.id, input, {
            tenantId: context.tenantId,
            subjectId: context.subjectId,
            projectId: context.projectId,
            connection,
            now: clock()
          });
          if (audits) await audits.appendConnectorAudit(connectorAudit({ tenantId: context.tenantId, subjectId: context.subjectId, providerId: connector.metadata.id, connectionId: connection.id, projectId: context.projectId, capabilityId: projected.definition.id, operation: 'INVOKE', status: 'SUCCEEDED', startedAt: started.toISOString(), completedAt: clock().toISOString() }));
          return result;
        } catch (error) {
          const normalized = connector.normalizeError(error);
          if (audits) await audits.appendConnectorAudit(connectorAudit({ tenantId: context.tenantId, subjectId: context.subjectId, providerId: connector.metadata.id, connectionId: connection.id, projectId: context.projectId, capabilityId: projected.definition.id, operation: 'INVOKE', status: 'FAILED', errorCode: normalized.code, startedAt: started.toISOString(), completedAt: clock().toISOString() }));
          const safe = new Error(`CONNECTOR_${normalized.kind}`);
          (safe as Error & { connectorError?: unknown }).connectorError = normalized;
          throw safe;
        }
      }
    });
  }
}

export function connectionSupportsCapability(connection: IntegrationConnection, capability: ConnectorCapabilityDefinition): boolean {
  const granted = new Set(connection.grantedScopes ?? []);
  return capability.providerScopes.every(scope => granted.has(scope));
}
