import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';
import {createStoreBackedBridgeAuthority} from './lcg9-host-authority.js';
import {refresh,sessionContext,hashToken} from '../security.js';

/** Explicitly collected page text is untrusted telemetry. It never changes a
 * command, consumes an approval, supplies a witness or triggers agent work. */
export function createResponseCollection(store:Store,origins:readonly string[]){
 const authority=createStoreBackedBridgeAuthority(store),db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS mc_response_observations(
  tenant TEXT NOT NULL,device_id TEXT NOT NULL,tab_id INTEGER NOT NULL,session_id TEXT NOT NULL,
  conversation TEXT NOT NULL,response_text TEXT NOT NULL,truncated INTEGER NOT NULL,observed_at INTEGER NOT NULL,
  PRIMARY KEY(tenant,device_id,tab_id));`);
 return async(req:IncomingMessage,res:ServerResponse)=>{
  if(req.url?.split('?')[0]!=='/mission-control/bridge/response')return false;
  const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',
   'X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));return true;};
  const origin=req.headers.origin;
  if(typeof origin!=='string'||!origins.includes(origin)||req.headers.authorization)return reply(403,{error:'RESPONSE_ORIGIN_DENIED'});
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','content-type,x-csrf-token,x-mc-device-id');
   res.writeHead(204);res.end();return true;
  }
  if(req.method!=='POST'||String(req.headers['content-type']??'').split(';')[0]!=='application/json')return reply(403,{error:'RESPONSE_REQUEST_DENIED'});
  const p=await authority.authenticate(req);
  if(!p||!await authority.verifyGrant(req,p)||!await authority.verifyCsrf(req,p))return reply(403,{error:'RESPONSE_AUTHORITY_DENIED'});
  let size=0;const parts:Buffer[]=[];
  for await(const part of req){const b=Buffer.from(part);size+=b.length;if(size>40000)return reply(413,{error:'RESPONSE_TOO_LARGE'});parts.push(b);}
  let value:Record<string,unknown>;
  try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return reply(400,{error:'RESPONSE_INVALID'});}
  if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['tabId','sessionId','conversation','text','truncated'].includes(k))||
   !Number.isSafeInteger(value.tabId)||typeof value.sessionId!=='string'||typeof value.conversation!=='string'||
   typeof value.text!=='string'||!value.text.trim()||value.text.length>8000||typeof value.truncated!=='boolean')
   return reply(400,{error:'RESPONSE_INVALID'});
  // Reauthentication after the streamed body closes revoke/STOP timing gaps.
  if(!await authority.verifyGrant(req,p)||!await authority.verifyCsrf(req,p))return reply(403,{error:'RESPONSE_AUTHORITY_DENIED'});
  try{
   db.exec('BEGIN IMMEDIATE');
   const now=Date.now(),tab=db.prepare(`SELECT session_id,expected_url,session_hash,session_epoch,verified_at,source
    FROM mc_verified_tab_bindings WHERE tenant=? AND device_id=? AND tab_id=?`).get(p.tenantId,p.deviceId,Number(value.tabId));
   const device=store.get('browser_bridge_devices',p.deviceId);
   const current=refresh(sessionContext(store,req.headers.cookie??''));
   const grant=db.prepare(`SELECT 1 FROM mc_bridge_device_grants WHERE tenant=? AND user_id=? AND device_id=?
    AND session_hash=? AND session_epoch=? AND revoked_at IS NULL AND expires_at>? AND csrf_hash=?`)
    .get(p.tenantId,p.subjectId,p.deviceId,p.sessionId!,p.sessionEpoch!,now,hashToken(String(req.headers['x-csrf-token']??'')));
   if(!grant||current.user?.id!==p.subjectId||current.user.role!=='ADMIN'||current.user.disabled||current.operatorTokenId||
    current.sessionHash!==p.sessionId||device?.ownerId!==p.tenantId||device.active!==true||device.transport!=='mission-control'||
    db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(p.tenantId)||
    !tab||!['OPERATOR_CONFIRMED','TRUSTED_HOST_VERIFIED'].includes(String(tab.source))||
    tab.session_id!==value.sessionId||tab.expected_url!==value.conversation||tab.session_hash!==p.sessionId||
    tab.session_epoch!==p.sessionEpoch||Number(tab.verified_at)>now||now-Number(tab.verified_at)>30000)throw Error('DENIED');
   db.prepare(`INSERT INTO mc_response_observations VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant,device_id,tab_id)
    DO UPDATE SET session_id=excluded.session_id,conversation=excluded.conversation,response_text=excluded.response_text,
    truncated=excluded.truncated,observed_at=excluded.observed_at`)
    .run(p.tenantId,p.deviceId,Number(value.tabId),String(value.sessionId),String(value.conversation),String(value.text),value.truncated?1:0,now);
   db.exec('COMMIT');return reply(200,{collected:true,source:'EXTENSION_REPORTED',verified:false});
  }catch{if(db.isTransaction)db.exec('ROLLBACK');return reply(409,{error:'RESPONSE_TARGET_FENCED'});}
 };
}
