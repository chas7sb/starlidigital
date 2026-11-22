import {join} from 'node:path';
import {z} from 'zod';
import type {Store} from '../store.js';
import type {CustomerFacebookHttpTool} from '../customer-mcp/customer-http.js';
import type {FacebookCustomerMediaService} from '../facebook-customer-media/service.js';
import {assertFacebookCustomerPilotEffectsAllowed} from '../facebook-integration/pilot-effect-stop.js';
import type {readOwnedVideoRender} from '../video/publish-read.js';
import {InstagramGraphProvider} from './graph-provider.js';
import {InstagramPublishJobs} from './jobs.js';
import {InstagramMediaDelivery} from './media-delivery.js';
import {normalizeInstagramJpeg} from './jpeg.js';

const opaque=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/);
const credentialSchema=z.object({
 ownerId:opaque,connectionId:opaque,accountId:z.string().regex(/^\d{1,30}$/),
 revision:opaque,token:z.string().regex(/^[\x21-\x7e]{12,10000}$/),expiresAt:z.string().datetime(),
}).strict();
const submit=z.object({
 requestKey:opaque,connectionId:opaque,mediaRef:opaque,kind:z.enum(['IMAGE','REEL']),
 caption:z.string().max(2200),dueAt:z.string().datetime({precision:3}).optional(),
}).strict();
const jobId=z.object({jobId:z.string().regex(/^igpub-[a-f0-9]{64}$/)}).strict();

export function createInstagramCustomerPublishing(input:{
 store:Store;issuer:string;privateStorageRoot:string;graphVersion:string;
 media:FacebookCustomerMediaService;
 readRender?:(owner:{tenantId:string;userId:string},ref:string)=>ReturnType<typeof readOwnedVideoRender>;
 loadCredential:()=>unknown;
 fetchImpl?:typeof fetch;
}){
 const {store}=input;
 const provider=new InstagramGraphProvider(input.graphVersion,input.issuer,input.fetchImpl,'instagram');
 const delivery=new InstagramMediaDelivery(store,join(input.privateStorageRoot,'instagram'),input.issuer);
 const credential=(ownerId:string,connectionId:string)=>{
  assertFacebookCustomerPilotEffectsAllowed(store);
  const account=credentialSchema.parse(input.loadCredential());
  if(account.ownerId!==ownerId||account.connectionId!==connectionId||Date.parse(account.expiresAt)<=Date.now())
   throw Error('INSTAGRAM_CONNECTION_UNAVAILABLE');
  return account;
 };
 const mediaFor=(owner:{tenantId:string;userId:string},kind:'IMAGE'|'REEL',ref:string)=>{
  if(kind==='IMAGE'){
   const {media,bytes}=input.media.readOwnedImageForSocialPublish(owner,ref);
   return {bytes,sha256:media.sha256,contentType:media.contentType};
  }
  if(!input.readRender)throw Error('INSTAGRAM_REEL_SOURCE_UNAVAILABLE');
  const render=input.readRender(owner,ref);
  return {bytes:render.bytes,sha256:render.sha256,contentType:render.mimeType};
 };
 const jobs=new InstagramPublishJobs(store,{
  provider,
  async resolveAuthorizedBinding(job){
   const account=credential(job.userId,job.connectionId);
   if(account.revision!==job.credentialRevision||account.accountId!==job.accountId||
    await provider.directAccount(account.token)!==account.accountId)
    throw Error('INSTAGRAM_ACCOUNT_BINDING_CHANGED');
   const source=mediaFor(job,job.kind,job.mediaRef);
   if(source.sha256!==job.mediaSha256)throw Error('INSTAGRAM_MEDIA_CHANGED');
   let mediaUrl='';
   if(job.state==='QUEUED'){
    const bytes=job.kind==='IMAGE'?await normalizeInstagramJpeg(source.bytes,source.contentType):source.bytes;
    mediaUrl=delivery.issue({ownerId:job.userId,jobId:job.id,bytes,
     mime:job.kind==='IMAGE'?'image/jpeg':'video/mp4'});
   }
   return {accountId:account.accountId,token:account.token,mediaUrl};
  },
  assertCurrentApproval(job,binding){
   const account=credential(job.userId,job.connectionId);
   if(account.revision!==job.credentialRevision||account.accountId!==job.accountId||account.token!==binding.token||
    mediaFor(job,job.kind,job.mediaRef).sha256!==job.mediaSha256)
    throw Error('INSTAGRAM_APPROVAL_CHANGED');
  },
 });
 const owner=(principal:{tenantId:string;subjectId:string})=>({tenantId:principal.tenantId,userId:principal.subjectId});
 const tools:CustomerFacebookHttpTool[]=[
  {name:'instagram_submit',description:'Queue an approved owned image or completed Reel MP4 for Instagram, now or at a UTC time. Use a private media reference. Check the job for a publication receipt.',
   inputSchema:submit,invoke:async(ctx,raw)=>{
    const args=submit.parse(raw),actor=owner(ctx.principal);
    const account=credential(actor.userId,args.connectionId);
    if(await provider.directAccount(account.token)!==account.accountId)throw Error('INSTAGRAM_ACCOUNT_BINDING_CHANGED');
    const media=mediaFor(actor,args.kind,args.mediaRef);
    return jobs.enqueue(actor,{...args,dueAt:args.dueAt??'1970-01-01T00:00:00.000Z',
     accountId:account.accountId,credentialRevision:account.revision,mediaSha256:media.sha256});
   }},
  {name:'instagram_status',description:'Read your Instagram publishing job and confirmed post ID.',
   inputSchema:jobId,invoke:async(ctx,raw)=>{
    const result=jobs.get(owner(ctx.principal),jobId.parse(raw).jobId);
    if(!result)throw Error('INSTAGRAM_JOB_NOT_FOUND');
    return result;
   }},
  {name:'instagram_cancel',description:'Cancel a queued or processing Instagram job before publishing begins.',
   inputSchema:jobId,invoke:async(ctx,raw)=>jobs.cancel(owner(ctx.principal),jobId.parse(raw).jobId)},
 ];
 return {tools,delivery,jobs:{async dispatchDue(limit:number){delivery.purgeExpired();return jobs.dispatchDue(limit);}}};
}
