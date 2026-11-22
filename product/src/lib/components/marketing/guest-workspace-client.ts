export type GuestMessage={id:string;role:'user'|'assistant';content:string};
export type GuestWorkspace={intentId:string;requestId:string;originalPrompt:string;messages:GuestMessage[];replyState:string};
export function validateGuestWorkspace(raw:any,intentId:string):GuestWorkspace{
 if(!raw||raw.intentId!==intentId||typeof raw.requestId!=='string'||!raw.requestId||
 typeof raw.originalPrompt!=='string'||!Array.isArray(raw.messages)||!raw.messages.length||
 typeof raw.replyState!=='string')throw Error('Guest workspace could not be verified.');
 const seen=new Set();
 for(const m of raw.messages){
  if(!m||typeof m.id!=='string'||!m.id||seen.has(m.id)||!['user','assistant'].includes(m.role)||typeof m.content!=='string')
   throw Error('Guest message history could not be verified.');
  seen.add(m.id);
 }
 if(raw.messages[0].role!=='user'||raw.messages[0].content!==raw.originalPrompt)throw Error('Original request does not match this workspace.');
 return raw;
}
export async function guestWorkspaceRequest(intentId:string,signal:AbortSignal,turn?:{requestId:string;content?:string;replyToMessageId?:string},fetcher:typeof fetch=fetch){
 if(!/^[a-f0-9]{40}$/i.test(intentId))throw Error('Invalid guest workspace.');
 const base='/api/v1/starli/public/grokbot1/intents/'+encodeURIComponent(intentId)+'/workspace';
 const response=await fetcher(base+(turn?'/messages':''),{
  method:turn?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(turn?65000:15000)]),
  headers:{Accept:'application/json',...(turn?{'Content-Type':'application/json','X-Starli-Guest-Intent':'1'}:{})},
  ...(turn?{body:JSON.stringify(turn)}:{})
 });
 if(!response.ok)throw Error(response.status===403||response.status===401?'This guest workspace is unavailable for your current session.':response.status===409?'The reply is still being processed. Check again shortly.':'Guest workspace is unavailable. Please try again.');
 return validateGuestWorkspace(await response.json(),intentId);
}
