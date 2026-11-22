import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {NativeCompletionReceiptIssuer} from './native-completion-receipt-issuer.mjs';
import {createCustomerCapabilityRuntime} from '../../../customer-capabilities/runtime.ts';
import {createCanonicalMachineryExecutionRuntime} from '../../../machinery-run/runtime.ts';
import {orchestrationWorkFromAgencyActionPlan} from '../../../starli-orchestrator/agency-adapter.ts';
import {CanonicalOrchestrationRegistrationAdapter} from '../../gemini1/orchestration-r6/canonical-registration-adapter.mjs';
import {NativeAgencyOutputJoin} from './native-agency-output-join.mjs';
import {StarliExecutionLoop} from '../../../agency-execution/bridge.ts';
import {CanonicalStarliExecutionConsumer} from '../../../agency-execution/canonical-consumer.ts';
import {MachineryRunExecutionDriver} from '../../../machinery-run/execution-driver.ts';
import {MachineryPreflightService} from '../../../business-engine/machinery-preflight.ts';
export class NativeWorkerExecutionAdapter {
 constructor(private canonical:any){}
 async resolveExecution(reference:any){
  const resolved=await this.canonical.resolveExecution(reference);
  return resolved?{...resolved,input:{nativeActionPlanId:resolved.agencyActionPlanId}}:null;
 }
}
const digest=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=(m:string):never=>{throw new Error(m)};
const workerFile=fileURLToPath(new URL('./deterministic-native-worker.mjs',import.meta.url));
const workerSourceHash=createHash('sha256').update(readFileSync(workerFile)).digest('hex');
const processStart=(pid:number)=>{try{const stat=readFileSync('/proc/'+pid+'/stat','utf8');return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]}catch{return null}};
async function runWorker(job:any,onSpawn:any){
 return new Promise<any>((resolve,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=64',workerFile],{stdio:['pipe','pipe','pipe'],env:{TZ:'UTC'},shell:false});
  const identity={pid:child.pid,startTicks:child.pid?processStart(child.pid):null};
  const exited=new Promise<any>(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  if(child.pid&&identity.startTicks)onSpawn({...identity,child,exited,graphId:job.graphId,workPackageId:job.workPackageId});
  let text='',error='',settled=false;
  const finish=(err?:Error,value?:any)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(value)};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('NATIVE_WORKER_TIMEOUT'))},10000);
  child.stdout.on('data',c=>{text+=c.toString();if(Buffer.byteLength(text)>120*1024){child.kill('SIGKILL');finish(Error('NATIVE_WORKER_OUTPUT_TOO_LARGE'))}});
  child.stderr.on('data',c=>{error=(error+c.toString()).slice(-1000)});
  child.on('error',e=>finish(e));child.on('close',(code)=>{if(code!==0)return finish(Error('NATIVE_WORKER_FAILED:'+code));try{
   const value=JSON.parse(text);
   if(value.provider!=='DETERMINISTIC_LOCAL'||value.modelCalls!==0||value.worker?.pid!==child.pid||value.worker?.botId!==job.botId||value.worker?.roomId!==job.roomId||value.worker?.kind!==job.kind||!Array.isArray(value.files))throw Error('NATIVE_WORKER_OUTPUT_INVALID');
   for(const k of ['companyId','projectId','requestId','graphId','workPackageId'])if(value.scope?.[k]!==job[k])throw Error('NATIVE_WORKER_SCOPE_MISMATCH');
   finish(undefined,{...value,nativeExecution:{provider:'DETERMINISTIC_LOCAL',executionClass:'NATIVE_NONPRODUCTION',workerSourceHash,processExitCode:code,processIdentity:identity}});
  }catch(e){finish(e as Error)}});
  child.stdin.on('error',e=>finish(e));child.stdin.end(JSON.stringify(job));
 });
}
export function createNativeWorkerService({store,durableStore,receiptIssuer,artifactRootDir,authorizeScope,roomDirectory,resolveWorker,events,workerControl={}}:any){
 if(typeof authorizeScope!=='function'||typeof roomDirectory?.ownsRoom!=='function'||typeof resolveWorker!=='function')fail('TRUSTED_NATIVE_AUTHORITY_REQUIRED');
 const capabilityRuntime=createCustomerCapabilityRuntime({store});
 const runtime=createCanonicalMachineryExecutionRuntime({store,events,customerCapabilityRuntime:capabilityRuntime});
 const workerExecutionAdapter=new NativeWorkerExecutionAdapter(runtime.orchestrationAdapter);
 const executionLoop=new StarliExecutionLoop(runtime.agencyExecution,workerExecutionAdapter);
 const executionConsumer=new CanonicalStarliExecutionConsumer(runtime.orchestrator,executionLoop);
 const machineryDriver=new MachineryRunExecutionDriver(runtime.machineryRuns,runtime.orchestrator,executionConsumer,new MachineryPreflightService(store));
 Object.assign(runtime,{executionLoop,executionConsumer,machineryDriver});
 const registration=new CanonicalOrchestrationRegistrationAdapter({machineryRuns:runtime.machineryRuns,orchestrator:runtime.orchestrator,roomDirectory});
 const join=new NativeAgencyOutputJoin({machineryRuns:runtime.machineryRuns,orchestrator:runtime.orchestrator,agencyExecution:runtime.agencyExecution,capabilityState:capabilityRuntime.state,issuer:new NativeCompletionReceiptIssuer(receiptIssuer),artifactRootDir});
 const base=capabilityRuntime.registry.get('utility.calculator')!.definition;
 const activeProcesses=new Map<number,any>();
 for(const kind of ['FRONTEND','BACKEND']){
  const capabilityId='native.worker.draft.'+kind.toLowerCase();
  capabilityRuntime.registry.register({...base,id:capabilityId,displayName:'Native '+kind+' draft worker',category:'DEVELOPER',description:'Bounded deterministic native worker process; zero model calls',sideEffectLevel:'WRITE',projectScoped:true,inputSchema:{type:'object',additionalProperties:false,properties:{nativeActionPlanId:{type:'string',maxLength:180}},required:['nativeActionPlanId']},maxOutputBytes:120*1024},{async execute(input,context){
   const candidates=store.list('agency-execution-requests',context.tenantId).filter((r:any)=>r.actionPlanId===input.nativeActionPlanId&&r.state==='RUNNING'&&r.projectId===context.projectId&&'agency:'+r.requestedBy===context.subjectId);
   if(candidates.length!==1)fail('NATIVE_AGENCY_REQUEST_REQUIRED');
   const request=candidates[0];
   const binding=store.get('native-worker-bindings',input.nativeActionPlanId);
   if(!binding||binding.companyId!==context.tenantId||binding.projectId!==context.projectId||binding.kind!==kind||request.requestedBy!==binding.actor.userId)fail('NATIVE_WORKER_BINDING_REQUIRED');
   if(await authorizeScope(binding.actor,binding)!==true)fail('NATIVE_SCOPE_REVOKED');
   if(roomDirectory.ownsRoom(binding.companyId,binding.roomId)!==true)fail('NATIVE_WORKER_ROOM_DENIED');
   const worker=await resolveWorker(binding.companyId,binding.botId);
   if(worker?.botId!==binding.botId||worker.companyId!==binding.companyId||worker.roomId!==binding.roomId||worker.kind!==kind||worker.providerKind!=='DETERMINISTIC_LOCAL')fail('NATIVE_WORKER_DIRECTORY_MISMATCH');
   const plan=runtime.orchestrator.getPlan(binding.actor,binding.graphId);
   const pkg=plan.workPackages.find(p=>p.id===binding.workPackageId);
   if(pkg?.status!=='RUNNING'||pkg.executionRequestId!==request.id)fail('NATIVE_WORKER_NOT_OWNED');
   const result=await runWorker({...binding,agencyExecutionRequestId:request.id,holdMs:workerControl.holdMs??0},(process:any)=>activeProcesses.set(process.pid,process));
   if(await authorizeScope(binding.actor,binding)!==true)fail('NATIVE_SCOPE_REVOKED_AFTER_EXECUTION');
   return {data:result,trust:'TRUSTED_PLATFORM'};
  }});
 }
 async function prepare(input:any){
  const {actor,companyId,projectId,requestId,parentRoomId,workers}=input;
  if(!actor?.userId||actor.workspaceTenantId!==companyId||await authorizeScope(actor,input,{capability:'bots.run'})!==true)fail('NATIVE_SCOPE_DENIED');
  for(const k of ['projectId','requestId','parentRunId','parentRoomId','sourceMessageId','originalPromptMessageId','objective','idempotencyKey'])if(typeof input[k]!=='string'||!input[k])fail('NATIVE_INPUT_REQUIRED:'+k);
  if(input.sourceMessageId===input.originalPromptMessageId)fail('HUMAN_COMMAND_MUST_DIFFER_FROM_ORIGINAL_PROMPT');
  if(!Number.isSafeInteger(input.generation)||input.generation<1||!Number.isSafeInteger(input.authorizationRevision)||input.authorizationRevision<1)fail('NATIVE_REVISION_REQUIRED');
  if(!Array.isArray(workers)||workers.length!==2||new Set(workers.map((w:any)=>w.kind)).size!==2||new Set(workers.map((w:any)=>w.botId)).size!==2||new Set(workers.map((w:any)=>w.roomId)).size!==2)fail('TWO_DISTINCT_NATIVE_WORKERS_REQUIRED');
  if(roomDirectory.ownsRoom(companyId,parentRoomId)!==true)fail('PARENT_ROOM_DENIED');
  const key=digest({companyId,projectId,requestId,idempotencyKey:input.idempotencyKey}).slice(0,32);
  const prior=store.get('native-worker-dispatches','dispatch:'+key);
  if(prior){if(prior.fingerprint!==digest(input))fail('NATIVE_IDEMPOTENCY_CONFLICT');return prior.result;}
  const specs:any[]=[],bindings:any[]=[];
  for(const w of workers){
   const canonical=await resolveWorker(companyId,w.botId);
   if(!['FRONTEND','BACKEND'].includes(w.kind)||canonical?.botId!==w.botId||canonical.companyId!==companyId||canonical.roomId!==w.roomId||canonical.kind!==w.kind||canonical.providerKind!=='DETERMINISTIC_LOCAL'||roomDirectory.ownsRoom(companyId,w.roomId)!==true)fail('NATIVE_WORKER_DIRECTORY_MISMATCH');
   const capabilityId='native.worker.draft.'+w.kind.toLowerCase();
   const action={id:'native-action:'+key+':'+w.kind.toLowerCase(),tenantId:companyId,opportunityId:requestId,status:'PROPOSED',action:{kind:'DRAFT',label:w.kind+' worker',rationale:input.objective,autonomyAllowed:'DRAFT',approvalRequired:false},entityRefs:[{kind:'project',id:projectId}],evidenceRefs:[input.sourceMessageId],capabilityRequirement:capabilityId,approvalRequired:false,autonomyAllowed:'DRAFT',createdAt:new Date().toISOString()};
   const existing=store.get('agency-action-plans',action.id);if(existing)fail('NATIVE_PREPARE_PARTIAL_INSPECT_REQUIRED');
   store.put('agency-action-plans',action,companyId);
   const enabled=await capabilityRuntime.state.getTenantCapability(companyId,capabilityId);
   const grant=await capabilityRuntime.state.getProjectGrant(companyId,projectId,capabilityId);
   if(!enabled?.enabled||!grant?.enabled||!base.requiredScopes.every(s=>grant.scopes.includes(s))||(grant.expiresAt&&Date.parse(grant.expiresAt)<=Date.now()))fail('NATIVE_CAPABILITY_GRANT_REQUIRED:'+capabilityId);
   const spec=orchestrationWorkFromAgencyActionPlan({plan:action as any,projectId,capability:{availability:'AVAILABLE',connection:'NOT_REQUIRED',projectScoped:true}});
   specs.push(spec);bindings.push({...input,...w,workPackageId:spec.id,actionPlanId:action.id});
  }
  const plan=runtime.orchestrator.createPlan(actor,{goal:input.objective,idempotencyKey:input.idempotencyKey,projectId,workPackages:specs});
  const snapshot=runtime.machineryRuns.start(actor,{objective:input.objective,idempotencyKey:input.idempotencyKey,selections:[{orchestrationPlanId:plan.id,workPackageIds:specs.map(s=>s.id)}]});
  const graph={graphId:plan.id,machineryRunId:snapshot.runId,companyId,projectId,sourceMessageId:input.sourceMessageId,requestId,parentRunId:snapshot.runId,parentRoomId,authorizationRevision:input.authorizationRevision,generation:input.generation,revision:plan.revision};
  durableStore.registerGraph(graph,{authorityVerifier:registration,actor});
  const links=[];
  for(const b of bindings){
   b.graphId=plan.id;b.parentRunId=snapshot.runId;store.put('native-worker-bindings',{id:b.actionPlanId,...b},companyId);
   const preparedRequest=await runtime.executionLoop.prepareOrchestrationWork({tenantId:companyId,orchestrationPlanId:plan.id,workPackageId:b.workPackageId},actor.userId);
   const link={graphId:plan.id,parentRunId:snapshot.runId,childCompanyId:companyId,childRoomId:b.roomId,childRunId:preparedRequest.id,taskId:b.workPackageId,workPackageId:b.workPackageId,botId:b.botId,turnId:requestId,callId:'native-call:'+digest({graphId:plan.id,workPackageId:b.workPackageId}).slice(0,32),executionClass:'NATIVE_NONPRODUCTION'};
   durableStore.registerDelegationLink(link,{authorityVerifier:registration,actor});links.push(link);
  }
  const result={graph,links,machineryRunId:snapshot.runId};store.put('native-worker-dispatches',{id:'dispatch:'+key,fingerprint:digest(input),result},companyId);return result;
 }
 async function execute({actor,graphId}:any){
  const graph=durableStore.getGraph(graphId);if(!graph)fail('GRAPH_NOT_FOUND');
  const binding=store.list('native-worker-bindings',graph.company_id).find((b:any)=>b.graphId===graphId);
  if(!binding||await authorizeScope(actor,binding)!==true||actor.workspaceTenantId!==graph.company_id||actor.userId!==binding.actor.userId)fail('NATIVE_SCOPE_DENIED');
  const run=runtime.machineryRuns.getRun(actor,graph.machinery_run_id);
  for(let i=0;i<2;i++){const result=await runtime.machineryDriver.advance(actor,run.id,actor.userId);if(result.disposition==='UNCERTAIN')fail('NATIVE_EXECUTION_UNCERTAIN');}
  const outputs=[];
  for(const link of durableStore.listLinksForGraph(graphId)){
   const current=store.list('native-worker-bindings',graph.company_id).find((b:any)=>b.graphId===graphId&&b.workPackageId===link.task_id);
   if(!current||await authorizeScope(actor,current)!==true)fail('NATIVE_SCOPE_REVOKED');
   const output=await join.issue({actor,graph,link,workPackageId:link.task_id});
   const result=JSON.parse(readFileSync(output.artifactPath,'utf8'));
   if(result.nativeExecution?.executionClass!=='NATIVE_NONPRODUCTION'||result.provider!=='DETERMINISTIC_LOCAL'||result.modelCalls!==0||result.nativeExecution.workerSourceHash!==workerSourceHash)fail('NATIVE_OUTPUT_PROVENANCE_REQUIRED');
   durableStore.recordVerifiedArtifact({callId:link.call_id,artifactPath:output.artifactPath,expectedSha256:output.artifactDigest,executorReceipt:output.receipt});outputs.push({...output,result});
  }
  if(outputs.length!==2)fail('TWO_NATIVE_OUTPUTS_REQUIRED');
  const buildDir=path.join(realpathSync(artifactRootDir),'build-'+digest(graphId).slice(0,24));
  mkdirSync(buildDir,{recursive:true,mode:0o700});const files=[];
  for(const output of outputs){
   const allowed=output.result.worker.kind==='FRONTEND'?['frontend/App.jsx','frontend/api.mjs']:['backend/pets.mjs','backend/route.mjs'];
   for(const file of output.result.files){
    if(!allowed.includes(file.path)||typeof file.content!=='string')fail('NATIVE_GENERATED_FILE_PATH_DENIED');
    const target=path.join(buildDir,file.path);mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    try{writeFileSync(target,file.content,{flag:'wx',mode:0o600})}catch(e:any){if(e.code!=='EEXIST')throw e;}
    if(realpathSync(target)!==target||readFileSync(target,'utf8')!==file.content)fail('NATIVE_GENERATED_FILE_CONFLICT');
    files.push({path:target,sha256:createHash('sha256').update(file.content).digest('hex'),agencyReceiptId:output.provenance.agencyReceiptId,workerId:output.result.worker.botId});
   }
  }
  return {graphId,machineryRunId:run.id,buildDir,files,outputs,executionClass:'NATIVE_NONPRODUCTION',provider:'DETERMINISTIC_LOCAL',modelCalls:0};
 }
 async function stop({actor,graphId}:any){
  const graph=durableStore.getGraph(graphId);if(!graph)fail('GRAPH_NOT_FOUND');
  const binding=store.list('native-worker-bindings',graph.company_id).find((b:any)=>b.graphId===graphId);
  if(!binding||actor.userId!==binding.actor.userId||actor.workspaceTenantId!==graph.company_id||await authorizeScope(actor,binding)!==true)fail('NATIVE_SCOPE_DENIED');
  const canonical=runtime.machineryDriver.stop(actor,graph.machinery_run_id,'Explicit authenticated native Stop');
  const processOutcomes=[];
  for(const process of activeProcesses.values()){
   if(process.graphId!==graphId)continue;
   const currentStart=processStart(process.pid);
   if(currentStart===process.startTicks)process.child.kill('SIGTERM');
   const exited=await Promise.race([process.exited,new Promise(resolve=>setTimeout(()=>resolve(null),2000))]);
   const gone=processStart(process.pid)!==process.startTicks;
   processOutcomes.push({pid:process.pid,startTicks:process.startTicks,signalRequested:currentStart===process.startTicks?'SIGTERM':null,exit:exited,confirmedExited:!!exited&&gone});
  }
  const nativeStopped=runtime.machineryRuns.refresh(actor,graph.machinery_run_id).state==='STOPPED';
  const confirmedStopped=nativeStopped&&processOutcomes.every(p=>p.confirmedExited);
  if(confirmedStopped){
   for(const link of durableStore.listLinksForGraph(graphId))durableStore.markLinkStopStatus(link.call_id,true);
   durableStore.markParentStopStatus(graphId,true);
  }
  return {confirmedStopped,disposition:confirmedStopped?'TERMINAL':'STOP_PENDING',processOutcomes,canonicalState:canonical.snapshot.state,vmOrQuotaReleaseClaimed:false};
 }
 return {prepare,execute,stop,runtime,capabilityRuntime,registration,workerSourceHash,activeProcesses};
}
