import {createHmac,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';
import {refresh,sessionContext} from '../security.js';
import {createLegacyCommandOutbox} from './legacy-command-outbox.js';

const path='/mission-control/operator/command';
const canonicalUrl=/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]{8,128}$/;
const commandIdPattern=/^[a-f0-9]{64}$/;
const escapeHtml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** Only isolated staging. A first-party ADMIN session and explicit reviewed
 * text/URL form are not sufficient: the canonical Store.db must ALSO hold an
 * unexpired trusted server-attested tab binding with session epoch and a live
 * user-granted device capability. No endpoint here creates tab attestations. */
export function createStageCommandApproval(store:Store,operatorOrigin:()=>string){
 const key=randomBytes(32);
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS mc_verified_tab_bindings(
  tenant TEXT NOT NULL,device_id TEXT NOT NULL,tab_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,expected_url TEXT NOT NULL,session_hash TEXT NOT NULL,session_epoch INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,source TEXT NOT NULL,
  PRIMARY KEY(tenant,device_id,tab_id));`);
 const sign=(sessionHash:string,commandId:string,fingerprint:string)=>createHmac('sha256',key)
  .update(JSON.stringify(['MC_STAGE_COMMAND_V1',sessionHash,commandId,fingerprint])).digest('hex');
 const fingerprint=(row:Record<string,unknown>)=>createHash('sha256')
  .update(JSON.stringify([row.id,row.deviceId,row.sessionId,row.expectedUrl,row.text])).digest('hex');
 const respond=(res:ServerResponse,status:number,data:unknown)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
   'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});
  res.end(JSON.stringify(data));return true;
 };
 const dispatch=createLegacyCommandOutbox(store,command=>{
  // This is called synchronously inside BEGIN IMMEDIATE. No awaits, client
  // claims or legacy heartbeat fields are used as authoritative tab identity.
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mc_tenant_stop'").get())return;
  if(!activeFingerprint||fingerprint(command)!==activeFingerprint)return;
  const grant=db.prepare(`SELECT session_epoch FROM mc_bridge_device_grants
   WHERE tenant=? AND user_id=? AND device_id=? AND session_hash=?
   AND revoked_at IS NULL AND expires_at>?`)
   .get(command.ownerId,command.ownerId,command.deviceId,activeSessionHash,Date.now()) as {session_epoch:number}|undefined;
  if(!grant||!Number.isSafeInteger(grant.session_epoch)||grant.session_epoch<0)return;
  const tab=db.prepare(`SELECT tab_id,session_id,expected_url,session_hash,session_epoch,verified_at,source
   FROM mc_verified_tab_bindings WHERE tenant=? AND device_id=? AND tab_id=?`)
   .get(command.ownerId,command.deviceId,Number(command.sessionId)) as
   {tab_id:number;session_id:string;expected_url:string;session_hash:string;session_epoch:number;verified_at:number;source:string}|undefined;
  const now=Date.now();
  if(!tab||!['TRUSTED_HOST_VERIFIED','OPERATOR_CONFIRMED'].includes(tab.source)||!Number.isSafeInteger(tab.tab_id)||
   tab.session_hash!==activeSessionHash||tab.session_epoch!==grant.session_epoch||!Number.isSafeInteger(tab.verified_at)||
   tab.verified_at>now||now-tab.verified_at>30000||tab.expected_url!==command.expectedUrl||
   !canonicalUrl.test(tab.expected_url))return;
  return {tabId:tab.tab_id,sessionId:tab.session_id,expectedUrl:tab.expected_url,
   operatorSessionHash:activeSessionHash,sessionEpoch:grant.session_epoch};
 });
 // One request at a time per isolated Stage event loop. This scoped variable
 // is set only synchronously immediately before dispatch (no await between).
 let activeSessionHash='';
 let activeFingerprint='';
 return async(req:IncomingMessage,res:ServerResponse):Promise<boolean>=>{
  const url=new URL(req.url??'/',operatorOrigin()||'http://127.0.0.1');
  if(url.pathname!==path)return false;
  const ctx=refresh(sessionContext(store,String(req.headers.cookie??'')));
  if(!ctx.user||ctx.user.disabled||ctx.user.role!=='ADMIN'||!ctx.sessionHash||ctx.operatorTokenId||req.headers.authorization)
   return respond(res,401,{error:'OPERATOR_SESSION_REQUIRED'});
  const owner=String(ctx.user.id),id=url.searchParams.get('commandId')??'';
  if(!commandIdPattern.test(id))return respond(res,400,{error:'COMMAND_ID_INVALID'});
  const row=store.get('browser_bridge_commands',id);
  if(!row||row.ownerId!==owner||row.action!=='send'||row.status!=='queued'||
   typeof row.text!=='string'||row.text.length>2000||!row.text.trim()||
   typeof row.expectedUrl!=='string'||!canonicalUrl.test(row.expectedUrl))
   return respond(res,404,{error:'COMMAND_UNAVAILABLE'});
  const hash=fingerprint(row);
  if(req.method==='GET'){
   const token=sign(ctx.sessionHash,id,hash);
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});
   res.end(`<!doctype html><meta charset="utf-8"><title>Review one Mission Control command</title>
    <h1>Review a single command</h1><p>Stage-only; no automatic retry or claim of execution.</p>
    <p>Device: ${escapeHtml(String(row.deviceId))}</p><p>Tab: ${escapeHtml(String(row.sessionId))}</p>
    <p>URL: ${escapeHtml(row.expectedUrl)}</p><pre>${escapeHtml(row.text)}</pre>
    <form method="post"><input name="csrf" type="hidden" value="${token}">
    <input name="fingerprint" type="hidden" value="${hash}">
    <button type="submit">Approve exact reviewed command once</button></form>`);
   return true;
  }
  if(req.method!=='POST'||req.headers.origin!==operatorOrigin()||
   String(req.headers['content-type']??'').split(';')[0]!=='application/x-www-form-urlencoded')
   return respond(res,403,{error:'ORIGIN_OR_FORM_REQUIRED'});
  let raw='';
  for await(const part of req){raw+=String(part);if(Buffer.byteLength(raw)>2048)return respond(res,413,{error:'FORM_TOO_LARGE'});}
  const form=new URLSearchParams(raw),csrf=form.get('csrf')??'',providedHash=form.get('fingerprint')??'';
  const current=refresh(sessionContext(store,String(req.headers.cookie??'')));
  if(current.user?.id!==owner||current.user.disabled||current.user.role!=='ADMIN'||
   current.sessionHash!==ctx.sessionHash||current.operatorTokenId||
   !/^[a-f0-9]{64}$/.test(csrf)||!/^[a-f0-9]{64}$/.test(providedHash)||providedHash!==hash)
   return respond(res,403,{error:'APPROVAL_FENCE_DENIED'});
  const expected=sign(ctx.sessionHash,id,hash);
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(csrf)))return respond(res,403,{error:'CSRF_DENIED'});
  try{
   activeSessionHash=ctx.sessionHash;
   activeFingerprint=hash;
   const event=dispatch(owner,id);
   return respond(res,202,{commandId:event.eventId,status:'OFFERED_AWAITING_SEPARATE_EXTENSION_APPROVAL',
    executed:false});
  }catch{return respond(res,409,{error:'DISPATCH_NOT_AUTHORIZED_OR_ALREADY_ATTEMPTED'});}
  finally{activeSessionHash='';activeFingerprint='';}
 };
}
