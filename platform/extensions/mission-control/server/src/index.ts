import {mountConfiguredMissionControl} from './mission-control/codex-runtime-config.js';
import {authorizedVideoMedia} from './video-media.js';
import {startMailboxSync} from './mailbox/runtime.js';
import path from 'node:path';
import{releaseInterruptedCredits}from'./credits.js';
import{processSubscriptionStripeEvent}from'./subscriptions.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { createYoga } from 'graphql-yoga';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { GraphQLError, parse, getOperationAST, validate, specifiedRules } from 'graphql';
import { complexityRule } from './graphql-limits.js';
import { webAvailable, serveWeb } from './static.js';
import { stripeWebhook } from './billing.js';
import { handleOAuthMetadata, handleOAuthAuthorize, handleOAuthToken } from './oauth/index.js';
import { handleCustomerFacebookOAuthHttp } from './facebook-pages/oauth.js';
import { Store,id,now } from './store.js';
import { sessionContext,hashPassword,refresh } from './security.js';
import { Events } from './events.js';
import { createAppSchema } from './schema.js';
import { startScheduler } from './ai.js';
import { startFulfillmentWorker } from './fulfillment.js';
import { startEmailWorker,resendWebhook } from './email.js';
import { startDomainCommerceWorker,processDomainStripeEvent } from './domain-commerce.js';
import { loadAIRuntimeEnv } from './outlier-client.js';
import { reconcileOperatorJobs } from './operator-jobs.js';
import {recoverInterruptedBespokeBuilds} from './operator-bespoke.js';
import {recoverInterruptedOperatorTasks} from './operator-tasks.js';
import {recoverInterruptedOperatorReceipts} from './operator-tool-receipts.js';
import {recoverInterruptedSmsDispatches} from './messaging.js';
import {recoverInterruptedPlatformChanges} from './operator-platform-changes.js';
import {recoverInterruptedOperatorRuns} from './operator-run-cancellation.js';
import { attachDeviceWebSocket } from './operator-devices.js';
import { renderProposalOpenGraphHtml, renderProposalOgImageSvg, isLinkScannerBot } from './leads-proposals.js';
import { AssetServices } from './assets/service.js';
import fs from 'node:fs';
import { VideoRenderWorker } from './video/worker.js';

config({path:[fileURLToPath(new URL('../../.env',import.meta.url)),fileURLToPath(new URL('../.env',import.meta.url))],quiet:true});
loadAIRuntimeEnv();
const store=new Store();releaseInterruptedCredits(store);const events=new Events(store);reconcileOperatorJobs(store,events,true);recoverInterruptedBespokeBuilds(store);recoverInterruptedOperatorReceipts(store);recoverInterruptedSmsDispatches(store);recoverInterruptedPlatformChanges(store);recoverInterruptedOperatorRuns(store);recoverInterruptedOperatorTasks(store);
if(process.env.ADMIN_USERNAME&&process.env.ADMIN_PASSWORD){
  const username=process.env.ADMIN_USERNAME.trim().toLowerCase().replace(/@starlidigital\.ro$/,'');
  if(!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)||process.env.ADMIN_PASSWORD.length<14)throw new Error('ADMIN_USERNAME invalid or ADMIN_PASSWORD shorter than 14 characters.');
  const existing=store.findUser(username);
  if(existing&&existing.role!=='ADMIN')throw new Error('Admin bootstrap username belongs to a regular account. Choose a different ADMIN_USERNAME.');
  if(!existing)store.saveUser({id:id(),username,email:username+'@starlidigital.ro',recoveryEmail:process.env.ADMIN_RECOVERY_EMAIL||'',role:'ADMIN',passwordHash:hashPassword(process.env.ADMIN_PASSWORD),createdAt:now()});
}
// Interrupted tasks are recoverable, never falsely shown as completed.
for(const project of store.list('projects'))if(project.status==='BUILDING')store.put('projects',{...project,status:'FAILED',buildError:'Serverul a fost repornit în timpul construcției. Poți reîncerca.',updatedAt:now()});
for(const project of store.list('projects'))if(project.status==='VERIFYING')store.put('projects',{...project,status:'BUILD_FAILED',validationStatus:'FAILED',buildError:'Serverul a fost repornit în timpul verificării. Sursa generată a fost păstrată.',updatedAt:now()});
const origins=new Set((process.env.ALLOWED_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173').split(',').map(x=>x.trim()));
if(process.env.PUBLIC_APP_URL)origins.add(new URL(process.env.PUBLIC_APP_URL).origin);
const schema=createAppSchema(store,events);
const assetServices=new AssetServices({store,events});
const clientIP=(request:import('node:http').IncomingMessage)=>{
  const remote=request.socket.remoteAddress||'unknown';const loopback=remote==='::1'||remote==='::ffff:127.0.0.1'||(isIP(remote)===4&&remote.startsWith('127.'));
  if(process.env.TRUSTED_PROXY==='true'&&loopback){const forwarded=request.headers['x-real-ip'];if(typeof forwarded==='string'&&isIP(forwarded.trim()))return forwarded.trim();}
  return remote;
};
const yoga=createYoga({schema,graphqlEndpoint:'/graphql',graphiql:process.env.NODE_ENV!=='production',maskedErrors:true,
  cors:{origin:[...origins],credentials:true,methods:['POST','GET','OPTIONS']},
  context:({request,res}:any)=>sessionContext(store,request.headers.get('cookie')||'',cookie=>{const previous=res?.getHeader('Set-Cookie');res?.setHeader('Set-Cookie',[...(Array.isArray(previous)?previous:previous?[String(previous)]:[]),cookie]);},'http:'+ (res?.req?clientIP(res.req):'local'),request.headers.get('authorization')||request.headers.get('x-starli-operator-token')||''),
  plugins:[{onValidate({addValidationRule}:any){addValidationRule(complexityRule);}}]
});
let missionControl:ReturnType<typeof mountConfiguredMissionControl>;
const server=createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Cache-Control','no-store');
  if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,service:'starlidigital-api',database:!!store.db.prepare('SELECT 1').get()}));return;}
  const pathname=new URL(req.url||'/', 'http://localhost').pathname;
  if(missionControl&&(pathname==='/mission-control'||pathname.startsWith('/mission-control/'))){
    void missionControl.handleHttp(req,res).catch(()=>{if(!res.headersSent)res.writeHead(503);res.end();});return;
  }
  if(pathname==='/.well-known/oauth-authorization-server'||pathname==='/.well-known/openid-configuration'){handleOAuthMetadata(res);return;}
  if(pathname==='/oauth/authorize'){void handleOAuthAuthorize(req,res,store,sessionContext(store,req.headers.cookie||'',()=>{},'http:'+clientIP(req),String(req.headers.authorization||'')));return;}
  if(pathname==='/oauth/token'){void handleOAuthToken(req,res,store);return;}
  if(pathname==='/customer/facebook/connect'||pathname==='/customer/facebook/callback'){
    // Customer cookie only: admin/operator bearer credentials are never accepted here.
    const customer=sessionContext(store,req.headers.cookie||'',()=>{},'http:'+clientIP(req));
    void handleCustomerFacebookOAuthHttp(req,res,store,customer);return;
  }
  if(pathname==='/webhooks/stripe'){void stripeWebhook(req,res,store,events,event=>{const walletResult=processSubscriptionStripeEvent(store,event);if(walletResult!==undefined){if(walletResult)events.publish('wallet');return walletResult;}const result=processDomainStripeEvent(store,event);if(result!==undefined)events.publish('domains');return result;});return;}
  if(pathname==='/webhooks/resend'){void resendWebhook(req,res,store,events);return;}
  if((req.method==='GET'||req.method==='HEAD')&&pathname.startsWith('/media/assets/')){
    const filename=path.basename(pathname.slice('/media/assets/'.length));
    if(!filename||filename==='.'||filename==='..'){res.writeHead(400);res.end('Invalid asset path');return;}
    const ctx=sessionContext(store,req.headers.cookie||'',()=>{},'http:'+clientIP(req),String(req.headers.authorization||req.headers['x-starli-operator-token']||''));
    refresh(ctx);
    try{
      const asset=assetServices.getAssetByFilename(filename,ctx.user);
      if(!asset){res.writeHead(404);res.end('Asset not found');return;}
      res.setHeader('Content-Type',asset.record.mimeType);
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Cache-Control',asset.record.visibility==='PUBLIC'?'public, max-age=86400':'private, no-cache');
      res.setHeader('Content-Length',asset.buffer.length);
      res.writeHead(200);
      res.end(req.method==='HEAD'?'':asset.buffer);
      return;
    }catch(err:any){
      res.writeHead(403);
      res.end(err?.message||'Access denied');
      return;
    }
  }
  if((req.method==='GET'||req.method==='HEAD')&&pathname.startsWith('/media/videos/')){
    const filename=path.basename(pathname.slice('/media/videos/'.length));
    if(!filename||filename==='.'||filename==='..'){res.writeHead(400);res.end('Invalid video path');return;}
    const context=sessionContext(store,req.headers.cookie||'',()=>{},'http:'+clientIP(req),String(req.headers.authorization||''));
    const filePath=authorizedVideoMedia(store,context,filename);
    if(!filePath){res.writeHead(context.user?404:401);res.end('Video media unavailable');return;}
    const requestOrigin=String(req.headers.origin||'');
    if(requestOrigin&&origins.has(requestOrigin)){res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');}
    if(!fs.existsSync(filePath)){res.writeHead(404);res.end('Video media not found');return;}
    const stats=fs.statSync(filePath);
    const ext=path.extname(filePath).toLowerCase();
    const mimeMap:Record<string,string>={'.mp4':'video/mp4','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.wav':'audio/wav'};
    const contentType=mimeMap[ext]||'application/octet-stream';
    const rangeHeader=req.headers.range;
    res.setHeader('Accept-Ranges','bytes');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','private, no-store');
    if(rangeHeader&&ext==='.mp4'){
      const parts=rangeHeader.replace(/bytes=/,'').split('-');
      const start=parseInt(parts[0],10);
      const end=parts[1]?parseInt(parts[1],10):stats.size-1;
      if(!/^bytes=\d+-\d*$/.test(rangeHeader)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=stats.size||end>=stats.size||start>end){res.writeHead(416,{'Content-Range':`bytes */${stats.size}`});res.end();return;}
      res.writeHead(206,{
        'Content-Range':`bytes ${start}-${end}/${stats.size}`,
        'Content-Length':end-start+1,
        'Content-Type':contentType
      });
      if(req.method==='HEAD'){res.end();return;}
      fs.createReadStream(filePath,{start,end}).pipe(res);
      return;
    }
    res.writeHead(200,{
      'Content-Length':stats.size,
      'Content-Type':contentType
    });
    if(req.method==='HEAD'){res.end();return;}
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  if((req.method==='GET'||req.method==='HEAD')&&(pathname.startsWith('/og/proposal/')||pathname.startsWith('/og/propunere/'))&&pathname.endsWith('.svg')){const prefix=pathname.startsWith('/og/proposal/')?'/og/proposal/':'/og/propunere/';const slug=decodeURIComponent(pathname.slice(prefix.length,-4));const svg=renderProposalOgImageSvg(store,slug);if(!svg){res.writeHead(404);res.end('Not found');return;}res.setHeader('Content-Type','image/svg+xml; charset=utf-8');res.setHeader('Cache-Control','public, max-age=300');res.end(req.method==='HEAD'?'':svg);return;}
  if((req.method==='GET'||req.method==='HEAD')&&(pathname.startsWith('/proposal/')||pathname.startsWith('/propunere/'))&&isLinkScannerBot(String(req.headers['user-agent']||''))){const prefix=pathname.startsWith('/proposal/')?'/proposal/':'/propunere/';const slug=decodeURIComponent(pathname.slice(prefix.length).split('/')[0]||'');const pubOrigin=(process.env.PUBLIC_APP_URL||`http://${req.headers.host||'localhost:4100'}`).replace(/\/$/,'');const ogHtml=renderProposalOpenGraphHtml(store,slug,pubOrigin);if(ogHtml){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.method==='HEAD'?'':ogHtml);return;}}
  if((req.method==='GET'||req.method==='HEAD')&&pathname!=='/graphql'&&webAvailable()){void serveWeb(req,res);return;}
  const origin=req.headers.origin;if(origin&&!origins.has(origin)){res.writeHead(403);res.end('Origin not allowed');return;}
  if(req.method==='POST'&&!origin&&req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Cross-site request rejected');return;}
  if(Number(req.headers['content-length']||0)>8000000){res.writeHead(413);res.end('Request too large');return;}
  let received=0;req.on('data',(chunk:Buffer)=>{received+=chunk.length;if(received>8000000){if(!res.headersSent)res.writeHead(413);res.end('Request too large');req.destroy();}});
  if(req.method==='GET'&&req.url?.includes('mutation')){res.writeHead(405);res.end('Use POST for mutations');return;}
  void yoga(req,res);
});
missionControl=mountConfiguredMissionControl(store,server);
const wsServer=new WebSocketServer({noServer:true,maxPayload:2000000});
const deviceWsServer=new WebSocketServer({noServer:true,maxPayload:2000000});
server.on('upgrade',(request,socket,head)=>{
  const pathname=new URL(request.url||'/','http://localhost').pathname;
  if(missionControl?.ownsUpgrade(pathname))return;
  if(pathname==='/ws/device'){
    deviceWsServer.handleUpgrade(request,socket,head,ws=>{
      const token=String(request.headers['x-starli-device-token']||request.headers['authorization']||'');
      attachDeviceWebSocket(store,events,ws,token);
    });
    return;
  }
  if(pathname==='/graphql'){
    const origin=request.headers.origin;
    if((origin&&!origins.has(origin))||wsServer.clients.size>=100){socket.destroy();return;}
    wsServer.handleUpgrade(request,socket,head,ws=>{wsServer.emit('connection',ws,request);});
    return;
  }
  socket.destroy();
});
const wsCleanup=useServer({schema,context:(ctx)=>sessionContext(store,ctx.extra.request.headers.cookie||'',()=>{},'ws:'+clientIP(ctx.extra.request),String(ctx.connectionParams?.authorization||ctx.extra.request.headers.authorization||ctx.extra.request.headers['x-starli-operator-token']||'')),onConnect:(ctx)=>{if(ctx.extra.request.headers.origin&&!origins.has(ctx.extra.request.headers.origin))return false;},onSubscribe:(ctx,_id,payload)=>{if(Object.keys(ctx.subscriptions).length>10)return [new GraphQLError('Maximum 10 abonamente pe conexiune.')];if(typeof payload.query!=='string'||payload.query.length>50000)return [new GraphQLError('Interogarea este prea mare.')];try{const document=parse(payload.query);const operation=getOperationAST(document,payload.operationName);if(operation?.operation!=='subscription')return [new GraphQLError('WebSocket acceptă doar abonamente. Folosește HTTP pentru interogări și modificări.')];const errors=validate(schema,document,[...specifiedRules,complexityRule]);if(errors.length)return errors;}catch{return [new GraphQLError('Interogarea nu este validă.')];}}},wsServer);
const stopScheduler=startScheduler(store,()=>events.publish('blog'));
const stopFulfillment=startFulfillmentWorker(store,events);
const stopEmail=startEmailWorker(store,events);const stopMailbox=startMailboxSync(store,events);
const stopDomains=startDomainCommerceWorker(store,events);
const videoWorker=new VideoRenderWorker({store,events,assetServices});
const stopVideoWorker=videoWorker.start();
const port=Number(process.env.PORT||4100);const host=process.env.HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`Starlidigital API http://${host}:${port}/graphql`));
let closing=false;const shutdown=()=>{if(closing)return;closing=true;missionControl?.close();stopScheduler();stopFulfillment();stopEmail();stopDomains();stopVideoWorker();void stopMailbox().then(()=>wsCleanup.dispose()).then(()=>server.close(()=>{store.close();process.exit(0);}));setTimeout(()=>process.exit(1),10000).unref();};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
