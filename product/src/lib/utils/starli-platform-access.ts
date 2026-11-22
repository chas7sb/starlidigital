export type ChatPlatformState={chatId:string;agentId:string|null;bound:boolean;enabled:boolean;effectiveEnabled:boolean};
export function validateChatPlatformResponse(data:any,chatId:string,expectedAgentId?:string):ChatPlatformState{
 const validAgent=typeof data?.agentId==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(data.agentId);
 if(data?.chatId!==chatId||typeof data.enabled!=='boolean'||typeof data.bound!=='boolean'||typeof data.effectiveEnabled!=='boolean'||(data.bound?!validAgent:data.agentId!==null)||data.enabled&&!data.bound||data.effectiveEnabled&&!data.enabled||expectedAgentId&&data.agentId!==expectedAgentId)throw Error('Platform access response did not match this conversation');
 return data;
}
export async function readChatPlatformResponse(response:Response,chatId:string,expectedAgentId?:string){
 if(!response.headers.get('content-type')?.toLowerCase().includes('application/json'))throw Error('Conversation access is unavailable on this server. No permission was changed.');
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Error(typeof data?.detail==='string'?data.detail:'Platform access request failed ('+response.status+')');
 return validateChatPlatformResponse(data,chatId,expectedAgentId);
}
