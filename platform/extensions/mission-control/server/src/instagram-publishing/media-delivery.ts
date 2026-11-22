import {createHash,randomBytes} from 'node:crypto';
import {closeSync,constants,fstatSync,mkdirSync,openSync,readSync,unlinkSync,writeFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Store} from '../store.js';

const collection='instagram-customer-media-delivery';
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const capability=/^[A-Za-z0-9_-]{43}$/;
const maxBytes=50*1024*1024;
type Media={id:string;ownerId:string;jobId:string;expiresAt:number;mime:'image/jpeg'|'video/mp4';bytes:number;sha256:string};

/** Only a trusted job resolver may create grants. The public read handler
 * needs only the opaque bearer link and never accepts a filesystem path. */
export class InstagramMediaDelivery {
 private readonly origin:string;
 constructor(private readonly store:Store,private readonly root:string,origin:string,private readonly now=Date.now){
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.origin!==origin||!isAbsolute(root))throw Error('INVALID_INSTAGRAM_MEDIA_CONFIGURATION');
  this.origin=origin;
  mkdirSync(root,{recursive:true,mode:0o700});
 }

 issue(input:{ownerId:string;jobId:string;mime:Media['mime'];bytes:Buffer}){
  const owner=this.store.user(input.ownerId);
  if(!owner||owner.disabled||owner.role!=='USER'||!/^igpub-[a-f0-9]{64}$/.test(input.jobId))
   throw Error('INSTAGRAM_MEDIA_JOB_REQUIRED');
  const job=this.store.get('instagram-customer-publish-jobs',input.jobId);
  if(!job||job.tenantId!==input.ownerId||job.userId!==input.ownerId||job.state!=='QUEUED')
   throw Error('INSTAGRAM_MEDIA_JOB_REQUIRED');
  const bytes=Buffer.from(input.bytes);
  if(bytes.length<12||bytes.length>maxBytes||
   (input.mime==='image/jpeg'?(job.kind!=='IMAGE'||bytes[0]!==0xff||bytes[1]!==0xd8||
    bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9):
    input.mime!=='video/mp4'||job.kind!=='REEL'||bytes.subarray(4,8).toString('ascii')!=='ftyp'))
   throw Error('INVALID_INSTAGRAM_MEDIA');
  const token=randomBytes(32).toString('base64url');
  const id=digest(token);
  const grant:Media={id,ownerId:input.ownerId,jobId:input.jobId,expiresAt:this.now()+15*60_000,
   mime:input.mime,bytes:bytes.length,sha256:digest(bytes)};
  const path=join(this.root,id);
  writeFileSync(path,bytes,{mode:0o600,flag:'wx'});
  try{this.store.put(collection,grant,input.ownerId);}
  catch(e){unlinkSync(path);throw e;}
  return this.origin+'/customer/instagram/media/'+token;
 }

 read(token:string):{mime:Media['mime'];bytes:Buffer}|undefined{
  if(!capability.test(token))return;
  const id=digest(token);
  const grant=this.store.get(collection,id) as Media|undefined;
  if(!grant||grant.expiresAt<=this.now())return;
  const job=this.store.get('instagram-customer-publish-jobs',grant.jobId);
  const owner=this.store.user(grant.ownerId);
  if(!owner||owner.disabled||owner.role!=='USER'||!job||job.userId!==grant.ownerId||
   job.tenantId!==grant.ownerId||!['CREATING','PROCESSING','PUBLISHING'].includes(job.state))return;
  let fd:number|undefined;
  try{
   fd=openSync(join(this.root,id),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   const stat=fstatSync(fd);
   if(!stat.isFile()||stat.nlink!==1||stat.size!==grant.bytes||stat.size>maxBytes)return;
   const bytes=Buffer.alloc(stat.size);
   let offset=0;
   while(offset<bytes.length){
    const count=readSync(fd,bytes,offset,bytes.length-offset,null);
    if(count===0)return;
    offset+=count;
   }
   if(readSync(fd,Buffer.alloc(1),0,1,null)!==0||digest(bytes)!==grant.sha256)return;
   return {mime:grant.mime,bytes};
  }catch{return;}
  finally{if(fd!==undefined)closeSync(fd);}
 }

 /** Meta can fetch a capability directly, including HEAD/range probes. */
 handle(req:IncomingMessage,res:ServerResponse):boolean{
  const prefix='/customer/instagram/media/';
  if(!req.url?.startsWith(prefix))return false;
  const token=req.url.slice(prefix.length);
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'&&req.method!=='HEAD'){
   res.writeHead(405,{Allow:'GET, HEAD'});res.end();return true;
  }
  const media=this.read(token);
  if(!media){res.writeHead(404);res.end();return true;}
  const size=media.bytes.length;
  const headers={'Content-Type':media.mime,'Accept-Ranges':'bytes'};
  let start=0,end=size-1,status=200;
  if(req.headers.range){
   const match=/^bytes=(\d{1,12})-(\d{0,12})$/.exec(req.headers.range);
   start=match?Number(match[1]):size;
   end=match?.[2]?Math.min(Number(match[2]),size-1):size-1;
   if(start>=size||end<start){
    res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return true;
   }
   status=206;
  }
  res.writeHead(status,{...headers,'Content-Length':end-start+1,
   ...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
  res.end(req.method==='HEAD'?undefined:media.bytes.subarray(start,end+1));
  return true;
 }

 purgeExpired(){
  for(const row of this.store.list(collection) as Media[]){
   if(row.expiresAt>this.now()||!/^[a-f0-9]{64}$/.test(row.id))continue;
   try{unlinkSync(join(this.root,row.id));}
   catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')continue;}
   this.store.remove(collection,row.id);
  }
 }
}
