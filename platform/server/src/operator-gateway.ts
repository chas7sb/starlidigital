import{createHash,randomUUID}from'node:crypto';
import{Store,now,type RecordData}from'./store.js';
import{fail,type Context}from'./security.js';
import{requireOperator,redactSecrets}from'./operator-auth.js';

export type OperatorGatewayEvent={kind:string;message:string;data?:unknown;expectedTaskId?:string};
const terminal=new Set(['final','error','canceled']);
export function operatorGatewayTransaction<T>(store:Store,work:()=>T):T{
 const nested=store.db.isTransaction,name='gateway_'+randomUUID().replace(/-/g,'');store.db.exec(nested?`SAVEPOINT ${name}`:'BEGIN IMMEDIATE');
 try{const value=work();store.db.exec(nested?`RELEASE SAVEPOINT ${name}`:'COMMIT');return value;}catch(error){if(nested){store.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);store.db.exec(`RELEASE SAVEPOINT ${name}`);}else if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
}
/** Internal transcript writer fence. Legacy/direct callers cannot overwrite an active gateway session. */
export function updateOperatorConversation(store:Store,conversationId:string,expectedTaskId:string|undefined,patch:Record<string,unknown>):RecordData{
 return operatorGatewayTransaction(store,()=>{
  const conversation=store.get('operator-conversations',conversationId);if(!conversation)fail('Conversația operatorului nu există.','NOT_FOUND');
  const lane=store.get('operator-session-lanes',conversationId),writer=conversation.activeWriterTaskId||lane?.activeTaskId;
  if(expectedTaskId){
   if(writer!==expectedTaskId||lane?.activeTaskId!==expectedTaskId)fail('Execuția nu mai deține dreptul de scriere al conversației.','CONFLICT');
   const task=store.get('operator-tasks',expectedTaskId);
   if(!task||task.terminalEventSequence||!['RUNNING','CANCELING'].includes(task.status))fail('Execuția conversației nu mai este activă.','CONFLICT');
   if(task.status==='CANCELING'&&'messages'in patch)fail('Sarcina a fost oprită înainte de publicarea răspunsului.','CONFLICT');
  }else if(writer)fail('Conversația este deținută de o execuție activă din gateway.','CONFLICT');
  const updated={...conversation,...patch,id:conversation.id,ownerId:conversation.ownerId,activeWriterTaskId:conversation.activeWriterTaskId||null};
  store.put('operator-conversations',updated,conversation.ownerId);return updated;
 });
}
export function appendOperatorTaskEvent(store:Store,taskId:string,event:OperatorGatewayEvent,idempotencyKey?:string):RecordData|undefined{
 return operatorGatewayTransaction(store,()=>{
  const task=store.get('operator-tasks',taskId);if(!task)fail('Sarcina operatorului nu există.','NOT_FOUND');
  const receipt=idempotencyKey?taskId+':'+createHash('sha256').update(idempotencyKey).digest('hex'):undefined;
  const existing=receipt?store.get('operator-event-receipts',receipt):undefined;if(existing)return store.get('operator-task-events',existing.eventId);
  if(task.terminalEventSequence)return terminal.has(event.kind)?store.get('operator-task-events',taskId+':'+String(task.terminalEventSequence).padStart(12,'0')):undefined;
  if(event.expectedTaskId&&event.expectedTaskId!==taskId)return;
  const sequence=Number(task.lastSequence||0)+1;
  const value={id:taskId+':'+String(sequence).padStart(12,'0'),taskId,ownerId:task.ownerId,sequence,kind:String(event.kind).slice(0,60),message:redactSecrets(String(event.message||'')).slice(0,20000),dataJson:JSON.stringify(event.data??{}).slice(0,100000),createdAt:now()};
  // Keep JSON valid even when a large diagnostic result needs to be bounded.
  if(value.dataJson.length===100000) value.dataJson=JSON.stringify({truncated:true});
  store.put('operator-task-events',value,task.ownerId);
  const isTerminal=terminal.has(event.kind);
  store.put('operator-tasks',{...task,lastSequence:sequence,...(event.kind==='progress'?{progress:value.message}:{}),...(isTerminal?{terminalEventSequence:sequence,deliveryReceipt:{source:'gateway',eventSequence:sequence,recordedAt:value.createdAt}}:{}),updatedAt:now()},task.ownerId);
  if(receipt)store.put('operator-event-receipts',{id:receipt,taskId,eventId:value.id},task.ownerId);
  return value;
 });
}
export function emitOperatorConversationEvent(store:Store,conversationId:string,event:OperatorGatewayEvent,idempotencyKey?:string):RecordData|undefined{
 const lane=store.get('operator-session-lanes',conversationId),taskId=lane?.activeTaskId;if(!taskId||event.expectedTaskId&&event.expectedTaskId!==taskId)return;
 const task=store.get('operator-tasks',taskId);if(!task||task.status!=='RUNNING')return;
 return appendOperatorTaskEvent(store,taskId,{...event,expectedTaskId:taskId},idempotencyKey);
}
export function operatorTaskEvents(store:Store,ctx:Context,taskId:string,after=0,limit=100):RecordData[]{
 const{user}=requireOperator(ctx,'READ'),task=store.get('operator-tasks',taskId);if(!task||task.ownerId!==user.id)fail('Sarcina operatorului nu există sau nu îți aparține.','NOT_FOUND');
 const cursor=Math.max(0,Math.floor(Number(after)||0)),count=Math.min(200,Math.max(1,Math.floor(Number(limit)||100)));
 return store.db.prepare('SELECT payload FROM records WHERE collection=? AND owner=? AND id>? AND id<? ORDER BY id LIMIT ?').all('operator-task-events',user.id,taskId+':'+String(cursor).padStart(12,'0'),taskId+':~',count).map(row=>JSON.parse(String(row.payload)));
}
