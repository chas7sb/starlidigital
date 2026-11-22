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
const service=createNativeWorkerService(options);
for(const kind of ['frontend','backend']){
 const capabilityId='native.worker.draft.'+kind;
 service.capabilityRuntime.state.putTenantCapability({tenantId:companyId,capabilityId,enabled:true});
 service.capabilityRuntime.state.putProjectGrant({id:'component-grant-'+kind,tenantId:companyId,projectId,capabilityId,enabled:true,scopes:['customer:read'],createdAt:new Date().toISOString()});
}
const input={actor,companyId,projectId,requestId,sourceMessageId:'component-human-start',originalPromptMessageId:'component-original-intent',parentRunId:'component-parent-run',parentRoomId:'parent-room',authorizationRevision:1,generation:1,objective:'Build DogLove with React frontend and persistent Node API',idempotencyKey:'native-worker-service-test',workers:[{botId:'worker-frontend',roomId:'room-frontend',kind:'FRONTEND'},{botId:'worker-backend',roomId:'room-backend',kind:'BACKEND'}]};
const prepared=await service.prepare(input);
assert.deepEqual(await service.prepare(input),prepared);
await assert.rejects(service.prepare({...input,objective:'Different prompt'}),/NATIVE_IDEMPOTENCY_CONFLICT/);
await assert.rejects(service.execute({actor:{...actor,userId:'other'},graphId:prepared.graph.graphId}),/NATIVE_SCOPE_DENIED/);
const execution=await service.execute({actor,graphId:prepared.graph.graphId});
assert.equal(execution.outputs.length,2);
assert.equal(execution.modelCalls,0);
assert.equal(new Set(execution.outputs.map(x=>x.result.worker.pid)).size,2);
assert(execution.outputs.every(x=>x.result.worker.pid!==process.pid));
const nativeReceipts=execution.outputs.map(x=>service.runtime.agencyExecution.getReceipt(companyId,x.provenance.executionRequestId));
assert(nativeReceipts.every(x=>x.state==='SUCCEEDED'&&x.capabilityReceiptId&&x.capabilityResultHash));
const links=durableStore.listLinksForGraph(prepared.graph.graphId);assert(links.every(x=>x.server_provenance_verified===1));
const snapshot=service.runtime.machineryRuns.refresh(actor,prepared.machineryRunId);assert.equal(snapshot.state,'COMPLETED');
const replay=await service.execute({actor,graphId:prepared.graph.graphId});assert.deepEqual(replay.outputs.map(x=>x.result.worker.pid),execution.outputs.map(x=>x.result.worker.pid));
const scope=store.get('component-scope',requestId);scope.active=false;store.put('component-scope',scope,companyId);
await assert.rejects(service.execute({actor,graphId:prepared.graph.graphId}),/NATIVE_SCOPE_DENIED/);
writeFileSync(path.join(output,'execution.json'),JSON.stringify({executionClass:'NATIVE_NONPRODUCTION',scope:'ACTUAL_NATIVE_MACHINERY_AGENCY_DETERMINISTIC_WORKER_PROCESSES_WITH_COMPONENT_AUTHORITY',modelCalls:0,registeredOwnerClaimVerified:false,companyId,projectId,requestId,graphId:prepared.graph.graphId,machineryRunId:prepared.machineryRunId,twoActualNativeWorkerProcesses:true,checks:{distinctProcessIds:true,actualAgencyReceipts:true,persistedTrustedOutputs:true,idempotentReplayNoNewProcess:true,changedPromptDenied:true,foreignActorDenied:true,revokedScopeDenied:true},execution,progress:durableStore.buildAuthoritativeProgressEnvelope(prepared.graph.graphId)},null,2));
durableStore.close();store.close();console.log(JSON.stringify({pass:true,twoActualNativeWorkerProcesses:true,provider:'DETERMINISTIC_LOCAL',modelCalls:0}));
