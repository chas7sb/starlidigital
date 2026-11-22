import type {GuestWorkspace} from './guest-workspace-client';
const id=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=256;
export function temporaryWorkspace(raw:any){
 const t=raw?.temporaryWorkspace;
 if(!t||t.principalKind!=='restricted_guest'||t.status!=='RESTRICTED_PROVISIONAL_ACTIVE'||
 !['companyId','projectId','roomId','companyName','roomName'].every(k=>id(t[k])))return null;
 return t as {companyId:string;projectId:string;roomId:string;companyName:string;roomName:string;principalKind:string;status:string};
}
export function guestBuild(raw:any){
 const b=raw?.build;
 if(!b||!id(b.buildId)||b.intentId!==raw.intentId||!['QUEUED','RUNNING','READY','INTERRUPTED'].includes(b.status)||
 !id(b.sourceMessageId)||!/^[a-f0-9]{64}$/i.test(b.conversationHash||'')||
 b.provider!=='openrouter'||b.model!=='nvidia/nemotron-3-ultra-550b-a55b:free'||
 !raw.messages?.some((m:any)=>m.id===b.sourceMessageId&&m.role==='user'))return null;
 return b;
}
export function activeGuestWork(raw:any){return raw?.replyState==='RUNNING'||['QUEUED','RUNNING'].includes(guestBuild(raw)?.status||'');}
export function verifiedHistoryTransfer(raw:any,nav:any,messages:GuestWorkspace['messages']):boolean{
 const transfer=raw?.claimTransfer;
 if(!transfer||transfer.complete!==true||transfer.companyId!==nav.companyId||transfer.roomId!==nav.channelRoomId||
 !Array.isArray(transfer.messageMap)||transfer.messageMap.length!==messages.length)return false;
 const originalIds=new Set(messages.map(m=>m.id)),mapped=new Set(),nativeIds=new Set();
 for(const entry of transfer.messageMap){
  if(!entry||!originalIds.has(entry.guestMessageId)||mapped.has(entry.guestMessageId)||!id(entry.nativeMessageId)||nativeIds.has(entry.nativeMessageId))return false;
  mapped.add(entry.guestMessageId);nativeIds.add(entry.nativeMessageId);
 }
 return mapped.size===originalIds.size;
}

export function verifiedOwnerResume(raw:any,nav:any,prior:GuestWorkspace|null):boolean{
 const transfer=raw?.claimTransfer;
 if(nav?.status!=='READY'||!raw?.intentId||nav.intentId!==raw.intentId||
 !nav.projectId||transfer?.projectId!==nav.projectId||
 !/^[a-f0-9]{64}$/i.test(transfer?.transcriptDigest||'')||
 raw.replyState!=='COMPLETE'||!raw.messages?.length||
 !verifiedHistoryTransfer(raw,nav,raw.messages))return false;
 if(!prior)return true;
 return prior.intentId===raw.intentId&&prior.requestId===raw.requestId&&prior.originalPrompt===raw.originalPrompt&&
 prior.messages.every((message,i)=>raw.messages[i]?.id===message.id&&raw.messages[i]?.role===message.role&&raw.messages[i]?.content===message.content);
}
