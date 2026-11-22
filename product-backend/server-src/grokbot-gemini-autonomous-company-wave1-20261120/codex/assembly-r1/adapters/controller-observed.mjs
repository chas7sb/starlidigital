import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPreviewLifecycle} from '../../preview-async-context-r1/lifecycle.mjs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const key=process.env.STARLI_PREVIEW_CONTROL_KEY||'';if(key.length<32)throw Error('PREVIEW_CONTROL_KEY_REQUIRED');
if(!process.env.STARLI_INSTANCE_NONCE)throw Error('INSTANCE_NONCE_REQUIRED');
const {resolveVerifiedBuild}=await import(pathToFileURL(config.buildResolver).href);
const lifecycle=createPreviewLifecycle({...config,resolveVerifiedBuild});
const opens=new Map();const cancelledIntents=new Set();
const journalDir=config.stateRoot+'/startup-journal';mkdirSync(journalDir,{recursive:true,mode:0o700});
function journal(intent,state,code){const file=journalDir+'/'+createHash('sha256').update(intent).digest('hex')+'.json';const temp=file+'.tmp';writeFileSync(temp,JSON.stringify({state,controllerPid:process.pid,controllerInstance:process.env.STARLI_INSTANCE_NONCE,...(code?{code}:{}),updatedAt:Date.now()}),{mode:0o600});renameSync(temp,file);}
function previousJournal(intent){const f=journalDir+'/'+createHash('sha256').update(intent).digest('hex')+'.json';return existsSync(f)?JSON.parse(readFileSync(f)):null;}
const STARTUP_BUDGET_MS=120000;
async function pollOpen(body){
 const current=await lifecycle.context(body); // current native scope on EVERY poll, including cached states
 if(cancelledIntents.has(body.intentId))return {pending:true,status:'STOP_PENDING',authorityState:'PENDING'};
 let job=opens.get(body.intentId);
 if(!job){
  if(opens.has(body.intentId))return pollOpen(body); // close concurrent preflight race
  const previous=previousJournal(body.intentId);if(previous&&(previous.state==='INTERRUPTED'||previous.controllerInstance!==process.env.STARLI_INSTANCE_NONCE)){journal(body.intentId,'INTERRUPTED');throw Error('PREVIEW_STARTUP_INTERRUPTED_REVIEW_REQUIRED');}
  journal(body.intentId,'PENDING');
  job={state:'PENDING',startedAt:Date.now(),expired:false,epoch:0,tokenHash:createHash('sha256').update(body.nativeJwt).digest('hex')};opens.set(body.intentId,job);
  const timer=setTimeout(()=>{job.expired=true;job.state='TIMED_OUT';journal(body.intentId,'TIMED_OUT');},STARTUP_BUDGET_MS);
  job.promise=lifecycle.open(body).then(async(result)=>{
   clearTimeout(timer);
   if(job.expired){await lifecycle.cleanup({intentId:body.intentId});job.state='STOPPED';journal(body.intentId,'STOPPED');return;}
   job.result=result;job.state='READY';journal(body.intentId,'READY');
  },e=>{clearTimeout(timer);job.state='FAILED';job.code=/^[A-Z0-9_]{1,100}$/.test(e.code||e.message)?(e.code||e.message):'PREVIEW_DENIED';journal(body.intentId,'FAILED',job.code);console.log(JSON.stringify({event:'PREVIEW_STARTUP_FAILED',code:job.code,durationMs:Date.now()-job.startedAt}));});
 }
 if(job.state==='PENDING')return {pending:true,status:'BUILD_PENDING',authorityState:'PENDING',startupBudgetMs:STARTUP_BUDGET_MS,elapsedMs:Date.now()-job.startedAt};
 if(job.state==='STOP_REQUESTED'||job.state==='STOPPED')return {pending:true,status:'STOP_PENDING',authorityState:'PENDING'};
 if(job.state==='TIMED_OUT')throw Error('PREVIEW_STARTUP_BUDGET_EXCEEDED');
 if(job.state==='FAILED'){const code=job.code;throw Error(code);}
 if(job.tokenHash!==createHash('sha256').update(body.nativeJwt).digest('hex'))throw Error('PREVIEW_SESSION_BINDING_MISMATCH');
 if(job.state==='RESTART_PENDING')return {pending:true,status:'BUILD_PENDING',authorityState:'PENDING'};
 if(job.state==='TICKET_PENDING')return {pending:true,status:'BUILD_PENDING',authorityState:'PENDING'};
 const result=job.result;
 if(result){
  for(const key of ['companyId','projectId','requestId','graphId','sourceMessageId','generation'])if(result[key]!==current[key])throw Error('PREVIEW_READY_SCOPE_MISMATCH');
  let claims;try{claims=JSON.parse(Buffer.from(result.bootstrapTicket.split('.')[0],'base64url').toString('utf8'));}catch{throw Error('TRUSTED_TICKET_PAYLOAD_INVALID');}
  for(const [key,value] of Object.entries({companyId:current.companyId,projectId:current.projectId,userId:current.subjectId,leaseId:result.leaseId,processGeneration:current.generation,artifactDigest:result.artifactDigest,authorityRevision:current.authorizationRevision}))if(claims[key]!==value)throw Error('TRUSTED_TICKET_SCOPE_MISMATCH');
  if(claims.audience!=='PRIVATE_SCOPED'||!Number.isFinite(claims.issuedAt)||claims.expiresAt>claims.issuedAt+120000)throw Error('TRUSTED_TICKET_LIFETIME_INVALID');
  if(Number.isFinite(claims.expiresAt)&&claims.expiresAt>Date.now()+15000){
   job.result=null; // consume BEFORE send; an uncertain HTTP never redelivers this ticket.
   return result;
  }
  job.result=null;
 }
 job.state='TICKET_PENDING';
 const ticketEpoch=job.epoch;
 job.promise=lifecycle.bootstrap(body).then(async(value)=>{
  if(job.epoch!==ticketEpoch)return;
  if(job.expired){await lifecycle.cleanup({intentId:body.intentId});job.state='STOPPED';return;}
  job.result=value;job.state='READY';
 },e=>{if(job.epoch!==ticketEpoch)return;job.state='FAILED';job.code=/^[A-Z0-9_]{1,100}$/.test(e.code||e.message)?(e.code||e.message):'PREVIEW_DENIED';journal(body.intentId,'FAILED',job.code);});
 return {pending:true,status:'BUILD_PENDING',authorityState:'PENDING'};
}
const server=createServer(async(req,res)=>{
 const requestId=randomUUID(),startedAt=Date.now();let action='UNKNOWN';
 const send=(s,b)=>{res.writeHead(s,{'X-Starli-Preview-Request':requestId,'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(b));};
 if(req.method==='GET'&&req.url==='/instance')return send(200,{instanceNonce:process.env.STARLI_INSTANCE_NONCE,pid:process.pid});
 try{
  const a=Buffer.from(req.headers['x-starli-preview-key']||''),b=Buffer.from(key);if(a.length!==b.length||!timingSafeEqual(a,b))throw Error('PREVIEW_CONTROL_AUTH_DENIED');
  action=req.url?.split('/').pop();if(req.method!=='POST'||!['open','bootstrap','restart','stop','cleanup'].includes(action))return send(404,{error:{code:'NOT_FOUND'}});
  let bytes=0,chunks=[];for await(const c of req){bytes+=c.length;if(bytes>16384)throw Error('BODY_TOO_LARGE');chunks.push(c);}const body=JSON.parse(Buffer.concat(chunks));
  if(Object.keys(body).some(k=>!['intentId','nativeJwt'].includes(k))||typeof body.intentId!=='string'||(action!=='cleanup'&&typeof body.nativeJwt!=='string'))throw Error('EXACT_NATIVE_REQUEST_REQUIRED');
  console.log(JSON.stringify({event:'PREVIEW_REQUEST_STARTED',requestId,action}));
  if(action==='stop'||action==='cleanup'){if(action==='stop')await lifecycle.context(body);cancelledIntents.add(body.intentId);journal(body.intentId,'STOP_REQUESTED');}
  const pending=opens.get(body.intentId);
  if((action==='stop'||action==='cleanup')&&['PENDING','TICKET_PENDING','RESTART_PENDING'].includes(pending?.state)){
   pending.epoch++;pending.expired=true;pending.state='STOP_REQUESTED';journal(body.intentId,'STOP_REQUESTED');
   console.log(JSON.stringify({event:'PREVIEW_STARTUP_CANCEL_REQUESTED',requestId,action}));
   return send(202,{confirmedStopped:false,stopState:'STOP_PENDING',authorityState:'PENDING'});
  }
  let result;
  if(action==='restart'){
   await lifecycle.context(body);
   const job=opens.get(body.intentId);if(!job||job.state==='RESTART_PENDING')throw Error('PREVIEW_RESTART_OPERATION_UNAVAILABLE');
   job.epoch++;job.result=null;job.state='RESTART_PENDING';
   try{result=await lifecycle.restart(body);if(job.expired||cancelledIntents.has(body.intentId)){await lifecycle.cleanup({intentId:body.intentId});job.state='STOPPED';throw Error('PREVIEW_RESTART_CANCELLED');}job.result=result;job.state='READY';}
   catch(error){if(job.state!=='STOPPED')job.state='FAILED';job.code='PREVIEW_RESTART_FAILED';throw error;}
  }else result=await ((action==='open'||action==='bootstrap')?pollOpen(body):lifecycle[action](body));
  const status=result.pending?202:200;console.log(JSON.stringify({event:'PREVIEW_REQUEST_FINISHED',requestId,action,status,durationMs:Date.now()-startedAt}));send(status,result);
 }catch(e){const raw=e.code||e.message||'PREVIEW_DENIED';const code=/^[A-Z0-9_]{1,100}$/.test(raw)?raw:'PREVIEW_DENIED';console.log(JSON.stringify({event:'PREVIEW_REQUEST_FAILED',requestId,action,code,durationMs:Date.now()-startedAt}));if(req.url?.endsWith('/open')&&['ACTUAL_NATIVE_BUILD_REQUIRED','TWO_VERIFIED_NATIVE_WORKERS_REQUIRED'].includes(code))send(202,{status:'BUILD_PENDING',authorityState:'PENDING',statusMessage:'Your app is being built.'});else send(403,{error:{code}});}
});
server.listen(config.port??0,'127.0.0.1',()=>console.log(JSON.stringify({ready:true,pid:process.pid,port:server.address().port,instanceNonce:process.env.STARLI_INSTANCE_NONCE})));
let closing=false;const stop=async()=>{if(closing)return;closing=true;for(const job of opens.values())job.expired=true;await Promise.allSettled([...opens.values()].map(job=>job.promise));await lifecycle.close();server.close(()=>process.exit(0));};process.on('SIGTERM',stop);process.on('SIGINT',stop);
