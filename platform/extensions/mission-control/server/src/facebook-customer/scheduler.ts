/** LCG5 isolated Facebook Pages customer scheduler. Never registered or launched. */
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Store} from '../store.js';
import type {FacebookCustomerPrincipal,FacebookMediaGrant,FacebookPageGrant,FacebookPostNowCommand,FacebookPostNowReceipt} from './post-now.js';

const JOBS='facebook-customer-schedule',KEYS='facebook-customer-schedule-keys',CANCEL_KEYS='facebook-customer-schedule-cancel-keys',AUDIT='facebook-customer-schedule-audit';
const TZ='Europe/Bucharest' as const;
const REQUIRED_SCOPES=['pages_show_list','pages_read_engagement','pages_manage_posts'];
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const id=(v:string,label:string,max=160)=>{
 if(typeof v!=='string'||v.length<1||v.length>max||!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v))throw new Error('INVALID_'+label);
 return v;
};
const code=(s:string)=>/^[A-Z][A-Z0-9_]{0,63}$/.test(s)?s:'UNVERIFIED_RESULT';

export type BucharestLocalInput={localDate:string;localTime:string;timezone:'Europe/Bucharest';utcOffsetMinutes?:120|180};
export interface FacebookScheduleCommand extends FacebookPostNowCommand,BucharestLocalInput {}
export type FacebookScheduleState='QUEUED'|'CANCELLED'|'DISPATCHING'|'PUBLISHED'|'FAILED'|'NEEDS_REAUTH'|'UNCERTAIN';
export interface FacebookScheduleReceipt {
 id:string;tenantId:string;userId:string;pageConnectionId:string;state:Exclude<FacebookScheduleState,'DISPATCHING'>;
 scheduledAt:string;timezone:'Europe/Bucharest';utcOffsetMinutes:120|180;createdAt:string;updatedAt:string;
 providerPostRef?:string;publishedAt?:string;errorCode?:string;
}
export interface SelectedPageGrant extends FacebookPageGrant {connectionRevision:string;selectionRevision?:string}
export interface ScheduleCipher {seal(plaintext:string):string;open(ciphertext:string):string}
export function createScheduleCipher(key:Uint8Array):ScheduleCipher {
 if(!(key instanceof Uint8Array)||key.byteLength!==32)throw new Error('SCHEDULE_CIPHER_KEY_REQUIRED');
 const bytes=Buffer.from(key);
 return {
  seal(plaintext){
   const iv=randomBytes(12),enc=createCipheriv('aes-256-gcm',bytes,iv);
   const cipher=Buffer.concat([enc.update(plaintext,'utf8'),enc.final()]);
   return ['v1',iv.toString('base64url'),enc.getAuthTag().toString('base64url'),cipher.toString('base64url')].join('.');
  },
  open(sealed){
   const parts=sealed.split('.');
   if(parts.length!==4||parts[0]!=='v1')throw new Error('SCHEDULE_PAYLOAD_UNAVAILABLE');
   try{
    const iv=Buffer.from(parts[1]||'','base64url'),tag=Buffer.from(parts[2]||'','base64url');
    if(iv.length!==12||tag.length!==16)throw Error('INVALID_CIPHER');
    const dec=createDecipheriv('aes-256-gcm',bytes,iv);dec.setAuthTag(tag);
    return Buffer.concat([dec.update(Buffer.from(parts[3]||'','base64url')),dec.final()]).toString('utf8');
   }catch{throw new Error('SCHEDULE_PAYLOAD_UNAVAILABLE');}
  },
 };
}
const dateParts=(epoch:number)=>{
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const p=Object.fromEntries(fmt.formatToParts(new Date(epoch)).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};
};
/** DST spring gap rejects, autumn fold requires an explicit offset. */
export function resolveBucharestTime(input:BucharestLocalInput,now:Date):{scheduledAt:string;utcOffsetMinutes:120|180}{
 if(input?.timezone!==TZ)throw new Error('EUROPE_BUCHAREST_REQUIRED');
 if(typeof input.localDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.localDate)||typeof input.localTime!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.localTime))throw new Error('INVALID_LOCAL_TIME');
 const [year,month,day]=input.localDate.split('-').map(Number);
 const [hour,minute]=input.localTime.split(':').map(Number);
 if(year===undefined||month===undefined||day===undefined||hour===undefined||minute===undefined||year<2000||year>9999)throw new Error('INVALID_LOCAL_DATE');
 const mid=Date.UTC(year,month-1,day);
 const checked=new Date(mid);
 if(checked.getUTCFullYear()!==year||checked.getUTCMonth()!==month-1||checked.getUTCDate()!==day)throw new Error('INVALID_LOCAL_DATE');
 const utc=Date.UTC(year,month-1,day,hour,minute);
 const candidates=([120,180] as const).flatMap(offset=>{
  const epoch=utc-offset*60_000;
  const local=dateParts(epoch);
  return local.date===input.localDate&&local.time===input.localTime?[{epoch,offset}]:[];
 });
 if(!candidates.length)throw new Error('NONEXISTENT_DST_LOCAL_TIME');
 if(candidates.length>1&&input.utcOffsetMinutes===undefined)throw new Error('AMBIGUOUS_DST_OFFSET_REQUIRED');
 if(input.utcOffsetMinutes!==undefined&&input.utcOffsetMinutes!==120&&input.utcOffsetMinutes!==180)throw new Error('INVALID_UTC_OFFSET');
 const selected=candidates.find(c=>input.utcOffsetMinutes===undefined||c.offset===input.utcOffsetMinutes);
 if(!selected)throw new Error('UTC_OFFSET_NOT_VALID_FOR_DATE');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error('INVALID_CLOCK');
 if(selected.epoch<=now.getTime())throw new Error('SCHEDULE_MUST_BE_FUTURE');
 return {scheduledAt:new Date(selected.epoch).toISOString(),utcOffsetMinutes:selected.offset};
}
export interface SchedulerPorts {
 /** Trusted server-side membership check. When tenant and user differ, fail closed without it. */
 authorizeTenantUser?:(tenantId:string,userId:string)=>boolean;
 authorizeSchedule(input:FacebookCustomerPrincipal&{pageConnectionId:string;payloadHash:string;scheduledAt:string}):Promise<boolean>;
 authorizeCancel(input:FacebookCustomerPrincipal&{jobId:string;idempotencyKey:string}):Promise<boolean>;
 /** Current selected Page, OAuth revision and Page task grants; never trust tool fields. */
 resolvePage(input:{tenantId:string;userId:string;pageConnectionId:string}):Promise<SelectedPageGrant|undefined>;
 resolveMedia(input:{tenantId:string;userId:string;mediaRef:string}):Promise<FacebookMediaGrant|undefined>;
 authorizeDueDispatch(input:{tenantId:string;userId:string;originalCommandId:string;jobId:string;payloadHash:string}):Promise<boolean>;
 cipher:ScheduleCipher;
 /** Injectable trusted LCG4 service only. NEVER Meta provider network in this module. */
 publisher:{publishNow(principal:FacebookCustomerPrincipal,command:FacebookPostNowCommand):Promise<FacebookPostNowReceipt>};
}
interface PrivatePayload {
 tenantId:string;userId:string;commandId:string;pageConnectionId:string;caption:string;mediaRefs:string[];
 connectionRevision:string;selectionRevision?:string;pageId:string;mediaHashes:string[];scheduledAt:string;
}
interface Stored {
 id:string;tenantId:string;userId:string;commandId:string;pageConnectionId:string;
 scheduledAt:string;utcOffsetMinutes:120|180;timezone:'Europe/Bucharest';state:FacebookScheduleState;
 payloadHash:string;sealedPayload:string;createdAt:string;updatedAt:string;
 providerPostRef?:string;publishedAt?:string;errorCode?:string;
}
type Normal={pageConnectionId:string;caption:string;mediaRefs:string[];idempotencyKey:string};
export class FacebookCustomerScheduler {
 constructor(private readonly store:Store,private readonly ports:SchedulerPorts,private readonly options:{enqueueEnabled?:boolean;dispatchEnabled?:boolean;clock?:()=>Date}={}){}
 private now(){return this.options.clock?.()||new Date();}
 private principal(p:FacebookCustomerPrincipal){
  if(!p||p.audience!=='customer-mcp')throw new Error('CUSTOMER_MCP_REQUIRED');
  id(p.tenantId,'TENANT',200);id(p.userId,'USER',200);id(p.commandId,'COMMAND',160);
  if(p.tenantId!==p.userId&&this.ports.authorizeTenantUser?.(p.tenantId,p.userId)!==true)throw new Error('CUSTOMER_TENANT_MISMATCH');
  const user=this.store.user(p.userId);
  if(!user||user.disabled||!['USER','CUSTOMER'].includes(String(user.role)))throw new Error('CUSTOMER_ACCOUNT_REQUIRED');
 }
 private normalize(c:FacebookScheduleCommand):Normal{
  if(!c||typeof c!=='object')throw new Error('INVALID_POST');
  const pageConnectionId=id(c.pageConnectionId,'PAGE_CONNECTION'),idempotencyKey=id(c.idempotencyKey,'IDEMPOTENCY_KEY');
  if(idempotencyKey.length<8)throw new Error('IDEMPOTENCY_KEY_TOO_SHORT');
  if(typeof c.caption!=='string'||c.caption.length>5000||c.caption.includes('\u0000'))throw new Error('INVALID_CAPTION');
  const caption=c.caption.trim();
  if(c.mediaRefs!==undefined&&!Array.isArray(c.mediaRefs))throw new Error('INVALID_MEDIA_REFS');
  const mediaRefs=(c.mediaRefs||[]).map(x=>id(x,'MEDIA_REF'));
  if(mediaRefs.length>1||new Set(mediaRefs).size!==mediaRefs.length)throw new Error('INVALID_MEDIA_REFS');
  if(!caption&&!mediaRefs.length)throw new Error('EMPTY_POST');
  return {pageConnectionId,idempotencyKey,caption,mediaRefs};
 }
 private page(p:FacebookCustomerPrincipal,connectionId:string,grant:SelectedPageGrant|undefined){
  if(!grant||grant.tenantId!==p.tenantId||grant.ownerUserId!==p.userId||grant.connectionId!==connectionId||grant.targetType!=='PAGE'||grant.status!=='CONNECTED')throw new Error('PAGE_ACCESS_DENIED');
  id(grant.pageId,'PAGE_ID',100);id(grant.connectionRevision,'CONNECTION_REVISION');
  if(grant.selectionRevision!==undefined)id(grant.selectionRevision,'SELECTION_REVISION');
  if(!grant.tasks.includes('CREATE_CONTENT')||REQUIRED_SCOPES.some(x=>!grant.scopes.includes(x)))throw new Error('PAGE_PERMISSION_REQUIRED');
  return grant;
 }
 private media(p:FacebookCustomerPrincipal,ref:string,m:FacebookMediaGrant|undefined){
  if(!m||m.ref!==ref||m.tenantId!==p.tenantId||m.ownerUserId!==p.userId||m.state!=='READY')throw new Error('MEDIA_ACCESS_DENIED');
  if(!/^[a-f0-9]{64}$/.test(m.sha256)||!Number.isSafeInteger(m.bytes)||m.bytes<1)throw new Error('INVALID_MEDIA_METADATA');
  if(m.kind==='IMAGE'&&(!['image/jpeg','image/png'].includes(m.mimeType)||m.bytes>8_000_000))throw new Error('INVALID_IMAGE');
  if(m.kind==='VIDEO'&&(m.mimeType!=='video/mp4'||m.bytes>100_000_000))throw new Error('INVALID_VIDEO');
  return m;
 }
 private async preflight(p:FacebookCustomerPrincipal,c:Normal){
  const page=this.page(p,c.pageConnectionId,await this.ports.resolvePage({tenantId:p.tenantId,userId:p.userId,pageConnectionId:c.pageConnectionId}));
  const media:FacebookMediaGrant[]=[];
  for(const ref of c.mediaRefs)media.push(this.media(p,ref,await this.ports.resolveMedia({tenantId:p.tenantId,userId:p.userId,mediaRef:ref})));
  return {page,media};
 }
 private txn<T>(fn:()=>T):T{
  this.store.db.exec('BEGIN IMMEDIATE');
  try{const val=fn();this.store.db.exec('COMMIT');return val;}
  catch(e){this.store.db.exec('ROLLBACK');throw e;}
 }
 private stored(tenant:string,jobId:string):Stored|undefined{
  const found=this.store.get(JOBS,jobId) as Stored|undefined;
  return found?.tenantId===tenant?found:undefined;
 }
 private keyId(tenant:string,key:string,purpose:string){return 'fbsc-'+purpose+'-'+hash(tenant+'\u0000'+key);}
 private jobId(p:FacebookCustomerPrincipal){return 'fbsc-'+hash(p.tenantId+'\u0000'+p.commandId);}
 private receipt(j:Stored):FacebookScheduleReceipt{
  const {id,tenantId,userId,pageConnectionId,scheduledAt,utcOffsetMinutes,timezone,createdAt,updatedAt,providerPostRef,publishedAt,errorCode}=j;
  return {id,tenantId,userId,pageConnectionId,scheduledAt,utcOffsetMinutes,timezone,createdAt,updatedAt,
   state:j.state==='DISPATCHING'?'UNCERTAIN':j.state,providerPostRef,publishedAt,
   errorCode:j.state==='DISPATCHING'?'DISPATCH_IN_FLIGHT_OR_LOST_ACK':errorCode};
 }
 private audit(j:Stored,event:string){
  this.store.put(AUDIT,{id:'fbsc-audit-'+randomUUID(),tenantId:j.tenantId,userId:j.userId,jobId:j.id,event,state:j.state,at:this.now().toISOString()},j.tenantId);
 }
 private finish(j:Stored,change:Partial<Stored>,event:string):FacebookScheduleReceipt{
  const updated={...j,...change,updatedAt:this.now().toISOString()};
  this.txn(()=>{this.store.put(JOBS,updated,j.tenantId);this.audit(updated,event);});
  return this.receipt(updated);
 }
 async schedule(p:FacebookCustomerPrincipal,c:FacebookScheduleCommand):Promise<FacebookScheduleReceipt>{
  if(this.options.enqueueEnabled!==true)throw new Error('FACEBOOK_SCHEDULER_DISABLED');
  this.principal(p);
  const norm=this.normalize(c);
  const jobId=this.jobId(p);
  // An exact retry of an existing durable command must remain idempotent
  // after its scheduled time, including CANCELLED and UNCERTAIN states.
  // New commands still require a strictly future date. We always validate
  // the full local calendar/offset, and the later atomic payloadHash check
  // prevents any amended or cross-tenant replay from creating a new job.
  const alreadyQueued=this.stored(p.tenantId,jobId);
  const time=resolveBucharestTime(c,alreadyQueued?new Date(0):this.now());
  const payloadHash=hash(JSON.stringify([p.tenantId,p.userId,p.commandId,norm.pageConnectionId,norm.caption,norm.mediaRefs,time.scheduledAt]));
  if(!await this.ports.authorizeSchedule({...p,pageConnectionId:norm.pageConnectionId,payloadHash,scheduledAt:time.scheduledAt}))throw new Error('EXPLICIT_SCHEDULE_COMMAND_REQUIRED');
  const verified=await this.preflight(p,norm);
  const key=this.keyId(p.tenantId,norm.idempotencyKey,'request');
  const privateData:PrivatePayload={tenantId:p.tenantId,userId:p.userId,commandId:p.commandId,pageConnectionId:norm.pageConnectionId,caption:norm.caption,mediaRefs:norm.mediaRefs,
   connectionRevision:verified.page.connectionRevision,selectionRevision:verified.page.selectionRevision,pageId:verified.page.pageId,mediaHashes:verified.media.map(x=>x.sha256),scheduledAt:time.scheduledAt};
  const at=this.now().toISOString();
  const job:Stored={id:jobId,tenantId:p.tenantId,userId:p.userId,commandId:p.commandId,pageConnectionId:norm.pageConnectionId,state:'QUEUED',
   scheduledAt:time.scheduledAt,utcOffsetMinutes:time.utcOffsetMinutes,timezone:TZ,payloadHash,sealedPayload:this.ports.cipher.seal(JSON.stringify(privateData)),createdAt:at,updatedAt:at};
  const found=this.txn(()=>{
   const existing=this.stored(p.tenantId,jobId),lock=this.store.get(KEYS,key);
   if(existing&&(existing.userId!==p.userId||existing.payloadHash!==payloadHash))throw new Error('IDEMPOTENCY_PAYLOAD_CONFLICT');
   if(lock&&(lock.tenantId!==p.tenantId||lock.jobId!==jobId||lock.payloadHash!==payloadHash))throw new Error('IDEMPOTENCY_KEY_CONFLICT');
   if(existing){
    if(!lock)this.store.put(KEYS,{id:key,tenantId:p.tenantId,jobId,payloadHash},p.tenantId);
    return existing;
   }
   if(lock)throw new Error('IDEMPOTENCY_ORPHAN_KEY');
   this.store.put(JOBS,job,p.tenantId);
   this.store.put(KEYS,{id:key,tenantId:p.tenantId,jobId,payloadHash},p.tenantId);
   this.audit(job,'QUEUED');
   return job;
  });
  return this.receipt(found);
 }
 getStatus(p:FacebookCustomerPrincipal,jobId:string):FacebookScheduleReceipt|undefined{
  this.principal(p);id(jobId,'JOB_ID',200);
  const found=this.stored(p.tenantId,jobId);
  return found&&found.userId===p.userId?this.receipt(found):undefined;
 }
 list(p:FacebookCustomerPrincipal,{limit=20,cursor}:{limit?:number;cursor?:string}={}):{jobs:FacebookScheduleReceipt[];nextCursor?:string}{
  this.principal(p);
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('INVALID_LIMIT');
  if(cursor!==undefined)id(cursor,'CURSOR',200);
  const all=(this.store.list(JOBS,p.tenantId) as Stored[]).filter(x=>x.tenantId===p.tenantId&&x.userId===p.userId)
   .sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)||a.id.localeCompare(b.id));
  const index=cursor===undefined?0:all.findIndex(x=>x.id===cursor)+1;
  if(cursor!==undefined&&index===0)throw new Error('INVALID_CURSOR');
  const records=all.slice(index,index+limit);
  return {jobs:records.map(x=>this.receipt(x)),nextCursor:index+limit<all.length?records.at(-1)?.id:undefined};
 }
 async cancel(p:FacebookCustomerPrincipal,jobId:string,idempotencyKey:string):Promise<FacebookScheduleReceipt|undefined>{
  this.principal(p);id(jobId,'JOB_ID',200);id(idempotencyKey,'CANCEL_KEY');
  if(idempotencyKey.length<8)throw new Error('IDEMPOTENCY_KEY_TOO_SHORT');
  if(!await this.ports.authorizeCancel({...p,jobId,idempotencyKey}))throw new Error('EXPLICIT_CANCEL_COMMAND_REQUIRED');
  const key=this.keyId(p.tenantId,idempotencyKey,'cancel');
  const record=this.txn(()=>{
   const found=this.stored(p.tenantId,jobId);
   if(!found||found.userId!==p.userId)return undefined;
   const lock=this.store.get(CANCEL_KEYS,key);
   if(lock&&(lock.tenantId!==p.tenantId||lock.jobId!==jobId))throw new Error('CANCEL_IDEMPOTENCY_CONFLICT');
   if(!lock)this.store.put(CANCEL_KEYS,{id:key,tenantId:p.tenantId,jobId},p.tenantId);
   if(found.state!=='QUEUED'&&found.state!=='NEEDS_REAUTH')return found;
   const updated:Stored={...found,state:'CANCELLED',updatedAt:this.now().toISOString()};
   this.store.put(JOBS,updated,p.tenantId);this.audit(updated,'CANCELLED');
   return updated;
  });
  return record?this.receipt(record):undefined;
 }
 /** Internal due worker only; atomic attempt claim BEFORE any possible external send. */
 async dispatchDue(limit=20):Promise<FacebookScheduleReceipt[]>{
  if(this.options.dispatchEnabled!==true)throw new Error('FACEBOOK_DISPATCH_DISABLED');
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('INVALID_LIMIT');
  const now=this.now().getTime();
  const due=(this.store.list(JOBS) as Stored[]).filter(x=>x.state==='QUEUED'&&Date.parse(x.scheduledAt)<=now)
   .sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)||a.id.localeCompare(b.id)).slice(0,limit);
  const results:FacebookScheduleReceipt[]=[];
  for(const item of due){
   const claimed=this.txn(()=>{
    const current=this.stored(item.tenantId,item.id);
    if(!current||current.state!=='QUEUED'||Date.parse(current.scheduledAt)>this.now().getTime())return undefined;
    const next:Stored={...current,state:'DISPATCHING',updatedAt:this.now().toISOString()};
    this.store.put(JOBS,next,next.tenantId);this.audit(next,'DISPATCH_CLAIMED');
    return next;
   });
   if(!claimed)continue;
   let externalAttemptStarted=false;
   try{
    const payload=JSON.parse(this.ports.cipher.open(claimed.sealedPayload)) as PrivatePayload;
    if(payload.tenantId!==claimed.tenantId||payload.userId!==claimed.userId||payload.commandId!==claimed.commandId||
       payload.pageConnectionId!==claimed.pageConnectionId||payload.scheduledAt!==claimed.scheduledAt)throw Error('PAYLOAD_SCOPE_CHANGED');
    // Recompute the durable schedule's original immutable request hash. The
    // authorization port alone cannot vouch for a corrupted SQLite row.
    const verifiedHash=hash(JSON.stringify([payload.tenantId,payload.userId,payload.commandId,payload.pageConnectionId,payload.caption,payload.mediaRefs,payload.scheduledAt]));
    if(verifiedHash!==claimed.payloadHash)throw Error('PAYLOAD_INTEGRITY_CHANGED');
    const p:FacebookCustomerPrincipal={tenantId:claimed.tenantId,userId:claimed.userId,commandId:claimed.commandId,audience:'customer-mcp'};
    this.principal(p);
    if(!await this.ports.authorizeDueDispatch({tenantId:p.tenantId,userId:p.userId,originalCommandId:p.commandId,jobId:claimed.id,payloadHash:claimed.payloadHash}))throw Error('SCHEDULE_AUTH_REVOKED');
    const dispatchKey='fbsc-due-'+hash(claimed.id).slice(0,60);
    const norm:Normal={pageConnectionId:payload.pageConnectionId,caption:payload.caption,mediaRefs:payload.mediaRefs,idempotencyKey:dispatchKey};
    const v=await this.preflight(p,norm);
    if(v.page.pageId!==payload.pageId||v.page.connectionRevision!==payload.connectionRevision||v.page.selectionRevision!==payload.selectionRevision)throw Error('PAGE_REVISION_CHANGED');
    if(JSON.stringify(v.media.map(x=>x.sha256))!==JSON.stringify(payload.mediaHashes))throw Error('MEDIA_CHANGED');
    // LCG1 must bind this derived, stable command to original verified scheduling consent
    // within LCG4's authorizeExplicitCommand, not trust an unverified tool parameter.
    const dispatchPrincipal:FacebookCustomerPrincipal={...p,commandId:dispatchKey};
    // After this boundary, even a permission-shaped exception might be a
    // provider lost ACK. Never label it proven not sent or retry automatically.
    externalAttemptStarted=true;
    const result=await this.ports.publisher.publishNow(dispatchPrincipal,norm);
    // A provider/LCG4 receipt must be bound to the exact derived command,
    // tenant, customer and Page connection. Never project a foreign receipt.
    const bound=!!result&&result.tenantId===claimed.tenantId&&result.userId===claimed.userId&&
      result.commandId===dispatchKey&&result.pageConnectionId===claimed.pageConnectionId;
    if(!bound){
      results.push(this.finish(claimed,{state:'UNCERTAIN',errorCode:'PUBLISHER_RECEIPT_SCOPE_MISMATCH'},'UNCERTAIN'));
    }else if(result.state==='PUBLISHED'&&typeof result.providerPostId==='string'&&
      /^[A-Za-z0-9_.:-]{1,200}$/.test(result.providerPostId)){
      const publishedAt=result.publishedAt&&Number.isFinite(Date.parse(result.publishedAt))?
        new Date(result.publishedAt).toISOString():undefined;
      results.push(this.finish(claimed,{state:'PUBLISHED',providerPostRef:result.providerPostId,publishedAt},'PUBLISHED'));
    }else if(result.state==='NOT_PUBLISHED'){
      results.push(this.finish(claimed,{state:'FAILED',errorCode:code(result.errorCode||'PROVEN_NOT_SENT')},'FAILED'));
    }else{
      results.push(this.finish(claimed,{state:'UNCERTAIN',errorCode:'PROVIDER_OUTCOME_UNCONFIRMED'},'UNCERTAIN'));
    }
   }catch(e){
    const reason=e instanceof Error?e.message:'UNVERIFIED';
    const blocked=!externalAttemptStarted&&['SCHEDULE_AUTH_REVOKED','PAGE_REVISION_CHANGED','PAGE_ACCESS_DENIED','PAGE_PERMISSION_REQUIRED','MEDIA_ACCESS_DENIED','MEDIA_CHANGED','CUSTOMER_ACCOUNT_REQUIRED'].includes(reason);
    results.push(this.finish(claimed,{state:blocked?'NEEDS_REAUTH':'UNCERTAIN',errorCode:blocked?code(reason):reason==='PAYLOAD_INTEGRITY_CHANGED'?'PAYLOAD_INTEGRITY_CHANGED':'DISPATCH_OUTCOME_UNCONFIRMED'},blocked?'NEEDS_REAUTH':'UNCERTAIN'));
   }
  }
  return results;
 }
}
