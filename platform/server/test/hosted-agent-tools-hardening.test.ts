import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {HostedAgentService,COLLECTIONS} from '../src/hosted-agents/service.js';
import {ToolRegistry,type AgentTool} from '../src/hosted-agents/tools/index.js';
const actor={userId:'admin',role:'ADMIN' as const};
const call=(name:string,args:any={},id='tool-1')=>({id,type:'function' as const,function:{name,arguments:JSON.stringify(args)}});
const toolReply=(name:string,args:any={},id='tool-1')=>({reply:'',latencyMs:0,toolCalls:[call(name,args,id)]});
const finalReply={reply:'Finished.',latencyMs:0};
const makeTool=(id:string,execute:AgentTool['execute']):AgentTool=>({id,name:id,description:'Test utility',category:'UTILITY',permissionLevel:'READ_ONLY',inputSchema:{type:'object',properties:{}},execute});
async function setup(t:any,tools:AgentTool[],enabledTools:string[],complete:any,options:any={}){
 const store=new Store(':memory:');t.after(()=>store.close());store.saveUser({id:'admin',username:'admin',role:'ADMIN'});
 const registry=new ToolRegistry();tools.forEach(tool=>registry.register(tool));
 const service=new HostedAgentService({store,toolRegistry:registry,router:{complete} as any,...options});
 const agent=await service.create(actor,{name:'QA',businessName:'Fictional QA',type:'SUPPORT',enabledTools});
 await service.publish(actor,agent.id,'DEMO',1);const session=await service.startConversation({publicId:agent.publicId});
 return {store,service,registry,agent,turn:{publicId:agent.publicId,...session,requestId:'one',message:'Please help'}};
}
test('model cannot execute a registered tool omitted from enabled tools',async t=>{
 let calls=0,executed=0;
 const fixture=await setup(t,[makeTool('hidden',async()=>{executed++;return {success:true};})],[],async()=>++calls===1?toolReply('hidden'):finalReply);
 await fixture.service.chat(fixture.turn);assert.equal(executed,0);assert.equal(fixture.store.list(COLLECTIONS.TOOL_EXECUTIONS).length,0);
});
test('unknown permission levels rejected at registration and mutable approval policy fails closed',async t=>{
 const registry=new ToolRegistry();assert.throws(()=>registry.register({...makeTool('bad',async()=>({success:true})),permissionLevel:'SUPERUSER' as any}));
 let calls=0,executed=0;const tool=makeTool('approved',async()=>{executed++;return {success:true};});
 const fixture=await setup(t,[tool],['approved'],async()=>++calls===1?toolReply('approved'):finalReply);
 tool.permissionLevel='REQUIRES_OWNER_APPROVAL';await fixture.service.chat(fixture.turn);assert.equal(executed,0);
});
test('disable during provider result prevents tool invocation and conversation commit',async t=>{
 let resolve:any,executed=0;
 const fixture=await setup(t,[makeTool('safe',async()=>{executed++;return {success:true};})],['safe'],()=>new Promise(r=>{resolve=r;}));
 const pending=fixture.service.chat(fixture.turn);await fixture.service.disable(actor,fixture.agent.id,2);resolve(toolReply('safe'));
 await assert.rejects(pending,/configuration changed/);assert.equal(executed,0);assert.equal(fixture.store.get(COLLECTIONS.CONVERSATIONS,fixture.turn.conversationId)?.messages.length,0);
});
test('every router invocation reserves three attempts and additional tool rounds cannot bypass quota',async t=>{
 let calls=0,executed=0;
 const fixture=await setup(t,[makeTool('safe',async()=>{executed++;return {success:true,data:{ok:true}};})],['safe'],async()=>toolReply('safe',{iteration:++calls},'call-'+calls),{env:{HOSTED_AGENTS_DAILY_MODEL_BUDGET:'6'}});
 await assert.rejects(fixture.service.chat(fixture.turn),/Platform model quota/);
 assert.equal(calls,2);assert.equal(executed,2);assert.equal(fixture.store.get(COLLECTIONS.RATE_LIMITS,'global:daily_model_calls')?.count,6);
});
test('turn timeout aborts hanging tool and releases lease without saving late result',async t=>{
 let calls=0,signal:AbortSignal|undefined;
 const fixture=await setup(t,[makeTool('hang',async(_input,context)=>{signal=context.signal;return await new Promise(()=>{});})],['hang'],async()=>{calls++;return toolReply('hang');},{turnTimeoutMs:30});
 const started=Date.now();await assert.rejects(fixture.service.chat(fixture.turn),/temporarily busy|deadline/);
 assert.ok(Date.now()-started<1000);assert.equal(signal?.aborted,true);assert.equal(calls,1);
 assert.equal(fixture.store.get(COLLECTIONS.REQUESTS,'lock:'+fixture.turn.conversationId),undefined);assert.equal(fixture.store.list(COLLECTIONS.TOOL_EXECUTIONS).length,0);
});
test('audit redacts nested secrets, PII and raw errors while retaining useful utility evidence',async t=>{
 const fixture=await setup(t,[],[],async()=>finalReply);
 fixture.service.recordToolExecution({id:'audit',agentId:fixture.agent.id,conversationId:fixture.turn.conversationId,toolName:'safe',toolCategory:'UTILITY',permissionLevel:'READ_ONLY',input:{expression:'1+1',token:'secret',nested:{email:'private@example.com',apiKey:'secret'}},output:{result:2,authorization:'secret'},error:'secret upstream password',success:false,durationMs:1,createdAt:new Date().toISOString()},'admin');
 const record=fixture.store.get(COLLECTIONS.TOOL_EXECUTIONS,'audit');assert.equal(record?.input.expression,'1+1');assert.equal(record?.input.token,'[REDACTED]');assert.equal(record?.input.nested.email,'[REDACTED]');assert.equal(record?.output.authorization,'[REDACTED]');assert.equal(record?.error,'Tool execution failed');
});
test('registry enforces additionalProperties and sanitizes thrown exceptions',async()=>{
 const registry=new ToolRegistry();const tool=makeTool('safe',async()=>{throw Error('sk-private-secret-123456789');});tool.inputSchema.additionalProperties=false;registry.register(tool);
 assert.equal((await registry.execute('safe',{unexpected:'x'},{agentId:'a',conversationId:'c'})).success,false);
 assert.equal((await registry.execute('safe',{},{agentId:'a',conversationId:'c'})).error,'Tool execution failed');
});
