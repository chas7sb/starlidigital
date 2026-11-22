// Canonical GET + existing native socket projection. Never submits or executes.
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
export function mergeExternalNativeHistory(local:any,remote:any){
 if(!remote||typeof remote.messages!=='object'||Array.isArray(remote.messages)||remote.messages===null)return local;
 const current=remote.currentId;
 if(current!==null&&(!id(current)||!remote.messages[current]))return local;
 if(local.currentId&&!remote.messages[local.currentId])return local; // Preserve unaccepted local work.
 const rows=Object.entries(remote.messages);
 if(rows.some(([key,m]:[string,any])=>!id(key)||m?.id!==key||!['user','assistant','system'].includes(m.role)))return local;
 const messages={...local.messages};
 for(const [key,row] of rows as [string,any][]){
  const old=messages[key];
  if(old?.starliPublicRun?.runId&&row.starliPublicRun?.runId&&old.starliPublicRun.runId!==row.starliPublicRun.runId)return local;
  if(Number.isSafeInteger(old?.starliPublicRun?.lastSeq)&&Number.isSafeInteger(row.starliPublicRun?.lastSeq)&&old.starliPublicRun.lastSeq>row.starliPublicRun.lastSeq)continue;
  messages[key]={...row};
  if(row.role==='assistant'&&row.done!==true&&typeof row.content==='string'&&typeof old?.content==='string'&&old.content.startsWith(row.content))messages[key].content=old.content;
 }
 return {...local,messages,currentId:current};
}
export function applyExternalNativeDelta(history:any,event:any,chatId:string){
 if(event?.version!=='starli.run.v1'||event.type!=='run.text.delta'||event.conversationId!==chatId)return history;
 const row=history.messages?.[event.assistantMessageId],run=row?.starliPublicRun;
 if(row?.role!=='assistant'||row.done===true||!run||run.version!=='starli.run.v1')return history;
 if(['runId','requestId','conversationId','assistantMessageId','agentId'].some(key=>!id(event[key])||event[key]!==run[key]))return history;
 if(typeof event.text!=='string'||!Number.isSafeInteger(event.textOffset)||event.textOffset<0||!Number.isSafeInteger(event.textEnd))return history;
 const incoming=Array.from(event.text),existing=Array.from(typeof row.content==='string'?row.content:'');
 if(incoming.length>20000||event.textEnd!==event.textOffset+incoming.length||event.textEnd>2000000)return history;
 if(event.textOffset!==existing.length)return history; // Duplicate or gap: canonical refresh settles it.
 const message={...row,content:existing.join('')+event.text};
 return {...history,messages:{...history.messages,[row.id]:message}};
}
