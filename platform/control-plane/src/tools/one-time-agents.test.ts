import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../../../server/src/store.js';
import {OpenAIAgentClient,runOneTimeAgent,registerOneTimeAgentTools} from './one-time-agents.js';
import {WorkerMcpBridge} from './worker-mcp-bridge.js';
test('delegated MCP bridge exposes approved tools and blocks mutating tools',async()=>{
 const store=new Store(':memory:');const root=process.cwd();
 const bridge=await WorkerMcpBridge.create({principal:{id:'agent-parent',role:'admin',scopes:['read','write','admin']},store,workspaceRoot:root,auditSink:{record(){},list(){return []}},auditCall:()=>{}} as any);
 try{const names=(await bridge.list()).map(t=>t.name);assert.ok(names.includes('file_read'));assert.ok(names.includes('code_search'));assert.ok(names.includes('file_write'));assert.ok(names.includes('file_patch'));assert.ok(names.includes('project_test'));assert.ok(!names.includes('server_exec'));const result=await bridge.call('file_read',{path:'server/src/store.ts',startLine:1,endLine:3});assert.equal(result.isError,false);await assert.rejects(()=>bridge.call('server_exec',{command:'id'}),/not approved/);}finally{await bridge.close();store.close();}
});
test('MCP registers five task tools and rejects non-admin access',async()=>{
 const tools=new Map<string,Function>();const server:any={tool:(name:string,_desc:string,_schema:any,handler:Function)=>tools.set(name,handler)};
 const store=new Store(':memory:');
 try{registerOneTimeAgentTools({server,store,principal:{id:'reader',role:'user',scopes:['read']},workspaceRoot:process.cwd(),auditCall:()=>{}} as any);
 for(const name of ['task_agent_spawn','task_agent_status','task_agent_logs','task_agent_result','task_agent_cancel'])assert.ok(tools.has(name));
 const res=await tools.get('task_agent_spawn')!({mission:'Inspect a test source file'});assert.equal(res.isError,true);
 assert.equal(store.list('one_time_agent_jobs').length,0);
 }finally{store.close();}
});
test('one-time worker executes read-only tool and finishes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'starli-worker-'));mkdirSync(join(root,'server','src'),{recursive:true});writeFileSync(join(root,'server','src','sample.ts'),'export const example=42;');
 const store=new Store(':memory:');const job:any={id:'task_test',ownerId:'admin',mission:'Inspect sample file',status:'QUEUED',steps:0,createdAt:'',updatedAt:'',logs:[]};
 let calls=0;const client:any={model:'test-model',conversationId:'isolated-test',ask:async()=>++calls===1?JSON.stringify({action:'tool',name:'file_read',arguments:{path:'server/src/sample.ts'}}):JSON.stringify({action:'done',result:'File contains example constant'})};
 try{await runOneTimeAgent(store,root,job,()=>client);const saved=store.get('one_time_agent_jobs','task_test');assert.equal(saved?.status,'COMPLETED');assert.equal(saved?.steps,2);assert.match(saved?.result,/example constant/);}finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('approval workflow pauses, rejects without writing, and applies only reviewed unique patch',async()=>{
 const root=mkdtempSync(join(tmpdir(),'starli-approval-'));mkdirSync(join(root,'server','src'),{recursive:true});
 const path=join(root,'server','src','sample.ts');writeFileSync(path,'export const value = 1;');
 const store=new Store(':memory:');const handlers=new Map<string,Function>();
 const server:any={tool:(name:string,_description:string,_schema:any,handler:Function)=>handlers.set(name,handler)};
 registerOneTimeAgentTools({server,store,principal:{id:'admin',role:'admin',scopes:['read','write','admin']},workspaceRoot:root,auditCall:()=>{}} as any);
 const propose=async(id:string)=>{
 const job:any={id,ownerId:'admin',mission:'Propose source change',status:'QUEUED',steps:0,createdAt:'',updatedAt:'',logs:[]};
 const client:any={model:'test',conversationId:'test',ask:async()=>JSON.stringify({action:'request_approval',name:'file_patch',arguments:{path:'server/src/sample.ts',search:'value = 1',replace:'value = 2'}})};
 await runOneTimeAgent(store,root,job,()=>client);assert.equal(job.status,'AWAITING_APPROVAL');return job;
 };
 try{
 await propose('task_reject');
 const rejected=await handlers.get('task_agent_approval_decide')!({jobId:'task_reject',decision:'reject'});
 assert.equal(JSON.parse(rejected.content[0].text).status,'REJECTED');
 assert.equal(readFileSync(path,'utf8'),'export const value = 1;');
 await propose('task_approve');
 const reviewed=await handlers.get('task_agent_approval_get')!({jobId:'task_approve'});
 assert.equal(JSON.parse(reviewed.content[0].text).approval.arguments.search,'value = 1');
 const approved=await handlers.get('task_agent_approval_decide')!({jobId:'task_approve',decision:'approve'});
 assert.equal(JSON.parse(approved.content[0].text).status,'COMPLETED');
 assert.equal(readFileSync(path,'utf8'),'export const value = 2;');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});


test('cancel pending approval clears proposal without applying changes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'starli-cancel-'));mkdirSync(join(root,'server','src'),{recursive:true});
 const path=join(root,'server','src','sample.ts');writeFileSync(path,'const x=1;');
 const store=new Store(':memory:');const handlers=new Map<string,Function>();
 registerOneTimeAgentTools({server:{tool:(name:string,_d:string,_s:any,h:Function)=>handlers.set(name,h)} as any,store,principal:{id:'admin',role:'admin',scopes:['read','write','admin']},workspaceRoot:root,auditCall:()=>{}} as any);
 const job:any={id:'task_cancel_approval',ownerId:'admin',mission:'Propose patch',status:'QUEUED',steps:0,createdAt:'',updatedAt:'',logs:[]};
 const client:any={model:'test',conversationId:'test',ask:async()=>JSON.stringify({action:'request_approval',name:'file_patch',arguments:{path:'server/src/sample.ts',search:'x=1',replace:'x=2'}})};
 try{await runOneTimeAgent(store,root,job,()=>client);assert.equal(job.status,'AWAITING_APPROVAL');await handlers.get('task_agent_cancel')!({jobId:job.id});const cancelled=store.get('one_time_agent_jobs',job.id) as any;assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.approval,undefined);assert.equal(readFileSync(path,'utf8'),'const x=1;');const approval=await handlers.get('task_agent_approval_decide')!({jobId:job.id,decision:'approve'});assert.equal(approval.isError,true);}finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('one-time worker denies secret file',async()=>{
 const root=mkdtempSync(join(tmpdir(),'starli-worker-'));mkdirSync(join(root,'server','src'),{recursive:true});writeFileSync(join(root,'server','src','.env'),'secret');
 const store=new Store(':memory:');const job:any={id:'task_secret',ownerId:'admin',mission:'Try reading secret',status:'QUEUED',steps:0,createdAt:'',updatedAt:'',logs:[]};
 let calls=0;const client:any={model:'test',conversationId:'isolated',ask:async()=>++calls===1?JSON.stringify({action:'tool',name:'file_read',arguments:{path:'server/src/.env'}}):JSON.stringify({action:'done',result:'Unable to read'})};
 try{await runOneTimeAgent(store,root,job,()=>client);assert.equal(job.status,'COMPLETED');assert.ok(job.logs.some((l:any)=>l.event==='tool_error'));}finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('OpenAI adapter preserves isolated context and hides API error bodies',async()=>{
 const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only';
 const bodies:any[]=[];
 const request:any=async(_url:any,options:any)=>{bodies.push(JSON.parse(options.body));return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:'{"action":"done","result":"ok"}'}]}]}),{status:200});};
 try{
  const client=new OpenAIAgentClient(request);const signal=new AbortController().signal;
  await client.ask('first',{signal});await client.ask('second',{signal});
  assert.equal(bodies[0].store,false);assert.equal(bodies[0].input.length,1);assert.equal(bodies[1].input.length,3);
  assert.equal(bodies[1].input[0].content,'first');
  const other=new OpenAIAgentClient(request);await other.ask('isolated',{signal});assert.equal(bodies[2].input.length,1);
  const bad=new OpenAIAgentClient((async()=>new Response('sensitive upstream body',{status:429})) as any);
  await assert.rejects(()=>bad.ask('fail',{signal}),/^Error: OpenAI request failed \(HTTP 429\)$/);
 }finally{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;}
});
