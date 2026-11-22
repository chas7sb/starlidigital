import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';
import {hashToken,refresh,sessionContext} from '../security.js';

/** First-party operator UI. Extension-facing requests still use the separate
 * Origin-bound bridge, and never get to provision their own device grant. */
export function createMissionControlEnrollment(store:Store,operatorOrigin:()=>string){
 const key=randomBytes(32);
 const path='/mission-control/operator/device';
 const csrf=(session:string)=>createHmac('sha256',key).update(session).digest('hex');
 const headers={'Cache-Control':'no-store','Referrer-Policy':'same-origin',
  'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
 return async(req:IncomingMessage,res:ServerResponse):Promise<boolean>=>{
  if(req.url!==path)return false;
  const respond=(status:number,body:unknown)=>{
   res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));return true;
  };
  const session=()=>refresh(sessionContext(store,req.headers.cookie??''));
  const ctx=session();
  if(ctx.user?.role!=='ADMIN'||ctx.user.disabled||!ctx.sessionHash||ctx.operatorTokenId)
   return respond(401,{error:'OPERATOR_SESSION_REQUIRED'});
  if(req.method==='GET'){
   res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});
   res.end(`<!doctype html><meta charset="utf-8"><title>Mission Control device access</title>
   <h1>Mission Control device access</h1><p>Approve a device for this signed-in session for 30 minutes, or revoke its access.</p>
   <form method="post"><input type="hidden" name="csrf" value="${csrf(ctx.sessionHash)}">
   <label>Device ID <input name="device" required minlength="2" maxlength="96"></label>
   <button name="action" value="approve">Approve device (sending off)</button><button name="action" value="approve_send">Approve device and allow individually reviewed sends</button><button name="action" value="approve_auto">Authorize automatic commands for verified tabs</button><button name="action" value="revoke">Revoke device</button></form>`);
   return true;
  }
  if(req.method!=='POST'||req.headers.origin!==operatorOrigin()||
    String(req.headers['content-type']??'').split(';')[0]!=='application/x-www-form-urlencoded')
   return respond(403,{error:'OPERATOR_ORIGIN_REQUIRED'});
  const chunks:Buffer[]=[];
  let bytes=0;
  for await(const chunk of req){
   const buffer=Buffer.from(chunk);
   bytes+=buffer.length;
   if(bytes>1024)return respond(413,{error:'REQUEST_TOO_LARGE'});
   chunks.push(buffer);
  }
  const form=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const submitted=form.get('csrf')??'',device=form.get('device')??'',action=form.get('action');
  const current=session();
  if(current.user?.id!==ctx.user.id||current.user.role!=='ADMIN'||current.user.disabled||
   current.sessionHash!==ctx.sessionHash||current.operatorTokenId||
   !/^[a-f0-9]{64}$/.test(submitted)||!timingSafeEqual(Buffer.from(submitted),Buffer.from(csrf(ctx.sessionHash))))
   return respond(403,{error:'OPERATOR_CSRF_REQUIRED'});
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{1,95}$/.test(device)||(action!=='approve'&&action!=='approve_send'&&action!=='approve_auto'&&action!=='revoke'))
   return respond(400,{error:'INVALID_DEVICE_ACTION'});
  const owner=String(current.user.id),now=Date.now();
  let paired=store.get('browser_bridge_devices',device);
  if(paired&&paired.ownerId!==owner)return respond(403,{error:'DEVICE_OWNER_MISMATCH'});
  if(action==='revoke'){
   store.db.exec('BEGIN IMMEDIATE');
   try{
    paired=store.get('browser_bridge_devices',device);
    if(paired&&paired.ownerId!==owner)throw Error('DEVICE_OWNER_MISMATCH');
    const live=session();
    if(live.user?.id!==owner||live.user.role!=='ADMIN'||live.user.disabled||live.sessionHash!==current.sessionHash)
     throw Error('OPERATOR_SESSION_CHANGED');
    store.db.prepare('UPDATE mc_bridge_device_grants SET revoked_at=? WHERE tenant=? AND user_id=? AND device_id=?')
     .run(now,owner,owner,device);
    if(paired)store.put('browser_bridge_devices',{...paired,active:false,sendEnabled:false,revokedAt:now},owner);
    store.db.exec('COMMIT');
   }catch{if(store.db.isTransaction)store.db.exec('ROLLBACK');return respond(409,{error:'DEVICE_REVOKE_FENCED'});}
   return respond(200,{deviceId:device,state:'REVOKED'});
  }
  const token=randomBytes(32).toString('base64url'),expiresAt=now+30*60_000;
  store.db.exec('BEGIN IMMEDIATE');
  try{
   paired=store.get('browser_bridge_devices',device);
   if(paired&&paired.ownerId!==owner)throw Error('DEVICE_OWNER_MISMATCH');
   const live=session();
   if(live.user?.id!==owner||live.user.role!=='ADMIN'||live.user.disabled||live.sessionHash!==current.sessionHash)
    throw Error('OPERATOR_SESSION_CHANGED');
   if(store.db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(owner)){
    store.db.exec('ROLLBACK');
    return respond(409,{error:'MISSION_CONTROL_STOPPED'});
   }
   store.db.prepare('UPDATE mc_bridge_device_grants SET revoked_at=? WHERE tenant=? AND device_id=?')
    .run(now,owner,device);
   store.db.prepare(`INSERT INTO mc_bridge_device_grants(tenant,user_id,device_id,session_hash,session_epoch,csrf_hash,expires_at,revoked_at)
    VALUES(?,?,?,?,0,?,?,NULL) ON CONFLICT(tenant,device_id,session_hash) DO UPDATE SET
    session_epoch=session_epoch+1,csrf_hash=excluded.csrf_hash,expires_at=excluded.expires_at,revoked_at=NULL`)
    .run(owner,owner,device,current.sessionHash,hashToken(token),expiresAt);
   store.put('browser_bridge_devices',{...paired,id:device,ownerId:owner,name:paired?.name??'Mission Control device',
    active:true,sendEnabled:action==='approve_send'||action==='approve_auto',automaticSendEnabled:action==='approve_auto',transport:'mission-control',lastSeen:now},owner);
   store.db.exec('COMMIT');
  }catch(error){if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
  return respond(200,{deviceId:device,csrfToken:token,expiresAt});
 };
}
