/** Server-only Instagram with Facebook Login transport. The caller owns durable
 * claims, tenant-bound credentials and the short-lived media delivery grant. */
import {readBoundedGraphBody} from '../facebook-pilot/lcg8-provider.js';

const numericId=/^[0-9]{1,30}$/;
function id(value:unknown):string {
 if(typeof value!=='string'||!numericId.test(value))throw Error('INVALID_INSTAGRAM_ID');
 return value;
}
function record(value:unknown):Record<string,unknown>{
 return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

export type InstagramContainerStatus='IN_PROGRESS'|'FINISHED'|'ERROR'|'EXPIRED'|'PUBLISHED';
export type InstagramWriteReceipt=
 | {state:'ACCEPTED';id:string}
 | {state:'REJECTED'}
 | {state:'UNCERTAIN'};

export class InstagramGraphProvider {
 private readonly origin:string;
 constructor(private readonly graphVersion:string,mediaOrigin:string,private readonly fetcher:typeof fetch=fetch,
  private readonly login:'facebook'|'instagram'='facebook'){
  if(!/^v[0-9]{1,2}\.[0-9]{1,2}$/.test(graphVersion))throw Error('INVALID_GRAPH_VERSION');
  const url=new URL(mediaOrigin);
  if(url.protocol!=='https:'||url.origin!==mediaOrigin)throw Error('INVALID_INSTAGRAM_MEDIA_ORIGIN');
  this.origin=url.origin;
 }

 private async request(path:string,token:string,query?:URLSearchParams,form?:URLSearchParams){
  if(typeof token!=='string'||token.length<12||token.length>10000||/[^\x21-\x7e]/.test(token))throw Error('INVALID_INSTAGRAM_TOKEN');
  const host=this.login==='instagram'?'graph.instagram.com':'graph.facebook.com';
  const url=new URL('https://'+host+'/'+this.graphVersion+'/'+path);
  if(query)url.search=query.toString();
  const response=await this.fetcher(url,{
   method:form?'POST':'GET',headers:{Authorization:'Bearer '+token},
   ...(form?{body:form}:{}),redirect:'error',signal:AbortSignal.timeout(15_000),
  });
  return {status:response.status,body:record(await readBoundedGraphBody(response,16_384))};
 }

 async directAccount(token:string):Promise<string>{
  if(this.login!=='instagram')throw Error('INSTAGRAM_DIRECT_LOGIN_REQUIRED');
  const {status,body}=await this.request('me',token,new URLSearchParams({fields:'user_id,username'}));
  if(status!==200||body.error||typeof body.username!=='string'||!body.username)
   throw Error('INSTAGRAM_DIRECT_ACCOUNT_UNVERIFIED');
  return id(body.user_id);
 }

 async linkedAccount(pageId:string,token:string):Promise<string>{
  if(this.login!=='facebook')throw Error('INSTAGRAM_FACEBOOK_LOGIN_REQUIRED');
  const {status,body}=await this.request(id(pageId),token,new URLSearchParams({fields:'id,instagram_business_account{id}'}));
  if(status!==200||body.error||body.id!==pageId)throw Error('INSTAGRAM_PAGE_BINDING_UNVERIFIED');
  return id(record(body.instagram_business_account).id);
 }

 private async write(path:string,token:string,form:URLSearchParams):Promise<InstagramWriteReceipt>{
  try{
   const {status,body}=await this.request(path,token,undefined,form);
   if(status>=400&&status<500&&record(body.error).code)return {state:'REJECTED'};
   if(status>=200&&status<300&&!body.error&&typeof body.id==='string'&&numericId.test(body.id))
    return {state:'ACCEPTED',id:body.id};
  }catch{/* Unconfirmed mutation. Caller must preserve the claim and inspect. */}
  return {state:'UNCERTAIN'};
 }

 async createContainer(input:{accountId:string;token:string;mediaUrl:string;kind:'IMAGE'|'REEL';caption:string}){
  const account=id(input.accountId);
  const url=new URL(input.mediaUrl);
  if(url.origin!==this.origin||url.username||url.password||url.hash||url.search||
   !/^\/customer\/instagram\/media\/[A-Za-z0-9_-]{43}$/.test(url.pathname))
   throw Error('UNTRUSTED_INSTAGRAM_MEDIA_URL');
  if(typeof input.caption!=='string'||input.caption.length>2200||/[\x00-\x08\x0b-\x1f\x7f]/.test(input.caption))
   throw Error('INVALID_INSTAGRAM_CAPTION');
  if(input.kind!=='IMAGE'&&input.kind!=='REEL')throw Error('INVALID_INSTAGRAM_MEDIA_KIND');
  return this.write(account+'/media',input.token,new URLSearchParams({
   caption:input.caption,
   ...(input.kind==='IMAGE'?{image_url:url.href}:{video_url:url.href,media_type:'REELS'}),
  }));
 }

 async containerStatus(containerId:string,token:string):Promise<InstagramContainerStatus>{
  const {status,body}=await this.request(id(containerId),token,new URLSearchParams({fields:'id,status_code'}));
  const state=body.status_code;
  if(status!==200||body.error||body.id!==containerId||
   (state!=='IN_PROGRESS'&&state!=='FINISHED'&&state!=='ERROR'&&state!=='EXPIRED'&&state!=='PUBLISHED'))
   throw Error('INSTAGRAM_CONTAINER_STATUS_UNVERIFIED');
  return state;
 }

 /** Invoke only after persisting a unique publish claim for a ready container. */
 async publishContainer(accountId:string,containerId:string,token:string){
  return this.write(id(accountId)+'/media_publish',token,new URLSearchParams({creation_id:id(containerId)}));
 }
}
