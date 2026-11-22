import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,openSync,readSync,realpathSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import type {Store} from '../store.js';

/** Server-only bridge from a completed customer render to sealed MP4 bytes.
 * Resolve customer identity from trusted MCP auth before calling. */
export function readOwnedVideoRender(store:Pick<Store,'get'|'user'>,renderRoot:string,owner:{tenantId:string;userId:string},ref:string){
 if(!isAbsolute(renderRoot)||!/^vrnd-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(ref)||
  owner.tenantId!==owner.userId)throw Error('VIDEO_RENDER_UNAVAILABLE');
 const account=store.user(owner.userId);
 const render=store.get('video-renders',ref);
 const project=render&&store.get('video-projects',render.videoProjectId);
 if(!account||account.role!=='USER'||account.disabled||!render||render.ownerId!==owner.userId||
  render.status!=='COMPLETE'||!project||project.ownerId!==owner.userId)
  throw Error('VIDEO_RENDER_UNAVAILABLE');
 const path=join(realpathSync(renderRoot),ref,'output.mp4');
 if(realpathSync(path)!==path||realpathSync(render.outputPath)!==path)throw Error('VIDEO_RENDER_PATH_CHANGED');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=fstatSync(fd);
  if(!stat.isFile()||stat.nlink!==1||stat.size!==render.fileSize||stat.size<12||stat.size>50*1024*1024)
   throw Error('VIDEO_RENDER_SIZE_INVALID');
  const bytes=Buffer.alloc(stat.size);
  let offset=0;
  while(offset<bytes.length){
   const count=readSync(fd,bytes,offset,bytes.length-offset,null);
   if(count===0)throw Error('VIDEO_RENDER_CHANGED');
   offset+=count;
  }
  if(readSync(fd,Buffer.alloc(1),0,1,null)!==0||bytes.subarray(4,8).toString('ascii')!=='ftyp')
   throw Error('VIDEO_RENDER_INVALID');
  return {tenantId:owner.tenantId,ownerUserId:owner.userId,ref,state:'READY' as const,kind:'VIDEO' as const,
   mimeType:'video/mp4' as const,sha256:createHash('sha256').update(bytes).digest('hex'),bytes};
 }finally{closeSync(fd);}
}
