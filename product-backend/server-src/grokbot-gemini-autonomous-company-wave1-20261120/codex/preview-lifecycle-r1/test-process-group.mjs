import {spawnScopedProcess,stopScopedProcess,scopedGroup} from './process-group.mjs';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const work=mkdtempSync('/tmp/starli-preview-group-'),file=join(work,'orphan.mjs');
writeFileSync(file,`import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref();console.log(JSON.stringify({ready:true,pid:process.pid,childPid:child.pid}));setTimeout(()=>process.exit(0),100);`);
const managed=spawnScopedProcess(file,[],{});let text='';managed.child.stdout.on('data',b=>text+=b);
try{
 await new Promise(r=>managed.child.once('exit',r));const ready=JSON.parse(text.trim());
 assert.ok(scopedGroup(managed).members.some(x=>x.pid===ready.childPid&&x.state!=='Z'));
 const mismatch=await stopScopedProcess({...managed,identity:{...managed.identity,startTicks:(BigInt(managed.identity.startTicks)+100000n).toString()}});
 assert.equal(mismatch.confirmedStopped,false);assert.ok(scopedGroup(managed).members.some(x=>x.pid===ready.childPid&&x.state!=='Z'));
 const stopped=await stopScopedProcess(managed);assert.equal(stopped.confirmedStopped,true);assert.equal(scopedGroup(managed).members.filter(x=>x.state!=='Z').length,0);
 console.log(JSON.stringify({passed:true,uid:process.getuid(),checks:['held descendant remains after leader exit','unconfirmed identity retains STOP_PENDING and no signal','owned group cleanup confirms no live orphan descendants'],stop:stopped}));
}finally{await stopScopedProcess(managed);rmSync(work,{recursive:true,force:true});}
