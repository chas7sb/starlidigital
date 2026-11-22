import type {MachineryPreflightService} from '../business-engine/machinery-preflight.js';
import type {CanonicalExecutionLoopResult,CanonicalStarliExecutionConsumer} from '../agency-execution/canonical-consumer.js';
import type {OrchestrationActor,OrchestrationPlan,OrchestrationWorkPackage} from '../starli-orchestrator/domain.js';
import type {StarliOrchestratorService} from '../starli-orchestrator/service.js';
import type {MachineryRunActor,MachineryRunSnapshot,MachineryWorkProjection} from './types.js';
import type {MachineryRunService} from './service.js';

export type MachineryDriverDisposition=
 |'ADVANCED'
 |'WAITING_INPUT'
 |'WAITING_APPROVAL'
 |'WAITING_CONNECTION'
 |'PAUSED'
 |'BLOCKED'
 |'UNCERTAIN'
 |'STOP_PENDING'
 |'TERMINAL'
 |'NO_EXECUTABLE_WORK';

export interface MachineryDriverResult{
  disposition:MachineryDriverDisposition;
  snapshot:MachineryRunSnapshot;
  transitionedWork?:{orchestrationPlanId:string;workPackageId:string;execution:CanonicalExecutionLoopResult};
  confirmedStopped?:boolean;
  stopOutcomes?:unknown[];
  computeStopHandoff?:unknown;
  detail:string;
}

export class MachineryRunExecutionDriver{
  constructor(
    private machinery:MachineryRunService,
    private orchestrator:StarliOrchestratorService,
    private execution:CanonicalStarliExecutionConsumer,
    private businessPreflight?:MachineryPreflightService
  ){}

  inspect(actor:MachineryRunActor,runId:string):MachineryDriverResult{
    const snapshot=this.machinery.refresh(actor,runId);
    return this.describe(snapshot);
  }

  async advance(actor:MachineryRunActor,runId:string,requestedBy:string):Promise<MachineryDriverResult>{
    let snapshot=this.machinery.refresh(actor,runId);
    const pre=this.describe(snapshot);
    if(['PAUSED','UNCERTAIN','TERMINAL'].includes(pre.disposition))return pre;

    const running=snapshot.work.find(w=>w.state==='RUNNING');
    if(running){
      const ref={tenantId:snapshot.tenantId,orchestrationPlanId:running.orchestrationPlanId,workPackageId:running.workPackageId};
      const execution=await this.execution.resume(this.orchestrationActor(actor),ref);
      snapshot=this.machinery.refresh(actor,runId);
      return{disposition:execution.state==='UNCERTAIN'?'UNCERTAIN':'ADVANCED',snapshot,transitionedWork:{orchestrationPlanId:ref.orchestrationPlanId,workPackageId:ref.workPackageId,execution},detail:execution.detail||'Existing governed execution request reconciled.'};
    }

    for(const work of snapshot.work.filter(w=>w.state==='READY')){
      const canonical=this.canonicalWork(actor,work);
      if(canonical.executionMode!=='EXECUTABLE')continue;
      const fresh=this.checkBusinessEngineFreshness(actor,work);
      if(fresh)return{disposition:'BLOCKED',snapshot,detail:fresh};
      const ref={tenantId:snapshot.tenantId,orchestrationPlanId:work.orchestrationPlanId,workPackageId:work.workPackageId};
      const execution=await this.execution.executeReady(this.orchestrationActor(actor),ref,requestedBy);
      snapshot=this.machinery.refresh(actor,runId);
      return{disposition:execution.state==='UNCERTAIN'?'UNCERTAIN':'ADVANCED',snapshot,transitionedWork:{orchestrationPlanId:ref.orchestrationPlanId,workPackageId:ref.workPackageId,execution},detail:execution.detail||'One governed machinery work package advanced.'};
    }

    const blocked=this.describe(snapshot);
    if(['WAITING_INPUT','WAITING_APPROVAL','WAITING_CONNECTION','BLOCKED'].includes(blocked.disposition))return blocked;
    return{disposition:'NO_EXECUTABLE_WORK',snapshot,detail:'No selected canonical READY executable work is available. Planning-only work must be completed by its authoritative planner.'};
  }

  async stop(actor:MachineryRunActor,runId:string,reason='Stopped by operator'):Promise<MachineryDriverResult>{
    const run=this.machinery.getRun(actor,runId);
    const orchActor=this.orchestrationActor(actor);
    const stopOutcomes:unknown[]=[];
    let requiredCount=0;
    let allConfirmed=true;
    let anyUncertain=false;
    let latestComputeStopHandoff:unknown=undefined;
    for(const selection of run.selections){
      const plan=this.orchestrator.getPlan(orchActor,selection.orchestrationPlanId);
      const selectedPackages=selection.workPackageIds.map(id=>plan.workPackages.find(p=>p.id===id)).filter((p):p is OrchestrationWorkPackage=>!!p);
      if(selectedPackages.length===0){
        allConfirmed=false;
        continue;
      }
      for(const selected of selectedPackages){
        requiredCount++;
        const outcome:any=await Promise.resolve(this.execution.stop(orchActor,{tenantId:plan.tenantId,orchestrationPlanId:plan.id,workPackageId:selected.id},reason));
        stopOutcomes.push(outcome);
        if(outcome&&typeof outcome==='object'&&outcome.computeStopHandoff!==undefined){
          latestComputeStopHandoff=outcome.computeStopHandoff;
        }
        const isUncertain=Boolean(outcome&&typeof outcome==='object'&&(outcome.state==='UNCERTAIN'||outcome.stopState==='UNCERTAIN'));
        if(isUncertain)anyUncertain=true;
        const handoffOk=!outcome||typeof outcome!=='object'||outcome.computeStopHandoff===undefined||(outcome.computeStopHandoff&&typeof outcome.computeStopHandoff==='object'&&outcome.computeStopHandoff.confirmedStopped===true&&outcome.computeStopHandoff.stopState!=='STOP_PENDING');
        const explicitlyConfirmed=Boolean(
          outcome&&
          typeof outcome==='object'&&
          outcome.confirmedStopped===true&&
          outcome.stopState!=='STOP_PENDING'&&
          outcome.state!=='STOP_PENDING'&&
          !isUncertain&&
          handoffOk
        );
        if(!explicitlyConfirmed){
          allConfirmed=false;
        }
      }
    }
    const snapshot=this.machinery.refresh(actor,runId);
    if(anyUncertain||snapshot.state==='UNCERTAIN'){
      return{
        disposition:'UNCERTAIN',
        snapshot,
        confirmedStopped:false,
        stopOutcomes,
        ...(latestComputeStopHandoff!==undefined?{computeStopHandoff:latestComputeStopHandoff}:{}),
        detail:'STOP outcome is UNCERTAIN; physical cancellation is not confirmed. Inspect canonical state.'
      };
    }
    if(requiredCount===0||!allConfirmed){
      return{
        disposition:'STOP_PENDING',
        snapshot,
        confirmedStopped:false,
        stopOutcomes,
        ...(latestComputeStopHandoff!==undefined?{computeStopHandoff:latestComputeStopHandoff}:{}),
        detail:'STOP requested; logical stop alone or missing/unconfirmed cancellation cannot confirm physical teardown (STOP_PENDING).'
      };
    }
    return{
      ...this.describe(snapshot),
      confirmedStopped:true,
      stopOutcomes,
      ...(latestComputeStopHandoff!==undefined?{computeStopHandoff:latestComputeStopHandoff}:{}),
      detail:snapshot.state==='STOPPED'?'Canonical plan/Agency STOP applied and physical cancellation explicitly confirmed. Late effects cannot revive the machinery run.':'STOP explicitly confirmed for already-terminal selected work.'
    };
  }

  private describe(snapshot:MachineryRunSnapshot):MachineryDriverResult{
    if(snapshot.globalPause.paused||snapshot.state==='PAUSED')return{disposition:'PAUSED',snapshot,detail:'Global autonomy pause is active. No governed execution will start.'};
    if(snapshot.state==='UNCERTAIN')return{disposition:'UNCERTAIN',snapshot,detail:'At least one selected effect is uncertain. Inspect canonical request/receipt state; do not replay automatically.'};
    if(['COMPLETED','FAILED','STOPPED'].includes(snapshot.state))return{disposition:'TERMINAL',snapshot,detail:`Machinery run is ${snapshot.state.toLowerCase()} from canonical evidence.`};
    if(snapshot.state==='WAITING_INPUT')return{disposition:'WAITING_INPUT',snapshot,detail:'Canonical work is waiting for customer clarification.'};
    if(snapshot.state==='WAITING_APPROVAL')return{disposition:'WAITING_APPROVAL',snapshot,detail:'Canonical work requires approval before execution.'};
    if(snapshot.state==='WAITING_CONNECTION')return{disposition:'WAITING_CONNECTION',snapshot,detail:'A required canonical connection is missing or unavailable.'};
    if(snapshot.state==='BLOCKED')return{disposition:'BLOCKED',snapshot,detail:'Canonical dependency/capability state blocks further machinery execution.'};
    return{disposition:'NO_EXECUTABLE_WORK',snapshot,detail:'Machinery run is inspectable and may have READY or RUNNING work.'};
  }

  /** Read-only ADVANCE-time freshness gate. START-time validation alone cannot
   * authorize work after the customer's Business Engine version or materialized
   * plan changes. Never create an Agency request for a stale source selection.
   */
  private checkBusinessEngineFreshness(actor:MachineryRunActor,work:MachineryWorkProjection):string|null{
    const plan=this.orchestrator.getPlan(this.orchestrationActor(actor),work.orchestrationPlanId);
    const source=plan.businessMaterializationRef;
    if(!source)return null; // Ordinary standalone canonical plans retain existing governance.
    // Runtime must provide the same existing preflight used at Machinery START.
    // Fail closed rather than bypassing materialization provenance if omitted.
    if(!this.businessPreflight)return'Stale Business Engine selection: canonical preflight is unavailable.';
    const result=this.businessPreflight.evaluate(actor,{businessEngineId:source.businessEngineId});
    const eligible=result.selectionSuggestions.some(s=>s.orchestrationPlanId===plan.id&&s.workPackageId===work.workPackageId&&s.status==='READY');
    if(result.status!=='READY'||
       result.businessEngineRef?.businessEngineId!==source.businessEngineId||
       result.businessEngineRef.engineVersionId!==source.engineVersionId||
       result.planningRef?.materializationId!==source.materializationId||
       result.planningRef.orchestrationPlanId!==plan.id||
       result.planningRef.revision!==plan.revision||
       !eligible)
      return'Stale Business Engine version, materialization, plan revision or work selection. Re-run preflight and plan the current version before advancing.';
    return null;
  }

  private canonicalWork(actor:MachineryRunActor,work:MachineryWorkProjection){
    const plan=this.orchestrator.getPlan(this.orchestrationActor(actor),work.orchestrationPlanId);
    const pkg=plan.workPackages.find(p=>p.id===work.workPackageId);
    if(!pkg)throw new Error('Selected canonical machinery work package is unavailable.');
    if(plan.revision!==work.orchestrationPlanRevision)throw new Error('Machinery snapshot is stale; refresh before execution.');
    return pkg;
  }

  private orchestrationActor(actor:MachineryRunActor):OrchestrationActor{return{userId:actor.userId,workspaceTenantId:actor.workspaceTenantId,role:actor.role};}
}
