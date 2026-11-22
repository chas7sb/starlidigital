import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Store} from '../store.js';
import {assertFacebookCustomerPilotEffectsAllowed} from '../facebook-integration/pilot-effect-stop.js';
import type {FacebookReelsProvider} from './reels-provider.js';

const collection='facebook-customer-reel-jobs';
const opaque=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/);
const planSchema=z.object({
 requestKey:opaque,connectionId:opaque,pageId:z.string().regex(/^\d{1,30}$/),
 revision:z.string().min(1).max(100),selectionNonce:z.string().min(1).max(200),
 renderRef:z.string().regex(/^vrnd-[0-9a-f-]{36}$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),
 caption:z.string().max(5000).refine(value=>!/[\x00-\x08\x0b-\x1f\x7f]/.test(value)),
 dueAt:z.string().datetime({precision:3}),
}).strict();
export type FacebookReelPlan=z.infer<typeof planSchema>;
type Owner={tenantId:string;userId:string};
type State='QUEUED'|'STARTING'|'STARTED'|'UPLOADING'|'UPLOADED'|'FINISHING'|'PROCESSING'|'PUBLISHED'|'FAILED'|'UNCERTAIN'|'CANCELLED';
export type FacebookReelJob=FacebookReelPlan&Owner&{id:string;hash:string;state:State;videoId?:string};
type Binding={pageId:string;revision:string;selectionNonce:string;token:string};
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const mutableStates=['QUEUED','STARTED','UPLOADED'] as const;

export class FacebookReelJobs {
 constructor(private readonly store:Store,private readonly ports:{
  provider:Pick<FacebookReelsProvider,'start'|'upload'|'finish'|'inspect'>;
  resolvePage:(job:Readonly<FacebookReelJob>)=>Promise<Binding>;
  readOwnedRender:(job:Readonly<FacebookReelJob>)=>Uint8Array;
  /** Recheck persisted approval, selection and credential after the last await. */
  assertCurrentApproval:(job:Readonly<FacebookReelJob>,binding:Readonly<Binding>)=>void;
  now?:()=>Date;
 }){}

 private read(id:string){return this.store.get(collection,id) as FacebookReelJob|undefined;}
 private transaction<T>(work:()=>T):T{
  this.store.db.exec('BEGIN IMMEDIATE');
  try{const result=work();this.store.db.exec('COMMIT');return result;}
  catch(error){this.store.db.exec('ROLLBACK');throw error;}
 }
 private owner(owner:Owner){
  const user=this.store.user(owner.userId);
  if(owner.tenantId!==owner.userId||user?.role!=='USER'||user.disabled)
   throw Error('REEL_CUSTOMER_REQUIRED');
 }
 private receipt(job:FacebookReelJob){
  const {id,state,dueAt,pageId,videoId}=job;
  return {id,state,dueAt,pageId,videoId};
 }
 enqueue(owner:Owner,input:FacebookReelPlan){
  this.owner(owner);
  const plan=planSchema.parse(input);
  const hash=digest(JSON.stringify([owner.tenantId,owner.userId,plan]));
  const id='fbreel-'+digest(JSON.stringify([owner.tenantId,owner.userId,plan.requestKey]));
  return this.transaction(()=>{
   const prior=this.read(id);
   if(prior){
    if(prior.hash!==hash||prior.tenantId!==owner.tenantId||prior.userId!==owner.userId)
     throw Error('REEL_REQUEST_CONFLICT');
    return this.receipt(prior);
   }
   const job:FacebookReelJob={...plan,...owner,id,hash,state:'QUEUED'};
   this.store.put(collection,job,job.tenantId);
   return this.receipt(job);
  });
 }
 get(owner:Owner,id:string){
  this.owner(owner);
  const job=this.read(id);
  return job?.tenantId===owner.tenantId&&job.userId===owner.userId?this.receipt(job):undefined;
 }
 cancel(owner:Owner,id:string){
  this.owner(owner);
  return this.transaction(()=>{
   const job=this.read(id);
   if(job?.tenantId!==owner.tenantId||job.userId!==owner.userId)throw Error('REEL_JOB_NOT_FOUND');
   if(job.state==='CANCELLED')return this.receipt(job);
   if(!mutableStates.some(state=>state===job.state))throw Error('REEL_JOB_NOT_CANCELLABLE');
   return this.save(job,'CANCELLED');
  });
 }
 private save(job:FacebookReelJob,state:State,videoId=job.videoId){
  const next={...job,state,videoId};
  this.store.put(collection,next,job.tenantId);
  return this.receipt(next);
 }
 private complete(job:FacebookReelJob,expected:State,state:State,videoId=job.videoId){
  return this.transaction(()=>{
   const current=this.read(job.id);
   if(current?.state===expected&&current.hash===job.hash)return this.save(current,state,videoId);
  });
 }

 async dispatchDue(limit:number){
  if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('INVALID_REEL_WORKER_LIMIT');
  const due=(this.ports.now?.()??new Date()).toISOString();
  const rows=this.store.db.prepare(`SELECT id FROM records WHERE collection=?
   AND json_extract(payload,'$.state') IN ('QUEUED','STARTED','UPLOADED','PROCESSING')
   AND json_extract(payload,'$.dueAt')<=? ORDER BY json_extract(payload,'$.dueAt'),id LIMIT ?`).all(collection,due,limit);
  const outcomes=[];
  for(const row of rows){
   try{outcomes.push(await this.advance(String(row.id)));}
   catch{outcomes.push(undefined);}
  }
  return outcomes;
 }

 /** Executes at most one provider phase; incomplete mutation claims are
  * intentionally excluded from automated retries after a crash. */
 async advance(id:string){
  const job=this.read(id);
  if(!job||Date.parse(job.dueAt)>(this.ports.now?.()??new Date()).getTime())return;
  if(!mutableStates.some(state=>state===job.state)&&job.state!=='PROCESSING')return;
  this.owner(job);
  const binding=await this.ports.resolvePage(Object.freeze({...job}));
  if(binding.pageId!==job.pageId||binding.revision!==job.revision||binding.selectionNonce!==job.selectionNonce)
   throw Error('REEL_PAGE_BINDING_CHANGED');
  if(job.state==='PROCESSING'){
   const status=await this.ports.provider.inspect(job.videoId!,binding.token);
   if(status==='PROCESSING')return this.receipt(job);
   return this.complete(job,'PROCESSING',status);
  }

  const claim:State=job.state==='QUEUED'?'STARTING':job.state==='STARTED'?'UPLOADING':'FINISHING';
  // Confirm the approved bytes even at finish, so a revoked/deleted render
  // cannot be published from an already uploaded provider object.
  const bytes=Uint8Array.from(this.ports.readOwnedRender(Object.freeze({...job})));
  if(bytes.length<12||bytes.length>50*1024*1024||digest(bytes)!==job.sha256)
   throw Error('REEL_RENDER_CHANGED');
  const claimed=this.transaction(()=>{
   const current=this.read(id);
   if(!current||current.state!==job.state||current.hash!==job.hash||current.videoId!==job.videoId)return false;
   this.owner(current);
   this.ports.assertCurrentApproval(Object.freeze({...current}),binding);
   assertFacebookCustomerPilotEffectsAllowed(this.store);
   this.save(current,claim);
   return true;
  });
  if(!claimed)return;
  try{
   if(claim==='STARTING'){
    const result=await this.ports.provider.start(binding.token);
    return result.state==='ACCEPTED'
     ? this.complete(job,claim,'STARTED',result.value)
     : this.complete(job,claim,result.state==='REJECTED'?'FAILED':'UNCERTAIN');
   }
   const result=claim==='UPLOADING'
    ? await this.ports.provider.upload(job.videoId!,binding.token,bytes)
    : await this.ports.provider.finish(job.videoId!,binding.token,job.caption);
   return this.complete(job,claim,result.state==='ACCEPTED'
    ? claim==='UPLOADING'?'UPLOADED':'PROCESSING'
    : result.state==='REJECTED'?'FAILED':'UNCERTAIN');
  }catch{return this.complete(job,claim,'UNCERTAIN');}
 }
}
