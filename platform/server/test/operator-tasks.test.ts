import test from 'node:test';import assert from 'node:assert/strict';
import{Store,id,now}from'../src/store.js';import{Events}from'../src/events.js';
import{sessionContext,hashPassword}from'../src/security.js';
import{startOperatorTask,operatorTask,stopOperatorTask,recoverInterruptedOperatorTasks}from'../src/operator-tasks.js';
function fixture(){const store=new Store(':memory:'),events=new Events();const user=store.saveUser({id:id(),username:'task_admin',email:'task@starlidigital.ro',role:'ADMIN',passwordHash:hashPassword('TaskAdminParola2026!'),createdAt:now()});const ctx=sessionContext(store,'',()=>{},'task-'+id());ctx.user=user;return{store,events,ctx,user};}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('starting a task returns before work executes and polling retains the real tool result',async()=>{
 const env=fixture();let work:(()=>void)|undefined,called=false;
 try{const task=startOperatorTask(env.store,env.events,env.ctx,{text:'Verifică platforma'},{schedule:fn=>{work=fn;},run:async(_store,_events,_ctx,input)=>{called=true;env.store.put('operator-jobs',{id:'job',status:'SUCCEEDED'});return{conversation:{id:input.conversationId!},reply:{id:'reply',content:'Confirmat'},toolActivities:[{tool:'platform_operational_summary',ok:true,summary:'Verificat',data:{actual:true}}],jobId:'job'};}});
 assert.equal(task.status,'QUEUED');assert.equal(called,false);assert.ok(task.conversationId);work!();await tick();
 const finished=operatorTask(env.store,env.ctx,task.id);assert.equal(finished.status,'SUCCEEDED');assert.equal(finished.reply,'Confirmat');assert.equal(JSON.parse(finished.toolResults[0].dataJson).actual,true);
 }finally{env.store.close();}
});
test('conversation follow-ups queue and other actors cannot read or stop a task',()=>{
 const env=fixture();try{const task=startOperatorTask(env.store,env.events,env.ctx,{text:'Verifică'},{schedule:()=>{}});
 const followup=startOperatorTask(env.store,env.events,env.ctx,{conversationId:task.conversationId,text:'Altă cerere'},{schedule:()=>{}});assert.equal(followup.status,'QUEUED');assert.equal(followup.queuePosition,2);
 const another=env.store.saveUser({...env.user,id:id(),username:'other_admin'});const other={...env.ctx,user:another};assert.throws(()=>operatorTask(env.store,other,task.id));assert.throws(()=>stopOperatorTask(env.store,other,task.id,()=>true));
 }finally{env.store.close();}
});
test('stopping queued work prevents execution and active work receives cancellation',async()=>{
 const env=fixture();let work:(()=>void)|undefined,executed=false;
 try{const task=startOperatorTask(env.store,env.events,env.ctx,{text:'Verifică'},{schedule:fn=>{work=fn;},run:async()=>{executed=true;throw Error('Should not execute');}});
 assert.equal(stopOperatorTask(env.store,env.ctx,task.id,()=>true).status,'INTERRUPTED');work!();await tick();assert.equal(executed,false);
 env.store.put('operator-tasks',{...task,status:'RUNNING'},env.user.id);let target='';const stopped=stopOperatorTask(env.store,env.ctx,task.id,(owner,conversation)=>{assert.equal(owner,env.user.id);target=conversation!;return true;});assert.equal(stopped.status,'CANCELING');assert.equal(target,task.conversationId);
 }finally{env.store.close();}
});
test('restart recovery marks unfinished tasks interrupted without replaying work',()=>{
 const env=fixture();try{const task=startOperatorTask(env.store,env.events,env.ctx,{text:'Construiește'},{schedule:()=>{}});assert.equal(recoverInterruptedOperatorTasks(env.store),1);assert.equal(operatorTask(env.store,env.ctx,task.id).status,'INTERRUPTED');assert.equal(recoverInterruptedOperatorTasks(env.store),0);}finally{env.store.close();}
});
test('client request IDs make an ambiguous start retry reuse the same queued task',()=>{
 const env=fixture();let schedules=0;try{const requestId=id(),input={text:'Verifică platforma',requestId};const first=startOperatorTask(env.store,env.events,env.ctx,input,{schedule:()=>{schedules++;}});const retry=startOperatorTask(env.store,env.events,env.ctx,input,{schedule:()=>{schedules++;}});assert.equal(first.id,requestId);assert.equal(retry.id,first.id);assert.equal(schedules,1);assert.throws(()=>startOperatorTask(env.store,env.events,env.ctx,{...input,text:'Altă operațiune'},{schedule:()=>{}}),/deja folosit/);}finally{env.store.close();}
});
test('background errors and blocked operator jobs cannot turn into successful tasks',async()=>{
 const env=fixture();try{for(const fail of [true,false]){let work:(()=>void)|undefined;const task=startOperatorTask(env.store,env.events,env.ctx,{text:'Verifică'},{schedule:fn=>{work=fn;},run:async()=>{if(fail)throw Error('Provider unavailable');env.store.put('operator-jobs',{id:'failed-job',status:'FAILED'});return{conversation:{id:'conv'},reply:{id:'reply',content:'Nu pot continua'},toolActivities:[],jobId:'failed-job'};}});work!();await tick();const final=operatorTask(env.store,env.ctx,task.id);assert.equal(final.status,fail?'FAILED':'BLOCKED');assert.ok(fail?final.error.includes('Provider unavailable'):final.reply.includes('Nu pot continua'));}}finally{env.store.close();}
});
