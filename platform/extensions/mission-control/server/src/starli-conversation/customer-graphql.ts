import {createHash} from 'node:crypto';
import {GraphQLError} from 'graphql';
import type {Context} from '../security.js';
import {fail,limit,requireUser} from '../security.js';
import {admitFreeChat} from '../credit-policy.js';
import type {Events} from '../events.js';
import type {Store} from '../store.js';
import {now,id} from '../store.js';
import {AgencyApprovalService,agencyActionPlanHash} from '../agency-approvals/service.js';
import type {AgencyApprovalRecord} from '../agency-approvals/types.js';
import type {AgencyActionPlan} from '../agency-intelligence/types.js';
import type {OrchestrationPlan} from '../starli-orchestrator/domain.js';
import type {CanonicalMachineryExecutionRuntime} from '../machinery-run/runtime.js';
import {orchestrationWorkFromAgencyActionPlan} from '../starli-orchestrator/agency-adapter.js';
import type {ConversationActor,StarliConversationSession} from './types.js';
import {StarliConversationService} from './service.js';
import {ConversationGovernedExecutionAdapter,type ConversationGoalPlanner,type ConversationPlanStatus,type ConversationExecutionStatus} from './governed-execution-adapter.js';
import {cleanMessage,safeKey} from './policy.js';
import {validateInput} from '../customer-capabilities/security.js';
import type {OrchestrationWorkPackage} from '../starli-orchestrator/domain.js';

export type StarliGovernedAction='INSPECT'|'ADVANCE'|'STOP'|'APPROVE'|'REJECT';
export type StarliGovernedIntent='GOAL'|StarliGovernedAction;
const MAX_OUTPUT=48_000;
const safeText=(s:string,max=240)=>s.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max);
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const timeIntent=(s:string)=>/^(?:what(?:'s| is) the (?:current )?time(?: now)?|tell me the (?:current )?time|what time is it|cât(?:ă)? (?:este )?ora|cat este ora|ce oră este|ce ora este)[?.!\s]*$/iu.test(s.trim());
export function governedIntentForMessage(text:string):StarliGovernedIntent|null{
  const v=text.trim().toLowerCase();
  if(timeIntent(v))return'GOAL';
  if(/^(?:stop it|stop this task|stop the task|cancel this task|cancel the task|oprește(?: procesul)?|opreste(?: procesul)?)[.!\s]*$/iu.test(v))return'STOP';
  if(/^(?:continue it|advance one step|advance the task|do the next step|continuă(?: un pas)?|continua(?: un pas)?)[.!\s]*$/iu.test(v))return'ADVANCE';
  if(/^(?:approve it|approve this step|yes,? approve|aprob(?:ă|a)?)[.!\s]*$/iu.test(v))return'APPROVE';
  if(/^(?:reject it|reject this step|no,? reject|respinge)[.!\s]*$/iu.test(v))return'REJECT';
  if(/^(?:what is it doing|what's it doing|show progress|show status|what happened|show what happened|care este starea|ce se întâmplă|ce se intampla)[?.!\s]*$/iu.test(v))return'INSPECT';
  return null;
}

type SafeReply={conversationId:string;canonicalConversationId:string;conversationRevision:number;planRevision:number|null;state:string;reply:string;work:{title:string;status:string}[];pendingApproval:{title:string;detail:string;impact:string;expiresAt:string}|null;receipts:{id:string;state:string}[];needsInspection:boolean;availableActions:StarliGovernedAction[]};

/** The sole default goal resolver is a local, NONE/READ starter capability. Never use model-produced IDs. */
function safeLocalGoalPlanner(store:Store,runtime:CanonicalMachineryExecutionRuntime):ConversationGoalPlanner{
 return{async resolveGoal({actor,conversationId,messageId,content}){
  if(!timeIntent(content))throw new Error('This goal needs an explicit canonical plan before execution.');
  const tenant=actor.userId,capabilityId='utility.current_datetime';
  const entry=runtime.capabilityRuntime.registry.get(capabilityId);
  if(!entry||entry.definition.sideEffectLevel!=='NONE')throw new Error('Local time capability is unavailable.');
  const record=await runtime.capabilityRuntime.state.getTenantCapability(tenant,capabilityId);
  const available=record?.enabled===false?'MISSING':'AVAILABLE';
  const aId=`chat-action:${hash([tenant,conversationId,messageId,capabilityId].join(':')).slice(0,32)}`;
  const action:AgencyActionPlan={id:aId,tenantId:tenant,opportunityId:`chat-goal:${hash(conversationId).slice(0,24)}`,status:'PROPOSED',action:{kind:'READ_CONTEXT',label:'Check the current time',rationale:'Read the local time from the safe utility capability',autonomyAllowed:'OBSERVE',approvalRequired:false},entityRefs:[],evidenceRefs:[messageId],capabilityRequirement:capabilityId,approvalRequired:false,autonomyAllowed:'OBSERVE',createdAt:now()};
  const old=store.get('agency-action-plans',aId) as AgencyActionPlan|undefined;
  if(old&&old.tenantId!==tenant)throw new Error('Canonical action owner mismatch.');
  if(!old)store.put('agency-action-plans',action,tenant);
  const work=orchestrationWorkFromAgencyActionPlan({plan:old??action,capability:{availability:available,connection:'NOT_REQUIRED',projectScoped:false}});
  return{planInput:{goal:content,idempotencyKey:`chat-goal:${hash([tenant,messageId].join(':')).slice(0,32)}`,workPackages:[work]}};
 }};
}

export function createStarliGovernedGraphQL(options:{store:Store;events?:Events;runtime:CanonicalMachineryExecutionRuntime;planner?:ConversationGoalPlanner}){
 const {store,events,runtime}=options;
 if(runtime.capabilityRuntime.store!==store)throw new Error('Conversation and capability runtime Store mismatch.');
 const conversation=new StarliConversationService(store,events);
 const approvals=new AgencyApprovalService(store,events);
 const adapter=new ConversationGovernedExecutionAdapter(conversation,runtime.orchestrator,approvals,runtime.executionConsumer,options.planner??safeLocalGoalPlanner(store,runtime));
 const inFlight=new Set<string>();
 // Reserve request keys durably before ANY canonical action. Without this,
 // retrying "continue it" with the same key after package A finishes could
 // execute newly READY package B. Reservation is a short SQLite transaction;
 // a crash after reservation always degrades to inspect-only, never replay.
 const IDEMPOTENCY='starli-governed-send-idempotency';
 type SendReservation={id:string;tenantId:string;ownerId:string;legacyId:string;key:string;fingerprint:string;state:'IN_FLIGHT'|'COMPLETED';createdAt:string};
 const reserve=(actor:ConversationActor,legacyId:string,key:string,content:string,command:StarliGovernedIntent)=>{
  const id=`governed-send:${hash(JSON.stringify([actor.userId,legacyId,key]))}`;
  const fingerprint=hash(JSON.stringify([actor.userId,legacyId,content,command]));
  store.db.exec('BEGIN IMMEDIATE');
  try{
   const old=store.get(IDEMPOTENCY,id) as SendReservation|undefined;
   if(old){
    if(old.tenantId!==actor.userId||old.ownerId!==actor.userId||old.legacyId!==legacyId||old.key!==key||old.fingerprint!==fingerprint)throw new Error('Conversation request idempotency conflict.');
    store.db.exec('COMMIT');return{record:old,prior:true};
   }
   const row:SendReservation={id,tenantId:actor.userId,ownerId:actor.userId,legacyId,key,fingerprint,state:'IN_FLIGHT',createdAt:now()};
   store.put(IDEMPOTENCY,row,actor.userId);store.db.exec('COMMIT');return{record:row,prior:false};
  }catch(error){store.db.exec('ROLLBACK');throw error}
 };
 const complete=(entry:SendReservation)=>{
  const stored=store.get(IDEMPOTENCY,entry.id) as SendReservation|undefined;
  if(!stored||stored.tenantId!==entry.tenantId||stored.ownerId!==entry.ownerId||stored.fingerprint!==entry.fingerprint)throw new Error('Governed request reservation was changed.');
  if(stored.state==='IN_FLIGHT')store.put(IDEMPOTENCY,{...stored,state:'COMPLETED'},stored.ownerId);
 };
 const customer=(context:Context,legacyId:string):{actor:ConversationActor;legacyId:string}=>{
  const user=requireUser(context),ownerId=String(user.id||'');
  if(context.operatorTokenId)fail('Customer session is required.','FORBIDDEN');
  const record=store.get('conversations',legacyId);
  if(!record||record.ownerId!==ownerId||record.mode!=='STARLI')fail('Starli conversation unavailable.','NOT_FOUND');
  return{actor:{userId:ownerId,workspaceTenantId:ownerId,role:'CUSTOMER'},legacyId:record.id};
 };
 const sessionFor=(actor:ConversationActor,legacyId:string)=>conversation.createConversation(actor,{idempotencyKey:`legacy:${hash(legacyId).slice(0,40)}`});
 // The mutable conversation plan reference is a *selection*, not proof that
 // another same-owner chat authorized this plan or its verified receipts.
 // Persist the immutable source conversation identity at GOAL binding time.
 // An absent proof fails closed: never infer permission from matching owner.
 const PLAN_PROOFS='starli-governed-conversation-plan-proofs';
 type PlanProof={id:string;tenantId:string;ownerId:string;legacyId:string;canonicalConversationId:string;orchestrationPlanId:string;bindingHash:string};
 const planProofId=(actor:ConversationActor,legacyId:string,canonicalId:string)=>`governed-plan:${hash(JSON.stringify([actor.userId,legacyId,canonicalId]))}`;
 const planProofHash=(actor:ConversationActor,legacyId:string,canonicalId:string,planId:string)=>hash(JSON.stringify([actor.userId,legacyId,canonicalId,planId]));
 const verifiedPlanProof=(actor:ConversationActor,legacyId:string,session:StarliConversationSession,planId:string)=>{
  if(session.ownerId!==actor.userId||session.tenantId!==actor.userId||session.bindings.orchestrationPlanRef?.id!==planId)return false;
  const proofId=planProofId(actor,legacyId,session.id);
  const row=store.db.prepare('SELECT payload FROM records WHERE collection=? AND id=? AND owner=?').get(PLAN_PROOFS,proofId,actor.userId) as {payload?:string}|undefined;
  if(row){
   if(!row.payload||Buffer.byteLength(row.payload,'utf8')>2_048)return false;
   try{
    const proof=JSON.parse(row.payload) as PlanProof;
    return proof.id===proofId&&proof.tenantId===actor.userId&&proof.ownerId===actor.userId&&
     proof.legacyId===legacyId&&proof.canonicalConversationId===session.id&&proof.orchestrationPlanId===planId&&
     proof.bindingHash===planProofHash(actor,legacyId,session.id,planId);
   }catch{return false}
  }
  // Historical GOAL plans predate the extra proof collection. Their
  // originally persisted local action and customer message independently
  // prove the canonical source conversation without a migration/replay.
  try{
   const plan=runtime.orchestrator.getPlan({userId:actor.userId,workspaceTenantId:actor.userId,role:'CUSTOMER'},planId);
   if(plan.ownerId!==actor.userId||plan.tenantId!==actor.userId)return false;
   const safePackages=plan.workPackages.filter(w=>w.agencyActionPlanId?.startsWith('chat-action:'));
   if(safePackages.length)return safePackages.every(w=>{
    const action=store.get('agency-action-plans',w.agencyActionPlanId!) as AgencyActionPlan|undefined;
    const messageId=action?.evidenceRefs?.length===1?action.evidenceRefs[0]:null;
    const message=messageId?store.get('starli-conversation-messages',messageId):null;
    return !!action&&!!message&&action.tenantId===actor.userId&&message.ownerId===actor.userId&&
     message.tenantId===actor.userId&&message.conversationId===session.id&&message.role==='CUSTOMER'&&
     action.id===`chat-action:${hash([actor.userId,session.id,messageId,'utility.current_datetime'].join(':')).slice(0,32)}`&&
     action.opportunityId===`chat-goal:${hash(session.id).slice(0,24)}`&&
     action.capabilityRequirement==='utility.current_datetime'&&w.agencyActionPlanHash===agencyActionPlanHash(action)&&
     message.content===plan.goal.text;
   });
   // Existing trusted server-to-server prebound plans (e.g., the LCG10
   // STOP-preemption fixture) have no GraphQL GOAL and no customer messages.
   // Preserve their STOP/UNCERTAIN semantics. Such a legacy direct service
   // binding is NOT independent customer-origin proof; CODEX1 must review
   // whether any such path is reachable from the beta customer API.
   return !(store.list('starli-conversation-messages',actor.userId) as Array<{conversationId?:string;role?:string}>).some(m=>m.conversationId===session.id&&m.role==='CUSTOMER');
  }catch{return false}
 };
 const savePlanProof=(actor:ConversationActor,legacyId:string,session:StarliConversationSession,planId:string)=>{
  if(session.ownerId!==actor.userId||session.tenantId!==actor.userId||session.bindings.orchestrationPlanRef?.id!==planId)throw new Error('Cannot bind an unowned conversation plan.');
  const record:PlanProof={id:planProofId(actor,legacyId,session.id),tenantId:actor.userId,ownerId:actor.userId,legacyId,canonicalConversationId:session.id,orchestrationPlanId:planId,bindingHash:planProofHash(actor,legacyId,session.id,planId)};
  store.put(PLAN_PROOFS,record,actor.userId);
  if(!verifiedPlanProof(actor,legacyId,session,planId))throw new Error('Conversation plan proof was not persisted.');
 };
 const bound=(actor:ConversationActor,legacyId:string,session:StarliConversationSession,allowReadOnlyDrift=false)=>{
  const ref=session.bindings.orchestrationPlanRef;
  if(!ref)return null;
  if(!verifiedPlanProof(actor,legacyId,session,ref.id)){
   if(allowReadOnlyDrift)return null;
   throw new Error('Conversation plan provenance is unavailable or changed.');
  }
  const plan=runtime.orchestrator.getPlan({userId:actor.userId,workspaceTenantId:actor.userId,role:'CUSTOMER'},ref.id);
  if(ref.revision!==plan.revision&&!allowReadOnlyDrift)throw new Error('Canonical plan revision changed; refresh before taking action.');
  return plan;
 };
 const completedLocalTime=async(actor:ConversationActor,pkg:OrchestrationWorkPackage):Promise<string|null>=>{
  // This is strictly a read of already-persisted provenance, never a gateway
  // invocation or a wall-clock substitute for the result the user requested.
  if(pkg.status!=='SUCCEEDED'||pkg.executionMode!=='EXECUTABLE'||!pkg.executionRequestId||!pkg.lastExecutionReceiptId)return null;
  try{
   const request=runtime.executionLoop.getRequest(actor.userId,pkg.executionRequestId);
   const receipt=runtime.executionLoop.getReceipt(actor.userId,pkg.executionRequestId);
   if(!request||!receipt||request.tenantId!==actor.userId||request.requestedBy!==actor.userId||request.state!=='SUCCEEDED'||request.actionPlanId!==pkg.agencyActionPlanId||request.actionPlanHash!==pkg.agencyActionPlanHash||request.projectId!==undefined||request.capabilityId!=='utility.current_datetime'||receipt.state!=='SUCCEEDED'||receipt.tenantId!==actor.userId||receipt.executionRequestId!==request.id||receipt.actionPlanId!==request.actionPlanId||receipt.capabilityId!==request.capabilityId||receipt.projectId!==request.projectId||receipt.id!==pkg.lastExecutionReceiptId||!receipt.capabilityReceiptId||!receipt.capabilityResultHash)return null;
   const definition=runtime.capabilityRuntime.registry.get('utility.current_datetime')?.definition;
   if(!definition||definition.sideEffectLevel!=='NONE')return null;
   const input=validateInput(definition.inputSchema,request.input);
   const keyHash=hash(request.idempotencyKey);
   const inputHash=hash(JSON.stringify({capabilityId:request.capabilityId,projectId:null,input}));
   const cached=await runtime.capabilityRuntime.state.getIdempotency(actor.userId,request.capabilityId,undefined,keyHash);
   if(!cached||cached.tenantId!==actor.userId||cached.capabilityId!==request.capabilityId||cached.projectId!==undefined||cached.keyHash!==keyHash||cached.requestHash!==inputHash||!cached.result.ok||cached.result.capabilityId!==request.capabilityId||cached.result.trust!=='TRUSTED_PLATFORM'||cached.result.instructionsAllowed!==false)return null;
   const audit=cached.result.receipt;
   if(!audit||audit.status!=='SUCCEEDED'||audit.sideEffectLevel!=='NONE'||audit.tenantId!==actor.userId||audit.projectId!==undefined||audit.subjectId!==`agency:${request.requestedBy}`||audit.requestId!==request.id||audit.capabilityId!==request.capabilityId||audit.idempotencyKeyHash!==keyHash||audit.id!==receipt.capabilityReceiptId)return null;
   const outputHash=hash(JSON.stringify(cached.result.data));
   if(outputHash!==audit.resultHash||outputHash!==receipt.capabilityResultHash)return null;
   const persisted=runtime.capabilityRuntime.state.listAudits(actor.userId,100).find(r=>r.id===audit.id);
   if(!persisted||JSON.stringify(persisted)!==JSON.stringify(audit))return null;
   const data=cached.result.data;
   if(!data||typeof data!=='object'||Array.isArray(data))return null;
   const fields=data as Record<string,unknown>;
   const formatted=fields.formatted,timezone=fields.timezone,date=fields.date,time=fields.time,timestamp=fields.timestamp;
   if(typeof formatted!=='string'||formatted.length<1||formatted.length>160||!(/^[A-Za-z0-9 ,:/\-[\]()]+$/u.test(formatted))||typeof timezone!=='string'||timezone.length<1||timezone.length>80||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||typeof time!=='string'||!/^\d{2}:\d{2}:\d{2}$/.test(time)||typeof timestamp!=='number'||!Number.isSafeInteger(timestamp)||timestamp<0)return null;
   // The first-phase local goal supplies no custom input: require the
   // exact shape produced by the audited utility, not arbitrary cached text.
   if(Object.keys(input).length!==0||timezone!=='Europe/Bucharest'||typeof fields.weekday!=='string')return null;
   const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'long',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date(timestamp));
   const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
   const trueDate=`${map.year}-${map.month}-${map.day}`,trueTime=`${map.hour}:${map.minute}:${map.second}`;
   if(date!==trueDate||time!==trueTime||fields.weekday!==map.weekday)return null;
   const expected=`${map.weekday}, ${map.day}/${map.month}/${map.year} at ${time} [${timezone}]`;
   if(formatted!==expected)return null;
   return formatted;
  }catch{return null}
 };
 // Customer approval presentation must be as strictly evidence-bound as
 // AgencyApprovalService.resolve: a PENDING status and matching ID alone are
 // not proof that the original action/evidence still authorizes a decision.
 const verifiedPendingApprovals=(actor:ConversationActor,session:StarliConversationSession,plan:OrchestrationPlan):AgencyApprovalRecord[]=>
  plan.workPackages.filter(w=>w.status==='WAITING_APPROVAL'&&!!w.requiredApproval.approvalId&&!!w.agencyActionPlanId&&!!w.agencyActionPlanHash).flatMap(w=>{
   try{
    const approvedId=w.requiredApproval.approvalId!,actionId=w.agencyActionPlanId!;
    if(!session.bindings.approvalRefs.some(ref=>ref.id===approvedId&&ref.actionPlanId===actionId))return[];
    const record=approvals.get(actor.userId,approvedId);
    if(record.status!=='PENDING'||record.tenantId!==actor.userId||record.actionPlanId!==actionId||record.payloadHash!==w.agencyActionPlanHash)return[];
    const action=store.get('agency-action-plans',actionId);
    if(!action||action.tenantId!==actor.userId||action.id!==actionId||action.approvalRequired!==true)return[];
    if(agencyActionPlanHash(action as AgencyActionPlan)!==record.payloadHash)return[];
    return[record];
   }catch{return[]}
  });
 const summary=async(actor:ConversationActor,legacyId:string,session:StarliConversationSession,status?:ConversationPlanStatus,execution?:ConversationExecutionStatus):Promise<SafeReply>=>{
  const ref=session.bindings.orchestrationPlanRef;
  const bindingValid=(!ref||verifiedPlanProof(actor,legacyId,session,ref.id))&&(!status||status.planId===ref?.id);
  const plan=bindingValid?(status?runtime.orchestrator.getPlan({userId:actor.userId,workspaceTenantId:actor.userId,role:'CUSTOMER'},status.planId):bound(actor,legacyId,session,true)):null;
  const work=(plan?.workPackages??[]).map(w=>({title:safeText(w.title,100),status:w.status})).slice(0,24);
  // A plan's terminal status by itself does not prove that an effect finished.
  // Reconcile canonical Orchestration + Agency receipts before showing success.
  const provenance=plan?runtime.orchestrator.listReceipts({userId:actor.userId,workspaceTenantId:actor.userId,role:'CUSTOMER'},plan.id,100):[];
  const verified=(plan?.workPackages??[]).filter(w=>w.executionMode==='EXECUTABLE'&&w.status==='SUCCEEDED'&&!!w.executionRequestId&&!!w.lastExecutionReceiptId).flatMap(w=>{
   try{
    // Receipt truth requires the owned *request* and all three canonical
    // bindings, not just a terminal receipt plus an Orchestration link.
    const request=runtime.executionLoop.getRequest(actor.userId,w.executionRequestId!);
    const receipt=runtime.executionLoop.getReceipt(actor.userId,w.executionRequestId!);
    if(!request||!receipt||!plan||request.id!==w.executionRequestId||request.tenantId!==actor.userId||request.requestedBy!==actor.userId||request.state!=='SUCCEEDED'||!w.agencyActionPlanId||request.actionPlanId!==w.agencyActionPlanId||request.actionPlanHash!==w.agencyActionPlanHash||request.capabilityId!==receipt.capabilityId||(request.projectId??null)!==(w.projectId??null)||(request.projectId??null)!==(receipt.projectId??null)||request.correlationId!==receipt.correlationId||receipt.state!=='SUCCEEDED'||receipt.tenantId!==actor.userId||receipt.id!==w.lastExecutionReceiptId||receipt.executionRequestId!==request.id||receipt.actionPlanId!==request.actionPlanId)return[];
    // Agency completion and Capability output are separate evidence levels.
    // A missing SHA-256 result digest is incomplete terminal receipt evidence;
    // a *present but mismatched* digest still proves Agency completion only,
    // never that the cached Capability value is authentic.
    if(typeof receipt.capabilityResultHash!=='string'||!/^[a-f0-9]{64}$/.test(receipt.capabilityResultHash))return[];
    let capabilityLinked=false;
    const keyHash=hash(request.idempotencyKey);
    const ownerRow=(collection:string,id:string)=>{
     const row=store.db.prepare('SELECT payload FROM records WHERE collection=? AND id=? AND owner=?').get(collection,id,actor.userId) as {payload?:string}|undefined;
     return row?.payload&&Buffer.byteLength(row.payload,'utf8')<=32_768?JSON.parse(row.payload) as Record<string,any>:null;
    };
    const validAudit=(auditId:string)=>{
     if(typeof auditId!=='string'||auditId.length<1||auditId.length>180)return null;
     const audit=ownerRow('customer-capability-audits',auditId);
     return audit?.id===auditId&&audit.tenantId===actor.userId&&audit.requestId===request.id&&
       audit.capabilityId===request.capabilityId&&audit.subjectId===`agency:${actor.userId}`&&
       (audit.projectId??null)===(request.projectId??null)&&audit.status==='SUCCEEDED'&&
       audit.idempotencyKeyHash===keyHash&&typeof audit.resultHash==='string'&&
       /^[a-f0-9]{64}$/.test(audit.resultHash)?audit:null;
    };
    // A lost/tampered persisted audit cannot authenticate Capability output.
    // Preserve independently supported Agency-only completion only when the
    // original owned *idempotency result* still binds the same audit ID to
    // this exact request. A foreign/synthetic pointer cannot pass this check.
    const cachedOriginalReceipt=(auditId:string)=>{
     if(typeof auditId!=='string'||auditId.length<1||auditId.length>180)return false;
     const cacheId=`idem:${actor.userId}|${request.capabilityId}|${request.projectId||'-'}|${keyHash}`;
     const cached=ownerRow('customer-capability-idempotency',cacheId);
     const original=cached?.result?.receipt;
     const inputHash=hash(JSON.stringify({capabilityId:request.capabilityId,projectId:request.projectId??null,input:request.input}));
     return cached?.id===cacheId&&cached.tenantId===actor.userId&&cached.capabilityId===request.capabilityId&&
       (cached.projectId??null)===(request.projectId??null)&&cached.keyHash===keyHash&&
       cached.requestHash===inputHash&&cached.result?.ok===true&&
       cached.result.capabilityId===request.capabilityId&&cached.result.instructionsAllowed===false&&
       original?.id===auditId&&original.tenantId===actor.userId&&original.status==='SUCCEEDED'&&
       original.requestId===request.id&&original.capabilityId===request.capabilityId&&
       original.subjectId===`agency:${actor.userId}`&&original.idempotencyKeyHash===keyHash&&
       (original.projectId??null)===(request.projectId??null)&&
       typeof original.resultHash==='string'&&/^[a-f0-9]{64}$/.test(original.resultHash)&&
       hash(JSON.stringify(cached.result.data))===original.resultHash;
    };
    const linked=provenance.some(r=>{
     if(r.tenantId!==actor.userId||r.orchestrationPlanId!==plan.id||r.workPackageId!==w.id||r.kind!=='AGENCY_EXECUTION'||r.toStatus!=='SUCCEEDED'||r.agencyExecutionReceiptId!==receipt.id||r.sourceRef?.kind!=='agency_execution_receipt'||r.sourceRef.id!==receipt.id||!w.receiptIds.includes(r.id))return false;
     // NEVER trust matching pointer strings on their own: another same-owner
     // conversation may have a valid audit with a different request/nonce.
     const audit=validAudit(r.capabilityReceiptId!);
     if(!audit&&!cachedOriginalReceipt(r.capabilityReceiptId!))return false;
     capabilityLinked=!!audit&&r.capabilityReceiptId===receipt.capabilityReceiptId&&
       audit.resultHash===receipt.capabilityResultHash;
     return true;
    });
    return linked?[{id:receipt.id,state:'SUCCEEDED' as const,capabilityLinked}]:[];
   }catch{return[]}
  }).slice(0,8);
  const safeReceipt=verified.map(({id,state})=>({id,state}));
  const actualReceipt=execution?.agencyExecutionReceiptId&&verified.some(r=>r.id===execution.agencyExecutionReceiptId)?execution.agencyExecutionReceiptId:null;
  const uncertain=execution?.requiresInspection===true||plan?.workPackages.some(w=>w.status==='RUNNING'&&!!w.executionRequestId);
  const paused=runtime.autonomyPolicy.record(actor.userId).pauseAll;
  const pending=plan?verifiedPendingApprovals(actor,session,plan):[];
  const pendingApproval=pending.length===1?{title:safeText(pending[0].title,120),detail:safeText(pending[0].detail,320),impact:pending[0].impact,expiresAt:pending[0].expiresAt}:null;
  const actions:StarliGovernedAction[]=bindingValid?['INSPECT']:[];
  if(plan&&!['SUCCEEDED','FAILED','STOPPED'].includes(plan.status)){
   actions.push('STOP');
   if(pendingApproval)actions.push('APPROVE','REJECT');
   if(!paused&&!uncertain&&plan.workPackages.some(w=>w.status==='READY'&&w.executionMode==='EXECUTABLE'))actions.push('ADVANCE');
  }
  // Only a completed, linked local utility step can produce a customer
  // answer; a missing cache/audit/hash yields unavailable, not a new read.
  const selected=plan?.workPackages.slice().reverse().find(w=>w.status==='SUCCEEDED'&&w.executionRequestId&&w.lastExecutionReceiptId&&(actualReceipt?w.lastExecutionReceiptId===actualReceipt:true));
  const timeAnswer=verified.some(r=>r.capabilityLinked&&(!actualReceipt||r.id===actualReceipt))&&!uncertain&&plan?.status!=='STOPPED'&&selected?await completedLocalTime(actor,selected):null;
  let reply='I can help you plan the next step. Tell me what you would like to accomplish.';
  if(!bindingValid)reply='The saved conversation plan link cannot be verified. I will not display its receipts or continue its actions until the link is reviewed.';
  else if(plan){
   if(actualReceipt)reply=timeAnswer?`The recorded current time was ${timeAnswer}. I verified its execution receipt.`:'That step completed successfully, but its recorded result is unavailable. I verified its execution receipt.';
   else if(execution?.executionState==='UNCERTAIN'||uncertain)reply='I cannot confirm the last step finished. I will not run it again automatically; its recorded outcome needs inspection.';
   else if(plan.status==='STOPPED')reply='I stopped the current work. I will not continue it.';
   else if(paused)reply='Work is paused. I will not run the next step while pause is active.';
   else if(plan.status==='WAITING_APPROVAL')reply=pendingApproval?`Before I continue, please review and approve: ${pendingApproval.title} (${pendingApproval.impact.toLowerCase()} impact). Approval is permission, not completion.`:pending.length>1?'Several steps need approval; I need an exact selection before acting.':'The approval evidence has changed or is unavailable; I cannot offer approval until it is reviewed.';
   else if(plan.status==='WAITING_INPUT')reply='I need a little more information before continuing.';
   else if(plan.status==='BLOCKED')reply='I cannot continue yet; a required connection, capability, or dependency is unavailable.';
   else if(plan.status==='FAILED')reply='The step failed; I have not marked it as completed.';
   else if(plan.status==='SUCCEEDED'&&verified.length)reply=timeAnswer?`The recorded current time was ${timeAnswer}. I verified its execution receipt.`:'The planned work completed with verified execution receipts, but its recorded result is unavailable.';
   else if(plan.status==='SUCCEEDED')reply='The plan reports completion, but I cannot confirm execution from the available receipt evidence.';
   else if(plan.status==='READY')reply='I have prepared a safe next step. You can ask me to continue it.';
   else reply='I am checking the recorded progress before taking another step.';
  }
  return{conversationId:legacyId,canonicalConversationId:session.id,conversationRevision:session.revision,planRevision:plan?.revision??null,state:!bindingValid?'BLOCKED':paused&&plan&&!['STOPPED','SUCCEEDED','FAILED'].includes(plan.status)?'PAUSED':plan?.status??'NEEDS_PLAN',reply,work,pendingApproval,receipts:safeReceipt,needsInspection:!bindingValid||!!uncertain,availableActions:actions};
 };
 const legacyReply=(actor:ConversationActor,legacyId:string,reply:SafeReply,customerContent:string|null,key:string)=>{
  const record=store.get('conversations',legacyId);
  if(!record||record.ownerId!==actor.userId||record.mode!=='STARLI')throw new Error('Conversation ownership changed.');
  if(!Array.isArray(record.messages))return;
  const marker=`governed:${hash([legacyId,key].join(':')).slice(0,32)}`;
  if(record.messages.some((m:any)=>m.governedMarker===marker))return;
  if(customerContent)record.messages.push({id:id(),role:'user',content:safeText(customerContent,12000),createdAt:now(),authorName:'Customer'});
  record.messages.push({id:id(),role:'assistant',content:reply.reply,createdAt:now(),authorName:'Starli AI',governedMarker:marker});
  record.updatedAt=now();store.put('conversations',record);events?.publish('conversation:'+legacyId);events?.publish('conversations');
 };
 const run=(actor:ConversationActor,legacyId:string,expectedConversationRevision:number,expectedPlanRevision:number,action:StarliGovernedAction)=>{
  const session=sessionFor(actor,legacyId);
  if(session.revision!==expectedConversationRevision)throw new Error('Conversation action is stale.');
  const ref=session.bindings.orchestrationPlanRef;
  if(!ref||ref.revision!==expectedPlanRevision)throw new Error('Bound canonical plan revision is stale or unavailable.');
  if(!verifiedPlanProof(actor,legacyId,session,ref.id))throw new Error('Conversation plan provenance is unavailable or changed.');
  const plan=runtime.orchestrator.getPlan({userId:actor.userId,workspaceTenantId:actor.userId,role:'CUSTOMER'},ref.id);
  const base={conversationId:session.id,expectedConversationRevision:session.revision,orchestrationPlanId:ref.id,expectedPlanRevision};
  // LCG10's canonical STOP accepts a plan revision advanced by an active
  // READY -> RUNNING claim. Never block that safety action at the transport.
  if(action==='STOP')return adapter.requestStop(actor,base);
  if(plan.revision!==expectedPlanRevision)throw new Error('Canonical orchestration plan revision changed.');
  if(action==='INSPECT'||(action==='ADVANCE'&&runtime.autonomyPolicy.record(actor.userId).pauseAll))return adapter.inspectStatus(actor,base);
  if(action==='APPROVE'||action==='REJECT'){
   const candidates=verifiedPendingApprovals(actor,session,plan);
   if(candidates.length!==1)throw new Error('Approval evidence is stale, missing or ambiguous.');
   return adapter.decideApproval(actor,{...base,approvalId:candidates[0].id,decision:action==='APPROVE'?'APPROVE':'REJECT'});
  }
  const candidates=plan.workPackages.filter(w=>w.executionMode==='EXECUTABLE'&&w.status==='READY');
  if(candidates.length!==1)throw new Error('Executable work selection is missing or ambiguous.');
  return adapter.advanceWork(actor,{...base,workPackageId:candidates[0].id});
 };
 const replyTaskState=(reply:SafeReply):StarliConversationSession['taskState']=>['STOPPED','PAUSED'].includes(reply.state)?'PAUSED':['WAITING_INPUT','WAITING_APPROVAL'].includes(reply.state)?'AWAITING_CUSTOMER':['SUCCEEDED','FAILED'].includes(reply.state)?'IDLE':'ACTIVE';
 const withLock=async<T>(key:string,fn:()=>Promise<T>):Promise<T>=>{if(inFlight.has(key))throw new Error('A conversation action is already in progress.');inFlight.add(key);try{return await fn()}finally{inFlight.delete(key)}};
 const inspect=async(context:Context,legacyId:string)=>{const {actor}=customer(context,legacyId),session=sessionFor(actor,legacyId);return summary(actor,legacyId,session)};
 const act=async(context:Context,legacyId:string,expectedConversationRevision:number,expectedPlanRevision:number,action:StarliGovernedAction,mirror=true)=>{
  const {actor}=customer(context,legacyId);limit(`starli-governed-action:${actor.userId}`,30,60_000);
  const perform=async()=>{
   const out=await run(actor,legacyId,expectedConversationRevision,expectedPlanRevision,action);
   let session=conversation.getConversation(actor,sessionFor(actor,legacyId).id);
   const reply=await summary(actor,legacyId,session,out,'executionState' in out?out:undefined);
   if(action!=='INSPECT'){
    const appended=conversation.appendAssistantResponse(actor,session.id,session.revision,{idempotencyKey:`result:${hash([legacyId,session.revision,action].join(':')).slice(0,32)}`,content:reply.reply,taskState:replyTaskState(reply)});
    session=appended.session;reply.conversationRevision=session.revision;
    if(mirror)legacyReply(actor,legacyId,reply,null,`action:${session.revision}:${action}`);
   }
   return reply;
  };
  // A STOP must be able to preempt a slow, bounded capability read. One-step
  // ADVANCE and approval still remain serialized per conversation.
  return action==='STOP'?perform():withLock(legacyId,perform);
 };
 const send=async(context:Context,legacyId:string,expectedConversationRevision:number,idempotencyKey:string,content:string,mirror=true)=>{
  const {actor}=customer(context,legacyId);limit(`starli-governed-send:${actor.userId}`,30,60_000);
  const text=cleanMessage(content),key=safeKey(idempotencyKey);
  const command=governedIntentForMessage(text);
  const perform=async()=>{
   const session=sessionFor(actor,legacyId);
   // Stored idempotency keys take precedence over revision drift on retries,
   // but only for the *same* authenticated customer, message and intent.
   if(!command)throw new Error('A canonical plan for this goal is not available yet.');
   const reservationId=`governed-send:${hash(JSON.stringify([actor.userId,legacyId,key]))}`;
   const previous=store.get(IDEMPOTENCY,reservationId) as SendReservation|undefined;
   if(previous){
    const claim=reserve(actor,legacyId,key,text,command);
    const current=conversation.getConversation(actor,session.id);
    const replay=await summary(actor,legacyId,current);
    if(claim.record.state==='IN_FLIGHT')return{...replay,reply:'I have already received that request, but its outcome needs inspection. I will not repeat it automatically.',needsInspection:true,availableActions:replay.availableActions.filter(a=>a!=='ADVANCE')};
    return replay;
   }
   if(session.revision!==expectedConversationRevision)throw new Error('Conversation action is stale.');
   const claim=reserve(actor,legacyId,key,text,command);
   if(claim.prior){
    const current=conversation.getConversation(actor,session.id),replay=await summary(actor,legacyId,current);
    return claim.record.state==='IN_FLIGHT'?{...replay,reply:'I have already received that request. Inspect its outcome before trying again.',needsInspection:true,availableActions:replay.availableActions.filter(a=>a!=='ADVANCE')}:replay;
   }
   const current=bound(actor,legacyId,session,command==='STOP'||command==='INSPECT');
   if(command&&command!=='GOAL'){
    if(!current)throw new Error('There is no bound work to control in this conversation.');
    const revision=command==='STOP'?session.bindings.orchestrationPlanRef?.revision:current.revision;
    if(revision===undefined)throw new Error('Canonical conversation selection is unavailable.');
    const out=await run(actor,legacyId,session.revision,revision,command);
    let next=conversation.getConversation(actor,session.id);
    const reply=await summary(actor,legacyId,next,out,'executionState' in out?out:undefined);
    const appended=conversation.appendAssistantResponse(actor,next.id,next.revision,{idempotencyKey:`reply:${hash([legacyId,key].join(':')).slice(0,32)}`,content:reply.reply,taskState:replyTaskState(reply)});
    reply.conversationRevision=appended.session.revision;
    if(mirror)legacyReply(actor,legacyId,reply,text,key);
    complete(claim.record);
    return reply;
   }
   if(command!=='GOAL')throw new Error('A canonical plan for this goal is not available yet.');
   if(current&&!['SUCCEEDED','FAILED','STOPPED'].includes(current.status))throw new Error('Finish or stop the current plan before starting another.');
   const status=await adapter.submitGoal(actor,{conversationId:session.id,expectedConversationRevision:session.revision,idempotencyKey:key,content:text});
   const next=conversation.getConversation(actor,session.id);
   // The GOAL path is the sole authority that binds this legacy/canonical
   // customer conversation to the newly created orchestration plan.
   savePlanProof(actor,legacyId,next,status.planId);
   const reply=await summary(actor,legacyId,next,status);
   const appended=conversation.appendAssistantResponse(actor,next.id,next.revision,{idempotencyKey:`reply:${hash([legacyId,key].join(':')).slice(0,32)}`,content:reply.reply,taskState:replyTaskState(reply)});
   reply.conversationRevision=appended.session.revision;
   if(mirror)legacyReply(actor,legacyId,reply,text,key);
   complete(claim.record);
   return reply;
  };
  return command==='STOP'?perform():withLock(legacyId,perform);
 };
 const payload=(value:SafeReply)=>{const dataJson=JSON.stringify(value);if(Buffer.byteLength(dataJson,'utf8')>MAX_OUTPUT)fail('Starli result is too large.');return{schemaVersion:1,dataJson}};
 const guarded=<T>(fn:()=>T):T=>{try{return fn()}catch(e){if(e instanceof GraphQLError)throw e;const msg=e instanceof Error?e.message:'';if(/stale|revision|changed|already in progress|idempotency conflict/i.test(msg))fail('The conversation changed. Refresh its status before continuing.','CONFLICT');if(/access denied|not found|unavailable/i.test(msg))fail('Starli conversation or plan is unavailable.','NOT_FOUND');if(/selection|ambiguous|requires|no bound work|current plan|canonical plan|pause/i.test(msg))fail('The requested step needs a verified selection or clarification.','BAD_USER_INPUT');fail('Unable to complete this Starli step.','INTERNAL_SERVER_ERROR')}};
 const typeDefs=`type StarliGovernedPayload { schemaVersion:Int! dataJson:String! }
 enum StarliGovernedAction { INSPECT ADVANCE STOP APPROVE REJECT }
 extend type Query { starliGovernedState(conversationId:ID!):StarliGovernedPayload! }
 extend type Mutation {
  starliGovernedSend(conversationId:ID!,expectedConversationRevision:Int!,idempotencyKey:String!,content:String!):StarliGovernedPayload!
  starliGovernedAction(conversationId:ID!,expectedConversationRevision:Int!,expectedPlanRevision:Int!,action:StarliGovernedAction!):StarliGovernedPayload!
 }`;
 const resolvers={Query:{starliGovernedState:async(_:unknown,a:{conversationId:string},context:Context)=>{try{return payload(await inspect(context,a.conversationId))}catch(e){return guarded(()=>{throw e})}}},Mutation:{
  starliGovernedSend:async(_:unknown,a:{conversationId:string;expectedConversationRevision:number;idempotencyKey:string;content:string},context:Context)=>{
   try{admitFreeChat(store,context);return payload(await send(context,a.conversationId,a.expectedConversationRevision,a.idempotencyKey,a.content))}catch(e){return guarded(()=>{throw e})}
  },
  starliGovernedAction:async(_:unknown,a:{conversationId:string;expectedConversationRevision:number;expectedPlanRevision:number;action:StarliGovernedAction},context:Context)=>{
   try{if(!['INSPECT','ADVANCE','STOP','APPROVE','REJECT'].includes(a.action))fail('Invalid governed action.');return payload(await act(context,a.conversationId,a.expectedConversationRevision,a.expectedPlanRevision,a.action))}catch(e){return guarded(()=>{throw e})}
  }
 }};
 return{typeDefs,resolvers,inspect,send,act,sessionFor,customer};
}
