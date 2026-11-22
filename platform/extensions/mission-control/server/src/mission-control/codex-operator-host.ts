import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {Lcg2MissionControlQueue} from './lcg2-queue.js';
import {createOperatorStop} from './codex-operator-stop.js';
import {startStageWatchdogHost} from './lcg9-stage-watchdog-host.js';
import type {IncomingMessage,ServerResponse,Server} from 'node:http';
import type {Store} from '../store.js';
import {createMissionControlEnrollment} from './device-enrollment.js';
import {createStageBridgeBootstrap} from './codex-stage-bootstrap.js';
import {createStageTabEnrollment} from './codex-stage-tab-enrollment.js';
import {createStageCommandApproval} from './lcg9-stage-command-approval.js';
import {createStageSendPermit} from './codex-stage-send-permit.js';
import {createStoreBackedBridgeAuthority} from './lcg9-host-authority.js';
import {mountTrustedMissionControlBridge} from './lcg9-production-mount.js';
import {createStageEffectReceiptIngress} from './lcg9-stage-effect-ingress.js';
import {createOperatorDashboard} from './codex-operator-dashboard.js';
import {createResponseCollection} from './codex-response-collection.js';
import {createPrepareCommand} from './codex-prepare-command.js';

/** Host composition over the EXISTING canonical Store and HTTP server.
 * No listener, login bootstrap, provider action or production activation occurs
 * here. The owning host must invoke handleHttp before its catchall and preserve
 * /mission-control/bridge/ws for the attached noServer upgrade listener. */
export function mountMissionControlOperatorHost(config:{
 store:Store;server:Server;operatorOrigin:string;extensionOrigins:readonly string[];
 isolatedLoopbackTest?:boolean;operatorPathPrefix?:string;witness?:{witnessPublicKeyPem:string;witnessId:string};
}){
 const origin=new URL(config.operatorOrigin);
 if(origin.origin!==config.operatorOrigin||origin.username||origin.password||
   (origin.protocol!=='https:'&&!(config.isolatedLoopbackTest&&origin.protocol==='http:'&&
    ['127.0.0.1','localhost','[::1]'].includes(origin.hostname))))
   throw Error('MC_OPERATOR_HTTPS_ORIGIN_REQUIRED');
 const {store,server}=config;
 if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mc_tenant_stop'").get())
  throw Error('MC_DURABLE_STOP_SCHEMA_REQUIRED');
 const database=store.db.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file;
 if(typeof database!=='string'||!database)throw Error('MC_SHARED_DURABLE_DATABASE_REQUIRED');
 const stopKey=randomBytes(32),queue=new Lcg2MissionControlQueue(database,Date.now,stopKey);
 let bridgeClose:(()=>void)|undefined;
 try{
 const stop=createOperatorStop(store,()=>config.operatorOrigin,(tenant,operator,reason)=>{
  const issuedAtMs=Date.now(),nonce=randomUUID();
  const signature=createHmac('sha256',stopKey).update(JSON.stringify(['LCG2_STOP_V1',tenant,operator,reason,issuedAtMs,nonce])).digest('hex');
  return queue.stopTenant(tenant,operator,reason,{issuedAtMs,nonce,signature});
 });
 const grant=createStoreBackedBridgeAuthority(store);
 const prefix=config.operatorPathPrefix??'';
 if(prefix!==''&&prefix!=='/mission-control-preview')throw Error('MC_OPERATOR_PREFIX_INVALID');
 const handlers=[createOperatorDashboard(store,prefix),createPrepareCommand(store,()=>config.operatorOrigin,prefix),stop,
  createMissionControlEnrollment(store,()=>config.operatorOrigin),
  createStageBridgeBootstrap(store,config.extensionOrigins),
  createStageTabEnrollment(store,config.extensionOrigins,()=>config.operatorOrigin),
  createStageCommandApproval(store,()=>config.operatorOrigin),
  createStageSendPermit(store,config.extensionOrigins),
  createResponseCollection(store,config.extensionOrigins),
 ];
 if(config.witness)handlers.push(createStageEffectReceiptIngress(store,config.witness));
 const bridge=mountTrustedMissionControlBridge({db:store.db,server,allowedOrigins:config.extensionOrigins,...grant});
 bridgeClose=()=>bridge.close();
 const watchdog=startStageWatchdogHost(store,()=>bridge.disconnectClients());
 let closed=false;
 return {
  async handleHttp(req:IncomingMessage,res:ServerResponse){
   const path=req.url?.split('?')[0];
   if(path!=='/mission-control'&&!path?.startsWith('/mission-control/'))return false;
   if(closed){res.writeHead(503);res.end();return true;}
   try{
    for(const handler of handlers)if(await handler(req,res))return true;
    if(await bridge.handleHttp(req,res))return true;
    res.writeHead(404,{'Cache-Control':'no-store'});res.end();return true;
   }catch{
    if(!res.headersSent)res.writeHead(503,{'Cache-Control':'no-store'});
    res.end();return true;
   }
  },
  ownsUpgrade:(path:string)=>!closed&&path==='/mission-control/bridge/ws',
  reconcile:()=>bridge.reconcile(),
  close:()=>{if(closed)return;closed=true;watchdog.close();bridge.close();queue.close();},
 };
 }catch(error){bridgeClose?.();queue.close();throw error;}
}
