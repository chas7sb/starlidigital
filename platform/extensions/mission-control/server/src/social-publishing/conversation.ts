import type {SocialConnectionTruthSnapshot} from './connection-truth.js';
import type {SocialPostPlan,SocialPublishJob,SocialPlatform} from './types.js';

export type SocialConversationCardKind='DRAFT_STATUS'|'PLATFORM_SELECTION'|'SCHEDULE_PROPOSAL'|'APPROVAL_REQUIRED'|'CONNECTION_REQUIRED'|'PROVIDER_RECEIPT'|'PARTIAL_FAILURE'|'ANALYTICS_AVAILABILITY';
export type SocialConversationCardState='RECORDED'|'ACTION_REQUIRED'|'WAITING_PROVIDER'|'CONFIRMED'|'UNAVAILABLE';
export type SocialConversationAction='OPEN_SOCIAL'|'OPEN_APPROVALS';

export interface SocialConversationCard{
  id:string;
  kind:SocialConversationCardKind;
  state:SocialConversationCardState;
  title:string;
  detail:string;
  planId?:string;
  jobId?:string;
  platforms:SocialPlatform[];
  schedule?:{mode:'SCHEDULE'|'QUEUE';publishAt?:string;timezone?:string};
  action?:SocialConversationAction;
}

const uniquePlatforms=(plan:SocialPostPlan)=>[...new Set(plan.variants.map(v=>v.platform))];
const latestJobFor=(jobs:SocialPublishJob[],planId:string)=>jobs.filter(j=>j.planId===planId).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))[0];

export function projectSocialConversation(input:{plans:SocialPostPlan[];jobs:SocialPublishJob[];connectionTruth:SocialConnectionTruthSnapshot}):SocialConversationCard[]{
  const cards:SocialConversationCard[]=[];
  const plans=[...input.plans].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,20);
  for(const plan of plans){
    const platforms=uniquePlatforms(plan);
    const job=latestJobFor(input.jobs,plan.id);
    cards.push({id:`draft:${plan.id}`,kind:'DRAFT_STATUS',state:'RECORDED',title:'Social draft prepared',detail:`A draft is recorded for ${platforms.length} platform${platforms.length===1?'':'s'}. No external publish is implied.`,planId:plan.id,platforms});
    cards.push({id:`platforms:${plan.id}`,kind:'PLATFORM_SELECTION',state:'RECORDED',title:'Platforms selected',detail:platforms.join(' · ')||'No platform selected',planId:plan.id,platforms});

    const blocked=plan.variants.filter(v=>{const truth=input.connectionTruth.connections.find(c=>c.id===v.connectionId);return !truth||truth.state!=='CONNECTED';});
    if(blocked.length){
      const reconnect=blocked.some(v=>input.connectionTruth.connections.find(c=>c.id===v.connectionId)?.reconnectRequired);
      cards.push({id:`connection:${plan.id}`,kind:'CONNECTION_REQUIRED',state:'ACTION_REQUIRED',title:reconnect?'Reconnect a social account':'Social connection required',detail:reconnect?'At least one selected account needs reauthentication before governed publishing can continue.':'At least one selected platform is not currently connected. Draft preparation remains safe.',planId:plan.id,platforms:[...new Set(blocked.map(v=>v.platform))],action:'OPEN_SOCIAL'});
    }

    if(plan.schedule.mode==='SCHEDULE'||plan.schedule.mode==='QUEUE'){
      cards.push({id:`schedule:${plan.id}`,kind:'SCHEDULE_PROPOSAL',state:job?job.state==='SCHEDULED'?'CONFIRMED':job.state==='PUBLISHING'?'WAITING_PROVIDER':'RECORDED':'RECORDED',title:plan.schedule.mode==='SCHEDULE'?'Schedule proposed':'Queue proposed',detail:job?.state==='SCHEDULED'?'Provider receipt confirms the schedule.':job?.state==='PUBLISHING'?'Waiting for the provider receipt before calling this scheduled.':'This is a recorded proposal only; it is not scheduled until the governed provider path returns a receipt.',planId:plan.id,jobId:job?.id,platforms,schedule:{mode:plan.schedule.mode,publishAt:plan.schedule.publishAt,timezone:plan.schedule.timezone}});
      if(!plan.approvalReference&&!job){cards.push({id:`approval:${plan.id}`,kind:'APPROVAL_REQUIRED',state:'ACTION_REQUIRED',title:'Approval required before publishing',detail:'Scheduling or publishing is an external side effect. Review the governed approval before Starli can invoke a provider.',planId:plan.id,platforms,action:'OPEN_APPROVALS'});}
    }

    if(job){
      if(job.state==='PARTIAL_SUCCESS')cards.push({id:`partial:${job.id}`,kind:'PARTIAL_FAILURE',state:'ACTION_REQUIRED',title:'Some platforms did not complete',detail:job.results.map(r=>`${r.platform}: ${r.state.replaceAll('_',' ')}`).join(' · '),planId:plan.id,jobId:job.id,platforms});
      else cards.push({id:`receipt:${job.id}`,kind:'PROVIDER_RECEIPT',state:['PUBLISHED','SCHEDULED','QUEUED'].includes(job.state)?'CONFIRMED':job.state==='PUBLISHING'?'WAITING_PROVIDER':job.state==='FAILED'||job.state==='NEEDS_REAUTH'?'ACTION_REQUIRED':'RECORDED',title:['PUBLISHED','SCHEDULED','QUEUED'].includes(job.state)?'Provider receipt recorded':'Provider outcome',detail:job.results.length?job.results.map(r=>`${r.platform}: ${r.state.replaceAll('_',' ')}`).join(' · '):'Provider work is in progress; no completed provider receipt has been recorded yet.',planId:plan.id,jobId:job.id,platforms});
    }
  }
  cards.push({id:'analytics:availability',kind:'ANALYTICS_AVAILABILITY',state:input.connectionTruth.analytics.availability==='AVAILABLE'?'CONFIRMED':input.connectionTruth.analytics.availability==='UNAVAILABLE'?'UNAVAILABLE':'RECORDED',title:input.connectionTruth.analytics.availability==='AVAILABLE'?'Verified social analytics available':input.connectionTruth.analytics.availability==='NO_VERIFIED_DATA'?'No verified analytics yet':'Social analytics unavailable',detail:input.connectionTruth.analytics.detail,platforms:[]});
  return cards.slice(0,60);
}
