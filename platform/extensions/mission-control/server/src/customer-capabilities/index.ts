export * from './types.js';
export * from './security.js';
export * from './registry.js';
export * from './memory.js';
export * from './starter.js';
export * from './gateway.js';
export * from './runtime.js';
export * from './integrity.js';

import type { CapabilityStateRepository, CustomerCapabilityAdapters } from './types.js';
import type { ConnectorAuditRepository, CustomerConnectorAdapter } from './connectors/types.js';
import { registerConnectorCapabilities } from './connectors/registry.js';
import { CustomerCapabilityRegistry } from './registry.js';
import { registerStarterCapabilities } from './starter.js';
import { CustomerCapabilityGateway } from './gateway.js';

export function createCustomerCapabilityCloud(options: {
  state: CapabilityStateRepository;
  adapters?: CustomerCapabilityAdapters;
  clock?: () => Date;
  connectorAdapters?: readonly CustomerConnectorAdapter[];
  connectorAudits?: ConnectorAuditRepository;
}): { registry: CustomerCapabilityRegistry; gateway: CustomerCapabilityGateway } {
  const registry = new CustomerCapabilityRegistry();
  registerStarterCapabilities(registry, options.adapters ?? {});
  for (const adapter of options.connectorAdapters ?? []) registerConnectorCapabilities(registry, options.state, adapter, options.clock, options.connectorAudits);
  return { registry, gateway: new CustomerCapabilityGateway(registry, options.state, options.clock) };
}
export * from './store.js';
export * from './graphql.js';
export * from './connectors/index.js';
