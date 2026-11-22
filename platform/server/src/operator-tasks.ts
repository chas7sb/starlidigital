import{Store,id,now,type RecordData}from'./store.js';
import type{Events}from'./events.js';
import{bounded,fail,type Context}from'./security.js';
import{requireOperator,redactSecrets}from'./operator-auth.js';
import{runOperatorTurn}from'./operator-tools.js';
import{stopAutonomousOperator}from'./operator-agent.js';
import{appendOperatorTaskEvent,operatorGatewayTransaction}from'./operator-gateway.js';

type Dependencies={run:typeof runOperatorTurn;schedule:(work:()=>void)=>void;stop:typeof stopAutonomousOperator};
type Pending={taskId:string;ctx:Context;events?:Events;deps:Dependencies};
type Runtime={pending:Map<string,Pending>;running:Set<string>;scheduled:boolean};
const runtimes=new WeakMap<Store,Runtime>();
const active=new Set(['QUEUED','RUNNING','CANCELING']);
const defaults=():Dependencies=>({run:runOperatorTurn,schedule:work=>setImmediate(work),stop:stopAutonomousOperator});
function runtime(store:Store){let state=runtimes.get(store);if(!state){state={pending:new Map(),running:new Set(),scheduled:false};runtimes.set(store,state);}return state;}
function queue(store:Store){return store.list('operator-tasks').filter(task=>task.status==='QUEUED').sort((a,b)=>(a.enqueueSequence||0)-(b.enqueueSequence||0)||a.createdAt.localeCompare(b.createdAt));}
export function operatorTask(store:Store,ctx:Context,taskId:string):RecordData{
 const{user}=requireOperator(ctx,'READ'),task=store.get('operator-tasks',taskId);if(!task||task.ownerId!==user.id)fail('Sarcina operatorului nu există sau nu îți aparține.','NOT_FOUND');
 const lane=store.get('operator-session-lanes',task.conversationId);
 const position=task.status==='QUEUED'?queue(store).filter(t=>t.conversationId===task.conversationId).findIndex(t=>t.id===task.id)+1:0;
 return{...task,lastSequence:Number(task.lastSequence||0),queuePosition:Math.max(0,position),progress:task.status==='QUEUED'?'Sarcină în coadă…':lane?.activeTaskId===task.id?store.get('operator-conversations',task.conversationId)?.agentStatus||task.progress||null:task.progress||null};
}
function requestPump(store:Store,schedule:Dependencies['schedule']){
 const state=runtime(store);if(state.scheduled)return;state.scheduled=true;
 schedule(()=>{state.scheduled=false;drain(store);});
}
function release(store:Store,task:RecordData){
 const lane=store.get('operator-session-lanes',task.conversationId);if(lane?.activeTaskId!==task.id)return;
 store.put('operator-session-lanes',{...lane,activeTaskId:null,updatedAt:now()},task.ownerId);
 const conversation=store.get('operator-conversations',task.conversationId);if(conversation?.activeWriterTaskId===task.id)store.put('operator-conversations',{...conversation,activeWriterTaskId:null,agentStatus:null,updatedAt:now()},conversation.ownerId);
}
function finish(store:Store,task:RecordData,status:string,patch:Record<string,unknown>={}){
 return operatorGatewayTransaction(store,()=>{
 const current=store.get('operator-tasks',task.id);if(!current||current.terminalEventSequence)return;
 store.put('operator-tasks',{...current,...patch,status,progress:null,updatedAt:now(),completedAt:now()},task.ownerId);
 const kind=status==='SUCCEEDED'||status==='BLOCKED'?'final':status==='INTERRUPTED'?'canceled':'error';
 appendOperatorTaskEvent(store,task.id,{kind,message:String(patch.reply||patch.error||(status==='INTERRUPTED'?'Sarcină oprită.':status)),data:{status,toolResults:patch.toolResults||[]}},'terminal');
 });
}
function drain(store:Store){
 const state=runtime(store),capacity=Math.min(8,Math.max(1,Number(process.env.STARLI_OPERATOR_CONCURRENCY)||2));
 for(const task of queue(store)){
  if(state.running.size>=capacity)break;
  const pending=state.pending.get(task.id);if(!pending)continue;
  const claimed=operatorGatewayTransaction(store,()=>{
   if(store.get('operator-session-lanes',task.conversationId)?.activeTaskId||store.get('operator-tasks',task.id)?.status!=='QUEUED')return false;
   const conversation=store.get('operator-conversations',task.conversationId);if(!conversation)return false;
   store.put('operator-session-lanes',{id:task.conversationId,ownerId:task.ownerId,activeTaskId:task.id,updatedAt:now()},task.ownerId);
   store.put('operator-conversations',{...conversation,activeWriterTaskId:task.id,agentStatus:'Starli începe sarcina…',updatedAt:now()},task.ownerId);
   store.put('operator-tasks',{...store.get('operator-tasks',task.id)!,status:'RUNNING',startedAt:now(),updatedAt:now()},task.ownerId);
   appendOperatorTaskEvent(store,task.id,{kind:'start',message:'Starli începe sarcina.',data:{conversationId:task.conversationId}},'start');return true;
  });
  if(!claimed)continue;state.pending.delete(task.id);state.running.add(task.id);
  void(async()=>{
   try{
    requireOperator(pending.ctx,'CONVERSATIONS');
    const result=await pending.deps.run(store,pending.events,pending.ctx,{conversationId:task.conversationId,prompt:task.text});
    const latest=store.get('operator-tasks',task.id),lane=store.get('operator-session-lanes',task.conversationId);
    if(!latest||latest.terminalEventSequence)return;
    if(latest.status==='CANCELING'||lane?.activeTaskId!==task.id){finish(store,task,'INTERRUPTED',{error:'Sarcina a fost oprită. Verifică operațiunile deja confirmate înainte de repetare.'});return;}
    const job=store.get('operator-jobs',result.jobId),toolResults=result.toolActivities.map(t=>({tool:t.tool,ok:t.ok,summary:t.summary,dataJson:JSON.stringify(t.data)}));
    finish(store,task,job?.status==='SUCCEEDED'?'SUCCEEDED':'BLOCKED',{reply:result.reply.content,toolResults});
   }catch(error){const latest=store.get('operator-tasks',task.id);if(latest&&!latest.terminalEventSequence)finish(store,task,latest.status==='CANCELING'?'INTERRUPTED':'FAILED',{error:redactSecrets(error instanceof Error?error.message:'Sarcina nu s-a finalizat.')});}
   finally{release(store,task);state.running.delete(task.id);pending.events?.publish('operator-conversation:'+task.conversationId);if(state.pending.size)requestPump(store,pending.deps.schedule);}
  })();
 }
}
/** Durable intake and per-session FIFO ordering. The HTTP request never owns execution. */
export function startOperatorTask(store:Store,events:Events|undefined,ctx:Context,input:{conversationId?:string|null;text:string;requestId?:string|null},overrides:Partial<Dependencies>={}):RecordData{
 return operatorGatewayTransaction(store,()=>{
 const{user}=requireOperator(ctx,'CONVERSATIONS'),text=bounded(input.text,8000,1);
 if(input.requestId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId))fail('Identificatorul cererii este invalid.');
 if(input.requestId){const prior=store.get('operator-tasks',input.requestId);if(prior){if(prior.ownerId!==user.id||prior.text!==text||(input.conversationId&&prior.conversationId!==input.conversationId))fail('Identificatorul cererii a fost deja folosit.','CONFLICT');return operatorTask(store,ctx,prior.id);}}
 const conversationId=input.conversationId||id(),existing=store.get('operator-conversations',conversationId);
 if(input.conversationId&&(!existing||existing.ownerId!==user.id))fail('Conversația operatorului nu există sau nu îți aparține.','NOT_FOUND');
 const duplicate=store.list('operator-tasks',user.id).find(task=>task.conversationId===conversationId&&task.text===text&&active.has(task.status));if(duplicate)return operatorTask(store,ctx,duplicate.id);
 if(!existing)store.put('operator-conversations',{id:conversationId,ownerId:user.id,title:text.slice(0,72),messages:[],toolHistory:[],status:'OPEN',agentStatus:null,createdAt:now(),updatedAt:now()},user.id);
 const clock=store.get('operator-gateway-state','queue-clock'),enqueueSequence=Number(clock?.value||0)+1;store.put('operator-gateway-state',{id:'queue-clock',value:enqueueSequence});
 const task:RecordData={id:input.requestId||id(),ownerId:user.id,conversationId,text,status:'QUEUED',enqueueSequence,lastSequence:0,reply:null,error:null,progress:null,toolResults:[],createdAt:now(),updatedAt:now(),startedAt:null,completedAt:null};
 store.put('operator-tasks',task,user.id);appendOperatorTaskEvent(store,task.id,{kind:'accepted',message:'Cerere primită.',data:{conversationId}},'accepted');
 const deps={...defaults(),...overrides};runtime(store).pending.set(task.id,{taskId:task.id,ctx:{...ctx},events,deps});requestPump(store,deps.schedule);
 return operatorTask(store,ctx,task.id);
 });
}
export function stopOperatorTask(store:Store,ctx:Context,taskId:string,stop:typeof stopAutonomousOperator=stopAutonomousOperator):RecordData{
 const task=operatorTask(store,ctx,taskId);if(!active.has(task.status))return task;
 if(task.status==='QUEUED'){runtime(store).pending.delete(task.id);finish(store,task,'INTERRUPTED',{error:'Sarcina a fost oprită înainte de execuție.'});return operatorTask(store,ctx,task.id);}
 if(task.status!=='CANCELING'){store.put('operator-tasks',{...task,status:'CANCELING',updatedAt:now()},task.ownerId);appendOperatorTaskEvent(store,task.id,{kind:'cancel_requested',message:'Oprire solicitată.'},'cancel-requested');stop(task.ownerId,task.conversationId);}
 return operatorTask(store,ctx,task.id);
}
export function recoverInterruptedOperatorTasks(store:Store):number{
 const clear=(conversationId:string)=>{const conversation=store.get('operator-conversations',conversationId);if(conversation)store.put('operator-conversations',{...conversation,activeWriterTaskId:null,agentStatus:null,updatedAt:now()},conversation.ownerId);const lane=store.get('operator-session-lanes',conversationId);if(lane)store.put('operator-session-lanes',{...lane,activeTaskId:null,updatedAt:now()},lane.ownerId);};
 let count=0;for(const task of store.list('operator-tasks'))if(active.has(task.status)){finish(store,task,'INTERRUPTED',{error:'Procesul serverului s-a repornit. Operațiunile cu efecte nu au fost retrimise automat.'});clear(task.conversationId);count++;}
 for(const run of store.list('operator-agent-runs'))if(run.status==='RUNNING'){store.put('operator-agent-runs',{...run,status:'INTERRUPTED',error:'Execuția a fost întreruptă de repornirea serverului.',updatedAt:now(),completedAt:now()},run.ownerId);clear(run.conversationId);}return count;
}
