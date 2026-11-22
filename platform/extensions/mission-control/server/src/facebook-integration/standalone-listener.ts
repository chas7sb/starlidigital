import {assertFacebookCustomerPilotEffectsAllowed} from './pilot-effect-stop.js';
/** Dedicated pilot composition only. No global listener, legacy router or provider bootstrap. */
import {sessionContext} from '../security.js';
import {handleCustomerFacebookOAuthHttp,type FacebookOAuthConfig,type FacebookOAuthProvider} from '../facebook-pages/oauth.js';
import {createServer} from 'node:http';
import type {InstagramMediaDelivery} from '../instagram-publishing/media-delivery.js';
import {createIsolatedFacebookCustomerHttpIntegration} from './customer-mcp-registration.js';
import {createFacebookScheduledWorker,type DueFacebookScheduler} from './scheduled-worker.js';
export async function startStandaloneCustomerPilot(options:Parameters<typeof createIsolatedFacebookCustomerHttpIntegration>[0] & {firstPhotoHealth?:true;reelScheduler?:DueFacebookScheduler;renderScheduler?:DueFacebookScheduler;instagramScheduler?:DueFacebookScheduler;instagramMediaDelivery?:InstagramMediaDelivery;customerFacebookOAuth?:{config:FacebookOAuthConfig;provider:FacebookOAuthProvider};recurringWorker?:{intervalMs?:number;batchSize?:number;onError?:(error:unknown)=>void}},port=0,workerOptions?:{
 scheduler:DueFacebookScheduler;disabled?:true;intervalMs?:number;batchSize?:number;onError?:(error:unknown)=>void;
}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('INVALID_PILOT_PORT');
 if(options.requireVerifiedPostNow===true && !workerOptions?.scheduler)throw Error('DURABLE_FACEBOOK_SCHEDULER_REQUIRED');
 // Never expose a customer-facing live listener that silently falls back to a
 // structural/mock publish backend. Explicit launch intent is mandatory.
 if(options.requireVerifiedPostNow!==true)throw Error('VERIFIED_FACEBOOK_PILOT_LAUNCH_REQUIRED');
 if(options.recurringWorker&&!options.loops)throw Error('TRUSTED_RECURRING_ENGINE_REQUIRED');
 const integration=createIsolatedFacebookCustomerHttpIntegration(options);
 // Reuse the same bounded, single-flight lifecycle for the actual registered
 // engine. No default recurring timer and no different hidden engine instance.
 const recurringWorker=options.recurringWorker?createFacebookScheduledWorker({
  ...options.recurringWorker,scheduler:{dispatchDue:limit=>options.loops!.engine.tick(limit)}
 }):undefined;
 const worker=workerOptions&&!workerOptions.disabled?createFacebookScheduledWorker(workerOptions):undefined;
 const reelWorker=options.reelScheduler?createFacebookScheduledWorker({scheduler:options.reelScheduler,batchSize:4}):undefined;
 const instagramWorker=options.instagramScheduler?createFacebookScheduledWorker({scheduler:options.instagramScheduler,batchSize:4}):undefined;
 const renderWorker=options.renderScheduler?createFacebookScheduledWorker({scheduler:options.renderScheduler,batchSize:1,intervalMs:1500}):undefined;
 const server=createServer((req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');void (async()=>{
  if(options.instagramMediaDelivery?.handle(req,res))return;
  if((options.offlineReadiness||options.firstPhotoHealth)&&req.method==='GET'&&req.url==='/healthz'){
   options.store.db.prepare('SELECT 1').get();
   let stopped=false;
   if(options.firstPhotoHealth){
    try{assertFacebookCustomerPilotEffectsAllowed(options.store);}
    catch{stopped=true;}
   }
   res.writeHead(stopped?503:200,{'Content-Type':'application/json'});
   res.end(JSON.stringify({status:stopped?'stopped':'ok',
    mode:options.offlineReadiness?'offline-readiness':'first-photo',
    externalWritesEnabled:!options.offlineReadiness&&!stopped}));
   return;
  }
  if(options.customerFacebookOAuth && await handleCustomerFacebookOAuthHttp(req,res,options.store,
    sessionContext(options.store,req.headers.cookie??''),options.customerFacebookOAuth.config,options.customerFacebookOAuth.provider))return;
  await integration.handle(req,res);
 })().catch(()=>{if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'PILOT_REQUEST_FAILED'}));}else res.destroy();})});
 server.requestTimeout=30000;server.headersTimeout=15000;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 worker?.start();recurringWorker?.start();reelWorker?.start();instagramWorker?.start();renderWorker?.start();
 return{address:()=>server.address(),worker,recurringWorker,reelWorker,instagramWorker,renderWorker,async close(){
  await Promise.all([worker?.stop(),recurringWorker?.stop(),reelWorker?.stop(),instagramWorker?.stop(),renderWorker?.stop()]);
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
 }};
}
