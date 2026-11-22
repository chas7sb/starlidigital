import {createHash, randomUUID} from 'node:crypto';
import type {Store, RecordData} from '../store.js';
import {now} from '../store.js';
import type {ApprovalClass, BusinessKPIReference, BusinessRoutineDefinition, BusinessWorkflowDefinition, EngineActor, EngineComponent, EngineVersion} from './domain.js';
import {BusinessEngineService} from './service.js';

export const MATERIALIZATION_COLLECTIONS={
 runs:'business-engine-materializations',
 packages:'business-engine-work-packages',
 idempotency:'business-engine-materialization-idempotency',
} as const;

export const WORK_PACKAGE_TARGETS=['CREATIVE_PROJECT','BACKEND_FACTORY','HOSTED_AGENT','VIDEO_DIRECTOR','SOCIAL_CAMPAIGN','CAPABILITY_REQUIREMENT','AGENCY_WORKFLOW','KPI_MEASUREMENT'] as const;
export type WorkPackageTarget=typeof WORK_PACKAGE_TARGETS[number];
export type WorkPackageStatus='READY'|'WAITING_APPROVAL'|'WAITING_INPUT'|'BLOCKED';
export type ComplexityClass='LOW'|'MEDIUM'|'HIGH';
export type CostClass='LOW'|'MEDIUM'|'HIGH'|'UNKNOWN';
export type ConnectionState='CONNECTED'|'NOT_CONNECTED'|'NOT_REQUIRED'|'UNKNOWN';
export type CapabilityPreflight={capabilityId:string;available:boolean;connection:ConnectionState;approvalGranted?:boolean};
export type MaterializationPreflightInput={capabilities?:CapabilityPreflight[];answeredQuestionIds?:string[]};

export type CreativeProjectWork={kind:'CREATIVE_PROJECT';componentIds:string[];artifactKinds:string[];brief:string};
export type BackendFactoryWork={kind:'BACKEND_FACTORY';componentIds:string[];services:Array<{componentId:string;label:string}>};
export type HostedAgentWork={kind:'HOSTED_AGENT';componentIds:string[];agents:Array<{componentId:string;label:string}>};
export type VideoDirectorWork={kind:'VIDEO_DIRECTOR';componentIds:string[];brief:string;sourceArtifactComponentIds:string[]};
export type SocialCampaignWork={kind:'SOCIAL_CAMPAIGN';componentIds:string[];objective:string;sourceCreativeComponentIds:string[]};
export type CapabilityRequirementWork={kind:'CAPABILITY_REQUIREMENT';capabilityIds:string[]};
export type AgencyWorkflowWork={kind:'AGENCY_WORKFLOW';workflowIds:string[];routineIds:string[]};
export type KpiMeasurementWork={kind:'KPI_MEASUREMENT';kpis:Array<Pick<BusinessKPIReference,'id'|'metricKey'|'label'|'sourceRef'|'target'>>};
export type WorkPackagePayload=CreativeProjectWork|BackendFactoryWork|HostedAgentWork|VideoDirectorWork|SocialCampaignWork|CapabilityRequirementWork|AgencyWorkflowWork|KpiMeasurementWork;

export type EngineWorkPackage={
 id:string; tenantId:string; ownerId:string; businessEngineId:string; engineVersionId:string; materializationId:string;
 target:WorkPackageTarget; status:WorkPackageStatus; approvalClass:ApprovalClass; dependencyPackageIds:string[];
 sourceComponentIds:string[]; capabilityRequirements:string[]; missingCapabilities:string[]; missingConnections:string[]; blockedDependencyPackageIds:string[];
 customerInputQuestions:string[]; complexity:ComplexityClass; costClass:CostClass; payload:WorkPackagePayload; createdAt:string;
};

export type MaterializationPreflight={
 missingCapabilities:string[]; missingConnections:string[]; approvalPackageIds:string[]; blockedPackageIds:string[];
 blockedDependencies:Array<{packageId:string;blockedByPackageIds:string[]}>; immediatePackageIds:string[]; customerInputPackageIds:string[]; unresolvedQuestions:string[];
 complexity:ComplexityClass; costClass:CostClass;
};
export type EngineMaterialization={
 id:string; tenantId:string; ownerId:string; businessEngineId:string; engineVersionId:string; packageIds:string[];
 preflight:MaterializationPreflight; createdAt:string;
};

type Idem=RecordData&{tenantId:string;ownerId:string;scope:string;key:string;fingerprint:string;resultId:string};
const SAFE_KEY=/^[A-Za-z0-9_.:-]{1,128}$/;
const clone=<T>(v:T):T=>structuredClone(v);
const stable=(x:unknown):string=>Array.isArray(x)?`[${x.map(stable).join(',')}]`:x&&typeof x==='object'?`{${Object.entries(x as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`:JSON.stringify(x);
const digest=(x:unknown)=>createHash('sha256').update(stable(x)).digest('hex');
const maxApproval=(components:EngineComponent[]):ApprovalClass=>components.some(c=>c.approvalClass==='EXPLICIT_APPROVAL')?'EXPLICIT_APPROVAL':components.some(c=>c.approvalClass==='REVIEW')?'REVIEW':'NONE';
const complexityFor=(componentCount:number,capCount:number,deps:number):ComplexityClass=>componentCount>=5||capCount>=4||deps>=4?'HIGH':componentCount>=2||capCount>=2||deps>=2?'MEDIUM':'LOW';
const costFor=(target:WorkPackageTarget,complexity:ComplexityClass):CostClass=>target==='CAPABILITY_REQUIREMENT'||target==='KPI_MEASUREMENT'||target==='AGENCY_WORKFLOW'?'LOW':complexity==='HIGH'?'HIGH':complexity==='MEDIUM'?'MEDIUM':'LOW';

export class BusinessEngineMaterializer{
 private engines:BusinessEngineService;
 constructor(private store:Store){this.engines=new BusinessEngineService(store)}
 private tenant(a:EngineActor){return a.workspaceTenantId||a.userId}
 private version(a:EngineActor,businessEngineId:string,engineVersionId:string){
  this.engines.getEngine(a,businessEngineId);
  const v=this.engines.listVersions(a,businessEngineId).find(x=>x.id===engineVersionId);
  if(!v)throw new Error('Engine version not found.');
  return v;
 }
 private idem(a:EngineActor,scope:string,key:string,fp:string){
  if(!SAFE_KEY.test(key))throw new Error('Invalid idempotency key.');
  const id=`${a.userId}:${this.tenant(a)}:${scope}:${key}`;
  const old=this.store.get(MATERIALIZATION_COLLECTIONS.idempotency,id) as Idem|undefined;
  if(!old)return undefined;
  if(old.ownerId!==a.userId||old.tenantId!==this.tenant(a)||old.fingerprint!==fp)throw new Error('Idempotency key conflict.');
  return old.resultId;
 }
 private saveIdem(a:EngineActor,scope:string,key:string,fp:string,resultId:string){
  const id=`${a.userId}:${this.tenant(a)}:${scope}:${key}`;
  this.store.put(MATERIALIZATION_COLLECTIONS.idempotency,{id,tenantId:this.tenant(a),ownerId:a.userId,scope,key,fingerprint:fp,resultId},a.userId);
 }
 listPackages(a:EngineActor,businessEngineId:string,materializationId?:string){
  this.engines.getEngine(a,businessEngineId);
  return (this.store.list(MATERIALIZATION_COLLECTIONS.packages,a.role==='ADMIN'?undefined:a.userId) as EngineWorkPackage[])
   .filter(p=>p.businessEngineId===businessEngineId&&p.tenantId===this.tenant(a)&&(!materializationId||p.materializationId===materializationId)).map(clone);
 }
 getMaterialization(a:EngineActor,id:string){
  const r=this.store.get(MATERIALIZATION_COLLECTIONS.runs,id) as EngineMaterialization|undefined;
  if(!r)throw new Error('Engine materialization not found.');
  if(a.role!=='ADMIN'&&(r.ownerId!==a.userId||r.tenantId!==this.tenant(a)))throw new Error('Business engine access denied.');
  return clone(r);
 }
 materialize(a:EngineActor,input:{businessEngineId:string;engineVersionId:string;idempotencyKey:string;preflight?:MaterializationPreflightInput}){
  const version=this.version(a,input.businessEngineId,input.engineVersionId);
  const workflows=this.engines.listWorkflows(a,input.businessEngineId),routines=this.engines.listRoutines(a,input.businessEngineId);
  const capState=new Map((input.preflight?.capabilities||[]).map(c=>[c.capabilityId,c]));
  const fp=digest({engineVersionId:version.id,blueprint:version.blueprint,workflows,routines,preflight:input.preflight||{}});
  const scope=`materialize:${input.businessEngineId}:${input.engineVersionId}`;
  const old=this.idem(a,scope,input.idempotencyKey,fp);
  if(old)return {materialization:this.getMaterialization(a,old),packages:this.listPackages(a,input.businessEngineId,old)};
  const materializationId=randomUUID(),packages=this.buildPackages(version,workflows,routines,materializationId,capState,input.preflight?.answeredQuestionIds||[]);
  const preflight=this.summarize(version,packages,input.preflight?.answeredQuestionIds||[]);
  const run:EngineMaterialization={id:materializationId,tenantId:version.tenantId,ownerId:version.ownerId,businessEngineId:version.businessEngineId,engineVersionId:version.id,packageIds:packages.map(p=>p.id),preflight,createdAt:now()};
  this.store.db.exec('BEGIN IMMEDIATE');
  try{for(const p of packages)this.store.put(MATERIALIZATION_COLLECTIONS.packages,p,version.ownerId);this.store.put(MATERIALIZATION_COLLECTIONS.runs,run,version.ownerId);this.saveIdem(a,scope,input.idempotencyKey,fp,run.id);this.store.db.exec('COMMIT')}catch(err){this.store.db.exec('ROLLBACK');throw err}
  return {materialization:clone(run),packages:packages.map(clone)};
 }
 private buildPackages(version:EngineVersion,workflows:BusinessWorkflowDefinition[],routines:BusinessRoutineDefinition[],materializationId:string,capState:Map<string,CapabilityPreflight>,answered:string[]){
  const cs=version.blueprint.components,createdAt=now(),packageSpecs:Array<{target:WorkPackageTarget;components:EngineComponent[];payload:WorkPackagePayload;deps:WorkPackageTarget[]}>=[];
  const creative=cs.filter(c=>c.kind==='PRESENCE'||c.kind==='BRAND_CREATIVE');
  if(creative.length)packageSpecs.push({target:'CREATIVE_PROJECT',components:creative,payload:{kind:'CREATIVE_PROJECT',componentIds:creative.map(c=>c.componentId),artifactKinds:[...new Set(creative.map(c=>c.kind==='PRESENCE'?'PRESENCE':'BRAND_CREATIVE'))],brief:`Create customer-facing artifacts for ${version.blueprint.customerPromise||'the approved business engine objective'}.`},deps:[]});
  const backend=cs.filter(c=>c.kind==='PRODUCT_INFRASTRUCTURE'||c.kind==='INFRASTRUCTURE');
  if(backend.length)packageSpecs.push({target:'BACKEND_FACTORY',components:backend,payload:{kind:'BACKEND_FACTORY',componentIds:backend.map(c=>c.componentId),services:backend.map(c=>({componentId:c.componentId,label:c.label}))},deps:[]});
  const agent=cs.filter(c=>(c.kind==='SALES'||c.kind==='SERVICE_SUPPORT')&&/agent|support|qualification|enquiry/i.test(c.label));
  if(agent.length)packageSpecs.push({target:'HOSTED_AGENT',components:agent,payload:{kind:'HOSTED_AGENT',componentIds:agent.map(c=>c.componentId),agents:agent.map(c=>({componentId:c.componentId,label:c.label}))},deps:[]});
  const videoSources=cs.filter(c=>c.kind==='BRAND_CREATIVE');
  if(videoSources.length)packageSpecs.push({target:'VIDEO_DIRECTOR',components:videoSources,payload:{kind:'VIDEO_DIRECTOR',componentIds:videoSources.map(c=>c.componentId),brief:`Prepare launch-ready video creative for ${version.blueprint.customerPromise||'this business engine'}.`,sourceArtifactComponentIds:creative.map(c=>c.componentId)},deps:['CREATIVE_PROJECT']});
  const social=cs.filter(c=>c.kind==='ACQUISITION'||c.kind==='DISTRIBUTION');
  if(social.length)packageSpecs.push({target:'SOCIAL_CAMPAIGN',components:social,payload:{kind:'SOCIAL_CAMPAIGN',componentIds:social.map(c=>c.componentId),objective:'Prepare a customer-reviewable acquisition/distribution campaign plan.',sourceCreativeComponentIds:creative.map(c=>c.componentId)},deps:creative.length?['CREATIVE_PROJECT']:[]});
  const allCaps=[...new Set(cs.flatMap(c=>c.capabilityRequirements).concat(workflows.flatMap(w=>w.capabilityRequirements)))].sort();
  if(allCaps.length)packageSpecs.push({target:'CAPABILITY_REQUIREMENT',components:cs.filter(c=>c.capabilityRequirements.length),payload:{kind:'CAPABILITY_REQUIREMENT',capabilityIds:allCaps},deps:[]});
  if(workflows.length||routines.length)packageSpecs.push({target:'AGENCY_WORKFLOW',components:cs.filter(c=>['SALES','SERVICE_SUPPORT','OPERATIONS'].includes(c.kind)),payload:{kind:'AGENCY_WORKFLOW',workflowIds:workflows.map(w=>w.id),routineIds:routines.map(r=>r.id)},deps:allCaps.length?['CAPABILITY_REQUIREMENT']:[]});
  if(version.blueprint.kpis.length)packageSpecs.push({target:'KPI_MEASUREMENT',components:cs.filter(c=>c.kind==='INTELLIGENCE'),payload:{kind:'KPI_MEASUREMENT',kpis:version.blueprint.kpis.map(k=>({id:k.id,metricKey:k.metricKey,label:k.label,sourceRef:k.sourceRef,target:k.target}))},deps:[]});
  const ids=new Map<WorkPackageTarget,string>();for(const s of packageSpecs)ids.set(s.target,`wp-${digest({versionId:version.id,target:s.target,components:s.components.map(c=>c.componentId),payload:s.payload}).slice(0,20)}`);
  const unresolved=version.blueprint.unresolvedQuestions.filter((_,i)=>!answered.includes(String(i)));
  return packageSpecs.map(s=>{
   const caps=[...new Set(s.components.flatMap(c=>c.capabilityRequirements).concat(s.target==='CAPABILITY_REQUIREMENT'?(s.payload as CapabilityRequirementWork).capabilityIds:[]))].sort();
   const missingCapabilities=caps.filter(id=>capState.get(id)?.available!==true);
   const missingConnections=caps.filter(id=>{const x=capState.get(id);return x?.available===true&&(x.connection==='NOT_CONNECTED'||x.connection==='UNKNOWN')});
   const approvalClass=maxApproval(s.components),deps=s.deps.map(d=>ids.get(d)).filter((x):x is string=>!!x),complexity=complexityFor(s.components.length,caps.length,deps.length);
   const questions=unresolved.length&&s.components.some(c=>c.required)?unresolved:[];
   const status:WorkPackageStatus=missingCapabilities.length||missingConnections.length?'BLOCKED':questions.length?'WAITING_INPUT':approvalClass!=='NONE'?'WAITING_APPROVAL':'READY';
   return{id:ids.get(s.target)!,tenantId:version.tenantId,ownerId:version.ownerId,businessEngineId:version.businessEngineId,engineVersionId:version.id,materializationId,target:s.target,status,approvalClass,dependencyPackageIds:deps,sourceComponentIds:s.components.map(c=>c.componentId),capabilityRequirements:caps,missingCapabilities,missingConnections,blockedDependencyPackageIds:[],customerInputQuestions:questions,complexity,costClass:costFor(s.target,complexity),payload:s.payload,createdAt} satisfies EngineWorkPackage;
  }).map((p,_,all)=>{
   const blocked=p.dependencyPackageIds.filter(id=>all.find(x=>x.id===id)?.status!=='READY');
   return blocked.length?{...p,status:'BLOCKED' as const,blockedDependencyPackageIds:blocked}:p;
  });
 }
 private summarize(version:EngineVersion,packages:EngineWorkPackage[],answered:string[]):MaterializationPreflight{
  const unresolved=version.blueprint.unresolvedQuestions.filter((_,i)=>!answered.includes(String(i)));
  const complexity:ComplexityClass=packages.some(p=>p.complexity==='HIGH')?'HIGH':packages.some(p=>p.complexity==='MEDIUM')?'MEDIUM':'LOW';
  const costClass:CostClass=packages.some(p=>p.costClass==='HIGH')?'HIGH':packages.some(p=>p.costClass==='MEDIUM')?'MEDIUM':packages.some(p=>p.costClass==='UNKNOWN')?'UNKNOWN':'LOW';
  return{missingCapabilities:[...new Set(packages.flatMap(p=>p.missingCapabilities))].sort(),missingConnections:[...new Set(packages.flatMap(p=>p.missingConnections))].sort(),approvalPackageIds:packages.filter(p=>p.approvalClass!=='NONE'&&p.status!=='BLOCKED').map(p=>p.id),blockedPackageIds:packages.filter(p=>p.status==='BLOCKED').map(p=>p.id),blockedDependencies:packages.filter(p=>p.blockedDependencyPackageIds.length).map(p=>({packageId:p.id,blockedByPackageIds:[...p.blockedDependencyPackageIds]})),immediatePackageIds:packages.filter(p=>p.status==='READY').map(p=>p.id),customerInputPackageIds:packages.filter(p=>p.status==='WAITING_INPUT'||p.status==='WAITING_APPROVAL'||p.missingConnections.length).map(p=>p.id),unresolvedQuestions:unresolved,complexity,costClass};
 }
}
