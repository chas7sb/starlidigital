export type LivePosition={latitude:number;longitude:number;accuracyMeters:number;capturedAt:string;receivedAt:string;freshUntil:string;precision:'APPROXIMATE'|'PRECISE'};
export type LiveSession={id:string;ownerId:string;audience:'SELF'|'MEMBERS';memberIds:string[];shareWithAI:boolean;precision:'APPROXIMATE'|'PRECISE';status:string;sequence:number;position:LivePosition|null;startedAt:string;expiresAt:string;stoppedAt:string|null;stopReason:string|null;version:number};
export type LiveSnapshot={cursor:string;resync:true;sessions:LiveSession[]};
export function freshPosition(session:LiveSession,now=Date.now()):LivePosition|null{
 const p=session.position;
 return session.status==='LIVE'&&p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180&&Date.parse(p.freshUntil)>now&&Date.parse(session.expiresAt)>now?p:null;
}
export function replaceLiveSnapshot(value:unknown):LiveSnapshot{
 const v=value as LiveSnapshot;
 if(v?.resync!==true||typeof v.cursor!=='string'||!Array.isArray(v.sessions)||v.sessions.length>50||new Set(v.sessions.map(s=>s.id)).size!==v.sessions.length||v.sessions.some(s=>typeof s.id!=='string'||typeof s.ownerId!=='string'))throw Error('Invalid live location snapshot.');
 return {...v,sessions:v.sessions.map(s=>({...s,position:freshPosition(s)}))};
}
type Geo=Pick<Geolocation,'watchPosition'|'clearWatch'>;
export type LiveStartInput={audience:'SELF'|'MEMBERS';memberIds:string[];shareWithAI:boolean;precision:'APPROXIMATE'|'PRECISE';preciseConfirmed:boolean;ttlSeconds:number;confirmed:true;purpose:'START_LIVE_LOCATION';sourceHash:string};
export type LiveTransport={start:(input:LiveStartInput)=>Promise<LiveSession>;update:(input:Record<string,unknown>)=>Promise<unknown>;stop:(sessionId:string)=>Promise<unknown>};
/** Foreground only. Stop clears the device watcher before attempting any network request. */
export class ForegroundLocation {
 private epoch=0;private watch:number|null=null;private session:LiveSession|null=null;private sending=false;private nextSendAt=0;private timer:ReturnType<typeof setTimeout>|null=null;private expiry:ReturnType<typeof setTimeout>|null=null;private pending:GeolocationPosition|null=null;
 constructor(private geo:Geo,private visible:()=>boolean,private transport:LiveTransport,private error:(message:string)=>void,private hash:(value:unknown)=>Promise<string>,private now:()=>number=Date.now){}
 async start(input:LiveStartInput){
  if(!input.confirmed||!this.visible())throw Error('Keep this page visible to start sharing.');
  if(this.session)throw Error('Stop the existing foreground session first.');
  const epoch=++this.epoch,session=await this.transport.start(input);
  if(epoch!==this.epoch||!this.visible()){await this.transport.stop(session.id);return;}
  this.session=session;
  if(['STOPPED','EXPIRED'].includes(session.status)){this.session=null;throw Error('The location session is no longer active.');}
  const remaining=Date.parse(session.expiresAt)-this.now();
  if(!Number.isFinite(remaining)||remaining<=0){await this.stop();return;}
  this.expiry=setTimeout(()=>{if(epoch===this.epoch&&this.session?.id===session.id)void this.stop().catch(()=>this.error('Device tracking stopped at expiry. Server stop could not be confirmed.'));},Math.min(remaining,3600000));

  try{this.watch=this.geo.watchPosition(position=>{if(epoch===this.epoch){this.pending=position;void this.flush(epoch);}},()=>{
   if(epoch===this.epoch){this.error('Device location is unavailable. Sharing has stopped on this page.');void this.stop().catch(()=>this.error('Device tracking stopped. Server stop could not be confirmed; freshness and expiry still apply.'));}
  },{enableHighAccuracy:input.precision==='PRECISE',maximumAge:0,timeout:15000});}catch(error){await this.stop();throw error;}
 }
 private async flush(epoch:number){
  if(this.sending||this.timer)return;
  if(this.now()<this.nextSendAt){this.timer=setTimeout(()=>{this.timer=null;void this.flush(epoch);},this.nextSendAt-this.now());return;}
  this.sending=true;
  try{while(this.pending&&epoch===this.epoch&&this.session){
   const position=this.pending;this.pending=null;
   if(!this.visible()||Date.parse(this.session.expiresAt)<=this.now()){await this.stop();return;}
   const {latitude,longitude,accuracy}=position.coords;
   if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!Number.isFinite(accuracy)||accuracy<0||Math.abs(latitude)>90||Math.abs(longitude)>180)continue;
   if(this.now()-position.timestamp>120000||position.timestamp-this.now()>15000)continue;
   const input={sessionId:this.session.id,sequence:++this.session.sequence,latitude,longitude,accuracyMeters:accuracy,capturedAt:new Date(position.timestamp).toISOString(),foreground:true};
   const sourceHash=await this.hash(input);if(epoch!==this.epoch||!this.visible())continue;
   await this.transport.update({...input,sourceHash});if(epoch!==this.epoch)break;this.nextSendAt=this.now()+2000;if(this.pending)break;
  }}catch{if(epoch===this.epoch){this.error('A location update could not be confirmed. Device sharing has stopped.');await this.stop().catch(()=>this.error('Device tracking stopped. Server stop could not be confirmed; freshness and expiry still apply.'));}}
  finally{this.sending=false;if(this.pending&&this.session)void this.flush(this.epoch);}
 }
 reconcile(sessions:LiveSession[]){
  if(!this.session)return;
  const current=sessions.find(session=>session.id===this.session?.id);
  if(!current||['STOPPED','EXPIRED'].includes(current.status))void this.stop(false);
 }
 async stop(notifyServer=true){
  ++this.epoch;if(this.expiry)clearTimeout(this.expiry);this.expiry=null;this.pending=null;if(this.timer)clearTimeout(this.timer);this.timer=null;this.nextSendAt=0;if(this.watch!==null)this.geo.clearWatch(this.watch);this.watch=null;
  const session=this.session;this.session=null;if(session&&notifyServer)await this.transport.stop(session.id);
 }
 get active(){return this.watch!==null;}
 get sessionId(){return this.session?.id??null;}
 get expiresAt(){return this.session?.expiresAt??null;}
}
export async function locationHash(value:unknown){const bytes=new TextEncoder().encode(JSON.stringify(value));const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}

/** Preparation must not outlive the pane/account that requested it. */
export async function startCurrentForeground(
 foreground:Pick<ForegroundLocation,'start'>,
 input:Omit<LiveStartInput,'sourceHash'>,
 current:()=>boolean,
 hash:(value:unknown)=>Promise<string>=locationHash,
 operation:string=crypto.randomUUID()
):Promise<boolean>{
 if(!current())return false;
 const sourceHash=await hash({...input,operation});
 if(!current())return false;
 await foreground.start({...input,sourceHash});
 return current();
}
