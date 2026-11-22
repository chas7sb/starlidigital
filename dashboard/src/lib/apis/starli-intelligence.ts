export type ConnectionState = 'connecting'|'live'|'reconnecting'|'unavailable'|'unauthorized'|'closed';
export type Source={id:string;name:string;kind:string;enabled:boolean;connector?:string};
export type Observation={id:string;sourceId:string;title?:string;summary:string;claimType:'FACT'|'INFERENCE';confidence:number;sourceIds:string[];sourceUrl?:string;observedAt:string;expiresAt:string;latitude?:number;longitude?:number};
export type Watchlist={id:string;name:string;enabled:boolean;sourceIds?:string[]};
export type Connector={id:string;label:string;available:boolean;reason:string};
export type Capabilities={version:string;nativeBearer:boolean;socialMoments:boolean;watchlists:boolean;notifications:boolean;viewportSnapshots:boolean;momentMedia:boolean;verifiedDirections:boolean;externalMessages:boolean;mapSceneActions:boolean;availableMapGeometry:string[]};
export type Snapshot={capabilities:Capabilities;sources:Source[];observations:Observation[];watchlists:Watchlist[];connectors:Connector[]};
export type View={status:ConnectionState;message:string;data:Snapshot|null;updatedAt:number};
type SocketLike=Pick<WebSocket,'send'|'close'|'readyState'|'onopen'|'onmessage'|'onclose'|'onerror'>;
type Options={token:()=>string;httpUrl:string;webSocketUrl:string;onChange:(view:View)=>void;fetch?:typeof fetch;socket?:(url:string,protocol:string)=>SocketLike};
const SNAPSHOT=`query NativeIntelligence {
 intelligenceCapabilities{version nativeBearer socialMoments watchlists notifications viewportSnapshots momentMedia verifiedDirections externalMessages mapSceneActions availableMapGeometry}
 intelligenceSources(limit:100){id name kind enabled connector}
 intelligenceObservations(limit:100){id sourceId title summary claimType confidence sourceIds sourceUrl observedAt expiresAt latitude longitude}
 intelligenceWatchlists(limit:100){id name enabled sourceIds}
 intelligenceConnectors{id label available reason}
}`;
const CHANGES=`subscription NativeIntelligenceChanges($after:IntelligenceCursor){
 intelligenceChanges(after:$after){cursor hasMore items{seq collection objectId action createdAt}}
}`;
class RequestError extends Error {constructor(readonly code:string){super(code);}}
function protocolCode(error:any):string{const known=['UNAUTHENTICATED','FORBIDDEN','RESYNC_REQUIRED','SUBSCRIPTION_IDLE_TIMEOUT'];return typeof error?.extensions?.code==='string'?error.extensions.code:known.includes(error?.message)?error.message:'UNAVAILABLE';}
const empty=():View=>({status:'closed',message:'',data:null,updatedAt:0});
const cursor=(value:unknown):value is string=>typeof value==='string'&&/^\d{1,32}$/.test(value);
export class IntelligenceClient{
 private boundToken='';
 private view=empty();private generation=0;private disposed=true;private socket:SocketLike|null=null;
 private cursor='0';private failures=0;private retry:ReturnType<typeof setTimeout>|null=null;
 private ack:ReturnType<typeof setTimeout>|null=null;private heartbeat:ReturnType<typeof setInterval>|null=null;
 private extra=new Map<string,{query:string;variables:()=>Record<string,unknown>;apply:(data:any)=>void;error:()=>void}>();private acknowledged=false;private extraId=0;
 private loads:Promise<void>=Promise.resolve();
 private controllers=new Set<AbortController>();private queue:Promise<void>=Promise.resolve();private received=0;
 constructor(private options:Options){}
 private emit(patch:Partial<View>){this.view={...this.view,...patch};this.options.onChange(this.view);}
 private timers(){if(this.retry)clearTimeout(this.retry);if(this.ack)clearTimeout(this.ack);if(this.heartbeat)clearInterval(this.heartbeat);this.retry=null;this.ack=null;this.heartbeat=null;}
 stop(){this.disposed=true;this.generation++;this.timers();for(const c of this.controllers)c.abort();this.controllers.clear();const s=this.socket;this.socket=null;s?.close(1000,'Panel closed');this.cursor='0';this.queue=Promise.resolve();this.extra.clear();this.acknowledged=false;this.loads=Promise.resolve();this.view=empty();this.options.onChange(this.view);}
 async start(){this.stop();this.disposed=false;this.boundToken=this.options.token();const e=this.generation;this.emit({status:'connecting',message:'Connecting to Intelligenceâ€¦'});try{await this.load(e);if(this.current(e))this.connect(e);}catch(error){if(this.current(e))this.fail(error);}}
 private current(e:number){return !this.disposed&&e===this.generation;}
 private async request(query:string,variables:Record<string,unknown>,e:number){
  if(!this.current(e))throw new RequestError('CANCELLED');
  const token=this.options.token();if(!token||token!==this.boundToken)throw new RequestError('UNAUTHENTICATED');
  const controller=new AbortController();this.controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const r=await(this.options.fetch??fetch)(this.options.httpUrl,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:'Bearer '+token},body:JSON.stringify({query,variables}),signal:controller.signal});
   if(r.status===401||r.status===403)throw new RequestError('UNAUTHENTICATED');
   if(!r.ok||!r.headers.get('content-type')?.includes('json'))throw new RequestError('UNAVAILABLE');
   const payload=await r.json();if(!this.current(e))throw new RequestError('CANCELLED');
   if(payload.errors?.length)throw new RequestError(protocolCode(payload.errors[0]));
   if(!payload.data||typeof payload.data!=='object')throw new RequestError('UNAVAILABLE');
   return payload.data;
  }finally{clearTimeout(timeout);this.controllers.delete(controller);}
 }
 private load(e:number){
  const next=this.loads.catch(()=>{}).then(()=>this.snapshot(e));this.loads=next;return next;
 }
 private async snapshot(e:number){
  const d=await this.request(SNAPSHOT,{},e);
  if(d.intelligenceCapabilities?.version!=='starli-intelligence.v1'||d.intelligenceCapabilities.nativeBearer!==true)throw new RequestError('UNAVAILABLE');
  if(!['intelligenceSources','intelligenceObservations','intelligenceWatchlists','intelligenceConnectors'].every(k=>Array.isArray(d[k])))throw new RequestError('UNAVAILABLE');
  if(this.current(e))this.emit({data:{capabilities:d.intelligenceCapabilities,sources:d.intelligenceSources,observations:d.intelligenceObservations,watchlists:d.intelligenceWatchlists,connectors:d.intelligenceConnectors},updatedAt:Date.now()});
 }
 private fail(error:unknown){
  const code=error instanceof RequestError?error.code:'UNAVAILABLE';
  if(code==='CANCELLED')return;
  const denied=['UNAUTHENTICATED','FORBIDDEN'].includes(code);
  this.timers();this.generation++;for(const c of this.controllers)c.abort();this.loads=Promise.resolve();const s=this.socket;this.socket=null;s?.close(1000,'Subscription stopped');
  this.emit({status:denied?'unauthorized':'unavailable',data:null,updatedAt:0,message:denied?'Your Intelligence session is not authorized. Sign in again.':'Intelligence is unavailable. Its authenticated service may not be connected yet.'});
 }
 private reconnect(e:number){
  if(!this.current(e)||this.retry)return;
  this.generation++;const next=this.generation;for(const c of this.controllers)c.abort();this.loads=Promise.resolve();this.timers();this.emit({status:'reconnecting',message:'Connection lost. Reconnecting and checking missed updatesâ€¦',data:null,updatedAt:0});
  const wait=Math.min(30000,1000*2**Math.min(this.failures++,5));
  this.retry=setTimeout(async()=>{this.retry=null;if(!this.current(next))return;try{await this.load(next);if(this.current(next))this.connect(next);}catch(error){if(!this.current(next))return;if(error instanceof RequestError&&['UNAUTHENTICATED','FORBIDDEN'].includes(error.code))this.fail(error);else this.reconnect(next);}},wait);
 }
 private connect(e:number){
  let ws:SocketLike;
  try{ws=(this.options.socket??((url,protocol)=>new WebSocket(url,protocol)))(this.options.webSocketUrl,'graphql-transport-ws');}catch{this.reconnect(e);return;}
  this.socket=ws;this.acknowledged=false;this.received=Date.now();let subscribed=false;
  this.ack=setTimeout(()=>ws.close(4408,'Connection acknowledgement timed out'),10000);
  ws.onopen=()=>{if(this.current(e)&&this.options.token()!==this.boundToken){this.fail(new RequestError('UNAUTHENTICATED'));return;}if(this.current(e)&&this.socket===ws)ws.send(JSON.stringify({type:'connection_init',payload:{authorization:'Bearer '+this.options.token()}}));};
  ws.onmessage=event=>{
   this.received=Date.now();
   this.queue=this.queue.then(async()=>{
    if(!this.current(e)||this.socket!==ws)return;
    if(this.options.token()!==this.boundToken)throw new RequestError('UNAUTHENTICATED');
    let frame:any;try{frame=JSON.parse(String(event.data));}catch{throw new RequestError('UNAVAILABLE');}
    if(frame.type==='ping'){ws.send(JSON.stringify({type:'pong',...(frame.payload?{payload:frame.payload}:{})}));return;}
    if(frame.type==='pong')return;
    if(frame.type==='connection_ack'){
     if(subscribed)return;subscribed=true;this.acknowledged=true;if(this.ack)clearTimeout(this.ack);this.ack=null;
     ws.send(JSON.stringify({id:'intelligence',type:'subscribe',payload:{query:CHANGES,variables:{after:this.cursor}}}));
     for(const [id,operation] of this.extra)this.sendExtra(id,operation);
     this.heartbeat=setInterval(()=>{if(!this.current(e)||this.socket!==ws)return;if(Date.now()-this.received>60000)ws.close(4408,'Heartbeat missed');else if(ws.readyState===1)ws.send(JSON.stringify({type:'ping'}));},25000);return;
    }
    if(frame.id!=='intelligence'){
     const operation=this.extra.get(frame.id);if(!operation)return;
     if(frame.type==='error'||frame.type==='complete'||frame.payload?.errors?.length){
      const code=protocolCode((frame.type==='error'?frame.payload:frame.payload?.errors)?.[0]);
      if(['UNAUTHENTICATED','FORBIDDEN'].includes(code))throw new RequestError(code);
      operation.error();if(['SUBSCRIPTION_IDLE_TIMEOUT','RESYNC_REQUIRED'].includes(code))ws.close(1012,'Resuming live stream');return;
     }
     if(frame.type==='next'){try{operation.apply(frame.payload?.data);}catch{operation.error();}}return;
    }
    if(frame.type==='error'){
     const code=protocolCode(frame.payload?.[0]);
     if(code==='RESYNC_REQUIRED'){this.cursor='0';ws.close(1012,'Resync required');return;}
     if(code==='SUBSCRIPTION_IDLE_TIMEOUT'){ws.close(1012,'Resuming subscription');return;}
     throw new RequestError(code??'UNAVAILABLE');
    }
    if(frame.type==='complete'){ws.close(1012,'Subscription ended');return;}
    if(frame.type!=='next')return;
    if(frame.payload?.errors?.length)throw new RequestError(protocolCode(frame.payload.errors[0]));
    const page=frame.payload?.data?.intelligenceChanges;
    if(!page||!cursor(page.cursor)||!Array.isArray(page.items))throw new RequestError('UNAVAILABLE');
    // Commit only after the authorized snapshot has applied. Replayed pages are idempotent.
    if(BigInt(page.cursor)>BigInt(this.cursor)){await this.load(e);if(!this.current(e)||this.socket!==ws)return;this.cursor=page.cursor;}
    this.failures=0;this.emit({status:'live',message:'Connected Â· updates arrive automatically'});
   }).catch(error=>{if(this.current(e)&&this.socket===ws)this.fail(error);});
  };
  ws.onerror=()=>{if(this.current(e)&&this.socket===ws)ws.close();};
  ws.onclose=event=>{if(!this.current(e)||this.socket!==ws)return;this.socket=null;if(event.code===4401||event.code===4403)this.fail(new RequestError('UNAUTHENTICATED'));else this.reconnect(e);};
 }
 private sendExtra(id:string,operation:{query:string;variables:()=>Record<string,unknown>}){
  if(this.acknowledged&&this.socket?.readyState===1)this.socket.send(JSON.stringify({id,type:'subscribe',payload:{query:operation.query,variables:operation.variables()}}));
 }
 subscribeMoments(filter:Record<string,unknown>,apply:(page:any)=>void,error:()=>void){
  const id='moments-'+(++this.extraId);let after:string|undefined;
  const operation={query:'subscription NativeMoments($filter:SocialMomentsFilter!,$after:String){socialPublicMoments(filter:$filter,after:$after){cursor resync page{cursor hasMore items{id ownerId text audience memberIds state version createdAt updatedAt expiresAt place{kind context latitude longitude label approved bounds{north south east west}}}}}}',
   variables:()=>({filter,...(after?{after}:{})}),apply:(data:any)=>{
    const snapshot=data?.socialPublicMoments;
    if(snapshot?.resync!==true||typeof snapshot.cursor!=='string'||!Array.isArray(snapshot.page?.items))throw Error('INVALID_SNAPSHOT');
    apply(snapshot.page);after=snapshot.cursor;
   },error:()=>{after=undefined;error();}};
  this.extra.set(id,operation);this.sendExtra(id,operation);
  return()=>{this.extra.delete(id);if(this.socket?.readyState===1)this.socket.send(JSON.stringify({id,type:'complete'}));};
 }
 subscribeLiveLocations(apply:(snapshot:any)=>void,error:()=>void){
  const id='location-'+(++this.extraId);let after:string|undefined;
  const operation={query:'subscription NativeLiveLocations($after:String){socialLiveLocations(after:$after){cursor resync sessions{id ownerId audience memberIds shareWithAI precision status sequence startedAt expiresAt stoppedAt stopReason version position{latitude longitude accuracyMeters capturedAt receivedAt freshUntil precision}}}}',
   variables:()=>({...after?{after}:{}}),apply:(data:any)=>{
    const snapshot=data?.socialLiveLocations;
    if(snapshot?.resync!==true||typeof snapshot.cursor!=='string'||!Array.isArray(snapshot.sessions))throw Error('INVALID_SNAPSHOT');
    apply(snapshot);after=snapshot.cursor;
   },error:()=>{after=undefined;error();}};
  this.extra.set(id,operation);this.sendExtra(id,operation);
  return()=>{this.extra.delete(id);if(this.socket?.readyState===1)this.socket.send(JSON.stringify({id,type:'complete'}));};
 }
 async execute(query:string,variables:Record<string,unknown>){
  const e=this.generation;if(this.view.status!=='live')throw new Error('Connect to Intelligence before taking this action.');
  try{return await this.request(query,variables,e);}catch(error){if(error instanceof RequestError&&['UNAUTHENTICATED','FORBIDDEN'].includes(error.code)&&this.current(e))this.fail(error);throw new Error('The action could not be confirmed. No automatic retry was made.');}
 }
 async followSource(sourceId:string,name:string,idempotencyKey:string){
  const e=this.generation;
  if(this.view.status!=='live')throw new Error('Connect to Intelligence before saving a watchlist.');
  try{
   await this.request('mutation NativeFollowSource($input:IntelligenceWatchlistInput!){intelligenceUpsertWatchlist(input:$input){id}}',{input:{name,sourceIds:[sourceId],enabled:true,idempotencyKey}},e);
   await this.load(e);
  }catch(error){if(error instanceof RequestError&&['UNAUTHENTICATED','FORBIDDEN'].includes(error.code)&&this.current(e))this.fail(error);throw new Error('The watchlist could not be confirmed. Retry the same request when connected.');}
 }
}

export function resolveIntelligenceEndpoint(configured:unknown,_stage:boolean,pageOrigin:string):string{
 const page=new URL(pageOrigin);
 const endpoint=new URL(typeof configured==='string'&&configured.trim()?configured.trim():'/graphql',page);
 const loopback=['127.0.0.1','localhost','[::1]'];
 const localHttp=page.protocol==='http:'&&endpoint.protocol==='http:'&&loopback.includes(page.hostname)&&loopback.includes(endpoint.hostname);
 if((endpoint.protocol!=='https:'&&!localHttp)||endpoint.pathname!=='/graphql'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password)throw new Error('Untrusted Intelligence endpoint.');
 return endpoint.href;
}
