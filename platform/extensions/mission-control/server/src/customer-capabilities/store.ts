import {AutonomyPolicyService} from '../autonomy-policy/service.js';
import {randomUUID} from 'node:crypto';
import type {Store} from '../store.js';
import type {IdempotencyReservationStatus,ApprovalReference,CapabilityAuditReceipt,CapabilityStateRepository,IdempotencyCacheEntry,IntegrationConnection,ProjectCapabilityGrant,TenantCapability} from './types.js';
import {sanitizeIntegrationConnection} from './connectors/lifecycle.js';

const COLLECTIONS={tenant:'customer-capability-tenant',grants:'customer-capability-grants',connections:'customer-capability-connections',approvals:'customer-capability-approvals',audits:'customer-capability-audits',idempotency:'customer-capability-idempotency'} as const;
const safe=(value:string,label:string)=>{const v=String(value||'').trim();if(!/^[A-Za-z0-9_.:-]{1,220}$/.test(v))throw new Error(`Invalid ${label}`);return v;};
const key=(...parts:(string|undefined)[])=>parts.map(part=>part??'-').join('|');

export class StoreCapabilityStateRepository implements CapabilityStateRepository{
  constructor(private store:Store){}
  mutationPaused(tenantId:string){return new AutonomyPolicyService(this.store).record(tenantId).pauseAll;}
  async getTenantCapability(tenantId:string,capabilityId:string){const tenant=safe(tenantId,'tenant'),id=`tenant:${key(tenant,safe(capabilityId,'capability'))}`,row=this.store.get(COLLECTIONS.tenant,id) as TenantCapability&{id:string}|undefined;return row?.tenantId===tenant?this.stripId<TenantCapability>(row):undefined;}
  async getProjectGrant(tenantId:string,projectId:string,capabilityId:string){const tenant=safe(tenantId,'tenant'),id=`grant:${key(tenant,safe(projectId,'project'),safe(capabilityId,'capability'))}`,row=this.store.get(COLLECTIONS.grants,id) as ProjectCapabilityGrant|undefined;return row?.tenantId===tenant?structuredClone(row):undefined;}
  async getConnection(tenantId:string,connectionId:string){const tenant=safe(tenantId,'tenant'),row=this.store.get(COLLECTIONS.connections,safe(connectionId,'connection')) as IntegrationConnection|undefined;return row?.tenantId===tenant?structuredClone(sanitizeIntegrationConnection(row)):undefined;}
  async getApproval(referenceId:string){const row=this.store.get(COLLECTIONS.approvals,safe(referenceId,'approval')) as ApprovalReference|undefined;return row?structuredClone(row):undefined;}
  async appendAudit(receipt:CapabilityAuditReceipt){const tenant=safe(receipt.tenantId,'tenant'),row={...structuredClone(receipt),id:receipt.id||randomUUID()};this.store.put(COLLECTIONS.audits,row as any,tenant);}
  async getIdempotency(tenantId:string,capabilityId:string,projectId:string|undefined,keyHash:string){const tenant=safe(tenantId,'tenant'),id=`idem:${key(tenant,safe(capabilityId,'capability'),projectId?safe(projectId,'project'):undefined,safe(keyHash,'key hash'))}`,row=this.store.get(COLLECTIONS.idempotency,id) as (IdempotencyCacheEntry&{id:string})|undefined;return row?.tenantId===tenant&&row.result?this.stripId<IdempotencyCacheEntry>(row):undefined;}
  reserveIdempotency(entry:Omit<IdempotencyCacheEntry,'result'>):IdempotencyReservationStatus{
    const tenant=safe(entry.tenantId,'tenant'),id=`idem:${key(tenant,safe(entry.capabilityId,'capability'),entry.projectId?safe(entry.projectId,'project'):undefined,safe(entry.keyHash,'key hash'))}`;
    const row={id,...structuredClone(entry),status:'IN_PROGRESS'};
    const inserted=this.store.db.prepare('INSERT OR IGNORE INTO records(collection,id,owner,payload) VALUES(?,?,?,?)').run(COLLECTIONS.idempotency,id,tenant,JSON.stringify(row));
    if(Number(inserted.changes)===1)return'CLAIMED';
    const existing=this.store.get(COLLECTIONS.idempotency,id);
    if(!existing||existing.tenantId!==tenant||existing.requestHash!==entry.requestHash)return'CONFLICT';
    return existing.result?'COMPLETED':'IN_PROGRESS';
  }
  async putIdempotency(entry:IdempotencyCacheEntry){const tenant=safe(entry.tenantId,'tenant'),id=`idem:${key(tenant,safe(entry.capabilityId,'capability'),entry.projectId?safe(entry.projectId,'project'):undefined,safe(entry.keyHash,'key hash'))}`;this.store.put(COLLECTIONS.idempotency,{id,...structuredClone(entry)} as any,tenant);}
  putTenantCapability(record:TenantCapability){const tenant=safe(record.tenantId,'tenant'),capability=safe(record.capabilityId,'capability');this.store.put(COLLECTIONS.tenant,{id:`tenant:${key(tenant,capability)}`,...structuredClone(record)} as any,tenant);return record;}
  putProjectGrant(record:ProjectCapabilityGrant){const tenant=safe(record.tenantId,'tenant'),project=safe(record.projectId,'project'),capability=safe(record.capabilityId,'capability');this.store.put(COLLECTIONS.grants,{...structuredClone(record),id:`grant:${key(tenant,project,capability)}`} as any,tenant);return{...record,id:`grant:${key(tenant,project,capability)}`};}
  putConnection(record:IntegrationConnection){const clean=sanitizeIntegrationConnection(record),tenant=safe(clean.tenantId,'tenant');safe(clean.id,'connection');this.store.put(COLLECTIONS.connections,structuredClone(clean) as any,tenant);return clean;}
  putApproval(record:ApprovalReference){safe(record.id,'approval');safe(record.tenantId,'tenant');this.store.put(COLLECTIONS.approvals,structuredClone(record) as any,record.tenantId);return record;}
  listAudits(tenantId:string,limit=50){const tenant=safe(tenantId,'tenant'),n=Math.min(100,Math.max(1,limit));return (this.store.list(COLLECTIONS.audits,tenant) as CapabilityAuditReceipt[]).filter(row=>row.tenantId===tenant).sort((a,b)=>Date.parse(b.completedAt)-Date.parse(a.completedAt)).slice(0,n).map(row=>structuredClone(row));}
  listTenantCapabilities(tenantId:string){const tenant=safe(tenantId,'tenant');return (this.store.list(COLLECTIONS.tenant,tenant) as Array<TenantCapability&{id?:string}>).filter(row=>row.tenantId===tenant).map(row=>this.stripId<TenantCapability>(row));}
  listProjectGrants(tenantId:string,projectId:string){const tenant=safe(tenantId,'tenant'),project=safe(projectId,'project');return (this.store.list(COLLECTIONS.grants,tenant) as ProjectCapabilityGrant[]).filter(row=>row.tenantId===tenant&&row.projectId===project).map(row=>structuredClone(row));}
  private stripId<T>(value:any):T{const clone=structuredClone(value);delete clone.id;return clone as T;}
}
