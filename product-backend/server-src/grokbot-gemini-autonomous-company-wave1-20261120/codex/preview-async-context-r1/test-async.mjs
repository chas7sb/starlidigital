import {createAsyncNativeVerifier} from './async-context.mjs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import assert from 'node:assert/strict';
let text='';for await(const b of process.stdin)text+=b;const c=JSON.parse(text);
const verifier=createAsyncNativeVerifier(c);const ticks=[];let timer=setInterval(()=>ticks.push(Date.now()),10);const start=Date.now();
try{
 const verified=await verifier.context({intentId:c.intentId,nativeJwt:c.nativeJwt,companyId:'caller-forged',nativeRoot:'/caller-forged'});
 clearInterval(timer);timer=null;assert.ok(ticks.length>=10,'main eventloop heartbeat held during real frozen native verifier');assert.notEqual(verified.companyId,'caller-forged');
 const checks=['actual native context valid while eventloop heartbeat continues','caller scope/path override ignored'];
 await assert.rejects(verifier.nativeJwt('foreign-nonmember-company',c.nativeJwt));checks.push('fresh native wrong tenant denies');
 const db=new DatabaseSync(join(c.nativeRoot,'data/company-authority.sqlite3'));db.prepare('UPDATE members SET active=0,revision=revision+1 WHERE company_id=? AND user_id=?').run(verified.companyId,verified.subjectId);db.close();
 await assert.rejects(verifier.context({intentId:c.intentId,nativeJwt:c.nativeJwt}));checks.push('fresh native revocation denies after usable access');
 await verifier.close();assert.equal(verifier.stats().active,0);assert.equal(verifier.stats().queued,0);await assert.rejects(verifier.context({intentId:c.intentId,nativeJwt:c.nativeJwt}),e=>e.code==='NATIVE_VERIFIER_CLOSED');checks.push('worker registry cleaned and closed denies');
 console.log(JSON.stringify({passed:true,checks,uid:process.getuid(),executionClass:'NATIVE_NONPRODUCTION',harnessMintedUsersOrJwt:false,modelCalls:0,browserExecuted:false,heartbeatTicks:ticks.length,verificationDurationMs:ticks.at(-1)-start,maxHeartbeatGapMs:Math.max(...ticks.slice(1).map((n,i)=>n-ticks[i])),workerLimits:verifier.stats(),companyId:verified.companyId,graphId:verified.graphId}));
}finally{if(timer)clearInterval(timer);await verifier.close();}
