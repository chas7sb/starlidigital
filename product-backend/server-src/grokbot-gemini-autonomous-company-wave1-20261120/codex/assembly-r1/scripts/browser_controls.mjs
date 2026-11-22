
import {readFileSync,writeFileSync,lstatSync,mkdirSync,existsSync,readdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {serverSnapshot,processIdentity,auditPersistedStorage} from './server_snapshot.mjs';
const fail=c=>{throw Error(c)};
function privateJson(file){const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==997||(s.mode&0o077))fail('PRIVATE_FILE_REQUIRED');return JSON.parse(readFileSync(file));}
const config=privateJson(process.argv[2]);let raw='';for await(const b of process.stdin)raw+=b;const input=JSON.parse(raw);
const obs=privateJson(process.env.STARLI_BROWSER_OBSERVATIONS_FILE),caps=privateJson(process.env.STARLI_BROWSER_SESSION_CAPABILITIES_FILE);
if(obs.runId!==caps.runId||obs.producer?.kind!=='ACTUAL_CDP_NETWORK_AND_COOKIE_STORE'||caps.producer?.kind!==obs.producer.kind)fail('BROWSER_RUN_BINDING_REQUIRED');
const label=input.tenant,t=caps.tenants?.[label],o=obs.tenants?.[label];
if(!t?.native?.token||!o?.auth?.sessionCapabilityAvailable||t.native.source!=='ACTUAL_BROWSER_NATIVE_AUTH_RESPONSE_AND_VERIFIED_SESSION'||t.native.subjectId!==o.auth.subjectId||t.nativeOrigin!==o.nativeOrigin||t.label!==label||o.observerError)fail('NOT_READY');
const intent=t.intentId||t.claim?.intentId;if(!intent)fail('NATIVE_CLAIM_REQUIRED');
const cacheDir=join(config.auditRoot,obs.runId);mkdirSync(cacheDir,{recursive:true,mode:0o700});
const cacheFile=join(cacheDir,label+'.json');const cache=existsSync(cacheFile)?privateJson(cacheFile):{};
function save(value){writeFileSync(cacheFile,JSON.stringify(value),{mode:0o600});}
async function current(){const r=await fetch(t.nativeOrigin+'/api/v1/auths/',{headers:{Authorization:'Bearer '+t.native.token}});if(!r.ok)fail('CURRENT_NATIVE_AUTH_REQUIRED');const u=await r.json();if(u.id!==t.native.subjectId)fail('NATIVE_SUBJECT_MISMATCH');}
async function lifecycle(action){await current();const r=await fetch(t.nativeOrigin+'/api/v1/starli/grokbot1/claims/'+encodeURIComponent(intent)+'/preview'+(action==='open'?'':'/'+action),{method:'POST',headers:{Authorization:'Bearer '+t.native.token,Origin:t.nativeOrigin,'Content-Type':'application/json'},body:'{}'});if(r.status===202)fail('LIFECYCLE_OPERATION_PENDING');if(!r.ok)fail('LIFECYCLE_'+r.status);return r.json();}

async function directControllerRestart(){
 await current();
 const supervisor=privateJson(process.env.STARLI_JOINED_SUPERVISOR_CONFIG||config.controllerSupervisorConfig);
 const service=supervisor.services.preview;
 const origin=new URL(service.origin);
 if(origin.protocol!=='http:'||!['127.0.0.1','localhost'].includes(origin.hostname))fail('PRIVATE_CONTROLLER_REQUIRED');
 const currentPin=privateJson(join(process.env.STARLI_JOINED_OUTPUT,'private/service-preview.json'));
 const health=await fetch(origin.origin+'/instance',{signal:AbortSignal.timeout(5000)});
 const identity=await health.json();
 if(!health.ok||identity.pid!==currentPin.pid||identity.instanceNonce!==currentPin.instanceNonce)fail('CONTROLLER_INSTANCE_MISMATCH');
 const controllerConfig=privateJson(service.argv.at(-1));
 if(controllerConfig.nativeRoot!==config.nativeRoot)fail('CONTROLLER_NATIVE_ROOT_MISMATCH');
 const response=await fetch(origin.origin+'/internal/v1/preview/restart',{method:'POST',headers:{'Content-Type':'application/json','X-Starli-Preview-Key':service.env.STARLI_PREVIEW_CONTROL_KEY},body:JSON.stringify({intentId:intent,nativeJwt:t.native.token}),signal:AbortSignal.timeout(60000)});
 if(response.status!==200)fail('DIRECT_COORDINATOR_RESTART_'+response.status);
 return response.json();
}
function activeRecord(chain){
 const root=realpathSync(config.previewStateRoot),matches=[];
 for(const name of readdirSync(root)){
  const dir=join(root,name),marker=join(dir,'lifecycle.json');
  if(!existsSync(marker))continue;
  const stat=lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())continue;
  const state=privateJson(marker);
  if(state.status==='ACTIVE'&&state.companyId===chain.companyId&&state.projectId===chain.projectId&&state.graphId===chain.graphId)matches.push({dir,state});
 }
 if(matches.length!==1)fail('EXACT_ACTIVE_LIFECYCLE_RECORD_REQUIRED');
 const found=matches[0],processFile=privateJson(join(found.dir,'app-process.json'));
 return {...found,ready:processFile.ready,runtime:privateJson(join(found.dir,'app-runtime.json'))};
}

const base={operation:input.operation,tenant:label};
if(input.operation==='snapshot'){
 let snapshot;
 try{snapshot=await serverSnapshot({...config,nativeJwt:t.native.token,intentId:intent,nativeOrigin:t.nativeOrigin});cache.snapshot=snapshot;save(cache);}
 catch(e){if(!cache.snapshot||cache.revocationRecorded!==true)throw e;snapshot={...cache.snapshot,authorityScope:'HISTORICAL_VERIFIED_CHAIN_CURRENT_ACCESS_NOT_ASSERTED'};}
 const scope=snapshot.chain;const storage=auditPersistedStorage({dataRoot:config.dataRoot,...scope,baseline:cache.beforeRevoke});
 const origin=t.currentAppOrigin;const bo=o.appOrigins?.[origin];const write=bo?.lastWrite;
 const cookie=bo?.cookie;
 console.log(JSON.stringify({...base,...snapshot,records:storage.records,unauthorizedWriteDelta:storage.unauthorizedWriteDelta,recordsUnchanged:storage.recordsUnchanged,storageAudit:storage,...(cookie?{appSessionCookie:{httpOnly:cookie.httpOnly}}:{}),...(bo?.lastBootstrap?{bootstrapPlatformAuthorizationPresent:bo.lastBootstrap.platformAuthorizationPresent}:{}),...(write?{lastBrowserWriteStatus:write.status,browserSave:{csrfHeader:write.csrfHeaderPresent?'x-csrf-token':null,status:write.status,chainId:scope.requestId}}:{}),claimAttempts:o.claimAttempts||[]}));
}else if(input.operation==='buildPin'){
 const snapshot=await serverSnapshot({...config,nativeJwt:t.native.token,intentId:intent,nativeOrigin:t.nativeOrigin});
 const root=realpathSync(config.previewStateRoot),matches=[];
 for(const name of readdirSync(root)){
  const dir=join(root,name),marker=join(dir,'lifecycle.json');
  if(!existsSync(marker))continue;
  const stat=lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())continue;
  const state=privateJson(marker);
  if(state.status==='ACTIVE'&&state.companyId===snapshot.chain.companyId&&state.projectId===snapshot.chain.projectId&&state.graphId===snapshot.chain.graphId)matches.push({dir,state});
 }
 if(matches.length!==1)fail('EXACT_ACTIVE_LIFECYCLE_RECORD_REQUIRED');
 const {dir,state}=matches[0];
 const runtime=privateJson(join(dir,'app-runtime.json'));
 const receiptPath=join(runtime.build,'APP_BUILD_RECEIPT.json'),receipt=JSON.parse(readFileSync(receiptPath));
 for(const key of ['companyId','projectId','requestId','graphId'])if(receipt.binding[key]!==snapshot.chain[key])fail('ACTUAL_BUILD_BINDING_MISMATCH');
 if(receipt.artifactDigest!==state.artifactDigest||!processIdentity(state.appPid))fail('CURRENT_BOUND_APP_REQUIRED');
 const executionPath=join(config.nativeRoot,'native-worker-runtime','execution-'+snapshot.chain.graphId.replace(/[^a-zA-Z0-9]/g,'_')+'.json');
 console.log(JSON.stringify({...base,buildRoot:runtime.build,manifestPath:receiptPath,manifestSha256:createHash('sha256').update(readFileSync(receiptPath)).digest('hex'),executionRecordPath:executionPath,executionRecordSha256:createHash('sha256').update(readFileSync(executionPath)).digest('hex'),collector:'READ_ONLY_CANONICAL_AND_LIFECYCLE_METADATA'}));
}else if(input.operation==='restart'){
 const snapshot=await serverSnapshot({...config,nativeJwt:t.native.token,intentId:intent,nativeOrigin:t.nativeOrigin});
 const beforeRecord=activeRecord(snapshot.chain),old=processIdentity(beforeRecord.ready.pid);
 if(!old)fail('ACTUAL_APP_PROCESS_REQUIRED');
 const storageBefore=auditPersistedStorage({dataRoot:config.dataRoot,...snapshot.chain});
 const result=await directControllerRestart();
 if(!Number.isInteger(result.appPid)||typeof result.previewUrl!=='string')fail('RESTART_DTO_NOT_READY');
 const afterRecord=activeRecord(snapshot.chain),now=processIdentity(result.appPid);
 if(afterRecord.ready.pid!==result.appPid||!now)fail('RESTART_PROCESS_BINDING_REQUIRED');
 const storage=auditPersistedStorage({dataRoot:config.dataRoot,...snapshot.chain});
 const health=await fetch(result.previewUrl+'/');
 const healthStatus=health.status;await health.arrayBuffer();
 console.log(JSON.stringify({...base,oldProcess:old,newProcess:now,oldProcessGone:!processIdentity(old.pid),storageIdBefore:storageBefore.storageId,storageIdAfter:storage.storageId,healthStatus,healthUrl:result.previewUrl+'/',controlScope:'COORDINATOR_INDEPENDENT_APP_PROCESS_RESTART_NOT_BROWSER_UI_RESTART'}));
}else if(input.operation==='revoke'){
 await current();if(!cache.snapshot)fail('PRE_REVOKE_CANONICAL_SNAPSHOT_REQUIRED');
 const c=cache.snapshot.chain;cache.beforeRevoke=auditPersistedStorage({dataRoot:config.dataRoot,...c});save(cache);
 const nativeStat=lstatSync(config.nativeRoot);
 if(!config.nativeRoot.startsWith('/tmp/grokbot1-w1-')||nativeStat.isSymbolicLink()||!nativeStat.isDirectory()||nativeStat.uid!==997)fail('DISPOSABLE_NATIVE_ROOT_REQUIRED');
 const instanceResponse=await fetch(t.nativeOrigin+'/staging/instance');
 if(!instanceResponse.ok)fail('CURRENT_NATIVE_INSTANCE_REQUIRED');
 const instance=await instanceResponse.json();
 const instancePin=privateJson(config.nativeInstancePin||join(process.env.STARLI_JOINED_OUTPUT,'private/service-native.json'));
 if(instance.instanceNonce!==instancePin.instanceNonce||instance.pid!==instancePin.pid)fail('NATIVE_INSTANCE_MISMATCH');
 const db=new DatabaseSync(join(config.nativeRoot,'data/company-authority.sqlite3'));
 try{const result=db.prepare("UPDATE members SET active=0,revision=revision+1 WHERE company_id=? AND user_id=? AND kind='person' AND active=1").run(c.companyId,t.native.subjectId);if(Number(result.changes)!==1)fail('EXACT_NATIVE_MEMBER_REQUIRED');}finally{db.close();}
 cache.revocationRecorded=true;save(cache);
 console.log(JSON.stringify({...base,chainId:c.requestId,authorityState:'REVOKED',instrumentation:'ACTUAL_DISPOSABLE_NATIVE_MEMBERSHIP_REVOCATION'}));

}else if(input.operation==='crossTenant'){
 await current();
 const foreign=caps.tenants?.[input.sourceTenant];if(!foreign?.currentAppOrigin||!t.currentAppOrigin)fail('NOT_READY');
 const own=t.appOrigins?.[t.currentAppOrigin];if(!own?.cookie?.value||!own.csrfToken||own.cookie.source!=='CDP_NETWORK_GET_COOKIES')fail('NOT_READY');
 const foreignCache=privateJson(join(cacheDir,input.sourceTenant+'.json'));if(!foreignCache.snapshot)fail('FOREIGN_CANONICAL_SNAPSHOT_REQUIRED');
 const before=auditPersistedStorage({dataRoot:config.dataRoot,...foreignCache.snapshot.chain});
 const cookie=own.cookie.name+'='+own.cookie.value;
 const ownRead=await fetch(t.currentAppOrigin+'/api/pets',{headers:{Cookie:cookie}});
 const ownWrite=await fetch(t.currentAppOrigin+'/api/pets',{method:'POST',headers:{Cookie:cookie,Origin:t.currentAppOrigin,'Content-Type':'application/json','x-csrf-token':own.csrfToken},body:JSON.stringify({name:'Own tenant isolation check'})});
 const foreignRead=await fetch(foreign.currentAppOrigin+'/api/pets',{headers:{Cookie:cookie}});
 const foreignWrite=await fetch(foreign.currentAppOrigin+'/api/pets',{method:'POST',headers:{Cookie:cookie,Origin:foreign.currentAppOrigin,'Content-Type':'application/json','x-csrf-token':own.csrfToken},body:JSON.stringify({name:'Must never persist'})});
 const after=auditPersistedStorage({dataRoot:config.dataRoot,...foreignCache.snapshot.chain,baseline:before});
 console.log(JSON.stringify({...base,ownReadStatus:ownRead.status,ownWriteStatus:ownWrite.status,foreignReadStatus:foreignRead.status,foreignWriteStatus:foreignWrite.status,foreignRecordDisclosed:foreignRead.status===200,unauthorizedWriteDelta:after.unauthorizedWriteDelta,recordsUnchanged:after.recordsUnchanged}));
}else fail('CONTROL_NOT_IMPLEMENTED');

