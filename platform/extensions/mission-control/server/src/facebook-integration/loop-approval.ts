import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {Store} from '../store.js';
import type {CustomerFacebookHttpTool} from '../customer-mcp/customer-http.js';
import type {DailyFacebookLoopEngine,DailyPorts} from '../facebook-customer/lcg14-recurring-loop.js';
import {readSchedulePageSelection} from './openai-image-generation-integration.js';
import {assertFacebookCustomerPilotEffectsAllowed} from './pilot-effect-stop.js';

const requests='facebook-customer-loop-approval-requests';
export const loopApprovals='facebook-customer-loop-approved-plans';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const opaque=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/);
const planSchema=z.object({
 requestKey:opaque,pageConnectionId:opaque,
 localTime:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
 mediaKind:z.enum(['IMAGE','REEL']),standingPrompt:z.string().trim().min(12).max(1200),
 captionBrief:z.string().trim().min(12).max(1200),
 expiresAt:z.string().datetime({precision:3}),
}).strict();
type Plan=z.infer<typeof planSchema>;
type Request={id:string;ownerId:string;expiresAt:number;sealedPlan:string;planHash:string;
 pageId:string;revision:string;nonce:string};
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function createLoopApprovalFlow(input:{
 store:Store;issuer:string;customerId:string;cipher:DailyPorts['cipher'];csrfKey:Buffer;engine:DailyFacebookLoopEngine;
}){
 const {store}=input;
 const read=(id:string)=>store.get(requests,id) as Request|undefined;
 function current(id:string,ownerId:string){
  const row=read(id);
  if(!row||row.ownerId!==ownerId||ownerId!==input.customerId||row.expiresAt<=Date.now())
   throw Error('LOOP_APPROVAL_REQUEST_UNAVAILABLE');
  const plan=planSchema.parse(JSON.parse(input.cipher.open(row.sealedPlan)));
  if(row.planHash!==digest(JSON.stringify(plan))||Date.parse(plan.expiresAt)<=Date.now())
   throw Error('LOOP_APPROVAL_REQUEST_UNAVAILABLE');
  return {row,plan};
 }
 function csrf(id:string,sessionHash:string){
  return createHmac('sha256',input.csrfKey).update(JSON.stringify(['daily-loop-approval',id,sessionHash])).digest('hex');
 }
 const tool:CustomerFacebookHttpTool={
  name:'social_loop_prepare',
  description:'Prepare a daily image or Reel and return a secure customer confirmation link. The loop activates after the signed-in customer confirms. No operator action is required.',
  inputSchema:planSchema,
  invoke:async(ctx,raw)=>{
   const ownerId=ctx.principal.subjectId;
   if(ownerId!==input.customerId||ctx.principal.tenantId!==ownerId||
    !ctx.principal.permissions.includes('facebook.pages.publish')||!ctx.principal.permissions.includes('facebook.image.generate'))
    throw Error('LOOP_APPROVAL_SCOPE_REQUIRED');
   assertFacebookCustomerPilotEffectsAllowed(store);
   const plan=planSchema.parse(raw);
   const until=Date.parse(plan.expiresAt),now=Date.now();
   if(!Number.isFinite(until)||until<=now||until>now+366*86_400_000)throw Error('LOOP_APPROVAL_EXPIRY_INVALID');
   const page=readSchedulePageSelection(store,ownerId,ownerId,plan.pageConnectionId);
   const id='loop-request-'+digest(JSON.stringify([ownerId,plan.requestKey]));
   const planHash=digest(JSON.stringify(plan));
   store.db.exec('BEGIN IMMEDIATE');
   try{
    const prior=read(id);
    if(prior&&(prior.ownerId!==ownerId||prior.planHash!==planHash||
      prior.pageId!==page.pageId||prior.revision!==page.connectionRevision||prior.nonce!==page.selectionNonce))
     throw Error('LOOP_APPROVAL_REQUEST_CONFLICT');
    if(!prior)store.put(requests,{id,ownerId,expiresAt:now+15*60_000,planHash,sealedPlan:input.cipher.seal(JSON.stringify(plan)),
     pageId:page.pageId,revision:page.connectionRevision,nonce:page.selectionNonce},ownerId);
    store.db.exec('COMMIT');
   }catch(error){store.db.exec('ROLLBACK');throw error;}
   return {state:'AWAITING_CUSTOMER_APPROVAL',approvalUrl:new URL('/customer/oauth/authorize?loop_approval='+id,input.issuer).href};
  },
 };
 return {
  tool,
  render(id:string,ownerId:string,sessionHash:string){
   const {row,plan}=current(id,ownerId);
   return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
   <title>Approve daily publishing</title><main><h1>Approve daily Facebook publishing</h1>
   <p>Page ${escape(row.pageId)} · ${plan.mediaKind} · ${escape(plan.localTime)} Europe/Bucharest · Ends ${escape(plan.expiresAt)} (UTC).</p>
   <p>This authorizes one daily post for this loop, including paid OpenAI image generation and an Outlier caption. You can pause or cancel it from Customer MCP.</p>
   <h2>Image brief</h2><p>${escape(plan.standingPrompt)}</p><h2>Caption brief</h2><p>${escape(plan.captionBrief)}</p>
   <form method="post"><input type="hidden" name="csrf_token" value="${csrf(id,sessionHash)}">
   <button type="submit" name="decision" value="allow">Approve and activate daily loop</button></form></main></html>`;
  },
  async approve(id:string,ownerId:string,sessionHash:string,submitted:string){
   if(!/^[a-f0-9]{64}$/.test(submitted)||!timingSafeEqual(Buffer.from(submitted),Buffer.from(csrf(id,sessionHash))))
    throw Error('LOOP_APPROVAL_CSRF_INVALID');
   const {row,plan}=current(id,ownerId);
   assertFacebookCustomerPilotEffectsAllowed(store);
   const selected=readSchedulePageSelection(store,ownerId,ownerId,plan.pageConnectionId);
   if(selected.pageId!==row.pageId||selected.connectionRevision!==row.revision||selected.selectionNonce!==row.nonce)
    throw Error('LOOP_APPROVAL_PAGE_CHANGED');
   const consentRef='loop-consent-'+digest(id);
   const approved={
    id:consentRef,ownerId,tenantId:ownerId,pageConnectionId:plan.pageConnectionId,...selected,
    promptHash:digest(plan.standingPrompt),localTime:plan.localTime,caption:plan.captionBrief,generateCaption:true,
    ...(plan.mediaKind==='REEL'?{mediaKind:'REEL'}:{}),
    standingConsent:{approved:true,approvedAt:Date.now(),expiresAt:Date.parse(plan.expiresAt),
     timezone:'Europe/Bucharest',maxPostsPerLocalDay:1},
   };
   store.db.prepare('INSERT OR IGNORE INTO records(collection,id,owner,payload) VALUES(?,?,?,?)')
    .run(loopApprovals,consentRef,ownerId,JSON.stringify(approved));
   return input.engine.create({tenantId:ownerId,userId:ownerId,audience:'customer-mcp',commandId:id},
    {requestKey:id,pageConnectionId:plan.pageConnectionId,consentRef,standingPrompt:plan.standingPrompt,localTime:plan.localTime});
  },
 };
}
