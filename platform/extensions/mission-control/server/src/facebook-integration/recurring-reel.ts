import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import type {Store} from '../store.js';
import type {FacebookReelsProvider} from '../facebook-pilot/reels-provider.js';

const exec=promisify(execFile);

export async function renderRecurringReel(image:Buffer):Promise<Buffer>{
 const dir=await mkdtemp(join(tmpdir(),'starli-reel-'));
 try{
  const source=join(dir,'source.png'),output=join(dir,'reel.mp4');
  await writeFile(source,image,{mode:0o600});
  await exec('/usr/bin/ffmpeg',[
   '-hide_banner','-loglevel','error','-nostdin','-threads','2','-filter_threads','1',
   '-i',source,'-vf',
   "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='1+on*0.00055':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=144:s=540x960:fps=24",
   '-frames:v','144','-an','-c:v','libx264','-threads','2','-preset','fast','-pix_fmt','yuv420p',
   '-movflags','+faststart','-fs','10000000',output,
  ],{timeout:45_000,maxBuffer:64*1024});
  const info=await stat(output);
  if(!info.isFile()||info.size<12||info.size>=10_000_000)throw Error('RECURRING_REEL_RENDER_INVALID');
  return await readFile(output);
 }finally{await rm(dir,{recursive:true,force:true});}
}

type ReelResult={state:'PUBLISHED'|'NOT_PUBLISHED'|'UNCERTAIN';providerPostId?:string};
const collection='facebook-customer-recurring-reel-attempts';

export async function publishRecurringReel(input:{
 store:Store;provider:Pick<FacebookReelsProvider,'start'|'upload'|'finish'|'inspect'>;
 occurrenceId:string;tenantId:string;pageToken:string;caption:string;bytes:Buffer;
 authorizeMutation:()=>Promise<void>;wait?:()=>Promise<unknown>;
}):Promise<ReelResult>{
 const {store,provider,occurrenceId,tenantId,pageToken}=input;
 let videoId:string|undefined;
 const save=(state:string)=>store.put(collection,{id:occurrenceId,tenantId,state,videoId,updatedAt:new Date().toISOString()},tenantId);
 if(store.get(collection,occurrenceId))return {state:'UNCERTAIN'};
 const failed=(state:'REJECTED'|'UNCERTAIN'):ReelResult=>{
  save(state);
  return {state:state==='REJECTED'?'NOT_PUBLISHED':'UNCERTAIN'};
 };
 await input.authorizeMutation();
 if(store.get(collection,occurrenceId))return {state:'UNCERTAIN'};
 save('STARTING');
 const started=await provider.start(pageToken);
 if(started.state!=='ACCEPTED')return failed(started.state);
 videoId=started.value;
 save('STARTED');
 try{await input.authorizeMutation();}
 catch{return failed('REJECTED');}
 save('UPLOADING');
 const uploaded=await provider.upload(videoId,pageToken,input.bytes);
 if(uploaded.state!=='ACCEPTED')return failed(uploaded.state);
 save('UPLOADED');
 try{await input.authorizeMutation();}
 catch{return failed('REJECTED');}
 save('FINISHING');
 const finished=await provider.finish(videoId,pageToken,input.caption);
 if(finished.state!=='ACCEPTED')return failed(finished.state);
 save('PROCESSING');
 for(let attempt=0;attempt<6;attempt++){
  if(attempt>0)await (input.wait?.()??delay(5000));
  const state=await provider.inspect(videoId,pageToken);
  if(state==='PUBLISHED'){
   save('PUBLISHED');
   return {state:'PUBLISHED',providerPostId:videoId};
  }
  if(state==='FAILED')return failed('REJECTED');
 }
 return failed('UNCERTAIN');
}
