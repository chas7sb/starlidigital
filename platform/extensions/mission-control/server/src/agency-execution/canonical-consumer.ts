import type {OrchestrationActor,OrchestrationPlan,OrchestrationWorkPackage} from '../starli-orchestrator/domain.js';
import {StarliOrchestratorService} from '../starli-orchestrator/service.js';
import type {AgencyExecutionReceipt} from './types.js';
import type {OrchestrationExecutionReference} from './bridge.js';
import {StarliExecutionLoop} from './bridge.js';

export type CanonicalExecutionLoopState='SUCCEEDED'|'FAILED'|'STOPPED'|'IN_PROGRESS'|'UNCERTAIN'|'NOT_READY';
export interface CanonicalExecutionLoopResult{
  state:CanonicalExecutionLoopState;
  orchestrationPlanId:string;
  workPackageId:string;
  planRevision:number;
  executionRequestId?:string;
  agencyExecutionReceiptId?:string;
  detail?:string;
}

export class CanonicalStarliExecutionConsumer{
  constructor(private orchestrator:StarliOrchestratorService,private loop:StarliExecutionLoop){}

  async executeReady(actor:OrchestrationActor,reference:OrchestrationExecutionReference,requestedBy:string):Promise<CanonicalExecutionLoopResult>{
    let plan=this.plan(actor,reference),pkg=this.pkg(plan,reference.workPackageId);
    if(pkg.status!=='READY'||pkg.executionMode!=='EXECUTABLE')return this.result(plan,pkg,'NOT_READY',undefined,undefined,'Canonical work package is not READY executable work.');
    const request=await this.loop.prepareOrchestrationWork(reference,requestedBy);
    try{plan=this.orchestrator.markRunning(actor,plan.id,pkg.id,plan.revision,request.id);}
    catch(error){
      const current=this.plan(actor,reference),currentPkg=this.pkg(current,pkg.id);
      if(currentPkg.status==='RUNNING'&&currentPkg.executionRequestId===request.id)return this.resume(actor,reference);
      if(currentPkg.status==='STOPPED')return this.result(current,currentPkg,'STOPPED',currentPkg.executionRequestId||request.id,currentPkg.lastExecutionReceiptId||undefined,'Work was stopped before execution ownership could be acquired.');
      throw error;
    }
    return this.resume(actor,reference);
  }

  async resume(actor:OrchestrationActor,reference:OrchestrationExecutionReference):Promise<CanonicalExecutionLoopResult>{
    let plan=this.plan(actor,reference),pkg=this.pkg(plan,reference.workPackageId);
    if(['SUCCEEDED','FAILED','STOPPED'].includes(pkg.status))return this.result(plan,pkg,pkg.status as 'SUCCEEDED'|'FAILED'|'STOPPED',pkg.executionRequestId||undefined,pkg.lastExecutionReceiptId||undefined,'Canonical work package is already terminal.');
    if(pkg.status!=='RUNNING'||!pkg.executionRequestId)return this.result(plan,pkg,'NOT_READY',pkg.executionRequestId||undefined,undefined,'Work package has no bound Agency Execution request to resume.');

    const requestId=pkg.executionRequestId;
    const request=this.loop.getRequest(reference.tenantId,requestId);
    const persistedReceipt=this.loop.getReceipt(reference.tenantId,requestId);
    const retryPending=pkg.executionAttempt!==undefined&&pkg.executionAttempt===(request.attempt??0)+1&&
      ['FAILED','BLOCKED'].includes(request.state)&&pkg.retryClass==='SAFE_IDEMPOTENT_RETRY'&&
      persistedReceipt?.retryClass==='SAFE_IDEMPOTENT_RETRY'&&(persistedReceipt.attempt??0)===(request.attempt??0);
    const matchingReceipt=persistedReceipt&&persistedReceipt.state===request.state&&
      (persistedReceipt.attempt??0)===(request.attempt??0)&&
      (pkg.executionAttempt===undefined||pkg.executionAttempt===(persistedReceipt.attempt??0)||persistedReceipt.state==='STOPPED'&&pkg.executionAttempt===(persistedReceipt.attempt??0)+1);
    if(matchingReceipt)return this.recordReceipt(actor,reference,persistedReceipt);
    if(persistedReceipt&&!retryPending&&request.state!=='RUNNING')return this.result(plan,pkg,'UNCERTAIN',requestId,undefined,'Persisted receipt does not match the bound attempt. Inspect; do not replay.');
    if(request.state==='RUNNING')return this.result(plan,pkg,'UNCERTAIN',requestId,undefined,'Agency Execution is RUNNING with no terminal receipt. Do not replay; inspect/reconcile the existing request.');
    if(['FAILED','SUCCEEDED','BLOCKED'].includes(request.state)&&!retryPending)return this.result(plan,pkg,'UNCERTAIN',requestId,undefined,'Agency Execution has a persisted non-READY state without a terminal receipt. Do not replay; inspect/reconcile the existing request.');

    let receipt:AgencyExecutionReceipt;
    try{receipt=await this.loop.execute(reference.tenantId,requestId);}
    catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(/EXECUTION_(IN_PROGRESS_OR_UNCERTAIN|OUTCOME_UNCERTAIN|CHANGED)/.test(message)){
        plan=this.plan(actor,reference);pkg=this.pkg(plan,reference.workPackageId);
        return this.result(plan,pkg,'UNCERTAIN',requestId,undefined,'Execution ownership/outcome is uncertain. The existing request must be inspected; it will not be replayed automatically.');
      }
      throw error;
    }
    return this.recordReceipt(actor,reference,receipt);
  }

  stop(actor:OrchestrationActor,reference:OrchestrationExecutionReference,reason='Stopped by customer'):CanonicalExecutionLoopResult{
    let plan=this.plan(actor,reference),pkg=this.pkg(plan,reference.workPackageId);
    // Orchestrator.stop is plan-wide: stop every bound canonical request first.
    for(const id of new Set(plan.workPackages.map(p=>p.executionRequestId).filter((id):id is string=>!!id)))this.loop.stop(reference.tenantId,id,reason);
    if(plan.status!=='STOPPED'){
      try{plan=this.orchestrator.stop(actor,plan.id,plan.revision,reason);}
      catch(error){
        const current=this.plan(actor,reference);
        if(current.status!=='STOPPED')throw error;
        plan=current;
      }
    }
    pkg=this.pkg(plan,reference.workPackageId);
    const outcome=pkg.status==='SUCCEEDED'||pkg.status==='FAILED'?pkg.status:'STOPPED';
    return this.result(plan,pkg,outcome,pkg.executionRequestId||undefined,pkg.lastExecutionReceiptId||undefined,outcome==='STOPPED'?'Canonical orchestration stop is durable; late completion cannot revive this work.':'The selected work was already terminal; stop did not change its confirmed outcome.');
  }

  private recordReceipt(actor:OrchestrationActor,reference:OrchestrationExecutionReference,receipt:AgencyExecutionReceipt):CanonicalExecutionLoopResult{
    let plan=this.plan(actor,reference),pkg=this.pkg(plan,reference.workPackageId);
    if(pkg.status==='STOPPED')return this.result(plan,pkg,'STOPPED',pkg.executionRequestId||receipt.executionRequestId,receipt.id,'Late Agency Execution receipt remains durable but cannot revive stopped orchestration work.');
    if(pkg.lastExecutionReceiptId===receipt.id&&['SUCCEEDED','FAILED','STOPPED'].includes(pkg.status))return this.result(plan,pkg,pkg.status as 'SUCCEEDED'|'FAILED'|'STOPPED',pkg.executionRequestId||receipt.executionRequestId,receipt.id,'Canonical terminal receipt was already recorded.');
    try{
      plan=this.orchestrator.recordAgencyExecutionReceipt(actor,plan.id,pkg.id,plan.revision,{id:receipt.id,state:receipt.state,retryClass:receipt.retryClass,capabilityReceiptId:receipt.capabilityReceiptId,blockCode:receipt.blockCode,errorCode:receipt.errorCode});
    }catch(error){
      const current=this.plan(actor,reference),currentPkg=this.pkg(current,pkg.id);
      if(currentPkg.status==='STOPPED')return this.result(current,currentPkg,'STOPPED',currentPkg.executionRequestId||receipt.executionRequestId,receipt.id,'Late receipt observed after STOP; canonical work remains stopped.');
      if(currentPkg.lastExecutionReceiptId===receipt.id&&['SUCCEEDED','FAILED'].includes(currentPkg.status))return this.result(current,currentPkg,currentPkg.status as 'SUCCEEDED'|'FAILED',currentPkg.executionRequestId||receipt.executionRequestId,receipt.id,'Concurrent recorder already persisted the same authoritative receipt.');
      throw error;
    }
    pkg=this.pkg(plan,reference.workPackageId);
    return this.result(plan,pkg,pkg.status as 'SUCCEEDED'|'FAILED'|'STOPPED',pkg.executionRequestId||receipt.executionRequestId,receipt.id,'Authoritative Agency Execution receipt recorded into canonical orchestration lifecycle.');
  }

  private plan(actor:OrchestrationActor,reference:OrchestrationExecutionReference){
    const plan=this.orchestrator.getPlan(actor,reference.orchestrationPlanId);
    if(plan.tenantId!==reference.tenantId)throw new Error('Orchestration execution tenant mismatch.');
    return plan;
  }
  private pkg(plan:OrchestrationPlan,id:string){const pkg=plan.workPackages.find(item=>item.id===id);if(!pkg)throw new Error('Orchestration work package unavailable.');return pkg;}
  private result(plan:OrchestrationPlan,pkg:OrchestrationWorkPackage,state:CanonicalExecutionLoopState,executionRequestId?:string,agencyExecutionReceiptId?:string,detail?:string):CanonicalExecutionLoopResult{return{state,orchestrationPlanId:plan.id,workPackageId:pkg.id,planRevision:plan.revision,executionRequestId,agencyExecutionReceiptId,detail};}
}
