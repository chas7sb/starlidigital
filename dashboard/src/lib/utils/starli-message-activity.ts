export function isExecutionMessage(message:any):boolean{return message?.starliExecution===true;}
export function visibleNativeMessages<T>(messages:T[]):T[]{return messages.filter(message=>!isExecutionMessage(message));}
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(value);
export function publicRunBinding(value:any){
 if(value?.version!=='starli.run.v1'||!['runId','requestId','conversationId','assistantMessageId','agentId'].every(k=>id(value[k]))||!Number.isSafeInteger(value.lastSeq)||value.lastSeq<0)return null;
 return {...value};
}
export function assistantActivityBinding(event:any){
 if(event?.version==='starli.tool.v1'||event?.version==='starli.run.v1'){
  const seq=event.seq??event.cursor;
  if(!id(event.assistantMessageId)||!id(event.runId)||!id(event.conversationId)||!Number.isSafeInteger(seq)||seq<0)return null;
  return {assistantMessageId:event.assistantMessageId as string,runId:event.runId as string,seq:seq as number,callId:id(event.toolCallId)?event.toolCallId as string:undefined};
 }
 // Compatibility for already typed native activity, never inferred from text.
 if(!id(event?.assistantMessageId)||!id(event?.runId)||!Number.isSafeInteger(event?.seq)||event.seq<0)return null;
 return {assistantMessageId:event.assistantMessageId as string,runId:event.runId as string,seq:event.seq as number,callId:id(event.callId)?event.callId as string:undefined};
}
/** Projection only: retain historical execution records, exclude them from answer bubbles. */
export function applyNativeAssistantMessage(history:any,event:any,chatId:string|null):any{
 const original=event?.nativeMessage,metadata=publicRunBinding(original?.starliPublicRun);
 if((event?.conversationId??event?.chatId)!==chatId||!original||!id(original.id)||original.role!=='assistant'||isExecutionMessage(original))return history;
 if(metadata&&(metadata.conversationId!==chatId||metadata.assistantMessageId!==original.id))return history;
 const binding=metadata?{assistantMessageId:metadata.assistantMessageId,runId:metadata.runId,seq:metadata.lastSeq}:assistantActivityBinding(event);
 if(binding&&binding.assistantMessageId!==original.id)return history;
 const existing=history.messages[original.id];
 if(existing){
  if(!binding)return history;
  const previous=publicRunBinding(existing.starliPublicRun);
  if(previous&&previous.runId!==binding.runId)return history;
  const prior=previous?.lastSeq??existing.starliActivityBinding?.seq;
  // Metadata may precede the canonical answer projection at the same sequence.
  if(Number.isSafeInteger(prior)&&(prior>binding.seq||prior===binding.seq&&existing.content===original.content&&existing.done===original.done))return history;
  const update={...original,parentId:existing.parentId,childrenIds:existing.childrenIds??[],timestamp:existing.timestamp??original.timestamp,...(!metadata?{starliActivityBinding:binding}:{})};
  if(original.content===''&&existing.content&&!original.done)update.content=existing.content;
  Object.assign(existing,update);
  return {...history,messages:{...history.messages,[original.id]:existing}};
 }
 const parent=binding?original.parentId:history.currentId;
 if(binding&&parent!==null&&!history.messages[parent])return history;
 const next={...original,parentId:parent??null,childrenIds:[],...(binding&&!metadata?{starliActivityBinding:binding}:{})};
 const messages={...history.messages,[original.id]:next};
 if(parent&&messages[parent])messages[parent]={...messages[parent],childrenIds:[...new Set([...(messages[parent].childrenIds??[]),original.id])]};
 return {...history,messages,currentId:!binding||history.currentId===parent||!history.currentId?original.id:history.currentId};
}
