import type {Store} from '../store.js';
import type {Events} from '../events.js';
import {AgencyApprovalService} from '../agency-approvals/service.js';
import type {AgencyApprovalRecord} from '../agency-approvals/types.js';
import type {AgencyActionPlan,EntityRef} from '../agency-intelligence/types.js';
import {StoreCapabilityStateRepository} from '../customer-capabilities/store.js';
import type {CapabilityAuditReceipt} from '../customer-capabilities/types.js';
import type {ApprovalCenterDecision,ApprovalCenterCard,ApprovalCenterSnapshot,CustomerActionReceipt} from './types.js';

const MAX_APPROVALS=50,MAX_RECEIPTS=100;
const safeTenant=(value:string)=>{const v=String(value||'').trim();if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(v))throw new Error('Invalid tenant identity.');return v};
const label=(value:unknown,fallback:string,max=220)=>{const v=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();return(v||fallback).slice(0,max)};
const ref=(refs:EntityRef[]|undefined,...kinds:string[])=>refs?.find(item=>kinds.includes(item.kind))?.id??null;

export class ApprovalCenterService{
  private approvals:AgencyApprovalService;
  private capabilities:StoreCapabilityStateRepository;
  constructor(private store:Store,events?:Events,private clock=()=>Date.now()){
    this.approvals=new AgencyApprovalService(store,events,clock);
    this.capabilities=new StoreCapabilityStateRepository(store);
    this.approvals.reconcilePlans();
  }
  snapshot(tenantId:string,input:{receiptLimit?:number;receiptBefore?:string}={}):ApprovalCenterSnapshot{
    const tenant=safeTenant(tenantId),records=this.approvals.list(tenant).slice(0,MAX_APPROVALS),limit=Math.min(MAX_RECEIPTS,Math.max(1,Number(input.receiptLimit)||30));
    const receipts=this.receipts(tenant,input.receiptBefore).slice(0,limit),last=receipts.at(-1);
    return{schemaVersion:1,generatedAt:new Date(this.clock()).toISOString(),pendingCount:records.filter(item=>item.status==='PENDING').length,approvals:records.map(item=>this.card(tenant,item)),receipts,nextReceiptCursor:receipts.length===limit&&last?`${last.timestamp}|${last.id}`:null};
  }
  resolve(tenantId:string,approvalId:string,decision:ApprovalCenterDecision,principal:string){
    const tenant=safeTenant(tenantId);return this.approvals.resolve(tenant,approvalId,decision,principal);
  }
  private card(tenantId:string,record:AgencyApprovalRecord):ApprovalCenterCard{
    const plan=this.store.get('agency-action-plans',record.actionPlanId) as AgencyActionPlan|undefined;
    const validPlan=plan?.tenantId===tenantId?plan:undefined,projectId=ref(validPlan?.entityRefs,'creative_project','project','backend_project'),businessEngineId=ref(validPlan?.entityRefs,'business_engine');
    const affectedLabel=projectId?'This project':businessEngineId?'Your business engine':'Your business';
    return{id:record.id,title:label(record.title,'Starli action'),what:label(record.title,'Starli wants to perform a bounded action.'),why:label(record.detail,'Starli found a reason to recommend this action.',300),affected:{label:affectedLabel,projectId,businessEngineId},capability:label(record.capabilityLabel,'Starli action'),risk:record.impact,sideEffect:this.sideEffect(record),status:record.status,requestedAt:record.requestedAt,expiresAt:record.expiresAt,actionPlanId:record.actionPlanId};
  }
  private sideEffect(record:AgencyApprovalRecord){if(record.impact==='HIGH')return'Could affect customers, publishing, production, money, or another external system.';if(record.impact==='MEDIUM')return'Could create an external communication or customer-facing change.';return'Reversible or low-impact action; approval is still required by policy.'}
  private receipts(tenantId:string,before?:string){
    const beforeTime=this.beforeTime(before),capability=(this.store.list('customer-capability-audits',tenantId) as CapabilityAuditReceipt[]).filter(item=>item.tenantId===tenantId&&Date.parse(item.completedAt)<beforeTime).map(item=>this.capabilityReceipt(item));
    const decisions=(this.store.list('agency-approvals',tenantId) as AgencyApprovalRecord[]).filter(item=>item.tenantId===tenantId&&!!item.resolvedAt&&['APPROVED','REJECTED'].includes(item.status)&&Date.parse(item.resolvedAt!)<beforeTime).map(item=>this.approvalReceipt(item));
    return[...capability,...decisions].sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp)||b.id.localeCompare(a.id)).slice(0,MAX_RECEIPTS+1);
  }
  private beforeTime(cursor?:string){if(!cursor)return Number.POSITIVE_INFINITY;const [stamp]=String(cursor).split('|');const parsed=Date.parse(stamp);return Number.isFinite(parsed)?parsed:Number.POSITIVE_INFINITY}
  private capabilityReceipt(item:CapabilityAuditReceipt):CustomerActionReceipt{
    const result=item.status==='SUCCEEDED'?'SUCCEEDED':item.status==='DENIED'?'DENIED':'FAILED';
    return{id:`capability:${item.id}`,action:`Starli used ${label(item.capabilityId,'a connected capability',120)}`,result,timestamp:item.completedAt,capability:item.capabilityId,projectId:item.projectId??null,evidenceReference:item.resultHash??item.requestId??null,nextStep:result==='SUCCEEDED'?'The result is recorded. Starli can use it as evidence for the next bounded step.':result==='DENIED'?'Review the required permission, connection, policy, or approval before retrying.':'Inspect the failure and correct the blocker before retrying.',source:'CAPABILITY'};
  }
  private approvalReceipt(item:AgencyApprovalRecord):CustomerActionReceipt{
    const approved=item.status==='APPROVED';return{id:`approval:${item.id}`,action:`${approved?'Approved':'Rejected'}: ${label(item.title,'Starli action',160)}`,result:approved?'APPROVED':'REJECTED',timestamp:item.resolvedAt!,capability:item.capabilityLabel||null,projectId:null,evidenceReference:item.actionPlanId,nextStep:approved?'Permission is recorded. This does not mean the action ran; execution still requires the governed capability path.':'The proposed action will not execute under this approval.',source:'APPROVAL'};
  }
}
