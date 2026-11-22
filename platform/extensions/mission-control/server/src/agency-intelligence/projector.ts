import type {Events} from '../events.js';
import type {RecordData,Store,StoreChange} from '../store.js';
import {AgencyIntelligenceService} from './service.js';
import {AutonomyPolicyService} from '../autonomy-policy/service.js';
import {AgencyApprovalService} from '../agency-approvals/service.js';

const VISITOR='visitor-sessions', CONVERSATIONS='hosted-agent-conversations', LEADS='hosted-agent-leads', AGENTS='hosted-agent-agents';
const ACTIVE_MS=90_000;
const safeIso=(value:unknown,fallback:number)=>{const parsed=Date.parse(typeof value==='string'?value:'');return Number.isFinite(parsed)?new Date(parsed).toISOString():new Date(fallback).toISOString();};
const active=(session:RecordData,clock:()=>number)=>!!session.enabled&&!session.dismissed&&clock()-Number(session.lastSeen||0)<ACTIVE_MS;

export class AgencyIntelligenceProjector{
  private intelligence:AgencyIntelligenceService;
  private policy:AutonomyPolicyService;
  private approvals:AgencyApprovalService;
  private unsubscribe:()=>void;
  constructor(private store:Store,events?:Events,private clock=()=>Date.now()){
    this.intelligence=new AgencyIntelligenceService(store,events,clock);
    this.policy=new AutonomyPolicyService(store,events);
    this.approvals=new AgencyApprovalService(store,events,clock);this.approvals.reconcilePlans();
    this.unsubscribe=store.onChange(change=>{try{this.capture(change);}catch{}});
    const recent=store.list(VISITOR).filter(session=>Number(session.lastSeen||0)>clock()-86_400_000).sort((a,b)=>Number(b.lastSeen||0)-Number(a.lastSeen||0)).slice(0,500);
    for(const session of recent)try{this.projectSession(session);}catch{}
  }
  close(){this.unsubscribe();}
  private tenantForAgent(agentId:unknown){const agent=typeof agentId==='string'?this.store.get(AGENTS,agentId):undefined;return agent?.ownerId?String(agent.ownerId):null;}
  private sessionForConversation(conversationId:unknown){return this.store.list(VISITOR).find(session=>session.conversationId===conversationId);}
  private capture(change:StoreChange){
    if(change.collection===VISITOR){if(change.after)this.projectSession(change.after);else if(change.before)this.purgeSession(change.before);return;}
    if(change.collection===CONVERSATIONS&&change.after){const session=this.sessionForConversation(change.after.id);if(session)this.projectSession(session);return;}
    if(change.collection===LEADS&&change.after)this.projectLead(change.after);
  }
  private purgeSession(session:RecordData){const tenant=this.tenantForAgent(session.agentId);if(tenant){this.intelligence.purgeSessionContext(tenant,String(session.id),[String(session.conversationId||'')].filter(Boolean));this.approvals.pruneOrphans(tenant);}}
  private projectSession(session:RecordData){
    const tenantId=this.tenantForAgent(session.agentId);if(!tenantId)return;
    if(!session.enabled){this.intelligence.purgeSessionContext(tenantId,String(session.id),[String(session.conversationId||'')].filter(Boolean));this.approvals.pruneOrphans(tenantId);return;}
    let profile=this.intelligence.createProfile({tenantId,agentId:String(session.agentId),sessionRef:String(session.id),dismissed:!!session.dismissed});
    const firstSeen=Number(session.firstSeen||session.lastSeen||this.clock());
    this.safeEvidence(tenantId,profile.id,{kind:'SESSION' as const,sourceRef:{kind:'visitor_session',id:String(session.id)},observedAt:new Date(firstSeen).toISOString(),category:'first-party-session'});
    const history=Array.isArray(session.pageHistory)?session.pageHistory.slice(-20):[];
    for(const entry of history){const route=typeof entry?.route==='string'?entry.route:'',at=Number(entry?.at||firstSeen);if(!route)continue;this.safeEvidence(tenantId,profile.id,{kind:'ROUTE' as const,sourceRef:{kind:'visitor_session',id:String(session.id)},observedAt:new Date(Number.isFinite(at)?at:firstSeen).toISOString(),category:route});}
    if(session.campaign)this.safeEvidence(tenantId,profile.id,{kind:'CAMPAIGN' as const,sourceRef:{kind:'visitor_session',id:String(session.id)},observedAt:new Date(firstSeen).toISOString(),category:String(session.campaign)});
    if(session.referrer)this.safeEvidence(tenantId,profile.id,{kind:'REFERRER' as const,sourceRef:{kind:'visitor_session',id:String(session.id)},observedAt:new Date(firstSeen).toISOString(),category:'referrer-origin',value:String(session.referrer).slice(0,120)});
    const conversation=session.conversationId?this.store.get(CONVERSATIONS,String(session.conversationId)):undefined;
    if(conversation&&Array.isArray(conversation.messages)&&conversation.messages.length){this.safeEvidence(tenantId,profile.id,{kind:'CONVERSATION_STATE' as const,sourceRef:{kind:'hosted_agent_conversation',id:String(conversation.id)},observedAt:safeIso(conversation.updatedAt,this.clock()),category:'conversation-active'});}
    profile=this.intelligence.getProfile(tenantId,profile.id);
    if(active(session,this.clock)){
      this.detectAndPlan({tenantId,kind:'ACTIVE_ENGAGED_VISITOR' as const,entityRefs:[{kind:'visitor_profile',id:profile.id}],evidenceRefs:profile.evidenceRefs,now:new Date(this.clock()).toISOString(),active:true,engagementScore:profile.engagementScore.value,dismissed:profile.dismissed,doNotContact:profile.doNotContact,optOut:profile.consentRefs.some(c=>c.status==='DENIED')});
      const counts=new Map<string,number>();for(const entry of history){if(typeof entry?.route==='string')counts.set(entry.route,(counts.get(entry.route)||0)+1);}const repeated=Math.max(0,...counts.values());
      if(repeated>=2)this.detectAndPlan({tenantId,kind:'REPEATED_ROUTE_INTEREST' as const,entityRefs:[{kind:'visitor_profile',id:profile.id}],evidenceRefs:profile.evidenceRefs,now:new Date(this.clock()).toISOString(),repeatedInterestCount:repeated,dismissed:profile.dismissed,doNotContact:profile.doNotContact,optOut:profile.consentRefs.some(c=>c.status==='DENIED')});
    }
    if(conversation&&conversation.status!=='ACTIVE'&&Array.isArray(conversation.messages)&&conversation.messages.length)this.detectAndPlan({tenantId,kind:'ABANDONED_AGENT_CONVERSATION' as const,entityRefs:[{kind:'visitor_profile',id:profile.id},{kind:'conversation',id:String(conversation.id)}],evidenceRefs:profile.evidenceRefs,now:new Date(this.clock()).toISOString(),abandoned:true,dismissed:profile.dismissed,doNotContact:profile.doNotContact,optOut:profile.consentRefs.some(c=>c.status==='DENIED')});
  }
  private projectLead(lead:RecordData){
    const tenantId=this.tenantForAgent(lead.agentId);if(!tenantId)return;const session=this.sessionForConversation(lead.conversationId);if(!session||!session.enabled)return;
    const profile=this.intelligence.createProfile({tenantId,agentId:String(lead.agentId),sessionRef:String(session.id),dismissed:!!session.dismissed});
    const evidence=this.safeEvidence(tenantId,profile.id,{kind:'EXPLICIT_CONTACT' as const,sourceRef:{kind:'hosted_agent_lead',id:String(lead.id)},observedAt:safeIso(lead.createdAt,this.clock()),category:'lead-captured',value:'explicit-contact-captured',authoritativeIdentity:true});
    if(evidence)this.intelligence.linkIdentity(tenantId,profile.id,{evidenceId:evidence.id,contactRef:{kind:'hosted_agent_lead',id:String(lead.id)},asLead:true});
  }
  private safeEvidence(tenantId:string,profileId:string,input:any){try{return this.intelligence.addEvidence(tenantId,profileId,input);}catch{return null;}}
  private detectAndPlan(observation:any){const opportunity=this.intelligence.detect(observation);if(opportunity?.status==='OPEN'&&this.policy.canPreparePlans(observation.tenantId))try{const plan=this.intelligence.plan(observation.tenantId,opportunity.id);if(plan?.approvalRequired)this.approvals.ensureForPlan(plan);}catch{}return opportunity;}
}

const activeProjectors=new WeakMap<Store,AgencyIntelligenceProjector>();
export function ensureAgencyIntelligenceProjector(store:Store,events?:Events,clock?:()=>number){const existing=activeProjectors.get(store);if(existing)return existing;const projector=new AgencyIntelligenceProjector(store,events,clock);activeProjectors.set(store,projector);return projector;}
