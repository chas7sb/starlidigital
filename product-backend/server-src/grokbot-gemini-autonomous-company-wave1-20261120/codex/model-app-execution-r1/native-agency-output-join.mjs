import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const field=(o,a,b)=>o[a]??o[b];
/**
 * Joins native persisted Agency output to R6 issuer. This class never accepts
 * caller-authored output or promotes a utility result to a model-worker claim.
 */
export class NativeAgencyOutputJoin {
 constructor({machineryRuns,orchestrator,agencyExecution,capabilityState,issuer,artifactRootDir}) {
  Object.assign(this,{machineryRuns,orchestrator,agencyExecution,capabilityState,issuer,artifactRootDir});
  for(const [v,m] of [[machineryRuns,'getRun'],[orchestrator,'getPlan'],[agencyExecution,'getRequest'],[agencyExecution,'getReceipt'],[capabilityState,'getIdempotency'],[issuer,'issueFromCanonicalCompletion']]) if(typeof v?.[m]!=='function') fail('NATIVE_SERVICE_REQUIRED:'+m);
  this.root=realpathSync(artifactRootDir);
 }
 async issue({actor,graph,link,workPackageId}) {
  const companyId=field(graph,'company_id','companyId'), projectId=field(graph,'project_id','projectId'), graphId=field(graph,'graph_id','graphId');
  if(!actor?.userId||actor.workspaceTenantId!==companyId) fail('NATIVE_ACTOR_SCOPE_MISMATCH');
  const run=this.machineryRuns.getRun(actor,field(graph,'machinery_run_id','machineryRunId'));
  if(run.tenantId!==companyId||!run.selections.some(s=>s.orchestrationPlanId===graphId&&s.workPackageIds.includes(workPackageId))) fail('WORK_NOT_SELECTED');
  const read=()=>{
   const plan=this.orchestrator.getPlan(actor,graphId), pkg=plan.workPackages.find(p=>p.id===workPackageId);
   if(plan.tenantId!==companyId||plan.goal.projectId!==projectId||!pkg||pkg.projectId!==projectId||pkg.status!=='SUCCEEDED'||plan.status==='STOPPED') fail('NATIVE_COMPLETION_REQUIRED');
   const request=this.agencyExecution.getRequest(companyId,pkg.executionRequestId);
   const agency=this.agencyExecution.getReceipt(companyId,pkg.executionRequestId);
   if(request.state!=='SUCCEEDED'||request.projectId!==projectId||request.actionPlanId!==pkg.agencyActionPlanId||!agency||agency.state!=='SUCCEEDED'||agency.id!==pkg.lastExecutionReceiptId||agency.executionRequestId!==request.id||agency.tenantId!==companyId||agency.projectId!==projectId||agency.capabilityId!==request.capabilityId||agency.actionPlanId!==request.actionPlanId||(agency.attempt??0)!==(request.attempt??0)) fail('NATIVE_RECEIPT_BINDING_MISMATCH');
   return {plan,pkg,request,agency};
  };
  let {plan,pkg,request,agency}=read();
  if(field(link,'child_company_id','childCompanyId')!==companyId||field(link,'parent_run_id','parentRunId')!==field(graph,'parent_run_id','parentRunId')) fail('LINK_SCOPE_MISMATCH');
  if((field(link,'work_package_id','workPackageId')??field(link,'task_id','taskId'))!==workPackageId) fail('LINK_WORK_PACKAGE_MISMATCH');
  const cached=await this.capabilityState.getIdempotency(companyId,request.capabilityId,request.projectId,hash(request.idempotencyKey));
  const result=cached?.result,audit=result?.receipt;
  const bytes=JSON.stringify(result?.data??null),digest=hash(bytes);
  if(cached?.tenantId!==companyId||cached.capabilityId!==request.capabilityId||cached.projectId!==projectId||!result?.ok||result.capabilityId!==request.capabilityId||audit?.id!==agency.capabilityReceiptId||audit.status!=='SUCCEEDED'||audit.tenantId!==companyId||audit.projectId!==projectId||audit.capabilityId!==request.capabilityId||audit.requestId!==request.id||audit.resultHash!==digest||agency.capabilityResultHash!==digest) fail('NATIVE_OUTPUT_PROVENANCE_MISMATCH');
  // Awaited store access above cannot authorize stale completion.
  const current=read();if(JSON.stringify(current)!==JSON.stringify({plan,pkg,request,agency})) fail('NATIVE_COMPLETION_CHANGED');
  const artifactPath=path.join(this.root,digest+'.json');
  try{writeFileSync(artifactPath,bytes,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  if(realpathSync(artifactPath)!==artifactPath||hash(readFileSync(artifactPath))!==digest) fail('OUTPUT_FILE_MISMATCH');
  // R6 expects status; native schema uses state. Preserve original Agency record.
  const normalized={...agency,status:agency.state,outputDigest:digest,executionClass:'NATIVE_NONPRODUCTION'};
  const receipt=this.issuer.issueFromCanonicalCompletion({
   agencyReceipt:normalized,orchestrationPlan:plan,workPackage:pkg,artifactRootDir:this.root,artifactPath,
   graphId,companyId,projectId,requestId:field(graph,'request_id','requestId'),roomId:field(link,'child_room_id','childRoomId'),
   callId:field(link,'call_id','callId'),taskId:field(link,'task_id','taskId'),childRunId:field(link,'child_run_id','childRunId'),
   authorizationRevision:field(graph,'authorization_revision','authorizationRevision'),generation:graph.generation,executionClass:'NATIVE_NONPRODUCTION'});
  return {receipt,artifactPath,artifactDigest:digest,provenance:{kind:'PERSISTED_NATIVE_CAPABILITY_RESULT',machineryRunId:run.id,orchestrationPlanId:plan.id,workPackageId,executionRequestId:request.id,agencyReceiptId:agency.id,capabilityReceiptId:audit.id,capabilityId:request.capabilityId,modelWorker:result.data?.provider==='OPENROUTER_MODEL'&&result.data?.modelCalls===1}};
 }
}
