import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenRouterModelRouter,PREFERRED_FREE_MODELS} from '../src/hosted-agents/openrouter.js';
const textModel=(id:string,overrides:Record<string,unknown>={})=>({id,pricing:{prompt:'0',completion:'0'},architecture:{input_modalities:['text'],output_modalities:['text']},...overrides});
const completion=(model:string)=>({model,choices:[{message:{content:'A factual response.'},finish_reason:'stop'}],usage:{cost:0}});
function fixture(models:any[],handler?:(body:any)=>Response|Promise<Response>,options:any={}) {
 const bodies:any[]=[];let catalogCalls=0;
 const router=new OpenRouterModelRouter({apiKey:'mock-only',...options,fetch:async(url:any,init:any)=>{
  if(String(url).endsWith('/models')){catalogCalls++;return Response.json({data:models});}
  const body=JSON.parse(init.body);bodies.push(body);return handler?handler(body):Response.json(completion(body.model));
 }});
 return {router,bodies,catalogCalls:()=>catalogCalls};
}
const request={messages:[{role:'user' as const,content:'What services do you offer?'}]};
test('discovers current zero-priced text models despite complete absence of legacy shortlist',async()=>{
 const {router,bodies}=fixture([textModel('new-provider/current-chat:free'),textModel('new-provider/zero-priced-chat')]);
 assert.deepEqual(await router.getCandidateModels(),['new-provider/current-chat:free','new-provider/zero-priced-chat']);
 const result=await router.complete(request);assert.equal(result.model,'new-provider/current-chat:free');
 assert.deepEqual(bodies[0].provider.max_price,{prompt:0,completion:0,request:0});assert.deepEqual(bodies[0].modalities,['text']);
});
test('verified free router leads preferred current models and dynamic fallback',async()=>{
 const {router}=fixture([textModel('z/new:free'),textModel('openrouter/free'),textModel(PREFERRED_FREE_MODELS[1]),textModel(PREFERRED_FREE_MODELS[0])]);
 assert.deepEqual(await router.getCandidateModels(),['openrouter/free',PREFERRED_FREE_MODELS[0],PREFERRED_FREE_MODELS[1],'z/new:free']);
});
test('excludes paid, per-request billed, missing-price, nontext, mixed-output and malformed models',async()=>{
 const cases=[
  textModel('paid:free',{pricing:{prompt:'0.0001',completion:'0'}}),
  textModel('request-billed:free',{pricing:{prompt:'0',completion:'0',request:'0.01'}}),
  textModel('missing:free',{pricing:{prompt:'0'}}),textModel('empty:free',{pricing:{prompt:'',completion:'0'}}),
  textModel('null:free',{pricing:{prompt:null,completion:'0'}}),textModel('no-architecture:free',{architecture:undefined}),
  textModel('audio:free',{architecture:{input_modalities:['text'],output_modalities:['audio']}}),
  textModel('mixed:free',{architecture:{input_modalities:['text'],output_modalities:['text','audio']}}),
  textModel('image-input-only:free',{architecture:{input_modalities:['image'],output_modalities:['text']}}),
  textModel('not-chat:free',{endpoints:['/api/v1/embeddings']}),
  textModel('bad/id?injection:free'),textModel('valid/chat:free',{pricing:{prompt:'0e-6',completion:0,request:'0.000'}})
 ];
 const {router}=fixture(cases);assert.deepEqual([...await router.getVerifiedFreeModels()],['valid/chat:free']);
});
test('catalog unavailable or malformed fails closed without a completion call',async()=>{
 for(const response of [new Response('offline',{status:503}),Response.json({wrong:[]}),new Response('not-json')]){
  let calls=0;const router=new OpenRouterModelRouter({apiKey:'mock-only',fetch:async()=>{calls++;return response;}});
  await assert.rejects(router.complete(request),/FREE_MODEL_CATALOG_UNAVAILABLE/);assert.equal(calls,1);
 }
 const {router,bodies}=fixture([textModel('paid/model',{pricing:{prompt:'1',completion:'1'}})]);
 await assert.rejects(router.complete(request),/NO_VERIFIED_FREE_MODEL_AVAILABLE/);assert.equal(bodies.length,0);
});
test('expired catalog never silently uses stale free pricing after refresh failure',async()=>{
 let now=1000,fetches=0;
 const router=new OpenRouterModelRouter({apiKey:'mock-only',clock:()=>now,catalogTtlMs:100,fetch:async()=>++fetches===1?Response.json({data:[textModel('new/free:free')]}):new Response('no',{status:503})});
 assert.equal((await router.getVerifiedFreeModels()).size,1);now+=101;
 await assert.rejects(router.getVerifiedFreeModels(),/FREE_MODEL_CATALOG_UNAVAILABLE/);
});
test('free router accepts only currently verified underlying model identities',async()=>{
 const {router,bodies}=fixture([textModel('model/chat:free'),textModel('openrouter/free')],body=>body.model==='openrouter/free'?Response.json(completion('model/chat')):new Response('busy',{status:503}));
 const result=await router.complete(request);assert.equal(result.model,'openrouter/free');assert.equal(bodies.length,1);
 const bad=fixture([textModel('model/chat:free'),textModel('openrouter/free')],body=>body.model==='openrouter/free'?Response.json(completion('paid/unverified-model')):new Response('busy',{status:503}));
 await assert.rejects(bad.router.complete(request),/UNAVAILABLE_AFTER_2_ATTEMPTS/);
});
test('free router alone stays usable when response names the verified router alias',async()=>{
 const {router}=fixture([textModel('openrouter/free')]);assert.equal((await router.complete(request)).model,'openrouter/free');
});
test('fallback stays bounded to three calls, while account quota immediately halts routing',async()=>{
 const models=Array.from({length:8},(_,i)=>textModel(`new/model-${i}:free`));
 const {router,bodies}=fixture(models,()=>new Response('busy',{status:503}));
 await assert.rejects(router.complete(request),/UNAVAILABLE_AFTER_3_ATTEMPTS/);assert.equal(bodies.length,3);
 for(const status of [401,402,403,429]){
  const candidate=fixture(models,()=>Response.json({error:{message:'Daily account quota exhausted',metadata:{limit_source:'account'}}},{status}));
  await assert.rejects(candidate.router.complete(request),/OPENROUTER_(ACCOUNT_LIMIT|AUTH_UNAVAILABLE)/);assert.equal(candidate.bodies.length,1);
  await assert.rejects(candidate.router.complete(request),/ACCOUNT_COOLDOWN/);
 }
});
test('unexpected nonzero billed cost stops routing immediately',async()=>{
 const {router,bodies}=fixture([textModel('a/free:free'),textModel('b/free:free')],body=>Response.json({...completion(body.model),usage:{cost:0.01}}));
 await assert.rejects(router.complete(request),/OPENROUTER_UNEXPECTED_COST/);assert.equal(bodies.length,1);
});
test('hanging completion response body is bounded by total deadline',async()=>{
 let bodyCalls=0;
 const router=new OpenRouterModelRouter({apiKey:'mock-only',requestTimeoutMs:20,totalTimeoutMs:40,fetch:async(url:any)=>{
  if(String(url).endsWith('/models'))return Response.json({data:[textModel('new/model:free')]});
  bodyCalls++;return new Response(new ReadableStream({start(){}}));
 }});
 const started=Date.now();await assert.rejects(router.complete(request),/UNAVAILABLE_AFTER_1_ATTEMPTS/);
 assert.equal(bodyCalls,1);assert.ok(Date.now()-started<1000);
});

test('free router runs first and falls back to verified direct model when busy',async()=>{
 const models=PREFERRED_FREE_MODELS.slice(0,4).map(id=>textModel(id));models.push(textModel('discovered/working:free'),textModel('openrouter/free'));
 const {router,bodies}=fixture(models,body=>body.model==='openrouter/free'?Response.json({error:{message:'Provider returned error',metadata:{limit_source:'upstream_provider_shared_pool'}}},{status:429}):Response.json(completion(body.model)));
 const result=await router.complete(request);assert.equal(result.model,PREFERRED_FREE_MODELS[0]);assert.deepEqual(bodies.map(body=>body.model),['openrouter/free',PREFERRED_FREE_MODELS[0]]);
 assert.deepEqual(bodies[0].reasoning,{enabled:false,exclude:true});
});

test('GraphQL exposes only the known sanitized provider-busy error; raw failures stay masked',async()=>{
 const {createHostedAgentGraphQL}=await import('../src/hosted-agents/graphql.js');
 const {GraphQLError}=await import('graphql');
 const busy='AI Agent is temporarily busy. Please try again shortly.';
 const create=(message:string)=>createHostedAgentGraphQL({service:{chat:async()=>{throw new Error(message);}} as any});
 const args={publicId:'test',conversationId:'test',visitorToken:'test',requestId:'test',message:'Hello'};
 await assert.rejects(create(busy).resolvers.Mutation.hostedAgentSendMessage(null,args,{ip:'test'} as any),(error:any)=>error instanceof GraphQLError&&error.message===busy&&error.extensions.code==='AI_TEMPORARILY_UNAVAILABLE'&&error.extensions.retryAfterSeconds===30);
 await assert.rejects(create('private upstream detail').resolvers.Mutation.hostedAgentSendMessage(null,args,{ip:'test'} as any),(error:any)=>!(error instanceof GraphQLError));
});

test('nonempty length-limited answer is preserved with finish metadata, empty reasoning-only output is rejected',async()=>{
 const {router}=fixture([textModel('new/chat:free')],body=>Response.json({...completion(body.model),choices:[{message:{content:'A useful concise answer.'},finish_reason:'length'}]}));
 const result=await router.complete(request);assert.equal(result.reply,'A useful concise answer.');assert.equal(result.finishReason,'length');
 const empty=fixture([textModel('new/chat:free')],body=>Response.json({...completion(body.model),choices:[{message:{content:''},finish_reason:'length'}]}));
 await assert.rejects(empty.router.complete(request),/UNAVAILABLE_AFTER_1_ATTEMPTS/);
});
