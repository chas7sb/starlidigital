import {readBoundedGraphBody} from './lcg8-provider.js';

type Write<T>={state:'ACCEPTED';value:T}|{state:'REJECTED'|'UNCERTAIN'};
const id=/^[0-9]{1,30}$/;
function record(value:unknown):Record<string,unknown>{
 return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

/** Server-side Reel transport. Each mutation requires its own durable claim
 * and freshly validated Page binding at the caller. */
export class FacebookReelsProvider {
 constructor(private readonly version:string,private readonly fetcher:typeof fetch=fetch){
  if(!/^v[0-9]{1,2}\.[0-9]{1,2}$/.test(version))throw Error('INVALID_GRAPH_VERSION');
 }

 private async request(url:string,token:string,init?:RequestInit){
  if(typeof token!=='string'||token.length<12||token.length>10000||/[^\x21-\x7e]/.test(token))
   throw Error('INVALID_PAGE_TOKEN');
  const response=await this.fetcher(url,{
   method:'GET',...init,headers:{Authorization:(url.startsWith('https://rupload.facebook.com/')?'OAuth ':'Bearer ')+token,
    ...init?.headers},redirect:'error',signal:AbortSignal.timeout(30_000),
  });
  return {status:response.status,body:record(await readBoundedGraphBody(response,16_384))};
 }

 private async write<T>(url:string,token:string,init:RequestInit,extract:(body:Record<string,unknown>)=>T|undefined):Promise<Write<T>>{
  try{
   const {status,body}=await this.request(url,token,init);
   if(status>=400&&status<500&&record(body.error).code)return {state:'REJECTED'};
   if(status>=200&&status<300&&!body.error){
    const value=extract(body);
    if(value!==undefined)return {state:'ACCEPTED',value};
   }
  }catch{/* Lost acknowledgement remains unresolved. */}
  return {state:'UNCERTAIN'};
 }

 start(token:string){
  return this.write('https://graph.facebook.com/'+this.version+'/me/video_reels',token,
   {method:'POST',body:new URLSearchParams({upload_phase:'start'})},
   body=>typeof body.video_id==='string'&&id.test(body.video_id)?body.video_id:undefined);
 }

 upload(videoId:string,token:string,bytes:Uint8Array){
  if(!id.test(videoId)||bytes.length<12||bytes.length>50*1024*1024||
   Buffer.from(bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw Error('INVALID_REEL_UPLOAD');
  return this.write('https://rupload.facebook.com/video-upload/'+this.version+'/'+videoId,token,
   {method:'POST',headers:{offset:'0',file_size:String(bytes.length),'Content-Type':'application/octet-stream'},
    body:new Uint8Array(bytes)},body=>body.success===true?true:undefined);
 }

 finish(videoId:string,token:string,caption:string){
  if(!id.test(videoId)||typeof caption!=='string'||caption.length>5000||/[\x00-\x08\x0b-\x1f\x7f]/.test(caption))
   throw Error('INVALID_REEL_FINISH');
  return this.write('https://graph.facebook.com/'+this.version+'/me/video_reels',token,{
   method:'POST',body:new URLSearchParams({upload_phase:'finish',video_id:videoId,video_state:'PUBLISHED',description:caption}),
  },body=>body.success===true?true:undefined);
 }

 async inspect(videoId:string,token:string):Promise<'PROCESSING'|'PUBLISHED'|'FAILED'>{
  if(!id.test(videoId))throw Error('INVALID_REEL_ID');
  const {status,body}=await this.request('https://graph.facebook.com/'+this.version+'/'+videoId+'?fields=id,status',token);
  if(status!==200||body.id!==videoId||body.error)throw Error('REEL_STATUS_UNVERIFIED');
  const stages=record(body.status);
  const phases=['uploading_phase','processing_phase','publishing_phase'].map(key=>record(stages[key]).status);
  if(stages.video_status==='error'||phases.includes('error'))return 'FAILED';
  if(stages.video_status==='ready'&&phases.every(phase=>phase==='complete'))return 'PUBLISHED';
  return 'PROCESSING';
 }
}
