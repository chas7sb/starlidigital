import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {IncomingMessage,Server as HttpServer,ServerResponse} from 'node:http';
import {WebSocket,WebSocketServer} from 'ws';

export type BridgePrincipal={tenantId:string;subjectId:string;deviceId:string;sessionId?:string;sessionEpoch?:number};
/** Inject server-owned durable grants and session-bound CSRF verification; never trust browser claims. */
export type BridgeProductionIngress={mode:'production';verifyGrant:(req:IncomingMessage,p:BridgePrincipal)=>Promise<boolean>;verifyCsrf:(req:IncomingMessage,p:BridgePrincipal)=>Promise<boolean>};
export type BridgeEvent={seq:number;eventId:string;tenantId:string;deviceId:string;kind:string;body:unknown;createdAt:string;acknowledged:boolean};
type Publish={tenantId:string;deviceId:string;eventId:string;kind:string;body:unknown};
type Authenticate=(req:IncomingMessage)=>Promise<BridgePrincipal|undefined>;
const opaque=/^[a-zA-Z0-9_.:-]{1,128}$/;
function isCanonicalBrowserOrigin(value:unknown):value is string{
 if(typeof value!=='string')return false;
 if(/^chrome-extension:\/\/[a-p]{32}$/.test(value))return true;
 try{const origin=new URL(value);return origin.protocol==='https:'&&origin.origin===value&&origin.username===''&&origin.password==='';}
 catch{return false;}
}
function validatePrincipal(p:BridgePrincipal|undefined):BridgePrincipal|undefined{
 if(!p||![p.tenantId,p.subjectId,p.deviceId].every(v=>typeof v==='string'&&opaque.test(v)))return;
 if(p.sessionId!==undefined&&(typeof p.sessionId!=='string'||!opaque.test(p.sessionId)))return;
 if(p.sessionEpoch!==undefined&&(!Number.isSafeInteger(p.sessionEpoch)||p.sessionEpoch<0))return;
 return p;
}
export class BrowserEventStore {
 constructor(private readonly db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS lcg3_browser_events(
   seq INTEGER PRIMARY KEY AUTOINCREMENT,
   tenant_id TEXT NOT NULL, device_id TEXT NOT NULL, event_id TEXT NOT NULL,
   kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL,
   acked_at TEXT, UNIQUE(tenant_id,device_id,event_id));
   CREATE INDEX IF NOT EXISTS lcg3_browser_scope ON lcg3_browser_events(tenant_id,device_id,seq);
   CREATE TABLE IF NOT EXISTS lcg3_device_fences(tenant_id TEXT NOT NULL,device_id TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,device_id));`);
 }
 generation(tenantId:string,deviceId:string):number{
  const row=this.db.prepare('SELECT generation FROM lcg3_device_fences WHERE tenant_id=? AND device_id=?').get(tenantId,deviceId) as {generation:number}|undefined;
  return row?.generation??0;
 }
 invalidate(tenantId:string,deviceId:string):number{
  if(!opaque.test(tenantId)||!opaque.test(deviceId))throw Error('INVALID_BRIDGE_DEVICE');
  const result=this.db.prepare('INSERT INTO lcg3_device_fences(tenant_id,device_id,generation) VALUES (?,?,1) ON CONFLICT(tenant_id,device_id) DO UPDATE SET generation=generation+1 WHERE generation < 9007199254740991').run(tenantId,deviceId);
  if(result.changes!==1)throw Error('BRIDGE_GENERATION_OVERFLOW');
  const generation=this.generation(tenantId,deviceId);
  return generation;
 }
 publish(p:Publish):BridgeEvent{
  if(!opaque.test(p.tenantId)||!opaque.test(p.deviceId)||!opaque.test(p.eventId)||!opaque.test(p.kind))throw Error('INVALID_BRIDGE_EVENT');
  const body=JSON.stringify(p.body);
  if(!body||Buffer.byteLength(body)>32768)throw Error('INVALID_BRIDGE_BODY');
  this.db.prepare(`INSERT INTO lcg3_browser_events (tenant_id,device_id,event_id,kind,body,created_at)
  VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,device_id,event_id) DO NOTHING`)
   .run(p.tenantId,p.deviceId,p.eventId,p.kind,body,new Date().toISOString());
  const row=this.db.prepare('SELECT * FROM lcg3_browser_events WHERE tenant_id=? AND device_id=? AND event_id=?').get(p.tenantId,p.deviceId,p.eventId) as Record<string,unknown>;
  if(row.kind!==p.kind||row.body!==body)throw Error('BRIDGE_EVENT_IDEMPOTENCY_CONFLICT');
  return this.decode(row);
 }
 list(p:BridgePrincipal,after:number,limit=100):BridgeEvent[]{
  if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_BRIDGE_CURSOR');
  const rows=this.db.prepare(`SELECT * FROM lcg3_browser_events WHERE tenant_id=? AND device_id=?
   AND seq>? AND acked_at IS NULL ORDER BY seq LIMIT ?`).all(p.tenantId,p.deviceId,after,limit) as Record<string,unknown>[];
  return rows.map(row=>this.decode(row));
 }
 ack(p:BridgePrincipal,eventId:string):boolean{
  if(!opaque.test(eventId))return false;
  const r=this.db.prepare(`UPDATE lcg3_browser_events SET acked_at=COALESCE(acked_at,?)
   WHERE tenant_id=? AND device_id=? AND event_id=?`).run(new Date().toISOString(),p.tenantId,p.deviceId,eventId);
  return r.changes===1;
 }
 private decode(r:Record<string,unknown>):BridgeEvent{
  return {seq:Number(r.seq),tenantId:String(r.tenant_id),deviceId:String(r.device_id),
   eventId:String(r.event_id),kind:String(r.kind),body:JSON.parse(String(r.body)),
   createdAt:String(r.created_at),acknowledged:r.acked_at!==null};
 }
}
type Client={principal:BridgePrincipal;socket:WebSocket;sent:Set<string>;validate:()=>Promise<boolean>;generation:number};
const base='/mission-control/bridge';
const noStore={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'};
export class BrowserTransport {
 private readonly ws=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
 private readonly clients=new Set<Client>();
 private readonly tickets=new Map<string,{principal:BridgePrincipal;expiresAt:number;validate:()=>Promise<boolean>;generation:number;origin:string|null}>();
 private readonly maxPending=1000;
 private readonly maxSocketsPerDevice=4;
 private closed=false;
 private readonly maxTicketsPerDevice=16;
 private currentGeneration(p:Pick<BridgePrincipal,'tenantId'|'deviceId'>){
  return this.store.generation(p.tenantId,p.deviceId);
 }
 /** An authorized caller must invoke this after a durable device-grant revoke.
  * Existing sockets/tickets are invalidated synchronously, including pending auth results.
  * The persistent grants store remains the external source of truth on process restart. */
 invalidateDevice(tenantId:string,deviceId:string):void{
  if(!opaque.test(tenantId)||!opaque.test(deviceId))throw Error('INVALID_BRIDGE_DEVICE');
  this.store.invalidate(tenantId,deviceId);
  for(const [hash,ticket] of this.tickets){
   if(ticket.principal.tenantId===tenantId&&ticket.principal.deviceId===deviceId)this.tickets.delete(hash);
  }
  for(const c of this.clients){
   if(c.principal.tenantId===tenantId&&c.principal.deviceId===deviceId){
    this.clients.delete(c);c.socket.close(1008,'device revoked');
   }
  }
 }
 constructor(private readonly store:BrowserEventStore,private readonly authenticate:Authenticate,
  private readonly now:()=>number=Date.now,
  private readonly allowedOrigins:readonly string[]=[],
  private readonly requireOrigin=false,
  private readonly productionIngress?:BridgeProductionIngress){
   if(this.productionIngress?.mode==='production'&&(!requireOrigin||allowedOrigins.length===0||allowedOrigins.some(origin=>!isCanonicalBrowserOrigin(origin))||new Set(allowedOrigins).size!==allowedOrigins.length||typeof this.productionIngress.verifyGrant!=='function'||typeof this.productionIngress.verifyCsrf!=='function'))throw Error('BRIDGE_PRODUCTION_INGRESS_UNSAFE');
  }
 private sameIdentity(a:BridgePrincipal,b:BridgePrincipal):boolean{
  return a.tenantId===b.tenantId&&a.subjectId===b.subjectId&&a.deviceId===b.deviceId&&
   (this.productionIngress?.mode!=='production'||(a.sessionId===b.sessionId&&a.sessionEpoch===b.sessionEpoch));
 }
 private async authenticatedPrincipal(req:IncomingMessage):Promise<BridgePrincipal|undefined>{
  try{return validatePrincipal(await this.authenticate(req));}catch{return undefined;}
 }
 private async grantAllowed(req:IncomingMessage,p:BridgePrincipal):Promise<boolean>{
  if(this.productionIngress?.mode!=='production')return true;
  if(!p.sessionId||!Number.isSafeInteger(p.sessionEpoch)||Number(p.sessionEpoch)<0)return false;
  try{return await this.productionIngress.verifyGrant(req,p)===true;}catch{return false;}
 }
 private async csrfAllowed(req:IncomingMessage,p:BridgePrincipal):Promise<boolean>{
  if(this.productionIngress?.mode!=='production')return true;
  const token=req.headers['x-csrf-token'];
  if(typeof token!=='string'||token.length<16||token.length>256)return false;
  try{return await this.productionIngress.verifyCsrf(req,p)===true;}catch{return false;}
 }
 private acceptsOrigin(req:IncomingMessage):boolean{
  const origin=req.headers.origin;
  if(origin===undefined)return !this.requireOrigin; // Strict browser mode can reject absent Origin.
  if(!isCanonicalBrowserOrigin(origin))return false;
  return this.allowedOrigins.includes(origin);
 }
 install(server:HttpServer){
  server.on('upgrade',(req,socket,head)=>{
   const pathname=new URL(req.url??'/', 'http://localhost').pathname;
   if(pathname!==base+'/ws')return;
   if(this.closed){socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');socket.destroy();return;}
   if(!this.acceptsOrigin(req)){
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;
   }
   const protocols=(req.headers['sec-websocket-protocol']??'').split(',').map(s=>s.trim());
   // Exactly one bridge identifier and one secret ticket: reject ambiguous headers
   // before looking up or consuming any legitimate one-time ticket.
   if(protocols.length!==2||protocols.filter(p=>p==='starli.bridge.v1').length!==1||
    protocols.filter(p=>/^starli\.ticket\.[A-Za-z0-9_-]{43}$/.test(p)).length!==1){
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');socket.destroy();return;
   }
   const ticket=protocols.find(p=>p.startsWith('starli.ticket.'));
   const key=ticket?.slice('starli.ticket.'.length);
   const hashed=key?createHash('sha256').update(key).digest('hex'):'';
   const record=this.tickets.get(hashed);
   // A stolen ticket must not cross even between two separately allowlisted origins.
   // Deny before consuming so an unrelated site cannot burn the rightful client's ticket.
   if(record&&record.origin!==(req.headers.origin??null)){
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;
   }
   if(hashed)this.tickets.delete(hashed);
   if(!record||record.expiresAt<this.now()||!protocols.includes('starli.bridge.v1')){
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;
   }
   // Never negotiate the secret-bearing ticket as a response protocol.
   req.headers['sec-websocket-protocol']='starli.bridge.v1';
   void record.validate().then(valid=>{
    if(this.closed||!valid||record.expiresAt<=this.now()||record.generation!==this.currentGeneration(record.principal)){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    const activeForDevice=Array.from(this.clients).filter(c=>c.principal.tenantId===record.principal.tenantId&&c.principal.deviceId===record.principal.deviceId&&c.socket.readyState!==WebSocket.CLOSED).length;
    if(activeForDevice>=this.maxSocketsPerDevice){socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    this.ws.handleUpgrade(req,socket,head,client=>{
    const c:Client={principal:record.principal,socket:client,sent:new Set(),validate:record.validate,generation:record.generation};
    this.clients.add(c);
    client.on('close',()=>this.clients.delete(c));
    client.on('message',raw=>{
     void c.validate().then(valid=>{
      // A delayed auth result must not ACK after socket closure or lifecycle STOP.
      if(this.closed||!this.clients.has(c)||client.readyState!==WebSocket.OPEN)return;
      if(!valid||c.generation!==this.currentGeneration(c.principal)){client.close(1008,'revoked');return;}
      this.acceptMessage(c,raw);
     }).catch(()=>client.close(1008,'auth unavailable'));
    });
    void this.sendBatch(c,0).catch(()=>client.close(1011,'event store unavailable'));
   });
   }).catch(()=>socket.destroy());
  });
 }
 private acceptMessage(c:Client,raw:import('ws').RawData){
    const client=c.socket;
    {
     if(typeof raw!=='object'||Buffer.byteLength(raw as Buffer)>4096)return client.close(1009,'oversized');
     let msg:Record<string,unknown>;
     try{msg=JSON.parse(String(raw)) as Record<string,unknown>;}catch{return client.close(1003,'invalid json');}
     if(msg.type==='ack'&&typeof msg.eventId==='string'){
      if(!c.sent.has(msg.eventId))return client.close(1008,'unseen receipt');
      // Only a durable ACK may release this socket's delivery receipt.
      // Storage errors must not masquerade as failed authentication.
      try{if(!this.store.ack(c.principal,msg.eventId))return client.close(1008,'unknown receipt');}
      catch{return client.close(1011,'event store unavailable');}
      c.sent.delete(msg.eventId);
     }else if(msg.type==='catchup'&&Number.isSafeInteger(msg.after)&&Number(msg.after)>=0){
      void this.sendBatch(c,Number(msg.after)).catch(()=>client.close(1011,'event store unavailable'));
     }else client.close(1008,'invalid message');
    }
 }
 async handleHttp(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
  try{return await this.handleHttpInner(req,res);}catch{
   // No unhandled HTTP rejection or partial JSON success on durable store outage.
   if(!res.headersSent&&!res.destroyed)this.respond(res,503,{error:'BRIDGE_STORAGE_UNAVAILABLE'});
   else if(!res.destroyed)res.destroy();
   return true;
  }
 }
 private async handleHttpInner(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
  const url=new URL(req.url??'/', 'http://localhost');
  if(!url.pathname.startsWith(base+'/'))return false;
  if(this.closed){this.respond(res,503,{error:'BRIDGE_SHUTDOWN'});return true;}
  if(!this.acceptsOrigin(req)){this.respond(res,403,{error:'ORIGIN_DENIED'});return true;}
  const p=await this.authenticatedPrincipal(req);
  if(this.closed){this.respond(res,503,{error:'BRIDGE_SHUTDOWN'});return true;}
  if(!p){this.respond(res,401,{error:'UNAUTHORIZED'});return true;}
  if(!await this.grantAllowed(req,p)){this.respond(res,401,{error:'GRANT_DENIED'});return true;}
  if(!await this.csrfAllowed(req,p)){this.respond(res,403,{error:'CSRF_DENIED'});return true;}
  if(this.closed){this.respond(res,503,{error:'BRIDGE_SHUTDOWN'});return true;}
  if(req.method==='POST'&&url.pathname===base+'/ticket'){
   // CSRF verification is asynchronous: reauthenticate and recheck the durable grant
   // immediately before minting a one-time ticket, guarding grant/epoch rotation races.
   const latest=await this.authenticatedPrincipal(req);
   if(!latest||!this.sameIdentity(latest,p)||!await this.grantAllowed(req,latest)){this.respond(res,401,{error:'GRANT_DENIED'});return true;}
   if(this.closed){this.respond(res,503,{error:'BRIDGE_SHUTDOWN'});return true;}
   // Bound unactioned one-time tickets; an authenticated caller cannot exhaust memory.
   for(const [hash,ticket] of this.tickets){if(ticket.expiresAt<=this.now()||ticket.generation!==this.currentGeneration(ticket.principal))this.tickets.delete(hash);}
   if(this.tickets.size>=256){this.respond(res,429,{error:'BRIDGE_TICKET_CAPACITY'});return true;}
   const deviceTickets=Array.from(this.tickets.values()).filter(t=>t.principal.tenantId===p.tenantId&&t.principal.deviceId===p.deviceId).length;
   if(deviceTickets>=this.maxTicketsPerDevice){this.respond(res,429,{error:'BRIDGE_DEVICE_TICKET_CAPACITY'});return true;}
   const generation=this.currentGeneration(p);
   // Revalidate CSRF after asynchronous grant/identity checks, immediately before ticket minting.
   if(!await this.csrfAllowed(req,latest)){this.respond(res,403,{error:'CSRF_DENIED'});return true;}
   if(this.closed){this.respond(res,503,{error:'BRIDGE_SHUTDOWN'});return true;}
   const token=randomBytes(32).toString('base64url');
   // The injected authenticator is the source of truth for session/device revocation.
   // Keep this short-lived request in memory for per-frame revalidation; never persist it.
   const validate=async()=>{const current=await this.authenticatedPrincipal(req);
    return !!current&&this.sameIdentity(current,p)&&await this.grantAllowed(req,current)&&await this.csrfAllowed(req,current);};
   this.tickets.set(createHash('sha256').update(token).digest('hex'),{principal:p,expiresAt:this.now()+30_000,validate,generation,origin:req.headers.origin??null});
   this.respond(res,200,{ticket:'starli.ticket.'+token,protocol:'starli.bridge.v1',expiresInSeconds:30});
   return true;
  }
  if(req.method==='GET'&&url.pathname===base+'/events'){
   const generation=this.currentGeneration(p);
   const fresh=await this.authenticatedPrincipal(req);
   if(!fresh||!this.sameIdentity(fresh,p)||!await this.grantAllowed(req,fresh)||generation!==this.currentGeneration(p)){
    this.respond(res,401,{error:'UNAUTHORIZED'});return true;
   }
   const after=Number(url.searchParams.get('after')??'0');
   if(!Number.isSafeInteger(after)||after<0){this.respond(res,400,{error:'INVALID_CURSOR'});return true;}
   // Polling must not expose events if CSRF proof expired during the fresh grant read.
   if(!await this.csrfAllowed(req,fresh)){this.respond(res,403,{error:'CSRF_DENIED'});return true;}
   // CSRF verification may await external storage; a durable revoke during that
   // await must fence the final read, not just the earlier grant check.
   if(generation!==this.currentGeneration(p)){this.respond(res,401,{error:'UNAUTHORIZED'});return true;}
   if(this.closed){this.respond(res,503,{error:'BRIDGE_SHUTDOWN'});return true;}
   this.respond(res,200,{events:this.store.list(p,after),transport:'http',nextPollMs:5000});
   return true;
  }
  if(req.method==='POST'&&url.pathname===base+'/ack'){
   const generation=this.currentGeneration(p);
   let body='';
   for await(const chunk of req){body+=String(chunk);if(body.length>4096){this.respond(res,413,{error:'TOO_LARGE'});return true;}}
   let id:unknown;
   try{id=(JSON.parse(body) as Record<string,unknown>).eventId;}catch{}
   if(typeof id!=='string'||!opaque.test(id)){this.respond(res,400,{error:'INVALID_ACK'});return true;}
   const fresh=await this.authenticatedPrincipal(req);
   if(!fresh||!this.sameIdentity(fresh,p)||!await this.grantAllowed(req,fresh)||generation!==this.currentGeneration(p)){
    this.respond(res,401,{error:'UNAUTHORIZED'});return true;
   }
   // An ACK body may stream after the initial CSRF check; require a fresh proof
   // immediately before mutating the durable acknowledgment record.
   if(!await this.csrfAllowed(req,fresh)){this.respond(res,403,{error:'CSRF_DENIED'});return true;}
   // Do not durably acknowledge an event after a revoke raced the last CSRF await.
   if(generation!==this.currentGeneration(p)){this.respond(res,401,{error:'UNAUTHORIZED'});return true;}
   if(this.closed){this.respond(res,503,{error:'BRIDGE_SHUTDOWN'});return true;}
   this.respond(res,this.store.ack(p,id)?200:404,{ok:true});
   return true;
  }
  this.respond(res,404,{error:'NOT_FOUND'});return true;
 }
 publish(p:Publish):BridgeEvent{
  if(this.closed)throw Error('BRIDGE_SHUTDOWN');
  const event=this.store.publish(p);
  for(const client of this.clients)
   if(client.principal.tenantId===event.tenantId&&client.principal.deviceId===event.deviceId&&!event.acknowledged)
    void this.sendRevalidated(client,event).catch(()=>{
     if(client.socket.readyState===WebSocket.OPEN)client.socket.close(1011,'event store unavailable');
    });
  return event;
 }
 private async sendBatch(c:Client,after:number){
  if(!await this.ensureActive(c))return;
  for(const event of this.store.list(c.principal,after))this.send(c,event);
 }
 private async ensureActive(c:Client):Promise<boolean>{
  try{if(await c.validate()&&c.generation===this.currentGeneration(c.principal))return true;}catch{}
  c.socket.close(1008,'revoked');
  this.clients.delete(c);return false;
 }
 private async sendRevalidated(c:Client,event:BridgeEvent){
  if(await this.ensureActive(c))this.send(c,event);
 }
 private send(c:Client,event:BridgeEvent){
  if(this.closed||c.socket.readyState!==WebSocket.OPEN||c.sent.has(event.eventId))return;
  if(c.sent.size>=this.maxPending||c.socket.bufferedAmount>1024*1024){c.socket.close(1013,'backpressure');return;}
  c.sent.add(event.eventId);
  c.socket.send(JSON.stringify({type:'event',event}));
 }
 private respond(res:ServerResponse,status:number,value:unknown){
  res.writeHead(status,noStore);res.end(JSON.stringify(value));
 }
 /** Trusted scheduler hook: reconcile idle sockets/tickets against SQLite revoke fences. */
 async reconcileRevocations():Promise<{closed:number;invalidatedTickets:number}>{
  if(this.closed)return {closed:0,invalidatedTickets:0};
  let closed=0,invalidatedTickets=0;
  for(const [hash,ticket] of this.tickets){
   if(ticket.expiresAt<=this.now()||ticket.generation!==this.currentGeneration(ticket.principal)){
    this.tickets.delete(hash);invalidatedTickets++;
   }
  }
  for(const c of Array.from(this.clients)){
   const wasOpen=c.socket.readyState===WebSocket.OPEN;
   if(!await this.ensureActive(c)&&wasOpen)closed++;
  }
  return {closed,invalidatedTickets};
 }
 disconnectClients(){
  for(const c of this.clients)c.socket.close(1008,'authority changed');
  this.tickets.clear();
 }
 close(){
  if(this.closed)return;
  this.closed=true;
  for(const c of this.clients)c.socket.close(1001,'shutdown');
  this.ws.close();this.tickets.clear();
 }
}


/** Production-only composition contract for the LCG9-owned HTTP application entrypoint.
 * Caller MUST mount HTTP requests ahead of its 404 handler and install() on the
 * same HTTPS-terminated server's upgrade path. Does not listen or deploy. */
export type BridgeProductionMountConfig={
 store:BrowserEventStore;
 authenticate:Authenticate;
 allowedOrigins:readonly string[];
 verifyGrant:BridgeProductionIngress['verifyGrant'];
 verifyCsrf:BridgeProductionIngress['verifyCsrf'];
 now?:()=>number;
};
export function createProductionBrowserTransport(config:BridgeProductionMountConfig):BrowserTransport{
 if(!config||!(config.store instanceof BrowserEventStore)||typeof config.authenticate!=='function'||typeof config.verifyGrant!=='function'||
  typeof config.verifyCsrf!=='function'||!Array.isArray(config.allowedOrigins)||
  config.allowedOrigins.length===0||
  config.allowedOrigins.some(origin=>!isCanonicalBrowserOrigin(origin))||
  new Set(config.allowedOrigins).size!==config.allowedOrigins.length)
  throw Error('BRIDGE_PRODUCTION_INGRESS_UNSAFE');
 return new BrowserTransport(config.store,config.authenticate,config.now??Date.now,
  config.allowedOrigins,true,{mode:'production',verifyGrant:config.verifyGrant,verifyCsrf:config.verifyCsrf});
}


/** LCG3 integration contract ONLY. No command dispatch or execution.
 * Trusted caller must resolve the legacy numeric tab session against the current
 * server registry and prove STOP/lease/grant state before calling this helper.
 * Neither a Chrome-supplied tab ID nor a WebSocket ACK is that proof. */
export type VerifiedBrowserBridgeMapping={
 source:'server-verified';
 legacyCommandId:string;
 missionEventId:string;
 tenantId:string;
 subjectId:string;
 deviceId:string;
 sessionId:string;
 sessionEpoch:number;
 legacyTabId:number;
 tabSessionId:string;
 expectedUrl:string;
 action:'COPY_MANUALLY';
 stopped:false;
 grantValid:true;
 tabSessionCurrent:true;
 humanApprovalRequired:true;
};
export type BrowserBridgeDeliveryOnlyOffer={
 tenantId:string;deviceId:string;eventId:string;kind:'command.offer';
 body:{
  source:'browser-bridge/v1';legacyCommandId:string;legacyTabId:number;
  tabSessionId:string;subjectId:string;sessionId:string;sessionEpoch:number;
  expectedUrl:string;action:'COPY_MANUALLY';humanApprovalRequired:true;
  deliveryReceipt:'WSS_ACK_ONLY';effectStatus:'UNKNOWN';
 };
};
export function mapVerifiedBrowserBridgeOffer(input:VerifiedBrowserBridgeMapping):BrowserBridgeDeliveryOnlyOffer{
 if(!input||input.source!=='server-verified'||input.action!=='COPY_MANUALLY'||
  input.stopped!==false||input.grantValid!==true||input.tabSessionCurrent!==true||
  input.humanApprovalRequired!==true||
  ![input.legacyCommandId,input.missionEventId,input.tenantId,input.subjectId,
    input.deviceId,input.sessionId,input.tabSessionId].every(v=>typeof v==='string'&&opaque.test(v))||
  typeof input.expectedUrl!=='string'||!/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+$/.test(input.expectedUrl)||
  !Number.isSafeInteger(input.legacyTabId)||input.legacyTabId<0||
  !Number.isSafeInteger(input.sessionEpoch)||input.sessionEpoch<0)
  throw Error('BRIDGE_MAPPING_NOT_VERIFIED');
 return {
  tenantId:input.tenantId,deviceId:input.deviceId,eventId:input.missionEventId,
  kind:'command.offer',
  body:{
   source:'browser-bridge/v1',legacyCommandId:input.legacyCommandId,
   legacyTabId:input.legacyTabId,tabSessionId:input.tabSessionId,
   subjectId:input.subjectId,sessionId:input.sessionId,sessionEpoch:input.sessionEpoch,
   expectedUrl:input.expectedUrl,action:'COPY_MANUALLY',humanApprovalRequired:true,
   deliveryReceipt:'WSS_ACK_ONLY',effectStatus:'UNKNOWN'
  }
 };
}
/** Acknowledgments prove only delivery; human/effect receipt must be verified by a
 * distinct authorized durable receipt consumer, never inferred from transport. */
export function classifyMissionControlTransportAck(acknowledged:boolean):'DELIVERY_ACKED'|'DELIVERY_PENDING'{
 return acknowledged===true?'DELIVERY_ACKED':'DELIVERY_PENDING';
}


/** The production-facing composition boundary: do not accept a caller-provided
 * "server-verified" mapping as authorization. Only a trusted injected resolver
 * may read the durable legacy command/registered tab/current STOP+grant state.
 * The resolver MUST perform all checks atomically with its outbox reservation;
 * this helper itself never writes or sends a command. */
export async function resolveVerifiedBrowserBridgeOffer(
 legacyCommandId:string,
 trustedResolve:(legacyCommandId:string)=>Promise<VerifiedBrowserBridgeMapping|undefined>
):Promise<BrowserBridgeDeliveryOnlyOffer>{
 if(typeof legacyCommandId!=='string'||!opaque.test(legacyCommandId)||
  typeof trustedResolve!=='function')throw Error('BRIDGE_MAPPING_NOT_VERIFIED');
 let verified:VerifiedBrowserBridgeMapping|undefined;
 try{verified=await trustedResolve(legacyCommandId);}catch{throw Error('BRIDGE_MAPPING_NOT_VERIFIED');}
 if(!verified||verified.legacyCommandId!==legacyCommandId)throw Error('BRIDGE_MAPPING_NOT_VERIFIED');
 return mapVerifiedBrowserBridgeOffer(verified);
}


/** Current target comes from the authenticated server-side agent/tab registry, never
 * from a legacy command payload or browser/extension request parameters. */
export type TrustedBrowserBridgeTarget={
 tenantId:string;subjectId:string;deviceId:string;sessionId:string;
 sessionEpoch:number;legacyTabId:number;tabSessionId:string;expectedUrl:string;
};
/** Resolve against the authoritative queue, then require exact correlation with
 * the authenticated intended recipient. This does not replace the integrator's
 * atomic STOP/grant/outbox check or prove that a browser effect executed. */
export async function resolveVerifiedBrowserBridgeOfferForTarget(
 legacyCommandId:string,
 expected:TrustedBrowserBridgeTarget,
 trustedResolve:(legacyCommandId:string,expected:Readonly<TrustedBrowserBridgeTarget>)=>Promise<VerifiedBrowserBridgeMapping|undefined>
):Promise<BrowserBridgeDeliveryOnlyOffer>{
 if(!expected||
  ![expected.tenantId,expected.subjectId,expected.deviceId,expected.sessionId,expected.tabSessionId]
   .every(v=>typeof v==='string'&&opaque.test(v))||
  typeof expected.expectedUrl!=='string'||!/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+$/.test(expected.expectedUrl)||
  !Number.isSafeInteger(expected.sessionEpoch)||expected.sessionEpoch<0||
  !Number.isSafeInteger(expected.legacyTabId)||expected.legacyTabId<0)
  throw Error('BRIDGE_TARGET_NOT_VERIFIED');
 // Pass the server-owned recipient to the trusted resolver. The resolver MUST
 // compare it with the durable command/tab/URL/STOP binding *inside* its
 // transaction and reject BEFORE committing any outbox side effect.
 // Snapshot once: a caller retaining the original expected object must not alter
 // the post-commit comparison while trustedResolve is awaiting storage.
 const target=Object.freeze({...expected});
 const offer=await resolveVerifiedBrowserBridgeOffer(legacyCommandId,id=>trustedResolve(id,target));
 if(offer.tenantId!==target.tenantId||offer.deviceId!==target.deviceId||
  offer.body.subjectId!==target.subjectId||offer.body.sessionId!==target.sessionId||
  offer.body.sessionEpoch!==target.sessionEpoch||
  offer.body.legacyTabId!==target.legacyTabId||
  offer.body.tabSessionId!==target.tabSessionId||
  offer.body.expectedUrl!==target.expectedUrl)
  throw Error('BRIDGE_TARGET_NOT_VERIFIED');
 return offer;
}
