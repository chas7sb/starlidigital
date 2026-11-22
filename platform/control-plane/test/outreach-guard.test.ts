import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../../server/src/store.js';
import { reserveOutreach,finishOutreach,getOutreachLimits,OutreachGuardError,type OutreachGuardOptions } from '../src/outreach-guard.js';
const env={OUTREACH_MAX_RECIPIENTS_PER_MINUTE:'1000',OUTREACH_MAX_RECIPIENTS_PER_HOUR:'1000',OUTREACH_MAX_RECIPIENTS_PER_DAY:'500',OUTREACH_MAX_RECIPIENTS_PER_DOMAIN_PER_HOUR:'1000'};
const input=(suffix:string,to=[`${suffix}@example.com`])=>({to,subject:`Subject ${suffix}`,bodyText:'A test message',idempotencyKey:suffix});
function fixture(t:any,overrides:Record<string,string>={}){
 const store=new Store(':memory:');t.after(()=>store.close());let now=1700000000000;
 const options:OutreachGuardOptions={env:{...env,...overrides},clock:()=>now};
 return {store,options,advance:(ms:number)=>{now+=ms;}};
}
function rejectsCode(work:()=>unknown,code:string){assert.throws(work,(error:any)=>error instanceof OutreachGuardError&&error.code===code);}
test('defaults expose 100/hour 500/day 100/domain-hour and20/minute,message; inspection never writes',t=>{
 const {store}=fixture(t);const before=store.db.prepare('SELECT total_changes() AS n').get()?.n;
 const state=getOutreachLimits(store,{env:{},clock:()=>1700000000000,domains:['gmail.com']});
 assert.deepEqual(state.effective,{perMinute:20,hourly:100,daily:500,domainHourly:100,recipientsPerMessage:20});
 assert.equal(state.domains[0].remaining,100);assert.equal(state.sources.hourly.configured,'default');
 assert.equal(store.db.prepare('SELECT total_changes() AS n').get()?.n,before);
});
test('canonical config overrides legacy and provider ceilings take minimum independently',t=>{
 const {store}=fixture(t);
 const state=getOutreachLimits(store,{env:{OUTREACH_MAX_RECIPIENTS_PER_HOUR:'300',OUTREACH_HOURLY_LIMIT:'60',OUTREACH_MAX_RECIPIENTS_PER_DAY:'1000',OUTREACH_DOMAIN_HOURLY_LIMIT:'80',OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_DAY:'700'},providerLimits:{hourly:150,daily:600}});
 assert.equal(state.configured.hourly,300);assert.equal(state.effective.hourly,150);assert.equal(state.effective.daily,600);assert.equal(state.effective.domainHourly,80);
 assert.equal(state.sources.hourly.configured,'OUTREACH_MAX_RECIPIENTS_PER_HOUR');
 assert.equal(state.sources.daily.providerEnv,'OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_DAY');
 const fallback=getOutreachLimits(store,{env:{OUTREACH_MAX_RECIPIENTS_PER_HOUR:'NaN',OUTREACH_MAX_RECIPIENTS_PER_DAY:'-1',OUTREACH_MAX_RECIPIENTS_PER_MESSAGE:'1.5'}});
 assert.equal(fallback.effective.hourly,100);assert.equal(fallback.effective.daily,500);assert.equal(fallback.maxRecipientsPerMessage,20);
});
test('minute pacing counts unique normalized recipients, rejects atomically and resets exactly at boundary',t=>{
 const {store,options,advance}=fixture(t,{OUTREACH_MAX_RECIPIENTS_PER_MINUTE:'2'});
 reserveOutreach(store,'admin',input('first',[' A@example.com ','a@EXAMPLE.com','b@example.com']),options);
 let error:any;try{reserveOutreach(store,'admin',input('next'),options);}catch(e){error=e;}
 assert.equal(error.code,'OUTREACH_MINUTE_RATE_LIMIT');assert.equal(error.details.used,2);assert.equal(error.details.requested,1);assert.equal(error.details.retryAfterSeconds,60);
 assert.equal(store.list('outreach-send-requests').length,1);advance(60000);
 reserveOutreach(store,'admin',input('next'),options);assert.equal(getOutreachLimits(store,options).minute.used,1);
});
test('hourly quota accepts exact boundary and returns structured next available time',t=>{
 const {store,options,advance}=fixture(t,{OUTREACH_MAX_RECIPIENTS_PER_HOUR:'2'});
 reserveOutreach(store,'admin',input('first',['a@example.com','b@example.com']),options);
 let error:any;try{reserveOutreach(store,'admin',input('next'),options);}catch(e){error=e;}
 assert.equal(error.code,'OUTREACH_RATE_LIMIT');assert.deepEqual(error.details,{scope:'hourly',domain:undefined,source:'starlidigital',limitType:'hourly_recipients',errorCode:'RATE_LIMIT_EXCEEDED',limit:2,used:2,requested:1,remaining:0,retryAfterSeconds:3600,resetAt:new Date(1700003600000).toISOString(),resetsAt:new Date(1700003600000).toISOString()});
 advance(3600000);reserveOutreach(store,'admin',input('next'),options);
});
test('daily quota accumulates across hours and resets on rolling24h boundary',t=>{
 const {store,options,advance}=fixture(t,{OUTREACH_MAX_RECIPIENTS_PER_HOUR:'1',OUTREACH_MAX_RECIPIENTS_PER_DAY:'2'});
 reserveOutreach(store,'admin',input('a'),options);advance(3600000);
 reserveOutreach(store,'admin',input('b'),options);advance(3600000);
 rejectsCode(()=>reserveOutreach(store,'admin',input('c'),options),'OUTREACH_DAILY_RATE_LIMIT');
 advance(22*3600000);reserveOutreach(store,'admin',input('c'),options);
 assert.equal(getOutreachLimits(store,options).daily.used,2);
});
test('domain quota counts all message recipients and no partial reservation survives',t=>{
 const {store,options}=fixture(t,{OUTREACH_MAX_RECIPIENTS_PER_DOMAIN_PER_HOUR:'2'});
 reserveOutreach(store,'admin',input('a',['a@gmail.com','b@gmail.com']),options);
 rejectsCode(()=>reserveOutreach(store,'admin',input('b',['c@gmail.com','x@yahoo.com']),options),'DOMAIN_RATE_LIMIT');
 const state=getOutreachLimits(store,{...options,recipients:['c@gmail.com','x@yahoo.com']});
 assert.equal(state.domains.find(d=>d.domain==='gmail.com')?.used,2);assert.equal(state.domains.find(d=>d.domain==='yahoo.com')?.used,0);assert.equal(state.daily.used,2);
});
test('per-message limit is configurable and provider ceilings constrain it',t=>{
 const {store,options}=fixture(t,{OUTREACH_MAX_RECIPIENTS_PER_MESSAGE:'2'});
 rejectsCode(()=>reserveOutreach(store,'admin',input('a',['a@x.com','b@x.com','c@x.com']),options),'RECIPIENT_LIMIT');
 rejectsCode(()=>reserveOutreach(store,'admin',input('b',['a@x.com','b@x.com']),{...options,providerLimits:{recipientsPerMessage:1}}),'RECIPIENT_LIMIT');
 assert.equal(store.list('outreach-send-requests').length,0);
});
test('suppression blocks full multi-recipient message before quota consumption',t=>{
 const {store,options}=fixture(t);const email='blocked@example.com';
 store.put('outreach-suppressions',{id:createHash('sha256').update(email).digest('hex')});
 rejectsCode(()=>reserveOutreach(store,'admin',input('a',['ok@example.com',email]),options),'RECIPIENT_SUPPRESSED');
 assert.equal(getOutreachLimits(store,options).daily.used,0);
});
test('accepted idempotency does not charge twice, mismatches conflict, duplicates across keys remain blocked',t=>{
 const {store,options}=fixture(t);const payload=input('a');const reservation=reserveOutreach(store,'admin',payload,options);
 finishOutreach(store,reservation.record,{id:'provider-id'},options);
 assert.equal(reserveOutreach(store,'admin',payload,options).cached,true);
 rejectsCode(()=>reserveOutreach(store,'admin',{...payload,bodyText:'changed'},options),'IDEMPOTENCY_CONFLICT');
 rejectsCode(()=>reserveOutreach(store,'another-admin',{...payload,idempotencyKey:'other'},options),'DUPLICATE_OUTREACH');
 assert.equal(getOutreachLimits(store,options).daily.used,1);
});
test('uncertain and crash reservations retain quota and cannot automatically retry; acceptance never downgrades',t=>{
 const {store,options}=fixture(t);const payload=input('a');const reservation=reserveOutreach(store,'admin',payload,options);
 rejectsCode(()=>reserveOutreach(store,'admin',payload,options),'SEND_UNCONFIRMED');
 finishOutreach(store,reservation.record,undefined,options);
 finishOutreach(store,reservation.record,undefined,{...options,definitelyNotSent:true});
 assert.equal(store.get('outreach-send-requests',reservation.record.id)?.status,'UNCONFIRMED');
 rejectsCode(()=>reserveOutreach(store,'admin',payload,options),'SEND_UNCONFIRMED');
 finishOutreach(store,reservation.record,{id:'confirmed'},options);
 finishOutreach(store,reservation.record,undefined,{...options,definitelyNotSent:true});
 assert.equal(store.get('outreach-send-requests',reservation.record.id)?.status,'ACCEPTED');assert.equal(getOutreachLimits(store,options).daily.used,1);
});
test('definitely not sent failures retain audit record but refund quota and allow same-content retry',t=>{
 const {store,options}=fixture(t);const payload=input('a'),reservation=reserveOutreach(store,'admin',payload,options);
 finishOutreach(store,reservation.record,undefined,{...options,definitelyNotSent:true});
 assert.equal(store.get('outreach-send-requests',reservation.record.id)?.status,'REJECTED');assert.equal(getOutreachLimits(store,options).daily.used,0);
 rejectsCode(()=>reserveOutreach(store,'admin',{...payload,bodyText:'changed'},options),'IDEMPOTENCY_CONFLICT');
 const retry=reserveOutreach(store,'admin',payload,options);assert.equal(retry.cached,false);assert.equal(retry.record.attempts,2);assert.equal(getOutreachLimits(store,options).daily.used,1);
});
test('two database handles reserve one remaining slot without overbooking',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'outreach-guard-')),path=join(dir,'quota.sqlite');
 const first=new Store(path),second=new Store(path);
 t.after(()=>{first.close();second.close();assert.ok(dir.startsWith(join(tmpdir(),'outreach-guard-')));rmSync(dir,{recursive:true,force:true});});
 const options={env:{...env,OUTREACH_MAX_RECIPIENTS_PER_HOUR:'1'},clock:()=>1700000000000};
 const outcomes=await Promise.allSettled([Promise.resolve().then(()=>reserveOutreach(first,'one',input('one'),options)),Promise.resolve().then(()=>reserveOutreach(second,'two',input('two'),options))]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(getOutreachLimits(second,options).hourly.used,1);
});

test('zero disables all application rate quotas and permits more than500 recipients without Infinity',t=>{
 const {store,options}=fixture(t,{OUTREACH_MAX_RECIPIENTS_PER_MINUTE:'0',OUTREACH_MAX_RECIPIENTS_PER_HOUR:'0',OUTREACH_MAX_RECIPIENTS_PER_DAY:'0',OUTREACH_MAX_RECIPIENTS_PER_DOMAIN_PER_HOUR:'0'});
 for(let batch=0;batch<31;batch++)reserveOutreach(store,'admin',input(`batch-${batch}`,Array.from({length:20},(_,i)=>`lead-${batch}-${i}@gmail.com`)),options);
 const state=getOutreachLimits(store,{...options,domains:['gmail.com']});
 assert.equal(state.hourly.used,620);assert.equal(state.daily.used,620);assert.equal(state.minute.used,620);
 for(const window of [state.minute,state.hourly,state.daily,state.domains[0]]){assert.equal(window.unlimited,true);assert.equal(window.limit,null);assert.equal(window.remaining,null);assert.equal(window.resetAt,null);}
 assert.equal(state.configured.hourly,null);assert.equal(state.effective.daily,null);assert.equal(state.maxRecipientsPerMessage,20);
 assert.ok(!JSON.stringify(state).includes('Infinity'));assert.equal(state.sources.hourly.configured,'OUTREACH_MAX_RECIPIENTS_PER_HOUR');
 rejectsCode(()=>reserveOutreach(store,'admin',input('too-many',Array.from({length:21},(_,i)=>`oversize-${i}@gmail.com`)),options),'RECIPIENT_LIMIT');
});
test('unlimited internal quotas still honor positive provider ceilings',t=>{
 const {store,options}=fixture(t,{OUTREACH_MAX_RECIPIENTS_PER_MINUTE:'0',OUTREACH_MAX_RECIPIENTS_PER_HOUR:'0',OUTREACH_MAX_RECIPIENTS_PER_DAY:'0',OUTREACH_MAX_RECIPIENTS_PER_DOMAIN_PER_HOUR:'0',OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_HOUR:'2'});
 reserveOutreach(store,'admin',input('one',['one@gmail.com','two@gmail.com']),options);
 assert.throws(()=>reserveOutreach(store,'admin',input('three'),options),(error:any)=>error.code==='OUTREACH_RATE_LIMIT'&&error.details.source==='smtp/provider'&&error.details.limitType==='hourly_recipients'&&error.details.errorCode==='RATE_LIMIT_EXCEEDED'&&error.details.resetsAt===error.details.resetAt);
 const state=getOutreachLimits(store,options);assert.equal(state.configured.hourly,null);assert.equal(state.effective.hourly,2);assert.equal(state.hourly.unlimited,false);assert.equal(state.hourly.remaining,0);assert.equal(state.daily.unlimited,true);
});

test('rejected finish is idempotent and stale attempt cannot refund newer reservation',t=>{
 const {store,options}=fixture(t);const payload=input('repeat');const first=reserveOutreach(store,'admin',payload,options);
 finishOutreach(store,first.record,undefined,{...options,definitelyNotSent:true});
 finishOutreach(store,first.record,undefined,{...options,definitelyNotSent:true});
 assert.equal(getOutreachLimits(store,options).daily.used,0);
 const second=reserveOutreach(store,'admin',payload,options);
 rejectsCode(()=>finishOutreach(store,first.record,undefined,{...options,definitelyNotSent:true}),'STALE_RESERVATION');
 assert.equal(store.get('outreach-send-requests',second.record.id)?.status,'RESERVED');assert.equal(getOutreachLimits(store,options).daily.used,1);
});
