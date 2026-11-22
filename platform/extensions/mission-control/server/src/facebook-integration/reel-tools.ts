import {z} from 'zod';
import type {Store} from '../store.js';
import type {CustomerFacebookHttpTool} from '../customer-mcp/customer-http.js';
import type {FacebookTrustedPageTokenResolver} from '../facebook-pages/oauth.js';
import {FacebookReelsProvider} from '../facebook-pilot/reels-provider.js';
import {FacebookReelJobs,type FacebookReelJob} from '../facebook-pilot/reel-jobs.js';
import type {readOwnedVideoRender} from '../video/publish-read.js';
import {readSchedulePageSelection} from './openai-image-generation-integration.js';
import {assertFacebookCustomerPilotEffectsAllowed} from './pilot-effect-stop.js';

export function createCustomerFacebookReels(input:{
 store:Store;readRender:(owner:{tenantId:string;userId:string},ref:string)=>ReturnType<typeof readOwnedVideoRender>;graphVersion:string;
 pageTokens:FacebookTrustedPageTokenResolver;fetchImpl?:typeof fetch;
}){
 function currentSelection(job:Pick<FacebookReelJob,'tenantId'|'userId'|'connectionId'>){
  return readSchedulePageSelection(input.store,job.tenantId,job.userId,job.connectionId);
 }
 const jobs=new FacebookReelJobs(input.store,{
  provider:new FacebookReelsProvider(input.graphVersion,input.fetchImpl),
  async resolvePage(job){
   const selected=currentSelection(job);
   const binding=await input.pageTokens.resolveCurrentPageToken({
    tenantId:job.tenantId,userId:job.userId,pageConnectionId:job.connectionId,...selected,
   });
   await input.pageTokens.assertResolvedPageTokenCurrent(binding);
   return {pageId:binding.verifiedPageId,revision:binding.connectionRevision,
    selectionNonce:selected.selectionNonce,token:binding.pageToken};
  },
  readOwnedRender:job=>input.readRender(job,job.renderRef).bytes,
  assertCurrentApproval(job){
   const current=currentSelection(job);
   if(current.pageId!==job.pageId||current.connectionRevision!==job.revision||current.selectionNonce!==job.selectionNonce)
    throw Error('REEL_PAGE_BINDING_CHANGED');
  },
 });
 const opaque=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/);
 const publishSchema=z.object({
  requestKey:opaque,pageConnectionId:opaque,renderRef:z.string().regex(/^vrnd-[0-9a-f-]{36}$/),
  caption:z.string().max(5000),dueAt:z.string().datetime({precision:3}).optional(),
 }).strict();
 const jobSchema=z.object({jobId:z.string().regex(/^fbreel-[a-f0-9]{64}$/)}).strict();
 const owner=(principal:{tenantId:string;subjectId:string})=>({tenantId:principal.tenantId,userId:principal.subjectId});
 const tools:CustomerFacebookHttpTool[]=[
  {name:'facebook_reel_submit',
   description:'Queue an explicitly approved completed private MP4 as a Facebook Reel, now or at a UTC time. Inspect its job for confirmed publication.',
   inputSchema:publishSchema,invoke:async(ctx,raw)=>{
    assertFacebookCustomerPilotEffectsAllowed(input.store);
    const args=publishSchema.parse(raw);
    const actor=owner(ctx.principal);
    const selected=currentSelection({...actor,connectionId:args.pageConnectionId});
    const render=input.readRender(actor,args.renderRef);
    return jobs.enqueue(actor,{
     requestKey:args.requestKey,connectionId:args.pageConnectionId,pageId:selected.pageId,
     revision:selected.connectionRevision,selectionNonce:selected.selectionNonce,renderRef:args.renderRef,
     sha256:render.sha256,caption:args.caption,dueAt:args.dueAt??'1970-01-01T00:00:00.000Z',
    });
   }},
  {name:'facebook_reel_status',description:'Inspect your Reel job and its verified processing or publishing state.',
   inputSchema:jobSchema,invoke:async(ctx,raw)=>{
    const result=jobs.get(owner(ctx.principal),jobSchema.parse(raw).jobId);
    if(!result)throw Error('REEL_JOB_NOT_FOUND');
    return result;
   }},
  {name:'facebook_reel_cancel',description:'Cancel your Reel job before a publishing mutation is in flight.',
   inputSchema:jobSchema,invoke:async(ctx,raw)=>jobs.cancel(owner(ctx.principal),jobSchema.parse(raw).jobId)},
 ];
 return {tools,jobs};
}
