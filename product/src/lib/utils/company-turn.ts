export type CompanyTurn={version:'starli.company-bot-turn.v1';runId:string;companyId:string;conversationId:string;botId:string;userMessageId:string;assistantMessageId:string;status:string};
export type ToolActivity={id:string;name:string;status:string};
export type TurnProjection={cursor:number;status:string;tools:ToolActivity[]};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(v);
export function verifiedCompanyTurn(value:any,companyId:string,roomId:string,assistantId?:string):CompanyTurn|null{
 if(value?.version!=='starli.company-bot-turn.v1'||value.companyId!==companyId||value.conversationId!==roomId||!['runId','botId','userMessageId','assistantMessageId'].every(k=>id(value[k]))||assistantId&&value.assistantMessageId!==assistantId)return null;
 return value;
}
export function projectCompanyEvent(turn:CompanyTurn,state:TurnProjection,event:any):TurnProjection{
 if(event?.runId!==turn.runId||event.assistantMessageId!==turn.assistantMessageId||!Number.isSafeInteger(event.cursor)||event.cursor<=state.cursor)return state;
 if(!['starli.company-bot-event.v1','starli.tool.v1'].includes(event.version))return state;
 if(event.type==='text.delta'&&typeof event.text==='string')return {...state,cursor:event.cursor};
 if(event.type==='turn.state'&&['QUEUED','RUNNING','ANSWERED','FAILED','CANCELLED','UNCERTAIN'].includes(event.status))return {...state,cursor:event.cursor,status:event.status};
 if(event.type==='tool.lifecycle'&&id(event.toolCallId)&&typeof event.publicToolName==='string'&&event.publicToolName.length<=100&&['RUNNING','COMPLETED','FAILED','UNCERTAIN'].includes(event.status)){
  const row={id:event.toolCallId,name:event.publicToolName,status:event.status},tools=state.tools.filter(t=>t.id!==row.id);if(tools.length>=64)return state;return {...state,cursor:event.cursor,tools:[...tools,row]};
 }
 return state;
}
export const turnFinished=(status:string)=>['ANSWERED','FAILED','CANCELLED','UNCERTAIN'].includes(status);
export function companyTurnPath(turn:CompanyTurn){return '/api/v1/starli/companies/'+encodeURIComponent(turn.companyId)+'/rooms/'+encodeURIComponent(turn.conversationId)+'/bots/'+encodeURIComponent(turn.botId)+'/runtime/turns/'+encodeURIComponent(turn.runId);}
export async function readCompanyEvents(response:Response,signal:AbortSignal,onEvent:(event:any)=>void){
 if(!response.headers.get('content-type')?.includes('text/event-stream')||!response.body)throw Error('Live activity unavailable.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
 try{while(!signal.aborted){const part=await reader.read();if(part.done)break;buffer=(buffer+decoder.decode(part.value,{stream:true})).replace(/\r\n/g,'\n');if(buffer.length>262144)throw Error('Live activity packet exceeded its limit.');let end:number;while((end=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=packet.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data){try{onEvent(JSON.parse(data));}catch{/* Invalid packets never become a transcript or tool state. */}}}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
