/** Read-only bridge from completed Starli VideoRenderWorker output to a verified
 * customer-scoped MP4 binary. Does not start any render or publish request.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {Store} from '../store.js';
import type {VideoRenderRecord} from '../video/types.js';
import type {FacebookPilotMedia} from './lcg8-provider.js';

/** Minimal ISO BMFF container completeness preflight, NOT codec validation.
 * Require fully bounded top-level atoms including ftyp, moov and populated mdat;
 * ftyp-only or truncated placeholder renders must never be uploaded as READY.
 */
export function hasCompleteMp4Container(data:Uint8Array):boolean{
 if(!(data instanceof Uint8Array)||data.byteLength<40)return false;
 const buf=Buffer.from(data.buffer,data.byteOffset,data.byteLength);
 let pos=0,ftyp=false,moov=false,mdat=false;
 while(pos<buf.length){
  if(buf.length-pos<8)return false;
  const boxType=buf.toString('ascii',pos+4,pos+8);
  let size=buf.readUInt32BE(pos),head=8;
  if(size===1){
   if(buf.length-pos<16)return false;
   const large=buf.readBigUInt64BE(pos+8);
   if(large>BigInt(Number.MAX_SAFE_INTEGER))return false;
   size=Number(large);head=16;
  }else if(size===0){size=buf.length-pos;}
  if(size<head||pos+size>buf.length)return false;
  if(pos===0&&boxType!=='ftyp')return false;
  const payload=size-head;
  if(boxType==='ftyp'){if(pos!==0||payload<8||ftyp)return false;ftyp=true;}
  if(boxType==='moov'){if(payload<8||moov)return false;moov=true;}
  if(boxType==='mdat'){if(payload<4)return false;mdat=true;}
  pos+=size;
 }
 return ftyp&&moov&&mdat&&pos===buf.length;
}

export function completedProgrammaticVideo(store:Store,input:{tenantId:string;renderId:string;storageDir?:string}):FacebookPilotMedia{
 if(!/^[A-Za-z0-9_.:-]{1,120}$/.test(input.tenantId)||!/^vrnd-[a-f0-9-]{1,100}$/.test(input.renderId))throw Error('VIDEO_REF_INVALID');
 const render=store.get('video-renders',input.renderId) as VideoRenderRecord|undefined;
 if(!render||render.ownerId!==input.tenantId)throw Error('VIDEO_TENANT_DENIED');
 if(render.status!=='COMPLETE'||!render.outputPath)throw Error('VIDEO_NOT_COMPLETE');
 const base=path.resolve(input.storageDir||process.env.VIDEO_STORAGE_DIR||path.resolve(process.cwd(),'data','video'));
 const expected=path.join(base,'renders',input.renderId,'output.mp4');
 if(path.resolve(render.outputPath)!==expected)throw Error('VIDEO_PATH_UNTRUSTED');
 let stat:fs.Stats;
 try{
  stat=fs.lstatSync(expected);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<12||stat.size>100_000_000)throw Error('VIDEO_FILE_INVALID');
  if(fs.realpathSync(expected)!==expected)throw Error('VIDEO_PATH_UNTRUSTED');
 }catch(error){
  if(error instanceof Error&&['VIDEO_FILE_INVALID','VIDEO_PATH_UNTRUSTED'].includes(error.message))throw error;
  throw Error('VIDEO_FILE_UNAVAILABLE');
 }
 const bytes=fs.readFileSync(expected);
 // A file with only ftyp is a placeholder, not a completed MP4.
 if(!hasCompleteMp4Container(bytes))throw Error('VIDEO_FORMAT_INVALID');
 return {kind:'VIDEO',mimeType:'video/mp4',filename:`${input.renderId}.mp4`,tenantId:input.tenantId,bytes};
}
