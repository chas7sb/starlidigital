import {hasCompleteMp4Container} from './lcg8-programmatic-video.js';
import {createHash} from 'node:crypto';
/** Facebook Pages-only provider boundary for the isolated Velour customer MCP pilot.
 * The caller (LCG1/2/3/4) authenticates customer, verifies Page rights, persists an
 * idempotency reservation and explicit command before invoking this adapter.
 * No production registration or implicit retry exists in this module.
 */
export type FacebookPilotMedia = Readonly<{
  kind:'IMAGE'|'VIDEO'; bytes:Uint8Array; mimeType:'image/png'|'image/jpeg'|'video/mp4';
  filename:string; tenantId:string;
}>;
export type FacebookPageBinding = Readonly<{
  tenantId:string; pageId:string; pageToken:string;
  // Trusted Page-inventory layer issues this result after checking Page CREATE_CONTENT.
  verifiedPageId:string; canCreateContent:boolean; scopes:readonly string[];
}>;
export type FacebookPilotCommand = Readonly<{
  tenantId:string; pageId:string; commandId:string;
  mode:'NOW'; caption:string; media?:FacebookPilotMedia;
}>;
export type FacebookPilotReceipt = Readonly<{
  state:'PUBLISHED'|'FAILED'|'NEEDS_REAUTH'|'UNCERTAIN';
  providerPostRef?:string; providerPostUrl?:string; errorCode?:string;
}>;
export type FacebookGraphRequest = Readonly<{
  path:string; token:string; fields:Readonly<Record<string,string>>;
  media?:FacebookPilotMedia;
}>;
export type FacebookGraphResponse = Readonly<{
  httpStatus:number; body:unknown;
}>;
export type FacebookManagedPage = Readonly<{id:string;name:string;tasks:readonly string[]}>;
export interface FacebookPageInventoryReader {
 getManagedPageBatch(input:{userToken:string;cursor?:string}):Promise<FacebookGraphResponse>;
}
/** Read-only managed-Page inventory: never return embedded Page tokens. */
export async function listManagedFacebookPages(reader:FacebookPageInventoryReader,userToken:string):Promise<FacebookManagedPage[]>{
 if(typeof userToken!=='string'||!userToken.trim()||userToken.length>10000)throw Error('OAUTH_TOKEN_UNAVAILABLE');
 const pages:FacebookManagedPage[]=[];
 const ids=new Set<string>();
 const cursors=new Set<string>();
 let cursor:string|undefined;
 for(let batch=0;batch<3;batch++){
  let response:FacebookGraphResponse;
  try{response=await reader.getManagedPageBatch({userToken,cursor});}catch{throw Error('PAGE_INVENTORY_UNAVAILABLE');}
  if(response.httpStatus!==200||!response.body||typeof response.body!=='object')throw Error('PAGE_INVENTORY_UNAVAILABLE');
  const payload=response.body as Record<string,unknown>;
  if(payload.error||!Array.isArray(payload.data))throw Error('PAGE_INVENTORY_UNAVAILABLE');
  for(const item of payload.data){
   if(!item||typeof item!=='object')continue;
   const entry=item as Record<string,unknown>;
   if(!/^[0-9]{1,30}$/.test(String(entry.id||''))||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>200||ids.has(String(entry.id)))continue;
   ids.add(String(entry.id));
   pages.push({id:String(entry.id),name:entry.name,tasks:Array.isArray(entry.tasks)?entry.tasks.filter((t):t is string=>typeof t==='string'&&/^[A-Z_]{1,50}$/.test(t)).slice(0,20):[]});
   if(pages.length>=100)return pages;
  }
  const paging=payload.paging;
  const next=paging&&typeof paging==='object'?(paging as Record<string,unknown>).cursors:undefined;
  const after=next&&typeof next==='object'?(next as Record<string,unknown>).after:undefined;
  if(after===undefined||after===null||after==='')return pages;
  if(typeof after!=='string'||!/^[A-Za-z0-9_=-]{1,200}$/.test(after)||cursors.has(after))throw Error('PAGE_CURSOR_UNTRUSTED');
  cursors.add(after);cursor=after;
 }
 throw Error('PAGE_INVENTORY_PAGINATION_LIMIT');
}

/** A read-only Graph lookup is distinct from the SINGLE POST attempt.
 * The only accepted path is the exact post ID returned by the provider; the
 * caller must not choose a URL, tenant or different post ID from MCP input.
 */
export interface FacebookPostVerificationReader {
 getPostDetails(input:{postId:string;pageToken:string}):Promise<FacebookGraphResponse>;
}
/** Verify publication metadata without creating a second Facebook post.
 * The initial upload receipt must have come from a previously authenticated,
 * durable one-attempt publisher. A failed read never justifies replaying POST.
 */
export async function verifyFacebookPhotoPostReceipt(
 reader:FacebookPostVerificationReader,binding:FacebookPageBinding,initial:FacebookPilotReceipt,
):Promise<FacebookPilotReceipt>{
 const postId=initial?.providerPostRef;
 if(initial?.state!=='PUBLISHED'||typeof postId!=='string'||!pageIdPattern.test(binding?.pageId)||!new RegExp(`^${binding.pageId}_[0-9]{1,30}$`).test(postId)||
  binding?.verifiedPageId!==binding.pageId||!binding.canCreateContent||
  !Array.isArray(binding.scopes)||!binding.scopes.includes('pages_manage_posts')||
  !textWithin(binding.pageToken,10000))return {state:'UNCERTAIN',errorCode:'POST_VERIFICATION_UNAVAILABLE'};
 try{
  const result=await reader.getPostDetails({postId,pageToken:binding.pageToken});
  if(result.httpStatus!==200||!result.body||typeof result.body!=='object')throw Error('UNVERIFIED');
  const body=result.body as Record<string,unknown>;
  const owner=body.from&&typeof body.from==='object'?(body.from as Record<string,unknown>).id:undefined;
  if(body.id!==postId||owner!==binding.pageId||typeof body.permalink_url!=='string')throw Error('UNVERIFIED');
  const link=new URL(body.permalink_url);
  if(link.protocol!=='https:'||!['facebook.com','www.facebook.com'].includes(link.hostname)||
    link.username||link.password||link.port||link.hash||link.pathname==='/'||link.href.length>2048)throw Error('UNVERIFIED');
  return {state:'PUBLISHED',providerPostRef:postId,providerPostUrl:link.href};
 }catch{return {state:'UNCERTAIN',errorCode:'POST_VERIFICATION_UNAVAILABLE',providerPostRef:postId};}
}

export interface FacebookGraphTransport {
  /** Exactly one remote POST attempt; must not perform retries. */
  post(request:FacebookGraphRequest):Promise<FacebookGraphResponse>;
}

const pageIdPattern=/^[0-9]{1,30}$/;
const commandPattern=/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/;
function textWithin(text:unknown,max:number):text is string{return typeof text==='string'&&text.length<=max&&text.trim().length>0;}
function safeId(value:unknown):value is string{return typeof value==='string'&&/^[0-9_]{1,100}$/.test(value);}
function facebookError(body:unknown):{code?:number;type?:string}|undefined{
 if(!body||typeof body!=='object'||!('error' in body))return;
 const err=(body as {error:unknown}).error;
 if(!err||typeof err!=='object')return;
 const data=err as Record<string,unknown>;
 return {code:typeof data.code==='number'?data.code:undefined,type:typeof data.type==='string'?data.type:undefined};
}

export class FacebookPagesPilotAdapter {
 constructor(private readonly transport:FacebookGraphTransport){}
 async publishNow(binding:FacebookPageBinding,cmd:FacebookPilotCommand):Promise<FacebookPilotReceipt>{
  if(!binding||!cmd||!textWithin(binding.tenantId,120)||!textWithin(cmd.tenantId,120)||binding.tenantId!==cmd.tenantId)throw Error('TENANT_SCOPE_DENIED');
  if(!pageIdPattern.test(binding.pageId)||binding.pageId!==binding.verifiedPageId||cmd.pageId!==binding.pageId||!binding.canCreateContent)throw Error('PAGE_SCOPE_DENIED');
  if(!Array.isArray(binding.scopes)||!['pages_show_list','pages_read_engagement','pages_manage_posts'].every(scope=>binding.scopes.includes(scope))||!textWithin(binding.pageToken,10000)||/[\x00-\x1f\x7f]/.test(binding.pageToken))throw Error('PAGE_PERMISSION_DENIED');
  if(cmd.mode!=='NOW'||!commandPattern.test(cmd.commandId)||typeof cmd.caption!=='string'||cmd.caption.length>5000||(!cmd.caption.trim()&&!cmd.media))throw Error('INVALID_PUBLISH_COMMAND');
  const media=cmd.media;
  if(media){
   if(media.tenantId!==cmd.tenantId||!(media.bytes instanceof Uint8Array)||media.bytes.byteLength<8||media.bytes.byteLength>(media.kind==='VIDEO'?100_000_000:8_388_608))throw Error('INVALID_OWNED_MEDIA');
   if(!/^[A-Za-z0-9_.-]{1,150}$/.test(media.filename)||media.filename==='.'||media.filename==='..')throw Error('INVALID_MEDIA_FILENAME');
   if(media.kind==='VIDEO'&&(media.mimeType!=='video/mp4'||!media.filename.toLowerCase().endsWith('.mp4')||!hasCompleteMp4Container(media.bytes)))throw Error('INVALID_MEDIA_KIND');
   if(media.kind==='IMAGE'){
    const png=media.mimeType==='image/png'&&media.filename.toLowerCase().endsWith('.png')&&media.bytes.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]);
    const jpeg=media.mimeType==='image/jpeg'&&/\.jpe?g$/i.test(media.filename)&&media.bytes[0]===255&&media.bytes[1]===216&&media.bytes[2]===255;
    if(!png&&!jpeg)throw Error('INVALID_MEDIA_KIND');
   }
  }
  const path=`/${binding.pageId}/${media?.kind==='VIDEO'?'videos':media?.kind==='IMAGE'?'photos':'feed'}`;
  const fields={...(cmd.caption.trim()?{description:cmd.caption.trim()}:{}),published:'true'};
  // Meta expects `message` for /feed and /photos, `description` for /videos.
  const args=media?.kind==='VIDEO'?fields:{...(cmd.caption.trim()?{message:cmd.caption.trim()}:{}),published:'true'};
  let result:FacebookGraphResponse;
  try{result=await this.transport.post({path,token:binding.pageToken,fields:args,media});}
  catch{return {state:'UNCERTAIN',errorCode:'PROVIDER_OUTCOME_UNKNOWN'};}
  // Any 5xx can follow a committed provider write: never auto-replay it.
  if(result.httpStatus>=500)return {state:'UNCERTAIN',errorCode:'PROVIDER_OUTCOME_UNKNOWN'};
  const error=facebookError(result.body);
  if(error){
   if(error.code===190||error.code===102)return {state:'NEEDS_REAUTH',errorCode:'PAGE_TOKEN_INVALID'};
   if(error.code===200||error.code===10)return {state:'FAILED',errorCode:'PAGE_PERMISSION_DENIED'};
   if([4,17,32,613].includes(error.code||0))return {state:'FAILED',errorCode:'PROVIDER_RATE_LIMITED'};
   return {state:'FAILED',errorCode:'PROVIDER_REJECTED'};
  }
  if(result.httpStatus===401)return {state:'NEEDS_REAUTH',errorCode:'PAGE_TOKEN_INVALID'};
  if(result.httpStatus===403)return {state:'FAILED',errorCode:'PAGE_PERMISSION_DENIED'};
  if(result.httpStatus<200||result.httpStatus>=300)return {state:'FAILED',errorCode:'PROVIDER_REJECTED'};
  const body=result.body&&typeof result.body==='object'?result.body as Record<string,unknown>:{};
  // A photo upload ID is not necessarily the resulting Page post ID; a video
  // upload ID alone never proves processing/publishing completed.
  if(media?.kind==='VIDEO')return {state:'UNCERTAIN',errorCode:'VIDEO_STATUS_UNVERIFIED',...(safeId(body.id)?{providerPostRef:body.id}:{})};
  const ref=media?.kind==='IMAGE'?body.post_id:body.id;
  if(!safeId(ref)||!new RegExp(`^${binding.pageId}_[0-9]{1,30}$`).test(ref))return {state:'UNCERTAIN',errorCode:'PROVIDER_RECEIPT_MISSING'};
  return {state:'PUBLISHED',providerPostRef:ref};
 }
}

/** Disabled-by-default actual Graph HTTP transport. Only injected by a trusted pilot
 * orchestrator after OAuth and explicit customer command; tests inject a fake.
 * No token is put in URL, logs, event payload or returned receipt.
 */
export async function readBoundedGraphBody(response:Response,maxBytes:number):Promise<unknown>{
  const stream=response.body;
  if(!stream)return {};
  const reader=stream.getReader();
  const chunks:Uint8Array[]=[];
  let length=0;
  try{
   for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    length+=value.byteLength;
    if(length>maxBytes){await reader.cancel();throw Error('GRAPH_RESPONSE_TOO_LARGE');}
    chunks.push(value);
   }
  }finally{reader.releaseLock();}
  try{return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)),length)));}catch{return {};}
}

export class FacebookGraphHttpTransport implements FacebookGraphTransport {
 constructor(private readonly graphVersion:string,private readonly fetchImpl:typeof fetch){
  if(!/^v[0-9]{1,2}\.[0-9]{1,2}$/.test(graphVersion))throw Error('INVALID_GRAPH_VERSION');
 }
 async getManagedPageBatch(input:{userToken:string;cursor?:string}):Promise<FacebookGraphResponse>{
  if(typeof input.userToken!=='string'||!input.userToken.trim()||input.userToken.length>10000)throw Error('OAUTH_TOKEN_UNAVAILABLE');
  if(input.cursor!==undefined&&!/^[A-Za-z0-9_=-]{1,200}$/.test(input.cursor))throw Error('PAGE_CURSOR_UNTRUSTED');
  const url=new URL(`https://graph.facebook.com/${this.graphVersion}/me/accounts`);
  url.searchParams.set('fields','id,name,tasks');url.searchParams.set('limit','50');
  if(input.cursor)url.searchParams.set('after',input.cursor);
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15_000);
  try{
   const response=await this.fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${input.userToken}`},signal:controller.signal,redirect:'error'});
   return {httpStatus:response.status,body:await readBoundedGraphBody(response,32_768)};
  }finally{clearTimeout(timeout);}
 }
 async getPostDetails(input:{postId:string;pageToken:string}):Promise<FacebookGraphResponse>{
  if(!/^[0-9]{1,30}_[0-9]{1,30}$/.test(input.postId)||!textWithin(input.pageToken,10000)||/[\x00-\x1f\x7f]/.test(input.pageToken))throw Error('INVALID_POST_LOOKUP');
  const url=new URL(`https://graph.facebook.com/${this.graphVersion}/${input.postId}`);
  url.searchParams.set('fields','id,from{id},permalink_url');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15_000);
  try{
   const response=await this.fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${input.pageToken}`},redirect:'error',signal:controller.signal});
   return {httpStatus:response.status,body:await readBoundedGraphBody(response,16_384)};
  }finally{clearTimeout(timeout);}
 }
 async post(request:FacebookGraphRequest):Promise<FacebookGraphResponse>{
  if(!/^\/[0-9]{1,30}\/(?:feed|photos|videos)$/.test(request.path))throw Error('INVALID_GRAPH_PATH');
  const form=new FormData();
  for(const [key,value]of Object.entries(request.fields))form.set(key,value);
  if(request.media)form.set('source',new Blob([new Uint8Array(request.media.bytes)],{type:request.media.mimeType}),request.media.filename);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30_000);
  try{
   const response=await this.fetchImpl(`https://graph.facebook.com/${this.graphVersion}${request.path}`,{
    method:'POST',headers:{Authorization:`Bearer ${request.token}`},body:form,signal:controller.signal,redirect:'error',
   });
   return {httpStatus:response.status,body:await readBoundedGraphBody(response,16_384)};
  }finally{clearTimeout(timeout);}
 }
}

/** Narrow LCG4 -> LCG8 bridge. The caller provides only its AUTHENTICATED
 * identity and opaque identifiers; the trusted ports obtain Page credentials
 * and actual media bytes from LCG2/3/6/VideoRenderWorker on the SERVER.
 * This function is not a durable job runner: LCG4 must reserve one attempt
 * and record UNCERTAIN/no-replay before invoking it.
 */
export interface VerifiedFacebookCustomer {readonly tenantId:string;readonly userId:string}
export interface VerifiedFacebookPageCredential {
 readonly tenantId:string;readonly userId:string;readonly connectionId:string;
 readonly pageId:string;readonly pageToken:string;readonly verifiedPageId:string;
 readonly revision:string;readonly status:'CONNECTED'|'DISCONNECTED'|'REAUTH_REQUIRED';
 readonly expiresAt:string;readonly canCreateContent:boolean;readonly scopes:readonly string[];
}
export interface VerifiedFacebookPrivateMedia {
 readonly tenantId:string;readonly userId:string;readonly ref:string;
 readonly state:'READY'|'REVOKED'|'PROCESSING';readonly kind:'IMAGE'|'VIDEO';
 readonly mimeType:'image/png'|'image/jpeg'|'video/mp4';readonly filename:string;
 readonly bytes:Uint8Array;readonly sha256:string;
}
export interface ServerFacebookPublishPorts {
 /** MUST return a fresh LCG3 selected Page and LCG2 decrypted PAGE token;
  * a caller-provided Page token or chosen Page tasks are never trusted. */
 resolveSelectedPage(input:{tenantId:string;userId:string;connectionId:string;pageId:string}):Promise<VerifiedFacebookPageCredential|undefined>;
 /** MUST reverify LCG6 private media or COMPLETE owned video on every send. */
 readOwnedMedia(input:{tenantId:string;userId:string;mediaRef:string}):Promise<VerifiedFacebookPrivateMedia|undefined>;
}
export interface TrustedFacebookPublishCommand {
 readonly connectionId:string;readonly pageId:string;readonly commandId:string;
 readonly caption:string;readonly mediaRef?:string;
}
/** Safe only after LCG4 has durably reserved the exact authenticated command.
 * This does not itself persist idempotency or invoke a provider twice. */
export async function publishWithServerVerifiedFacebookResources(
 adapter:FacebookPagesPilotAdapter,ports:ServerFacebookPublishPorts,
 principal:VerifiedFacebookCustomer,command:TrustedFacebookPublishCommand,
):Promise<FacebookPilotReceipt>{
 const id=/^[A-Za-z0-9_.:-]{1,160}$/;
 if(!principal||!id.test(principal.tenantId)||!id.test(principal.userId)||principal.tenantId!==principal.userId)throw Error('CUSTOMER_SCOPE_DENIED');
 if(!command||!id.test(command.connectionId)||!pageIdPattern.test(command.pageId)||!commandPattern.test(command.commandId)||
    typeof command.caption!=='string'||command.caption.length>5000||
    (command.mediaRef!==undefined&&(!id.test(command.mediaRef)||command.mediaRef.length>120)))throw Error('INVALID_PUBLISH_COMMAND');
 const page=await ports.resolveSelectedPage({tenantId:principal.tenantId,userId:principal.userId,connectionId:command.connectionId,pageId:command.pageId});
 if(!page||page.tenantId!==principal.tenantId||page.userId!==principal.userId||page.connectionId!==command.connectionId||
    page.pageId!==command.pageId||page.verifiedPageId!==command.pageId||page.status!=='CONNECTED'||
    !id.test(page.revision)||!page.canCreateContent||!page.expiresAt||!Number.isFinite(Date.parse(page.expiresAt))||Date.parse(page.expiresAt)<=Date.now())throw Error('PAGE_SCOPE_DENIED');
 let media:FacebookPilotMedia|undefined;
 if(command.mediaRef){
  const item=await ports.readOwnedMedia({tenantId:principal.tenantId,userId:principal.userId,mediaRef:command.mediaRef});
  if(!item||item.tenantId!==principal.tenantId||item.userId!==principal.userId||item.ref!==command.mediaRef||item.state!=='READY'||
     !(item.bytes instanceof Uint8Array)||item.bytes.byteLength<8||
     !/^[a-f0-9]{64}$/.test(item.sha256)||createHash('sha256').update(item.bytes).digest('hex')!==item.sha256)throw Error('MEDIA_SCOPE_DENIED');
  if(item.kind==='VIDEO'&&!hasCompleteMp4Container(item.bytes))throw Error('MEDIA_SCOPE_DENIED');
  media={tenantId:principal.tenantId,kind:item.kind,mimeType:item.mimeType,filename:item.filename,bytes:item.bytes};
 }
 return adapter.publishNow({tenantId:principal.tenantId,pageId:page.pageId,verifiedPageId:page.verifiedPageId,
  pageToken:page.pageToken,canCreateContent:page.canCreateContent,scopes:page.scopes},
  {tenantId:principal.tenantId,pageId:command.pageId,commandId:command.commandId,mode:'NOW',caption:command.caption,media});
}
