/** LCG14 standalone, opt-in durable daily-loop engine. Not an MCP registration or Meta transport. */
import {createHash} from 'node:crypto';
import type {Store} from '../store.js';
import {resolveBucharestTime,type ScheduleCipher} from './scheduler.js';

const LOOPS='facebook-customer-daily-loops',DAYS='facebook-customer-daily-occurrences';
const CONSENT_BINDINGS='facebook-customer-loop-consent-bindings';
const TZ='Europe/Bucharest' as const;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const safe=(s:string,n:string,max=180)=>{
 if(typeof s!=='string'||s.length<1||s.length>max||!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(s))throw Error('INVALID_'+n);
 return s;
};
const localDate=(d:Date)=>{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
};
export interface DailyPrincipal {tenantId:string;userId:string;commandId:string;audience:'customer-mcp'}
export type LoopState='ACTIVE'|'PAUSED'|'CANCELLED';
export type DayState='CLAIMED'|'PUBLISHED'|'BLOCKED'|'UNCERTAIN'|'FAILED';
export interface DailyReceipt {
 id:string;tenantId:string;userId:string;pageConnectionId:string;state:LoopState;
 localTime:string;timezone:typeof TZ;version:number;createdAt:string;updatedAt:string;
}
export interface DayReceipt {
 id:string;loopId:string;tenantId:string;userId:string;localDate:string;scheduledAt:string;
 state:DayState;version:number;providerPostId?:string;errorCode?:string;
}
interface Loop extends DailyReceipt {sealedPrompt:string;promptHash:string;consentRef:string;requestHash:string}
interface Day extends DayReceipt {claimedAt:string;updatedAt:string}
export interface DailyPorts {
 cipher:ScheduleCipher;
 /** Tenant membership MUST be verified server-side, not from request JSON. */
 authorizeTenantUser?:(tenantId:string,userId:string)=>boolean;
 /** Explicit customer-approved standing content policy, Page/owner and budgets. */
 authorizeCreate:(p:DailyPrincipal,args:{pageConnectionId:string;consentRef:string;promptHash:string;localTime:string})=>Promise<boolean>;
 /** Recheck customer, standing consent, Page/token/tasks, media provenance and budget before any provider action. */
 authorizeOccurrence:(args:{tenantId:string;userId:string;loopId:string;pageConnectionId:string;consentRef:string;version:number;localDate:string;localTime:string;occurrenceId:string})=>Promise<boolean>;
 /** Injected trusted provider orchestration; never call Meta directly here. */
 publish:(args:{tenantId:string;userId:string;loopId:string;pageConnectionId:string;consentRef:string;version:number;localDate:string;localTime:string;occurrenceId:string;prompt:string})=>Promise<{state:'PUBLISHED'|'NOT_PUBLISHED'|'UNCERTAIN';providerPostId?:string}>;
}
export class DailyFacebookLoopEngine {
 constructor(private store:Store,private ports:DailyPorts,private opts:{enabled?:boolean;clock?:()=>Date;maxLatenessMinutes?:number;maxLoopsPerTenant?:number;requireUniqueConsent?:boolean}={}){}
 private now(){const d=this.opts.clock?.()??new Date();if(!Number.isFinite(d.getTime()))throw Error('INVALID_CLOCK');return d;}
 private customer(p:DailyPrincipal){
  if(p?.audience!=='customer-mcp')throw Error('CUSTOMER_MCP_REQUIRED');
  safe(p.tenantId,'TENANT',200);safe(p.userId,'USER',200);safe(p.commandId,'COMMAND');
  if(p.tenantId!==p.userId&&this.ports.authorizeTenantUser?.(p.tenantId,p.userId)!==true)throw Error('TENANT_MEMBERSHIP_REQUIRED');
  const account=this.store.user(p.userId);
  if(!account||account.disabled||!['USER','CUSTOMER'].includes(account.role))throw Error('CUSTOMER_ACCOUNT_REQUIRED');
 }
 private transaction<T>(fn:()=>T):T{
  this.store.db.exec('BEGIN IMMEDIATE');
  try{const v=fn();this.store.db.exec('COMMIT');return v}
  catch(e){this.store.db.exec('ROLLBACK');throw e}
 }
 private record(tenant:string,id:string):Loop|undefined {
  const r=this.store.get(LOOPS,id) as Loop|undefined;
  return r?.tenantId===tenant?r:undefined;
 }
 private view(r:Loop):DailyReceipt {
  const {id,tenantId,userId,pageConnectionId,state,localTime,timezone,version,createdAt,updatedAt}=r;
  return {id,tenantId,userId,pageConnectionId,state,localTime,timezone,version,createdAt,updatedAt};
 }
 private bindConsent(tenantId:string,consentRef:string,id:string){
  if(!this.opts.requireUniqueConsent)return;
  const bindingId='fb-loop-consent-'+sha(JSON.stringify([tenantId,consentRef]));
  const binding=this.store.get(CONSENT_BINDINGS,bindingId);
  if(binding&&binding.loopId!==id)throw Error('DAILY_LOOP_CONSENT_ALREADY_BOUND');
  const used=this.store.db.prepare(`SELECT 1 FROM records WHERE collection=? AND owner=? AND id<>?
   AND json_extract(payload,'$.consentRef')=? LIMIT 1`).get(LOOPS,tenantId,id,consentRef);
  if(used)throw Error('DAILY_LOOP_CONSENT_ALREADY_BOUND');
  if(!binding)this.store.put(CONSENT_BINDINGS,{id:bindingId,tenantId,loopId:id},tenantId);
 }
 private dayView(r:Day):DayReceipt{
  const {id,loopId,tenantId,userId,localDate,scheduledAt,state,version,providerPostId,errorCode}=r;
  return {id,loopId,tenantId,userId,localDate,scheduledAt,state,version,providerPostId,errorCode};
 }
 async create(p:DailyPrincipal,params:{requestKey:string;pageConnectionId:string;consentRef:string;standingPrompt:string;localTime?:string}):Promise<DailyReceipt>{
  if(this.opts.enabled!==true)throw Error('DAILY_LOOP_DISABLED');
  this.customer(p);
  safe(params.requestKey,'REQUEST_KEY');safe(params.pageConnectionId,'PAGE_CONNECTION');safe(params.consentRef,'CONSENT');
  const localTime=params.localTime??'07:00';
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime))throw Error('INVALID_LOCAL_TIME');
  if(typeof params.standingPrompt!=='string'||params.standingPrompt.trim().length<10||params.standingPrompt.length>4000)throw Error('INVALID_STANDING_PROMPT');
  const prompt=params.standingPrompt.trim(),promptHash=sha(prompt);
  const id='fbl-'+sha([p.tenantId,p.userId,params.requestKey].join('\u0000'));
  const requestHash=sha(JSON.stringify([p.tenantId,p.userId,params.pageConnectionId,params.consentRef,promptHash,localTime]));
  if(!await this.ports.authorizeCreate(p,{pageConnectionId:params.pageConnectionId,consentRef:params.consentRef,promptHash,localTime}))throw Error('EXPLICIT_STANDING_CONSENT_REQUIRED');
  const at=this.now().toISOString();
  return this.transaction(()=>{
   const old=this.record(p.tenantId,id);
   if(old){
    if(old.userId!==p.userId||old.requestHash!==requestHash)throw Error('LOOP_IDEMPOTENCY_CONFLICT');
    return this.view(old);
   }
   this.bindConsent(p.tenantId,params.consentRef,id);
   const cap=this.opts.maxLoopsPerTenant??3;
   if(cap!==Infinity){
    if(!Number.isInteger(cap)||cap<1||cap>20)throw Error('INVALID_DAILY_LOOP_QUOTA');
    const occupied=(this.store.list(LOOPS,p.tenantId) as Loop[])
     .filter(loop=>loop.tenantId===p.tenantId&&loop.state!=='CANCELLED').length;
    if(occupied>=cap)throw Error('DAILY_LOOP_QUOTA_EXCEEDED');
   }
   const rec:Loop={id,tenantId:p.tenantId,userId:p.userId,pageConnectionId:params.pageConnectionId,
    state:'ACTIVE',localTime,timezone:TZ,version:1,createdAt:at,updatedAt:at,
    sealedPrompt:this.ports.cipher.seal(prompt),promptHash,consentRef:params.consentRef,requestHash};
   this.store.put(LOOPS,rec,p.tenantId);
   return this.view(rec);
  });
 }
 async update(p:DailyPrincipal,id:string,params:{standingPrompt:string;consentRef:string}):Promise<DailyReceipt|undefined>{
  if(this.opts.enabled!==true)throw Error('DAILY_LOOP_DISABLED');
  this.customer(p);safe(id,'LOOP_ID',200);safe(params.consentRef,'CONSENT');
  if(typeof params.standingPrompt!=='string'||params.standingPrompt.trim().length<10||params.standingPrompt.length>4000)throw Error('INVALID_STANDING_PROMPT');
  const prompt=params.standingPrompt.trim(),promptHash=sha(prompt);
  const original=this.record(p.tenantId,id);
  if(!original||original.userId!==p.userId)return undefined;
  if(original.state==='CANCELLED')throw Error('LOOP_TERMINAL');
  if(!await this.ports.authorizeCreate(p,{pageConnectionId:original.pageConnectionId,consentRef:params.consentRef,promptHash,localTime:original.localTime}))
    throw Error('EXPLICIT_STANDING_CONSENT_REQUIRED');
  return this.transaction(()=>{
   const current=this.record(p.tenantId,id);
   if(!current||current.userId!==p.userId)return undefined;
   if(current.state==='CANCELLED')throw Error('LOOP_TERMINAL');
   if(current.version!==original.version)throw Error('LOOP_VERSION_CHANGED');
   this.bindConsent(p.tenantId,current.consentRef,id);
   this.bindConsent(p.tenantId,params.consentRef,id);
   const next:Loop={...current,sealedPrompt:this.ports.cipher.seal(prompt),promptHash,consentRef:params.consentRef,
    version:current.version+1,updatedAt:this.now().toISOString()};
   this.store.put(LOOPS,next,p.tenantId);
   return this.view(next);
  });
 }
 get(p:DailyPrincipal,id:string){this.customer(p);safe(id,'LOOP_ID',200);const r=this.record(p.tenantId,id);return r?.userId===p.userId?this.view(r):undefined}
 list(p:DailyPrincipal){this.customer(p);return (this.store.list(LOOPS,p.tenantId) as Loop[])
  .filter(x=>x.tenantId===p.tenantId&&x.userId===p.userId).map(x=>this.view(x));}
 history(p:DailyPrincipal,id:string){this.customer(p);safe(id,'LOOP_ID',200);const r=this.record(p.tenantId,id);
  if(!r||r.userId!==p.userId)return [];
  return (this.store.list(DAYS,p.tenantId) as Day[])
   .filter(x=>x.loopId===id&&x.userId===p.userId&&x.tenantId===p.tenantId).map(x=>this.dayView(x))
   .sort((a,b)=>a.localDate.localeCompare(b.localDate));}
 changeState(p:DailyPrincipal,id:string,state:'PAUSED'|'ACTIVE'|'CANCELLED'){
  this.customer(p);safe(id,'LOOP_ID',200);
  return this.transaction(()=>{
   const old=this.record(p.tenantId,id);
   if(!old||old.userId!==p.userId)return undefined;
   if(old.state==='CANCELLED'&&state!=='CANCELLED')throw Error('LOOP_TERMINAL');
   if(old.state===state)return this.view(old);
   const changed:Loop={...old,state,version:old.version+1,updatedAt:this.now().toISOString()};
   this.store.put(LOOPS,changed,p.tenantId);
   return this.view(changed);
  });
 }
 /** Claims at most one occurrence per local calendar date, even across workers/restarts. */
 async tick(limit=20):Promise<DayReceipt[]>{
  if(this.opts.enabled!==true)throw Error('DAILY_LOOP_DISABLED');
  if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('INVALID_LIMIT');
  const now=this.now(),day=localDate(now),maxLate=this.opts.maxLatenessMinutes??720;
  if(!Number.isFinite(maxLate)||maxLate<0||maxLate>1440)throw Error('INVALID_LATENESS');
  const active=(this.store.list(LOOPS) as Loop[]).filter(x=>x.state==='ACTIVE').sort((a,b)=>a.id.localeCompare(b.id));
  const results:DayReceipt[]=[];
  for(const l of active){
   if(results.length>=limit)break;
   let scheduledAt:string;
   try{scheduledAt=resolveBucharestTime({localDate:day,localTime:l.localTime,timezone:TZ},new Date(0)).scheduledAt}catch{continue}
   const overdue=now.getTime()-Date.parse(scheduledAt);
   if(overdue<0||overdue>maxLate*60000||scheduledAt<l.createdAt)continue;
   const occurrenceId='fbo-'+sha([l.tenantId,l.id,day].join('\u0000'));
   const claimed=this.transaction(()=>{
    const current=this.record(l.tenantId,l.id);
    if(!current||current.state!=='ACTIVE'||current.version!==l.version)return undefined;
    if(this.store.get(DAYS,occurrenceId))return undefined;
    const at=this.now().toISOString();
    const record:Day={id:occurrenceId,loopId:l.id,tenantId:l.tenantId,userId:l.userId,
      localDate:day,scheduledAt,state:'CLAIMED',version:l.version,claimedAt:at,updatedAt:at};
    this.store.put(DAYS,record,l.tenantId);return record;
   });
   if(!claimed)continue;
   let external=false;
   const finish=(state:DayState,errorCode?:string,providerPostId?:string)=>{
    const complete:Day={...claimed,state,errorCode,providerPostId,updatedAt:this.now().toISOString()};
    this.transaction(()=>{const prev=this.store.get(DAYS,claimed.id) as Day|undefined;
      if(prev?.state!=='CLAIMED')throw Error('OCCURRENCE_INTEGRITY_ERROR');
      this.store.put(DAYS,complete,claimed.tenantId)});
    results.push(this.dayView(complete));
   };
   try{
    const fields={tenantId:l.tenantId,userId:l.userId,loopId:l.id,pageConnectionId:l.pageConnectionId,
      consentRef:l.consentRef,version:l.version,localDate:day,localTime:l.localTime,occurrenceId};
    this.customer({tenantId:l.tenantId,userId:l.userId,commandId:occurrenceId,audience:'customer-mcp'});
    if(!await this.ports.authorizeOccurrence(fields)){finish('BLOCKED','DISPATCH_AUTH_REVOKED');continue}
    const prompt=this.ports.cipher.open(l.sealedPrompt);
    if(sha(prompt)!==l.promptHash)throw Error('STANDING_PROMPT_CHANGED');
    const current=this.record(l.tenantId,l.id);
    if(!current||current.state!=='ACTIVE'||current.version!==l.version){finish('BLOCKED','LOOP_CHANGED');continue}
    this.customer({tenantId:l.tenantId,userId:l.userId,commandId:occurrenceId,audience:'customer-mcp'});
    // Critical: trusted publisher must recheck live Page/media/standing consent immediately before Graph write.
    external=true;
    const outcome=await this.ports.publish({...fields,prompt});
    if(outcome.state==='PUBLISHED'&&typeof outcome.providerPostId==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(outcome.providerPostId))
      finish('PUBLISHED',undefined,outcome.providerPostId);
    else if(outcome.state==='NOT_PUBLISHED')finish('FAILED','PROVEN_NOT_SENT');
    else finish('UNCERTAIN','PROVIDER_OUTCOME_UNCONFIRMED');
   }catch{
    finish(external?'UNCERTAIN':'BLOCKED',external?'PROVIDER_OUTCOME_UNCONFIRMED':'PRE_DISPATCH_INVALID');
   }
  }
  return results;
 }
}
