import test from'node:test';import assert from'node:assert/strict';
import{Store,id,now}from'../src/store.js';import{Events}from'../src/events.js';import{sessionContext}from'../src/security.js';
import{appendOperatorTaskEvent,emitOperatorConversationEvent,operatorTaskEvents,updateOperatorConversation}from'../src/operator-gateway.js';
import{startOperatorTask,operatorTask,stopOperatorTask,recoverInterruptedOperatorTasks}from'../src/operator-tasks.js';
function setup(){const store=new Store(':memory:'),events=new Events();const user=store.saveUser({id:id(),username:'gateway_admin',role:'ADMIN',createdAt:now()});const ctx=sessionContext(store,'',()=>{},'gateway');ctx.user=user;return{store,events,user,ctx};}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function runner(env:ReturnType<typeof setup>,work:(prompt:string)=>Promise<string>){return async(_store:any,_events:any,_ctx:any,input:any)=>{const reply=await work(input.prompt),jobId=id();env.store.put('operator-jobs',{id:jobId,status:'SUCCEEDED'});return{conversation:{id:input.conversationId},reply:{id:id(),content:reply},toolActivities:[],jobId};};}

test('event log replays monotonically, deduplicates keys, seals terminal output and enforces owner',()=>{
 const env=setup();try{const task=startOperatorTask(env.store,env.events,env.ctx,{text:'Verifică'},{schedule:()=>{}});
 const first=appendOperatorTaskEvent(env.store,task.id,{kind:'progress',message:'Primul pas'},'step-1')!;
 const repeated=appendOperatorTaskEvent(env.store,task.id,{kind:'progress',message:'Nu dubla'},'step-1')!;assert.equal(first.id,repeated.id);
 appendOperatorTaskEvent(env.store,task.id,{kind:'tool',message:'Instrument confirmat',data:{tool:'inspect_project'}},'tool-1');
 const terminal=appendOperatorTaskEvent(env.store,task.id,{kind:'final',message:'Rezultat final',data:{status:'SUCCEEDED'}},'final')!;
 assert.equal(appendOperatorTaskEvent(env.store,task.id,{kind:'final',message:'Duplicat'},'another-final')!.id,terminal.id);
 assert.equal(appendOperatorTaskEvent(env.store,task.id,{kind:'progress',message:'Rezultat întârziat'}),undefined);
 assert.deepEqual(operatorTaskEvents(env.store,env.ctx,task.id).map(e=>e.sequence),[1,2,3,4]);
 assert.deepEqual(operatorTaskEvents(env.store,env.ctx,task.id,2,1).map(e=>e.sequence),[3]);
 const other=env.store.saveUser({id:id(),username:'other_gateway',role:'ADMIN',createdAt:now()});assert.throws(()=>operatorTaskEvents(env.store,{...env.ctx,user:other},task.id));
 }finally{env.store.close();}
});

test('session FIFO prevents concurrent transcript writers while other sessions can run',async()=>{
 const env=setup();const schedules:(()=>void)[]=[],started:string[]=[];let resolveFirst!:(value:string)=>void;const firstWait=new Promise<string>(resolve=>{resolveFirst=resolve;});
 try{const run=runner(env,async text=>{started.push(text);return text==='first'?firstWait:text;});
 const first=startOperatorTask(env.store,env.events,env.ctx,{text:'first'},{schedule:fn=>schedules.push(fn),run});
 const followup=startOperatorTask(env.store,env.events,env.ctx,{conversationId:first.conversationId,text:'followup'},{schedule:fn=>schedules.push(fn),run});
 const independent=startOperatorTask(env.store,env.events,env.ctx,{text:'independent'},{schedule:fn=>schedules.push(fn),run});
 schedules.shift()!();await tick();assert.deepEqual(started,['first','independent']);assert.equal(operatorTask(env.store,env.ctx,followup.id).status,'QUEUED');
 assert.equal(env.store.get('operator-conversations',first.conversationId)!.activeWriterTaskId,first.id);
 assert.equal(operatorTask(env.store,env.ctx,independent.id).status,'SUCCEEDED');
 emitOperatorConversationEvent(env.store,first.conversationId,{kind:'progress',message:'Activ',expectedTaskId:first.id});
 assert.equal(emitOperatorConversationEvent(env.store,first.conversationId,{kind:'progress',message:'Nu aparține',expectedTaskId:followup.id}),undefined);
 resolveFirst('first completed');await tick();while(schedules.length)schedules.shift()!();await tick();
 assert.deepEqual(started,['first','independent','followup']);assert.equal(operatorTask(env.store,env.ctx,followup.id).status,'SUCCEEDED');
 for(const task of[first,followup,independent])assert.equal(operatorTaskEvents(env.store,env.ctx,task.id).filter(e=>e.kind==='final').length,1);
 }finally{env.store.close();}
});

test('identical in-flight input reuses a run, cancel wins over a late success, and stale writer is fenced',async()=>{
 const env=setup();let schedule!:(()=>void),complete!:(value:string)=>void;const promise=new Promise<string>(resolve=>{complete=resolve;});
 try{const first=startOperatorTask(env.store,env.events,env.ctx,{text:'first'},{schedule:fn=>{schedule=fn;},run:runner(env,()=>promise)});
 const duplicate=startOperatorTask(env.store,env.events,env.ctx,{conversationId:first.conversationId,text:'first'},{schedule:()=>{throw Error('duplicate schedule');}});assert.equal(duplicate.id,first.id);
 schedule();await tick();stopOperatorTask(env.store,env.ctx,first.id,()=>true);complete('Must not become success');await tick();
 assert.equal(operatorTask(env.store,env.ctx,first.id).status,'INTERRUPTED');assert.equal(operatorTaskEvents(env.store,env.ctx,first.id).filter(e=>e.kind==='final').length,0);assert.equal(operatorTaskEvents(env.store,env.ctx,first.id).filter(e=>e.kind==='canceled').length,1);
 }finally{env.store.close();}
});

test('restart records one interruption receipt and never repeats an external operation',()=>{
 const env=setup();try{const task=startOperatorTask(env.store,env.events,env.ctx,{text:'Trimite'},{schedule:()=>{}});assert.equal(recoverInterruptedOperatorTasks(env.store),1);assert.equal(recoverInterruptedOperatorTasks(env.store),0);const events=operatorTaskEvents(env.store,env.ctx,task.id);assert.equal(events.filter(e=>e.kind==='canceled').length,1);assert.equal(env.store.get('operator-tasks',task.id)!.deliveryReceipt.source,'gateway');}finally{env.store.close();}
});

test('conversation commits reject stale and legacy writers and suppress replies after cancellation',async()=>{
 const env=setup();let schedule!:(()=>void),complete!:(value:string)=>void;const wait=new Promise<string>(resolve=>{complete=resolve;});
 try{const task=startOperatorTask(env.store,env.events,env.ctx,{text:'Verifică'},{schedule:fn=>{schedule=fn;},run:runner(env,()=>wait)});schedule();await tick();
 assert.throws(()=>updateOperatorConversation(env.store,task.conversationId,undefined,{messages:[]}),/gateway/);
 assert.throws(()=>updateOperatorConversation(env.store,task.conversationId,'stale-task',{messages:[]}),/scriere/);
 updateOperatorConversation(env.store,task.conversationId,task.id,{agentStatus:'Progres confirmat'});
 assert.equal(env.store.get('operator-conversations',task.conversationId)!.activeWriterTaskId,task.id);
 stopOperatorTask(env.store,env.ctx,task.id,()=>true);
 assert.throws(()=>updateOperatorConversation(env.store,task.conversationId,task.id,{messages:[{content:'Fals succes'}]}),/oprită/);
 updateOperatorConversation(env.store,task.conversationId,task.id,{agentStatus:null});complete('late');await tick();
 assert.equal(env.store.get('operator-conversations',task.conversationId)!.messages.length,0);
 }finally{env.store.close();}
});
