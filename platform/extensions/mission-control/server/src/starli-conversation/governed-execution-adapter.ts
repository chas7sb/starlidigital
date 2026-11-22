import type {AgencyApprovalService} from '../agency-approvals/service.js';
import type {CanonicalExecutionLoopState,CanonicalStarliExecutionConsumer} from '../agency-execution/canonical-consumer.js';
import type {CreateOrchestrationPlanInput,OrchestrationActor,OrchestrationPlan,OrchestrationWorkPackage} from '../starli-orchestrator/domain.js';
import type {StarliOrchestratorService} from '../starli-orchestrator/service.js';
import type {ConversationActor,StarliConversationSession} from './types.js';
import type {StarliConversationService} from './service.js';

export interface ConversationPlanningResolution{
  planInput:CreateOrchestrationPlanInput;
  intentId?:string|null;
}

export interface ConversationGoalPlanner{
  resolveGoal(input:{actor:ConversationActor;conversationId:string;messageId:string;content:string}):Promise<ConversationPlanningResolution>;
}

export interface ConversationActionBase{
  conversationId:string;
  expectedConversationRevision:number;
  orchestrationPlanId:string;
  expectedPlanRevision:number;
}

export type ConversationPlanStatus={
  conversationId:string;
  conversationRevision:number;
  planId:string;
  planRevision:number;
  planStatus:OrchestrationPlan['status'];
  work:Pick<OrchestrationWorkPackage,'id'|'title'|'status'|'blockCodes'|'retryClass'|'executionRequestId'|'lastExecutionReceiptId'>[];
  receiptIds:string[];
};

export type ConversationExecutionStatus=ConversationPlanStatus&{
  executionState:CanonicalExecutionLoopState;
  agencyExecutionReceiptId:string|null;
  requiresInspection:boolean;
};

export class ConversationGovernedExecutionAdapter{
  constructor(
    private conversation:StarliConversationService,
    private orchestrator:StarliOrchestratorService,
    private approvals:AgencyApprovalService,
    private execution:CanonicalStarliExecutionConsumer,
    private planner?:ConversationGoalPlanner
  ){}

  async submitGoal(actor:ConversationActor,input:{conversationId:string;expectedConversationRevision:number;idempotencyKey:string;content:string}):Promise<ConversationPlanStatus>{
    if(!this.planner)throw new Error('Conversation planning resolver unavailable.');
    this.assertConversationRevision(actor,input.conversationId,input.expectedConversationRevision);
    const submitted=this.conversation.submitCustomerMessage(actor,input.conversationId,{idempotencyKey:input.idempotencyKey,content:input.content});
    const resolved=await this.planner.resolveGoal({actor,conversationId:input.conversationId,messageId:submitted.message.id,content:submitted.message.content});
    const plan=this.orchestrator.createPlan(this.orchestrationActor(actor),resolved.planInput);
    const session=this.conversation.updateBindings(actor,input.conversationId,submitted.session.revision,{taskState:this.taskState(plan),bindings:{
      intentRef:resolved.intentId?{id:resolved.intentId}:submitted.session.bindings.intentRef,
      orchestrationPlanRef:{id:plan.id,revision:plan.revision},
      questionRefs:this.questionRefs(plan),
      approvalRefs:this.approvalRefs(plan),
      runningWorkRefs:this.runningRefs(plan),
      receiptRefs:submitted.session.bindings.receiptRefs,
      artifactRefs:submitted.session.bindings.artifactRefs
    }});
    return this.statusFrom(session,plan);
  }

  answerClarification(actor:ConversationActor,input:ConversationActionBase&{workPackageId:string;inputId:string;answer:string;idempotencyKey:string}):ConversationPlanStatus{
    const {session,plan}=this.assertBoundPlan(actor,input);
    if(!session.bindings.questionRefs.some(q=>q.id===input.inputId&&(!q.workPackageId||q.workPackageId===input.workPackageId)))throw new Error('Conversation question reference is stale or unavailable.');
    const pkg=this.package(plan,input.workPackageId);
    if(!pkg.requiredInputs.some(q=>q.id===input.inputId))throw new Error('Canonical clarification requirement is unavailable.');
    const submitted=this.conversation.submitCustomerMessage(actor,input.conversationId,{idempotencyKey:input.idempotencyKey,content:input.answer});
    const next=this.orchestrator.satisfyInput(this.orchestrationActor(actor),plan.id,pkg.id,input.inputId,plan.revision);
    const updated=this.rebind(actor,submitted.session,next);
    return this.statusFrom(updated,next);
  }

  decideApproval(actor:ConversationActor,input:ConversationActionBase&{approvalId:string;decision:'APPROVE'|'REJECT'}):ConversationPlanStatus{
    const {session,plan}=this.assertBoundPlan(actor,input);
    const bound=session.bindings.approvalRefs.find(a=>a.id===input.approvalId);
    if(!bound)throw new Error('Conversation approval reference is stale or unavailable.');
    const record=this.approvals.get(plan.tenantId,input.approvalId);
    if(bound.actionPlanId&&record.actionPlanId!==bound.actionPlanId)throw new Error('Conversation approval reference does not match canonical approval.');
    if(!plan.workPackages.some(p=>p.agencyActionPlanId===record.actionPlanId&&p.requiredApproval.approvalId===record.id))throw new Error('Approval is not bound to this canonical plan revision.');
    this.approvals.resolve(plan.tenantId,record.id,input.decision,actor.userId);
    const next=this.orchestrator.refresh(this.orchestrationActor(actor),plan.id,plan.revision);
    const updated=this.rebind(actor,session,next);
    return this.statusFrom(updated,next);
  }

  requestRetry(actor:ConversationActor,input:ConversationActionBase&{workPackageId:string}):ConversationPlanStatus{
    const {session,plan}=this.assertBoundPlan(actor,input);
    const pkg=this.package(plan,input.workPackageId);
    if(pkg.status!=='FAILED'||pkg.retryClass!=='SAFE_IDEMPOTENT_RETRY')throw new Error('Canonical work package is not eligible for safe retry.');
    const next=this.orchestrator.retryPackage(this.orchestrationActor(actor),plan.id,pkg.id,plan.revision);
    const updated=this.rebind(actor,session,next);
    return this.statusFrom(updated,next);
  }

  async advanceWork(actor:ConversationActor,input:ConversationActionBase&{workPackageId:string}):Promise<ConversationExecutionStatus>{
    const {session,plan}=this.assertBoundPlan(actor,input);
    const pkg=this.package(plan,input.workPackageId);
    if(pkg.executionMode!=='EXECUTABLE'||!['READY','RUNNING'].includes(pkg.status))throw new Error('Canonical work is not eligible for governed execution.');
    const reference={tenantId:plan.tenantId,orchestrationPlanId:plan.id,workPackageId:pkg.id};
    const result=pkg.status==='READY'
      ?await this.execution.executeReady(this.orchestrationActor(actor),reference,actor.userId)
      :await this.execution.resume(this.orchestrationActor(actor),reference);
    const current=this.orchestrator.getPlan(this.orchestrationActor(actor),plan.id);
    // The consumer owns the authoritative execution/receipt transition. Never infer
    // success from approval or a prior conversation card; re-read canonical state.
    let updated:StarliConversationSession;
    try{updated=this.rebind(actor,session,current);}
    catch(error){
      // STOP may have advanced the conversation binding while the bounded
      // capability read was in flight. Return only its confirmed STOP outcome;
      // never overwrite the newer binding or mask unrelated conversation edits.
      const latest=this.conversation.getConversation(actor,input.conversationId);
      if(result.state!=='STOPPED'||current.status!=='STOPPED'||
         latest.bindings.orchestrationPlanRef?.id!==current.id||
         latest.bindings.orchestrationPlanRef.revision!==current.revision||
         latest.taskState!=='PAUSED')throw error;
      updated=latest;
    }
    return{...this.statusFrom(updated,current),executionState:result.state,
      agencyExecutionReceiptId:result.agencyExecutionReceiptId??null,
      requiresInspection:result.state==='UNCERTAIN'||result.state==='IN_PROGRESS'};
  }

  requestStop(actor:ConversationActor,input:ConversationActionBase&{reason?:string}):ConversationPlanStatus{
    // A canonical READY -> RUNNING claim advances plan revision before its effect
    // completes. STOP must still work from the same current conversation card;
    // unlike approve/retry/advance, it is a safety operation, not permission to act.
    const session=this.assertConversationRevision(actor,input.conversationId,input.expectedConversationRevision);
    const bound=session.bindings.orchestrationPlanRef;
    if(bound?.id!==input.orchestrationPlanId||bound.revision!==input.expectedPlanRevision)throw new Error('Conversation plan card revision is stale.');
    const plan=this.orchestrator.getPlan(this.orchestrationActor(actor),input.orchestrationPlanId);
    if(plan.revision!==input.expectedPlanRevision&&
       !(plan.revision>input.expectedPlanRevision&&plan.workPackages.some(p=>p.status==='RUNNING'&&!!p.executionRequestId)))
      throw new Error('Canonical orchestration plan revision changed.');
    const candidate=plan.workPackages.find(p=>p.executionRequestId)||plan.workPackages.find(p=>!['SUCCEEDED','FAILED','STOPPED'].includes(p.status));
    let next:OrchestrationPlan;
    if(candidate){
      this.execution.stop(this.orchestrationActor(actor),{tenantId:plan.tenantId,orchestrationPlanId:plan.id,workPackageId:candidate.id},input.reason||'Stopped from Starli conversation');
      next=this.orchestrator.getPlan(this.orchestrationActor(actor),plan.id);
    }else next=this.orchestrator.stop(this.orchestrationActor(actor),plan.id,plan.revision,input.reason||'Stopped from Starli conversation');
    const updated=this.rebind(actor,session,next);
    return this.statusFrom(updated,next);
  }

  inspectStatus(actor:ConversationActor,input:ConversationActionBase):ConversationPlanStatus{
    const {session,plan}=this.assertBoundPlan(actor,input);
    return this.statusFrom(session,plan);
  }

  private assertConversationRevision(actor:ConversationActor,id:string,expected:number){
    if(!Number.isSafeInteger(expected)||expected<1)throw new Error('Invalid expected conversation revision.');
    const session=this.conversation.getConversation(actor,id);
    if(session.revision!==expected)throw new Error('Conversation action is stale.');
    return session;
  }

  private assertBoundPlan(actor:ConversationActor,input:ConversationActionBase){
    const session=this.assertConversationRevision(actor,input.conversationId,input.expectedConversationRevision);
    if(session.bindings.orchestrationPlanRef?.id!==input.orchestrationPlanId)throw new Error('Conversation orchestration reference is stale or unavailable.');
    if(session.bindings.orchestrationPlanRef.revision!==undefined&&session.bindings.orchestrationPlanRef.revision!==input.expectedPlanRevision)throw new Error('Conversation plan card revision is stale.');
    const plan=this.orchestrator.getPlan(this.orchestrationActor(actor),input.orchestrationPlanId);
    if(plan.revision!==input.expectedPlanRevision)throw new Error('Canonical orchestration plan revision changed.');
    return{session,plan};
  }

  private rebind(actor:ConversationActor,session:StarliConversationSession,plan:OrchestrationPlan){
    return this.conversation.updateBindings(actor,session.id,session.revision,{taskState:this.taskState(plan),bindings:{
      orchestrationPlanRef:{id:plan.id,revision:plan.revision},
      questionRefs:this.questionRefs(plan),
      approvalRefs:this.approvalRefs(plan),
      runningWorkRefs:this.runningRefs(plan)
    }});
  }

  private questionRefs(plan:OrchestrationPlan){return plan.workPackages.flatMap(p=>p.requiredInputs.filter(q=>!p.satisfiedInputIds.includes(q.id)).map(q=>({id:q.id,workPackageId:p.id}))).slice(0,24);}
  private approvalRefs(plan:OrchestrationPlan){return plan.workPackages.filter(p=>p.requiredApproval.approvalId&&p.agencyActionPlanId).map(p=>({id:p.requiredApproval.approvalId!,actionPlanId:p.agencyActionPlanId!})).slice(0,24);}
  private runningRefs(plan:OrchestrationPlan){return plan.workPackages.filter(p=>p.status==='RUNNING').map(p=>({id:p.id,orchestrationPlanId:plan.id,executionRequestId:p.executionRequestId||undefined})).slice(0,24);}
  private taskState(plan:OrchestrationPlan):StarliConversationSession['taskState']{if(plan.status==='STOPPED')return'PAUSED';if(['WAITING_INPUT','WAITING_APPROVAL'].includes(plan.status))return'AWAITING_CUSTOMER';if(['SUCCEEDED','FAILED'].includes(plan.status))return'IDLE';return'ACTIVE';}
  private package(plan:OrchestrationPlan,id:string){const pkg=plan.workPackages.find(p=>p.id===id);if(!pkg)throw new Error('Canonical work package unavailable.');return pkg;}
  private orchestrationActor(actor:ConversationActor):OrchestrationActor{return{userId:actor.userId,workspaceTenantId:actor.workspaceTenantId,role:actor.role};}
  private statusFrom(session:StarliConversationSession,plan:OrchestrationPlan):ConversationPlanStatus{return{conversationId:session.id,conversationRevision:session.revision,planId:plan.id,planRevision:plan.revision,planStatus:plan.status,work:plan.workPackages.map(p=>({id:p.id,title:p.title,status:p.status,blockCodes:[...p.blockCodes],retryClass:p.retryClass,executionRequestId:p.executionRequestId,lastExecutionReceiptId:p.lastExecutionReceiptId})),receiptIds:this.orchestrator.listReceipts(this.orchestrationActor({userId:session.ownerId,workspaceTenantId:session.tenantId}),plan.id,50).map(r=>r.id)};}
}
