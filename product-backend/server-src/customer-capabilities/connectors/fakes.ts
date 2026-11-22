import type { CapabilityCategory, CapabilityDefinition, IntegrationConnection } from '../types.js';
import type {
  ConnectorCapabilityDefinition,
  ConnectorCategory,
  ConnectorProviderError,
  ConnectorProviderMetadata,
  CustomerConnectorAdapter
} from './types.js';

const DOMAIN_CONFIG = {
  MAIL: { provider: 'test-mail', display: 'Test Mail', category: 'COMMUNICATION' as CapabilityCategory, scope: 'mail.read', suffix: 'messages.read', item: 'message' },
  CALENDAR: { provider: 'test-calendar', display: 'Test Calendar', category: 'CALENDAR' as CapabilityCategory, scope: 'calendar.read', suffix: 'events.read', item: 'event' },
  FILES: { provider: 'test-files', display: 'Test Files', category: 'FILES' as CapabilityCategory, scope: 'files.read', suffix: 'items.read', item: 'file' },
  CRM: { provider: 'test-crm', display: 'Test CRM', category: 'CRM' as CapabilityCategory, scope: 'crm.read', suffix: 'records.read', item: 'record' },
  COMMERCE: { provider: 'test-commerce', display: 'Test Commerce', category: 'COMMERCE' as CapabilityCategory, scope: 'commerce.read', suffix: 'orders.read', item: 'order' }
} as const;

function capability(provider: string, displayName: string, category: CapabilityCategory, suffix: string, scope: string): ConnectorCapabilityDefinition {
  const definition: CapabilityDefinition = {
    id: `connector.${provider}.${suffix}`,
    displayName,
    category,
    description: `Test-only ${displayName.toLowerCase()} connector capability.`,
    sideEffectLevel: 'READ', requiredScopes: ['customer:read'], approvalRequired: false, autonomousAllowed: true,
    idempotent: true, async: false, estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    rateLimit: { maxPerMinute: 60, maxPerHour: 500, scope: 'PER_TENANT', throttleBehavior: 'BLOCK' },
    connectionRequired: true, projectScoped: true, availability: 'AVAILABLE', maxOutputBytes: 16 * 1024,
    inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 120 } } }
  };
  return { definition, providerScopes: [scope] };
}

export function createFakeConnectorAdapter(domain: keyof typeof DOMAIN_CONFIG): CustomerConnectorAdapter {
  const config = DOMAIN_CONFIG[domain];
  const metadata: ConnectorProviderMetadata = {
    id: config.provider, displayName: config.display, category: domain as ConnectorCategory,
    description: `Test-only fake ${domain.toLowerCase()} connector.`, authMode: 'MANAGED', implementationStatus: 'TEST_ONLY', liveAuthAvailable: false,
    supportedScopes: [config.scope], requiredConfiguration: []
  };
  const cap = capability(config.provider, `${config.display} read`, config.category, config.suffix, config.scope);
  return {
    metadata,
    capabilityCatalog: [cap],
    async discoverCapabilities() { return [cap]; },
    async inspectHealth(context) { return { state: context.connection.status, checkedAt: context.now.toISOString(), reauthRequired: context.connection.status === 'REAUTH_REQUIRED' }; },
    async invokeCapability(capabilityId, input, context) {
      if (capabilityId !== cap.definition.id) throw new Error('unknown fake capability');
      return { data: { provider: config.provider, projectId: context.projectId ?? null, kind: config.item, query: typeof input.query === 'string' ? input.query : null, items: [{ id: `${config.item}-1`, label: `Test ${config.item}` }] }, trust: 'UNTRUSTED_EXTERNAL_DATA' };
    },
    normalizeError(error): ConnectorProviderError {
      const message = error instanceof Error ? error.message : 'Connector provider error';
      const reauth = /reauth|expired/i.test(message);
      return { code: reauth ? 'REAUTH_REQUIRED' : 'TEST_PROVIDER_ERROR', kind: reauth ? 'REAUTH_REQUIRED' : 'UNKNOWN', message: reauth ? 'Connector requires reauthentication' : 'Connector provider operation failed', retryable: !reauth };
    },
    async ingestEvent(envelope, context) {
      return { type: `${domain.toLowerCase()}.${envelope.eventType}`.slice(0, 120), occurredAt: envelope.occurredAt || context.now.toISOString(), entityRefs: [], data: envelope.payload, trust: 'UNTRUSTED_EXTERNAL_DATA', instructionsAllowed: false };
    }
  };
}

export function fakeConnection(adapter: CustomerConnectorAdapter, tenantId: string, id = `conn-${adapter.metadata.id}`): IntegrationConnection {
  const now = '2026-11-02T12:00:00.000Z';
  return { id, tenantId, provider: adapter.metadata.id, status: 'CONNECTED', credentialReference: `connref_${adapter.metadata.id.replace(/-/g, '_')}_opaque_001`, authMode: adapter.metadata.authMode, grantedScopes: [...adapter.metadata.supportedScopes], createdAt: now, updatedAt: now };
}
