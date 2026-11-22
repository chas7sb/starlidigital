import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';
import {hashToken,refresh,sessionContext} from '../security.js';
import {createStoreBackedBridgeAuthority} from './lcg9-host-authority.js';

const reportPath='/mission-control/bridge/tabs',approvalPath='/mission-control/operator/tabs';
const conversation=/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]{8,128}$/;
type Tab={tabId:number;sessionId:string;conversation:string;title?:string};
type Report={tenant:string;device_id:string;tab_id:number;session_id:string;expected_url:string;
 session_hash:string;session_epoch:number;reported_at:number};
const escape=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const digest=(r:Report)=>createHash('sha256').update(JSON.stringify([
 r.tenant,r.device_id,r.tab_id,r.session_id,r.expected_url,r.session_hash,r.session_epoch])).digest('hex');

/** Extension reports are candidates, NOT attestations. A first-party ADMIN
 * must review each exact tab before an OPERATOR_CONFIRMED binding exists. */
export function createStageTabEnrollment(store:Store,origins:readonly string[],operatorOrigin:()=>string){
 if(!origins.length||origins.some(o=>!/^chrome-extension:\/\/[a-p]{32}$/.test(o)))throw Error('TAB_ORIGIN_REQUIRED');
 const db=store.db,authority=createStoreBackedBridgeAuthority(store),key=randomBytes(32);
 db.exec(`CREATE TABLE IF NOT EXISTS mc_reported_tabs(
  tenant TEXT,device_id TEXT,tab_id INTEGER,session_id TEXT,expected_url TEXT,
  session_hash TEXT,session_epoch INTEGER,reported_at INTEGER,PRIMARY KEY(tenant,device_id,tab_id));
 CREATE TABLE IF NOT EXISTS mc_verified_tab_bindings(
  tenant TEXT,device_id TEXT,tab_id INTEGER,session_id TEXT,expected_url TEXT,
  session_hash TEXT,session_epoch INTEGER,verified_at INTEGER,source TEXT,PRIMARY KEY(tenant,device_id,tab_id));`);
 const sign=(session:string,row:Report)=>createHmac('sha256',key).update(JSON.stringify([session,digest(row)])).digest('hex');
 const reply=(res:ServerResponse,status:number,value:unknown)=>{
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(value));return true;
 };
 const body=async(req:IncomingMessage,max:number)=>{
  const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;
   if(size>max)throw Error('BODY_TOO_LARGE');chunks.push(b);}return Buffer.concat(chunks).toString('utf8');
 };
 const activeGrant=(owner:string,device:string,session:string,epoch:number)=>db.prepare(`SELECT 1 FROM mc_bridge_device_grants
  WHERE tenant=? AND user_id=? AND device_id=? AND session_hash=? AND session_epoch=?
  AND revoked_at IS NULL AND expires_at>?`).get(owner,owner,device,session,epoch,Date.now());
 return async(req:IncomingMessage,res:ServerResponse)=>{
  const path=req.url?.split('?')[0];
  if(path!==reportPath&&path!==approvalPath)return false;
  if(path===reportPath){
   const origin=req.headers.origin;
   if(typeof origin!=='string'||!origins.includes(origin)||req.headers.authorization)return reply(res,403,{error:'TAB_REPORT_DENIED'});
   res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');
   if(req.method==='OPTIONS'){
    res.setHeader('Access-Control-Allow-Methods','POST');
    res.setHeader('Access-Control-Allow-Headers','content-type,x-csrf-token,x-mc-device-id');
    res.writeHead(204);res.end();return true;
   }
   if(req.method!=='POST'||String(req.headers['content-type']??'').split(';')[0]!=='application/json')
    return reply(res,403,{error:'TAB_REPORT_DENIED'});
   const p=await authority.authenticate(req);
   if(!p||!p.sessionId||p.sessionEpoch===undefined||!await authority.verifyGrant(req,p)||!await authority.verifyCsrf(req,p))
    return reply(res,403,{error:'TAB_REPORT_DENIED'});
   let tabs:Tab[];
   try{
    const data=JSON.parse(await body(req,20000));
    if(!data||Array.isArray(data)||Object.keys(data).join(',')!=='tabs'||!Array.isArray(data.tabs)||data.tabs.length>10)
     throw Error('INVALID');
    tabs=data.tabs;
    if(tabs.some(t=>!t||Array.isArray(t)||Object.keys(t).some(k=>!['tabId','sessionId','conversation','title'].includes(k))||
     (t.title!==undefined&&(typeof t.title!=='string'||t.title.length>160))||!Number.isSafeInteger(t.tabId)||t.tabId<=0||typeof t.sessionId!=='string'||
     !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(t.sessionId)||typeof t.conversation!=='string'||!conversation.test(t.conversation))||
     new Set(tabs.map(t=>t.tabId)).size!==tabs.length||new Set(tabs.map(t=>t.sessionId)).size!==tabs.length)throw Error('INVALID');
   }catch{return reply(res,400,{error:'TAB_REPORT_INVALID'});}
   try{
    db.exec('BEGIN IMMEDIATE');
    const current=refresh(sessionContext(store,req.headers.cookie??''));
    if(current.user?.id!==p.subjectId||current.user?.role!=='ADMIN'||current.user.disabled||
     current.sessionHash!==p.sessionId||current.operatorTokenId||
     !activeGrant(p.tenantId,p.deviceId,p.sessionId,p.sessionEpoch)||
     db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(p.tenantId))
      throw Error('DENIED');
    const grant=db.prepare('SELECT csrf_hash FROM mc_bridge_device_grants WHERE tenant=? AND device_id=? AND session_hash=?')
     .get(p.tenantId,p.deviceId,p.sessionId) as {csrf_hash:string}|undefined;
    if(typeof req.headers['x-csrf-token']!=='string'||grant?.csrf_hash!==hashToken(req.headers['x-csrf-token']))throw Error('DENIED');
    const paired=store.get('browser_bridge_devices',p.deviceId);
    if(paired?.ownerId!==p.tenantId||paired.active!==true||paired.transport!=='mission-control')throw Error('DENIED');
    const now=Date.now();
    // Replace only this tenant's authenticated device projection. Raw reports
    // remain invisible to the legacy MCP list until separately confirmed.
    for(const old of store.list('browser_bridge_tabs',p.tenantId))
     if(old.deviceId===p.deviceId)store.remove('browser_bridge_tabs',old.id);
    const bindings=db.prepare('SELECT * FROM mc_verified_tab_bindings WHERE tenant=? AND device_id=?')
     .all(p.tenantId,p.deviceId) as (Report&{source:string})[];
    for(const binding of bindings){
     const match=tabs.find(t=>t.tabId===binding.tab_id&&t.sessionId===binding.session_id&&t.conversation===binding.expected_url);
     if(!match||binding.session_hash!==p.sessionId||binding.session_epoch!==p.sessionEpoch)
      db.prepare('DELETE FROM mc_verified_tab_bindings WHERE tenant=? AND device_id=? AND tab_id=?').run(p.tenantId,p.deviceId,binding.tab_id);
     else if(binding.source==='OPERATOR_CONFIRMED'){
      db.prepare('UPDATE mc_verified_tab_bindings SET verified_at=? WHERE tenant=? AND device_id=? AND tab_id=?')
       .run(now,p.tenantId,p.deviceId,binding.tab_id);
      store.put('browser_bridge_tabs',{id:p.deviceId+':'+binding.tab_id,ownerId:p.tenantId,
       deviceId:p.deviceId,sessionId:String(binding.tab_id),url:binding.expected_url,
       title:match.title?.trim()||'ChatGPT (operator-confirmed)',seenAt:now,missionControl:true},p.tenantId);
     }
    }
    db.prepare('DELETE FROM mc_reported_tabs WHERE tenant=? AND device_id=?').run(p.tenantId,p.deviceId);
    const insert=db.prepare('INSERT INTO mc_reported_tabs VALUES(?,?,?,?,?,?,?,?)');
    for(const t of tabs){
     insert.run(p.tenantId,p.deviceId,t.tabId,t.sessionId,t.conversation,p.sessionId,p.sessionEpoch,now);
     // Display metadata is never an authority or part of a target binding.
     store.put('mc_tab_display',{id:p.deviceId+':'+t.tabId,ownerId:p.tenantId,
      sessionId:t.sessionId,url:t.conversation,title:t.title?.trim()||''},p.tenantId);
    }
    db.exec('COMMIT');
    return reply(res,200,{reported:tabs.length,source:'AUTHENTICATED_EXTENSION_REPORTED',operatorReviewRequired:true,executed:false});
   }catch{if(db.isTransaction)db.exec('ROLLBACK');return reply(res,409,{error:'TAB_REPORT_FENCED'});}
  }
  const ctx=refresh(sessionContext(store,req.headers.cookie??''));
  if(ctx.user?.role!=='ADMIN'||ctx.user.disabled||!ctx.sessionHash||ctx.operatorTokenId||req.headers.authorization)
   return reply(res,401,{error:'OPERATOR_SESSION_REQUIRED'});
  const owner=String(ctx.user.id),session=ctx.sessionHash;
  if(req.method==='GET'){
   const rows=db.prepare('SELECT * FROM mc_reported_tabs WHERE tenant=? AND session_hash=? AND reported_at>? ORDER BY device_id,tab_id LIMIT 100')
    .all(owner,session,Date.now()-30000) as Report[];
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
   res.end('<!doctype html><meta charset="utf-8"><h1>Review reported ChatGPT tabs</h1><p>Reports alone grant no command access. Compare each target with your actual Chrome tab before confirming. No command is sent by this form.</p>'+
    rows.filter(r=>!!activeGrant(owner,r.device_id,session,r.session_epoch)).map(r=>
     `<section><p>Device ${escape(r.device_id)} — Tab ${r.tab_id}</p><p>${escape(r.expected_url)}</p><p>Session ${escape(r.session_id)}</p>
     <form method="post"><input type="hidden" name="device" value="${escape(r.device_id)}"><input type="hidden" name="tab" value="${r.tab_id}">
     <input type="hidden" name="fingerprint" value="${digest(r)}"><input type="hidden" name="csrf" value="${sign(session,r)}">
     <button type="submit">Confirm this exact tab binding</button></form></section>`).join(''));
   return true;
  }
  if(req.method!=='POST'||req.headers.origin!==operatorOrigin()||
   String(req.headers['content-type']??'').split(';')[0]!=='application/x-www-form-urlencoded')
   return reply(res,403,{error:'TAB_CONFIRM_DENIED'});
  let form:URLSearchParams;try{form=new URLSearchParams(await body(req,2000));}
  catch{return reply(res,413,{error:'TAB_CONFIRM_INVALID'});}
  try{
   db.exec('BEGIN IMMEDIATE');
   const current=refresh(sessionContext(store,req.headers.cookie??''));
   const row=db.prepare('SELECT * FROM mc_reported_tabs WHERE tenant=? AND device_id=? AND tab_id=?')
    .get(owner,form.get('device')??'',Number(form.get('tab'))) as Report|undefined;
   const submitted=form.get('csrf')??'';
   const paired=row?store.get('browser_bridge_devices',row.device_id):undefined;
   if(paired?.ownerId!==owner||paired.active!==true||paired.transport!=='mission-control'||current.user?.id!==owner||current.user.role!=='ADMIN'||current.user.disabled||
    current.sessionHash!==session||current.operatorTokenId||!row||row.session_hash!==session||
    Date.now()-row.reported_at>30000||row.reported_at>Date.now()||
    form.get('fingerprint')!==digest(row)||!/^[a-f0-9]{64}$/.test(submitted)||
    !timingSafeEqual(Buffer.from(submitted),Buffer.from(sign(session,row)))||
    !activeGrant(owner,row.device_id,session,row.session_epoch)||
    db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(owner))throw Error('DENIED');
   db.prepare(`INSERT INTO mc_verified_tab_bindings VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant,device_id,tab_id) DO UPDATE SET session_id=excluded.session_id,expected_url=excluded.expected_url,
    session_hash=excluded.session_hash,session_epoch=excluded.session_epoch,verified_at=excluded.verified_at,source=excluded.source`)
    .run(owner,row.device_id,row.tab_id,row.session_id,row.expected_url,session,row.session_epoch,Date.now(),'OPERATOR_CONFIRMED');
   const display=store.get('mc_tab_display',row.device_id+':'+row.tab_id);
   store.put('browser_bridge_tabs',{id:row.device_id+':'+row.tab_id,ownerId:owner,
    deviceId:row.device_id,sessionId:String(row.tab_id),url:row.expected_url,
    title:display?.ownerId===owner&&display.sessionId===row.session_id&&display.url===row.expected_url&&display.title?display.title:'ChatGPT (operator-confirmed)',seenAt:Date.now(),missionControl:true},owner);
   db.exec('COMMIT');
   return reply(res,200,{deviceId:row.device_id,tabId:row.tab_id,state:'OPERATOR_CONFIRMED',executed:false});
  }catch{if(db.isTransaction)db.exec('ROLLBACK');return reply(res,409,{error:'TAB_CONFIRM_FENCED'});}
 };
}
