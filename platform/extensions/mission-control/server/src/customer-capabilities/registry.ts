import type { CapabilityDefinition, CapabilityHandler } from './types.js';
import { validateCapabilityDefinition } from './security.js';

export class CustomerCapabilityRegistry {
  private readonly entries = new Map<string, { definition: Readonly<CapabilityDefinition>; handler: CapabilityHandler }>();

  register(definition: CapabilityDefinition, handler: CapabilityHandler): void {
    validateCapabilityDefinition(definition);
    if (this.entries.has(definition.id)) throw new Error(`Capability already registered: ${definition.id}`);
    const frozen = Object.freeze({
      ...definition,
      requiredScopes: Object.freeze([...definition.requiredScopes]),
      rateLimit: Object.freeze({ ...definition.rateLimit }),
      estimatedCost: Object.freeze({ ...definition.estimatedCost }),
      inputSchema: Object.freeze({ ...definition.inputSchema, properties: Object.freeze({ ...definition.inputSchema.properties }) })
    });
    this.entries.set(definition.id, { definition: frozen, handler });
  }

  get(id: string): { definition: Readonly<CapabilityDefinition>; handler: CapabilityHandler } | undefined {
    return this.entries.get(id);
  }

  list(): Readonly<CapabilityDefinition>[] {
    return [...this.entries.values()].map(entry => entry.definition);
  }
}
