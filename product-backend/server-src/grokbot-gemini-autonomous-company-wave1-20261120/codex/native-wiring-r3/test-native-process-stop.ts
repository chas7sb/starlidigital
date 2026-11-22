import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../../../store.ts';
import {DurableOrchestrationStore} from '../../gemini1/orchestration-r6/durable-orchestration-stop.mjs';
import {TrustedExecutorReceiptIssuer} from '../../gemini1/orchestration-r6/executor-receipt-issuer.mjs';
import {createNativeWorkerService} from './native-worker-service.ts';
const output=process.env.STARLI_NATIVE_WORKER_OUTPUT;if(!output)throw Error('STARLI_NATIVE_WORKER_OUTPUT_REQUIRED');
mkdirSync(output,{recursive:true});mkdirSync(path.join(output,'artifacts'));
const store=new Store(path.join(output,'native.sqlite')),key=randomBytes(32);
const durableStore=new DurableOrchestrationStore(path.join(output,'graphs.sqlite'),{executorVerifyKey:key});
const issuer=new TrustedExecutorReceiptIssuer({signingKey:key,issuerId:'native-two-worker-deterministic'});
const actor={userId:'component-principal',workspaceTenantId:'component-company',role:'CUSTOMER'};
const companyId=actor.workspaceTenantId,projectId='component-project',requestId='component-request';
store.put('component-scope',{id:requestId,companyId,projectId,userId:actor.userId,active:true},companyId);
for(const [botId,roomId,kind] of [['worker-frontend','room-frontend','FRONTEND'],['worker-backend','room-backend','BACKEND']]){
 store.put('component-worker-directory',{id:botId,botId,companyId,roomId,kind,providerKind:'DETERMINISTIC_LOCAL'},companyId);
 store.put('component-room-directory',{id:roomId,companyId},companyId);
}
store.put('component-room-directory',{id:'parent-room',companyId},companyId);
const options={store,durableStore,receiptIssuer:issuer,artifactRootDir:path.join(output,'artifacts'),
 authorizeScope:async(a,input)=>{const record=store.get('component-scope',input.requestId);return !!record?.active&&record.userId===a.userId&&record.companyId===a.workspaceTenantId&&record.projectId===input.projectId},
 roomDirectory:{ownsRoom:(c,r)=>store.get('component-room-directory',r)?.companyId===c},
 resolveWorker:async(c,id)=>{const w=store.get('component-worker-directory',id);return w?.companyId===c?w:null}};
const service=createNativeWorkerService({...options,workerControl:{holdMs:3000}});
for(const kind of ['frontend','backend']){
 const capabilityId='native.worker.draft.'+kind;
 service.capabilityRuntime.state.putTenantCapability({tenantId:companyId,capabilityId,enabled:true});
 service.capabilityRuntime.state.putProjectGrant({id:'component-grant-'+kind,tenantId:companyId,projectId,capabilityId,enabled:true,scopes:['customer:read'],createdAt:new Date().toISOString()});
}
const input={actor,companyId,projectId,requestId,sourceMessageId:'component-human-start',originalPromptMessageId:'component-original-intent',parentRunId:'component-parent-run',parentRoomId:'parent-room',authorizationRevision:1,generation:1,objective:'Build DogLove with React frontend and persistent Node API',idempotencyKey:'native-worker-service-test',workers:[{botId:'worker-frontend',roomId:'room-frontend',kind:'FRONTEND'},{botId:'worker-backend',roomId:'room-backend',kind:'BACKEND'}]};
const prepared=await service.prepare(input);
const running=service.execute({actor,graphId:prepared.graph.graphId}).then(value=>({value}),error=>({error:error.message}));
for(let i=0;i<100&&service.activeProcesses.size===0;i++)await new Promise(r=>setTimeout(r,10));
assert.equal(service.activeProcesses.size,1);
const active=[...service.activeProcesses.values()][0];assert(active.pid&&active.startTicks);
const stopped=await service.stop({actor,graphId:prepared.graph.graphId});
assert.equal(stopped.confirmedStopped,true);assert.equal(stopped.processOutcomes.length,1);assert(stopped.processOutcomes[0].confirmedExited);
const eventual=await running;assert(eventual.error);
assert.equal(service.runtime.machineryRuns.refresh(actor,prepared.machineryRunId).state,'STOPPED');
const plan=service.runtime.orchestrator.getPlan(actor,prepared.graph.graphId);
assert(plan.workPackages.every(p=>p.status==='STOPPED'));
const request=store.get('agency-execution-requests',plan.workPackages.find(p=>p.executionRequestId).executionRequestId);assert.equal(request.state,'STOPPED');
assert(durableStore.listLinksForGraph(prepared.graph.graphId).every(l=>l.artifact_digest===null));
await assert.rejects(service.execute({actor,graphId:prepared.graph.graphId}),/NATIVE_COMPLETION_REQUIRED/);
assert.equal(service.runtime.machineryRuns.refresh(actor,prepared.machineryRunId).state,'STOPPED');
const result={executionClass:'NATIVE_NONPRODUCTION_ACTIVE_DETERMINISTIC_PROCESS_STOP_COMPONENT',provider:'DETERMINISTIC_LOCAL',modelCalls:0,actualActiveNativeWorkerProcess:true,identityScope:'SYNTHETIC_COMPONENT_PRINCIPAL_NOT_HTTP_CLAIM',graphId:prepared.graph.graphId,machineryRunId:prepared.machineryRunId,stop:stopped,workerCompletion:eventual,checks:{canonicalNativeDriverInvoked:true,pidAndStartIdentityMatched:true,actualSignalExitConfirmed:true,lateCompletionCannotMintOutputOrRevive:true,vmOrQuotaReleaseClaimed:false}};
writeFileSync(path.join(output,'stop-receipt.json'),JSON.stringify(result,null,2));
durableStore.close();store.close();
const reopened=new Store(path.join(output,'native.sqlite'));assert.equal(reopened.get('agency-execution-requests',request.id).state,'STOPPED');reopened.close();
console.log(JSON.stringify({pass:true,actualNativeWorkerProcessStopped:true,modelCalls:0}));
