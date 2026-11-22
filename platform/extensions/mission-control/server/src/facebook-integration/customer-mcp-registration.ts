import type {createLoopApprovalFlow} from './loop-approval.js';
import {isCanonicalFacebookPermalink} from './openai-image-generation-integration.js';
import {createCustomerSocialLoopTools,type CustomerSocialLoopOptions} from './social-loop-tools.js';
import {z} from 'zod';
import type {CustomerFacebookPageSelection} from '../facebook-pages/customer-page-selection.js';
/** Isolated Facebook customer MCP registration over LCG1's authenticated OAuth/HTTP handler.
 * No admin MCP exposure, no listener, no live Meta posting or bypass of owner modules.
 */
import type {Store} from '../store.js';
import type {VerifiedFacebookPostNow} from '../facebook-customer/verified-post-now.js';
import {createTrustedCustomerFacebookImageUploadToolPort, type VerifiedCustomerImageToolPrincipal, type FacebookCustomerUploadToolAction} from '../facebook-customer-media/tool-upload.js';
import type {FacebookCustomerImageChunkService} from '../facebook-customer-media/chunks.js';
import {createCustomerFacebookMcpHttpHandler,type CustomerFacebookHttpTool} from '../customer-mcp/customer-http.js';
import type {CustomerMcpPrincipal,TrustedCustomerMcpOAuthClient} from '../customer-mcp/customer-auth.js';
import {
  customerFacebookToolContracts,createCustomerFacebookMcpHandlers,
  type CustomerFacebookMcpBackend,type FacebookMcpToolName
} from '../../../control-plane/src/customer-facebook-mcp-contract.js';
import {
  GENERATION_APPROVAL_COLLECTION,
  VerifiedFacebookPermalinkStore,
  type FacebookCustomerOpenAIImageGenerationService,
} from './openai-image-generation-integration.js';

export const customerGenerateImageInputSchema = z.object({
  requestKey: z.string().min(8).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  prompt: z.string().trim().min(12).max(1200),
}).strict();

/** Load a live private upload session from trusted server storage; never from tool JSON. */
export function loadTrustedCustomerUploadSession(store:Store,principal:CustomerMcpPrincipal,args:unknown){
        const request=args as {action?:unknown;uploadRef?:unknown};
        if(request?.action==='BEGIN')return undefined;
        if(!['CHUNK','FINISH','CANCEL'].includes(String(request?.action)) ||
          typeof request.uploadRef!=='string'||!/^fbup-[a-f0-9]{32}$/.test(request.uploadRef))
          throw Error('CUSTOMER_UPLOAD_SESSION_UNAVAILABLE');
        const row=store.get('facebook-customer-chunked-image-sessions',request.uploadRef) as
          {id?:string;uploadRef?:string;tenantId?:string;ownerId?:string;subjectId?:string;state?:string;expiresAt?:number;chunkBytes?:number;contentType?:string;totalBytes?:number}|undefined;
        if(!row||row.id!==request.uploadRef||row.uploadRef!==request.uploadRef||
          row.tenantId!==principal.tenantId||row.ownerId!==principal.subjectId||
          row.subjectId!==principal.subjectId||!['UPLOADING','FINALIZING','COMPLETED'].includes(String(row.state))||
          !Number.isFinite(row.expiresAt)||Number(row.expiresAt)<=Date.now()||
          row.chunkBytes!==65536||!['image/png','image/jpeg'].includes(String(row.contentType))||
          !Number.isSafeInteger(row.totalBytes)||Number(row.totalBytes)<1||Number(row.totalBytes)>8000000)
          throw Error('CUSTOMER_UPLOAD_SESSION_UNAVAILABLE');
        return {ownerId:row.ownerId,tenantId:row.tenantId};
}

export function createIsolatedFacebookCustomerHttpIntegration(options:{
  store:Store;
  issuer:string;
  registeredClients:readonly TrustedCustomerMcpOAuthClient[];
  backend:CustomerFacebookMcpBackend;
  /** Optional trusted publish-now facade; raw per-request bearer is mandatory. */
  verifiedPostNow?:VerifiedFacebookPostNow | ((authorization:string)=>VerifiedFacebookPostNow);
  /** Production launch guard: forbid the legacy structural-command publish fallback. */
  requireVerifiedPostNow?:boolean;
  /** This MUST read current tenant-owned Page or job from the trusted Store synchronously. */
  loadStoredResource:(principal:CustomerMcpPrincipal,tool:FacebookMcpToolName,args:unknown)=>unknown;
  upload?:{chunks:FacebookCustomerImageChunkService;authenticateBearer:(authorization:unknown)=>VerifiedCustomerImageToolPrincipal};
  pages?:CustomerFacebookPageSelection;
  resolveManagedPageResource?:(principal:CustomerMcpPrincipal,args:unknown)=>unknown;
  loops?:Omit<CustomerSocialLoopOptions,'store'>;
  loopApproval?:ReturnType<typeof createLoopApprovalFlow>;
  reelTools?:CustomerFacebookHttpTool[];
  instagramTools?:CustomerFacebookHttpTool[];
  imageGeneration?:FacebookCustomerOpenAIImageGenerationService | false;
  resolveGenerationApproval?:(principal:CustomerMcpPrincipal,args:unknown)=>unknown;
  verifiedPermalinks?:VerifiedFacebookPermalinkStore;
  clock?:()=>number;
  offlineReadiness?:true;
}){
  if(typeof options?.loadStoredResource!=='function')throw Error('Trusted customer Facebook resource lookup required');
  if(options.requireVerifiedPostNow===true && !options.verifiedPostNow)throw Error('VERIFIED_FACEBOOK_PUBLISHER_REQUIRED');
  const verifiedPermalinks=options.verifiedPermalinks??new VerifiedFacebookPermalinkStore(options.store);
  const handlers=createCustomerFacebookMcpHandlers(options.backend);
  const names=Object.keys(customerFacebookToolContracts) as FacebookMcpToolName[];
  const tools:CustomerFacebookHttpTool[]=names.map(name=>{
    const contract=customerFacebookToolContracts[name];
    return {
      name,
      description:options.reelTools&&['facebook_pages_schedule','facebook_pages_publish_now'].includes(name)
        ? contract.description+' For video, use facebook_reel_submit with an owned completed vrnd- render ID.'
        : contract.description,
      inputSchema:contract.input,
      invoke:async(context,raw,authorization)=>{
        if(options.offlineReadiness&&name!=='facebook_pages_list')
          throw Error('OFFLINE_READINESS_EFFECTS_DISABLED');
        if(name==='facebook_pages_publish_now' && options.imageGeneration){
          const cmd=contract.input.parse(raw) as {pageConnectionId:string;caption:string;mediaRefs?:string[];idempotencyKey:string};
          options.imageGeneration.assertPublishApprovedForMediaRefs({
            tenantId:context.principal.tenantId,
            userId:context.principal.subjectId,
            pageConnectionId:cmd.pageConnectionId,
            mediaRefs:cmd.mediaRefs??[],
            caption:cmd.caption,
            mode:'NOW',
          });
        }
        if(name==='facebook_pages_schedule' && options.imageGeneration){
          const cmd=customerFacebookToolContracts.facebook_pages_schedule.input.parse(raw);
          options.imageGeneration.assertPublishApprovedForMediaRefs({
            tenantId:context.principal.tenantId,
            userId:context.principal.subjectId,
            pageConnectionId:cmd.pageConnectionId,
            mediaRefs:cmd.mediaRefs??[],
            caption:cmd.caption,
            mode:'SCHEDULE',
            schedule:cmd,
          });
        }
        if(name==='facebook_pages_publish_now' && options.verifiedPostNow){
          if(context.principal.role!=='customer'||!context.principal.permissions?.includes('facebook.pages.publish'))
            throw Error('CUSTOMER_FACEBOOK_PERMISSION_REQUIRED');
          if(typeof authorization!=='string')throw Error('CUSTOMER_BEARER_REQUIRED');
          const cmd=contract.input.parse(raw) as {pageConnectionId:string;caption:string;mediaRefs?:string[];idempotencyKey:string};
          // Bind private media reads to this exact server-obtained request bearer.
          // A factory avoids sharing mutable credentials across simultaneous customers.
          const publisher=typeof options.verifiedPostNow==='function'
            ? options.verifiedPostNow(authorization):options.verifiedPostNow;
          const receipt=await publisher.publishNow({
            authorization,verifiedRequestId:cmd.idempotencyKey,
            command:{pageConnectionId:cmd.pageConnectionId,caption:cmd.caption,
              mediaRefs:cmd.mediaRefs,idempotencyKey:cmd.idempotencyKey}
          });
          if(receipt.tenantId!==context.principal.tenantId || receipt.userId!==context.principal.subjectId ||
            receipt.pageConnectionId!==cmd.pageConnectionId || receipt.commandId!==cmd.idempotencyKey)
            throw Error('VERIFIED_PUBLISH_RECEIPT_MISMATCH');
          const state=receipt.state==='NOT_PUBLISHED'?'FAILED':receipt.state;
          if(state==='PUBLISHED'&&!receipt.providerPostId)throw Error('PROVIDER_RECEIPT_UNAVAILABLE');
          const candidateUrl=state==='PUBLISHED'&&receipt.providerPostId
            ? ((receipt as {providerPostUrl?:string}).providerPostUrl ?? verifiedPermalinks.getVerifiedPermalink(receipt.tenantId,receipt.providerPostId))
            : undefined;
          const verifiedUrl=isCanonicalFacebookPermalink(candidateUrl,undefined,receipt.providerPostId)?candidateUrl:undefined;
          return {
            published:state==='PUBLISHED',
            receiptStatus:state,
            ...(verifiedUrl?{providerPostUrl:verifiedUrl}:{}),
            job:{
              id:receipt.id,tenantId:receipt.tenantId,
              pageConnectionId:receipt.pageConnectionId,state,
              ...(receipt.providerPostId?{providerPostRef:receipt.providerPostId}:{}),
              ...(verifiedUrl?{providerPostUrl:verifiedUrl}:{}),
              ...(receipt.publishedAt?{publishedAt:receipt.publishedAt}:{}),
              ...(receipt.errorCode?{errorCode:receipt.errorCode}:{})
            }
          };
        }
        return (handlers[name] as (ctx:typeof context,input:unknown)=>Promise<unknown>)(context,raw);
      },
      ...(name==='facebook_pages_list'?{}:{loadStoredResource:(p:CustomerMcpPrincipal,args:unknown)=>options.loadStoredResource(p,name,args)})
    };
  });
  if(options.upload&&!options.offlineReadiness){
    const key=z.string().min(1).max(160);
    const action=z.discriminatedUnion('action',[
      z.object({action:z.literal('BEGIN'),idempotencyKey:key,contentType:z.enum(['image/png','image/jpeg']),totalBytes:z.number().int().min(1).max(8000000),sha256:z.string().regex(/^[a-fA-F0-9]{64}$/),originClaim:z.enum(['CHATGPT_GENERATED','USER_UPLOADED']).optional()}).strict(),
      z.object({action:z.literal('CHUNK'),uploadRef:key,partIndex:z.number().int().nonnegative(),chunkBase64:z.string().max(87384)}).strict(),
      z.object({action:z.literal('FINISH'),uploadRef:key}).strict(),
      z.object({action:z.literal('CANCEL'),uploadRef:key}).strict()
    ]);
    tools.push({name:'facebook_media_upload',description:'Upload a private PNG/JPEG in bounded chunks for an authorized Facebook Page post.',inputSchema:action,
      loadStoredResource:(principal,args)=>loadTrustedCustomerUploadSession(options.store,principal,args),
      invoke:async(_ctx,args,authorization)=>{
        if(typeof authorization!=='string')throw Error('Authenticated customer bearer required');
        return createTrustedCustomerFacebookImageUploadToolPort({
          chunks:options.upload!.chunks,authorization,authenticateBearer:options.upload!.authenticateBearer
        }).execute(args as FacebookCustomerUploadToolAction);
      }});
  }
  if(options.pages&&!options.offlineReadiness){
    if(typeof options.resolveManagedPageResource!=='function')throw Error('Managed Page tools require trusted resource resolver');
    const opaque=z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
    const actor=(ctx:Parameters<CustomerFacebookHttpTool['invoke']>[0])=>({tenantId:ctx.principal.tenantId,userId:ctx.principal.subjectId});
    tools.push(
      {name:'facebook_pages_list_managed',description:'List managed Pages from your current Facebook connection.',inputSchema:z.object({accountConnectionId:opaque}).strict(),invoke:async(ctx,args:any)=>options.pages!.listPages(actor(ctx),args.accountConnectionId)},
      {name:'facebook_pages_select',description:'Choose one currently authorized managed Page.',inputSchema:z.object({accountConnectionId:opaque,pageId:opaque}).strict(),loadStoredResource:options.resolveManagedPageResource,invoke:async(ctx,args:any)=>options.pages!.selectPage(actor(ctx),args.accountConnectionId,args.pageId)},
      {name:'facebook_pages_current',description:'Inspect your current Page choice; a choice is not publication.',inputSchema:z.object({}).strict(),invoke:async(ctx)=>options.pages!.currentPage(actor(ctx))},
      {name:'facebook_pages_clear',description:'Clear your current Page selection without publishing.',inputSchema:z.object({}).strict(),loadStoredResource:options.resolveManagedPageResource,invoke:async(ctx)=>options.pages!.clearPage(actor(ctx))}
    );
  }
  if(options.instagramTools)tools.push(...options.instagramTools);
  if(options.reelTools)tools.push(...options.reelTools);
  if(options.loopApproval)tools.push(options.loopApproval.tool);
  if(options.loops)tools.push(...createCustomerSocialLoopTools({...options.loops,store:options.store}));
  if(options.imageGeneration!==false){
    tools.push({
      name:'generate_image',
      description:'Generate one private PNG image via server-managed OpenAI Images for preview before separate Facebook Page publishing approval. Never publishes automatically.',
      inputSchema:customerGenerateImageInputSchema,
      loadStoredResource:(principal,args)=>{
        if(options.resolveGenerationApproval)return options.resolveGenerationApproval(principal,args);
        if(options.imageGeneration)return options.imageGeneration.getGenerationApproval(principal);
        const stored=options.store.get(GENERATION_APPROVAL_COLLECTION,`gen-approval-${principal.tenantId}`)
          ?? options.store.get('qa-generation-approvals',`generation-${principal.ownerId}`);
        if(stored)return stored;
        return options.loadStoredResource(principal,'generate_image' as unknown as FacebookMcpToolName,args);
      },
      invoke:async(_ctx,raw,authorization)=>{
        if(!options.imageGeneration)throw Error('IMAGE_GENERATION_ADAPTER_REQUIRED');
        const parsed=customerGenerateImageInputSchema.parse(raw);
        return options.imageGeneration.generateAndStorePrivateImage(authorization,parsed);
      }
    });
  }
  // LCG1 enforces signed-in USER, current per-request customer Bearer, scopes,
  // CSRF/S256 OAuth and a dedicated /customer/mcp, not the legacy admin /mcp.
  return createCustomerFacebookMcpHttpHandler({store:options.store,issuer:options.issuer,
    registeredClients:options.registeredClients,tools,loopApproval:options.loopApproval,...(options.clock?{clock:options.clock}:{})});
}
