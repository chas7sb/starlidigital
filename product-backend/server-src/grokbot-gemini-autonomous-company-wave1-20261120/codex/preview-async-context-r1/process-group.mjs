import {spawn} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export function processIdentity(pid){
 const raw=readFileSync('/proc/'+pid+'/stat','utf8'),parts=raw.slice(raw.lastIndexOf(')')+2).split(' ');
 return {pid:Number(pid),state:parts[0],parentPid:Number(parts[1]),processGroup:Number(parts[2]),sessionId:Number(parts[3]),startTicks:parts[19]};
}
export function scopedGroup(managed){
 const leader=managed.identity;let live;
 try{live=processIdentity(leader.pid);}catch(e){if(e.code!=='ENOENT'&&e.code!=='ESRCH')return {unknown:true,members:[]};}
 if(live&&(live.startTicks!==leader.startTicks||live.processGroup!==leader.pid||live.sessionId!==leader.pid))return {unknown:true,members:[]};
 const members=[];
 for(const name of readdirSync('/proc')){
  if(!/^\d+$/.test(name))continue;let id;try{id=processIdentity(name);}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')continue;return {unknown:true,members:[]};}
  if(id.processGroup===leader.pid&&id.sessionId===leader.pid){if(BigInt(id.startTicks)<BigInt(leader.startTicks))return {unknown:true,members:[]};members.push(id);}
 }
 return {unknown:false,members};
}
export function spawnScopedProcess(script,args,env){
 const child=spawn(process.execPath,['--max-old-space-size=256','--experimental-transform-types',script,...args],{env:{PATH:'/usr/bin:/bin',...env},detached:true,stdio:['ignore','pipe','pipe']});
 const identity=processIdentity(child.pid);
 if(identity.processGroup!==child.pid||identity.sessionId!==child.pid){child.kill();throw Error('ISOLATED_PROCESS_GROUP_REQUIRED');}
 return {child,identity};
}
export async function stopScopedProcess(managed){
 if(!managed)return {confirmedStopped:true,scope:'OWNED_PROCESS_GROUP'};
 const leader=managed.identity,signals=[];
 for(const [signal,timeout] of [['SIGTERM',3500],['SIGKILL',1500]]){
  let group=scopedGroup(managed);if(group.unknown)return {pid:leader.pid,confirmedStopped:false,stopState:'STOP_PENDING',reason:'PROCESS_GROUP_IDENTITY_UNCONFIRMED',signals};
  if(!group.members.some(x=>x.state!=='Z'))return {pid:leader.pid,confirmedStopped:true,scope:'OWNED_PROCESS_GROUP',signals,zombiePids:group.members.filter(x=>x.state==='Z').map(x=>x.pid)};
  try{process.kill(-leader.pid,signal);signals.push(signal);}catch(e){if(e.code!=='ESRCH')return {pid:leader.pid,confirmedStopped:false,stopState:'STOP_PENDING',reason:'PROCESS_GROUP_SIGNAL_UNCONFIRMED',signals};}
  const until=Date.now()+timeout;
  do{await wait(50);group=scopedGroup(managed);if(group.unknown)return {pid:leader.pid,confirmedStopped:false,stopState:'STOP_PENDING',reason:'PROCESS_GROUP_IDENTITY_UNCONFIRMED',signals};if(!group.members.some(x=>x.state!=='Z'))return {pid:leader.pid,confirmedStopped:true,scope:'OWNED_PROCESS_GROUP',signals,zombiePids:group.members.filter(x=>x.state==='Z').map(x=>x.pid)};}while(Date.now()<until);
 }
 return {pid:leader.pid,confirmedStopped:false,stopState:'STOP_PENDING',reason:'LIVE_DESCENDANTS_REMAIN',signals};
}
