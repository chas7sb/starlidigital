import {createInterface} from 'node:readline';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:net';
import {unlinkSync,chmodSync} from 'node:fs';
import {Store} from '../../../store.ts';
import {DurableOrchestrationStore} from '../../gemini1/orchestration-r6/durable-orchestration-stop.mjs';
import {TrustedExecutorReceiptIssuer} from '../../gemini1/orchestration-r6/executor-receipt-issuer.mjs';
import {createNativeWorkerService} from './native-worker-service.ts';
const inputLines=createInterface({input:process.stdin,crlfDelay:Infinity});
const lines=inputLines[Symbol.asyncIterator]();
const initial=JSON.parse((await lines.next()).value);
const root=path.resolve(initial.root);if(!root.startsWith('/tmp/grokbot1-w1-'))throw Error('DISPOSABLE_NATIVE_ROOT_REQUIRED');
mkdirSync(root,{recursive:true,mode:0o700});
const admission=initial.admission;
let authSerial=Promise.resolve();
function authorize(actor,scope){
 const result=authSerial.then(async()=>{
  process.stdout.write(JSON.stringify({kind:'authorize',candidate:{...scope,actor}})+'\n');
  const next=await lines.next();return !next.done&&JSON.parse(next.value).allow===true;
 });
 authSerial=result.catch(()=>false);return result;
}

if(!await authorize(admission.actor,admission))throw Error('NATIVE_SCOPE_DENIED');
const data=path.join(root,'native-worker-runtime');mkdirSync(data,{recursive:true,mode:0o700});
const keyPath=path.join(data,'.receipt-key');try{writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e;}
const key=readFileSync(keyPath);const store=new Store(path.join(data,'canonical.sqlite'));
const durableStore=new DurableOrchestrationStore(path.join(data,'graphs.sqlite'),{executorVerifyKey:key});
const artifactRootDir=path.join(data,'artifacts');mkdirSync(artifactRootDir,{recursive:true,mode:0o700});
const service=createNativeWorkerService({store,durableStore,receiptIssuer:new TrustedExecutorReceiptIssuer({signingKey:key,issuerId:'native-claim-worker/v1'}),artifactRootDir,
 authorizeScope:authorize,
 roomDirectory:{ownsRoom:(company,room)=>company===admission.companyId&&(room===admission.parentRoomId||admission.workers.some(w=>w.roomId===room))},
 resolveWorker:async(company,id)=>company===admission.companyId?admission.workers.find(w=>w.botId===id):null,workerControl:initial.workerControl??{}});
let controlServer:any=null,controlPaths:any=null,stopping:any=null;
try {
 if(initial.operation==='terminalInspect'){
  const graph=durableStore.getGraph(initial.graphId);
  if(!graph||graph.company_id!==admission.companyId||graph.project_id!==admission.projectId||graph.request_id!==admission.requestId||graph.source_message_id!==admission.sourceMessageId)throw Error('NATIVE_GRAPH_SCOPE_DENIED');
  const run=service.runtime.machineryRuns.getRun(admission.actor,graph.machinery_run_id);
  const snapshot=service.runtime.machineryRuns.refresh(admission.actor,run.id);
  const plan=service.runtime.orchestrator.getPlan(admission.actor,initial.graphId);
  const packages=plan.workPackages.map(pkg=>({pkg,request:service.runtime.agencyExecution.getRequest(admission.companyId,pkg.executionRequestId),receipt:service.runtime.agencyExecution.getReceipt(admission.companyId,pkg.executionRequestId)}));
  process.stdout.write(JSON.stringify({kind:'result',result:{graph,run,snapshot,plan,packages,links:durableStore.listLinksForGraph(initial.graphId)}})+'\n');
 } else if(initial.operation==='stopQueued'){
  const result=await service.stop({actor:admission.actor,graphId:initial.graphId});
  process.stdout.write(JSON.stringify({kind:'result',result})+'\n');
 } else if(initial.operation==='progress'){
  const graph=durableStore.getGraph(initial.graphId);
  if(!graph||graph.company_id!==admission.companyId||graph.request_id!==admission.requestId)throw Error('NATIVE_GRAPH_SCOPE_DENIED');
  service.runtime.machineryRuns.getRun(admission.actor,graph.machinery_run_id);
  const progress=durableStore.buildAuthoritativeProgressEnvelope(initial.graphId);
  process.stdout.write(JSON.stringify({kind:'result',result:{ok:true,graphId:initial.graphId,machineryRunId:graph.machinery_run_id,graphState:graph.graph_state,expectedContext:progress.expectedContext,items:progress.items,stopState:null,computeStopHandoff:null}})+'\n');
 } else {
 // This role adapter is invoked only after the host freshly authorized bots.run for
 // the actual current native owner. These are scoped internal capability grants.
 if(!await authorize(admission.actor,{...admission,operation:'configure-native-worker-grants'}))throw Error('NATIVE_GRANT_AUTHORITY_DENIED');
 for(const kind of ['frontend','backend']){
  const capabilityId='native.worker.draft.'+kind;
  service.capabilityRuntime.state.putTenantCapability({tenantId:admission.companyId,capabilityId,enabled:true});
  service.capabilityRuntime.state.putProjectGrant({id:'native-grant:'+admission.companyId+':'+admission.projectId+':'+kind,tenantId:admission.companyId,projectId:admission.projectId,capabilityId,enabled:true,scopes:['customer:read'],createdAt:new Date().toISOString()});
 }
 const prepared=await service.prepare(admission);
 if(initial.operation==='prepare'){
  process.stdout.write(JSON.stringify({kind:'result',result:prepared})+'\n');
 } else {
 const graphId=prepared.graph.graphId;
 const controlDir=path.join(root,'worker-controls');mkdirSync(controlDir,{recursive:true,mode:0o700});
 const label=createHash('sha256').update(graphId).digest('hex').slice(0,20);
 const socketPath=path.join(controlDir,label+'.sock'),noncePath=path.join(controlDir,label+'.cap');
 const nonce=randomBytes(32).toString('hex');writeFileSync(noncePath,nonce,{flag:'wx',mode:0o600});
 const stat=readFileSync('/proc/'+process.pid+'/stat','utf8');const startTicks=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
 controlPaths={socketPath,noncePath,graphId};
 controlServer=createServer(socket=>{
  let text='';socket.setTimeout(6000,()=>socket.destroy());
  socket.on('data',async chunk=>{
   text+=chunk.toString();if(Buffer.byteLength(text)>4096){socket.destroy();return;}
   if(!text.includes('\n'))return;
   socket.pause();
   try{
    const request=JSON.parse(text.slice(0,text.indexOf('\n')));
    const supplied=Buffer.from(String(request.nonce||''));
    if(request.graphId!==graphId||supplied.length!==nonce.length||!timingSafeEqual(supplied,Buffer.from(nonce)))throw Error('CONTROL_AUTH_DENIED');
    if(request.action==='inspect'){
     socket.end(JSON.stringify({activeProcesses:[...service.activeProcesses.values()].map(p=>({pid:p.pid,startTicks:p.startTicks,workPackageId:p.workPackageId}))})+'\n');return;
    }
    if(request.action!=='stop')throw Error('CONTROL_ACTION_DENIED');
    stopping??=service.stop({actor:admission.actor,graphId});
    const result=await stopping;
    socket.end(JSON.stringify(result)+'\n');
   }catch{socket.end(JSON.stringify({confirmedStopped:false,disposition:'STOP_PENDING',error:'CONTROL_REQUEST_DENIED'})+'\n');}
  });
 });
 await new Promise<void>((resolve,reject)=>{controlServer.once('error',reject);controlServer.listen(socketPath,()=>{chmodSync(socketPath,0o600);resolve();});});
 store.put('native-live-controls',{id:graphId,companyId:admission.companyId,requestId:admission.requestId,ownerId:admission.actor.userId,socketPath,noncePath,nonceHash:createHash('sha256').update(nonce).digest('hex'),nodePid:process.pid,startTicks,phase:'LIVE'},admission.companyId);
 let result:any;
 try{result=await service.execute({actor:admission.actor,graphId});}
 catch(error){
  const stop=stopping?await stopping:null;
  if(!stop?.confirmedStopped)throw error;
  result={stopped:true,graphId,machineryRunId:prepared.machineryRunId,outputs:[],provider:'DETERMINISTIC_LOCAL',modelCalls:0,stop};
 }

 if(!await authorize(admission.actor,admission))throw Error('NATIVE_SCOPE_REVOKED');
 writeFileSync(path.join(data,'execution-'+result.graphId.replace(/[^a-zA-Z0-9]/g,'_')+'.json'),JSON.stringify(result,null,2),{mode:0o600});
 process.stdout.write(JSON.stringify({kind:'result',result})+'\n');
 }
 }
} finally {
 if(controlPaths){
  const record=store.get('native-live-controls',controlPaths.graphId);if(record)store.put('native-live-controls',{...record,phase:'CLOSED'},admission.companyId);
  if(controlServer)await new Promise<void>(resolve=>controlServer.close(()=>resolve()));
  for(const file of [controlPaths.socketPath,controlPaths.noncePath])try{unlinkSync(file)}catch{}
 }
 durableStore.close();store.close();inputLines.close();process.stdin.pause();
}
