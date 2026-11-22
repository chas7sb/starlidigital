import type {IncomingMessage,Server as HttpServer,ServerResponse} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';
import {BrowserEventStore,createProductionBrowserTransport,type BridgePrincipal} from './lcg3-browser-transport.js';

/** Host composition seam. No implicit startup, credentials, or permissive fallbacks.
 * Host MUST route bridge HTTP requests before its catchall, supply trusted durable
 * session/device/CSRF/STOP verifiers and install the upgrade handler on the same server.
 * Safe to construct only after authenticators and a real device grant store exist.
 */
export type TrustedBridgeHost={
 db:DatabaseSync;
 server:HttpServer;
 allowedOrigins:readonly string[];
 authenticate:(req:IncomingMessage)=>Promise<BridgePrincipal|undefined>;
 verifyGrant:(req:IncomingMessage,principal:BridgePrincipal)=>Promise<boolean>;
 verifyCsrf:(req:IncomingMessage,principal:BridgePrincipal)=>Promise<boolean>;
 verifyNotStopped:(principal:BridgePrincipal)=>Promise<boolean>;
 reconcileEveryMs?:number;
};
export function mountTrustedMissionControlBridge(config:TrustedBridgeHost){
 if(!config||!config.server||typeof config.server.on!=='function'||!config.db||
  !config.authenticate||typeof config.authenticate!=='function'||
  typeof config.verifyGrant!=='function'||typeof config.verifyCsrf!=='function'||
  typeof config.verifyNotStopped!=='function')throw Error('MC_TRUSTED_HOST_REQUIRED');
 const ms=config.reconcileEveryMs??1000;
 if(!Number.isSafeInteger(ms)||ms<250||ms>5000)throw Error('MC_INVALID_RECONCILIATION_INTERVAL');
 let stopped=false;
 const check=async(p:BridgePrincipal)=>{
  if(stopped)return false;
  try{return await config.verifyNotStopped(p)===true;}catch{return false;}
 };
 const transport=createProductionBrowserTransport({
  store:new BrowserEventStore(config.db),authenticate:config.authenticate,
  allowedOrigins:config.allowedOrigins,
  verifyGrant:async(req,p)=>await check(p)&&await config.verifyGrant(req,p)===true&&await check(p),
  verifyCsrf:async(req,p)=>await check(p)&&await config.verifyCsrf(req,p)===true&&await check(p),
 });
 transport.install(config.server);
 let busy=false;
 const timer=setInterval(()=>{
  if(busy||stopped)return;
  busy=true;
  void transport.reconcileRevocations().catch(()=>{
   // If durable revoke reconciliation is unavailable, refuse future work.
   close();
  }).finally(()=>{busy=false;});
 },ms);
 timer.unref();
 const close=()=>{if(stopped)return;stopped=true;clearInterval(timer);transport.close();};
 return {
  /** The host must invoke this before any 404 / GraphQL fallback. */
  handleHttp:(req:IncomingMessage,res:ServerResponse)=>transport.handleHttp(req,res),
  /** Reconcile on demand when a trusted operator STOP/revokes a device. */
  reconcile:()=>transport.reconcileRevocations(),
  disconnectClients:()=>transport.disconnectClients(),
  close,
 };
}
