import test from 'node:test';
import assert from 'node:assert/strict';
import {PiXaiAgentClient} from './pi-client.ts';

test('inference retries transient HTTP failures before exposing a tool decision',async()=>{
 const previousFetch=globalThis.fetch;
 const names=['STARLI_PROVIDER_OWNER','STARLI_STATE_DIR','STARLI_AGENT_PROVIDER','STARLI_BOSS_PROVIDER','STARLI_INFERENCE_BASE_URL','STARLI_INFERENCE_API_KEY','STARLI_BOSS_MODEL','STARLI_AGENT_MODEL'];
 const env=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{
  delete process.env.STARLI_PROVIDER_OWNER;
  process.env.STARLI_AGENT_PROVIDER='selfhosted';
  process.env.STARLI_INFERENCE_BASE_URL='http://127.0.0.1/v1';
  process.env.STARLI_INFERENCE_API_KEY='synthetic-test-only';
  process.env.STARLI_AGENT_MODEL='starli-coder';
  process.env.STARLI_BOSS_MODEL='starli-coder';
  let calls=0;
  globalThis.fetch=async()=>{calls++;if(calls===1)return new Response('',{status:502});return new Response('data: '+JSON.stringify({id:'response-test',choices:[{delta:{content:'{"tool":"done","result":"verified"}'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{status:200,headers:{'Content-Type':'text/event-stream'}});};
  const client=new PiXaiAgentClient();
  const result=await client.ask('Return a decision',{signal:new AbortController().signal});
  assert.equal(calls,2);
  assert.deepEqual(JSON.parse(result),{tool:'done',result:'verified'});
  assert.equal(client.exportConversation().filter(m=>m.role==='assistant').length,1);
 }finally{globalThis.fetch=previousFetch;for(const n of names){if(env[n]===undefined)delete process.env[n];else process.env[n]=env[n];}}
});
test('inference never retries an authentication rejection',async()=>{
 const previousFetch=globalThis.fetch;
 const names=['STARLI_PROVIDER_OWNER','STARLI_AGENT_PROVIDER','STARLI_INFERENCE_BASE_URL','STARLI_INFERENCE_API_KEY'];
 const env=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{
  delete process.env.STARLI_PROVIDER_OWNER;
  process.env.STARLI_AGENT_PROVIDER='selfhosted';
  process.env.STARLI_INFERENCE_BASE_URL='http://127.0.0.1/v1';
  process.env.STARLI_INFERENCE_API_KEY='synthetic-test-only';
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:401});};
  await assert.rejects(()=>new PiXaiAgentClient().ask('Return a decision',{signal:new AbortController().signal}),/STARLI_INFERENCE_HTTP_401/);
  assert.equal(calls,1);
 }finally{globalThis.fetch=previousFetch;for(const n of names){if(env[n]===undefined)delete process.env[n];else process.env[n]=env[n];}}
});
test('coding output uses a larger budget and truncation is never a completed decision',async()=>{
 const previousFetch=globalThis.fetch;
 const names=['STARLI_PROVIDER_OWNER','STARLI_AGENT_PROVIDER','STARLI_INFERENCE_BASE_URL','STARLI_INFERENCE_API_KEY','STARLI_AGENT_MODEL','STARLI_BOSS_MODEL'];
 const env=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{
  delete process.env.STARLI_PROVIDER_OWNER;process.env.STARLI_AGENT_PROVIDER='selfhosted';process.env.STARLI_INFERENCE_BASE_URL='http://127.0.0.1/v1';process.env.STARLI_INFERENCE_API_KEY='synthetic';process.env.STARLI_AGENT_MODEL='starli-coder';process.env.STARLI_BOSS_MODEL='starli-coder';
  let budget=0;globalThis.fetch=async(url,options)=>{budget=JSON.parse(String(options?.body)).max_tokens;return new Response('data: '+JSON.stringify({choices:[{delta:{content:'{"tool":"platform.call","args":'},finish_reason:'length'}]})+'\n\ndata: [DONE]\n\n',{status:200});};
  const client=new PiXaiAgentClient();await assert.rejects(()=>client.ask('Write project files',{signal:new AbortController().signal}),/STARLI_INFERENCE_OUTPUT_LIMIT/);assert.equal(budget,8192);assert.equal(client.exportConversation().length,0);
 }finally{globalThis.fetch=previousFetch;for(const n of names){if(env[n]===undefined)delete process.env[n];else process.env[n]=env[n];}}
});
test('private outage falls back before returning a single executable decision',async()=>{
 const oldFetch=globalThis.fetch;const names=['STARLI_AGENT_PROVIDER','STARLI_INFERENCE_BASE_URL','STARLI_INFERENCE_API_KEY'];const env=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{
  process.env.STARLI_AGENT_PROVIDER='selfhosted';process.env.STARLI_INFERENCE_BASE_URL='http://127.0.0.1/v1';process.env.STARLI_INFERENCE_API_KEY='synthetic';
  let privateCalls=0,fallbackCalls=0,executions=0;
  globalThis.fetch=async()=>{privateCalls++;return new Response('',{status:503});};
  const managed=async()=>{fallbackCalls++;return {text:'{"tool":"platform.call","args":{"tool":"project_files","args":{"projectId":"synthetic"}}}',model:'verified-coding-model',usage:{input:1,output:1}};};
  const account=async()=>undefined;
  const client=new PiXaiAgentClient(undefined,undefined,120000,12,managed,account);
  const decision=JSON.parse(await client.ask('Inspect the project',{signal:new AbortController().signal}));
  if(decision.tool==='platform.call')executions++;
  assert.equal(privateCalls,3);assert.equal(fallbackCalls,1);assert.equal(executions,1);
  assert.equal(client.receipt?.fallback,true);assert.equal(client.receipt?.model,'verified-coding-model');
 }finally{globalThis.fetch=oldFetch;for(const n of names){if(env[n]===undefined)delete process.env[n];else process.env[n]=env[n];}}
});
test('an explicitly selected account provider is never silently overridden',async()=>{
 const oldFetch=globalThis.fetch;let fallbacks=0,privateCalls=0;
 try{
  globalThis.fetch=async()=>{privateCalls++;throw Error('must not call platform provider');};
  const managed=async()=>{fallbacks++;return {text:'wrong'};};
  const account=async()=>{throw Error('EXPLICIT_PROVIDER_AUTH_FAILED');};
  const client=new PiXaiAgentClient(undefined,undefined,120000,12,managed,account);
  await assert.rejects(()=>client.ask('Work',{signal:new AbortController().signal}),/EXPLICIT_PROVIDER_AUTH_FAILED/);
  assert.equal(fallbacks,0);assert.equal(privateCalls,0);
 }finally{globalThis.fetch=oldFetch;}
});
test('user cancellation never starts a managed fallback',async()=>{
 let fallbacks=0;const managed=async()=>{fallbacks++;return {text:'wrong'};};const account=async()=>undefined;
 const signal=AbortSignal.abort(Error('USER_CANCELLED'));
 const client=new PiXaiAgentClient(undefined,undefined,120000,12,managed,account);
 await assert.rejects(()=>client.ask('Work',{signal}),/USER_CANCELLED|aborted|CANCEL/i);assert.equal(fallbacks,0);
});
