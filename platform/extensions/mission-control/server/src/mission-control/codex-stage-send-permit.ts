import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';
import {createStoreBackedBridgeAuthority} from './lcg9-host-authority.js';

export const sendPermitPath='/mission-control/bridge/send-permit';
/** Isolated stage only. A grant is a bounded permission to attempt one click,
 * never evidence of submission. Commit consumes the canonical command forever;
 * if its response is lost the caller must NOT retry or create a second command. */
export function createStageSendPermit(store:Store,origins:readonly string[]){
 if(!origins.length||origins.some(x=>!/^chrome-extension:\/\/[a-p]{32}$/.test(x)))
  throw Error('SEND_PERMIT_ORIGIN_REQUIRED');
 const authority=createStoreBackedBridgeAuthority(store),db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS mc_browser_send_attempts(
  command_id TEXT PRIMARY KEY, tenant TEXT NOT NULL, device_id TEXT NOT NULL,
  session_hash TEXT NOT NULL, session_epoch INTEGER NOT NULL, nonce TEXT NOT NULL,
  attempted_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
 const reply=(res:ServerResponse,status:number,body:unknown)=>{
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',
   'X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));return true;
 };
 return async(req:IncomingMessage,res:ServerResponse)=>{
  if(req.url?.split('?')[0]!==sendPermitPath)return false;
  const origin=req.headers.origin;
  if(typeof origin!=='string'||!origins.includes(origin)||req.headers.authorization)
   return reply(res,403,{error:'SEND_PERMIT_DENIED'});
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','POST');
   res.setHeader('Access-Control-Allow-Headers','content-type,x-csrf-token,x-mc-device-id');
   res.writeHead(204);res.end();return true;
  }
  if(req.method!=='POST'||String(req.headers['content-type']??'').split(';')[0]!=='application/json')
   return reply(res,403,{error:'SEND_PERMIT_DENIED'});
  const principal=await authority.authenticate(req);
  if(!principal||typeof principal.sessionId!=='string'||!Number.isSafeInteger(principal.sessionEpoch)||!await authority.verifyGrant(req,principal)||!await authority.verifyCsrf(req,principal))
   return reply(res,403,{error:'SEND_PERMIT_DENIED'});
  let bytes=0;const chunks:Buffer[]=[];
  for await(const part of req){const b=Buffer.from(part);bytes+=b.length;
   if(bytes>12000)return reply(res,413,{error:'SEND_PERMIT_TOO_LARGE'});chunks.push(b);}
  let input:Record<string,unknown>;
  try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{return reply(res,400,{error:'SEND_PERMIT_INVALID'});}
  if(!input||Array.isArray(input)||typeof input!=='object'||
   Object.keys(input).some(k=>!['commandId','nonce','sessionId','tabId','conversation','text','phase'].includes(k))||
   !['preflight','commit'].includes(String(input.phase))||
   !['commandId','nonce','sessionId','conversation','text'].every(k=>typeof input[k]==='string')||
   !Number.isSafeInteger(input.tabId)||Number(input.tabId)<=0)
   return reply(res,400,{error:'SEND_PERMIT_INVALID'});
  // Revalidate AFTER streamed body; then check all durable facts synchronously
  // inside the same write transaction, closing cross-process revoke/STOP races.
  if(!await authority.verifyGrant(req,principal)||!await authority.verifyCsrf(req,principal))
   return reply(res,403,{error:'SEND_PERMIT_DENIED'});
  try{
   db.exec('BEGIN IMMEDIATE');
   const now=Date.now(),owner=principal.tenantId;
   const sessionHash=principal.sessionId!,sessionEpoch=principal.sessionEpoch!;
   const command=store.get('browser_bridge_commands',String(input.commandId));
   const device=store.get('browser_bridge_devices',principal.deviceId);
   const grant=db.prepare(`SELECT session_epoch FROM mc_bridge_device_grants
    WHERE tenant=? AND user_id=? AND device_id=? AND session_hash=?
    AND session_epoch=? AND revoked_at IS NULL AND expires_at>?`).get(
     owner,principal.subjectId,principal.deviceId,sessionHash,sessionEpoch,now);
   const tab=db.prepare(`SELECT * FROM mc_verified_tab_bindings
    WHERE tenant=? AND device_id=? AND tab_id=?`).get(owner,principal.deviceId,Number(input.tabId)) as Record<string,unknown>|undefined;
   if(!grant||db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(owner)||
    !command||command.ownerId!==owner||command.deviceId!==principal.deviceId||command.status!=='dispatched'||
    command.action!=='send'||command.missionControlNonce!==input.nonce||
    command.missionControlSessionId!==input.sessionId||command.expectedUrl!==input.conversation||
    command.text!==input.text||String(command.sessionId)!==String(input.tabId)||
    command.missionControlOperatorSessionHash!==principal.sessionId||
    command.missionControlSessionEpoch!==principal.sessionEpoch||
    device?.ownerId!==owner||device.active!==true||device.sendEnabled!==true||device.transport!=='mission-control'||
    !tab||!['TRUSTED_HOST_VERIFIED','OPERATOR_CONFIRMED'].includes(String(tab.source))||tab.session_hash!==principal.sessionId||
    tab.session_epoch!==principal.sessionEpoch||tab.session_id!==input.sessionId||tab.expected_url!==input.conversation||
    !Number.isSafeInteger(tab.verified_at)||Number(tab.verified_at)>now||now-Number(tab.verified_at)>30000||
    db.prepare('SELECT 1 FROM mc_browser_send_attempts WHERE command_id=?').get(command.id))
     throw Error('DENIED');
   const expiresAt=now+1000;
   if(input.phase==='commit')db.prepare('INSERT INTO mc_browser_send_attempts VALUES(?,?,?,?,?,?,?,?)').run(
    command.id,owner,principal.deviceId,sessionHash,sessionEpoch,String(input.nonce),now,expiresAt);
   db.exec('COMMIT');
   return reply(res,200,{authorized:true,phase:input.phase,commandId:input.commandId,nonce:input.nonce,
    sessionId:input.sessionId,tabId:input.tabId,conversation:input.conversation,
    issuedAt:now,ttlMs:1000,expiresAt,executed:false,oneUse:input.phase==='commit'});
  }catch{
   if(db.isTransaction)db.exec('ROLLBACK');
   return reply(res,409,{error:'SEND_PERMIT_DENIED_OR_ALREADY_ATTEMPTED'});
  }
 };
}
