import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';
import {refresh,sessionContext} from '../security.js';
import {browserEnqueue} from '../../../control-plane/src/browser-bridge.js';
import {dispatchAutomaticCommand} from './automatic-command.js';
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function createPrepareCommand(store:Store,origin:()=>string,prefix=''){
 const key=randomBytes(32),sign=(session:string,id:string)=>createHmac('sha256',key).update(JSON.stringify([session,id])).digest('hex');
 return async(req:IncomingMessage,res:ServerResponse)=>{
  if(req.url?.split('?')[0]!=='/mission-control/operator/prepare')return false;
  const reply=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));return true;};
  const ctx=refresh(sessionContext(store,req.headers.cookie??''));
  if(ctx.user?.role!=='ADMIN'||ctx.user.disabled||!ctx.sessionHash||ctx.operatorTokenId||req.headers.authorization)
   return reply(401,{error:'OPERATOR_SESSION_REQUIRED'});
  const owner=String(ctx.user.id);
  if(req.method==='GET'){
   const requestId=randomBytes(24).toString('hex');
   const tabs=store.list('browser_bridge_tabs',owner).filter(t=>t.ownerId===owner&&t.missionControl===true);
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
   res.end('<!doctype html><meta charset="utf-8"><h1>Prepare one command</h1><p>Automatic devices send under standing authorization. Manual devices require separate review.</p><form method="post">'+
    '<input type="hidden" name="request" value="'+requestId+'"><input type="hidden" name="csrf" value="'+sign(ctx.sessionHash,requestId)+'">'+
    '<label>Reviewed target <select name="target">'+tabs.map(t=>'<option value="'+escape(String(t.deviceId)+':'+String(t.sessionId))+'">'+escape(t.url)+'</option>').join('')+'</select></label>'+
    '<label>Command <textarea name="text" required minlength="1" maxlength="2000"></textarea></label><button>Send command</button></form>');return true;
  }
  if(req.method!=='POST'||req.headers.origin!==origin()||String(req.headers['content-type']??'').split(';')[0]!=='application/x-www-form-urlencoded')
   return reply(403,{error:'OPERATOR_ORIGIN_REQUIRED'});
  let raw='';for await(const part of req){raw+=String(part);if(Buffer.byteLength(raw)>14000)return reply(413,{error:'COMMAND_TOO_LARGE'});}
  const form=new URLSearchParams(raw),request=form.get('request')??'',proof=form.get('csrf')??'',text=form.get('text')??'';
  const current=refresh(sessionContext(store,req.headers.cookie??''));
  if(current.user?.id!==owner||current.user.role!=='ADMIN'||current.user.disabled||current.sessionHash!==ctx.sessionHash||
   current.operatorTokenId||!/^[a-f0-9]{48}$/.test(request)||!/^[a-f0-9]{64}$/.test(proof)||
   !timingSafeEqual(Buffer.from(proof),Buffer.from(sign(ctx.sessionHash,request))))return reply(403,{error:'COMMAND_CSRF_DENIED'});
  if(!text.trim()||text.length>2000)return reply(400,{error:'COMMAND_INVALID'});
  const target=form.get('target')??'',separator=target.lastIndexOf(':');
  const deviceId=target.slice(0,separator),sessionId=target.slice(separator+1);
  const bound=store.db.prepare(`SELECT * FROM mc_verified_tab_bindings WHERE tenant=? AND device_id=? AND tab_id=?
   AND session_hash=? AND verified_at>?`).get(owner,deviceId,Number(sessionId),ctx.sessionHash,Date.now()-30000);
  if(!bound)return reply(409,{error:'REVIEWED_TARGET_REQUIRED'});
  try{
   const result=browserEnqueue(store,owner,{deviceId,sessionId,action:'send',text,idempotencyKey:'operator-preview-'+request});
   if(store.get('browser_bridge_devices',deviceId)?.automaticSendEnabled===true){
    const row=store.get('browser_bridge_commands',result.commandId);
    if(!row||row.status!=='queued')return reply(409,{error:'COMMAND_ALREADY_REQUESTED_NO_RETRY'});
    store.put('browser_bridge_commands',{...row,autoRequestedTabSessionId:bound.session_id,
     autoRequestedOperatorSessionHash:ctx.sessionHash,autoRequestedSessionEpoch:bound.session_epoch},owner);
    dispatchAutomaticCommand(store,owner,result.commandId,ctx.sessionHash);
    return reply(202,{commandId:result.commandId,status:'AUTOMATIC_OFFERED',executed:false});
   }
   res.writeHead(303,{'Location':prefix+'/mission-control/operator/command?commandId='+result.commandId,'Cache-Control':'no-store'});
   res.end();return true;
  }catch{return reply(409,{error:'COMMAND_NOT_QUEUED'});}
 };
}
