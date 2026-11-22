import {FacebookReelsProvider} from '../facebook-pilot/reels-provider.js';
import {publishRecurringReel,renderRecurringReel} from './recurring-reel.js';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Store} from '../store.js';
import {assertActiveCustomerFacebookLoopConsent} from '../customer-mcp/customer-auth.js';
import {createLcg6OpenAIImagesAdapter,type Lcg6GenerationDependencies} from '../facebook-customer-media/lcg6-openai-images-adapter.js';
import {DailyFacebookLoopEngine,type DailyPorts} from '../facebook-customer/lcg14-recurring-loop.js';
import type {FacebookTrustedPageTokenResolver} from '../facebook-pages/oauth.js';
import type {VerifiedFacebookPostNowDependencies} from '../facebook-customer/verified-post-now.js';
import {assertFacebookCustomerPilotEffectsAllowed} from './pilot-effect-stop.js';
import {readSchedulePageSelection,validateFullPngRasterDecode} from './openai-image-generation-integration.js';

const identifier=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/);
const approvalSchema=z.object({
 id:identifier,ownerId:identifier,tenantId:identifier,pageConnectionId:identifier,
 pageId:z.string().regex(/^\d+$/),connectionRevision:z.string().min(1),selectionNonce:z.string().min(1),
 promptHash:z.string().regex(/^[a-f0-9]{64}$/),
 caption:z.string().trim().min(1).max(5000),
 generateCaption:z.literal(true).optional(),
 mediaKind:z.literal('REEL').optional(),
 localTime:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
 standingConsent:z.object({
  approved:z.literal(true),approvedAt:z.number().int(),expiresAt:z.number().int(),
  timezone:z.literal('Europe/Bucharest'),maxPostsPerLocalDay:z.literal(1),
 }).strict(),
}).strict();

export function createRecurringFacebookPublisher(input:{
 store:Store;
 cipher:DailyPorts['cipher'];
 customerId:string;
 loadApproval:(consentRef:string)=>unknown;
 pageTokens:FacebookTrustedPageTokenResolver;
 provider:VerifiedFacebookPostNowDependencies['provider'];
 resolveServerCredential:Lcg6GenerationDependencies['resolveServerCredential'];
 fetchImpl?:typeof fetch;
 generateCaption?:(input:{brief:string;localDate:string})=>Promise<string>;
 clock?:()=>Date;
 graphVersion?:string;
}){
 const {store}=input;
 const now=()=>input.clock?.()??new Date();
 function approval(tenantId:string,userId:string,ref:string){
  if(tenantId!==input.customerId||tenantId!==userId)throw Error('RECURRING_CUSTOMER_DENIED');
  assertFacebookCustomerPilotEffectsAllowed(store);
  const user=store.user(userId);
  if(!user||user.disabled||user.role!=='USER')throw Error('RECURRING_CUSTOMER_DENIED');
  const a=approvalSchema.parse(input.loadApproval(ref));
  assertActiveCustomerFacebookLoopConsent(a);
  if(a.id!==ref||a.tenantId!==tenantId||a.ownerId!==userId||a.standingConsent.expiresAt<=now().getTime())
   throw Error('RECURRING_APPROVAL_REQUIRED');
  const selection=readSchedulePageSelection(store,tenantId,userId,a.pageConnectionId);
  if(selection.pageId!==a.pageId||selection.connectionRevision!==a.connectionRevision||selection.selectionNonce!==a.selectionNonce)
   throw Error('RECURRING_PAGE_SELECTION_CHANGED');
  return a;
 }
 type Due=Parameters<DailyPorts['authorizeOccurrence']>[0];
 function checkClaim(args:Due){
  const a=approval(args.tenantId,args.userId,args.consentRef);
  const loop=store.get('facebook-customer-daily-loops',args.loopId);
  const day=store.get('facebook-customer-daily-occurrences',args.occurrenceId);
  if(!loop||loop.state!=='ACTIVE'||loop.tenantId!==args.tenantId||loop.userId!==args.userId||
   loop.version!==args.version||loop.pageConnectionId!==args.pageConnectionId||loop.consentRef!==args.consentRef||
   loop.localTime!==args.localTime||a.localTime!==args.localTime||loop.promptHash!==a.promptHash||
   a.pageConnectionId!==args.pageConnectionId||!day||day.state!=='CLAIMED'||day.loopId!==loop.id||
   day.version!==args.version||day.tenantId!==args.tenantId||day.userId!==args.userId||day.localDate!==args.localDate)
   throw Error('RECURRING_CLAIM_CHANGED');
  return a;
 }
 const engine=new DailyFacebookLoopEngine(store,{
  cipher:input.cipher,
  async authorizeCreate(p,args){
   const a=approval(p.tenantId,p.userId,args.consentRef);
   return a.pageConnectionId===args.pageConnectionId&&a.promptHash===args.promptHash&&a.localTime===args.localTime;
  },
  async authorizeOccurrence(args){checkClaim(args);return true;},
  async publish(args){
   let command:Parameters<typeof input.provider.publishNow>[1];
   let binding:Awaited<ReturnType<typeof input.pageTokens.resolveCurrentPageToken>>;
   let reel:Parameters<typeof publishRecurringReel>[0]|undefined;
   try{
    const approved=checkClaim(args);
    const approvalSnapshot=JSON.stringify(approved);
    const stillApproved=()=>{
     const current=checkClaim(args);
     if(JSON.stringify(current)!==approvalSnapshot)throw Error('RECURRING_APPROVAL_CHANGED');
    };
    if(createHash('sha256').update(args.prompt).digest('hex')!==approved.promptHash)
     throw Error('RECURRING_PROMPT_CHANGED');
    binding=await input.pageTokens.resolveCurrentPageToken({
     tenantId:args.tenantId,userId:args.userId,pageConnectionId:args.pageConnectionId,
     pageId:approved.pageId,connectionRevision:approved.connectionRevision,
    });
    stillApproved();
    let caption=approved.caption;
    if(approved.generateCaption){
     if(!input.generateCaption)throw Error('RECURRING_CAPTION_PROVIDER_REQUIRED');
     caption=(await input.generateCaption({brief:approved.caption,localDate:args.localDate})).trim();
     if(caption.length<12||caption.length>500||/[\x00-\x08\x0b-\x1f\x7f]/.test(caption)||
      /https?:|www\.|[<>`]/i.test(caption))throw Error('RECURRING_CAPTION_INVALID');
     stillApproved();
    }
    const generator=createLcg6OpenAIImagesAdapter({
     enabled:true,resolveServerCredential:input.resolveServerCredential,
     // The engine atomically claims this occurrence before entering this port.
     reserveAttempt:async()=>{stillApproved();return true;},
     fetchImpl:(url,init)=>{stillApproved();return (input.fetchImpl??fetch)(url,init);},
    });
    const image=await generator.generate({
     tenantId:args.tenantId,subjectId:args.userId,requestId:args.occurrenceId,prompt:args.prompt,
    });
    validateFullPngRasterDecode(image.bytes);
    await input.pageTokens.assertResolvedPageTokenCurrent(binding);
    stillApproved();
    if(approved.mediaKind==='REEL'){
     if(!input.graphVersion)throw Error('RECURRING_REEL_PROVIDER_REQUIRED');
     const bytes=await renderRecurringReel(image.bytes);
     stillApproved();
     reel={store,provider:new FacebookReelsProvider(input.graphVersion,input.fetchImpl),bytes,caption,
      occurrenceId:args.occurrenceId,tenantId:args.tenantId,pageToken:binding.pageToken,
      authorizeMutation:async()=>{
       await input.pageTokens.assertResolvedPageTokenCurrent(binding);
       stillApproved();
      }};
    }
    command={tenantId:args.tenantId,pageId:approved.pageId,commandId:args.occurrenceId,
     mode:'NOW',caption,
     media:{tenantId:args.tenantId,kind:'IMAGE',mimeType:'image/png',filename:'daily.png',bytes:image.bytes}};
   }catch{
    return {state:'NOT_PUBLISHED'};
   }
   if(reel)return publishRecurringReel(reel);
   const receipt=await input.provider.publishNow(binding,command);
   if(receipt.state==='PUBLISHED'&&receipt.providerPostRef)
    return {state:'PUBLISHED',providerPostId:receipt.providerPostRef};
   return {state:receipt.state==='FAILED'||receipt.state==='NEEDS_REAUTH'?'NOT_PUBLISHED':'UNCERTAIN'};
  },
 },{enabled:true,maxLoopsPerTenant:Infinity,requireUniqueConsent:true,maxLatenessMinutes:15,clock:input.clock});
 return {engine,resolveStandingConsent:(principal:{tenantId:string;subjectId:string},ref:string)=>
  approval(principal.tenantId,principal.subjectId,ref)};
}
