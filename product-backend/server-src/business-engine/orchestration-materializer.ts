import {safeKey} from '../starli-orchestrator/policy.js';
import {createHash} from 'node:crypto';
import type {RecordData,Store} from '../store.js';
import type {OrchestrationPlan} from '../starli-orchestrator/domain.js';
import {orchestrationFromBusinessEngine} from '../starli-orchestrator/business-engine-adapter.js';
import {StarliOrchestratorService} from '../starli-orchestrator/service.js';
import type {EngineActor} from './domain.js';
import {BusinessEngineMaterializer,type MaterializationPreflightInput} from './materializer.js';

export const BUSINESS_ENGINE_ORCHESTRATION_COLLECTIONS={links:'business-engine-orchestration-links'} as const;
export type BusinessEngineOrchestrationLink=RecordData&{
 tenantId:string;ownerId:string;businessEngineId:string;engineVersionId:string;materializationId:string;orchestrationPlanId:string;fingerprint:string;createdAt:string;updatedAt:string;
};

const stable=(x:unknown):string=>Array.isArray(x)?`[${x.map(stable).join(',')}]`:x&&typeof x==='object'?`{${Object.entries(x as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`:JSON.stringify(x);
const digest=(x:unknown)=>createHash('sha256').update(stable(x)).digest('hex');
const clone=<T>(v:T):T=>structuredClone(v);

/**
 * V3 bridge: Business Engine owns immutable intent/materialization provenance;
 * Starli Orchestrator owns all live work-package lifecycle state.
 */
export class BusinessEngineOrchestrationMaterializer{
 private materializer:BusinessEngineMaterializer;
 private orchestrator:StarliOrchestratorService;
 constructor(private store:Store,orchestrator?:StarliOrchestratorService){this.materializer=new BusinessEngineMaterializer(store);this.orchestrator=orchestrator||new StarliOrchestratorService(store)}
 private tenant(a:EngineActor){return a.workspaceTenantId||a.userId}
 private linkId(tenantId:string,materializationId:string){return `be-orch:${digest({tenantId,materializationId}).slice(0,40)}`}
 private loadLink(a:EngineActor,materializationId:string){const expectedId=this.linkId(this.tenant(a),materializationId),link=this.store.get(BUSINESS_ENGINE_ORCHESTRATION_COLLECTIONS.links,expectedId) as BusinessEngineOrchestrationLink|undefined;if(!link)return undefined;if(link.id!==expectedId||link.materializationId!==materializationId||link.tenantId!==this.tenant(a))throw new Error('Business engine orchestration link provenance mismatch.');if(a.role!=='ADMIN'&&link.ownerId!==a.userId)throw new Error('Business engine orchestration access denied.');return link}

 materialize(a:EngineActor,input:{businessEngineId:string;engineVersionId:string;goal:string;idempotencyKey:string;projectId?:string|null;preflight?:MaterializationPreflightInput}){
  const legacy=this.materializer.materialize(a,{businessEngineId:input.businessEngineId,engineVersionId:input.engineVersionId,idempotencyKey:`${input.idempotencyKey}:materialization`,preflight:input.preflight});
  return this.reconcileExisting(a,{goal:input.goal,idempotencyKey:input.idempotencyKey,projectId:input.projectId,materializationId:legacy.materialization.id});
 }

 /** Migration/reconciliation entrypoint for durable V2 materializations. */
 reconcileExisting(a:EngineActor,input:{goal:string;idempotencyKey:string;materializationId:string;projectId?:string|null}){
  safeKey(input.idempotencyKey);
  const materialization=this.materializer.getMaterialization(a,input.materializationId);
  if(materialization.tenantId!==this.tenant(a)||materialization.ownerId!==a.userId)throw new Error('Business engine orchestration scope mismatch.');
  const packageRows=this.materializer.listPackages(a,materialization.businessEngineId,materialization.id);
  const byId=new Map(packageRows.map(p=>[p.id,p]));
  const packages=materialization.packageIds.map(id=>byId.get(id)).filter((p):p is NonNullable<typeof p>=>!!p);
  const expected=new Set(materialization.packageIds),actual=new Set(packageRows.map(p=>p.id));
  if(packageRows.length!==materialization.packageIds.length||packages.length!==materialization.packageIds.length||expected.size!==materialization.packageIds.length||actual.size!==packageRows.length||packageRows.some(p=>!expected.has(p.id)||p.tenantId!==materialization.tenantId||p.ownerId!==materialization.ownerId||p.businessEngineId!==materialization.businessEngineId||p.engineVersionId!==materialization.engineVersionId||p.materializationId!==materialization.id))throw new Error('Materialization package history is incomplete or provenance-mismatched.');
  if(packages.some(p=>p.dependencyPackageIds.some(id=>!actual.has(id))))throw new Error('Materialization package dependency history is incomplete.');
  const canonicalInput=orchestrationFromBusinessEngine({goal:input.goal,idempotencyKey:`be-v3:${digest({tenantId:materialization.tenantId,ownerId:materialization.ownerId,materializationId:materialization.id})}`,materialization,packages,projectId:input.projectId});
  const fingerprint=digest({materializationId:materialization.id,engineVersionId:materialization.engineVersionId,goal:canonicalInput.goal,projectId:canonicalInput.projectId,workPackages:canonicalInput.workPackages});
  const existing=this.loadLink(a,materialization.id);
  if(existing){
   if(existing.fingerprint!==fingerprint)throw new Error('Business engine orchestration reconciliation conflict.');
   const plan=this.orchestrator.getPlan(a,existing.orchestrationPlanId);
   this.assertProvenance(materialization.id,materialization.businessEngineId,materialization.engineVersionId,plan);
   return {materialization:clone(materialization),packages:clone(packages),plan,link:clone(existing)};
  }
  const plan=this.orchestrator.createPlan(a,canonicalInput);
  this.assertProvenance(materialization.id,materialization.businessEngineId,materialization.engineVersionId,plan);
  const at=new Date().toISOString();
  const link:BusinessEngineOrchestrationLink={id:this.linkId(materialization.tenantId,materialization.id),tenantId:materialization.tenantId,ownerId:materialization.ownerId,businessEngineId:materialization.businessEngineId,engineVersionId:materialization.engineVersionId,materializationId:materialization.id,orchestrationPlanId:plan.id,fingerprint,createdAt:at,updatedAt:at};
  this.store.put(BUSINESS_ENGINE_ORCHESTRATION_COLLECTIONS.links,link,materialization.ownerId);
  return {materialization:clone(materialization),packages:clone(packages),plan,link:clone(link)};
 }

 refresh(a:EngineActor,materializationId:string,expectedRevision:number){
  const link=this.loadLink(a,materializationId);if(!link)throw new Error('Business engine orchestration link not found.');
  const before=this.orchestrator.getPlan(a,link.orchestrationPlanId);this.assertProvenance(link.materializationId,link.businessEngineId,link.engineVersionId,before);
  const plan=this.orchestrator.refresh(a,before.id,expectedRevision);this.assertProvenance(link.materializationId,link.businessEngineId,link.engineVersionId,plan);
  return plan;
 }

 getPlan(a:EngineActor,materializationId:string){const link=this.loadLink(a,materializationId);if(!link)throw new Error('Business engine orchestration link not found.');const plan=this.orchestrator.getPlan(a,link.orchestrationPlanId);this.assertProvenance(link.materializationId,link.businessEngineId,link.engineVersionId,plan);return plan}

 private assertProvenance(materializationId:string,businessEngineId:string,engineVersionId:string,plan:OrchestrationPlan){const ref=plan.businessMaterializationRef;if(!ref||ref.materializationId!==materializationId||ref.businessEngineId!==businessEngineId||ref.engineVersionId!==engineVersionId)throw new Error('Canonical orchestration plan provenance mismatch.')}
}
