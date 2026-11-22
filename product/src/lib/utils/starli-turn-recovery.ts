import {publicRunBinding} from '$lib/utils/starli-message-activity';
export type RejectedTurn={userMessageId:string;assistantMessageIds:string[];anchorId:string|null};
export type RecoveryScope={ownerId:string;chatId:string};
const ident=(x:any):x is string=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(x);
export function nativeTurnFinished(message:any,chatId:string){
 const run=publicRunBinding(message?.starliPublicRun);
 return !!run&&run.conversationId===chatId&&run.assistantMessageId===message.id&&['ANSWERED','COMPLETED','FAILED','DENIED','CANCELLED','INTERRUPTED','NEEDS_INPUT','WAITING_INPUT','BUDGET_EXHAUSTED'].includes(run.status);
}
export function strandedPreparation(history:any):RejectedTurn|null {
 const last=history.messages?.[history.currentId],row=history.messages?.[last?.parentId];
 if(last?.starliLocalPreparationFailure!==true||last.role!=='assistant'||last.content||last.starliPublicRun||row?.role!=='user'||!ident(last.id)||!ident(row.id))return null;
 return {userMessageId:row.id,assistantMessageIds:[last.id],anchorId:row.parentId??null};
}
/** Read-only authority recovery. The caller must not resubmit execution after this returns. */
export async function recoverNativeTurn(readCanonical:()=>Promise<any>,current:()=>boolean,history:any,scope:RecoveryScope,attempt:RejectedTurn){
 if(!current())throw Error('The conversation changed during history refresh.');
 const remote=await readCanonical();
 if(!current())throw Error('The conversation changed during history refresh.');
 return reconcileRejectedTurn(history,remote,scope,attempt);
}
export function reconcileRejectedTurn(local:any,remote:any,scope:RecoveryScope,attempt:RejectedTurn){
 return reconcileCanonicalHead(local,remote,scope,attempt);
}
export function reconcileCanonicalHead(local:any,remote:any,scope:RecoveryScope,attempt:RejectedTurn|null=null){
 const h=remote?.chat?.history,rows=h?.messages;
 if(!ident(scope.ownerId)||!ident(scope.chatId)||remote?.id!==scope.chatId||remote?.user_id!==scope.ownerId||!rows||typeof rows!=='object'||Array.isArray(rows)||
  (attempt&&(!ident(attempt.userMessageId)||!attempt.assistantMessageIds.length||attempt.assistantMessageIds.some(x=>!ident(x))||new Set([attempt.userMessageId,...attempt.assistantMessageIds]).size!==attempt.assistantMessageIds.length+1)))throw Error('Owned conversation history could not be confirmed.');
 const head=h.currentId??null;if(head!==null&&(!ident(head)||!rows[head]))throw Error('The canonical conversation head is unavailable.');
 const anchor=attempt?attempt.anchorId:local.currentId??null;
 if(anchor!==null&&(!ident(anchor)||!rows[anchor]))throw Error('The conversation moved to another branch. Your text is kept.');
 // Only a current head on the same canonical branch may become the next parent.
 let cursor=head;const seen=new Set();let reached=cursor===anchor;
 while(cursor!==null&&!reached){if(seen.has(cursor)||!rows[cursor]||rows[cursor].id!==cursor)throw Error('Invalid conversation ancestry.');seen.add(cursor);cursor=rows[cursor].parentId??null;reached=cursor===anchor;}
 if(!reached||(anchor===null&&head!==null&&(!attempt||!rows[attempt.userMessageId])))throw Error('The conversation moved to another branch. Your text is kept.');
 const all=attempt?[attempt.userMessageId,...attempt.assistantMessageIds]:[],present=all.filter(id=>rows[id]);
 if(present.length!==0&&present.length!==all.length)throw Error('Turn admission is uncertain. Your text is kept; no new run was started.');
 const admitted=!!attempt&&present.length===all.length;
 if(admitted&&(rows[attempt.userMessageId].role!=='user'||rows[attempt.userMessageId].parentId!==anchor||attempt.assistantMessageIds.some(id=>rows[id].role!=='assistant'||rows[id].parentId!==attempt.userMessageId)))throw Error('Turn admission did not match its original branch.');
 const messages={...local.messages};
 // Delete only the exact optimistic pair proven absent from authoritative history.
 if(!admitted){for(const id of all)delete messages[id];for(const [id,row]of Object.entries(messages) as any)if(Array.isArray(row.childrenIds)&&row.childrenIds.some((x:string)=>all.includes(x)))messages[id]={...row,childrenIds:row.childrenIds.filter((x:string)=>!all.includes(x))};}
 for(const [id,row]of Object.entries(rows) as any){
  if(!ident(id)||row?.id!==id||!['user','assistant','system'].includes(row.role))throw Error('Invalid canonical conversation message.');
  if(row.starliPublicRun){const run=publicRunBinding(row.starliPublicRun);if(!run||run.conversationId!==scope.chatId||run.assistantMessageId!==id)throw Error('Canonical run identity did not match this conversation.');}
  const next={...messages[id],...row};delete next.starliLocalPreparationFailure;
  if(row.role==='assistant'&&nativeTurnFinished(next,scope.chatId))next.done=true;
  messages[id]=next;
 }
 return {history:{...local,messages,currentId:head},currentId:head,admitted};
}
/** Called only for a fresh explicit user submit. One GET, no retry loop or background dispatch. */
export async function submitAfterCanonicalRead(options:{read:()=>Promise<any>;current:()=>boolean;history:any;scope:RecoveryScope;attempt:RejectedTurn|null;apply:(result:any)=>void;submit:(result:any)=>Promise<any>}){
 if(!options.current())throw Error('Your draft or conversation changed. Nothing was sent.');
 const remote=await options.read();
 if(!options.current())throw Error('Your draft or conversation changed. Nothing was sent.');
 const result=reconcileCanonicalHead(options.history,remote,options.scope,options.attempt);
 options.apply(result);
 if(result.admitted)throw Error('This turn is already recorded. No duplicate request was sent.');
 const head=result.currentId===null?null:result.history.messages[result.currentId];
 if(head&&(head.role!=='assistant'||(!nativeTurnFinished(head,options.scope.chatId)&&!(head.done===true&&!head.starliPublicRun))))throw Error('The current response is still running or unconfirmed. Nothing was sent.');
 if(!options.current())throw Error('Your draft or conversation changed. Nothing was sent.');
 return options.submit(result);
}
