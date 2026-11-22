import {verifyBrowserIdentity} from './starli-browser-session';
import {publicRunBinding} from './starli-message-activity';
import {receiveStarliActivity} from '../stores/starli-activity';
export async function cancelPublicRun(metadata:any,owner:string,token:string,current:()=>boolean,signal:AbortSignal){
 let run=publicRunBinding(metadata);if(!run||!current())return;
 await verifyBrowserIdentity(token,owner,signal);
 if(!current())return;
 if(run.bindingPending===true){
  const snapshot=await fetch('/api/v1/starli/runs/'+encodeURIComponent(run.runId),{headers:{Authorization:'Bearer '+token},signal,cache:'no-store'});
  if(!current())return;
  if(!snapshot.ok||!snapshot.headers.get('content-type')?.includes('application/json'))throw Error('Run identity could not be confirmed. No stop was submitted.');
  const page=await snapshot.json(),verified=publicRunBinding({...page.run,version:'starli.run.v1'});
  if(!current())return;
  if(page.version!=='starli.run.v1'||!verified||verified.bindingPending===true||verified.runId!==run.runId||verified.requestId!==run.requestId||verified.conversationId!==run.conversationId||verified.assistantMessageId!==run.assistantMessageId)throw Error('Run identity did not match. No stop was submitted.');
  run=verified;
 }
 const response=await fetch('/api/v1/starli/runs/'+encodeURIComponent(run.runId)+'/cancel',{method:'POST',headers:{Authorization:'Bearer '+token},signal});
 if(!current())return;
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('Stop could not be confirmed. The run may still be active.');
 const result=await response.json(),next=result?.run;
 if(!current())return;
 if(result.version!=='starli.run.v1'||next?.runId!==run.runId||next?.conversationId!==run.conversationId||next?.assistantMessageId!==run.assistantMessageId||next?.requestId!==run.requestId||next?.agentId!==run.agentId||!Number.isSafeInteger(next?.lastSeq))throw Error('Stop response did not match this run.');
 receiveStarliActivity({...next,version:'starli.run.v1',type:'run.state',seq:next.lastSeq,timestamp:next.updatedAt});
 return next;
}
