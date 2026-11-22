import {Events} from '../events.js';
import {VideoRenderWorker} from '../video/worker.js';
import {compileCustomerReelSpec,customerReelSpec} from './reel-spec.js';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {Store} from '../store.js';
import type {CustomerFacebookHttpTool} from '../customer-mcp/customer-http.js';
import type {FacebookCustomerMediaService} from '../facebook-customer-media/service.js';
import {readOwnedVideoRender} from '../video/publish-read.js';
import {renderRecurringReel} from './recurring-reel.js';
import {assertFacebookCustomerPilotEffectsAllowed} from './pilot-effect-stop.js';

const requests='customer-mcp-reel-render-requests';
const schema=z.object({
 requestKey:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/),
 imageRef:z.string().regex(/^fbimg-[a-f0-9]{32}$/).optional(),
 spec:customerReelSpec.optional(),
}).strict();

export function createMcpReelRenderer(input:{
 store:Store;media:FacebookCustomerMediaService;privateStorageRoot:string;
 video:{videoStore:Pick<Store,'get'|'user'>;renderRoot:string};
}){
 const {store}=input,root=join(input.privateStorageRoot,'reel-renders');
 const worker=new VideoRenderWorker({store,events:new Events(),baseDir:root,customerIsolation:true});
 let rendering=false;
 const read=(owner:{tenantId:string;userId:string},ref:string)=>store.get('video-renders',ref)
  ?readOwnedVideoRender(store,root,owner,ref)
  :readOwnedVideoRender(input.video.videoStore,input.video.renderRoot,owner,ref);
 const tool:CustomerFacebookHttpTool={
  name:'facebook_reel_render',
  description:'Create a private vertical Reel MP4 without publishing. Provide either imageRef for a six-second animation or spec for a 4–60 second multi-scene video with text, transitions, music and voiceovers. Poll facebook_reel_render_status for queued renders, then submit the completed vrnd- ID.',
  inputSchema:schema,
  invoke:async(ctx,raw)=>{
   assertFacebookCustomerPilotEffectsAllowed(store);
   const {requestKey,imageRef,spec}=schema.parse(raw);
   if(Boolean(imageRef)===Boolean(spec))throw Error('REEL_RENDER_SOURCE_REQUIRED');
   const ownerId=ctx.principal.subjectId,owner={tenantId:ctx.principal.tenantId,userId:ownerId};
   const id='mcp-reel-'+createHash('sha256').update(JSON.stringify([ownerId,requestKey])).digest('hex');
   if(spec){
    const compiled=compileCustomerReelSpec(spec);
    const specHash=createHash('sha256').update(JSON.stringify(compiled)).digest('hex');
    store.db.exec('BEGIN IMMEDIATE');
    try{
     const existing=store.get(requests,id);
     if(existing){
      if(existing.ownerId!==ownerId||existing.specHash!==specHash)throw Error('REEL_RENDER_REQUEST_CONFLICT');
      const render=store.get('video-renders',existing.renderRef);
      if(!render||render.ownerId!==ownerId)throw Error('REEL_RENDER_UNAVAILABLE');
      store.db.exec('COMMIT');
      return {state:render.status,renderRef:render.id};
     }
     const active=store.list('video-renders').filter(render=>!['COMPLETE','FAILED','CANCELLED'].includes(render.status));
     if(active.length>=20||active.filter(render=>render.ownerId===ownerId).length>=3)throw Error('REEL_RENDER_QUEUE_FULL');
     const renderRef='vrnd-'+randomUUID(),projectId='mcp-project-'+renderRef,now=new Date().toISOString();
     store.put('video-projects',{id:projectId,ownerId,status:'RENDERING',spec:compiled,createdAt:now,updatedAt:now},ownerId);
     store.put('video-renders',{id:renderRef,ownerId,videoProjectId:projectId,status:'QUEUED',progress:0,
      stage:'QUEUED',specSnapshot:compiled,duration:spec.duration,width:540,height:960,fps:24,createdAt:now,updatedAt:now},ownerId);
     store.put(requests,{id,ownerId,renderRef,specHash},ownerId);
     store.db.exec('COMMIT');
     return {state:'QUEUED',renderRef};
    }catch(error){if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
   }
   if(!imageRef)throw Error('REEL_RENDER_SOURCE_REQUIRED');
   const source=input.media.readOwnedImageForSocialPublish(owner,imageRef);
   const prior=store.get(requests,id);
   if(prior){
    if(prior.ownerId!==ownerId||prior.sourceSha256!==source.media.sha256||prior.imageRef!==imageRef)
     throw Error('REEL_RENDER_REQUEST_CONFLICT');
    const existing=read(owner,prior.renderRef);
    return {state:'READY',renderRef:existing.ref};
   }
   if(source.media.contentType!=='image/png')throw Error('REEL_RENDER_REQUIRES_PNG');
   if(rendering)throw Error('REEL_RENDER_BUSY');
   const renderRef='vrnd-'+randomUUID(),projectId='mcp-project-'+renderRef;
   const dir=join(root,renderRef),outputPath=join(dir,'output.mp4');
   let stored=false;
   rendering=true;
   try{
    const bytes=await renderRecurringReel(source.bytes);
    assertFacebookCustomerPilotEffectsAllowed(store);
    if(input.media.readOwnedImageForSocialPublish(owner,imageRef).media.sha256!==source.media.sha256)
     throw Error('REEL_RENDER_SOURCE_CHANGED');
    await mkdir(dir,{recursive:true,mode:0o700});
    await writeFile(outputPath,bytes,{mode:0o600,flag:'wx'});
    store.db.exec('BEGIN IMMEDIATE');
    try{
     const existing=store.get(requests,id);
     if(existing){
      if(existing.ownerId!==ownerId||existing.sourceSha256!==source.media.sha256||existing.imageRef!==imageRef)
       throw Error('REEL_RENDER_REQUEST_CONFLICT');
      store.db.exec('COMMIT');
      return {state:'READY',renderRef:read(owner,existing.renderRef).ref};
     }
     assertFacebookCustomerPilotEffectsAllowed(store);
     store.put('video-projects',{id:projectId,ownerId},ownerId);
     store.put('video-renders',{id:renderRef,ownerId,videoProjectId:projectId,status:'COMPLETE',
      outputPath,fileSize:bytes.length},ownerId);
     store.put(requests,{id,ownerId,renderRef,imageRef,sourceSha256:source.media.sha256},ownerId);
     store.db.exec('COMMIT');
     stored=true;
    }catch(error){if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
    return {state:'READY',renderRef};
   }finally{
    rendering=false;
    if(!stored)await rm(dir,{recursive:true,force:true});
   }
  },
 };
 const advancedSchema=schema.omit({imageRef:true,spec:true}).extend({spec:customerReelSpec});
 const advancedTool:CustomerFacebookHttpTool={
  name:'facebook_reel_render_spec',
  description:'Queue an advanced 4–60 second vertical Reel with multiple scenes, animated text, transitions, synthetic music and optional voiceovers. Poll facebook_reel_render_status, then submit the completed vrnd- render. This tool does not publish.',
  inputSchema:advancedSchema,
  invoke:(ctx,raw)=>tool.invoke(ctx,advancedSchema.parse(raw)),
 };
 const statusSchema=z.object({renderRef:z.string().regex(/^vrnd-[0-9a-f-]{36}$/)}).strict();
 const statusTool:CustomerFacebookHttpTool={
  name:'facebook_reel_render_status',
  description:'Check progress for your Customer MCP Reel render. Submit only a COMPLETE or READY render.',
  inputSchema:statusSchema,
  invoke:async(ctx,raw)=>{
   const {renderRef}=statusSchema.parse(raw);
   const render=store.get('video-renders',renderRef);
   if(!render||render.ownerId!==ctx.principal.subjectId||render.ownerId!==ctx.principal.tenantId)
    throw Error('REEL_RENDER_UNAVAILABLE');
   return {renderRef,state:render.status,progress:render.progress??(render.status==='COMPLETE'?1:0),
    ...(render.status==='FAILED'?{reason:'VIDEO_RENDER_FAILED'}:{})};
  },
 };
 return {tool,advancedTool,statusTool,read,worker:{async dispatchDue(){
  assertFacebookCustomerPilotEffectsAllowed(store);
  await worker.processNext();
  return [];
 }}};

}
