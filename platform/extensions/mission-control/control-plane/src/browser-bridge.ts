
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Store } from '../../server/src/store.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DEVICES = 'browser_bridge_devices';
const COMMANDS = 'browser_bridge_commands';
const TABS = 'browser_bridge_tabs';
const MAX_TEXT = 6000;
const MAX_BODY = 32768;
const NON_SEND_RETENTION = 30 * 24 * 60 * 60 * 1000;

type BridgeRecord = Record<string, any> & { id: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const reply = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  res.end(JSON.stringify(data));
};
function ownerRecord(store: Store, collection: string, id: string, ownerId: string): BridgeRecord | undefined {
  const record = store.get(collection,id);
  return record && record.ownerId === ownerId ? record : undefined;
}
export function browserPair(store: Store, ownerId: string, name: string) {
  if (!name.trim() || name.length>80) throw Error('INVALID_DEVICE_NAME');
  const id=randomUUID();
  const secret=randomBytes(32).toString('base64url');
  const token=id+'.'+secret;
  store.put(DEVICES,{id,ownerId,name:name.trim(),secretHash:hash(token),active:true,sendEnabled:false,createdAt:Date.now(),lastSeen:0},ownerId);
  return {deviceId:id,token,sendEnabled:false};
}
export function browserRevoke(store: Store, ownerId: string, deviceId: string) {
  const device=ownerRecord(store,DEVICES,deviceId,ownerId);
  if(!device) throw Error('DEVICE_NOT_FOUND');
  store.put(DEVICES,{...device,active:false,sendEnabled:false,revokedAt:Date.now()},ownerId);
  return {deviceId,active:false};
}
export function browserSetSend(store: Store,ownerId:string,deviceId:string,enabled:boolean) {
  const device=ownerRecord(store,DEVICES,deviceId,ownerId);
  if(!device||!device.active) throw Error('DEVICE_UNAVAILABLE');
  store.put(DEVICES,{...device,sendEnabled:enabled},ownerId);
  return {deviceId,sendEnabled:enabled};
}
export function browserDevices(store:Store,ownerId:string) {
  return store.list(DEVICES,ownerId).map((d:any)=>({deviceId:d.id,name:d.name,active:d.active,sendEnabled:d.sendEnabled,lastSeen:d.lastSeen||null}));
}
function currentMissionTab(store:Store,ownerId:string,deviceId:string,tabId:string,url:string){
 try{
  const d=ownerRecord(store,DEVICES,deviceId,ownerId);
  if(!d?.active||d.transport!=='mission-control')return false;
  if(store.db.prepare('SELECT 1 FROM mc_tenant_stop WHERE tenant=?').get(ownerId))return false;
  const binding=store.db.prepare('SELECT * FROM mc_verified_tab_bindings WHERE tenant=? AND device_id=? AND tab_id=?')
   .get(ownerId,deviceId,Number(tabId)) as Record<string,any>|undefined;
  const now=Date.now();
  if(!binding||!['TRUSTED_HOST_VERIFIED','OPERATOR_CONFIRMED'].includes(binding.source)||
    binding.expected_url!==url||!Number.isSafeInteger(binding.verified_at)||binding.verified_at>now||
    now-binding.verified_at>30000)return false;
  return !!store.db.prepare(`SELECT 1 FROM mc_bridge_device_grants
   WHERE tenant=? AND user_id=? AND device_id=? AND session_hash=? AND session_epoch=?
   AND revoked_at IS NULL AND expires_at>?`).get(ownerId,ownerId,deviceId,binding.session_hash,binding.session_epoch,now);
 }catch{return false;}
}
export function browserSessions(store: Store,ownerId:string,deviceId?:string) {
  return store.list(TABS,ownerId).filter((r:any)=>!deviceId||r.deviceId===deviceId).filter((r:any)=>Date.now()-r.seenAt<120000)
    .filter((r:any)=>store.get(DEVICES,r.deviceId)?.transport!=='mission-control'||
      currentMissionTab(store,ownerId,r.deviceId,r.sessionId,r.url))
    .map((r:any)=>({deviceId:r.deviceId,sessionId:r.sessionId,title:r.title,url:r.url,seenAt:r.seenAt}));
}
export function browserEnqueue(store:Store,ownerId:string,args:{deviceId:string;action:'list'|'read'|'send';sessionId?:string;text?:string;idempotencyKey:string}) {
  const d=ownerRecord(store,DEVICES,args.deviceId,ownerId);
  if(!d?.active) throw Error('DEVICE_UNAVAILABLE');
  if(!/^[a-zA-Z0-9_.:-]{8,120}$/.test(args.idempotencyKey)) throw Error('INVALID_IDEMPOTENCY_KEY');
  if(args.action!=='list' && (!args.sessionId || !/^[0-9]{1,12}$/.test(args.sessionId))) throw Error('INVALID_SESSION');
  if(args.action==='send' && (!d.sendEnabled || !args.text?.trim() || args.text.length>MAX_TEXT)) throw Error('SEND_DISABLED_OR_INVALID');
  const id=hash(ownerId+':'+args.idempotencyKey);
  const fingerprint=hash(JSON.stringify([args.deviceId,args.action,args.sessionId||'',args.text||'']));
  const existing=ownerRecord(store,COMMANDS,id,ownerId);
  if(existing) {
    if(existing.fingerprint!==fingerprint) throw Error('IDEMPOTENCY_CONFLICT');
    return {commandId:id,status:existing.status,result:existing.status==='done'?existing.result:undefined};
  }
  const tab=args.action==='list'?undefined:ownerRecord(store,TABS,args.deviceId+':'+args.sessionId,ownerId);
  if(args.action!=='list' && (!tab || Date.now()-tab.seenAt>120000 || !/^https:\/\/chatgpt\.com\/c\/[a-zA-Z0-9-]+/.test(tab.url))) throw Error('SESSION_NOT_CURRENT');
  if(d.transport==='mission-control'&&args.action!=='list'&&
    (!currentMissionTab(store,ownerId,args.deviceId,args.sessionId!,tab?.url)||
     (args.action==='send'&&args.text!.length>2000)))throw Error('MISSION_CONTROL_TARGET_UNVERIFIED');
  if(store.list(COMMANDS,ownerId).filter((r:any)=>r.deviceId===args.deviceId && ['queued','dispatched'].includes(r.status)).length>=50)throw Error('QUEUE_FULL');
  const record={id,ownerId,deviceId:args.deviceId,action:args.action,sessionId:args.sessionId,expectedUrl:tab?.url,text:args.text,fingerprint,status:'queued',createdAt:Date.now()};
  store.put(COMMANDS,record,ownerId);
  return {commandId:id,status:'queued'};
}
export function browserCommand(store:Store,ownerId:string,id:string) {
  const r=ownerRecord(store,COMMANDS,id,ownerId);
  if(!r) throw Error('COMMAND_NOT_FOUND');
  return {commandId:id,status:r.status,result:r.status==='done'||r.status==='failed'?r.result:undefined,updatedAt:r.updatedAt||r.createdAt};
}
function authenticate(store:Store,req:IncomingMessage):BridgeRecord|undefined {
  const bearer=req.headers.authorization;
  if(typeof bearer!=='string'||!bearer.startsWith('Bearer ')) return;
  const token=bearer.slice(7);
  const deviceId=token.split('.')[0];
  if(!/^[a-f0-9-]{36}$/.test(deviceId))return;
  const dev=store.get(DEVICES,deviceId);
  if(!dev?.active || typeof dev.secretHash!=='string')return;
  const candidate=Buffer.from(hash(token));
  const correct=Buffer.from(dev.secretHash);
  return candidate.length===correct.length&&timingSafeEqual(candidate,correct)?dev:undefined;
}
async function readJson(req:IncomingMessage) {
  let bytes=0;const chunks:Buffer[]=[];
  for await(const b of req) {bytes+=b.length;if(bytes>MAX_BODY)throw Error('BODY_TOO_LARGE');chunks.push(b);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}
export async function handleBrowserRequest(store:Store,req:IncomingMessage,res:ServerResponse,url:URL) {
  const dev=authenticate(store,req);
  if(!dev)return reply(res,401,{error:'unauthorized'});
  if(req.method==='POST'&&url.pathname==='/browser-bridge/v1/heartbeat') {
    const b=await readJson(req);
    if(!Array.isArray(b.tabs)||b.tabs.length>30)return reply(res,400,{error:'invalid tabs'});
    for(const t of b.tabs){
      if(!/^[0-9]{1,12}$/.test(String(t.sessionId))||typeof t.url!=='string'||!/^https:\/\/chatgpt\.com\//.test(t.url))return reply(res,400,{error:'invalid session'});
      const name=String(t.title||'').slice(0,160);
      store.put(TABS,{id:dev.id+':'+t.sessionId,ownerId:dev.ownerId,deviceId:dev.id,sessionId:String(t.sessionId),title:name,url:t.url.split('?')[0].slice(0,400),seenAt:Date.now()},dev.ownerId);
    }
    store.put(DEVICES,{...dev,lastSeen:Date.now()},dev.ownerId);
    return reply(res,200,{ok:true,sendEnabled:dev.sendEnabled});
  }
  if(req.method==='GET'&&url.pathname==='/browser-bridge/v1/poll'){
    // Mission Control commands are reserved for the authenticated WSS outbox.
    // Do not race that transport using legacy HTTP polling.
    if(dev.transport==='mission-control')return reply(res,200,{commands:[],sendEnabled:false});
    // Command-level transport ownership survives device reclassification.
    const pending=store.list(COMMANDS,dev.ownerId).filter((x:any)=>
      x.deviceId===dev.id&&x.status==='queued'&&!x.missionControlNonce&&!x.missionControlSessionId
    ).sort((a:any,b:any)=>a.createdAt-b.createdAt).slice(0,5);
    const commands=[];
    for(const c of pending) {
      if(c.action==='send'&&!dev.sendEnabled) {store.put(COMMANDS,{...c,status:'failed',result:{error:'send disabled'},updatedAt:Date.now()},dev.ownerId);continue;}
      const dispatched={...c,status:'dispatched',dispatchedAt:Date.now(),updatedAt:Date.now()};
      store.put(COMMANDS,dispatched,dev.ownerId);
      commands.push({id:c.id,action:c.action,sessionId:c.sessionId,expectedUrl:c.expectedUrl,text:c.text});
    }
    return reply(res,200,{commands,sendEnabled:dev.sendEnabled});
  }
  if(req.method==='POST'&&url.pathname==='/browser-bridge/v1/receipt'){
    const b=await readJson(req);
    if(typeof b.id!=='string'||!['done','failed','uncertain'].includes(b.status))return reply(res,400,{error:'invalid receipt'});
    const c=ownerRecord(store,COMMANDS,b.id,dev.ownerId);
    if(!c||c.deviceId!==dev.id)return reply(res,404,{error:'not found'});
    // Never allow an HTTP device receipt to bypass trusted Mission Control
    // effect-proof verification, including after device transport changes.
    if(dev.transport==='mission-control'||c.missionControlNonce||c.missionControlSessionId)
      return reply(res,409,{error:'mission-control receipt requires verified effect'});
    if(c.status!=='dispatched')return reply(res,409,{error:'not dispatched'});
    const result=JSON.stringify(b.result??null);
    if(result.length>16000)return reply(res,400,{error:'result too large'});
    store.put(COMMANDS,{...c,status:b.status,result:JSON.parse(result),updatedAt:Date.now()},dev.ownerId);
    return reply(res,200,{ok:true});
  }
  return reply(res,404,{error:'not found'});
}
export function expireBrowserCommands(store:Store) {
  const now=Date.now();
  for(const c of store.list(COMMANDS)) {
    if(c.status==='dispatched'&&now-c.dispatchedAt>45000)store.put(COMMANDS,{...c,status:'uncertain',updatedAt:now},c.ownerId);
    // Never prune send idempotency keys: an old retry must not execute a second send.
    if(c.action!=='send' && now-c.createdAt>NON_SEND_RETENTION)store.remove(COMMANDS,c.id);
  }
}
