import {createMcpReelRenderer} from './reel-render-tool.js';
import {createInstagramCustomerPublishing} from '../instagram-publishing/customer-tools.js';
import {createLoopApprovalFlow,loopApprovals} from './loop-approval.js';
import {createCustomerFacebookReels} from './reel-tools.js';
import {generateRecurringFacebookCaption} from './recurring-caption.js';
import {createRecurringFacebookPublisher} from './recurring-publisher.js';
import {createScheduleCipher} from '../facebook-customer/scheduler.js';
import {isCanonicalFacebookPermalink} from './openai-image-generation-integration.js';
import type {CustomerSocialLoopOptions} from './social-loop-tools.js';
/** Trusted isolated pilot assembly. Import/construction never binds or sends.
 * Account/session provisioning and scheduler consent policy remain existing guarded ports.
 */
import {isAbsolute,join} from 'node:path';
import type {Store} from '../store.js';
import {CustomerFacebookMcpAuth,type TrustedCustomerMcpOAuthClient} from '../customer-mcp/customer-auth.js';
import {CustomerFacebookPageSelection} from '../facebook-pages/customer-page-selection.js';
import {SQLiteFacebookPageSelectionStore} from '../facebook-pages/sqlite-page-selection-store.js';
import {createTrustedFacebookPageTokenResolver,getCustomerFacebookPageSelectionGrant,
 getServerSideFacebookAccessToken,MetaGraphFacebookOAuthProvider,
 type FacebookOAuthConfig,type FacebookOAuthProvider,type FacebookPageTokenProvider,type FacebookTrustedPageTokenResolver} from '../facebook-pages/oauth.js';
import {FacebookGraphHttpTransport,FacebookPagesPilotAdapter,listManagedFacebookPages,verifyFacebookPhotoPostReceipt} from '../facebook-pilot/lcg8-provider.js';
import {FacebookCustomerMediaService} from '../facebook-customer-media/service.js';
import {FacebookCustomerImageChunkService} from '../facebook-customer-media/chunks.js';
import {createTrustedCustomerFacebookImagePublishReadPort} from '../facebook-customer-media/publish-read.js';
import type {VerifiedFacebookPostNowDependencies} from '../facebook-customer/verified-post-now.js';
import type {FacebookCustomerScheduler} from '../facebook-customer/scheduler.js';
import {createFacebookCustomerSchedulerPort} from './customer-backend.js';
import {createVerifiedFacebookPublisherComposition} from './verified-publisher-composition.js';
import {startStandaloneCustomerPilot} from './standalone-listener.js';
import {
 createHybridFacebookPageTokenResolver,
 FacebookCustomerOpenAIImageGenerationService,
 FacebookDirectPageCredentialStore,
 VerifiedFacebookPermalinkStore,
} from './openai-image-generation-integration.js';
import type {LCG6_OPENAI_IMAGE_KEY_REF} from '../facebook-customer-media/lcg6-openai-images-adapter.js';

export function createFacebookCustomerPilotComposition(input:{
 store:Store;issuer:string;registeredClients:readonly TrustedCustomerMcpOAuthClient[];
 facebook:FacebookOAuthConfig;privateStorageRoot:string;
 /** Factory shares the exact selected-Page/token lease instance with due dispatch.
  * Original consent and job-scoped media authorization still belong to caller. */
 scheduler:FacebookCustomerScheduler | ((context:{store:Store;pages:CustomerFacebookPageSelection;
  pageTokens:FacebookTrustedPageTokenResolver;provider:VerifiedFacebookPostNowDependencies['provider'];media:FacebookCustomerMediaService})=>FacebookCustomerScheduler);
 externalWritesEnabled:boolean;
 offlineReadiness?:true;
 disableDueWorker?:true;
 facebookReels?:{videoStore:Pick<Store,'get'|'user'>;renderRoot:string};
 instagram?:{loadCredential:()=>unknown};
 authorizeProviderWrite?: (binding:Parameters<VerifiedFacebookPostNowDependencies['provider']['publishNow']>[0],
  command:Parameters<VerifiedFacebookPostNowDependencies['provider']['publishNow']>[1])=>void;
 loops?:Omit<CustomerSocialLoopOptions,'store'>;
 recurringApproval?:{customerId:string;loadApproval:(consentRef:string)=>unknown};
 /** Explicit opt-in: caller must supply reviewed occurrence/generation/publish ports. */
 recurringWorker?:{intervalMs?:number;batchSize?:number;onError?:(error:unknown)=>void};
 openaiImageGeneration?:{
  enabled:boolean;
  resolveServerCredential:(ref:typeof LCG6_OPENAI_IMAGE_KEY_REF)=>string;
  fetchImpl?:typeof fetch;
  timeoutMs?:number;
  defaultTenantBudgetUsdCents?:number;
  uncappedCustomerId?:string;
  requireExplicitPublishApprovalForGeneratedMedia?:boolean;
  beforeProviderCallHook?:(context:{tenantId:string;subjectId:string;requestKey:string})=>Promise<void>|void;
 };
 /** Test injection/server-owned transport only; never request/tool arguments. */
 fetchImpl?:typeof fetch;oauthProvider?:FacebookOAuthProvider & FacebookPageTokenProvider;
}){
 const offline=input.offlineReadiness===true;
 if(offline ? input.externalWritesEnabled!==false : input.externalWritesEnabled!==true)
  throw Error('FACEBOOK_EXTERNAL_WRITES_DISABLED');
 if(offline&&(input.loops||input.recurringWorker||input.openaiImageGeneration?.enabled))
  throw Error('OFFLINE_READINESS_EFFECTS_DISABLED');
 if(!isAbsolute(input.privateStorageRoot))throw Error('ABSOLUTE_PRIVATE_STORAGE_REQUIRED');
 if(!input.scheduler)throw Error('DURABLE_FACEBOOK_SCHEDULER_REQUIRED');
 const config={...input.facebook};
 if(!config.graphVersion)throw Error('EXPLICIT_FACEBOOK_GRAPH_VERSION_REQUIRED');
 const oauthProvider=input.oauthProvider??new MetaGraphFacebookOAuthProvider(config);
 const graph=new FacebookGraphHttpTransport(config.graphVersion,offline
  ? async()=>{throw Error('OFFLINE_READINESS_PROVIDER_DISABLED')}
  : input.fetchImpl??fetch);
 const adapter=new FacebookPagesPilotAdapter(graph);
 const verifiedPermalinks=new VerifiedFacebookPermalinkStore(input.store);
 const provider:VerifiedFacebookPostNowDependencies['provider']={
  async publishNow(binding,command){
   input.authorizeProviderWrite?.(binding,command);
   const initial=await adapter.publishNow(binding,command);
   // This GET can only inspect the exact Page-owned acknowledgement returned
   // by the single POST. Read failures never authorize replaying the write.
   const verified=command.media?.kind==='IMAGE'&&initial.state==='PUBLISHED'
    ? await verifyFacebookPhotoPostReceipt(graph,binding,initial):initial;
   if(verified.state==='PUBLISHED'&&verified.providerPostRef&&(verified as {providerPostUrl?:string}).providerPostUrl){
    verifiedPermalinks.recordVerifiedPermalink({
     tenantId:binding.tenantId,
     pageId:binding.verifiedPageId,
     providerPostRef:verified.providerPostRef,
     providerPostUrl:(verified as {providerPostUrl:string}).providerPostUrl,
    });
   }
   if (verified.providerPostUrl &&
       !isCanonicalFacebookPermalink(verified.providerPostUrl,binding.verifiedPageId,verified.providerPostRef)) {
    const {providerPostUrl: _dropped,...safeReceipt}=verified;
    return safeReceipt;
   }
   return verified;
  }
 };
 const auth=new CustomerFacebookMcpAuth(input.store,input.registeredClients);
 const authenticateBearer=(authorization:unknown)=>auth.authenticateBearer(authorization);
 const directPageCredentials=new FacebookDirectPageCredentialStore({
  store:input.store,
  credentialKey:config.credentialKey,
 });
 const grant=(customer:{tenantId:string;userId:string},connectionId:string)=>
  connectionId.startsWith('fb-direct-')
   ? directPageCredentials.getOwnerConnectionGrant(customer,connectionId)
   : getCustomerFacebookPageSelectionGrant(input.store,customer,connectionId);
 const pages=new CustomerFacebookPageSelection(new SQLiteFacebookPageSelectionStore(input.store,grant),{
  async listManagedPages(connection){
   if(connection.id.startsWith('fb-direct-')){
    return directPageCredentials.listManagedPages(connection);
   }
   const credential=getServerSideFacebookAccessToken(input.store,connection.tenantId,connection.id,config.credentialKey);
   return listManagedFacebookPages(graph,credential.token);
  }
 });
 const oauthPageTokens=createTrustedFacebookPageTokenResolver(input.store,config,oauthProvider,pages);
 const pageTokens=createHybridFacebookPageTokenResolver({
  oauthResolver:oauthPageTokens,
  directCredentials:directPageCredentials,
  selectedPages:pages,
 });
 const media=new FacebookCustomerMediaService({store:input.store,storageRoot:join(input.privateStorageRoot,'images'),authenticate:authenticateBearer});
 const chunks=new FacebookCustomerImageChunkService({store:input.store,media,storageRoot:join(input.privateStorageRoot,'chunks')});
 const imageGeneration=new FacebookCustomerOpenAIImageGenerationService({
  store:input.store,
  auth,
  media,
  enabled:input.openaiImageGeneration?.enabled===true,
  resolveServerCredential:input.openaiImageGeneration?.resolveServerCredential??(()=>''),
  provenanceSecretKey:config.credentialKey,
  fetchImpl:input.openaiImageGeneration?.fetchImpl??input.fetchImpl,
  timeoutMs:input.openaiImageGeneration?.timeoutMs,
  defaultTenantBudgetUsdCents:input.openaiImageGeneration?.defaultTenantBudgetUsdCents,
  uncappedCustomerId:input.openaiImageGeneration?.uncappedCustomerId,
  requireExplicitPublishApprovalForGeneratedMedia:input.openaiImageGeneration?.requireExplicitPublishApprovalForGeneratedMedia,
  beforeProviderCallHook:input.openaiImageGeneration?.beforeProviderCallHook,
 });
 const scheduler=typeof input.scheduler==='function'
  ? input.scheduler({store:input.store,pages,pageTokens,provider,media}):input.scheduler;
 if(!scheduler||typeof scheduler.dispatchDue!=='function')throw Error('DURABLE_FACEBOOK_SCHEDULER_REQUIRED');
 const rawSchedulerPort=createFacebookCustomerSchedulerPort(scheduler);
 const schedulerPort={
  ...rawSchedulerPort,
  async list(req:Parameters<typeof rawSchedulerPort.list>[0]){
   const out=await rawSchedulerPort.list(req);
   return {
    ...out,
    jobs:out.jobs.map(job=>verifiedPermalinks.attachVerifiedPermalink(job)),
   };
  }
 };
 const connectionResource=(principal:{tenantId:string;subjectId:string},args:unknown)=>{
  const command=args as {accountConnectionId?:string;pageConnectionId?:string};
  const connectionId=command?.accountConnectionId??command?.pageConnectionId;
  if(!connectionId)throw Error('OWNED_FACEBOOK_CONNECTION_REQUIRED');
  const connection=grant({tenantId:principal.tenantId,userId:principal.subjectId},connectionId);
  if(!connection)throw Error('OWNED_FACEBOOK_CONNECTION_REQUIRED');
  return {ownerId:connection.userId,tenantId:connection.tenantId};
 };
 const recurring=input.recurringApproval;
 if(recurring&&(!input.openaiImageGeneration?.enabled||input.authorizeProviderWrite||input.loops||
   input.openaiImageGeneration.uncappedCustomerId!==recurring.customerId))
  throw Error('RECURRING_GENERATION_AUTHORIZATION_REQUIRED');
 const loops=recurring?createRecurringFacebookPublisher({
  ...recurring,store:input.store,cipher:createScheduleCipher(Buffer.from(config.credentialKey,'base64')),
  loadApproval:ref=>input.store.get(loopApprovals,ref)??recurring.loadApproval(ref),
  pageTokens,provider,graphVersion:config.graphVersion,generateCaption:captionInput=>generateRecurringFacebookCaption(captionInput,{resolveServerCredential:input.openaiImageGeneration!.resolveServerCredential,fetchImpl:input.openaiImageGeneration!.fetchImpl??input.fetchImpl}),
  resolveServerCredential:input.openaiImageGeneration!.resolveServerCredential,
  fetchImpl:input.openaiImageGeneration!.fetchImpl??input.fetchImpl,
 }):input.loops;
 const reels=input.facebookReels;
 if(reels&&(offline||input.authorizeProviderWrite||input.disableDueWorker))
  throw Error('FACEBOOK_REEL_EFFECTS_DISABLED');
 const reelRenderer=reels?createMcpReelRenderer({
  video:reels,store:input.store,media,privateStorageRoot:input.privateStorageRoot,
 }):undefined;
 const reelIntegration=reelRenderer?createCustomerFacebookReels({
  readRender:reelRenderer.read,store:input.store,graphVersion:config.graphVersion,pageTokens,fetchImpl:input.fetchImpl,
 }):undefined;
 if(input.instagram&&(offline||input.authorizeProviderWrite||input.disableDueWorker))
  throw Error('INSTAGRAM_EFFECTS_DISABLED');
 const instagram=input.instagram?createInstagramCustomerPublishing({
  ...input.instagram,store:input.store,issuer:input.issuer,privateStorageRoot:input.privateStorageRoot,
  graphVersion:config.graphVersion,media,readRender:reelRenderer?.read,fetchImpl:input.fetchImpl,
 }):undefined;
 const options:Parameters<typeof startStandaloneCustomerPilot>[0]={
  store:input.store,issuer:input.issuer,registeredClients:input.registeredClients,
  ...(offline?{offlineReadiness:true as const}:{customerFacebookOAuth:{config,provider:oauthProvider}}),
  ...(input.authorizeProviderWrite || (input.externalWritesEnabled && !offline) ? {firstPhotoHealth:true as const}:{}),
  pages,upload:{chunks,authenticateBearer},
  requireVerifiedPostNow:true,...(loops?{loops}:{}),
  ...(recurring&&loops?{loopApproval:createLoopApprovalFlow({
   ...recurring,store:input.store,issuer:input.issuer,engine:loops.engine,
   cipher:createScheduleCipher(Buffer.from(config.credentialKey,'base64')),
   csrfKey:Buffer.from(config.credentialKey,'base64'),
  })}:{}),
  ...(recurring?{recurringWorker:{batchSize:1}}:input.recurringWorker?{recurringWorker:input.recurringWorker}:{}),
  imageGeneration:offline?false:imageGeneration,
  ...(instagram?{instagramTools:instagram.tools,instagramMediaDelivery:instagram.delivery,instagramScheduler:instagram.jobs}:{}),
  ...(reelIntegration?{reelTools:[reelRenderer!.tool,reelRenderer!.advancedTool,reelRenderer!.statusTool,...reelIntegration.tools],reelScheduler:reelIntegration.jobs,renderScheduler:reelRenderer!.worker}:{}),
  verifiedPermalinks,
  verifiedPostNow:authorization=>createVerifiedFacebookPublisherComposition({
   store:input.store,customerAuth:auth,pages,pageTokens,provider,requestAuthorization:authorization,
   media:createTrustedCustomerFacebookImagePublishReadPort({media,authorization,authenticateBearer}),
   externalWritesEnabled:!offline
  }),
  // Publish can ONLY enter the verified request-bound facade above.
  backend:{...schedulerPort,async publishNow(){throw Error('UNVERIFIED_PUBLISH_FORBIDDEN')}},
  resolveManagedPageResource:(principal,args)=>{
   if((args as {accountConnectionId?:unknown})?.accountConnectionId)return connectionResource(principal,args);
   const owned=input.store.list('facebook-page-selections',principal.tenantId)
    .find((row:any)=>row.userId===principal.subjectId);
   if(!owned)throw Error('OWNED_FACEBOOK_SELECTION_REQUIRED');
   return {ownerId:owned.userId,tenantId:owned.tenantId};
  },
  loadStoredResource:(principal,tool,args)=>{
   if((tool as string)==='generate_image')return imageGeneration.getGenerationApproval(principal);
   if(tool!=='facebook_pages_cancel')return connectionResource(principal,args);
   const row=input.store.get('facebook-customer-schedule',(args as {jobId:string}).jobId);
   if(!row||row.tenantId!==principal.tenantId||row.userId!==principal.subjectId)throw Error('OWNED_FACEBOOK_JOB_REQUIRED');
   return {ownerId:row.userId,tenantId:row.tenantId};
  }
 };
 return {
  options,
  auth,
  pages,
  media,
  chunks,
  directPageCredentials,
  imageGeneration,
  verifiedPermalinks,
  async start(port=0){return startStandaloneCustomerPilot(options,port,{scheduler,...(offline||input.disableDueWorker?{disabled:true as const}:{})});}
 };
}
