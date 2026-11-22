export type NativeRunBinding={runId:string;requestId:string;conversationId:string;assistantMessageId:string;readOnlyPreview?:boolean};
const ident=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(v);
const states=new Set(['RUNNING','QUEUED','PENDING','NEEDS_INPUT','WAITING_INPUT','BUDGET_EXHAUSTED','CANCEL_REQUESTED','ANSWERED','COMPLETED','FAILED','DENIED','CANCELLED','INTERRUPTED']);
export type NativeCapability={model:string;readOnlyPreview:boolean;prepareTurn:boolean;prepareTurnVersion:string|null};
export async function nativeRunCapability(token:string,model:string,current:()=>boolean,fetcher:typeof fetch=fetch):Promise<NativeCapability|null>{
 if(!token||typeof model!=='string')return null;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
 try{
  const response=await fetcher('/api/v1/starli/runs/capabilities',{headers:{Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store'});
  if(!current())throw Error('The conversation changed before this request was sent.');
  if([401,403].includes(response.status))throw Error('Your session is not authorized.');
  if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))return null;
  const capability=await response.json();
  if(!current())throw Error('The conversation changed before this request was sent.');
  const models=Array.isArray(capability.nativeChatModelIds)?capability.nativeChatModelIds:typeof capability.chatModelId==='string'?[capability.chatModelId]:[];
  if(capability.version!=='starli.run.v1'||capability.toolEventsVersion!=='starli.tool.v1'||!models.includes(model))return null;
  return {model,readOnlyPreview:capability.readOnlyPreview===true,prepareTurn:capability.prepareTurn===true,prepareTurnVersion:typeof capability.prepareTurnVersion==='string'?capability.prepareTurnVersion:null};
 }catch(error){
  if(!current()||(error as Error).message==='Your session is not authorized.')throw error;
  return null;
 }finally{clearTimeout(timer);}
}
export function nativeRunFromCapability(body:any,capability:NativeCapability){
 if(body?.model!==capability.model||body?.stream!==true||!ident(body?.chat_id)||!ident(body?.id))throw Error('Native runtime request did not match its prepared turn.');
 const next={...body};delete next.session_id;
 return {body:next,headers:{'X-Starli-Tool-Events':'v1'},scope:{conversationId:body.chat_id as string,assistantMessageId:body.id as string,readOnlyPreview:capability.readOnlyPreview}};
}
export async function nativeRunRequest(token:string,body:any,current:()=>boolean,fetcher:typeof fetch=fetch){
 const legacy={body,headers:{} as Record<string,string>,scope:null as {conversationId:string;assistantMessageId:string;readOnlyPreview?:boolean}|null};
 if(!token||body?.stream!==true||!ident(body?.chat_id)||!ident(body?.id)||typeof body?.model!=='string')return legacy;
 const capability=await nativeRunCapability(token,body.model,current,fetcher);
 return capability?nativeRunFromCapability(body,capability):legacy;
}
export function bindNativeRunResponse(response:Response,scope:{conversationId:string;assistantMessageId:string;readOnlyPreview?:boolean}):NativeRunBinding{
 const runId=response.headers.get('X-Starli-Run-ID'),requestId=response.headers.get('X-Starli-Request-ID');
 if(!ident(runId)||!ident(requestId))throw Error('Live response binding is unavailable. Check this conversation before sending again.');
 return {...scope,runId,requestId};
}
export function publicRunEvent(value:any,binding:NativeRunBinding){
 if(!value||value.runId!==binding.runId||value.requestId!==binding.requestId||value.conversationId!==binding.conversationId||value.assistantMessageId!==binding.assistantMessageId||!ident(value.agentId)||!Number.isSafeInteger(value.seq)||value.seq<0||typeof value.timestamp!=='number'||!Number.isFinite(value.timestamp)||value.timestamp<=0)return null;
 const base={...binding,agentId:value.agentId,taskId:ident(value.taskId)?value.taskId:null,seq:value.seq,timestamp:value.timestamp};
 if(value.version==='starli.tool.v1'&&value.type==='tool.lifecycle'){
  if(!ident(value.toolCallId)||typeof value.publicToolName!=='string'||!/^\w[\w.:-]{0,99}$/.test(value.publicToolName)||!['running','succeeded','failed','cancelled'].includes(value.status))return null;
  if(value.status!=='running'&&!['COMPLETED','QUEUED','PENDING','NEEDS_INPUT','DENIED','FAILED','CANCELLED','INTERRUPTED'].includes(value.resultCode))return null;
  const outcome=publicToolOutcome(value);
  return {...base,version:'starli.tool.v1',type:'tool.lifecycle',toolCallId:value.toolCallId,publicToolName:value.publicToolName,status:value.status,...(value.status!=='running'?{resultCode:value.resultCode}:{}),...(outcome?{publicOutcome:outcome}:{}),...(Number.isInteger(value.durationMs)&&value.durationMs>=0&&value.durationMs<=86400000?{durationMs:value.durationMs}:{})};
 }
 if(value.version==='starli.run.v1'&&value.type==='run.state'&&states.has(value.status))return {...base,version:'starli.run.v1',type:'run.state',status:value.status,objectiveComplete:value.objectiveComplete===true,needsInput:value.needsInput===true};
 return null;
}
/** Display-only bounded metadata; an unknown outcome never discards a valid settlement. */
export function publicToolOutcome(value:any):'EMPTY'|'RATE_LIMITED'|null{
 if(value?.publicToolName!=='web_search'||!['succeeded','failed'].includes(value.status)||!['COMPLETED','FAILED'].includes(value.resultCode))return null;
 return value.publicOutcome==='EMPTY'||value.publicOutcome==='RATE_LIMITED'?value.publicOutcome:null;
}
export function bindPublicRunMessage(message:any,event:any,binding:NativeRunBinding){
 const safe=publicRunEvent(event,binding);if(!safe||message?.id!==binding.assistantMessageId)return null;
 const old=message.starliPublicRun;
 if(old&&(old.runId!==binding.runId||old.requestId!==binding.requestId||old.lastSeq>safe.seq))return null;
 message.starliPublicRun={version:'starli.run.v1',...binding,agentId:safe.agentId,taskId:safe.taskId,lastSeq:safe.seq,status:safe.type==='run.state'?safe.status:old?.status??'RUNNING',objectiveComplete:safe.type==='run.state'?safe.objectiveComplete:old?.objectiveComplete??false,needsInput:safe.type==='run.state'?safe.needsInput:old?.needsInput??false};
 return safe;
}

export function seedNativeRunMessage(message:any,binding:NativeRunBinding){
 if(message?.id!==binding.assistantMessageId)throw Error('Live response did not match the assistant placeholder.');
 const prior=message.starliPublicRun;
 if(prior&&(prior.runId!==binding.runId||prior.requestId!==binding.requestId||prior.conversationId!==binding.conversationId||prior.assistantMessageId!==binding.assistantMessageId))throw Error('Live response binding changed.');
 if(!prior)message.starliPublicRun={version:'starli.run.v1',...binding,agentId:null,taskId:null,lastSeq:0,status:'CONNECTING',bindingPending:true,objectiveComplete:false,needsInput:false};
 message.done=false;
 return message.starliPublicRun;
}
