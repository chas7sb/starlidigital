import {publicRunBinding} from './starli-message-activity';
const terminal=new Set(['ANSWERED','COMPLETED','FAILED','DENIED','CANCELLED','INTERRUPTED']);
const paused=new Set(['NEEDS_INPUT','WAITING_INPUT','BUDGET_EXHAUSTED']);
export function durableMessageDone(metadata:any,fallback:boolean):boolean{
 const run=publicRunBinding(metadata);return run?terminal.has(run.status)||paused.has(run.status):fallback;
}
export function canStopRun(metadata:any,chatId:string,messageId:string):boolean{
 const run=publicRunBinding(metadata);return !!run&&run.conversationId===chatId&&run.assistantMessageId===messageId&&!terminal.has(run.status);
}
export function runElapsed(createdAt:unknown,now:number):string|null{
 if(typeof createdAt!=='number'||!Number.isFinite(createdAt)||createdAt<=0||createdAt*1000>now)return null;
 const seconds=Math.floor((now-createdAt*1000)/1000);
 const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
 return hours?hours+'h '+minutes+'m':minutes?minutes+'m '+seconds%60+'s':seconds+'s';
}
