import test from 'node:test';import assert from 'node:assert/strict';import {graphql} from 'graphql';
import {Store} from '../src/store.js';import {Events} from '../src/events.js';import {createAppSchema} from '../src/schema.js';import {sessionContext} from '../src/security.js';
test('Starli tool request launches an owner-scoped Next build from anonymous chat',async()=>{
 const oldFetch=globalThis.fetch;const keys=['OPENAI_API_KEY','ENABLE_IMAGE_GENERATION','ENABLE_MARKET_RESEARCH','NEXT_WORKER_ENABLED'];const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.OPENAI_API_KEY='test';for(const key of keys.slice(1))process.env[key]='false';
 globalThis.fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));return new Response(JSON.stringify(body.tools?{output:[{type:'function_call',name:'build_website',arguments:JSON.stringify({name:'Atelier ceramica',brief:'Website pentru atelierul de ceramică din Brașov.'})}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({page:'export default function Home(){return <main><h1>Atelier de ceramică în Brașov</h1><p>Obiecte lucrate manual și ateliere de grup.</p></main>}',css:'body{margin:0;background:#fff8f0}',title:'Atelier',description:'Ceramică în Brașov'})}]}]}),{status:200});};
 const store=new Store(':memory:');const schema=createAppSchema(store,new Events());const ctx=sessionContext(store,'',()=>{},'tool-workflow-test');
 try{
  const chat=await graphql({schema,source:'mutation{createConversation{ id }}',contextValue:ctx});const chatId=(chat.data as any).createConversation.id;
  const result=await graphql({schema,source:'mutation($id:ID!){sendMessage(conversationId:$id,content:"Construiește un website pentru atelierul meu de ceramică din Brașov."){id}}',variableValues:{id:chatId},contextValue:ctx});assert.equal(result.errors,undefined);
  let project:any;for(let i=0;i<100;i++){const conversation=store.get('conversations',chatId);project=conversation?.projectId?store.get('projects',conversation.projectId):undefined;if(project?.status==='SOURCE_READY')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(project?.ownerId,ctx.guest);assert.equal(project?.status,'SOURCE_READY');assert.equal(project.files.length,7);assert.ok(project.files.some((f:any)=>f.path==='app/page.tsx'));assert.equal(store.get('conversations',chatId)?.messages.at(-1).role,'assistant');
 }finally{store.close();globalThis.fetch=oldFetch;for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
