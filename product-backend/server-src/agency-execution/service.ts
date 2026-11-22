import { createHash } from 'node:crypto';
import type { Store } from '../store.js';
import type { Events } from '../events.js';
import type { AgencyActionPlan, AutonomyLevel, VisitorProfile } from '../agency-intelligence/types.js';
import type { AgencyApprovalRecord } from '../agency-approvals/types.js';
import type { AutonomyPolicyRecord, StoredAutonomyScope } from '../autonomy-policy/types.js';
import { AUTONOMY_LEVELS, AutonomyPolicyService } from '../autonomy-policy/service.js';
import { CustomerCapabilityGateway } from '../customer-capabilities/gateway.js';
import { CustomerCapabilityRegistry } from '../customer-capabilities/registry.js';
import type { CapabilityDefinition } from '../customer-capabilities/types.js';
import type { AgencyExecutionBlockCode, AgencyExecutionReceipt, AgencyExecutionRequest, AgencyPolicyDecision, AgencyRetryClass } from './types.js';

const REQUESTS='agency-execution-requests', RECEIPTS='agency-execution-receipts', PLANS='agency-action-plans', APPROVALS='agency-approvals', PROFILES='agency-visitor-profiles';
const ID=/^[A-Za-z0-9_.:@-]{1,180}$/;
const RETRY_COOLDOWN_MS=30_000;
const CONTACT=/EMAIL|SMS|PHONE|DM|MESSAGE|FOLLOWUP|REPLY|CONTEXTUAL/i;
const FORBIDDEN=/SEND|PUBLISH|DELETE|REMOVE|PAY|CHARGE|REFUND|DEPLOY|MIGRAT|ROLLBACK|CRM\.(CREATE|UPDATE|DELETE)|SOCIAL\.(PUBLISH|SEND)|EMAIL\.SEND|DM\.SEND/i;
const INTERNAL_DRAFT=/draft|prepare|preview|compose|render\.preview/i;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const safeId=(value:string,label:string)=>{const v=String(value||'').trim();if(!ID.test(v))throw new Error(`Invalid ${label}`);return v;};
const iso=(ms:number)=>new Date(ms).toISOString();
const levelIndex=(level:AutonomyLevel)=>AUTONOMY_LEVELS.indexOf(level);
const planHash=(plan:AgencyActionPlan)=>hash(JSON.stringify({id:plan.id,tenantId:plan.tenantId,opportunityId:plan.opportunityId,action:plan.action,entityRefs:plan.entityRefs,evidenceRefs:plan.evidenceRefs,capabilityRequirement:plan.capabilityRequirement,approvalRequired:plan.approvalRequired,autonomyAllowed:plan.autonomyAllowed}));
const resultHash=(value:unknown)=>hash(JSON.stringify(value??null));

export class AgencyExecutionService {
  constructor(
    private store:Store,
    private gateway:CustomerCapabilityGateway,
    private registry:CustomerCapabilityRegistry,
    private policy:AutonomyPolicyService,
    private events?:Events,
    private clock=()=>Date.now()
  ){}

  createRequest(input:{tenantId:string;actionPlanId:string;projectId?:string;input?:Record<string,unknown>;approvalId?:string;capabilityApprovalReferenceId?:string;requestedBy:string}){
    const tenantId=safeId(input.tenantId,'tenant'), planId=safeId(input.actionPlanId,'action plan');
    const plan=this.plan(tenantId,planId), capabilityId=plan.capabilityRequirement?.trim();
    if(!capabilityId)throw new Error('Action plan has no executable capability requirement');
    safeId(capabilityId,'capability');
    const projectId=this.resolveProject(plan,input.projectId);
    const actionPlanHash=planHash(plan), payload=Object.freeze(structuredClone(input.input||{}));
    if(plan.approvalRequired&&Object.keys(payload).length)throw new Error('Approved action plans cannot accept unbound execution input');
    const requestFingerprint=hash(JSON.stringify({tenantId,planId,actionPlanHash,capabilityId,projectId:projectId||null,input:payload,approvalId:input.approvalId||null,capabilityApprovalReferenceId:input.capabilityApprovalReferenceId||null}));
    const id=`exec:${requestFingerprint.slice(0,32)}`;
    const existing=this.store.get(REQUESTS,id) as AgencyExecutionRequest|undefined;
    if(existing){if(existing.tenantId!==tenantId)throw new Error('Execution request tenant mismatch');return existing;}
    const requestedAt=iso(this.clock());
    const request:AgencyExecutionRequest={id,tenantId,actionPlanId:planId,actionPlanHash,requestHash:requestFingerprint,capabilityId,projectId,input:payload,approvalId:input.approvalId,capabilityApprovalReferenceId:input.capabilityApprovalReferenceId,idempotencyKey:`agency:${requestFingerprint}`,correlationId:`agency-exec:${planId}:${requestFingerprint.slice(0,16)}`,requestedBy:safeId(input.requestedBy,'principal'),requestedAt,state:'READY'};
    this.store.put(REQUESTS,request,tenantId);return request;
  }

  stop(tenantId:string,requestId:string,reason='Stopped by operator'){
    const request=this.request(tenantId,requestId);if(['SUCCEEDED','FAILED','BLOCKED','STOPPED'].includes(request.state))return request;
    const before=JSON.stringify(request);
    request.state='STOPPED';request.stoppedAt=iso(this.clock());request.stopReason=String(reason).slice(0,160);
    if(!this.compareAndSwap(request,before))return this.request(tenantId,requestId);
    this.emit('agency.action.blocked',request,{status:'STOPPED',reason:'operator_stop'});return request;
  }

  async execute(tenantId:string,requestId:string):Promise<AgencyExecutionReceipt>{
    const request=this.request(tenantId,requestId), startedAt=iso(this.clock());
    const existing=this.store.get(RECEIPTS,request.id) as AgencyExecutionReceipt|undefined;
    if(existing&&['SUCCEEDED','STOPPED'].includes(existing.state))return existing;
    if(request.state==='FAILED'){
      if(!existing)throw new Error('EXECUTION_OUTCOME_UNCERTAIN: inspect the persisted failed request; no receipt is available');
      if(existing.retryClass==='NOT_RETRYABLE')return existing;
    }
    if(request.state==='RUNNING')throw new Error('EXECUTION_IN_PROGRESS_OR_UNCERTAIN: inspect the existing request and capability receipt; do not reissue');
    if(request.state==='STOPPED')return this.finish(request,'STOPPED',startedAt,{blockCode:'STOPPED',retryClass:'NOT_RETRYABLE'});
    const persistedBefore=JSON.stringify(request);
    const attempt=request.attempt??0;if(!Number.isSafeInteger(attempt)||attempt<0||attempt>=Number.MAX_SAFE_INTEGER)throw new Error('EXECUTION_OUTCOME_UNCERTAIN: invalid attempt counter');request.attempt=attempt+1;
    const plan=this.plan(request.tenantId,request.actionPlanId);
    if(planHash(plan)!==request.actionPlanHash)return this.block(request,startedAt,'PLAN_TAMPERED','Approved action plan payload changed');
    const definition=this.registry.get(request.capabilityId)?.definition;
    if(!definition)return this.block(request,startedAt,'CAPABILITY_UNAVAILABLE','Required capability is not registered');
    const allow=this.allowlisted(definition,request.capabilityId);if(!allow)return this.block(request,startedAt,'CAPABILITY_NOT_ALLOWED','Capability is outside the first-phase execution allowlist');
    if(definition.projectScoped&&!request.projectId)return this.block(request,startedAt,'PROJECT_REQUIRED','Capability requires project scope');
    if(this.contactSuppressed(plan))return this.block(request,startedAt,'DO_NOT_CONTACT','Contact action is blocked by visitor consent/preferences');
    const policy=this.decidePolicy(request.tenantId,plan,definition);if(!policy.allowed)return this.block(request,startedAt,policy.code! ,policy.reason);
    const approval=this.validateAgencyApproval(request,plan);if(!approval.allowed)return this.block(request,startedAt,approval.code!,approval.reason);
    const retry=this.retryCooldown(request);if(retry)return this.block(request,startedAt,'COOLDOWN_ACTIVE','Execution retry cooldown is active',retry);

    // Atomic compare-and-swap across processes; no transaction is held over network I/O.
    // Persisted RUNNING survives restart and requires inspection rather than replay.
    const before=persistedBefore;request.state='RUNNING';
    const claimed=this.store.db.prepare('UPDATE records SET payload=? WHERE collection=? AND id=? AND owner=? AND payload=?').run(JSON.stringify(request),REQUESTS,request.id,request.tenantId,before);
    if(Number(claimed.changes)!==1)throw new Error('EXECUTION_CHANGED: inspect the existing request before retrying');
    this.emit('agency.action.started',request,{status:'RUNNING',capabilityId:request.capabilityId});
    const caller={subjectId:`agency:${request.requestedBy}`,tenantId:request.tenantId,scopes:[...definition.requiredScopes],source:'CUSTOMER_AGENT' as const,requestId:request.id,autonomous:true};
    let result;
    try{result=await this.gateway.invoke(caller,{capabilityId:request.capabilityId,projectId:request.projectId,input:{...request.input},approvalReferenceId:request.capabilityApprovalReferenceId,idempotencyKey:request.idempotencyKey});}
    catch{
      const current=this.settle(request,'FAILED');
      if(current.state==='STOPPED')return this.finish(current,'STOPPED',startedAt,{retryClass:'NOT_RETRYABLE',blockCode:'STOPPED',completionAfterStop:'UNKNOWN',errorCode:'CAPABILITY_OUTCOME_UNKNOWN'});
      return this.finish(request,'FAILED',startedAt,{retryClass:'NOT_RETRYABLE',errorCode:'CAPABILITY_OUTCOME_UNKNOWN'});
    }
    const current=this.settle(request,result.ok?'SUCCEEDED':'FAILED');
    if(current.state==='STOPPED')return this.finish(current,'STOPPED',startedAt,{retryClass:'NOT_RETRYABLE',blockCode:'STOPPED',capabilityReceiptId:result.receipt.id,capabilityResultHash:result.ok?resultHash(result.data):undefined,completionAfterStop:result.ok?'SUCCEEDED':'FAILED'});
    if(result.ok){return this.finish(request,'SUCCEEDED',startedAt,{retryClass:'NOT_RETRYABLE',capabilityReceiptId:result.receipt.id,capabilityResultHash:resultHash(result.data)});}
    return this.finish(request,'FAILED',startedAt,{retryClass:this.retryClass(definition,result.error?.code),capabilityReceiptId:result.receipt.id,errorCode:result.error?.code||'CAPABILITY_FAILED'});
  }

  decision(tenantId:string,requestId:string){const request=this.request(tenantId,requestId),plan=this.plan(request.tenantId,request.actionPlanId),def=this.registry.get(request.capabilityId)?.definition;if(!def)return{allowed:false,requiredLevel:'OBSERVE',effectiveLevel:'OBSERVE',code:'CAPABILITY_UNAVAILABLE',reason:'Required capability is not registered'} as AgencyPolicyDecision;return this.decidePolicy(request.tenantId,plan,def);}
  getRequest(tenantId:string,requestId:string){return structuredClone(this.request(tenantId,requestId));}
  getReceipt(tenantId:string,requestId:string){this.request(tenantId,requestId);const receipt=this.store.get(RECEIPTS,requestId) as AgencyExecutionReceipt|undefined;return receipt?structuredClone(receipt):undefined;}

  private compareAndSwap(request:AgencyExecutionRequest,before:string){return Number(this.store.db.prepare('UPDATE records SET payload=? WHERE collection=? AND id=? AND owner=? AND payload=?').run(JSON.stringify(request),REQUESTS,request.id,request.tenantId,before).changes)===1;}
  private settle(request:AgencyExecutionRequest,state:'SUCCEEDED'|'FAILED'){
    const before=JSON.stringify(request);request.state=state;
    if(this.compareAndSwap(request,before))return request;
    const current=this.request(request.tenantId,request.id);
    if(current.state!=='STOPPED')throw new Error('EXECUTION_CHANGED: inspect persisted outcome');
    return current;
  }
  private plan(tenantId:string,id:string){const plan=this.store.get(PLANS,id) as AgencyActionPlan|undefined;if(!plan||plan.tenantId!==tenantId)throw new Error('Action plan unavailable');return plan;}
  private request(tenantId:string,id:string){const tenant=safeId(tenantId,'tenant'),request=this.store.get(REQUESTS,safeId(id,'execution request')) as AgencyExecutionRequest|undefined;if(!request||request.tenantId!==tenant)throw new Error('Execution request unavailable');return request;}
  private resolveProject(plan:AgencyActionPlan,explicit?:string){const fromPlan=plan.entityRefs.find(ref=>['project','creative_project'].includes(ref.kind))?.id;if(explicit&&fromPlan&&explicit!==fromPlan)throw new Error('Project scope conflicts with action plan');return explicit?safeId(explicit,'project'):fromPlan;}
  private allowlisted(def:Readonly<CapabilityDefinition>,capabilityId:string){if(FORBIDDEN.test(capabilityId))return false;if(def.sideEffectLevel==='NONE'||def.sideEffectLevel==='READ')return true;if(def.sideEffectLevel==='WRITE'&&INTERNAL_DRAFT.test(capabilityId)&&!def.connectionRequired&&def.estimatedCost.financialCost==='NONE')return true;return false;}
  private requiredLevel(def:Readonly<CapabilityDefinition>):AutonomyLevel{return def.sideEffectLevel==='NONE'||def.sideEffectLevel==='READ'?'OBSERVE':'DRAFT';}
  private decidePolicy(tenantId:string,plan:AgencyActionPlan,def:Readonly<CapabilityDefinition>):AgencyPolicyDecision{
    const record=this.policy.record(tenantId),required=this.requiredLevel(def);if(record.pauseAll)return{allowed:false,requiredLevel:required,effectiveLevel:record.defaultLevel,code:'GLOBAL_PAUSED',reason:'Agency autonomy is globally paused'};
    const override=this.scopeOverride(record,def.id,plan.action.kind);if(override?.paused)return{allowed:false,requiredLevel:required,effectiveLevel:override.level,code:'SCOPE_PAUSED',reason:'Capability/workflow autonomy scope is paused'};
    const effective=override?.level||record.defaultLevel;if(levelIndex(effective)<levelIndex(required)||levelIndex(plan.autonomyAllowed)<levelIndex(required))return{allowed:false,requiredLevel:required,effectiveLevel:effective,code:'AUTONOMY_DENIED',reason:'Configured autonomy does not permit this bounded action'};
    return{allowed:true,requiredLevel:required,effectiveLevel:effective,reason:'Policy permits the bounded first-phase capability'};
  }
  private scopeOverride(record:AutonomyPolicyRecord,capabilityId:string,workflow:string):StoredAutonomyScope|undefined{return record.scopeOverrides.find(x=>x.kind==='CAPABILITY'&&x.scopeId===capabilityId)||record.scopeOverrides.find(x=>x.kind==='WORKFLOW'&&x.scopeId===workflow);}
  private validateAgencyApproval(request:AgencyExecutionRequest,plan:AgencyActionPlan):{allowed:boolean;code?:AgencyExecutionBlockCode;reason:string}{
    if(!plan.approvalRequired)return{allowed:true,reason:'No agency approval required'};if(!request.approvalId)return{allowed:false,code:'APPROVAL_REQUIRED',reason:'Exact action-plan approval is required'};
    const approval=this.store.get(APPROVALS,request.approvalId) as AgencyApprovalRecord|undefined;if(!approval||approval.tenantId!==request.tenantId||approval.actionPlanId!==plan.id)return{allowed:false,code:'APPROVAL_INVALID',reason:'Approval does not belong to this tenant/action plan'};
    if(approval.status!=='APPROVED'||!Number.isFinite(Date.parse(approval.expiresAt))||Date.parse(approval.expiresAt)<=this.clock()||approval.payloadHash!==request.actionPlanHash)return{allowed:false,code:'APPROVAL_INVALID',reason:'Approval is expired, revoked, unresolved, or payload-mismatched'};return{allowed:true,reason:'Exact immutable action plan was approved'};
  }
  private contactSuppressed(plan:AgencyActionPlan){if(!CONTACT.test(plan.action.kind)&&!CONTACT.test(plan.capabilityRequirement||''))return false;for(const ref of plan.entityRefs.filter(x=>x.kind==='visitor_profile')){const p=this.store.get(PROFILES,ref.id) as VisitorProfile|undefined;if(p&&p.tenantId===plan.tenantId&&(p.doNotContact||p.dismissed||p.consentRefs?.some(c=>c.status==='DENIED')||p.contactPreferences?.some(c=>c.allowed===false)))return true;}return false;}
  private retryCooldown(request:AgencyExecutionRequest){const receipt=this.store.get(RECEIPTS,request.id) as AgencyExecutionReceipt|undefined;if(!receipt||receipt.retryClass!=='SAFE_IDEMPOTENT_RETRY'||!receipt.nextRetryAt)return undefined;return Date.parse(receipt.nextRetryAt)>this.clock()?receipt.nextRetryAt:undefined;}
  private retryClass(def:Readonly<CapabilityDefinition>,error?:string):AgencyRetryClass{const transient=/RATE_LIMIT|UNAVAILABLE|TIMEOUT|TEMPORARY|CAPABILITY_EXCEPTION/i.test(error||'');return def.idempotent&&this.allowlisted(def,def.id)&&transient?'SAFE_IDEMPOTENT_RETRY':'NOT_RETRYABLE';}
  private block(request:AgencyExecutionRequest,startedAt:string,code:AgencyExecutionBlockCode,reason:string,nextRetryAt?:string){request.state='BLOCKED';this.store.put(REQUESTS,request,request.tenantId);return this.finish(request,'BLOCKED',startedAt,{blockCode:code,retryClass:code==='COOLDOWN_ACTIVE'?'SAFE_IDEMPOTENT_RETRY':'NOT_RETRYABLE',errorCode:reason,nextRetryAt});}
  private finish(request:AgencyExecutionRequest,state:'SUCCEEDED'|'FAILED'|'BLOCKED'|'STOPPED',startedAt:string,extra:{completionAfterStop?:'SUCCEEDED'|'FAILED'|'UNKNOWN';retryClass:AgencyRetryClass;capabilityReceiptId?:string;capabilityResultHash?:string;blockCode?:AgencyExecutionBlockCode;errorCode?:string;nextRetryAt?:string}){
    const completedAt=iso(this.clock()),nextRetryAt=extra.retryClass==='SAFE_IDEMPOTENT_RETRY'&&!extra.nextRetryAt?iso(this.clock()+RETRY_COOLDOWN_MS):extra.nextRetryAt;
    const receipt:AgencyExecutionReceipt={id:request.id,tenantId:request.tenantId,executionRequestId:request.id,actionPlanId:request.actionPlanId,capabilityId:request.capabilityId,projectId:request.projectId,correlationId:request.correlationId,state,attempt:request.attempt??0,completionAfterStop:extra.completionAfterStop,retryClass:extra.retryClass,capabilityReceiptId:extra.capabilityReceiptId,capabilityResultHash:extra.capabilityResultHash,blockCode:extra.blockCode,errorCode:extra.errorCode,startedAt,completedAt,nextRetryAt};
    this.store.put(RECEIPTS,receipt,request.tenantId);this.emit(state==='SUCCEEDED'?'agency.action.completed':state==='FAILED'?'agency.action.failed':'agency.action.blocked',request,{status:state,capabilityId:request.capabilityId,retryClass:receipt.retryClass,blockCode:receipt.blockCode||null,capabilityReceiptId:receipt.capabilityReceiptId||null});return receipt;
  }
  private emit(type:string,request:AgencyExecutionRequest,payload:Record<string,unknown>){try{this.events?.company({type,source:'agency-execution',entities:[{kind:'agency_execution_request',id:request.id},{kind:'agency_action_plan',id:request.actionPlanId}],correlationKey:request.correlationId,idempotencyKey:`${type}:${request.id}:${hash(JSON.stringify(payload)).slice(0,16)}`,payload});}catch{}}
}
