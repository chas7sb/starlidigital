import { createHash } from 'node:crypto';
import type { Store, RecordData } from '../../server/src/store.js';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const COLLECTION = 'outreach-send-requests';
const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
export interface OutreachLimits { perMinute: number; hourly: number; daily: number; domainHourly: number; recipientsPerMessage: number }
export interface OutreachGuardOptions {
  env?: NodeJS.ProcessEnv;
  clock?: () => number;
  providerLimits?: Partial<OutreachLimits>;
  recipients?: string[];
  domains?: string[];
}
export interface OutreachBudget {limit:number|null;used:number;remaining:number|null;resetAt:string|null;resetsAt:string|null;unlimited:boolean}
export class OutreachGuardError extends Error {
  constructor(public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(`${code}: ${message}`); this.name = 'OutreachGuardError';
  }
}
const positive = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};
// Zero disables an application rate quota; provider ceilings remain positive-only.
const rate = (value: unknown): number | undefined => {
  if(value===0 || typeof value==='string' && value.trim()==='0')return 0;
  return positive(value);
};
function configuration(options: OutreachGuardOptions) {
  const env=options.env ?? process.env;
  const configured:OutreachLimits={
    perMinute:rate(env.OUTREACH_MAX_RECIPIENTS_PER_MINUTE) ?? 20,
    hourly:rate(env.OUTREACH_MAX_RECIPIENTS_PER_HOUR) ?? rate(env.OUTREACH_HOURLY_LIMIT) ?? 100,
    daily:rate(env.OUTREACH_MAX_RECIPIENTS_PER_DAY) ?? 500,
    domainHourly:rate(env.OUTREACH_MAX_RECIPIENTS_PER_DOMAIN_PER_HOUR) ?? rate(env.OUTREACH_DOMAIN_HOURLY_LIMIT) ?? 100,
    recipientsPerMessage:positive(env.OUTREACH_MAX_RECIPIENTS_PER_MESSAGE) ?? 20
  };
  const providerEnv:Record<keyof OutreachLimits, unknown>={perMinute:env.OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_MINUTE,hourly:env.OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_HOUR,daily:env.OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_DAY,domainHourly:env.OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_DOMAIN_PER_HOUR,recipientsPerMessage:env.OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_MESSAGE};
  const providerCeilings={} as Record<keyof OutreachLimits,number|null>,effective={...configured};
  for(const key of Object.keys(configured) as (keyof OutreachLimits)[]) {
    const values=[positive(providerEnv[key]),positive(options.providerLimits?.[key])].filter((v):v is number=>v!==undefined);
    providerCeilings[key]=values.length?Math.min(...values):null;
    if(providerCeilings[key]!==null)effective[key]=effective[key]===0?providerCeilings[key]!:Math.min(effective[key],providerCeilings[key]!);
  }
  const envKeys:Record<keyof OutreachLimits,string[]>={perMinute:['OUTREACH_MAX_RECIPIENTS_PER_MINUTE'],hourly:['OUTREACH_MAX_RECIPIENTS_PER_HOUR','OUTREACH_HOURLY_LIMIT'],daily:['OUTREACH_MAX_RECIPIENTS_PER_DAY'],domainHourly:['OUTREACH_MAX_RECIPIENTS_PER_DOMAIN_PER_HOUR','OUTREACH_DOMAIN_HOURLY_LIMIT'],recipientsPerMessage:['OUTREACH_MAX_RECIPIENTS_PER_MESSAGE']};
  const sources=Object.fromEntries((Object.keys(configured) as (keyof OutreachLimits)[]).map(key=>[key,{configured:envKeys[key].find(name=>(key==='recipientsPerMessage'?positive:rate)(env[name])!==undefined)??'default',providerCeiling:providerCeilings[key],providerOverride:positive(options.providerLimits?.[key])!==undefined,providerEnv:positive(env[envKeys[key][0].replace('OUTREACH_','OUTREACH_PROVIDER_')])!==undefined?envKeys[key][0].replace('OUTREACH_','OUTREACH_PROVIDER_'):null}]));
  return {configured,effective,providerCeilings,sources};
}
function normalizeRecipients(values: string[]) {
  if(!Array.isArray(values) || values.some(value=>typeof value!=='string' || value.length>320 || !/^[^\s@]+@[^\s@]+$/.test(value.trim()))) throw new OutreachGuardError('INVALID_RECIPIENT','Provide valid email addresses');
  return [...new Set(values.map(email=>email.trim().toLowerCase()))].sort();
}
const domainOf=(email:string)=>email.slice(email.lastIndexOf('@')+1);
function inWindow(records:RecordData[],now:number,window:number) {
  // All reservation states consume quota, including uncertain deliveries and crash leftovers.
  return records.filter(record=>record.status!=='REJECTED' && Number.isFinite(record.createdAtMs) && record.createdAtMs>now-window);
}
function weight(record:RecordData,domain?:string) {
  const recipients=Array.isArray(record.to)?record.to:[];
  return domain?recipients.filter((email:unknown)=>typeof email==='string'&&domainOf(email.toLowerCase())===domain).length:recipients.length||1;
}
function budget(records:RecordData[],limit:number,window:number,domain?:string):OutreachBudget {
  const used=records.reduce((sum,record)=>sum+weight(record,domain),0);
  if(limit===0)return {limit:null,used,remaining:null,resetAt:null,resetsAt:null,unlimited:true};
  const expiry=records.filter(record=>weight(record,domain)>0).map(record=>record.createdAtMs+window).sort((a,b)=>a-b)[0];
  return {limit,used,unlimited:false,remaining:Math.max(0,limit-used),resetAt:expiry===undefined?null:new Date(expiry).toISOString(),resetsAt:expiry===undefined?null:new Date(expiry).toISOString()};
}
function enforce(records:RecordData[],limit:number,requested:number,window:number,now:number,scope:string,code:string,domain?:string,source='starlidigital') {
  if(limit===0)return;
  const state=budget(records,limit,window,domain);
  if(state.used+requested<=limit)return;
  let remainingUsed=state.used,availableAt:number|undefined;
  for(const record of [...records].sort((a,b)=>a.createdAtMs-b.createdAtMs)) {
    remainingUsed-=weight(record,domain);
    if(remainingUsed+requested<=limit){availableAt=record.createdAtMs+window;break;}
  }
  throw new OutreachGuardError(code,`${scope} recipient budget exhausted`,{scope,domain,source,limitType:({minute:'minute_recipients',hourly:'hourly_recipients',daily:'daily_recipients',domainHourly:'domain_hourly_recipients'} as Record<string,string>)[scope],errorCode:'RATE_LIMIT_EXCEEDED',limit,used:state.used,requested,remaining:state.remaining,retryAfterSeconds:availableAt===undefined?null:Math.max(0,Math.ceil((availableAt-now)/1000)),resetAt:availableAt===undefined?null:new Date(availableAt).toISOString(),resetsAt:availableAt===undefined?null:new Date(availableAt).toISOString()});
}
/** Read-only snapshot; no reservation, counter changes or outbound calls. */
export function getOutreachLimits(store:Store,options:OutreachGuardOptions={}) {
  const now=(options.clock??Date.now)(),config=configuration(options);
  const records=store.list(COLLECTION),minute=inWindow(records,now,MINUTE),hourly=inWindow(records,now,HOUR),daily=inWindow(records,now,DAY);
  const selected=new Set<string>();
  for(const value of options.domains??[])if(typeof value==='string'&&value.trim())selected.add(value.trim().toLowerCase());
  for(const email of normalizeRecipients(options.recipients??[]))selected.add(domainOf(email));
  if(!options.domains&&!options.recipients)for(const record of hourly)for(const email of record.to??[])if(typeof email==='string')selected.add(domainOf(email.toLowerCase()));
  const domains=[...selected].sort().slice(0,100).map(domain=>({domain,...budget(hourly,config.effective.domainHourly,HOUR,domain)}));
  const publicPolicy=(limits:OutreachLimits)=>Object.fromEntries(Object.entries(limits).map(([key,value])=>[key,key!=='recipientsPerMessage'&&value===0?null:value])) as Record<keyof OutreachLimits,number|null>;
  return {asOf:new Date(now).toISOString(),...config,configured:publicPolicy(config.configured),effective:publicPolicy(config.effective),minute:budget(minute,config.effective.perMinute,MINUTE),hourly:budget(hourly,config.effective.hourly,HOUR),daily:budget(daily,config.effective.daily,DAY),domains,maxRecipientsPerMessage:config.effective.recipientsPerMessage};
}
export function reserveOutreach(store:Store,actor:string,input:{to:string[];subject:string;bodyText:string;inReplyToMessageId?:string;idempotencyKey?:string},options:OutreachGuardOptions={}) {
  const to=normalizeRecipients(input.to),config=configuration(options),limits=config.effective;
  const source=(key:keyof OutreachLimits)=>config.providerCeilings[key]!==null&&limits[key]===config.providerCeilings[key]?'smtp/provider':'starlidigital';
  if(!to.length||to.length>limits.recipientsPerMessage)throw new OutreachGuardError('RECIPIENT_LIMIT','Recipient count exceeds per-message limits',{scope:'message',limit:limits.recipientsPerMessage,used:0,requested:to.length,remaining:limits.recipientsPerMessage,retryAfterSeconds:null,resetAt:null});
  const fingerprint=hash(JSON.stringify({to,subject:input.subject.trim(),body:input.bodyText,reply:input.inReplyToMessageId||null}));
  const id=hash(actor+':'+(input.idempotencyKey||fingerprint)),now=(options.clock??Date.now)();
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const existing=store.get(COLLECTION,id);
    if(existing) {
      if(existing.fingerprint!==fingerprint)throw new OutreachGuardError('IDEMPOTENCY_CONFLICT','This key belongs to different content');
      if(existing.status!=='ACCEPTED' && existing.status!=='REJECTED')throw new OutreachGuardError('SEND_UNCONFIRMED','This request is already reserved; inspect the mailbox before retrying',{status:existing.status,reservationId:existing.id});
      if(existing.status==='ACCEPTED'){store.db.exec('COMMIT');return {record:existing,cached:true};}
    }
    for(const email of to)if(store.get('outreach-suppressions',hash(email)))throw new OutreachGuardError('RECIPIENT_SUPPRESSED',email,{recipient:email});
    const all=store.list(COLLECTION),recent=inWindow(all,now,HOUR),daily=inWindow(all,now,DAY);
    if(recent.some(record=>record.fingerprint===fingerprint))throw new OutreachGuardError('DUPLICATE_OUTREACH','Identical outreach already recorded in the last hour');
    enforce(inWindow(all,now,MINUTE),limits.perMinute,to.length,MINUTE,now,'minute','OUTREACH_MINUTE_RATE_LIMIT',undefined,source('perMinute'));
    enforce(recent,limits.hourly,to.length,HOUR,now,'hourly','OUTREACH_RATE_LIMIT',undefined,source('hourly'));
    enforce(daily,limits.daily,to.length,DAY,now,'daily','OUTREACH_DAILY_RATE_LIMIT',undefined,source('daily'));
    for(const domain of new Set(to.map(domainOf)))enforce(recent,limits.domainHourly,to.filter(email=>domainOf(email)===domain).length,HOUR,now,'domainHourly','DOMAIN_RATE_LIMIT',domain,source('domainHourly'));
    const record=store.put(COLLECTION,{id,actor,fingerprint,to,status:'RESERVED',attempts:(existing?.attempts??0)+1,lastRejectedAt:existing?.status==='REJECTED'?existing.updatedAt:existing?.lastRejectedAt,createdAtMs:now,createdAt:new Date(now).toISOString()});
    store.db.exec('COMMIT');return {record,cached:false};
  }catch(error){store.db.exec('ROLLBACK');throw error;}
}
export function finishOutreach(store:Store,record:RecordData,result?:Record<string,unknown>,options:OutreachGuardOptions & {definitelyNotSent?:boolean}={}) {
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const current=store.get(COLLECTION,record.id);
    if(!current||current.fingerprint!==record.fingerprint)throw new OutreachGuardError('INVALID_RESERVATION','Reservation is missing or changed');
    if(current.attempts!==record.attempts)throw new OutreachGuardError('STALE_RESERVATION','A newer attempt owns this reservation');
    // A late failure must never downgrade a prior provider acceptance.
    if(current.status!=='ACCEPTED')store.put(COLLECTION,{...current,status:result?'ACCEPTED':current.status==='REJECTED'||options.definitelyNotSent&&current.status==='RESERVED'?'REJECTED':'UNCONFIRMED',result,updatedAt:new Date((options.clock??Date.now)()).toISOString()});
    store.db.exec('COMMIT');
  }catch(error){store.db.exec('ROLLBACK');throw error;}
}
