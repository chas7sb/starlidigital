import type {Store} from '../store.js';
import type {OrchestrationPlan,OrchestrationWorkStatus} from '../starli-orchestrator/domain.js';
import type {EngineActor} from './domain.js';
import {BusinessEngineService} from './service.js';
import {BusinessEngineOnboardingService,type OnboardingReadinessEvidence,type ConnectionReadiness} from './onboarding.js';
import {BusinessEngineMaterializer,MATERIALIZATION_COLLECTIONS,type EngineMaterialization} from './materializer.js';
import {BUSINESS_ENGINE_ORCHESTRATION_COLLECTIONS,BusinessEngineOrchestrationMaterializer,type BusinessEngineOrchestrationLink} from './orchestration-materializer.js';

export const MACHINERY_PREFLIGHT_STATUSES=['READY','NEEDS_INPUT','NEEDS_CONNECTION','NEEDS_APPROVAL_POLICY','NEEDS_PLANNING','UNAVAILABLE'] as const;
export type MachineryPreflightStatus=typeof MACHINERY_PREFLIGHT_STATUSES[number];
export type MachinerySelectionSuggestion={orchestrationPlanId:string;workPackageId:string;target:string;status:OrchestrationWorkStatus;projectId:string|null};
export type MachineryPreflightResult={
 status:MachineryPreflightStatus;
 onboarding:{missingFacts:string[];connectionBlockers:Array<{capabilityId:string;status:ConnectionReadiness}>;policyGaps:string[];unavailableReasons:string[];nextQuestion:string|null};
 businessEngineRef:{businessEngineId:string;engineVersionId:string}|null;
 planningRef:{materializationId:string;orchestrationPlanId:string;planStatus:OrchestrationPlan['status'];revision:number}|null;
 selectionSuggestions:MachinerySelectionSuggestion[];
 nextAction:string;
};

type Scope={tenantId:string;ownerId:string};
const clone=<T>(v:T):T=>structuredClone(v);

/** Read-only customer-safe preflight. It never creates planning/execution state. */
export class MachineryPreflightService{
 private onboarding:BusinessEngineOnboardingService;
 private engines:BusinessEngineService;
 private bridge:BusinessEngineOrchestrationMaterializer;
 private materializer:BusinessEngineMaterializer;
 constructor(private store:Store){this.onboarding=new BusinessEngineOnboardingService(store);this.engines=new BusinessEngineService(store);this.bridge=new BusinessEngineOrchestrationMaterializer(store);this.materializer=new BusinessEngineMaterializer(store)}
 private tenant(a:EngineActor){return a.workspaceTenantId||a.userId}
 private scoped(a:EngineActor,r:Scope){return r.tenantId===this.tenant(a)&&r.ownerId===a.userId}
 evaluate(a:EngineActor,input:{evidence?:OnboardingReadinessEvidence;businessEngineId?:string}={}):MachineryPreflightResult{
  const readiness=this.onboarding.readiness(a,input.evidence||{}),base={missingFacts:[...readiness.missingFacts],connectionBlockers:clone(readiness.connectionBlockers),policyGaps:[...readiness.policyGaps],unavailableReasons:[...readiness.unavailableReasons],nextQuestion:readiness.nextQuestion};
  if(readiness.status==='NEEDS_INPUT')return{status:'NEEDS_INPUT',onboarding:base,businessEngineRef:null,planningRef:null,selectionSuggestions:[],nextAction:readiness.nextQuestion||'Provide the missing business facts.'};
  if(readiness.status==='NEEDS_APPROVAL_POLICY')return{status:'NEEDS_APPROVAL_POLICY',onboarding:base,businessEngineRef:null,planningRef:null,selectionSuggestions:[],nextAction:readiness.nextQuestion||'Complete autonomy, approval, DNC, and business-hours policy.'};
  if(readiness.status==='UNAVAILABLE')return{status:'UNAVAILABLE',onboarding:base,businessEngineRef:null,planningRef:null,selectionSuggestions:[],nextAction:readiness.unavailableReasons[0]||'A required capability is unavailable.'};
  if(readiness.status==='NEEDS_CONNECTION')return{status:'NEEDS_CONNECTION',onboarding:base,businessEngineRef:null,planningRef:null,selectionSuggestions:[],nextAction:readiness.nextQuestion||'Connect the required capability.'};

  // Administrative visibility is not permission to surface another owner's
  // business planning references in a customer-scoped preflight response.
  const engines=(input.businessEngineId?[this.engines.getEngine(a,input.businessEngineId)]:this.engines.listEngines(a)).filter(e=>this.scoped(a,e));
  const engine=engines.find(e=>!!e.currentVersionId&&!!e.blueprint)||engines[0];
  if(!engine||!engine.currentVersionId)return{status:'NEEDS_PLANNING',onboarding:base,businessEngineRef:engine?{businessEngineId:engine.id,engineVersionId:engine.currentVersionId||''}:null,planningRef:null,selectionSuggestions:[],nextAction:'Compile and version the Business Engine before starting Machinery.'};
  const engineRef={businessEngineId:engine.id,engineVersionId:engine.currentVersionId};
  const materializations=(this.store.list(MATERIALIZATION_COLLECTIONS.runs,a.userId) as EngineMaterialization[]).filter(m=>this.scoped(a,m)&&m.businessEngineId===engine.id&&m.engineVersionId===engine.currentVersionId).sort((x,y)=>y.createdAt.localeCompare(x.createdAt));
  const materialization=materializations[0];
  if(!materialization)return{status:'NEEDS_PLANNING',onboarding:base,businessEngineRef:engineRef,planningRef:null,selectionSuggestions:[],nextAction:'Materialize the current Business Engine version before starting Machinery.'};
  const links=(this.store.list(BUSINESS_ENGINE_ORCHESTRATION_COLLECTIONS.links,a.userId) as BusinessEngineOrchestrationLink[]).filter(l=>this.scoped(a,l)&&l.materializationId===materialization.id&&l.businessEngineId===engine.id&&l.engineVersionId===engine.currentVersionId);
  if(links.length!==1)return{status:'NEEDS_PLANNING',onboarding:base,businessEngineRef:engineRef,planningRef:null,selectionSuggestions:[],nextAction:links.length?'Reconcile duplicate Business Engine orchestration provenance before starting Machinery.':'Create the canonical OrchestrationPlan for the existing materialization.'};
  // The canonical bridge verifies the deterministic link identity and the
  // Orchestrator validates both immutable plan definition and lifecycle hashes.
  // Reading the raw records here could present tampered work as selectable.
  let plan:OrchestrationPlan;
  try{plan=this.bridge.getPlan(a,materialization.id)}catch{return{status:'NEEDS_PLANNING',onboarding:base,businessEngineRef:engineRef,planningRef:null,selectionSuggestions:[],nextAction:'Reconcile canonical orchestration provenance before starting Machinery.'}}
  if(plan.id!==links[0].orchestrationPlanId||!this.scoped(a,plan)||plan.businessMaterializationRef?.businessEngineId!==engine.id||plan.businessMaterializationRef?.engineVersionId!==engine.currentVersionId||plan.businessMaterializationRef?.materializationId!==materialization.id)return{status:'NEEDS_PLANNING',onboarding:base,businessEngineRef:engineRef,planningRef:null,selectionSuggestions:[],nextAction:'Reconcile canonical orchestration provenance before starting Machinery.'};
  // Materialization package IDs are immutable provenance, not an optional hint.
  // A canonical plan hash alone cannot establish that the source history still
  // contains exactly the same scoped work packages after record corruption.
  const expected=materialization.packageIds;
  let sourcePackages:ReturnType<BusinessEngineMaterializer['listPackages']>;
  try{sourcePackages=this.materializer.listPackages(a,engine.id,materialization.id)}catch{sourcePackages=[]}
  const sourceIds=plan.workPackages.map(w=>w.sourceRef?.kind==='BUSINESS_ENGINE_WORK_PACKAGE'?w.sourceRef.id:null);
  const expectedSet=new Set(expected),actualSet=new Set(sourcePackages.map(p=>p.id));
  if(expected.length===0||expectedSet.size!==expected.length||sourcePackages.length!==expected.length||actualSet.size!==expected.length||sourceIds.length!==expected.length||sourceIds.some((id,index)=>id!==expected[index])||sourcePackages.some(p=>!expectedSet.has(p.id)||!this.scoped(a,p)||p.businessEngineId!==engine.id||p.engineVersionId!==engine.currentVersionId||p.materializationId!==materialization.id||p.dependencyPackageIds.some(id=>!expectedSet.has(id))))return{status:'NEEDS_PLANNING',onboarding:base,businessEngineRef:engineRef,planningRef:null,selectionSuggestions:[],nextAction:'Reconcile immutable Business Engine materialization package history before starting Machinery.'};
  if(plan.status==='STOPPED'||plan.status==='FAILED')return{status:'NEEDS_PLANNING',onboarding:base,businessEngineRef:engineRef,planningRef:{materializationId:materialization.id,orchestrationPlanId:plan.id,planStatus:plan.status,revision:plan.revision},selectionSuggestions:[],nextAction:'Create or reconcile a non-terminal canonical plan before starting Machinery.'};
  const suggestions=plan.workPackages.filter(w=>['READY','WAITING_INPUT','WAITING_APPROVAL','BLOCKED'].includes(w.status)).map(w=>({orchestrationPlanId:plan.id,workPackageId:w.id,target:w.target,status:w.status,projectId:w.projectId||null}));
  return{status:'READY',onboarding:base,businessEngineRef:engineRef,planningRef:{materializationId:materialization.id,orchestrationPlanId:plan.id,planStatus:plan.status,revision:plan.revision},selectionSuggestions:suggestions,nextAction:suggestions.some(s=>s.status==='READY')?'Select canonical READY work for a MachineryRun.':'Inspect the canonical plan blockers before selecting work.'};
 }
}
