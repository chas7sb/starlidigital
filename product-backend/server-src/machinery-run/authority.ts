import type {Store} from '../store.js';
import type {OrchestrationPlan,OrchestrationReceipt} from '../starli-orchestrator/domain.js';
import {ORCHESTRATION_COLLECTIONS} from '../starli-orchestrator/service.js';
import {assertPlanIntegrity} from '../starli-orchestrator/policy.js';
import type {AgencyExecutionRequest,AgencyExecutionReceipt} from '../agency-execution/types.js';
import type {AutonomyPolicyRecord} from '../autonomy-policy/types.js';

export type MachineryPlanRead={plan:OrchestrationPlan|null;reason:'AVAILABLE'|'UNAVAILABLE'|'INVALID'};
export interface MachineryAuthorityReader{
 readPlan(scope:{tenantId:string;ownerId:string},planId:string):MachineryPlanRead;
 readOrchestrationReceipt(tenantId:string,planId:string,id:string):OrchestrationReceipt|null;
 readExecutionRequest(tenantId:string,id:string):AgencyExecutionRequest|null;
 readExecutionReceipt(tenantId:string,id:string):AgencyExecutionReceipt|null;
 readGlobalPause(tenantId:string):{paused:boolean;policyId:string;updatedAt:string|null};
}
export class CanonicalMachineryAuthorityReader implements MachineryAuthorityReader{
 constructor(private store:Store){}
 readPlan(scope:{tenantId:string;ownerId:string},planId:string):MachineryPlanRead{const plan=this.store.get(ORCHESTRATION_COLLECTIONS.plans,planId) as OrchestrationPlan|undefined;if(!plan||plan.tenantId!==scope.tenantId||plan.ownerId!==scope.ownerId)return{plan:null,reason:'UNAVAILABLE'};try{assertPlanIntegrity(plan);return{plan:structuredClone(plan),reason:'AVAILABLE'}}catch{return{plan:null,reason:'INVALID'}}}
 readOrchestrationReceipt(tenantId:string,planId:string,id:string){const row=this.store.get(ORCHESTRATION_COLLECTIONS.receipts,id) as OrchestrationReceipt|undefined;return row&&row.tenantId===tenantId&&row.orchestrationPlanId===planId?structuredClone(row):null}
 readExecutionRequest(tenantId:string,id:string){const row=this.store.get('agency-execution-requests',id) as AgencyExecutionRequest|undefined;return row&&row.tenantId===tenantId?structuredClone(row):null}
 readExecutionReceipt(tenantId:string,id:string){const row=this.store.get('agency-execution-receipts',id) as AgencyExecutionReceipt|undefined;return row&&row.tenantId===tenantId?structuredClone(row):null}
 readGlobalPause(tenantId:string){const id=`policy:${tenantId}`,row=this.store.get('agency-autonomy-policies',id) as AutonomyPolicyRecord|undefined;if(!row)return{paused:false,policyId:id,updatedAt:null};if(row.tenantId!==tenantId)throw new Error('Autonomy policy tenant mismatch.');return{paused:!!row.pauseAll,policyId:row.id,updatedAt:row.updatedAt||null}}
}
