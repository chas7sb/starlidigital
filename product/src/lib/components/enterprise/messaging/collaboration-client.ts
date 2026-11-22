import {CompanyClient} from '$lib/utils/company-workspace';
export type TeamRun={version:string;runId:string;companyId:string;conversationId:string;bossId:string;teammateIds:string[];sourceMessageId:string;state:string;round:number;modelCalls:number;stopRequested:boolean;confirmedStopped:boolean;needsReview:boolean;errorCode?:string;messages?:{botId:string;kind:string;content:string;state:string;messageId:string|null}[]};
const states=['QUEUED','RUNNING','STOP_REQUESTED','STOP_PENDING','UNCERTAIN','COMPLETED','CANCELLED','DENIED','FAILED','BUDGET_EXHAUSTED'];
export function verifiedTeamRun(value:any,companyId:string,roomId:string,runId?:string):TeamRun{
 if(value?.version!=='starli.collaboration.run.v1'||value.companyId!==companyId||value.conversationId!==roomId||typeof value.runId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(value.runId)||runId&&value.runId!==runId||!states.includes(value.state)||typeof value.bossId!=='string'||!Array.isArray(value.teammateIds)||value.teammateIds.some((id:any)=>typeof id!=='string')||typeof value.sourceMessageId!=='string'||!Number.isSafeInteger(value.modelCalls)||value.modelCalls<0||!Number.isSafeInteger(value.round)||typeof value.stopRequested!=='boolean'||typeof value.confirmedStopped!=='boolean'||typeof value.needsReview!=='boolean')throw Error('The team run scope or status could not be verified.');
 if(value.confirmedStopped&&value.state!=='CANCELLED')throw Error('Stop confirmation has an invalid state.');
 if(value.messages!==undefined&&(!Array.isArray(value.messages)||value.messages.some((m:any)=>typeof m.botId!=='string'||typeof m.content!=='string'||typeof m.state!=='string'||typeof m.kind!=='string'||m.messageId!==null&&typeof m.messageId!=='string')))throw Error('The team transcript could not be verified.');
 return value;
}
export class CollaborationClient{
 private client:CompanyClient;
 private base:string;
 constructor(private companyId:string,private roomId:string,tokenNow:()=>string,transport:typeof fetch=fetch){this.client=new CompanyClient(companyId,tokenNow,transport,true);this.base='/rooms/'+encodeURIComponent(roomId);}
 close(){this.client.close();}
 async context(){const room=await this.client.request(this.base);if(room.companyId!==this.companyId||room.id!==this.roomId||!Array.isArray(room.agentIds))throw Error('Conversation membership could not be verified.');const page=await this.client.request(this.base+'/messages?after='+Math.max(0,(room.lastMessageSequence||0)-99)+'&limit=100');if(!Array.isArray(page.messages)||page.messages.some((m:any)=>m.roomId!==this.roomId))throw Error('Conversation messages changed scope.');return {room,messages:page.messages};}
 async start(input:{bossId:string;teammateIds:string[];sourceMessageId:string;idempotencyKey:string}){const {idempotencyKey,...body}=input;return verifiedTeamRun(await this.client.request(this.base+'/collaborations','POST',body,idempotencyKey),this.companyId,this.roomId);}
 async read(runId:string){return verifiedTeamRun(await this.client.request(this.base+'/collaborations/'+encodeURIComponent(runId)),this.companyId,this.roomId,runId);}
 async stop(runId:string){return verifiedTeamRun(await this.client.request(this.base+'/collaborations/'+encodeURIComponent(runId)+'/stop','POST'),this.companyId,this.roomId,runId);}
}
