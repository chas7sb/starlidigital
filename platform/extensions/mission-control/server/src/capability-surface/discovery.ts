import type {
  UnifiedToolDefinition,
  CapabilityCallerContext,
  DiscoveredToolDescriptor,
  CapabilityAvailabilityState
} from './types.js';

export const FORBIDDEN_INTERNAL_PREFIXES = [
  'server_exec',
  'ops_health',
  'device.powershell',
  'device.shell',
  'database_query',
  'systemd',
  'secret_manage',
  'outreach_send_email',
  'admin.raw',
  'db.'
];

export function isInternalCapabilityForbidden(id: string): boolean {
  const lower = id.toLowerCase();
  return FORBIDDEN_INTERNAL_PREFIXES.some(prefix => lower === prefix || lower.startsWith(prefix));
}

export interface DiscoveryOptions {
  tools?: readonly UnifiedToolDefinition[];
  callerContext: CapabilityCallerContext;
  isTenantPaused?: boolean;
  connectedProviders?: readonly string[];
  activeProjectGrants?: readonly string[];
}

export function discoverCapabilitiesForSurface(options: DiscoveryOptions): DiscoveredToolDescriptor[] {
  const {
    tools = [],
    callerContext,
    isTenantPaused = false,
    connectedProviders = [],
    activeProjectGrants = []
  } = options;

  const results: DiscoveredToolDescriptor[] = [];
  const callerScopes = new Set(callerContext.scopes);

  for (const tool of tools) {
    // 1. Guard against forbidden internal admin/shell tools
    if (isInternalCapabilityForbidden(tool.id)) {
      continue;
    }

    // 2. Surface-level access filter
    if (!tool.allowedSurfaces.includes(callerContext.surface)) {
      continue;
    }

    // 3. Caller Scope filter
    const hasScopes = tool.requiredScopes.every(scope => callerScopes.has(scope));
    if (!hasScopes) {
      continue;
    }

    // 4. Compute dynamic availability state
    let state: CapabilityAvailabilityState = 'AVAILABLE';

    if (isTenantPaused && tool.sideEffectLevel !== 'READ' && tool.sideEffectLevel !== 'NONE') {
      state = 'PAUSED';
    } else if (tool.projectScoped && !callerContext.activeProjectId) {
      state = 'PROJECT_REQUIRED';
    } else if (tool.projectScoped && callerContext.activeProjectId && activeProjectGrants.length > 0) {
      if (!activeProjectGrants.includes(tool.id)) {
        state = 'GRANT_REQUIRED';
      }
    } else if (tool.connectionRequired && connectedProviders.length === 0) {
      state = 'CONNECTION_REQUIRED';
    } else if (tool.approvalRequired) {
      state = 'APPROVAL_REQUIRED';
    }

    results.push({
      id: tool.id,
      name: tool.id,
      displayName: tool.displayName,
      category: tool.category,
      description: tool.description,
      sideEffectLevel: tool.sideEffectLevel,
      inputSchema: tool.inputSchema,
      metadata: {
        category: tool.category,
        sideEffectLevel: tool.sideEffectLevel,
        approvalRequired: tool.approvalRequired,
        autonomousAllowed: tool.autonomousAllowed,
        projectScoped: tool.projectScoped,
        connectionRequired: tool.connectionRequired,
        async: tool.async,
        idempotent: tool.idempotent,
        rateLimit: tool.rateLimit,
        estimatedCost: tool.estimatedCost,
        availabilityState: state,
        promptBoundaryPolicy: {
          outputFencingRequired: tool.promptBoundaryPolicy.outputFencingRequired
        }
      }
    });
  }

  return results;
}
