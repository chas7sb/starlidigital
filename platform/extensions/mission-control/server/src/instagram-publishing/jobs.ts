import {createHash} from 'node:crypto';
import type {Store} from '../store.js';
import type {InstagramGraphProvider} from './graph-provider.js';

export const instagramJobsCollection='instagram-customer-publish-jobs';
const collection=instagramJobsCollection;
const opaque=/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/;
const accountId=/^\d{1,30}$/;
type Owner={tenantId:string;userId:string};
type Plan={requestKey:string;connectionId:string;accountId:string;mediaRef:string;mediaSha256:string;credentialRevision:string;kind:'IMAGE'|'REEL';caption:string;dueAt:string};
type State='QUEUED'|'CREATING'|'PROCESSING'|'PUBLISHING'|'PUBLISHED'|'FAILED'|'UNCERTAIN'|'CANCELLED';
export type InstagramPublishJob=Owner&Plan&{id:string;hash:string;state:State;containerId?:string;postId?:string};
type Job=InstagramPublishJob;
type Binding={accountId:string;token:string;mediaUrl:string};

/** All binding and approval lookups are server-owned. In particular, a grant
 * must bind the exact owner, account, media, caption and due time in this job. */
export class InstagramPublishJobs {
 constructor(private readonly store:Store,private readonly ports:{
  provider:Pick<InstagramGraphProvider,'createContainer'|'containerStatus'|'publishContainer'>;
  resolveAuthorizedBinding:(job:Readonly<Job>)=>Promise<Binding>;
  assertCurrentApproval:(job:Readonly<Job>,binding:Readonly<Binding>)=>void;
  now?:()=>Date;
 }){}

 private transaction<T>(fn:()=>T):T{
  this.store.db.exec('BEGIN IMMEDIATE');
  try{const result=fn();this.store.db.exec('COMMIT');return result;}
  catch(e){this.store.db.exec('ROLLBACK');throw e;}
 }

 private read(id:string):Job|undefined{return this.store.get(collection,id) as Job|undefined;}
 private now(){return this.ports.now?.()??new Date();}

 private requireOwner(owner:Owner){
  const account=this.store.user(owner.userId);
  if(owner.tenantId!==owner.userId||!account||account.role!=='USER'||account.disabled)
   throw Error('INSTAGRAM_CUSTOMER_REQUIRED');
 }

 private receipt(job:Job){
  const {id,accountId,kind,dueAt,state,containerId,postId}=job;
  return {id,accountId,kind,dueAt,state,containerId,postId};
 }

 enqueue(owner:Owner,plan:Plan){
  this.requireOwner(owner);
  if(!opaque.test(plan.requestKey)||!opaque.test(plan.connectionId)||!opaque.test(plan.mediaRef)||
   !/^[a-f0-9]{64}$/.test(plan.mediaSha256)||!opaque.test(plan.credentialRevision)||!accountId.test(plan.accountId)||(plan.kind!=='IMAGE'&&plan.kind!=='REEL')||
   typeof plan.caption!=='string'||plan.caption.length>2200||/[\x00-\x08\x0b-\x1f\x7f]/.test(plan.caption)||
   !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(plan.dueAt)||!Number.isFinite(Date.parse(plan.dueAt)))
   throw Error('INVALID_INSTAGRAM_PUBLISH_PLAN');
  const hash=createHash('sha256').update(JSON.stringify([
   owner.tenantId,owner.userId,plan.connectionId,plan.accountId,plan.mediaRef,plan.mediaSha256,plan.credentialRevision,plan.kind,plan.caption,plan.dueAt,
  ])).digest('hex');
  const id='igpub-'+createHash('sha256').update(JSON.stringify([owner.tenantId,owner.userId,plan.requestKey])).digest('hex');
  return this.transaction(()=>{
   const existing=this.read(id);
   if(existing){
    if(existing.hash!==hash||existing.tenantId!==owner.tenantId||existing.userId!==owner.userId)
     throw Error('INSTAGRAM_REQUEST_CONFLICT');
    return this.receipt(existing);
   }
   const job:Job={...plan,...owner,id,hash,state:'QUEUED'};
   this.store.put(collection,job,owner.tenantId);
   return this.receipt(job);
  });
 }

 get(owner:Owner,id:string){
  this.requireOwner(owner);
  const job=this.read(id);
  return job?.tenantId===owner.tenantId&&job.userId===owner.userId?this.receipt(job):undefined;
 }

 cancel(owner:Owner,id:string){
  this.requireOwner(owner);
  return this.transaction(()=>{
   const job=this.read(id);
   if(!job||job.tenantId!==owner.tenantId||job.userId!==owner.userId)throw Error('INSTAGRAM_JOB_NOT_FOUND');
   if(job.state==='CANCELLED')return this.receipt(job);
   if(job.state!=='QUEUED'&&job.state!=='PROCESSING')throw Error('INSTAGRAM_JOB_NOT_CANCELLABLE');
   const next:Job={...job,state:'CANCELLED'};
   this.store.put(collection,next,owner.tenantId);
   return this.receipt(next);
  });
 }

 async dispatchDue(limit:number){
  if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('INVALID_INSTAGRAM_WORKER_LIMIT');
  const due=this.now().toISOString();
  const rows=this.store.db.prepare(`SELECT id FROM records WHERE collection=?
   AND json_extract(payload,'$.state') IN ('QUEUED','PROCESSING')
   AND json_extract(payload,'$.dueAt')<=? ORDER BY json_extract(payload,'$.dueAt'),id LIMIT ?`).all(collection,due,limit);
  const outcomes=[];
  for(const row of rows){
   try{outcomes.push(await this.advance(String(row.id)));}
   catch{outcomes.push(undefined);}
  }
  return outcomes;
 }

 /** Dispatches one bounded state transition. Only reads can be retried. A
  * process death in CREATING/PUBLISHING leaves an unresolved durable claim. */
 async advance(id:string){
  const job=this.read(id);
  if(!job||(job.state!=='QUEUED'&&job.state!=='PROCESSING')||Date.parse(job.dueAt)>this.now().getTime())return;
  this.requireOwner(job);
  const binding=await this.ports.resolveAuthorizedBinding(Object.freeze({...job}));
  if(binding.accountId!==job.accountId)throw Error('INSTAGRAM_BINDING_CHANGED');

  if(job.state==='PROCESSING'){
   const state=await this.ports.provider.containerStatus(job.containerId!,binding.token);
   if(state==='IN_PROGRESS')return this.receipt(job);
   if(state!=='FINISHED'){
    return this.transition(job,'PROCESSING',state==='PUBLISHED'?'UNCERTAIN':'FAILED');
   }
  }

  const claim=job.state==='QUEUED'?'CREATING':'PUBLISHING';
  const reserved=this.transaction(()=>{
   const current=this.read(id);
   if(!current||current.state!==job.state||current.hash!==job.hash||current.containerId!==job.containerId)return false;
   this.requireOwner(current);
   this.ports.assertCurrentApproval(Object.freeze({...current}),binding);
   this.store.put(collection,{...current,state:claim},current.tenantId);
   return true;
  });
  if(!reserved)return;
  try{
   const response=claim==='CREATING'
    ? await this.ports.provider.createContainer({
       accountId:job.accountId,token:binding.token,mediaUrl:binding.mediaUrl,kind:job.kind,caption:job.caption,
      })
    : await this.ports.provider.publishContainer(job.accountId,job.containerId!,binding.token);
   if(response.state==='ACCEPTED'){
    return claim==='CREATING'
     ? this.transition(job,claim,'PROCESSING',{containerId:response.id})
     : this.transition(job,claim,'PUBLISHED',{postId:response.id});
   }
   return this.transition(job,claim,response.state==='REJECTED'?'FAILED':'UNCERTAIN');
  }catch{
   return this.transition(job,claim,'UNCERTAIN');
  }
 }

 private transition(job:Job,expected:State,state:State,fields:Pick<Job,'containerId'|'postId'>={}){
  return this.transaction(()=>{
   const current=this.read(job.id);
   if(!current||current.state!==expected||current.hash!==job.hash)return;
   const next={...current,...fields,state};
   this.store.put(collection,next,job.tenantId);
   return this.receipt(next);
  });
 }
}
