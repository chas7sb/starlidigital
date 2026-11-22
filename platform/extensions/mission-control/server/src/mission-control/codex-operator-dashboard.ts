import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';
import {refresh,sessionContext} from '../security.js';

const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** First-party projection only. All mutations retain their independently
 * authenticated, exact-session CSRF review routes. Never expose session hashes,
 * CSRF tokens, command text or private witness material in this projection. */
export function createOperatorDashboard(store:Store,prefix=''){
 return async(req:IncomingMessage,res:ServerResponse)=>{
  const path=req.url?.split('?')[0];
  if(!['/mission-control','/mission-control/','/mission-control/operator/status'].includes(path??''))return false;
  const json=path==='/mission-control/operator/status';
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
   'Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
  const reply=(status:number,value:unknown)=>{res.writeHead(status,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify(value));return true;};
  if(req.method!=='GET')return reply(405,{error:'GET_REQUIRED'});
  const ctx=refresh(sessionContext(store,req.headers.cookie??''));
  if(ctx.user?.role!=='ADMIN'||ctx.user.disabled||!ctx.sessionHash||ctx.operatorTokenId||req.headers.authorization)
   return reply(401,{error:'OPERATOR_SESSION_REQUIRED'});
  const owner=String(ctx.user.id),now=Date.now();
  const stopped=!!store.db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(owner);
  const grants=store.db.prepare(`SELECT device_id,expires_at,revoked_at FROM mc_bridge_device_grants
   WHERE tenant=? AND user_id=? AND session_hash=? ORDER BY expires_at DESC LIMIT 100`)
   .all(owner,owner,ctx.sessionHash) as {device_id:string;expires_at:number;revoked_at:number|null}[];
  const devices=grants.map(g=>{
   const d=store.get('browser_bridge_devices',g.device_id);
   return {deviceId:g.device_id,expiresAt:g.expires_at,
    authorized:!stopped&&g.revoked_at===null&&g.expires_at>now&&d?.ownerId===owner&&d.active===true,
    sendEnabled:!stopped&&g.revoked_at===null&&g.expires_at>now&&d?.ownerId===owner&&d.active===true&&d.sendEnabled===true};
  });
  const tabs=store.db.prepare(`SELECT device_id,tab_id,expected_url,verified_at FROM mc_verified_tab_bindings
   WHERE tenant=? AND session_hash=? ORDER BY device_id,tab_id LIMIT 10`).all(owner,ctx.sessionHash) as
   {device_id:string;tab_id:number;expected_url:string;verified_at:number}[];
  const targets=tabs.map(t=>({deviceId:t.device_id,tabId:t.tab_id,conversation:t.expected_url,
   available:!stopped&&devices.some(d=>d.deviceId===t.device_id&&d.authorized)&&t.verified_at<=now&&now-t.verified_at<=30000}));
  const commands=store.list('browser_bridge_commands',owner).filter(c=>c.ownerId===owner&&
   typeof c.id==='string'&&/^[a-f0-9]{64}$/.test(c.id)&&typeof c.deviceId==='string'&&
   devices.some(d=>d.deviceId===c.deviceId)).sort((a,b)=>Number(b.createdAt??0)-Number(a.createdAt??0)).slice(0,50)
   .map(c=>({commandId:c.id,deviceId:c.deviceId,status:String(c.status),
    // Only the witness ingress may make canonical Mission Control rows done.
    verifiedExecution:c.status==='done'&&typeof c.missionControlVerifiedReceiptId==='string'&&
     !!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mc_verified_effect_receipts'").get()&&
     !!store.db.prepare('SELECT 1 FROM mc_verified_effect_receipts WHERE receipt_id=? AND command_id=? AND owner_id=? AND device_id=? AND status=?')
      .get(c.missionControlVerifiedReceiptId,c.id,owner,c.deviceId,'done'),
    reviewRequired:c.status==='queued'&&c.action==='send'&&!stopped,
    outcomeUnknown:c.status==='dispatched'||c.status==='uncertain'||c.status==='UNKNOWN'}));
  const responses=store.db.prepare(`SELECT r.device_id AS deviceId,r.tab_id AS tabId,r.conversation,r.response_text AS text,
   r.truncated,r.observed_at AS observedAt FROM mc_response_observations r JOIN mc_verified_tab_bindings t
   ON r.tenant=t.tenant AND r.device_id=t.device_id AND r.tab_id=t.tab_id AND r.session_id=t.session_id
   AND r.conversation=t.expected_url WHERE r.tenant=? AND t.session_hash=? ORDER BY r.observed_at DESC LIMIT 10`)
   .all(owner,ctx.sessionHash).map(r=>({deviceId:r.deviceId,tabId:r.tabId,conversation:r.conversation,
    text:r.text,truncated:r.truncated,observedAt:r.observedAt,source:'EXTENSION_REPORTED',verified:false}));
  const snapshot={observedAt:now,stopped,devices,targets,commands,responses,
   notice:'Transport delivery is not execution. Unknown submissions must not be retried automatically.'};
  if(json)return reply(200,snapshot);
  res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<title>Starli Mission Control</title><h1>Starli Mission Control</h1><p>'+escape(stopped?'STOPPED — new commands are blocked.':'Operator session authenticated. Device and tab approval are required.')+'</p>'+
   '<nav><a href="'+prefix+'/mission-control/operator/device">Approve or revoke device</a> · <a href="'+prefix+'/mission-control/operator/tabs">Review reported tabs</a> · <a href="'+prefix+'/mission-control/operator/prepare">Prepare a command</a> · <a href="'+prefix+'/mission-control/operator/stop">STOP all Mission Control work</a> · <a href="'+prefix+'/mission-control/">Refresh status</a></nav>'+
   '<p>'+escape(snapshot.notice)+'</p><h2>Devices</h2><ul>'+devices.map(d=>'<li>'+escape(d.deviceId)+' — '+(d.authorized?'authorized':'expired or revoked')+'; individually reviewed sends '+(d.sendEnabled?'allowed':'off')+'</li>').join('')+'</ul>'+
   '<h2>Reviewed tabs</h2><ul>'+targets.map(t=>'<li>'+escape(t.deviceId)+' / tab '+t.tabId+' — '+escape(t.conversation)+' — '+(t.available?'recent report':'offline, stale or revoked')+'</li>').join('')+'</ul>'+
   '<h2>Commands and receipts</h2><ul>'+commands.map(c=>'<li>'+escape(c.commandId)+' — '+escape(c.status)+(c.verifiedExecution?' — independently witnessed submission':c.outcomeUnknown?' — outcome unverified; do not retry':' — no verified execution')+
    (c.reviewRequired?' · <a href="'+prefix+'/mission-control/operator/command?commandId='+c.commandId+'">Review exact command</a>':'')+'</li>').join('')+'</ul>'+
   '<h2>Collected responses — unverified page text</h2>'+responses.map(r=>'<section><p>Tab '+escape(r.tabId)+' — '+escape(r.conversation)+'</p><pre>'+escape(r.text)+'</pre></section>').join('')+
   '<p>This is a point-in-time snapshot. Refresh to see changes. A missing response or a delivery acknowledgment never proves agent completion.</p></html>');
  return true;
 };
}
