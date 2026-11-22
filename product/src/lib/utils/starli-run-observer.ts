import {get} from 'svelte/store';
import {user} from '$lib/stores';
import {verifyBrowserIdentity} from './starli-browser-session';
import {publicRunBinding} from './starli-message-activity';
import {receiveStarliActivity,starliActivityFeed,starliRunConnections,starliRunDetails} from '$lib/stores/starli-activity';
const quiet=new Set(['ANSWERED','COMPLETED','FAILED','DENIED','CANCELLED','INTERRUPTED','NEEDS_INPUT','WAITING_INPUT','BUDGET_EXHAUSTED']);
/** Observe only. Reconnect never invokes task creation, resume execution, or a model. */
export function observePublicRun(metadata:any,owner:string,onVerified?:(run:any)=>void):()=>void{
 const run=publicRunBinding(metadata);if(!run)return ()=>{};
 const token=localStorage.token??'',controller=new AbortController();
 let boundAgent=run.agentId;
 let cursor=0,stopped=false,timer:ReturnType<typeof setTimeout>|null=null,delay=1000;
 const current=()=>!stopped&&!controller.signal.aborted&&get(user)?.id===owner&&localStorage.token===token;
 const scoped=(event:any)=>event?.runId===run.runId&&event.conversationId===run.conversationId&&event.assistantMessageId===run.assistantMessageId&&(!event.requestId||event.requestId===run.requestId);
 const connection=(state:'connecting'|'live'|'reconnecting'|'unavailable'|'stopped')=>{if(current())starliRunConnections.update(values=>({...values,[run.runId]:state}));};
 connection('connecting');
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
  receiveStarliActivity({...event,agentId:boundAgent,requestId:run.requestId,timestamp:event.timestamp??Date.now()/1000});
  cursor=Math.max(cursor,seq);
  if(event.type==='run.state'&&quiet.has(event.status)){connection('stopped');stopped=true;}
 }
 async function connect(){
  if(!current())return;
  try{
   await verifyBrowserIdentity(token,owner,controller.signal);
   if(!current())return;
   const statusResponse=await fetch('/api/v1/starli/runs/'+encodeURIComponent(run.runId)+'?after='+cursor,{headers:{Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store'});
   if(!current())return;
   if([401,403,404].includes(statusResponse.status)){connection('unavailable');stopped=true;return;}
   if(!statusResponse.ok||!statusResponse.headers.get('content-type')?.includes('application/json'))throw Error('Run status unavailable');
   const statusPage=await statusResponse.json(),currentRun=statusPage.run;
   if(!current())return;
   if(statusPage.version!=='starli.run.v1'||!scoped(currentRun)||typeof currentRun.createdAt!=='number'||!Number.isFinite(currentRun.createdAt)||typeof currentRun.updatedAt!=='number')throw Error('Run status binding unavailable');
   const verified=publicRunBinding({...currentRun,version:'starli.run.v1'});
   if(!verified||verified.bindingPending===true||verified.requestId!==run.requestId||boundAgent&&verified.agentId!==boundAgent)throw Error('Run status binding unavailable');
   boundAgent=verified.agentId;
   onVerified?.({...verified,readOnlyPreview:run.readOnlyPreview===true});
   starliRunDetails.update(values=>({...values,[run.runId]:{createdAt:currentRun.createdAt,updatedAt:currentRun.updatedAt,status:currentRun.status}}));
   const response=await fetch('/api/v1/starli/runs/'+encodeURIComponent(run.runId)+'/events?after='+cursor,{headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'},signal:controller.signal,cache:'no-store'});
   if(!current())return;
   if([401,403,404].includes(response.status)){connection('unavailable');stopped=true;return;}
   if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream')||!response.body)throw Error('Activity stream unavailable');
   connection('live');delay=1000;
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
  if(current()){connection('reconnecting');timer=setTimeout(connect,delay);delay=Math.min(delay*2,15000);}
 }
 void connect();
 return ()=>{stopped=true;controller.abort();if(timer)clearTimeout(timer);starliRunConnections.update(values=>{const next={...values};delete next[run.runId];return next;});};
}
