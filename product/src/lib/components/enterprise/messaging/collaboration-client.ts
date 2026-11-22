import {CompanyClient} from '$lib/utils/company-workspace';
export type ParticipantCoverage={selectedIds:string[];repliedIds:string[];missingIds:string[]};
export type TeamRun={version:string;runId:string;companyId:string;conversationId:string;bossId:string;teammateIds:string[];sourceMessageId:string;state:string;storedState?:string;participantCoverage?:ParticipantCoverage;round:number;modelCalls:number;stopRequested:boolean;confirmedStopped:boolean;needsReview:boolean;errorCode?:string;messages?:{botId:string;kind:string;content:string;state:string;messageId:string|null}[]};
const states=['QUEUED','RUNNING','STOP_REQUESTED','STOP_PENDING','UNCERTAIN','COMPLETED','CANCELLED','DENIED','FAILED','BUDGET_EXHAUSTED'];
function validCoverage(value:any,team:string[]):value is ParticipantCoverage{
 if(!value||!['selectedIds','repliedIds','missingIds'].every(key=>Array.isArray(value[key])&&value[key].every((id:any)=>typeof id==='string')&&new Set(value[key]).size===value[key].length))return false;
 const equal=(left:string[],right:string[])=>left.length===right.length&&left.every((id,index)=>id===right[index]);
 const replied=new Set(value.repliedIds),missing=new Set(value.missingIds);
 return equal(value.selectedIds,team)&&value.repliedIds.every((id:string)=>team.includes(id)&&!missing.has(id))&&value.missingIds.every((id:string)=>team.includes(id)&&!replied.has(id))&&team.every(id=>replied.has(id)||missing.has(id))&&equal(value.repliedIds,team.filter(id=>replied.has(id)))&&equal(value.missingIds,team.filter(id=>missing.has(id)));
}
export function incompleteReviewFingerprint(run:TeamRun|null):string{
 if(!run||run.storedState!=='COMPLETED'||run.state!=='FAILED'||run.errorCode!=='COLLABORATION_TEAM_COVERAGE_INCOMPLETE'||run.needsReview!==true||run.stopRequested||run.confirmedStopped||!validCoverage(run.participantCoverage,run.teammateIds)||!run.participantCoverage.missingIds.length||!Array.isArray(run.messages)||run.messages.some(message=>message.state!=='POSTED'||typeof message.messageId!=='string'||!message.messageId))return '';
 return JSON.stringify([run.companyId,run.conversationId,run.runId,run.sourceMessageId,run.participantCoverage,run.messages.map(message=>[message.botId,message.kind,message.messageId])]);
}
export function teamRunBlocksStart(run:TeamRun|null,reviewedFingerprint=''):boolean{
 if(!run)return false;
 if(run.storedState&&['QUEUED','RUNNING','STOP_REQUESTED','STOP_PENDING','UNCERTAIN'].includes(run.storedState))return true;
 if(run.messages?.some(message=>message.state!=='POSTED'||!message.messageId))return true;
 if(!['COMPLETED','CANCELLED','DENIED','FAILED','BUDGET_EXHAUSTED','UNCERTAIN'].includes(run.state))return true;
 if(run.state==='UNCERTAIN')return true;
 if(!run.needsReview)return false;
 const expected=incompleteReviewFingerprint(run);
 return !expected||expected!==reviewedFingerprint;
}
export function verifiedTeamRun(value:any,companyId:string,roomId:string,runId?:string):TeamRun{
 if(value?.version!=='starli.collaboration.run.v1'||value.companyId!==companyId||value.conversationId!==roomId||typeof value.runId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(value.runId)||runId&&value.runId!==runId||!states.includes(value.state)||typeof value.bossId!=='string'||!Array.isArray(value.teammateIds)||value.teammateIds.some((id:any)=>typeof id!=='string')||typeof value.sourceMessageId!=='string'||!Number.isSafeInteger(value.modelCalls)||value.modelCalls<0||!Number.isSafeInteger(value.round)||typeof value.stopRequested!=='boolean'||typeof value.confirmedStopped!=='boolean'||typeof value.needsReview!=='boolean')throw Error('The team run scope or status could not be verified.');
 if(value.confirmedStopped&&value.state!=='CANCELLED')throw Error('Stop confirmation has an invalid state.');
 if(!value.teammateIds.length||value.teammateIds.length>4||new Set(value.teammateIds).size!==value.teammateIds.length||value.teammateIds.includes(value.bossId))throw Error('The selected team is invalid.');
 if(value.storedState!==undefined&&!states.includes(value.storedState))throw Error('The stored team run state is invalid.');
 if(value.participantCoverage!==undefined&&!validCoverage(value.participantCoverage,value.teammateIds))throw Error('Team participant coverage could not be verified.');
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
