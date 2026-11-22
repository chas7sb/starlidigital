import {randomBytes} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';
import {hashToken,refresh,sessionContext} from '../security.js';
import {createStoreBackedBridgeAuthority} from './lcg9-host-authority.js';

/** Bootstrap only a device ALREADY granted by the first-party operator UI.
 * Exact extension Origin is required. No grant creation, cookies or session hash
 * in the response. Token rotation is transactional and invalidates older CSRF. */
export function createStageBridgeBootstrap(store:Store,allowedOrigins:readonly string[]){
 if(!allowedOrigins.length||allowedOrigins.some(x=>!/^chrome-extension:\/\/[a-p]{32}$/.test(x)))
  throw Error('BOOTSTRAP_ORIGIN_REQUIRED');
 const authority=createStoreBackedBridgeAuthority(store),db=store.db;
 return async(req:IncomingMessage,res:ServerResponse)=>{
  if(req.url?.split('?')[0]!=='/mission-control/bridge/bootstrap')return false;
  const reply=(status:number,value:unknown)=>{
   res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
   res.end(JSON.stringify(value));return true;
  };
  const origin=req.headers.origin;
  if(typeof origin!=='string'||!allowedOrigins.includes(origin)||req.headers.authorization)
   return reply(403,{error:'BOOTSTRAP_DENIED'});
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');
  res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','POST');
   res.setHeader('Access-Control-Allow-Headers','x-mc-device-id');
   res.writeHead(204);res.end();return true;
  }
  // Body-free protocol: device ID comes from one bounded header. Never parse
  // device/role/tenant claims from user-controlled JSON or query parameters.
  if(req.method!=='POST'||(req.headers['content-length']&&req.headers['content-length']!=='0')||
    req.headers['transfer-encoding'])return reply(403,{error:'BOOTSTRAP_DENIED'});
  const principal=await authority.authenticate(req);
  if(!principal||typeof principal.sessionId!=='string'||!Number.isSafeInteger(principal.sessionEpoch)||
    !await authority.verifyGrant(req,principal))return reply(403,{error:'APPROVED_DEVICE_SESSION_REQUIRED'});
  try{
   db.exec('BEGIN IMMEDIATE');
   const current=refresh(sessionContext(store,req.headers.cookie??''));
   if(current.user?.role!=='ADMIN'||current.user.disabled||current.user.id!==principal.subjectId||
    current.sessionHash!==principal.sessionId||current.operatorTokenId||
    db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(principal.tenantId))
    throw Error('BOOTSTRAP_DENIED');
   const grant=db.prepare(`SELECT expires_at FROM mc_bridge_device_grants
    WHERE tenant=? AND user_id=? AND device_id=? AND session_hash=? AND session_epoch=?
    AND revoked_at IS NULL AND expires_at>?`).get(
     principal.tenantId,principal.subjectId,principal.deviceId,principal.sessionId,principal.sessionEpoch!,Date.now()) as
     {expires_at:number}|undefined;
   if(!grant)throw Error('BOOTSTRAP_DENIED');
   const token=randomBytes(32).toString('base64url'),expiresAt=Math.min(grant.expires_at,Date.now()+10*60_000);
   db.prepare(`UPDATE mc_bridge_device_grants SET csrf_hash=?
    WHERE tenant=? AND user_id=? AND device_id=? AND session_hash=? AND session_epoch=?`).run(
     hashToken(token),principal.tenantId,principal.subjectId,principal.deviceId,principal.sessionId,principal.sessionEpoch!);
   db.exec('COMMIT');
   const paired=store.get('browser_bridge_devices',principal.deviceId);
   const automaticSendEnabled=paired?.ownerId===principal.tenantId&&paired.active===true&&paired.sendEnabled===true&&paired.automaticSendEnabled===true;
   return reply(200,{deviceId:principal.deviceId,token,origin,expiresAt,sessionEpoch:principal.sessionEpoch,automaticSendEnabled});
  }catch{if(db.isTransaction)db.exec('ROLLBACK');return reply(409,{error:'BOOTSTRAP_DENIED'});}
 };
}
