import {limit} from '../security.js';
import {receipt,hashOpaque} from '../customer-capabilities/security.js';
import {StoreCapabilityStateRepository} from '../customer-capabilities/store.js';
import type {Store} from '../store.js';
import {AutonomyPolicyService} from '../autonomy-policy/service.js';
import {AgencyApprovalService} from '../agency-approvals/service.js';
import type {CustomerCapabilityGateway} from '../customer-capabilities/gateway.js';
import type {CustomerCapabilityRegistry} from '../customer-capabilities/registry.js';
import type {CapabilityCallerContext,UnifiedToolDefinition} from './types.js';
/** Explicit semantic bindings only. Catalog presence is never permission to execute. */
export class CanonicalCapabilityAuthority {
 constructor(private store:Store,readonly policy:AutonomyPolicyService,private gateway:CustomerCapabilityGateway,private registry:CustomerCapabilityRegistry,private bindings:Readonly<Record<string,string>>={},private approvals=new AgencyApprovalService(store)){}
 throttle(tenant:string,tool:string,minute:number,hour:number){limit(`canonical-surface-minute:${tenant}:${tool}`,minute,60000);limit(`canonical-surface-hour:${tenant}:${tool}`,hour,3600000);}
 paused(tenant:string){return this.policy.record(tenant).pauseAll;}
 pause(tenant:string,value:boolean){return this.policy.setPauseAll(tenant,value);}
 available(tool:string){if(['starli.governance.pause','starli.governance.approve','starli.governance.reject','starli.governance.receipt_get'].includes(tool))return true;return !!this.bindings[tool]&&!!this.registry.get(this.bindings[tool]);}
 async invoke(caller:CapabilityCallerContext,def:UnifiedToolDefinition,input:Record<string,unknown>){
  const capabilityId=this.bindings[def.id];const definition=capabilityId?this.registry.get(capabilityId)?.definition:undefined;
  if(!definition)throw new Error('CAPABILITY_UNAVAILABLE');
  // Side effects belong to Starli/Agency Execution, not a second surface executor.
  if(!['READ','NONE'].includes(definition.sideEffectLevel)||definition.sideEffectLevel!==def.sideEffectLevel)throw new Error('GOVERNED_EXECUTION_REQUIRED');
  return this.gateway.invoke({tenantId:caller.tenantId,subjectId:caller.subjectId,scopes:caller.scopes,source:caller.surface==='CUSTOMER_AGENT'?'CUSTOMER_AGENT':caller.surface==='CLI'?'CLI':caller.surface==='CHATGPT_MCP'?'CHATGPT_CONNECTION':'STUDIO',autonomous:caller.isAutonomous,requestId:caller.requestId},{capabilityId,projectId:caller.activeProjectId,input,idempotencyKey:caller.requestId});
 }
 resolve(caller:CapabilityCallerContext,id:string,hash:string,decision:'APPROVE'|'REJECT'){
  if(caller.isAutonomous)throw new Error('HUMAN_DECISION_REQUIRED');
  try{const record=this.approvals.get(caller.tenantId,id);if(!hash||hash!==record.payloadHash)throw new Error('APPROVAL_INVALID');return this.approvals.resolve(caller.tenantId,id,decision,caller.subjectId);}catch{throw new Error('APPROVAL_INVALID');}
 }
 async recordGovernance(caller:CapabilityCallerContext,toolId:string,data:unknown){const stamp=new Date().toISOString();const audit=receipt({tenantId:caller.tenantId,subjectId:caller.subjectId,capabilityId:toolId,sideEffectLevel:toolId.endsWith('receipt_get')?'READ':'HIGH_IMPACT',status:'SUCCEEDED',requestId:caller.requestId,resultHash:hashOpaque(JSON.stringify(data)),startedAt:stamp,completedAt:stamp});await new StoreCapabilityStateRepository(this.store).appendAudit(audit);return audit.id;}
 receipt(tenant:string,id:string){const row=this.store.get('customer-capability-audits',id);if(!row||row.tenantId!==tenant)return null;return {id:row.id,receiptId:row.id,status:row.status,capabilityId:row.capabilityId,startedAt:row.startedAt,completedAt:row.completedAt,resultHash:row.resultHash??null};}
}
