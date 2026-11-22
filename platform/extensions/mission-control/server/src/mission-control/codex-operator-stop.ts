import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';
import {refresh,sessionContext} from '../security.js';

/** First-party durable tenant STOP. No resume endpoint. Only authenticated,
 * same-session explicit form approval can invoke the host-owned signed API. */
export function createOperatorStop(store:Store,origin:()=>string,stop:(tenant:string,operator:string,reason:string)=>unknown){
 const key=randomBytes(32);
 const proof=(session:string)=>createHmac('sha256',key).update('OPERATOR_STOP_V1:'+session).digest('hex');
 return async(req:IncomingMessage,res:ServerResponse)=>{
  if(req.url?.split('?')[0]!=='/mission-control/operator/stop')return false;
  const reply=(status:number,body:unknown)=>{
   res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));return true;
  };
  const ctx=refresh(sessionContext(store,req.headers.cookie??''));
  if(ctx.user?.role!=='ADMIN'||ctx.user.disabled||!ctx.sessionHash||ctx.operatorTokenId||req.headers.authorization)
   return reply(401,{error:'OPERATOR_SESSION_REQUIRED'});
  if(req.method==='GET'){
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
   res.end(`<!doctype html><meta charset="utf-8"><h1>STOP Mission Control</h1><p>Stops all Mission Control work for this account. Uncertain external actions keep their locks. There is no automatic resume or retry.</p>
    <form method="post"><input type="hidden" name="csrf" value="${proof(ctx.sessionHash)}">
    <label>Reason <input name="reason" minlength="10" maxlength="2000" required></label>
    <button type="submit">STOP this account's Mission Control</button></form>`);return true;
  }
  if(req.method!=='POST'||req.headers.origin!==origin()||
    String(req.headers['content-type']??'').split(';')[0]!=='application/x-www-form-urlencoded')
   return reply(403,{error:'STOP_ORIGIN_REQUIRED'});
  let raw='';for await(const part of req){raw+=String(part);if(Buffer.byteLength(raw)>4000)return reply(413,{error:'STOP_FORM_TOO_LARGE'});}
  const form=new URLSearchParams(raw),csrf=form.get('csrf')??'',reason=form.get('reason')??'';
  const current=refresh(sessionContext(store,req.headers.cookie??''));
  if(current.user?.id!==ctx.user.id||current.user.role!=='ADMIN'||current.user.disabled||
   current.sessionHash!==ctx.sessionHash||current.operatorTokenId||!/^[a-f0-9]{64}$/.test(csrf)||
   !timingSafeEqual(Buffer.from(csrf),Buffer.from(proof(ctx.sessionHash))))
   return reply(403,{error:'STOP_CSRF_REQUIRED'});
  try{return reply(200,stop(String(current.user.id),String(current.user.id),reason));}
  catch{return reply(409,{error:'STOP_NOT_CONFIRMED'});}
 };
}
