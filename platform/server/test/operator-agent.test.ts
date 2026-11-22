import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,id,now} from '../src/store.js';
import {sessionContext,hashPassword} from '../src/security.js';
import {Events} from '../src/events.js';
import {GraphQLError} from 'graphql';
import {runAutonomousOperator,stopAutonomousOperator} from '../src/operator-agent.js';

function setup(){const store=new Store(':memory:'),events=new Events();const admin=store.saveUser({id:id(),username:'agent_admin',role:'ADMIN',email:'agent@starlidigital.ro',recoveryEmail:'admin@example.com',passwordHash:hashPassword('AdminAgentParola2026!'),createdAt:now()});const ctx=sessionContext(store,'',()=>{},'agent-'+id());ctx.user=admin;return{store,events,ctx,conversation:{id:id(),ownerId:admin.id,messages:[],createdAt:now(),updatedAt:now()}};}
const decision=(tool:string,args:Record<string,unknown>={})=>JSON.stringify({type:'tool_calls',plan:['Inspectez','Execut','Verific'],calls:[{tool,args}]});
const final=(reply='Operațiunile au fost verificate.')=>JSON.stringify({type:'final',status:'completed',reply});

test('a stale retry reference does not abort a valid read or bypass write receipts',async()=>{
 const env=setup();let step=0,writes=0;
 try{
  const calls=[{tool:'inspect_project',args:{projectId:'existing'},retryOf:'a'.repeat(64)},{tool:'write_operator_memory',args:{title:'Preferință',content:'Editorial'},retryOf:'b'.repeat(64)},{tool:'write_operator_memory',args:{title:'Preferință',content:'Editorial'},retryOf:'c'.repeat(64)}];
  const result=await runAutonomousOperator({...env,prompt:'Verifică proiectul și reține preferința.',model:async()=>step<calls.length?JSON.stringify({type:'tool_calls',calls:[calls[step++]]}):final(),executeTool:async tool=>{if(tool==='write_operator_memory')writes++;return{tool,ok:true,summary:'Verificat',data:{}};}});
  assert.equal(result.status,'SUCCEEDED');assert.equal(writes,1);
 }finally{env.store.close();}
});

test('default execution continues beyond twelve steps and thirty-two tool calls',async()=>{
 const env=setup();let n=0;
 try{const result=await runAutonomousOperator({...env,prompt:'Verifică toate cele 40 de proiecte.',model:async()=>n<40?decision('inspect_project',{projectId:'project-'+n++}):final(),executeTool:async tool=>({tool,ok:true,summary:'Proiect verificat',data:{}})});assert.equal(result.toolActivities.length,40);assert.equal(env.store.get('operator-agent-runs',result.runId)!.steps,41);assert.equal(env.store.list('operator-agent-actions').length,40);}finally{env.store.close();}
});

test('independent reads overlap but ordered writes never overlap',{timeout:3000},async()=>{
 const env=setup();let step=0,started=0,active=0,peak=0;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 try{await runAutonomousOperator({...env,prompt:'Verifică starea platformei și dispozitivele.',model:async()=>step++===0?JSON.stringify({type:'tool_calls',calls:['platform_operational_summary','list_devices','get_platform_schema'].map(tool=>({tool,args:{}}))}):final(),executeTool:async tool=>{active++;peak=Math.max(peak,active);if(++started===3)release();await barrier;active--;return{tool,ok:true,summary:'Citit',data:{}};}});assert.equal(peak,3);
 step=0;peak=0;await runAutonomousOperator({...env,prompt:'Salvează două preferințe.',model:async()=>step++===0?JSON.stringify({type:'tool_calls',calls:['A','B'].map(title=>({tool:'write_operator_memory',args:{title,content:'Preferință'}}))}):final(),executeTool:async tool=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return{tool,ok:true,summary:'Salvat',data:{}};}});assert.equal(peak,1);
 }finally{env.store.close();}
});

test('operator can stop an unbounded execution and another owner cannot stop it',async()=>{
 const env=setup();try{const running=runAutonomousOperator({...env,prompt:'Verifică platforma.',model:async()=>new Promise<string>(()=>{}),executeTool:async tool=>({tool,ok:true,summary:'Citit',data:{}})});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(stopAutonomousOperator('another-owner'),false);assert.equal(stopAutonomousOperator(env.ctx.user!.id,env.conversation.id),true);await assert.rejects(running,/întreruptă|oprită/);assert.equal(env.store.list('operator-agent-runs')[0].status,'INTERRUPTED');}finally{env.store.close();}
});

test('autonomous agent selects and executes a multi-step tool workflow with private durable checkpoints',async()=>{
 const env=setup();let step=0;const calls:string[]=[];const privateText='PRIVATE_OPERATOR_CLI_37493';
 try{const result=await runAutonomousOperator({...env,prompt:'Verifică proiectul. '+privateText,model:async()=>[decision('search_platform',{query:'Viva',scope:'projects'}),decision('inspect_project',{projectId:'project-viva'}),final()][step++],executeTool:async(tool,args,meta)=>{calls.push(tool);assert.ok(meta?.idempotencyKey.startsWith('agent:'));return{tool,ok:true,summary:'Verificat',data:tool==='search_platform'?{projects:[{id:'project-viva'}]}:{status:'READY'}};}});
 assert.deepEqual(calls,['search_platform','inspect_project']);assert.equal(result.toolActivities.length,2);
 const record=env.store.get('operator-agent-runs',result.runId)!;assert.equal(record.status,'SUCCEEDED');assert.ok(record.objective.includes(privateText));assert.equal(env.store.list('projects').length,0);assert.equal(record.plan.length,3);
 }finally{env.store.close();}
});

test('unknown tools and malformed decisions fail before invoking any executor',async()=>{
 for(const output of ['not JSON',decision('invented_root_tool',{})]){const env=setup();let invoked=0;try{await assert.rejects(runAutonomousOperator({...env,prompt:'Verifică platforma',model:async()=>output,executeTool:async tool=>{invoked++;return{tool,ok:true,summary:'ok',data:{}};}}));assert.equal(invoked,0);assert.equal(env.store.list('operator-agent-runs')[0].status,'FAILED');}finally{env.store.close();}}
});

test('mutating tool retries reuse the same confirmed result without repeating the operation',async()=>{
 const env=setup();let step=0,invocations=0;try{const result=await runAutonomousOperator({...env,prompt:'Reține preferința mea.',model:async()=>[decision('write_operator_memory',{title:'Stil',content:'Editorial'}),decision('write_operator_memory',{content:'Editorial',title:'Stil'}),final()][step++],executeTool:async tool=>{invocations++;return{tool,ok:true,summary:'Memorie privată salvată',data:{id:'memory-1'}};}});assert.equal(invocations,1);assert.equal(result.toolActivities.length,2);}finally{env.store.close();}
});

test('failed tools cannot be turned into a successful final report',async()=>{
 const env=setup();let step=0;try{await assert.rejects(runAutonomousOperator({...env,prompt:'Caută leaduri',model:async()=>step++===0?decision('research_web',{query:'cafenele Brașov'}):final('Am găsit leadurile.'),executeTool:async tool=>({tool,ok:false,summary:'Furnizorul de căutare nu este configurat.',data:{}})}),/nu a finalizat/);assert.equal(env.store.list('operator-agent-runs')[0].status,'FAILED');}finally{env.store.close();}
});

test('the agent can diagnose a failure then verify the retried operation before success',async()=>{
 const env=setup();let step=0,attempt=0;try{const result=await runAutonomousOperator({...env,prompt:'Inspectează proiectul',model:async()=>[decision('inspect_project',{projectId:'p1'}),decision('platform_operational_summary'),decision('inspect_project',{projectId:'p1'}),final()][step++],executeTool:async tool=>({tool,ok:tool!=='inspect_project'||++attempt>1,summary:'Rezultat verificat',data:{state:step}})});assert.equal(result.toolActivities.filter(a=>a.ok).length,2);}finally{env.store.close();}
});

test('repeated no-progress decisions and step exhaustion stop with a durable failed checkpoint',async()=>{
 const env=setup();try{await assert.rejects(runAutonomousOperator({...env,prompt:'Verifică statusul',model:async()=>decision('platform_operational_summary'),executeTool:async tool=>({tool,ok:true,summary:'Neschimbat',data:{}})}),/fără progres/);assert.equal(env.store.list('operator-agent-runs')[0].toolCalls,3);}finally{env.store.close();}
 const second=setup();try{await assert.rejects(runAutonomousOperator({...second,prompt:'Verifică',maxSteps:1,model:async()=>decision('platform_operational_summary'),executeTool:async tool=>({tool,ok:true,summary:'ok',data:{}})}),/Limita de pași/);}finally{second.store.close();}
});

test('an interrupted write is recorded as uncertain and never automatically repeated',async()=>{
 const env=setup();let invocations=0;try{await assert.rejects(runAutonomousOperator({...env,prompt:'Reține un fapt',timeoutMs:20,model:async()=>decision('write_operator_memory',{title:'Fapt',content:'Valoare'}),executeTool:async()=>{invocations++;await new Promise(resolve=>setTimeout(resolve,70));return{tool:'write_operator_memory',ok:true,summary:'ok',data:{}};}}),/întreruptă/);const record=env.store.list('operator-agent-runs')[0];assert.equal(record.status,'NEEDS_REVIEW');assert.equal(record.unknownOutcome,true);assert.equal(invocations,1);}finally{env.store.close();}
});

test('action requests cannot be reported completed without an executed tool, and blocks stay explicit',async()=>{
 const env=setup();try{await assert.rejects(runAutonomousOperator({...env,prompt:'Trimite invitația.',model:async()=>final('Invitația a fost trimisă.'),executeTool:async()=>{throw Error('must not execute');}}),/niciun instrument/);}finally{env.store.close();}
 const second=setup();try{const result=await runAutonomousOperator({...second,prompt:'Trimite invitația.',model:async()=>JSON.stringify({type:'final',status:'blocked',reply:'Lipsește destinatarul confirmat.'}),executeTool:async()=>{throw Error('must not execute');}});assert.equal(result.status,'BLOCKED');assert.equal(second.store.list('operator-agent-runs')[0].status,'BLOCKED');}finally{second.store.close();}
});

test('unprivileged callers never reach the model or tool executor',async()=>{
 const env=setup();env.ctx.user={...env.ctx.user!,role:'USER'};let modelCalls=0;try{await assert.rejects(runAutonomousOperator({...env,prompt:'Status',model:async()=>{modelCalls++;return final();},executeTool:async()=>{throw Error('must not execute');}}));assert.equal(modelCalls,0);assert.equal(env.store.list('operator-agent-runs').length,0);}finally{env.store.close();}
});

test('corrected input arguments recover a typed no-effect error for the same tool and target',async()=>{
 const env=setup();let step=0;try{const result=await runAutonomousOperator({...env,prompt:'Citește fișierul sursă',model:async()=>[decision('read_server_file',{path:'bad-path'}),decision('read_server_file',{path:'server/src/index.ts'}),final()][step++],executeTool:async(tool,args)=>{if(args.path==='bad-path')throw new GraphQLError('Cale invalidă',{extensions:{code:'BAD_USER_INPUT'}});return{tool,ok:true,summary:'Fișier citit',data:{content:'source'}};}});assert.equal(result.status,'SUCCEEDED');assert.equal(env.store.list('operator-agent-runs')[0].unresolvedErrors.length,0);assert.equal(result.toolActivities[0].data.errorCode,'BAD_USER_INPUT');}finally{env.store.close();}
});

test('a corrected resource ID can explicitly retry a typed input failure using its failure reference',async()=>{
 const env=setup();let step=0;try{const result=await runAutonomousOperator({...env,prompt:'Verifică proiectul Viva',model:async({messages})=>{if(step++===0)return decision('inspect_project',{projectId:'wrong-id'});if(step===2){const raw=messages.filter(message=>message.content.startsWith('REZULTAT INSTRUMENT')).at(-1)!.content;const prior=JSON.parse(raw.slice(raw.indexOf('\n')+1));assert.equal(prior.data.errorCode,'NOT_FOUND');return JSON.stringify({type:'tool_calls',calls:[{tool:'inspect_project',args:{projectId:'correct-id'},retryOf:prior.data.failureId}]});}return final();},executeTool:async(tool,args)=>{if(args.projectId==='wrong-id')throw new GraphQLError('Proiect inexistent',{extensions:{code:'NOT_FOUND'}});return{tool,ok:true,summary:'Proiectul Viva verificat',data:{status:'READY'}};}});assert.equal(result.status,'SUCCEEDED');}finally{env.store.close();}
});

test('another resource success does not clear an unrelated batch failure or an integration error',async()=>{
 for(const code of ['NOT_FOUND','INTEGRATION_UNAVAILABLE']){const env=setup();let step=0;try{await assert.rejects(runAutonomousOperator({...env,prompt:'Verifică proiectele A și B',model:async()=>[decision('inspect_project',{projectId:'project-a'}),decision('inspect_project',{projectId:'project-b'}),final()][Math.min(step++,2)],executeTool:async(tool,args)=>{if(args.projectId==='project-a')throw new GraphQLError('Proiect A nereușit',{extensions:{code}});return{tool,ok:true,summary:'Proiect B verificat',data:{}};}}),/nu a finalizat/);assert.equal(env.store.list('operator-agent-runs')[0].unresolvedErrors.length,1);}finally{env.store.close();}}
});
