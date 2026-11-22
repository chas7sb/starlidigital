import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnScopedProcess,stopScopedProcess} from './process-group.mjs';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {createAsyncNativeVerifier} from './async-context.mjs';
const fail=c=>{throw Object.assign(new Error(c),{code:c})};
const sha=x=>createHash('sha256').update(x).digest('hex');
function atomic(file,data){const temp=file+'.'+process.pid+'.tmp';writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600});renameSync(temp,file);}
async function startProcess(script,args,env,logFile){
 const managed=spawnScopedProcess(script,args,env),child=managed.child;let out='',err='';
 let ready;try{ready=await new Promise((yes,no)=>{
  const timeout=setTimeout(()=>{child.kill('SIGTERM');no(Error('PREVIEW_PROCESS_START_TIMEOUT'));},20000);
  child.stdout.on('data',b=>{out+=b;if(out.length>65536){child.kill();clearTimeout(timeout);no(Error('PREVIEW_PROCESS_OUTPUT_LIMIT'));return;}try{const value=JSON.parse(out.trim().split('\n')[0]);if(value.ready){clearTimeout(timeout);yes(value);}}catch{}});
  child.stderr.on('data',b=>{err=(err+b).slice(-8192);});child.once('exit',()=>{clearTimeout(timeout);if(!out.trim())no(Error('PREVIEW_PROCESS_START_FAILED'));});child.once('error',e=>{clearTimeout(timeout);no(e);});
 });}catch(e){await stopScopedProcess(managed);throw e;}
 writeFileSync(logFile,JSON.stringify({pid:child.pid,ready,diagnostic:'Private process diagnostics withheld from client'}),{mode:0o600});
 const uid=Number(readFileSync('/proc/'+child.pid+'/status','utf8').match(/^Uid:\s+(\d+)/m)?.[1]);if(!uid||uid!==process.getuid()){await stopScopedProcess(managed);fail('UNPRIVILEGED_APP_UID_MISMATCH');}return {...managed,ready:{...ready,uid,heapLimitMiB:256,cgroupLimitApplied:false}};
}
const terminate=stopScopedProcess;
export function createPreviewLifecycle(config){
 if(typeof process.getuid!=='function'||process.getuid()===0)fail('UNPRIVILEGED_PREVIEW_CONTROLLER_REQUIRED');
 const {nativeRoot,stateRoot,authorityPackage,orchestrationPackage,appAdapter,approvedParentOrigin,resolveVerifiedBuild}=config;
 if(typeof resolveVerifiedBuild!=='function')fail('SERVER_VERIFIED_BUILD_RESOLVER_REQUIRED');
 if(new URL(approvedParentOrigin).origin!==approvedParentOrigin)fail('EXACT_PARENT_ORIGIN_REQUIRED');
 mkdirSync(stateRoot,{recursive:true,mode:0o700});
 const instances=new Map(),locks=new Map();
 const asyncVerifier=createAsyncNativeVerifier({nativeRoot,authorityPackage,orchestrationPackage});
 const load=n=>import(pathToFileURL(join(authorityPackage,'server',n+'.ts')).href);
 const runLocked=(id,fn)=>{if(locks.has(id))fail('PREVIEW_OPERATION_IN_PROGRESS');const p=Promise.resolve().then(fn).finally(()=>locks.delete(id));locks.set(id,p);return p;};
 const context=({intentId,nativeJwt},allowStoppedGraph=false)=>asyncVerifier.context({intentId,nativeJwt,allowStoppedGraph});
 function publicRecord(i){return {previewId:i.id,intentId:i.context.intentId,companyId:i.context.companyId,projectId:i.context.projectId,requestId:i.context.requestId,graphId:i.context.graphId,sourceMessageId:i.context.sourceMessageId,originalPromptMessageId:i.context.originalPromptMessageId,roomId:i.context.roomId,taskIds:i.context.taskIds,leaseId:i.leaseId,generation:i.context.generation,artifactDigest:i.build.receipt.artifactDigest,buildFingerprint:i.build.receipt.buildFingerprint,buildRevision:i.build.receipt.buildRevision,previewUrl:i.app.ready.baseUrl,appPid:i.app.child.pid,authorityPid:i.host.child.pid,appUid:i.app.ready.uid,authorityUid:i.host.ready.uid,storageIsolationScope:'APPLICATION_TENANT_DATABASE',osSandboxVerified:false,servingMemoryEnforced:false,servingMemory:{nodeHeapLimitMiB:256,cgroupLimitApplied:false},status:'PRIVATE_PROCESS_READY',previewReady:false,executionClass:'NATIVE_NONPRODUCTION',provider:i.context.provider,modelCalls:i.context.modelCalls};}
 async function observedFetch(phase,url,options={}){const started=Date.now();try{return await fetch(url,{...options,signal:AbortSignal.timeout(5000)});}catch(e){if(e?.name==='TimeoutError'||e?.code===23){const code=phase+'_FETCH_TIMEOUT';console.error(JSON.stringify({event:'PREVIEW_PROBE_FAILED',phase,code,durationMs:Date.now()-started}));throw Object.assign(Error(code),{code,phase,durationMs:Date.now()-started});}throw e;}}
 async function healthy(i){
  const base=i.app.ready.baseUrl;const h=await observedFetch('HEALTH',base+'/api/v1/app/health');if(h.status!==200)fail('APP_HEALTH_FAILED');const body=await h.json();
  for(const [k,v] of Object.entries({artifactDigest:i.build.receipt.artifactDigest,leaseId:i.leaseId,startGeneration:i.context.generation}))if(body[k]!==v)fail('APP_HEALTH_BINDING_MISMATCH');
  const html=await observedFetch('HTML',base+'/',{headers:{Referer:approvedParentOrigin+'/'}});if(html.status!==200)fail('APP_HTML_FAILED');
  const htmlText=await html.text();const match=htmlText.match(/src=["']([^"']+\.js)["']/);if(!match)fail('APP_JS_REFERENCE_REQUIRED');const script=new URL(match[1],base);if(script.origin!==base)fail('APP_JS_ORIGIN_DENIED');
  const js=await observedFetch('JS',script,{headers:{Referer:base+'/'}});if(js.status!==200)fail('APP_JS_FAILED');
  const receipt={schemaVersion:1,status:'AUTHORIZED_HEALTHY_PREVIEW',previewId:i.id,companyId:i.context.companyId,projectId:i.context.projectId,requestId:i.context.requestId,graphId:i.context.graphId,revision:i.build.receipt.buildRevision,audience:'PRIVATE_SCOPED',storageIsolationScope:'APPLICATION_TENANT_DATABASE',osSandboxVerified:false,servingMemoryEnforced:false,leaseId:i.leaseId,generation:i.context.generation,artifactDigest:i.build.receipt.artifactDigest,checks:{html200:true,js200:true,apiPostReadback:false,restartPersistence:false,browserExecuted:false}};
  const signature=createHmac('sha256',i.masterKey).update(JSON.stringify(receipt)).digest('hex');
  return {receipt,receiptSignature:signature,receiptSignatureValid:createHmac('sha256',i.masterKey).update(JSON.stringify(receipt)).digest('hex')===signature,expectedProjectId:i.context.projectId,authorizedPreviewId:i.id,expectedRevision:i.build.receipt.buildRevision,isolatedStorageAttested:true,storageIsolationScope:'APPLICATION_TENANT_DATABASE',osSandboxVerified:false,servingMemoryEnforced:false,authorityState:'USABLE',previewOrigin:base,parentOrigin:approvedParentOrigin,trustedFrameUrl:base+'/',allowStagingLoopback:true,statusMessage:'Private app is running; full browser acceptance remains pending.'};
 }
 async function issue(i,nativeJwt){
  const {PortableAppAuthority}=await load('portable-authority');
  const v=await asyncVerifier.nativeJwt(i.context.companyId,nativeJwt);if(v.nativeUserId!==i.context.subjectId||v.role!=='owner'||v.membershipRevision!==i.context.authorizationRevision)fail('CURRENT_NATIVE_OWNER_REQUIRED');
  const a=PortableAppAuthority.open({stateDir:i.stateDir,masterKey:i.masterKey});try{const now=Date.now();const issued=a.issueTicket({companyId:i.context.companyId,projectId:i.context.projectId,userId:v.nativeUserId,role:v.role,scope:v.scope,leaseId:i.leaseId,processGeneration:i.context.generation,artifactDigest:i.build.receipt.artifactDigest,authorityRevision:v.membershipRevision,nativeTokenHash:v.nativeTokenHash,nativeFamilyHash:v.nativeFamilyHash,nativeExp:v.nativeExp,issuedAt:now,expiresAt:Math.min(now+120000,v.nativeExp?v.nativeExp*1000:Infinity)});const verified=a.verifyTicket(issued.ticket,{companyId:i.context.companyId,projectId:i.context.projectId,leaseId:i.leaseId,processGeneration:i.context.generation,artifactDigest:i.build.receipt.artifactDigest});if(!verified.ok)fail('NATIVE_TICKET_VERIFICATION_FAILED');return issued.ticket;}finally{a.close();}
 }
 async function startApp(i){i.app=await startProcess(appAdapter,['--config',i.runtimeConfig],{STARLI_APP_AUTHORITY_KEY:i.appKey},join(i.dir,'app-process.json'));}
 async function open(input){const c=await context(input);return runLocked(c.intentId,async()=>{
  const id=sha([c.companyId,c.projectId,c.graphId,c.executionDigest].join('\0'));
  let i=instances.get(id);if(i){if(i.app.child.exitCode!==null||i.app.child.signalCode!==null)fail('PREVIEW_PROCESS_EXITED_RESTART_REQUIRED');return {...publicRecord(i),...(await healthy(i)),ticketValidatedByNativeServer:true,bootstrapTicket:await issue(i,input.nativeJwt)};}
  const dir=join(resolve(stateRoot),id);mkdirSync(dir,{recursive:true,mode:0o700});const marker=join(dir,'lifecycle.json');
  if(existsSync(marker)){const old=JSON.parse(readFileSync(marker));if(old.status==='ACTIVE')fail('PREVIOUS_PREVIEW_PROCESS_INSPECT_REQUIRED');}
  const {loadVerifiedBuild}=await load('app-server');
  const buildPath=await resolveVerifiedBuild(c,{outputDir:join(dir,'build')});const build=loadVerifiedBuild(buildPath);
  for(const k of ['companyId','projectId','requestId','graphId'])if(build.spec.binding[k]!==c[k])fail('VERIFIED_BUILD_BINDING_MISMATCH_'+k);
  if(!c.taskIds.includes(build.spec.binding.taskId)||!Array.isArray(build.spec.binding.taskIds)||c.taskIds.some(t=>!build.spec.binding.taskIds.includes(t)))fail('VERIFIED_BUILD_TASK_BINDING_MISMATCH');
  const stateDir=join(dir,'authority');mkdirSync(stateDir,{recursive:true,mode:0o700});
  const secretsPath=join(dir,'host-secrets.json');let secrets;
  if(existsSync(secretsPath))secrets=JSON.parse(readFileSync(secretsPath));else{secrets={masterKey:randomBytes(32).toString('hex'),appKey:randomBytes(32).toString('hex')};atomic(secretsPath,secrets);}
  i={id,dir,stateDir,context:c,build,buildPath,leaseId:'preview:'+id.slice(0,40),...secrets};
  const {PortableAppAuthority}=await load('portable-authority');const {CanonicalLeaseStore}=await load('lease-store');
  const anchor=join(stateDir,'authority-anchor.json');
  if(!existsSync(marker)&&!existsSync(anchor))PortableAppAuthority.provision({stateDir,masterKey:i.masterKey,pinnedStorePath:join(nativeRoot,'data/company-authority.sqlite3')});
  else {const a=PortableAppAuthority.open({stateDir,masterKey:i.masterKey});a.close();}
  i.leases=existsSync(join(stateDir,'lease-registry.sqlite'))?new CanonicalLeaseStore(join(stateDir,'lease-registry.sqlite')):CanonicalLeaseStore.provision(join(stateDir,'lease-registry.sqlite'));
  i.leases.registerLease({leaseId:i.leaseId,companyId:c.companyId,projectId:c.projectId,artifactDigest:build.receipt.artifactDigest,processGeneration:c.generation});
  try{
   i.host=await startProcess(join(authorityPackage,'server/trusted-host-cli.ts'),['start','--state-dir',stateDir,'--native-root',nativeRoot,'--company',c.companyId,'--project',c.projectId,'--lease-id',i.leaseId,'--artifact-digest',build.receipt.artifactDigest,'--generation',String(c.generation)],{STARLI_AUTHORITY_MASTER_KEY:i.masterKey,STARLI_APP_AUTHORITY_KEY:i.appKey},join(dir,'authority-process.json'));
   i.runtimeConfig=join(dir,'app-runtime.json');atomic(i.runtimeConfig,{authorityPackage,authorityUrl:`http://127.0.0.1:${i.host.ready.port}`,build:buildPath,dataRoot:join(resolve(stateRoot),'data'),leaseId:i.leaseId,generation:c.generation,approvedParentOrigin,port:0,loopbackTest:true});
   await startApp(i);await context(input); // final current native/graph check before exposing ticket
   const ticket=await issue(i,input.nativeJwt);instances.set(id,i);atomic(marker,{status:'ACTIVE',previewId:id,companyId:c.companyId,projectId:c.projectId,graphId:c.graphId,generation:c.generation,artifactDigest:build.receipt.artifactDigest,appPid:i.app.child.pid,authorityPid:i.host.child.pid});
   return {...publicRecord(i),...(await healthy(i)),ticketValidatedByNativeServer:true,bootstrapTicket:ticket};
  }catch(e){instances.delete(id);i.leases.deactivateLease(i.leaseId);await terminate(i.app);await terminate(i.host);atomic(marker,{status:'FAILED_CLOSED',previewId:id});throw e;}
 });}
 async function owned(input,allowStoppedGraph=false){const c=await context(input,allowStoppedGraph);const i=[...instances.values()].find(x=>x.context.intentId===c.intentId&&x.context.graphId===c.graphId&&x.context.executionDigest===c.executionDigest);if(!i)fail('ACTIVE_PREVIEW_NOT_FOUND');return i;}
 async function bootstrap(input){const i=await owned(input);return {...publicRecord(i),...(await healthy(i)),ticketValidatedByNativeServer:true,bootstrapTicket:await issue(i,input.nativeJwt)};}
 async function restart(input){const i=await owned(input);return runLocked(i.context.intentId,async()=>{const oldPid=i.app.child.pid;const stopped=await terminate(i.app);if(!stopped.confirmedStopped)fail('APP_STOP_UNCONFIRMED');await context(input);await startApp(i);if(i.app.child.pid===oldPid)fail('APP_PROCESS_NOT_RESTARTED');return {...publicRecord(i),...(await healthy(i)),ticketValidatedByNativeServer:true,previousAppPid:oldPid,bootstrapTicket:await issue(i,input.nativeJwt)};});}
 async function stopInstance(i){i.leases.deactivateLease(i.leaseId);const app=await terminate(i.app),authority=await terminate(i.host);const confirmedStopped=app.confirmedStopped&&authority.confirmedStopped;atomic(join(i.dir,'lifecycle.json'),{status:confirmedStopped?'STOPPED':'STOP_PENDING',previewId:i.id,app,authority});if(confirmedStopped)instances.delete(i.id);return {previewId:i.id,stopState:confirmedStopped?'STOPPED':'STOP_PENDING',confirmedStopped,leaseInactive:true,app,authority};}
 async function stop(input){const i=await owned(input,true);return runLocked(i.context.intentId,()=>stopInstance(i));}
 async function cleanup({intentId}){const owned=[...instances.values()].filter(i=>i.context.intentId===intentId);if(!owned.length)fail('ACTIVE_PREVIEW_NOT_FOUND');return Promise.all(owned.map(stopInstance));}
 async function close(){await asyncVerifier.close();return Promise.all([...instances.values()].map(stopInstance));}
 return {open,bootstrap,restart,stop,cleanup,close,context};
}
