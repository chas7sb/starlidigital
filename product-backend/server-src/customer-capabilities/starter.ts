import { evaluateMathExpression } from '../hosted-agents/tools/universal/calculator.js';
import type { BackendSummary, CapabilityDataAdapterResult, CapabilityDefinition, CapabilityHandler, CustomerCapabilityAdapters } from './types.js';
import { CustomerCapabilityRegistry } from './registry.js';

const base = {
  requiredScopes: ['customer:read'] as const,
  approvalRequired: false,
  autonomousAllowed: true,
  idempotent: true,
  async: false,
  estimatedCost: { computeLevel: 'LOW' as const, financialCost: 'NONE' as const },
  rateLimit: { maxPerMinute: 120, scope: 'PER_TENANT' as const, throttleBehavior: 'BLOCK' as const },
  connectionRequired: false,
  availability: 'AVAILABLE' as const,
  maxOutputBytes: 64 * 1024
};

function adapterHandler<TInput extends Record<string, unknown>>(
  available: boolean,
  fn: ((input: TInput, context: Parameters<CapabilityHandler['execute']>[1]) => Promise<CapabilityDataAdapterResult>) | undefined
): CapabilityHandler {
  return {
    isAvailable: () => available,
    async execute(input, context) {
      if (!fn) return { data: { availability: 'UNAVAILABLE', reason: 'Adapter not configured' }, trust: 'TRUSTED_PLATFORM' };
      const result = await fn(input as TInput, context);
      if (!result.available) return { data: { availability: 'UNAVAILABLE', reason: result.reason ?? 'Source unavailable' }, trust: 'TRUSTED_PLATFORM' };
      return { data: result.data ?? null, trust: result.trust ?? 'TRUSTED_TENANT_DATA' };
    }
  };
}

function projectBackendSummary(value: BackendSummary): BackendSummary {
  return {
    backendProjectId: String(value.backendProjectId), serviceId: String(value.serviceId), name: String(value.name),
    stack: value.stack, environment: value.environment, lifecycle: value.lifecycle, versionId: value.versionId, endpoint: value.endpoint,
    health: value.health, readiness: value.readiness,
    database: value.database ? { engine: value.database.engine, status: value.database.status } : null,
    migrationRisk: value.migrationRisk, updatedAt: String(value.updatedAt)
  };
}

function backendSummaryHandler(adapters: CustomerCapabilityAdapters): CapabilityHandler {
  return {
    isAvailable: () => !!adapters.readBackendSummary,
    async execute(input, context) {
      if (!adapters.readBackendSummary) return { data: { availability: 'UNAVAILABLE', reason: 'Adapter not configured' }, trust: 'TRUSTED_PLATFORM' };
      const result = await adapters.readBackendSummary({ tenantId: context.tenantId, projectId: context.projectId!, backendProjectId: typeof input.backendProjectId === 'string' ? input.backendProjectId : undefined, subjectId: context.subjectId });
      if (!result.available || !result.data) return { data: { availability: 'UNAVAILABLE', reason: result.reason ?? 'Backend summary unavailable' }, trust: 'TRUSTED_PLATFORM' };
      return { data: projectBackendSummary(result.data), trust: result.trust ?? 'TRUSTED_TENANT_DATA' };
    }
  };
}

export function registerStarterCapabilities(registry: CustomerCapabilityRegistry, adapters: CustomerCapabilityAdapters = {}): void {
  const definitions: Array<[CapabilityDefinition, CapabilityHandler]> = [
    [{
      ...base, id: 'utility.current_datetime', displayName: 'Current date and time', category: 'UTILITY',
      description: 'Returns the current date and time in a requested IANA timezone.', sideEffectLevel: 'NONE', projectScoped: false,
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        timezone: { type: 'string', maxLength: 80 }, format: { type: 'string', enum: ['human', 'iso', 'date', 'time'] }
      }}
    }, {
      async execute(input, context) {
        const timezone = typeof input.timezone === 'string' && input.timezone.trim() ? input.timezone.trim() : 'Europe/Bucharest';
        try { Intl.DateTimeFormat(undefined, { timeZone: timezone }); } catch { throw new Error('INVALID_INPUT: invalid IANA timezone'); }
        const format = typeof input.format === 'string' ? input.format : 'human';
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(context.now);
        const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
        const date = `${map.year}-${map.month}-${map.day}`; const time = `${map.hour}:${map.minute}:${map.second}`;
        const formatted = format === 'date' ? date : format === 'time' ? time : format === 'iso' ? `${date}T${time} (${timezone})` : `${map.weekday}, ${map.day}/${map.month}/${map.year} at ${time} [${timezone}]`;
        return { data: { formatted, timezone, date, time, weekday: map.weekday, timestamp: context.now.getTime() }, trust: 'TRUSTED_PLATFORM' };
      }
    }],
    [{
      ...base, id: 'utility.calculator', displayName: 'Calculator', category: 'UTILITY', description: 'Safely evaluates bounded arithmetic expressions without eval.', sideEffectLevel: 'NONE', projectScoped: false,
      inputSchema: { type: 'object', additionalProperties: false, properties: { expression: { type: 'string', maxLength: 250 } }, required: ['expression'] }
    }, { async execute(input) { return { data: { result: evaluateMathExpression(String(input.expression)) }, trust: 'TRUSTED_PLATFORM' }; } }],
    [{
      ...base, id: 'project.read', displayName: 'Read project', category: 'PROJECTS', description: 'Reads the current project through a tenant-scoped project adapter.', sideEffectLevel: 'READ', projectScoped: true,
      inputSchema: { type: 'object', additionalProperties: false, properties: {} }
    }, adapterHandler(!!adapters.readProject, adapters.readProject ? async (_input, context) => adapters.readProject!({ tenantId: context.tenantId, projectId: context.projectId!, subjectId: context.subjectId }) : undefined)],
    [{
      ...base, id: 'artifact.read', displayName: 'Read artifact', category: 'ARTIFACTS', description: 'Reads one project artifact through the tenant-scoped artifact adapter.', sideEffectLevel: 'READ', projectScoped: true,
      inputSchema: { type: 'object', additionalProperties: false, properties: { artifactId: { type: 'string', maxLength: 120 } }, required: ['artifactId'] }
    }, adapterHandler(!!adapters.readArtifact, adapters.readArtifact ? async (input, context) => adapters.readArtifact!({ tenantId: context.tenantId, projectId: context.projectId!, artifactId: String(input.artifactId), subjectId: context.subjectId }) : undefined)],
    [{
      ...base, id: 'brand.context.read', displayName: 'Read Brand Brain context', category: 'BRAND', description: 'Reads approved project Brand Brain context through an isolated adapter seam.', sideEffectLevel: 'READ', projectScoped: true,
      inputSchema: { type: 'object', additionalProperties: false, properties: {} }
    }, adapterHandler(!!adapters.readBrandContext, adapters.readBrandContext ? async (_input, context) => adapters.readBrandContext!({ tenantId: context.tenantId, projectId: context.projectId!, subjectId: context.subjectId }) : undefined)],
    [{
      ...base, id: 'backend.summary.read', displayName: 'Read backend status', category: 'BACKENDS', description: 'Reads normalized Backend Factory/runtime summary through a tenant-scoped adapter seam.', sideEffectLevel: 'READ', projectScoped: true,
      inputSchema: { type: 'object', additionalProperties: false, properties: { backendProjectId: { type: 'string', maxLength: 120 } } }
    }, backendSummaryHandler(adapters)]
  ];
  for (const [definition, handler] of definitions) registry.register(definition, handler);
}
