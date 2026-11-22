import type {
  IdempotencyReservationStatus,
  ApprovalReference,
  CapabilityAuditReceipt,
  CapabilityStateRepository,
  IdempotencyCacheEntry,
  IntegrationConnection,
  ProjectCapabilityGrant,
  TenantCapability
} from './types.js';
import { sanitizeIntegrationConnection } from './connectors/lifecycle.js';

const key = (...parts: (string | undefined)[]) => parts.map(part => part ?? '-').join('|');

export class InMemoryCapabilityStateRepository implements CapabilityStateRepository {
  private readonly tenantCapabilities = new Map<string, TenantCapability>();
  private readonly grants = new Map<string, ProjectCapabilityGrant>();
  private readonly connections = new Map<string, IntegrationConnection>();
  private readonly approvals = new Map<string, ApprovalReference>();
  private readonly idempotency = new Map<string, IdempotencyCacheEntry|Omit<IdempotencyCacheEntry,'result'>>();
  readonly audits: CapabilityAuditReceipt[] = [];

  seedTenantCapability(record: TenantCapability): void { this.tenantCapabilities.set(key(record.tenantId, record.capabilityId), structuredClone(record)); }
  seedProjectGrant(record: ProjectCapabilityGrant): void { this.grants.set(key(record.tenantId, record.projectId, record.capabilityId), structuredClone(record)); }
  seedConnection(record: IntegrationConnection): void {
    const clean = sanitizeIntegrationConnection(record);
    this.connections.set(key(clean.tenantId, clean.id), structuredClone(clean));
  }
  seedApproval(record: ApprovalReference): void { this.approvals.set(record.id, structuredClone(record)); }

  async getTenantCapability(tenantId: string, capabilityId: string) { return structuredClone(this.tenantCapabilities.get(key(tenantId, capabilityId))); }
  async getProjectGrant(tenantId: string, projectId: string, capabilityId: string) { return structuredClone(this.grants.get(key(tenantId, projectId, capabilityId))); }
  async getConnection(tenantId: string, connectionId: string) { return structuredClone(this.connections.get(key(tenantId, connectionId))); }
  async getApproval(referenceId: string) { return structuredClone(this.approvals.get(referenceId)); }
  async appendAudit(record: CapabilityAuditReceipt) { this.audits.push(structuredClone(record)); }
  async getIdempotency(tenantId: string, capabilityId: string, projectId: string | undefined, keyHash: string) { const row=this.idempotency.get(key(tenantId,capabilityId,projectId,keyHash));return row&&'result' in row?structuredClone(row):undefined; }
  reserveIdempotency(entry:Omit<IdempotencyCacheEntry,'result'>):IdempotencyReservationStatus{
    const id=key(entry.tenantId,entry.capabilityId,entry.projectId,entry.keyHash),old=this.idempotency.get(id);
    if(old){if(old.requestHash!==entry.requestHash)return'CONFLICT';return'result' in old?'COMPLETED':'IN_PROGRESS';}
    this.idempotency.set(id,structuredClone(entry));return'CLAIMED';
  }
  async putIdempotency(entry: IdempotencyCacheEntry) { this.idempotency.set(key(entry.tenantId, entry.capabilityId, entry.projectId, entry.keyHash), structuredClone(entry)); }
}
