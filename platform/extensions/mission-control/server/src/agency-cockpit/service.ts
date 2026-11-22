import type {Store,RecordData} from '../store.js';
import {BusinessEngineService} from '../business-engine/service.js';
import {AgencyIntelligenceService} from '../agency-intelligence/service.js';
import type {BusinessOpportunity,AgencyActionPlan,VisitorProfile} from '../agency-intelligence/types.js';
import type {HostedAgentService} from '../hosted-agents/service.js';
import type {Actor} from '../hosted-agents/types.js';
import type {BackendSummary} from '../backend-runtime/domain.js';
import {CreativeProjectService} from '../creative-projects/service.js';
import {AutonomyPolicyService} from '../autonomy-policy/service.js';
import type {AutonomyLevel,AutonomyScopeKind,DiscoveredAutonomyScope,QuietHoursPolicy} from '../autonomy-policy/types.js';
import {CustomerCapabilityRegistry} from '../customer-capabilities/registry.js';
import {registerStarterCapabilities} from '../customer-capabilities/starter.js';
import {AgencyApprovalService} from '../agency-approvals/service.js';
import type {AgencyApprovalRecord} from '../agency-approvals/types.js';

const MAX_ROWS=50;
const MAX_PAYLOAD_BYTES=153600;
const now=()=>new Date().toISOString();
const asIso=(value:unknown,fallback=now())=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:fallback;
const safeLabel=(value:unknown,fallback='Untitled',max=160)=>{const s=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();return (s||fallback).slice(0,max);};
const byUpdated=(a:any,b:any)=>Date.parse(asIso(b.updatedAt??b.createdAt))-Date.parse(asIso(a.updatedAt??a.createdAt));
const priority=(value:number)=>value>=90?'CRITICAL':value>=75?'HIGH':value>=50?'MEDIUM':'LOW';
const lifecycleToProject=(status:string)=>['LIVE','PUBLISHED'].includes(status)?'PUBLISHED':['BUILDING','VERIFYING','DEPLOYING','WORKING'].includes(status)?'WORKING':['PREVIEW','SOURCE_READY','READY'].includes(status)?'READY':['FAILED','BUILD_FAILED'].includes(status)?'FAILED':['REVIEW','READY_FOR_REVIEW'].includes(status)?'REVIEW':'PLANNED';
const lifecycleToPresence=(status:string)=>status==='LIVE'?'LIVE':['BUILDING','VERIFYING','DEPLOYING'].includes(status)?'BUILDING':['PREVIEW','SOURCE_READY','READY'].includes(status)?'READY':['FAILED','BUILD_FAILED'].includes(status)?'FAILED':'PLANNED';
const runtimeLifecycle=(state:string):BackendSummary['lifecycle']=>state==='VALIDATED'?'VALIDATING':state==='STAGED'?'BUILDING':(['DRAFT','BUILDING','READY','DEPLOYING','LIVE','BLOCKED','NEEDS_REVIEW','FAILED','ROLLED_BACK'].includes(state)?state:'DRAFT') as BackendSummary['lifecycle'];
const safeEndpoint=(value:unknown)=>{try{const url=new URL(String(value||''));return url.protocol==='https:'?url.toString():null;}catch{return null;}};

export type AgencyCockpitUser={id:string;username?:string;role?:string};

export class AgencyCockpitService{
  private engines:BusinessEngineService;
  private intelligence:AgencyIntelligenceService;
  private policy:AutonomyPolicyService;
  private capabilities:CustomerCapabilityRegistry;
  private approvals:AgencyApprovalService;
  constructor(private store:Store,private hostedAgents:HostedAgentService,events?:import('../events.js').Events){
    this.engines=new BusinessEngineService(store);
    this.intelligence=new AgencyIntelligenceService(store);
    this.policy=new AutonomyPolicyService(store,events);
    this.capabilities=new CustomerCapabilityRegistry();registerStarterCapabilities(this.capabilities);
    this.approvals=new AgencyApprovalService(store,events);this.approvals.reconcilePlans();
    // CreativeProjectService owns creation/migration of its normalized tables.
    new CreativeProjectService(store);
  }

  async snapshot(user:AgencyCockpitUser){
    if(!user?.id)throw new Error('Authenticated customer required.');
    const tenantId=user.id;
    const actor={userId:user.id,role:user.role==='ADMIN'?'ADMIN':'CUSTOMER'} as const;
    const engineActor={userId:user.id,role:user.role==='ADMIN'?'ADMIN':'CUSTOMER'};
    const engine=this.engines.listEngines(engineActor)[0]??null;
    const rawOpportunities=this.intelligence.listOpportunities(tenantId).filter(item=>item.status!=='RESOLVED').sort((a,b)=>b.priority-a.priority||byUpdated(a,b)).slice(0,MAX_ROWS);
    const actionPlans=(this.store.list('agency-action-plans',tenantId) as unknown as AgencyActionPlan[]).sort(byUpdated).slice(0,MAX_ROWS);
    const agents=await this.hostedAgents.list(actor as Actor);
    const agentIds=new Set(agents.map(agent=>agent.id));
    const conversations=this.store.list('hosted-agent-conversations').filter(row=>agentIds.has(String(row.agentId))&&row.status!=='ARCHIVED').sort(byUpdated).slice(0,MAX_ROWS);
    const visitorSessions=this.store.list('visitor-sessions').filter(row=>agentIds.has(String(row.agentId))&&row.enabled&&Date.now()-Number(row.lastSeen||0)<90000).sort((a,b)=>Number(b.lastSeen||0)-Number(a.lastSeen||0)).slice(0,MAX_ROWS);
    const profiles=(this.store.list('agency-visitor-profiles',tenantId) as unknown as VisitorProfile[]).slice(0,MAX_ROWS);
    const profileBySession=new Map<string,VisitorProfile>();
    for(const profile of profiles)for(const ref of profile.sessionRefs||[])profileBySession.set(ref,profile);
    const profileOpportunity=new Map<string,BusinessOpportunity>();
    for(const item of rawOpportunities)for(const ref of item.entityRefs||[])if(ref.kind==='visitor_profile'&&!profileOpportunity.has(ref.id))profileOpportunity.set(ref.id,item);

    const businessEngine=engine?this.engineSummary(engineActor,engine.id,rawOpportunities):null;
    const projects=this.projectAggregate(user.id,tenantId);
    const presence=this.presenceAggregate(user.id);
    const backends=this.backendAggregate(tenantId);
    const agentAggregate=this.agentAggregate(agents,conversations);
    const automations=engine?this.automationAggregate(engineActor,engine.id):this.emptyAutomations();
    const autonomy=this.policy.summary(tenantId,this.discoveredAutonomyScopes(automations));
    const opportunities=rawOpportunities.map(item=>this.opportunitySummary(item));
    const visitors={
      activeCount:visitorSessions.length,
      engagedCount:visitorSessions.filter(session=>(profileBySession.get(String(session.id))?.engagementScore?.value??0)>=35).length,
      knownLeadCount:visitorSessions.filter(session=>['LEAD','CUSTOMER','RETURNING'].includes(profileBySession.get(String(session.id))?.lifecycleStage||'')).length,
      visitors:visitorSessions.map(session=>{const profile=profileBySession.get(String(session.id));const score=profile?.engagementScore?.value??0;const opp=profile?profileOpportunity.get(profile.id):undefined;return{
        visitorProfileId:profile?.id||`anonymous:${String(session.id).slice(-12)}`,
        sessionRef:String(session.id),
        lifecycle:profile?.lifecycleStage||'ANONYMOUS',
        currentContext:safeLabel(session.currentRoute||'/', '/',120),
        engagement:score>=70?'HIGH':score>=35?'MEDIUM':'LOW',
        conversationActive:conversations.some(c=>c.id===session.conversationId&&c.status==='ACTIVE'),
        lastSeenAt:new Date(Number(session.lastSeen||Date.now())).toISOString(),
        nextBestAction:opp?.recommendedAction?.label||null,
      };}),
      refreshedAt:now(),
    };
    const conversationsAggregate={
      activeCount:conversations.filter(item=>item.status==='ACTIVE').length,
      awaitingBusinessCount:conversations.filter(item=>this.conversationState(item)==='WAITING_BUSINESS').length,
      conversations:conversations.map(item=>{const linkedSession=visitorSessions.find(session=>session.conversationId===item.id);const profile=linkedSession?profileBySession.get(String(linkedSession.id)):undefined;return{
        conversationId:String(item.id),agentId:item.agentId?String(item.agentId):null,channel:'WEB',subject:'Website conversation',status:this.conversationState(item),contactLabel:profile&&profile.lifecycleStage!=='ANONYMOUS'?profile.lifecycleStage.replace('_',' ').toLowerCase():'Anonymous visitor',lastActivityAt:asIso(item.updatedAt??item.createdAt),messageCount:Array.isArray(item.messages)?item.messages.length:0,nextAction:this.conversationState(item)==='WAITING_BUSINESS'?'Review the latest customer message.':null,
      };}),
    };
    const approvalRecords=this.approvals.list(tenantId),approvalByPlan=new Map(approvalRecords.map(item=>[item.actionPlanId,item]));
    const workingNow=actionPlans.map(plan=>this.actionSummary(plan,rawOpportunities.find(o=>o.id===plan.opportunityId),approvalByPlan.get(plan.id)));
    const failedProjects=projects.projects.filter((p:any)=>p.status==='FAILED'||p.status==='BLOCKED').length;
    const badBackends=backends.needsAttentionCount;
    const highOpp=opportunities.filter((o:any)=>o.priority==='HIGH'||o.priority==='CRITICAL').length;
    const healthOverall=badBackends||failedProjects?'DEGRADED':highOpp?'NEEDS_ATTENTION':businessEngine?'HEALTHY':'UNKNOWN';
    const snapshot={
      generatedAt:now(),
      brief:this.brief(businessEngine,opportunities,projects,presence,backends,agentAggregate),
      workingNow,
      businessEngine,
      opportunities,
      visitors,
      conversations:conversationsAggregate,
      crm:{availability:'CONFIGURATION_NEEDED',openLeadCount:0,needsFollowUpCount:0,wonThisPeriodCount:0,stages:[],leads:[]},
      projects,
      presence,
      backends,
      agents:agentAggregate,
      automations,
      campaigns:this.campaignAggregate(tenantId,user.id),
      social:this.socialAggregate(tenantId),
      content:this.contentAggregate(tenantId,user.id),
      inbox:{configured:false,unreadCount:0,awaitingReplyCount:0,lastSyncedAt:null,threads:[]},
      analytics:{availability:'CONFIGURATION_NEEDED',periodLabel:'Not connected',kpis:[],summary:'Connect a tenant-owned analytics capability to measure this business engine.',refreshedAt:now()},
      approvals:this.approvalAggregate(approvalRecords),
      activity:{items:workingNow.slice(0,20).map((item:any)=>({id:`activity:${item.id}`,occurredAt:item.updatedAt,actor:'STARLI',title:item.title,summary:item.whatHappened,status:item.status==='FAILED'?'FAILED':item.status==='BLOCKED'?'BLOCKED':'INFO',capabilityLabel:item.capability.label,receipt:null})),nextCursor:null},
      health:{overall:healthOverall,summary:this.healthSummary(healthOverall,badBackends,failedProjects,highOpp),checks:[
        {id:'engine',label:'Business engine',status:businessEngine?businessEngine.health:'UNKNOWN',detail:businessEngine?`${businessEngine.components.length} components in the current blueprint.`:'No Business Engine blueprint yet.',targetSection:'BUSINESS_ENGINE'},
        {id:'projects',label:'Projects',status:failedProjects?'DEGRADED':projects.activeCount||projects.projects.length?'HEALTHY':'UNKNOWN',detail:failedProjects?`${failedProjects} project(s) need attention.`:`${projects.projects.length} customer project(s) visible.`,targetSection:'PROJECTS'},
        {id:'backends',label:'Managed backends',status:badBackends?'DEGRADED':backends.backends.length?'HEALTHY':'UNKNOWN',detail:badBackends?`${badBackends} backend(s) need attention.`:`${backends.backends.length} managed backend(s) visible.`,targetSection:'BACKENDS'},
        {id:'customer-data',label:'Customer data connections',status:'UNKNOWN',detail:'Customer CRM, inbox and analytics require tenant-owned Capability Cloud connections.',targetSection:'AUTONOMY'},
      ]},
      autonomy,
    };
    const encoded=JSON.stringify(snapshot);
    if(Buffer.byteLength(encoded)>MAX_PAYLOAD_BYTES)throw new Error('Agency Cockpit snapshot exceeds payload budget.');
    return snapshot;
  }

  resolveApproval(user:AgencyCockpitUser,approvalId:string,decision:'APPROVE'|'REJECT'){const record=this.approvals.resolve(user.id,approvalId,decision,user.id);return record;}
  private approvalAggregate(records:AgencyApprovalRecord[]){return{pendingCount:records.filter(item=>item.status==='PENDING').length,approvals:records.map(item=>({approvalId:item.id,title:safeLabel(item.title,'Starli approval'),detail:safeLabel(item.detail,'Review this exact proposed action.',260),impact:item.impact,status:item.status,requestedAt:item.requestedAt,expiresAt:item.expiresAt,capabilityLabel:safeLabel(item.capabilityLabel,'Starli action'),workflowLabel:item.workflowLabel,actionId:item.actionPlanId}))};}
  setPauseAll(user:AgencyCockpitUser,paused:boolean){const scopes=this.currentAutonomyScopes(user);this.policy.setPauseAll(user.id,paused);return{autonomy:this.policy.summary(user.id,scopes)};}
  setAutonomyLevel(user:AgencyCockpitUser,input:{kind:AutonomyScopeKind;scopeId:string;level:AutonomyLevel;paused:boolean}){const scopes=this.currentAutonomyScopes(user),scope=scopes.find(item=>item.kind===input.kind&&item.scopeId===input.scopeId);if(!scope)throw new Error('Autonomy scope is not available to this customer.');this.policy.setScope(user.id,scope,{level:input.level,paused:input.paused});return{autonomy:this.policy.summary(user.id,scopes)};}
  updateQuietHours(user:AgencyCockpitUser,input:QuietHoursPolicy){const scopes=this.currentAutonomyScopes(user);this.policy.updateQuietHours(user.id,input);return{autonomy:this.policy.summary(user.id,scopes)};}
  private currentAutonomyScopes(user:AgencyCockpitUser){const actor={userId:user.id,role:user.role==='ADMIN'?'ADMIN':'CUSTOMER'},engine=this.engines.listEngines(actor)[0]??null,automations=engine?this.automationAggregate(actor,engine.id):this.emptyAutomations();return this.discoveredAutonomyScopes(automations);}
  private discoveredAutonomyScopes(automations:any):DiscoveredAutonomyScope[]{const workflowScopes=(automations.workflows||[]).slice(0,50).map((w:any)=>({scopeId:String(w.workflowId),kind:'WORKFLOW' as const,label:safeLabel(w.label,'Business workflow'),description:'Business Engine routine. External execution still requires capability policy and approvals.',maxLevel:'EXECUTE_APPROVED' as const}));const capabilityScopes=this.capabilities.list().slice(0,50).map(def=>({scopeId:def.id,kind:'CAPABILITY' as const,label:def.displayName,description:`${def.description} Maximum autonomy is constrained by its ${def.sideEffectLevel.toLowerCase()} side-effect class.`,maxLevel:(def.sideEffectLevel==='NONE'||def.sideEffectLevel==='READ')?'EXECUTE_SAFE':def.approvalRequired?'EXECUTE_APPROVED':def.autonomousAllowed?'EXECUTE_SAFE':'DRAFT'} as DiscoveredAutonomyScope));return[...workflowScopes,...capabilityScopes];}
  private engineSummary(actor:any,id:string,opportunities:BusinessOpportunity[]){const summary=this.engines.summary(actor,id);const open=opportunities.filter(o=>o.status==='OPEN').length,high=opportunities.filter(o=>o.status==='OPEN'&&o.priority>=75).length;return{...summary,opportunities:{open,highPriority:high},approvalsPending:0,nextRecommendedAction:opportunities[0]?.recommendedAction?.label||summary.nextRecommendedAction};}
  private opportunitySummary(item:BusinessOpportunity){return{id:item.id,title:safeLabel(item.recommendedAction?.label,'Business opportunity'),summary:safeLabel(item.recommendedAction?.rationale,'Starli found an evidence-backed business opportunity.',240),priority:priority(item.priority),status:item.status==='OPEN'?'OPEN':item.status==='DISMISSED'?'DISMISSED':item.status==='RESOLVED'?'RESOLVED':'IN_PROGRESS',confidence:Math.max(0,Math.min(1,item.confidence)),evidence:(item.evidenceRefs||[]).slice(0,12).map((id,index)=>({id,kind:'SYSTEM',label:`Evidence ${index+1}`,summary:'Bounded evidence reference from an authoritative business source.'})),recommendedAction:safeLabel(item.recommendedAction?.label,'Review opportunity'),autonomyAllowed:item.autonomyAllowed,approvalRequired:!!item.approvalRequired,cooldownUntil:item.cooldown?.until||null,targetSection:this.opportunitySection(item.type)};}
  private opportunitySection(type:string){if(type.includes('VISITOR')||type.includes('CONVERSATION')||type.includes('LEAD'))return'CRM';if(type.includes('CAMPAIGN'))return'CAMPAIGNS';if(type.includes('PROPOSAL')||type.includes('INBOUND'))return'INBOX';return'OPPORTUNITIES';}
  private actionSummary(plan:AgencyActionPlan,opp?:BusinessOpportunity,approval?:AgencyApprovalRecord){const approvalState=approval?.status??(plan.approvalRequired?'PENDING':null),approved=approvalState==='APPROVED',rejected=approvalState==='REJECTED'||approvalState==='EXPIRED';return{id:plan.id,title:safeLabel(plan.action.label,'Starli action'),status:plan.approvalRequired?(approvalState==='PENDING'?'WAITING_APPROVAL':'BLOCKED'):'QUEUED',whatHappened:approved?'This exact action plan was approved. External execution is still disconnected and has not started.':rejected?'This action plan is not approved for execution.':'Starli prepared a bounded action plan. No external side effect has been executed.',triggeredBy:opp?`Opportunity: ${safeLabel(opp.recommendedAction.label,'business opportunity')}`:'Business opportunity',rationale:safeLabel(plan.action.rationale,'Evidence-backed business action.',260),evidence:(plan.evidenceRefs||[]).slice(0,10).map((id,index)=>({id,kind:'SYSTEM',label:`Evidence ${index+1}`,summary:'Authoritative evidence reference; raw private content is not copied into the cockpit.'})),approval:{required:!!plan.approvalRequired,state:approvalState,approvalId:approval?.id},capability:{capabilityId:plan.capabilityRequirement||'recommendation.only',label:plan.capabilityRequirement||'Recommendation only'},autonomyLevel:plan.autonomyAllowed,receipt:null,nextRecommendedAction:approved?'Execution remains blocked until a governed capability executor is connected.':plan.approvalRequired?'Review the proposed action before any external effect.':'Review the recommendation.',startedAt:asIso(plan.createdAt),updatedAt:approval?.resolvedAt||asIso(plan.createdAt)};}
  private conversationState(item:RecordData){const messages=Array.isArray(item.messages)?item.messages:[];const last=messages.at(-1);if(item.status!=='ACTIVE')return'RESOLVED';if(last?.role==='user')return'WAITING_BUSINESS';if(last?.role==='assistant')return'WAITING_CUSTOMER';return'ACTIVE';}
  private projectAggregate(ownerId:string,tenantId:string){
    const legacy=this.store.list('projects',ownerId).slice(0,MAX_ROWS).map(row=>({projectId:String(row.id),projectName:safeLabel(row.name,'Website project'),status:lifecycleToProject(String(row.status||'')),artifactCount:1,readyArtifactCount:['LIVE','PREVIEW','SOURCE_READY'].includes(String(row.status||''))?1:0,primaryOutcome:'Website / digital presence',updatedAt:asIso(row.updatedAt??row.createdAt)}));
    const rows=this.store.db.prepare(`SELECT p.id,p.title,p.goal_summary,p.status,p.updated_at,COUNT(a.id) artifact_count,SUM(CASE WHEN a.status IN ('READY','PUBLISHED','ACTIVE') THEN 1 ELSE 0 END) ready_count FROM creative_projects p LEFT JOIN creative_artifacts a ON a.project_id=p.id AND a.tenant_id=p.tenant_id WHERE p.tenant_id=? AND p.owner_id=? GROUP BY p.id ORDER BY p.updated_at DESC LIMIT ?`).all(tenantId,ownerId,MAX_ROWS) as any[];
    const creative=rows.map(row=>({projectId:String(row.id),projectName:safeLabel(row.title,'Creative project'),status:lifecycleToProject(String(row.status||'')),artifactCount:Number(row.artifact_count||0),readyArtifactCount:Number(row.ready_count||0),primaryOutcome:'Creative project',updatedAt:asIso(row.updated_at)}));
    const projects=[...creative,...legacy].sort(byUpdated).slice(0,MAX_ROWS);return{activeCount:projects.filter(p=>p.status==='WORKING').length,reviewCount:projects.filter(p=>p.status==='REVIEW').length,projects};
  }
  private presenceAggregate(ownerId:string){const surfaces=this.store.list('projects',ownerId).sort(byUpdated).slice(0,MAX_ROWS).map(row=>({surfaceId:String(row.id),kind:'WEBSITE',label:safeLabel(row.name,'Website'),status:lifecycleToPresence(String(row.status||'')),publicUrl:row.status==='LIVE'?safeEndpoint(row.deploymentUrl):null,updatedAt:asIso(row.updatedAt??row.createdAt)}));return{liveCount:surfaces.filter(s=>s.status==='LIVE').length,buildingCount:surfaces.filter(s=>s.status==='BUILDING').length,surfaces};}
  private backendAggregate(tenantId:string){const all=this.store.list('backend-runtime-deployments',tenantId).sort(byUpdated);const seen=new Set<string>(),backends:BackendSummary[]=[];for(const row of all){const key=`${row.projectId}:${row.serviceId}`;if(seen.has(key))continue;seen.add(key);const release=this.store.get('backend-runtime-releases',String(row.releaseId));const spec=this.store.get('backend-runtime-specifications',String(row.deploymentId));backends.push({backendProjectId:String(row.projectId),serviceId:String(row.serviceId),name:'Managed backend',stack:'NODE_EXPRESS_PRISMA',environment:row.environment==='PRODUCTION'?'PRODUCTION':'STAGING',lifecycle:runtimeLifecycle(String(row.state||'DRAFT')),versionId:release?.versionId?String(release.versionId):null,endpoint:row.state==='LIVE'?safeEndpoint(row.endpointRef):null,health:['HEALTHY','UNHEALTHY'].includes(String(row.healthStatus))?row.healthStatus:'UNKNOWN',readiness:['READY','NOT_READY'].includes(String(row.readinessStatus))?row.readinessStatus:'UNKNOWN',database:spec?.databaseBinding?{engine:'POSTGRESQL',status:'BOUND'}:null,migrationRisk:['SAFE_ADDITIVE','REVIEW_REQUIRED','BLOCKED'].includes(String(row.migrationRisk))?row.migrationRisk:null,updatedAt:asIso(row.updatedAt??row.createdAt)} as BackendSummary);if(backends.length>=MAX_ROWS)break;}return{healthyCount:backends.filter(b=>b.health==='HEALTHY'&&b.readiness==='READY').length,needsAttentionCount:backends.filter(b=>b.health==='UNHEALTHY'||['FAILED','BLOCKED','NEEDS_REVIEW'].includes(b.lifecycle)).length,backends};}
  private agentAggregate(agents:any[],conversations:RecordData[]){const counts=new Map<string,number>();for(const c of conversations)counts.set(String(c.agentId),(counts.get(String(c.agentId))||0)+1);const leads=this.store.list('hosted-agent-leads');const outcomes=new Map<string,number>();for(const l of leads)outcomes.set(String(l.agentId),(outcomes.get(String(l.agentId))||0)+1);const rows=agents.slice(0,MAX_ROWS).map(agent=>({agentId:String(agent.id),label:safeLabel(agent.name||agent.businessName,'AI agent'),role:safeLabel(agent.type||'Business agent','Business agent',80),status:agent.status==='ACTIVE'||agent.status==='DEMO'?'ACTIVE':agent.status==='DISABLED'?'PAUSED':'DRAFT',conversationsPeriod:counts.get(String(agent.id))||0,outcomesPeriod:outcomes.get(String(agent.id))||0,lastActivityAt:agent.updatedAt?asIso(agent.updatedAt):null,nextAction:agent.status==='DRAFT'?'Review and publish when ready.':null}));return{activeCount:rows.filter(a=>a.status==='ACTIVE').length,needsAttentionCount:rows.filter(a=>a.status==='DRAFT').length,agents:rows};}
  private automationAggregate(actor:any,engineId:string){const workflows=this.engines.listWorkflows(actor,engineId),routines=this.engines.listRoutines(actor,engineId);const byWorkflow=new Map(workflows.map(w=>[w.id,w]));const rows=routines.slice(0,MAX_ROWS).map(r=>({workflowId:r.id,label:safeLabel(r.name,'Business routine'),triggerLabel:r.trigger.kind==='SCHEDULE'?`Schedule: ${safeLabel(r.trigger.expression,'configured schedule',100)}`:`Event: ${safeLabel(r.trigger.expression,'configured event',100)}`,status:r.enabled?'ACTIVE':'PAUSED',autonomyLevel:'OBSERVE',lastRunAt:null,lastOutcome:null,nextRunAt:null,workflowDefinition:byWorkflow.get(r.workflowId)?.name||null}));return{activeCount:rows.filter(r=>r.status==='ACTIVE').length,pausedCount:rows.filter(r=>r.status==='PAUSED').length,workflows:rows};}
  private emptyAutomations(){return{activeCount:0,pausedCount:0,workflows:[]};}
  private campaignAggregate(tenantId:string,ownerId:string){const rows=this.store.db.prepare(`SELECT id,name,status,updated_at FROM creative_artifacts WHERE tenant_id=? AND owner_id=? AND kind='CAMPAIGN' ORDER BY updated_at DESC LIMIT ?`).all(tenantId,ownerId,MAX_ROWS) as any[];const campaigns=rows.map(row=>({campaignId:String(row.id),label:safeLabel(row.name,'Campaign'),status:['ACTIVE','PAUSED'].includes(String(row.status))?row.status:String(row.status)==='PUBLISHED'?'COMPLETED':String(row.status)==='READY'?'SCHEDULED':'DRAFT',objective:'Creative campaign artifact',channelLabels:[],nextMilestone:null,updatedAt:asIso(row.updated_at)}));return{activeCount:campaigns.filter(c=>c.status==='ACTIVE').length,scheduledCount:campaigns.filter(c=>c.status==='SCHEDULED').length,campaigns};}
  private socialAggregate(tenantId:string){const plans=(this.store.list('social-post-plans',tenantId) as any[]).filter(row=>row.tenantId===tenantId).sort(byUpdated).slice(0,MAX_ROWS),jobs=(this.store.list('social-publish-jobs',tenantId) as any[]).filter(row=>row.tenantId===tenantId).sort(byUpdated).slice(0,MAX_ROWS);const byPlan=new Map(plans.map(plan=>[String(plan.id),plan])),calendar:any[]=[];const used=new Set<string>();for(const job of jobs){const plan=byPlan.get(String(job.planId));const platforms=Array.isArray(job.results)&&job.results.length?job.results.map((r:any)=>String(r.platform)):Array.isArray(plan?.variants)?plan.variants.map((v:any)=>String(v.platform)):[];const when=plan?.schedule?.publishAt||job.updatedAt||job.createdAt;if(!when)continue;const state=String(job.state);const status=state==='PUBLISHED'||state==='PARTIAL_SUCCESS'?'PUBLISHED':state==='SCHEDULED'||state==='QUEUED'||state==='PUBLISHING'?'SCHEDULED':state==='NEEDS_REVIEW'||state==='READY_FOR_APPROVAL'?'WAITING_APPROVAL':state==='FAILED'||state==='NEEDS_REAUTH'?'FAILED':'DRAFT';calendar.push({itemId:String(job.id),channel:platforms.slice(0,3).join(' · ')||'Social',title:`${platforms.length||1} social channel${platforms.length===1?'':'s'} · ${status.replace('_',' ').toLowerCase()}`,scheduledFor:asIso(when),status,campaignId:null});used.add(String(job.planId));if(calendar.length>=MAX_ROWS)break;}for(const plan of plans){if(used.has(String(plan.id))||plan.schedule?.mode!=='SCHEDULE'||!plan.schedule?.publishAt)continue;const platforms=Array.isArray(plan.variants)?plan.variants.map((v:any)=>String(v.platform)):[];calendar.push({itemId:String(plan.id),channel:platforms.slice(0,3).join(' · ')||'Social',title:`Scheduled ${platforms.length||1} social channel${platforms.length===1?'':'s'}`,scheduledFor:asIso(plan.schedule.publishAt),status:plan.approvalReference?'SCHEDULED':'WAITING_APPROVAL',campaignId:null});if(calendar.length>=MAX_ROWS)break;}calendar.sort((a,b)=>Date.parse(a.scheduledFor)-Date.parse(b.scheduledFor));return{scheduledCount:calendar.filter(item=>item.status==='SCHEDULED').length,waitingApprovalCount:calendar.filter(item=>item.status==='WAITING_APPROVAL').length,calendar};}
  private contentAggregate(tenantId:string,ownerId:string){const rows=this.store.db.prepare(`SELECT id,kind,name,status,updated_at FROM creative_artifacts WHERE tenant_id=? AND owner_id=? AND kind IN ('COPY','IMAGE','VIDEO','FILE','REPORT') ORDER BY updated_at DESC LIMIT ?`).all(tenantId,ownerId,MAX_ROWS) as any[];const artifacts=rows.map(row=>({artifactId:String(row.id),kind:row.kind==='IMAGE'?'IMAGE':row.kind==='VIDEO'?'VIDEO':row.kind==='COPY'?'COPY':'DOCUMENT',title:safeLabel(row.name,'Creative artifact'),status:String(row.status)==='PUBLISHED'?'PUBLISHED':String(row.status)==='READY'?'READY':String(row.status)==='REVIEW'?'REVIEW':'DRAFT',campaignId:null,updatedAt:asIso(row.updated_at)}));const runs=(this.store.list('video-director-runs') as any[]).filter(run=>run.ownerId===ownerId),runByPlan=new Map(runs.map(run=>[String(run.planId),run])),director=(this.store.list('video-director-plans') as any[]).filter(row=>row.ownerId===ownerId&&row.plan).sort(byUpdated).slice(0,MAX_ROWS).map(row=>{const plan=row.plan,run=runByPlan.get(String(plan.id));const runStatus=String(run?.status||'');const status=runStatus==='COMPLETE'?'READY':runStatus==='READY'||runStatus==='RENDERING'?'REVIEW':'DRAFT';return{artifactId:String(plan.id),kind:'VIDEO',title:safeLabel(plan.brief?.title,'Video Director plan'),status,campaignId:null,updatedAt:asIso(run?.updatedAt||plan.createdAt)};});const seen=new Set<string>(),items=[...director,...artifacts].filter(item=>{if(seen.has(item.artifactId))return false;seen.add(item.artifactId);return true;}).sort(byUpdated).slice(0,MAX_ROWS);return{readyCount:items.filter(i=>i.status==='READY'||i.status==='PUBLISHED').length,reviewCount:items.filter(i=>i.status==='REVIEW').length,items};}
  private brief(engine:any,opportunities:any[],projects:any,presence:any,backends:any,agents:any){const high=opportunities.filter(o=>o.priority==='HIGH'||o.priority==='CRITICAL');const risks=[] as any[];if(backends.needsAttentionCount)risks.push({id:'backend-risk',label:'Backend attention needed',detail:`${backends.needsAttentionCount} managed backend(s) need review.`,priority:'HIGH'});const failed=projects.projects.filter((p:any)=>p.status==='FAILED').length;if(failed)risks.push({id:'project-risk',label:'Project attention needed',detail:`${failed} project(s) are in a failed state.`,priority:'HIGH'});const wins=[] as any[];if(presence.liveCount)wins.push({id:'live-presence',label:'Customer presence is live',detail:`${presence.liveCount} customer-facing surface(s) are live.`});if(backends.healthyCount)wins.push({id:'healthy-backend',label:'Managed backend healthy',detail:`${backends.healthyCount} backend(s) are healthy and ready.`});if(agents.activeCount)wins.push({id:'active-agents',label:'AI agents active',detail:`${agents.activeCount} customer agent(s) are active.`});const top=opportunities[0];return{headline:engine?(high.length?`${high.length} high-priority business opportunity${high.length===1?'':'ies'} need attention.`:'Starli has your business engine in view.'):'Create your first Business Engine with Starli.',summary:engine?`Starli is reading one bounded operating snapshot across your engine, projects, first-party visitors, agents and managed infrastructure.`:'Tell Starli what business you want to build, run or improve. The Business Engine compiler can turn that goal into a structured blueprint.',priorities:opportunities.slice(0,3).map(o=>({id:o.id,label:o.title,detail:o.summary,priority:o.priority,targetSection:o.targetSection})),wins:wins.slice(0,4),risks:risks.slice(0,4),nextRecommendedAction:top?.recommendedAction||engine?.nextRecommendedAction||'Describe the business outcome you want Starli to build.'};}
  private healthSummary(overall:string,backends:number,projects:number,opportunities:number){if(overall==='DEGRADED')return `${backends+projects} system item(s) need attention.`;if(overall==='NEEDS_ATTENTION')return `${opportunities} high-priority business opportunity item(s) are open.`;if(overall==='HEALTHY')return 'The connected customer-owned systems in this snapshot are healthy.';return 'Create or connect a Business Engine to establish an operating health baseline.';}
}
