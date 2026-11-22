import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

const exec=promisify(execFile);

export async function normalizeInstagramJpeg(bytes:Buffer,contentType:string){
 if(!['image/png','image/jpeg'].includes(contentType)||bytes.length>8_000_000)throw Error('INSTAGRAM_IMAGE_FORMAT_DENIED');
 const dir=await mkdtemp(join(tmpdir(),'starli-ig-image-'));
 try{
  const source=join(dir,contentType==='image/png'?'source.png':'source.jpg'),out=join(dir,'image.jpg');
  await writeFile(source,bytes,{mode:0o600});
  await exec('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-threads','2',
   '-f','image2','-i',source,'-vf',
   'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2',
   '-frames:v','1','-threads','2','-q:v','3',out],{timeout:15_000,maxBuffer:32*1024});
  const info=await stat(out);
  if(info.size<12||info.size>8_000_000)throw Error('INSTAGRAM_JPEG_INVALID');
  return await readFile(out);
 }finally{await rm(dir,{recursive:true,force:true});}
}
