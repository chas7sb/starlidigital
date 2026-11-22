import {get} from 'svelte/store';
import {user} from '$lib/stores';
import {verifyBrowserIdentity} from './starli-browser-session';
import {publicRunBinding} from './starli-message-activity';
import {receiveStarliActivity,starliActivityFeed} from '$lib/stores/starli-activity';
const quiet=new Set(['ANSWERED','COMPLETED','FAILED','DENIED','CANCELLED','INTERRUPTED','NEEDS_INPUT','WAITING_INPUT','BUDGET_EXHAUSTED']);
/** Observe only. Reconnect never invokes task creation, resume execution, or a model. */
export function observePublicRun(metadata:any,owner:string):()=>void{
 const run=publicRunBinding(metadata);if(!run)return ()=>{};
 const token=localStorage.token??'',controller=new AbortController();
 let cursor=0,stopped=false,timer:ReturnType<typeof setTimeout>|null=null,delay=1000;
 const current=()=>!stopped&&!controller.signal.aborted&&get(user)?.id===owner&&localStorage.token===token;
 const scoped=(event:any)=>event?.runId===run.runId&&event.conversationId===run.conversationId&&event.assistantMessageId===run.assistantMessageId&&(!event.requestId||event.requestId===run.requestId);
 function apply(event:any){
  if(!current())return;
  if(event?.version==='starli.run.v1'&&event.type==='run.resync'){
   const snapshot=event.snapshot,canonical=snapshot?.run;
   if(!scoped(canonical)||!Number.isSafeInteger(snapshot.cursor)||snapshot.cursor<cursor||!Array.isArray(snapshot.toolCalls)||snapshot.toolCalls.length>200||snapshot.toolCalls.some((e:any)=>!scoped(e)||e.version!=='starli.tool.v1'||e.type!=='tool.lifecycle'))return;
   starliActivityFeed.update(rows=>rows.filter(row=>row.runId!==run.runId||row.chatId!==run.conversationId));
   for(const call of snapshot.toolCalls)receiveStarliActivity(call);
   cursor=snapshot.cursor;
   receiveStarliActivity({...canonical,version:'starli.run.v1',type:'run.state',seq:cursor,timestamp:canonical.updatedAt});
   return;
  }
  if(!scoped(event))return;
  const seq=event.seq??event.cursor;
  if(!Number.isSafeInteger(seq)||seq<cursor)return;
  receiveStarliActivity({...event,agentId:run.agentId,requestId:run.requestId,timestamp:event.timestamp??Date.now()/1000});
  cursor=Math.max(cursor,seq);
  if(event.type==='run.state'&&quiet.has(event.status))stopped=true;
 }
 async function connect(){
  if(!current())return;
  try{
   await verifyBrowserIdentity(token,owner,controller.signal);
   if(!current())return;
   const response=await fetch('/api/v1/starli/runs/'+encodeURIComponent(run.runId)+'/events?after='+cursor,{headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'},signal:controller.signal,cache:'no-store'});
   if(!current())return;
   if([401,403,404].includes(response.status)){stopped=true;return;}
   if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream')||!response.body)throw Error('Activity stream unavailable');
   delay=1000;
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   try{
    while(current()){
     const part=await reader.read();if(part.done)break;
     buffer+=decoder.decode(part.value,{stream:true}).replace(/\r\n/g,'\n');
     if(buffer.length>524288)throw Error('Activity frame exceeds limit');
     let end:number;
     while((end=buffer.indexOf('\n\n'))>=0){
      const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
      const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(data){try{apply(JSON.parse(data));}catch{/* Ignore malformed public events. */}}
     }
    }
   }finally{await reader.cancel().catch(()=>{});}
  }catch{/* Show the last confirmed state; retry the observation, never execution. */}
  if(current()){timer=setTimeout(connect,delay);delay=Math.min(delay*2,15000);}
 }
 void connect();
 return ()=>{stopped=true;controller.abort();if(timer)clearTimeout(timer);};
}
