import type {IncomingMessage} from 'node:http';
import type {Store} from '../store.js';
import {sessionContext,refresh,hashToken} from '../security.js';
import type {BridgePrincipal} from './lcg3-browser-transport.js';

/** Real host identity adapter: no browser role, tenant, session or CSRF claims are trusted.
 * Device grants must be provisioned by a separately authenticated, approved host workflow.
 * If the STOP table or active grant is absent, the bridge stays closed. */
export function createStoreBackedBridgeAuthority(store:Store){
 store.db.exec(`CREATE TABLE IF NOT EXISTS mc_bridge_device_grants(
  tenant TEXT NOT NULL, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
  session_hash TEXT NOT NULL, session_epoch INTEGER NOT NULL,
  csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER,
  PRIMARY KEY(tenant,device_id,session_hash));`);
 type Grant={tenant:string;user_id:string;device_id:string;session_hash:string;
  session_epoch:number;csrf_hash:string;expires_at:number;revoked_at:number|null};
 const grants=store.db.prepare('SELECT * FROM mc_bridge_device_grants WHERE tenant=? AND user_id=? AND device_id=? AND session_hash=?');
 const identity=(req:IncomingMessage)=>{
  const ctx=refresh(sessionContext(store,req.headers.cookie||'',()=>{}));
  if(!ctx.user||ctx.user.disabled||ctx.user.role!=='ADMIN'||!ctx.sessionHash||ctx.operatorTokenId)return;
  const device=req.headers['x-mc-device-id'];
  if(typeof device!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{1,95}$/.test(device))return;
  const tenant=String(ctx.user.id),user=String(ctx.user.id);
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,127}$/.test(tenant))return;
  const grant=grants.get(tenant,user,device,ctx.sessionHash) as Grant|undefined;
  if(!grant||grant.revoked_at!==null||!Number.isSafeInteger(grant.session_epoch)||
   grant.session_epoch<0||!Number.isSafeInteger(grant.expires_at)||grant.expires_at<=Date.now())return;
  const principal:BridgePrincipal={tenantId:tenant,subjectId:user,deviceId:device,
   sessionId:ctx.sessionHash,sessionEpoch:grant.session_epoch};
  return {principal,grant};
 };
 const matches=(req:IncomingMessage,p:BridgePrincipal)=>{
  const actual=identity(req)?.principal;
  return !!actual&&actual.tenantId===p.tenantId&&actual.subjectId===p.subjectId&&
   actual.deviceId===p.deviceId&&actual.sessionId===p.sessionId&&actual.sessionEpoch===p.sessionEpoch;
 };
 const verifyNotStopped=async(p:BridgePrincipal)=>{
  try{
   const exists=store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mc_tenant_stop'").get();
   if(!exists)return false;
   return !store.db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(p.tenantId);
  }catch{return false;}
 };
 return {
  authenticate:async(req:IncomingMessage)=>identity(req)?.principal,
  verifyGrant:async(req:IncomingMessage,p:BridgePrincipal)=>matches(req,p)&&await verifyNotStopped(p),
  verifyCsrf:async(req:IncomingMessage,p:BridgePrincipal)=>{
   const raw=req.headers['x-csrf-token'];
   if(typeof raw!=='string'||raw.length<16||raw.length>256||!matches(req,p))return false;
   const found=identity(req)?.grant;
   return !!found&&found.csrf_hash===hashToken(raw)&&await verifyNotStopped(p);
  },
  verifyNotStopped,
 };
}
