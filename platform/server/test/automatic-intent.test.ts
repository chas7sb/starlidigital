import test from 'node:test';
import assert from 'node:assert/strict';
import {agentTurn} from '../src/agent-turn.js';

test('automatic intent exposes discussion, planning and build actions with conversation context',async()=>{
 const originalFetch=globalThis.fetch;const originalKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only';
 const requests:any[]=[];
 globalThis.fetch=async(_input,init)=>{requests.push(JSON.parse(String(init?.body)));return Response.json({output:[{type:'message',content:[{type:'output_text',text:'Iată explicația.'}]}]});};
 try{
  const conversation:any={id:'context-test',messages:[{role:'assistant',content:'Planul propus',planJson:JSON.stringify({name:'Atelier',brief:'Website pentru ceramică'})},{role:'user',content:'Explică-mi această direcție înainte să construiești.'}]};
  const result=await agentTurn(conversation,{provider:'OPENAI'});
  assert.equal(result.build,undefined);assert.equal(result.text,'Iată explicația.');
  assert.deepEqual(requests[0].tools.map((t:any)=>t.name).sort(),['ask_user','build_website','propose_plan']);
  assert.match(requests[0].instructions,/INTENȚIE AUTOMATĂ/);assert.match(requests[0].input[0].content,/Website pentru ceramică/);
  await agentTurn(conversation,{provider:'OPENAI',actionMode:'CHAT'});
  assert.deepEqual(requests[1].tools.map((t:any)=>t.name),['ask_user']);
  await agentTurn(conversation,{provider:'OPENAI',actionMode:'PLAN'});
  assert.deepEqual(requests[2].tools.map((t:any)=>t.name),['ask_user','propose_plan']);
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}
});
