import type {
  IdempotencyCacheEntry,
  ApprovalReference,
  CapabilityAvailability,
  CapabilityDescriptor,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  CapabilityStateRepository,
  CustomerCapabilityCaller,
  ProjectCapabilityGrant
} from './types.js';
import { CustomerCapabilityRegistry } from './registry.js';
import { hashOpaque, publicConnection, receipt, redactAndBoundOutput, validateInput, validateOpaqueCredentialReference } from './security.js';

export class CustomerCapabilityGateway {
  private readonly minuteBuckets = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly registry: CustomerCapabilityRegistry,
    private readonly state: CapabilityStateRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  private hasScopes(caller: CustomerCapabilityCaller, required: readonly string[]): boolean {
    const scopes = new Set(caller.scopes);
    return required.every(scope => scopes.has(scope));
  }

  private validGrant(grant: ProjectCapabilityGrant | undefined, tenantId: string, projectId: string, capabilityId: string, requiredScopes: readonly string[]): boolean {
    if (!grant || !grant.enabled) return false;
    if (grant.tenantId !== tenantId || grant.projectId !== projectId || grant.capabilityId !== capabilityId) return false;
    if (grant.expiresAt !== undefined && (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= this.clock().getTime())) return false;
    const scopes = new Set(grant.scopes);
    return requiredScopes.every(scope => scopes.has(scope));
  }

  private async availability(caller: CustomerCapabilityCaller, capabilityId: string, projectId?: string): Promise<CapabilityAvailability> {
    const entry = this.registry.get(capabilityId);
    if (!entry) return { capabilityId, state: 'UNAVAILABLE', reason: 'Capability is not customer-exposable' };
    const { definition, handler } = entry;
    if (!this.hasScopes(caller, definition.requiredScopes)) return { capabilityId, state: 'UNAVAILABLE', reason: 'Caller scope does not permit this capability' };
    const tenantCapability = await this.state.getTenantCapability(caller.tenantId, definition.id);
    if (tenantCapability && !tenantCapability.enabled) return { capabilityId, state: 'DISABLED', reason: 'Capability disabled for tenant' };
    if (handler.isAvailable && !handler.isAvailable()) return { capabilityId, state: 'UNAVAILABLE', reason: 'Capability adapter is not configured' };
    if (definition.projectScoped) {
      if (!projectId) return { capabilityId, state: 'PROJECT_REQUIRED', reason: 'A project context is required' };
      const grant = await this.state.getProjectGrant(caller.tenantId, projectId, definition.id);
      if (!this.validGrant(grant, caller.tenantId, projectId, definition.id, definition.requiredScopes)) return { capabilityId, state: 'GRANT_REQUIRED', reason: 'No valid project capability grant' };
    }
    if (definition.connectionRequired) {
      if (!tenantCapability?.connectionId) return { capabilityId, state: 'CONNECTION_REQUIRED', reason: 'A connected provider is required' };
      const connection = await this.state.getConnection(caller.tenantId, tenantCapability.connectionId);
      if (!connection || connection.status !== 'CONNECTED' || connection.tenantId !== caller.tenantId) return { capabilityId, state: 'CONNECTION_REQUIRED', reason: 'Connection is unavailable' };
      return { capabilityId, state: 'AVAILABLE', connection: publicConnection(connection) };
    }
    return { capabilityId, state: 'AVAILABLE' };
  }

  async discover(caller: CustomerCapabilityCaller, options: { projectId?: string } = {}): Promise<CapabilityDescriptor[]> {
    const result: CapabilityDescriptor[] = [];
    for (const definition of this.registry.list()) {
      if (!this.hasScopes(caller, definition.requiredScopes)) continue;
      const runtimeAvailability = await this.availability(caller, definition.id, options.projectId);
      result.push({ ...definition, runtimeAvailability });
    }
    return result;
  }

  private rateLimit(tenantId: string, capabilityId: string, limit: number): void {
    const now = this.clock().getTime(); const bucketKey = `${tenantId}|${capabilityId}`; const bucket = this.minuteBuckets.get(bucketKey);
    if (!bucket || now - bucket.start >= 60_000) { this.minuteBuckets.set(bucketKey, { start: now, count: 1 }); return; }
    if (bucket.count >= limit) throw new Error('RATE_LIMITED');
    bucket.count++;
  }

  private validCachedResult(entry:IdempotencyCacheEntry,caller:CustomerCapabilityCaller,request:CapabilityInvocationRequest,keyHash:string,requestHash:string){
    const audit=entry.result?.receipt;
    return entry.tenantId===caller.tenantId&&entry.capabilityId===request.capabilityId&&entry.projectId===request.projectId&&entry.keyHash===keyHash&&entry.requestHash===requestHash&&entry.result?.capabilityId===request.capabilityId&&audit?.tenantId===caller.tenantId&&audit?.capabilityId===request.capabilityId&&audit?.projectId===request.projectId;
  }

  private async validateApproval(referenceId: string | undefined, caller: CustomerCapabilityCaller, capabilityId: string, projectId?: string): Promise<ApprovalReference | undefined> {
    if (!referenceId) return undefined;
    const approval = await this.state.getApproval(referenceId);
    if (!approval || approval.status !== 'APPROVED') return undefined;
    if (approval.tenantId !== caller.tenantId || approval.capabilityId !== capabilityId || approval.projectId !== projectId) return undefined;
    if (!Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= this.clock().getTime()) return undefined;
    return approval;
  }

  async invoke(caller: CustomerCapabilityCaller, request: CapabilityInvocationRequest): Promise<CapabilityInvocationResult> {
    const started = this.clock(); const entry = this.registry.get(request.capabilityId);
    const deny = async (code: string, message: string, sideEffectLevel: 'NONE' | 'READ' | 'WRITE' | 'HIGH_IMPACT' = entry?.definition.sideEffectLevel ?? 'NONE'): Promise<CapabilityInvocationResult> => {
      const completed = this.clock(); const audit = receipt({ tenantId: caller.tenantId, subjectId: caller.subjectId, projectId: request.projectId, capabilityId: request.capabilityId, sideEffectLevel, status: 'DENIED', requestId: caller.requestId, errorCode: code, startedAt: started.toISOString(), completedAt: completed.toISOString() });
      await this.state.appendAudit(audit); return { ok: false, capabilityId: request.capabilityId, trust: 'TRUSTED_PLATFORM', instructionsAllowed: false, receipt: audit, error: { code, message } };
    };
    if (!entry) return deny('CAPABILITY_NOT_AVAILABLE', 'Capability is not available');
    const { definition, handler } = entry;
    const replayCached=async(cached:IdempotencyCacheEntry):Promise<CapabilityInvocationResult>=>{
      try{return {...cached.result,data:redactAndBoundOutput(cached.result.data,definition.maxOutputBytes),instructionsAllowed:false,cached:true};}
      catch{return deny('CACHED_OUTPUT_UNSAFE','Cached output no longer satisfies current safety bounds; inspect without re-executing');}
    };
    if (!this.hasScopes(caller, definition.requiredScopes)) return deny('SCOPE_DENIED', 'Caller is not permitted to use this capability');
    if (caller.autonomous && !definition.autonomousAllowed) return deny('AUTONOMY_DENIED', 'Capability cannot run autonomously');
    const available = await this.availability(caller, definition.id, request.projectId);
    if (available.state !== 'AVAILABLE') return deny(available.state, available.reason ?? 'Capability is unavailable');
    let input: Record<string, unknown>;
    try { input = validateInput(definition.inputSchema, request.input ?? {}); } catch (error) { const message = error instanceof Error ? error.message : 'Invalid input'; return deny(message.startsWith('FORGED_IDENTITY') ? 'FORGED_IDENTITY' : 'INVALID_INPUT', 'Capability input was rejected'); }
    const approval = definition.approvalRequired ? await this.validateApproval(request.approvalReferenceId, caller, definition.id, request.projectId) : undefined;
    if (definition.approvalRequired && !approval) return deny('APPROVAL_REQUIRED', 'A valid server-side approval reference is required');
    let connectionCredentialReference: string | undefined;
    if (definition.connectionRequired) {
      const tenantCapability = await this.state.getTenantCapability(caller.tenantId, definition.id); const connection = tenantCapability?.connectionId ? await this.state.getConnection(caller.tenantId, tenantCapability.connectionId) : undefined;
      if (!connection || connection.tenantId !== caller.tenantId || connection.status !== 'CONNECTED') return deny('CONNECTION_REQUIRED', 'A connected provider is required');
      try { validateOpaqueCredentialReference(connection.credentialReference); } catch { return deny('CONNECTION_INVALID', 'Connection credential reference is invalid'); }
      connectionCredentialReference = connection.credentialReference;
    }
    const keyHash = request.idempotencyKey ? hashOpaque(request.idempotencyKey) : undefined;
    const requestHash = hashOpaque(JSON.stringify({ capabilityId: definition.id, projectId: request.projectId ?? null, input }));
    if (definition.sideEffectLevel !== 'NONE' && definition.sideEffectLevel !== 'READ' && definition.idempotent && !keyHash) return deny('IDEMPOTENCY_REQUIRED', 'An idempotency key is required for this mutation');
    if (keyHash && definition.idempotent) {
      const cached = await this.state.getIdempotency(caller.tenantId, definition.id, request.projectId, keyHash);
      if (cached) {
        if (!this.validCachedResult(cached,caller,request,keyHash,requestHash)) return deny('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different request');
        return replayCached(cached);
      }
    }
    try {
      this.rateLimit(caller.tenantId, definition.id, definition.rateLimit.maxPerMinute);
      if (!['NONE','READ'].includes(definition.sideEffectLevel) && this.state.mutationPaused?.(caller.tenantId)) return deny('GLOBAL_PAUSED','Canonical autonomy policy pauses new mutations');
      // A durable claim precedes any idempotent write. It is never timed out/reclaimed:
      // a crash or post-effect output/audit failure must require inspection, not replay.
      if (!['NONE','READ'].includes(definition.sideEffectLevel) && definition.idempotent && keyHash) {
        if (!this.state.reserveIdempotency) return deny('IDEMPOTENCY_UNAVAILABLE','Mutation requires an atomic idempotency repository');
        const reservation=this.state.reserveIdempotency({tenantId:caller.tenantId,capabilityId:definition.id,projectId:request.projectId,keyHash,requestHash});
        if(reservation==='CONFLICT')return deny('IDEMPOTENCY_CONFLICT','Idempotency key was already used for a different request');
        if(reservation==='IN_PROGRESS')return deny('IDEMPOTENCY_IN_PROGRESS_OR_UNCERTAIN','Existing operation is in progress or has an uncertain outcome; inspect, do not replay');
        if(reservation==='COMPLETED'){
          const completed=await this.state.getIdempotency(caller.tenantId,definition.id,request.projectId,keyHash);
          if(!completed||!this.validCachedResult(completed,caller,request,keyHash,requestHash))return deny('IDEMPOTENCY_CONFLICT','Completed operation could not be verified');
          return replayCached(completed);
        }
        if(reservation!=='CLAIMED')return deny('IDEMPOTENCY_UNAVAILABLE','Atomic operation reservation could not be verified');
      }
      const handled = await handler.execute(input, { tenantId: caller.tenantId, subjectId: caller.subjectId, projectId: request.projectId, connectionCredentialReference, approval, now: this.clock() });
      const data = redactAndBoundOutput(handled.data, definition.maxOutputBytes); const completed = this.clock();
      const audit = receipt({ tenantId: caller.tenantId, subjectId: caller.subjectId, projectId: request.projectId, capabilityId: definition.id, sideEffectLevel: definition.sideEffectLevel, status: 'SUCCEEDED', requestId: caller.requestId, idempotencyKeyHash: keyHash, resultHash: hashOpaque(JSON.stringify(data)), startedAt: started.toISOString(), completedAt: completed.toISOString() });
      await this.state.appendAudit(audit);
      const result: CapabilityInvocationResult = { ok: true, capabilityId: definition.id, data, trust: handled.trust ?? 'TRUSTED_TENANT_DATA', instructionsAllowed: false, receipt: audit };
      if (keyHash && definition.idempotent) await this.state.putIdempotency({ tenantId: caller.tenantId, capabilityId: definition.id, projectId: request.projectId, keyHash, requestHash, result });
      return result;
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Capability failed'; const code = raw === 'RATE_LIMITED' || raw === 'OUTPUT_LIMIT_EXCEEDED' ? raw : raw.startsWith('INVALID_INPUT') ? 'INVALID_INPUT' : 'CAPABILITY_FAILED';
      const completed = this.clock(); const audit = receipt({ tenantId: caller.tenantId, subjectId: caller.subjectId, projectId: request.projectId, capabilityId: definition.id, sideEffectLevel: definition.sideEffectLevel, status: 'FAILED', requestId: caller.requestId, idempotencyKeyHash: keyHash, errorCode: code, startedAt: started.toISOString(), completedAt: completed.toISOString() });
      await this.state.appendAudit(audit); return { ok: false, capabilityId: definition.id, trust: 'TRUSTED_PLATFORM', instructionsAllowed: false, receipt: audit, error: { code, message: code === 'OUTPUT_LIMIT_EXCEEDED' ? 'Capability output exceeded its safe bound' : 'Capability execution failed' } };
    }
  }
}
