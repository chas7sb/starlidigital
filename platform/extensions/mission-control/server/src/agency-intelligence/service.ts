import { createHash } from 'node:crypto';
import type { Store } from '../store.js';
import type { Events } from '../events.js';
import type { AgencyActionPlan, AgencyObservation, BusinessOpportunity, ContactPreference, ConsentReference, EntityRef, NextBestAction, VisitorProfile, VisitorProfileEvidence } from './types.js';
import { assertSafeEvidence, bound } from './policy.js';
import { scoreEngagement } from './scoring.js';

const PROFILE='agency-visitor-profiles', EVIDENCE='agency-visitor-evidence', OPPS='agency-opportunities', PLANS='agency-action-plans';
const DAY=86400000;
const iso=(ms:number)=>new Date(ms).toISOString();
const hash=(v:string)=>createHash('sha256').update(v).digest('hex').slice(0,24);
const parse=(v:string)=>{const n=Date.parse(v); if(!Number.isFinite(n)) throw new Error('Invalid timestamp'); return n;};
const tenantSafe=(v:string)=>{ if(!/^[A-Za-z0-9_.:@-]{1,160}$/.test(v)) throw new Error('Invalid tenant'); return v; };
const uniq=<T>(items:T[])=>[...new Set(items)];

export class AgencyIntelligenceService {
  constructor(private store:Store, private events?:Events, private clock=()=>Date.now()){}
  createProfile(input:{tenantId:string;agentId?:string;sessionRef:string;dismissed?:boolean;doNotContact?:boolean;consentRefs?:ConsentReference[];contactPreferences?:ContactPreference[]}){
    const tenantId=tenantSafe(input.tenantId); if(!/^[A-Za-z0-9_.:-]{1,240}$/.test(input.sessionRef)) throw new Error('Invalid opaque session reference');
    const now=iso(this.clock()), id=`vp-${hash(tenantId+':'+input.sessionRef)}`;
    const existing=this.store.get(PROFILE,id) as VisitorProfile|undefined; if(existing&&existing.tenantId!==tenantId) throw new Error('Tenant boundary violation');
    const profile:VisitorProfile=existing||{id,tenantId,agentId:input.agentId,sessionRefs:[],lifecycleStage:'ANONYMOUS',interestCategories:[],intentSignals:[],engagementScore:{value:0,band:'LOW',reasons:[],version:'v1'},evidenceRefs:[],consentRefs:[],contactPreferences:[],doNotContact:false,dismissed:false,cooldowns:[],createdAt:now,updatedAt:now};
    profile.sessionRefs=bound(uniq([...profile.sessionRefs,input.sessionRef]),20); profile.dismissed=profile.dismissed||!!input.dismissed; profile.doNotContact=profile.doNotContact||!!input.doNotContact;
    profile.consentRefs=bound(input.consentRefs||profile.consentRefs,20); profile.contactPreferences=bound(input.contactPreferences||profile.contactPreferences,20); profile.updatedAt=now;
    this.store.put(PROFILE,profile,tenantId); return profile;
  }
  addEvidence(tenantId:string,profileId:string,input:Omit<VisitorProfileEvidence,'id'|'tenantId'>){
    const profile=this.getProfile(tenantId,profileId); assertSafeEvidence(input.kind,input.category,input.value);
    if(input.value && input.value.length>120) throw new Error('Evidence value too long'); if(input.category && !/^[A-Za-z0-9_.:/-]{1,80}$/.test(input.category)) throw new Error('Invalid evidence category');
    const id=`ve-${hash([tenantId,profileId,input.kind,input.sourceRef.kind,input.sourceRef.id,input.observedAt,input.category||'',input.value||''].join(':'))}`;
    const evidence:VisitorProfileEvidence={...input,id,tenantId}; this.store.put(EVIDENCE,evidence,tenantId);
    const previousRefs=[...profile.evidenceRefs]; profile.evidenceRefs=bound(uniq([...profile.evidenceRefs,id]),50);
    for(const dropped of previousRefs) if(!profile.evidenceRefs.includes(dropped)) this.store.remove(EVIDENCE,dropped); profile.interestCategories=bound(uniq([...profile.interestCategories,...(input.kind==='ROUTE'&&input.category?[input.category]:[])]),20);
    this.recompute(profile); this.store.put(PROFILE,profile,tenantId); return evidence;
  }
  linkIdentity(tenantId:string,profileId:string,input:{evidenceId:string;contactRef?:EntityRef;crmRef?:EntityRef;asLead?:boolean;asCustomer?:boolean}){
    const profile=this.getProfile(tenantId,profileId); const ev=this.getEvidence(tenantId,input.evidenceId);
    if(!ev.authoritativeIdentity || !['EXPLICIT_CONTACT','CRM_LINK'].includes(ev.kind)) throw new Error('Authoritative identity evidence required');
    profile.linkedContactRef=input.contactRef; profile.linkedCrmRef=input.crmRef; profile.lifecycleStage=input.asCustomer?'CUSTOMER':input.asLead?'LEAD':'IDENTIFIED'; profile.updatedAt=iso(this.clock());
    this.store.put(PROFILE,profile,tenantId); return profile;
  }
  getProfile(tenantId:string,id:string){const p=this.store.get(PROFILE,id) as VisitorProfile|undefined;if(!p||p.tenantId!==tenantSafe(tenantId))throw new Error('Visitor profile unavailable');return p;}
  getEvidence(tenantId:string,id:string){const e=this.store.get(EVIDENCE,id) as VisitorProfileEvidence|undefined;if(!e||e.tenantId!==tenantSafe(tenantId))throw new Error('Evidence unavailable');return e;}
  listOpportunities(tenantId:string){return this.store.list(OPPS,tenantSafe(tenantId)) as BusinessOpportunity[];}
  detect(obs:AgencyObservation):BusinessOpportunity|null {
    const tenantId=tenantSafe(obs.tenantId), now=parse(obs.now); if(obs.doNotContact||obs.dismissed||obs.optOut)return null;
    const spec=this.detectorSpec(obs,now); if(!spec)return null;
    const dedupeKey=hash(`${tenantId}:${obs.kind}:${obs.entityRefs.map(r=>r.kind+':'+r.id).sort().join('|')}`), id=`opp-${dedupeKey}`;
    const prior=this.store.get(OPPS,id) as BusinessOpportunity|undefined; if(prior&&prior.tenantId!==tenantId)throw new Error('Tenant boundary violation');
    if(prior&&prior.status==='DISMISSED')return null; if(prior&&parse(prior.cooldown.until)>now)return prior;
    const cooldown={key:`opp:${dedupeKey}`,until:iso(now+spec.cooldownMs),reason:'deterministic opportunity cooldown'};
    const record:BusinessOpportunity={id,tenantId,type:obs.kind,entityRefs:bound(obs.entityRefs,12),evidenceRefs:bound(uniq(obs.evidenceRefs),30),confidence:spec.confidence,priority:spec.priority,recommendedAction:spec.action,autonomyAllowed:spec.action.autonomyAllowed,approvalRequired:spec.action.approvalRequired,cooldown,status:'OPEN',dedupeKey,createdAt:prior?.createdAt||iso(now),updatedAt:iso(now)};
    this.store.put(OPPS,record,tenantId); const eventEntities:EntityRef[]=[{kind:'business_opportunity',id},...(record.entityRefs[0]?[record.entityRefs[0]]:[])]; this.events?.company({type:prior?'agency.opportunity.updated':'agency.opportunity.created',source:'agency-intelligence',entities:eventEntities,idempotencyKey:`agency:${id}:${record.updatedAt}`,payload:{opportunityType:record.type,confidence:record.confidence,priority:record.priority,status:record.status,evidenceCount:record.evidenceRefs.length,approvalRequired:record.approvalRequired}});
    return record;
  }
  plan(tenantId:string,opportunityId:string):AgencyActionPlan|null {
    const opp=this.store.get(OPPS,opportunityId) as BusinessOpportunity|undefined; if(!opp||opp.tenantId!==tenantSafe(tenantId))throw new Error('Opportunity unavailable');
    if(opp.status!=='OPEN')return null; const profileRef=opp.entityRefs.find(r=>r.kind==='visitor_profile'); if(profileRef){const p=this.getProfile(tenantId,profileRef.id); if(this.profileSuppressesAction(p,opp.recommendedAction.kind))return null;}
    const id=`plan-${hash(tenantId+':'+opportunityId+':'+opp.recommendedAction.kind)}`; const existing=this.store.get(PLANS,id) as AgencyActionPlan|undefined; if(existing)return existing;
    const plan:AgencyActionPlan={id,tenantId,opportunityId,status:'PROPOSED',action:opp.recommendedAction,entityRefs:opp.entityRefs,evidenceRefs:opp.evidenceRefs,capabilityRequirement:this.capabilityFor(opp.recommendedAction.kind),approvalRequired:opp.approvalRequired,autonomyAllowed:opp.autonomyAllowed,createdAt:iso(this.clock())};
    this.store.put(PLANS,plan,tenantId); this.events?.company({type:'agency.action.proposed',source:'agency-intelligence',entities:[{kind:'agency_action_plan',id},{kind:'business_opportunity',id:opportunityId}],idempotencyKey:`agency-plan:${id}`,payload:{actionKind:plan.action.kind,status:'PROPOSED',approvalRequired:plan.approvalRequired,autonomyAllowed:plan.autonomyAllowed,evidenceCount:plan.evidenceRefs.length}}); return plan;
  }
  dismiss(tenantId:string,opportunityId:string){const o=this.store.get(OPPS,opportunityId) as BusinessOpportunity|undefined;if(!o||o.tenantId!==tenantSafe(tenantId))throw new Error('Opportunity unavailable');o.status='DISMISSED';o.updatedAt=iso(this.clock());this.store.put(OPPS,o,tenantId);return o;}
  purgeSessionContext(tenantId:string,sessionRef:string,relatedSourceIds:string[]=[]){const tenant=tenantSafe(tenantId),sourceIds=new Set([sessionRef,...relatedSourceIds]);const profiles=(this.store.list(PROFILE,tenant) as VisitorProfile[]).filter(p=>p.sessionRefs.includes(sessionRef));for(const profile of profiles){const removed=new Set<string>();for(const evidenceId of profile.evidenceRefs){const evidence=this.store.get(EVIDENCE,evidenceId) as VisitorProfileEvidence|undefined;if(evidence&&sourceIds.has(evidence.sourceRef.id)){this.store.remove(EVIDENCE,evidenceId);removed.add(evidenceId);}}profile.evidenceRefs=profile.evidenceRefs.filter(id=>!removed.has(id));profile.sessionRefs=profile.sessionRefs.filter(ref=>ref!==sessionRef);this.recompute(profile);const keepIdentity=!!profile.linkedContactRef||!!profile.linkedCrmRef||profile.evidenceRefs.some(id=>{const e=this.store.get(EVIDENCE,id) as VisitorProfileEvidence|undefined;return !!e?.authoritativeIdentity;});const related=(this.store.list(OPPS,tenant) as BusinessOpportunity[]).filter(o=>o.entityRefs.some(ref=>ref.kind==='visitor_profile'&&ref.id===profile.id)&&['ACTIVE_ENGAGED_VISITOR','REPEATED_ROUTE_INTEREST','ABANDONED_AGENT_CONVERSATION','KNOWN_LEAD_RETURNED'].includes(o.type));for(const opportunity of related){for(const plan of this.store.list(PLANS,tenant) as AgencyActionPlan[])if(plan.opportunityId===opportunity.id)this.store.remove(PLANS,plan.id);this.store.remove(OPPS,opportunity.id);}if(!keepIdentity&&!profile.sessionRefs.length){for(const id of profile.evidenceRefs)this.store.remove(EVIDENCE,id);this.store.remove(PROFILE,profile.id);}else this.store.put(PROFILE,profile,tenant);}return profiles.length;}
  private recompute(profile:VisitorProfile){const ev=profile.evidenceRefs.map(id=>this.store.get(EVIDENCE,id) as VisitorProfileEvidence).filter(Boolean);profile.evidenceRefs=ev.map(e=>e.id);profile.interestCategories=bound(uniq(ev.filter(e=>e.kind==='ROUTE'&&e.category).map(e=>e.category!)),20);profile.engagementScore=scoreEngagement(ev);if(['ANONYMOUS','ENGAGED'].includes(profile.lifecycleStage))profile.lifecycleStage=profile.engagementScore.value>=35?'ENGAGED':'ANONYMOUS';profile.intentSignals=[];if(profile.engagementScore.value>0)profile.intentSignals.push({kind:'ACTIVE',strength:profile.engagementScore.value,evidenceRefs:bound(profile.evidenceRefs,10)});profile.updatedAt=iso(this.clock());}
  private detectorSpec(o:AgencyObservation,now:number){
    const action=(kind:string,label:string,rationale:string,autonomyAllowed:'RECOMMEND'|'DRAFT'='RECOMMEND',approvalRequired=true):NextBestAction=>({kind,label,rationale,autonomyAllowed,approvalRequired});
    switch(o.kind){
      case 'ACTIVE_ENGAGED_VISITOR': if(o.active&&Number(o.engagementScore||0)>=35)return{confidence:.82,priority:70,cooldownMs:30*60_000,action:action('REVIEW_ACTIVE_VISITOR','Review active visitor context','Active first-party session has meaningful engagement evidence','RECOMMEND',false)}; break;
      case 'REPEATED_ROUTE_INTEREST': if(Number(o.repeatedInterestCount||0)>=2)return{confidence:.78,priority:65,cooldownMs:6*3600_000,action:action('PROPOSE_CONTEXTUAL_HELP','Propose contextual on-site help','Repeated safe-route category interest suggests a relevant assistance opportunity','DRAFT',true)}; break;
      case 'ABANDONED_AGENT_CONVERSATION': if(o.abandoned)return{confidence:.8,priority:75,cooldownMs:24*3600_000,action:action('DRAFT_CONVERSATION_FOLLOWUP','Draft conversation follow-up','Conversation ended before a completed enquiry or workflow','DRAFT',true)}; break;
      case 'KNOWN_LEAD_RETURNED': if(o.knownLead&&o.active)return{confidence:.9,priority:85,cooldownMs:12*3600_000,action:action('REVIEW_RETURNING_LEAD','Review returning known lead','Authoritatively linked lead has returned','RECOMMEND',false)}; break;
      case 'PROPOSAL_FOLLOWUP_NEEDED': if(o.proposalViewedAt&&!o.followupAt&&now-parse(o.proposalViewedAt)>=3600_000)return{confidence:.92,priority:90,cooldownMs:24*3600_000,action:action('DRAFT_PROPOSAL_FOLLOWUP','Draft proposal follow-up','Viewed proposal has no recorded follow-up','DRAFT',true)}; break;
      case 'UNANSWERED_INBOUND': if(o.inboundAt&&!o.answeredAt&&now-parse(o.inboundAt)>=30*60_000)return{confidence:.95,priority:95,cooldownMs:4*3600_000,action:action('DRAFT_INBOUND_REPLY','Draft inbound reply','Inbound attention remains unanswered','DRAFT',true)}; break;
      case 'STALE_CRM_LEAD': if(o.crmUpdatedAt&&now-parse(o.crmUpdatedAt)>=7*DAY)return{confidence:.86,priority:60,cooldownMs:7*DAY,action:action('REVIEW_STALE_LEAD','Review stale CRM lead','Known CRM lead has had no recent recorded progress','RECOMMEND',false)}; break;
      case 'CAMPAIGN_CONVERSION_ANOMALY': {const v=Number(o.campaignVisits||0),c=Number(o.campaignConversions||0),b=Number(o.baselineConversionRate||0);if(v>=20&&b>0&&c/v<=b*.5)return{confidence:.84,priority:80,cooldownMs:24*3600_000,action:action('REVIEW_CONVERSION_ANOMALY','Review conversion anomaly','Observed campaign conversion is materially below configured baseline','RECOMMEND',false)};break;}
    } return null;
  }
  private profileSuppressesAction(profile:VisitorProfile,actionKind:string){
    if(profile.doNotContact||profile.dismissed)return true;
    if(profile.consentRefs.some(c=>c.status==='DENIED'))return true;
    const channel=actionKind.includes('INBOUND')||actionKind.includes('PROPOSAL')||actionKind.includes('FOLLOWUP')?'EMAIL':actionKind.includes('CONTEXTUAL')?'ONSITE':undefined;
    return !!channel && profile.contactPreferences.some(p=>p.channel===channel&&p.allowed===false);
  }
  private capabilityFor(kind:string){return kind.startsWith('DRAFT_')?'content.draft':kind.includes('CONTEXTUAL')?'onsite.engagement.draft':undefined;}
}
