import test from'node:test';import assert from'node:assert/strict';import{createOperatorModel}from'../src/operator-model.js';
const tools=[{name:'inspect_project',description:'Inspect',parameters:{type:'object',properties:{projectId:{type:'string'}},required:['projectId'],additionalProperties:false}}];
const input=()=>({messages:[{role:'user',content:'OBJECTIVE'},{role:'user',content:'CHECKPOINT'},{role:'user',content:'INITIAL_TRANSCRIPT'}],instructions:'Operator instructions',signal:new AbortController().signal});
test('native OpenAI functions round-trip real call IDs and outputs without model substitution',async()=>{
 const oldKey=process.env.OPENAI_API_KEY,oldModel=process.env.OPENAI_OPERATOR_MODEL;process.env.OPENAI_API_KEY='unit-key';process.env.OPENAI_OPERATOR_MODEL='configured-model';const bodies:any[]=[];
 try{const driver=createOperatorModel({provider:'OPENAI',fallbackToOpenAI:false,tools,continuityContext:()=>({}),fetchImpl:async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({status:'completed',output:bodies.length===1?[{type:'reasoning',id:'rs_1',summary:[]},{type:'function_call',call_id:'call_1',name:'inspect_project',arguments:'{"projectId":"p"}'}]:[{type:'function_call',call_id:'final_1',name:'finish_operator_run',arguments:'{"status":"completed","reply":"Verificat"}'}]}));}});
 const first=JSON.parse(await driver.decide(input()));assert.equal(first.calls[0].tool,'inspect_project');driver.observe({tool:'inspect_project',ok:true,summary:'Citit',data:{status:'READY'}});const last=JSON.parse(await driver.decide(input()));assert.equal(last.type,'final');assert.equal(last.status,'completed');assert.equal(bodies[0].model,'configured-model');assert.equal(bodies[0].store,false);assert.ok(bodies[0].tools.some((tool:any)=>tool.type==='function'&&tool.name==='inspect_project'));assert.ok(bodies[1].input.some((item:any)=>item.type==='function_call_output'&&item.call_id==='call_1'&&item.output.includes('READY')));assert.ok(bodies[1].input.some((item:any)=>item.type==='reasoning'&&item.id==='rs_1'));
 }finally{if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.OPENAI_OPERATOR_MODEL;else process.env.OPENAI_OPERATOR_MODEL=oldModel;}
});
test('Outlier reuses its isolated run session and sends fresh tool results rather than replaying the transcript',async()=>{
 const inputs:any[]=[];const driver=createOperatorModel({provider:'OUTLIER',fallbackToOpenAI:false,tools,continuityContext:()=>({}),textModel:async(messages,_instructions,_json,options)=>{inputs.push(messages);options?.outlierState?.onRotate?.('conv-run','https://app.outlier.ai/internal/experts/assistant/conversations/conv-run',inputs.length);return inputs.length===1?'{"type":"tool_calls","calls":[{"tool":"inspect_project","args":{"projectId":"p"}}]}':'{"type":"final","status":"completed","reply":"Verificat"}';}});
 await driver.decide(input());driver.observe({tool:'inspect_project',ok:true,summary:'Citit',data:{status:'READY'}});await driver.decide(input());assert.ok(JSON.stringify(inputs[0]).includes('INITIAL_TRANSCRIPT'));assert.ok(!JSON.stringify(inputs[1]).includes('INITIAL_TRANSCRIPT'));assert.ok(JSON.stringify(inputs[1]).includes('READY'));
});
test('canceling a provider call never triggers a fallback request',async()=>{
 const controller=new AbortController();let calls=0;const driver=createOperatorModel({provider:'OUTLIER',fallbackToOpenAI:true,tools,continuityContext:()=>({}),textModel:async()=>{controller.abort();throw Error('canceled');},fetchImpl:async()=>{calls++;throw Error('must not fallback');}});await assert.rejects(driver.decide({...input(),signal:controller.signal}),/canceled/);assert.equal(calls,0);
});

test('native corrected retries retain failure references outside business arguments',async()=>{
 const oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='unit-key';const failureId='a'.repeat(64);
 try{const driver=createOperatorModel({provider:'OPENAI',fallbackToOpenAI:false,tools,continuityContext:()=>({}),fetchImpl:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.equal(body.tools[0].parameters.properties._retryOf.type,'string');
  return new Response(JSON.stringify({status:'completed',output:[{type:'function_call',call_id:'corrected',name:'inspect_project',arguments:JSON.stringify({projectId:'correct-id',_retryOf:failureId})}]}));
 }});const decision=JSON.parse(await driver.decide(input()));assert.deepEqual(decision.calls,[{tool:'inspect_project',args:{projectId:'correct-id'},retryOf:failureId}]);
 }finally{if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
