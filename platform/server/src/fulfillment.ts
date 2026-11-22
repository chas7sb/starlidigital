import{canUseSubscriptionHosting,bindSubscriptionHosting}from'./hosting.js';
import{subscriptionEntitlement,creditOwnerId}from'./subscriptions.js';
import { randomUUID } from 'node:crypto';
import { Store,now,type RecordData } from './store.js';
import { Events } from './events.js';
import { sourceHash } from './billing.js';
import { validateNextProjectFiles,type SourceFile } from './next-template.js';
import { deployNextSite,ensureVercelProject,findDeploymentByRequest,getDeployment,verifyPublicDeployment,vercelConfigured,VercelRequestError,type Deployment } from './integrations/vercel.js';

type Provider={ensure:typeof ensureVercelProject;deploy:typeof deployNextSite;find:typeof findDeploymentByRequest;get:typeof getDeployment;public:typeof verifyPublicDeployment;configured:()=>boolean;clock:()=>number};
const defaults:Provider={ensure:ensureVercelProject,deploy:deployNextSite,find:findDeploymentByRequest,get:getDeployment,public:verifyPublicDeployment,configured:vercelConfigured,clock:Date.now};
const active=new WeakMap<Store,Promise<void>>();
const terminal=new Set(['LIVE','FAILED','BLOCKED','CANCELED']);

function emit(events:Events){for(const topic of ['fulfillment','projects','payments','platform'])events.publish(topic);}
function save(store:Store,events:Events,job:RecordData,changes:Record<string,unknown>):RecordData{
 const result=store.put('fulfillment-jobs',{...job,...changes,updatedAt:now()});
 if(result.paymentId){const payment=store.get('payments',result.paymentId);if(payment)store.put('payments',{...payment,fulfillmentStatus:result.status,fulfillmentError:result.error||null});}
 emit(events);return result;
}
function authorize(store:Store,job:RecordData):boolean{
 const user=store.user(job.ownerId);
 if(job.adminActorId){const admin=store.user(job.adminActorId);return admin?.role==='ADMIN'&&!admin.disabled&&!user?.disabled;}
 if(!user||user.disabled)return false;
 if(job.subscriptionId){const entitlement=subscriptionEntitlement(store,job.ownerId);return entitlement.active&&entitlement.subscriptionId===job.subscriptionId&&job.walletRealm===creditOwnerId(job.ownerId)&&canUseSubscriptionHosting(store,job.ownerId,job.projectId);}
 const payment=store.get('payments',job.paymentId);
 return !!payment&&payment.status==='PAID'&&payment.ownerId===job.ownerId&&payment.projectId===job.projectId&&payment.sourceHash===job.sourceHash&&typeof payment.livemode==='boolean'&&(!payment.livemode||process.env.STRIPE_LIVE_ENABLED==='true')&&!!payment.verifiedEventId&&!!store.get('stripe-events',payment.verifiedEventId);
}
function snapshot(store:Store,job:RecordData):SourceFile[]{
 const source=store.get('source-snapshots',job.ownerId+':'+job.sourceHash);
 if(!source||source.ownerId!==job.ownerId||source.sourceHash!==job.sourceHash||!Array.isArray(source.files)||sourceHash(source.files)!==job.sourceHash)throw new Error('Versiunea achitată nu are un snapshot integral verificabil. Sursa curentă nu este folosită în locul ei.');
 validateNextProjectFiles(source.files);return source.files;
}

/** Operator publication retains the same durable pipeline; no fabricated payment is created. */
export function enqueueAdminFulfillment(store:Store,project:RecordData,actor:RecordData):RecordData{
 const admin=store.user(actor.id);if(actor.role!=='ADMIN'||admin?.role!=='ADMIN'||admin.disabled)throw new Error('Publicarea fără plată este rezervată administratorului activ.');
 if(!Array.isArray(project.files)||!project.files.length)throw new Error('Proiectul nu are sursă Next.js.');
 validateNextProjectFiles(project.files);const hash=sourceHash(project.files);const jobId=`admin-${project.id}-${hash.slice(0,24)}`;
 const existing=store.get('fulfillment-jobs',jobId);if(existing)return existing;
 store.put('source-snapshots',{id:project.ownerId+':'+hash,ownerId:project.ownerId,projectId:project.id,sourceHash:hash,files:project.files,createdAt:now()});
 return store.put('fulfillment-jobs',{id:jobId,ownerId:project.ownerId,projectId:project.id,sourceHash:hash,adminActorId:actor.id,paymentId:null,status:'PENDING',requestId:'fulfill-'+jobId,submissionAttempted:false,attempts:0,nextAttemptAt:0,createdAt:now(),updatedAt:now()});
}

/** Subscription publication uses a separately verified entitlement, never a fabricated payment. */
export function enqueueSubscriptionFulfillment(store:Store,project:RecordData,user:RecordData):RecordData{
 if(project.ownerId!==user.id)throw Error('Proiectul nu aparține contului.');
 validateNextProjectFiles(project.files);const hash=sourceHash(project.files);
 store.db.exec('BEGIN IMMEDIATE');try{
  const entitlement=bindSubscriptionHosting(store,user.id,project.id);
  const jobId=`subscription-${creditOwnerId(user.id)}-${project.id}-${hash.slice(0,24)}`;
  const existing=store.get('fulfillment-jobs',jobId);if(existing){store.db.exec('COMMIT');return existing;}
  store.put('source-snapshots',{id:project.ownerId+':'+hash,ownerId:project.ownerId,projectId:project.id,sourceHash:hash,files:project.files,createdAt:now()});
  const job=store.put('fulfillment-jobs',{id:jobId,ownerId:user.id,projectId:project.id,sourceHash:hash,subscriptionId:entitlement.subscriptionId,walletRealm:creditOwnerId(user.id),paymentId:null,status:'PENDING',requestId:'fulfill-'+hash.slice(0,24)+'-'+project.id,submissionAttempted:false,attempts:0,nextAttemptAt:0,createdAt:now(),updatedAt:now()});store.db.exec('COMMIT');return job;
 }catch(error){store.db.exec('ROLLBACK');throw error;}
}

/** Reconciliation may be requested repeatedly; an unknown POST can never be reset into another POST. */
export function retryFulfillment(store:Store,jobId:string):RecordData{
 const job=store.get('fulfillment-jobs',jobId);if(!job)throw new Error('Operațiunea nu există.');
 if(job.status==='LIVE')return job;
 return store.put('fulfillment-jobs',{...job,status:job.submissionAttempted?'RECONCILING':'PENDING',nextAttemptAt:0,leaseUntil:0,error:null,updatedAt:now()});
}

function backfillVerifiedPayments(store:Store){
 for(const payment of store.list('payments'))if(payment.status==='PAID'&&payment.verifiedEventId&&store.get('stripe-events',payment.verifiedEventId)&&!store.get('fulfillment-jobs','payment-'+payment.id))store.put('fulfillment-jobs',{id:'payment-'+payment.id,ownerId:payment.ownerId,projectId:payment.projectId,paymentId:payment.id,sourceHash:payment.sourceHash,status:'PENDING',requestId:'fulfill-'+payment.id,submissionAttempted:false,attempts:0,nextAttemptAt:0,createdAt:now(),updatedAt:now()});
}

async function finish(store:Store,events:Events,job:RecordData,deployment:Deployment,provider:Provider):Promise<void>{
 if(deployment.projectId!==job.providerProjectId||deployment.requestId!==job.requestId||deployment.sourceHash!==job.sourceHash)throw new Error('Publicarea furnizorului nu corespunde cererii, proiectului și sursei achitate.');
 if(deployment.status==='ERROR'){save(store,events,job,{status:'FAILED',error:'Vercel a confirmat eșecul buildului. Nu s-a creat o nouă publicare.',leaseUntil:0});return;}
 if(deployment.status!=='READY'){save(store,events,job,{status:'DEPLOYING',nextAttemptAt:provider.clock()+15000,leaseUntil:0,error:null});return;}
 if(!await provider.public(deployment.url)){
  const checks=Number(job.publicChecks||0)+1;save(store,events,job,{status:checks>=20?'NEEDS_REVIEW':'VERIFYING_PUBLIC',publicChecks:checks,nextAttemptAt:provider.clock()+15000,leaseUntil:0,error:'Buildul este READY, dar accesul HTTPS public fără autentificare nu a fost confirmat.'});return;
 }
 // Recheck payment/account after network operations, before granting fulfillment evidence.
 if(!authorize(store,job)){save(store,events,job,{status:'NEEDS_REVIEW',leaseUntil:0,error:'Plata sau contul a fost revocat în timpul publicării. Website-ul necesită verificarea administratorului.'});return;}
 const project=store.get('projects',job.projectId);if(!project||project.ownerId!==job.ownerId)throw new Error('Proiectul sau proprietarul nu mai corespunde comenzii.');
 const current=Array.isArray(project.files)&&sourceHash(project.files)===job.sourceHash;
 store.db.exec('BEGIN IMMEDIATE');try{
  store.put('projects',{...project,providerProjectId:job.providerProjectId,deploymentId:deployment.id,deploymentStatus:'READY',deploymentSourceHash:job.sourceHash,publishedSourceHash:job.sourceHash,deploymentUrl:deployment.url,publicVerified:true,status:current?'LIVE':project.status==='LIVE'?'SOURCE_READY':project.status,validationStatus:current?'PASSED':project.validationStatus||'NOT_RUN',validationProvider:current?'VERCEL':project.validationProvider||null,buildError:null,updatedAt:now()});
  store.put('fulfillment-jobs',{...job,status:'LIVE',deploymentId:deployment.id,deploymentUrl:deployment.url,publicVerified:true,error:null,leaseUntil:0,completedAt:now(),updatedAt:now()});
  if(job.paymentId){const payment=store.get('payments',job.paymentId);if(payment)store.put('payments',{...payment,fulfillmentStatus:'LIVE',fulfillmentError:null,fulfilledAt:now()});}
  const memoryId=`project-${job.projectId}-${job.sourceHash}-VERCEL`;
  if(!store.get('memories',memoryId))store.put('memories',{id:memoryId,projectId:job.projectId,title:'Proiect Next.js — publicare confirmată',content:'Un proiect React, Next.js și TypeScript a fost compilat de Vercel și verificat prin acces HTTPS public, fără autentificare. Rezumatul nu conține nume de clienți, contacte, conversații, cod sau alte informații private.',publicApproved:false,createdAt:now()});
  store.db.exec('COMMIT');
 }catch(error){store.db.exec('ROLLBACK');throw error;}
 emit(events);events.publish('memories');
}

async function runTick(store:Store,events:Events,provider:Provider):Promise<void>{
 backfillVerifiedPayments(store);
 const jobs=store.list('fulfillment-jobs').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 const candidate=jobs.find((job,index)=>!terminal.has(job.status)&&job.status!=='NEEDS_REVIEW'&&Number(job.nextAttemptAt||0)<=provider.clock()&&Number(job.leaseUntil||0)<=provider.clock()&&!jobs.slice(0,index).some(prior=>prior.projectId===job.projectId&&!terminal.has(prior.status)));
 if(!candidate)return;
 let job:RecordData;const lease=randomUUID();
 store.db.exec('BEGIN IMMEDIATE');try{const fresh=store.get('fulfillment-jobs',candidate.id)!;if(terminal.has(fresh.status)||fresh.status==='NEEDS_REVIEW'||Number(fresh.nextAttemptAt||0)>provider.clock()||Number(fresh.leaseUntil||0)>provider.clock()){store.db.exec('COMMIT');return;}job=store.put('fulfillment-jobs',{...fresh,leaseToken:lease,leaseUntil:provider.clock()+300000,updatedAt:now()});store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
 if(!authorize(store,job)){save(store,events,job,{status:job.submissionAttempted?'NEEDS_REVIEW':'BLOCKED',leaseUntil:0,error:'Lipsește plata verificată sau dreptul administratorului; contul poate fi dezactivat.'});return;}
 let files:SourceFile[];try{files=snapshot(store,job);}catch(error){save(store,events,job,{status:'BLOCKED',leaseUntil:0,error:error instanceof Error?error.message:'Snapshot invalid.'});return;}
 if(!provider.configured()){save(store,events,job,{status:'SETUP_REQUIRED',nextAttemptAt:provider.clock()+60000,leaseUntil:0,error:'VERCEL_TOKEN nu este configurat. Comanda rămâne înregistrată.'});return;}
 try{
  if(job.deploymentId){const deployment=await provider.get(job.deploymentId);await finish(store,events,job,deployment,provider);return;}
  if(job.submissionAttempted){
   if(!job.providerProjectId){save(store,events,job,{status:'NEEDS_REVIEW',leaseUntil:0,error:'Cererea a fost trimisă fără o asociere recuperabilă. Verifică Vercel înainte de orice altă publicare.'});return;}
   const deployment=await provider.find({projectId:job.providerProjectId,requestId:job.requestId,since:Number(job.submissionStartedAt||0)});
   if(!deployment){const attempts=Number(job.reconcileAttempts||0)+1;save(store,events,job,{status:attempts>=10?'NEEDS_REVIEW':'RECONCILING',reconcileAttempts:attempts,nextAttemptAt:provider.clock()+30000,leaseUntil:0,error:'Rezultatul cererii Vercel este necunoscut. Se verifică metadatele; cererea POST nu este repetată.'});return;}
   job=save(store,events,job,{deploymentId:deployment.id,status:'DEPLOYING',leaseUntil:provider.clock()+300000});await finish(store,events,job,deployment,provider);return;
  }
  const project=store.get('projects',job.projectId);if(!project||project.ownerId!==job.ownerId)throw new Error('Proiectul nu mai corespunde comenzii.');
  const name='starli-'+job.projectId;
  job=save(store,events,job,{status:'PREPARING',attempts:Number(job.attempts||0)+1});
  const remote=await provider.ensure({name,expectedId:job.providerProjectId||project.providerProjectId,onCreated:created=>{
   job=save(store,events,job,{providerProjectId:created.id});const current=store.get('projects',job.projectId);if(current)store.put('projects',{...current,providerProjectId:created.id});
  }});
  job=save(store,events,job,{providerProjectId:remote.id});
  if(!authorize(store,job))throw new Error('Plata sau contul a fost revocat înainte de publicare.');
  // Durable write-ahead marker precedes the only deployment POST. Recovery only reconciles it.
  job=save(store,events,job,{status:'SUBMITTING',submissionAttempted:true,submissionStartedAt:provider.clock(),leaseUntil:provider.clock()+300000});
  const deployment=await provider.deploy({name,files,projectId:remote.id,requestId:job.requestId,sourceHash:job.sourceHash});
  job=save(store,events,job,{status:'DEPLOYING',deploymentId:deployment.id,nextAttemptAt:provider.clock()+15000});
  await finish(store,events,job,deployment,provider);
 }catch(error){
  const latest=store.get('fulfillment-jobs',job.id)||job;const message=error instanceof Error?error.message:'Operațiunea furnizorului a eșuat.';
  if(latest.submissionAttempted&&!latest.deploymentId){
   const definite=error instanceof VercelRequestError&&!error.unknownOutcome;
   save(store,events,latest,{status:definite?'FAILED':'RECONCILING',error:message,leaseUntil:0,nextAttemptAt:provider.clock()+30000});
  }else if(latest.deploymentId){
   const failures=Number(latest.pollFailures||0)+1;save(store,events,latest,{status:failures>=10?'NEEDS_REVIEW':'DEPLOYING',pollFailures:failures,error:message,leaseUntil:0,nextAttemptAt:provider.clock()+30000});
  }else{
   const ambiguous=error instanceof VercelRequestError&&error.unknownOutcome;
   save(store,events,latest,{status:ambiguous||Number(latest.attempts||0)>=3?'NEEDS_REVIEW':'PENDING',error:message,leaseUntil:0,nextAttemptAt:provider.clock()+60000});
  }
 }
}

export function tickFulfillment(store:Store,events:Events,overrides:Partial<Provider>={}):Promise<void>{
 const existing=active.get(store);if(existing)return existing;
 const result=runTick(store,events,{...defaults,...overrides}).finally(()=>active.delete(store));active.set(store,result);return result;
}
export function startFulfillmentWorker(store:Store,events:Events):()=>void{
 if(process.env.ENABLE_AUTO_FULFILLMENT==='false')return ()=>{};
 const tick=()=>void tickFulfillment(store,events).catch(error=>console.error('[fulfillment]',error instanceof Error?error.message:'Failed'));
 const timer=setInterval(tick,15000);timer.unref();tick();return ()=>clearInterval(timer);
}
