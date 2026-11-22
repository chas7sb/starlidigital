import type {Events} from '../events.js';
import type {Store,RecordData} from '../store.js';
import {CreativeProjectService} from '../creative-projects/service.js';
import {CreativeOrchestrationLinkService} from '../creative-projects/orchestration-links.js';
import {orchestrationWorkspacePlan} from '../starli-orchestrator/projection.js';
import {AutonomyPolicyService} from '../autonomy-policy/service.js';
import {redactAndBoundOutput} from '../customer-capabilities/security.js';
import type {StarliHomeSnapshot,StarliWorkspaceSnapshot,HomeActivityFeed,CapabilityConnectorSummary,StarliConnectionsSnapshot,StarliConnectionState} from './contracts.js';
import type {MediaWorkspaceService} from '../media-workspace/service.js';
import {STARLI_AGGREGATE_BUDGETS as B} from './contracts.js';
import {CUSTOMER_CONNECTOR_PROVIDER_CATALOG} from '../customer-capabilities/connectors/catalog.js';
import type {CustomerConnectorRegistry} from '../customer-capabilities/connectors/registry.js';
import {validateOpaqueCredentialReference} from '../customer-capabilities/security.js';

const text=(v:unknown,max=220)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max);
const timestamp=(...values:unknown[])=>{for(const value of values){if(typeof value==='string'&&Number.isFinite(Date.parse(value)))return value;}return null;};
const identity=(v:string)=>{if(!/^[A-Za-z0-9_.:@-]{1,180}$/.test(v))throw new Error('Invalid identity');return v;};
/** Read projections only. These records remain owned by their existing domain services. */
export class StarliAggregateService {
 readonly policy:AutonomyPolicyService; private creativeOrchestration:CreativeOrchestrationLinkService;
 constructor(private store:Store,events?:Events,private media?:MediaWorkspaceService,private connectorRegistry?:CustomerConnectorRegistry){new CreativeProjectService(store);this.creativeOrchestration=new CreativeOrchestrationLinkService(store);this.policy=new AutonomyPolicyService(store,events);}
 private rows(collection:string,tenant:string,limit=50,where='1',args:(string|number)[]=[]){
  identity(tenant);
  return this.store.db.prepare(`SELECT payload FROM records WHERE collection=? AND owner=? AND json_extract(payload,'$.tenantId')=? AND (${where}) ORDER BY coalesce(json_extract(payload,'$.updatedAt'),json_extract(payload,'$.createdAt'),json_extract(payload,'$.requestedAt')) DESC,id DESC LIMIT ?`).all(collection,tenant,tenant,...args,limit).map(r=>JSON.parse(String(r.payload)) as RecordData);
 }
 private bound<T>(value:T,max:number):T{return redactAndBoundOutput(value,max) as T;}
 connections(tenant:string):StarliConnectionsSnapshot{
  identity(tenant);
  const now=new Date().toISOString(),items:StarliConnectionsSnapshot['items']=[],seen=new Set<string>(),socialConfigured=!!process.env.UPLOAD_POST_API_KEY?.trim();let truncated=false;
  const add=(item:StarliConnectionsSnapshot['items'][number])=>{const key=`${item.source}:${item.id}`;if(seen.has(key))return;if(items.length>=50){truncated=true;return;}seen.add(key);items.push(item);};
  const state=(value:unknown):StarliConnectionState=>{const v=String(value||'').toUpperCase();if(v==='CONNECTED')return'CONNECTED';if(['DEGRADED','REAUTH_REQUIRED','ERROR'].includes(v))return'DEGRADED';if(v==='REVOKED')return'PERMISSION_REQUIRED';if(['CONFIGURATION_NEEDED','DISCONNECTED','CONNECTING'].includes(v))return'CONFIGURATION_NEEDED';return'UNAVAILABLE';};
  const capabilityRows=this.rows('customer-capability-connections',tenant,51);
  // A persisted CONNECTED row is not execution evidence. The shared registry must
  // have a real, live adapter, and the connection must carry an opaque reference.
  const verifiedLiveAdapter=(r:RecordData)=>{
    const provider=String(r.provider??'');
    const metadata=this.connectorRegistry?.getProvider(provider);
    if(!metadata?.liveAuthAvailable||metadata.implementationStatus==='METADATA_ONLY'||!this.connectorRegistry?.getAdapter(provider))return false;
    try{validateOpaqueCredentialReference(String(r.credentialReference??''));return true;}catch{return false;}
  };
  for(const r of capabilityRows.slice(0,50)){
    const recorded=state(r.status),usable=recorded==='CONNECTED'&&verifiedLiveAdapter(r);
    const status=recorded==='CONNECTED'&&!usable?'UNAVAILABLE':recorded;
    add({id:text(r.id,180),provider:text(r.provider,80),label:text(r.provider,80),category:'CUSTOMER_CONNECTION',status,source:'CAPABILITY_CLOUD',usedByStarli:usable,action:null,detail:recorded==='CONNECTED'&&!usable?'Live connector access is not available in this Starli build.':null,updatedAt:timestamp(r.updatedAt,r.createdAt)});
  }
  const socialRows=this.store.db.prepare("SELECT payload FROM records WHERE collection='social-connections' AND owner=? AND json_extract(payload,'$.tenantId')=? ORDER BY coalesce(json_extract(payload,'$.refreshedAt'),json_extract(payload,'$.connectedAt'),'') DESC,id DESC LIMIT 51").all(tenant,tenant).map(r=>JSON.parse(String(r.payload)) as RecordData);
  for(const r of socialRows.slice(0,50)){const platform=text(r.platform||r.provider,80),status=socialConfigured?state(r.state):'UNAVAILABLE';add({id:text(r.id,180),provider:'upload-post',label:platform||'Social account',category:'SOCIAL',status,source:'SOCIAL_CLOUD',usedByStarli:socialConfigured&&status==='CONNECTED',action:socialConfigured?'OPEN_SOCIAL':null,detail:!socialConfigured?'Social provider configuration is unavailable on this server.':status==='DEGRADED'?'Social connection needs re-authentication or provider attention.':null,updatedAt:timestamp(r.refreshedAt,r.connectedAt)});}
  for(const provider of CUSTOMER_CONNECTOR_PROVIDER_CATALOG){if(items.some(item=>item.provider===provider.id))continue;add({id:`catalog:${provider.id}`,provider:provider.id,label:provider.displayName,category:provider.category,status:provider.liveAuthAvailable?'UNAVAILABLE':'CONFIGURATION_NEEDED',source:'CATALOG',usedByStarli:false,action:null,detail:provider.liveAuthAvailable?null:'Provider setup is not enabled in this Starli build.',updatedAt:null});}
  if(!socialRows.length)add({id:'social-cloud',provider:'upload-post',label:'Social Publishing Cloud',category:'SOCIAL',status:socialConfigured?'CONFIGURATION_NEEDED':'UNAVAILABLE',source:'SOCIAL_CLOUD',usedByStarli:false,action:socialConfigured?'OPEN_SOCIAL':null,detail:socialConfigured?'Connect a social account through the governed Social Cloud.':'Social provider configuration is required before connecting an account.',updatedAt:null});
  const counts={CONNECTED:0,CONFIGURATION_NEEDED:0,PERMISSION_REQUIRED:0,UNAVAILABLE:0,DEGRADED:0} satisfies Record<StarliConnectionState,number>;for(const item of items)counts[item.status]++;
  return this.bound({schemaVersion:2,generatedAt:now,tenantId:tenant,items,counts,hasMore:truncated||capabilityRows.length>50||socialRows.length>50},32768);
 }
 activity(tenant:string,afterSequence=0,limit=30):HomeActivityFeed{
  identity(tenant);if(!Number.isSafeInteger(afterSequence)||afterSequence<0)throw new Error('Invalid activity cursor');
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error('Invalid activity limit');
  const rows=this.store.db.prepare('SELECT a.sequence,a.id,a.type,a.project_id,a.created_at FROM creative_activity a JOIN creative_projects p ON p.id=a.project_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=? AND p.owner_id=? AND a.sequence>? ORDER BY a.sequence ASC LIMIT ?').all(tenant,tenant,afterSequence,limit+1);
  const events=rows.slice(0,limit).map(r=>({id:String(r.id),sequence:Number(r.sequence),type:text(r.type,100),title:text(r.type,100),summary:'Project activity recorded.',occurredAt:String(r.created_at),severity:'INFO' as const,primaryEntityRef:{kind:'creative_project',id:String(r.project_id)}}));
  return {events,lastSequence:events.at(-1)?.sequence??afterSequence,hasMore:rows.length>limit};
 }
 home(tenant:string):StarliHomeSnapshot{
  identity(tenant);
  const engine=this.rows('business-engines',tenant,1)[0];
  const packages=this.rows('business-engine-work-packages',tenant,50,engine?"json_extract(payload,'$.businessEngineId')=?":'1',engine?[engine.id]:[]);
  const pending="json_extract(payload,'$.status')='PENDING' AND julianday(json_extract(payload,'$.expiresAt'))>julianday('now')";
  const approvals=this.rows('agency-approvals',tenant,50,pending);
  const approvalCounts=this.store.db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN json_extract(payload,'$.impact')='HIGH' THEN 1 ELSE 0 END) AS critical FROM records WHERE collection='agency-approvals' AND owner=? AND json_extract(payload,'$.tenantId')=? AND ${pending}`).get(tenant,tenant);
  const routines=engine?this.store.db.prepare("SELECT COUNT(*) AS n FROM records WHERE collection='business-engine-routines' AND owner=? AND json_extract(payload,'$.tenantId')=? AND json_extract(payload,'$.businessEngineId')=? AND json_extract(payload,'$.enabled')=1").get(tenant,tenant,engine.id):null;
  const connectionSnapshot=this.connections(tenant),connections=connectionSnapshot.items;
  const topConnectors:CapabilityConnectorSummary[]=connections.slice(0,50).map(r=>({id:r.id,label:r.label,category:r.category,status:r.status==='CONNECTED'?'CONNECTED':r.status==='DEGRADED'||r.status==='PERMISSION_REQUIRED'?'ATTENTION_REQUIRED':'DISCONNECTED'}));
  const lifecycle=(state:string):NonNullable<StarliHomeSnapshot['activeEngine']>['lifecycle']=>state==='ACTIVE'?'ACTIVE':state==='PAUSED'?'PAUSED':state==='BUILDING'?'BUILDING':['NEEDS_REVIEW','DEGRADED','READY_FOR_REVIEW'].includes(state)?'ATTENTION_REQUIRED':'DRAFT';
  const snapshot:StarliHomeSnapshot={projection:{unavailableSections:['kpis','questions','capabilityAvailability','executionProgress'],boundedSections:['workPackages','approvals','connections'],activitySource:'CREATIVE_PROJECTS'},generatedAt:new Date().toISOString(),tenantId:tenant,greetingHeadline:'Your Starli workspace',activeEngine:engine?{id:engine.id,name:text(engine.name),objective:text(engine.objective,500),lifecycle:lifecycle(engine.lifecycle),blueprintSummary:text(engine.blueprint?.customerPromise,500),healthScore:null,activeRoutinesCount:Number(routines?.n??0),kpis:[],updatedAt:engine.updatedAt}:null,
   activeWorkPackages:packages.map(r=>({id:r.id,title:text(r.target),category:r.target==='BACKEND_FACTORY'?'BACKEND':r.target==='HOSTED_AGENT'?'SUPPORT':r.target==='SOCIAL_CAMPAIGN'?'DISTRIBUTION':'PRESENCE',progressPercent:null,status:['BLOCKED','WAITING_INPUT'].includes(r.status)?'BLOCKED':r.status==='WAITING_APPROVAL'?'REVIEW':'QUEUED',activeWorker:null,lastStepSummary:text(r.status),updatedAt:r.createdAt})),
   attention:{totalCount:Number(approvalCounts?.total??0),criticalCount:Number(approvalCounts?.critical??0),pendingApprovals:approvals.map(r=>({id:r.id,title:text(r.title),kind:'OTHER',requestedAt:r.requestedAt,resourceType:'agency_action_plan',resourceId:r.actionPlanId,impactSummary:text(r.detail,300),riskLevel:['LOW','MEDIUM','HIGH'].includes(r.impact)?r.impact:'HIGH'})),customerQuestions:[]},
   recentActivity:this.activity(tenant),capabilityCloud:{connectedCount:connectionSnapshot.counts.CONNECTED,availableCount:null,needsAttentionCount:connections.filter(r=>r.source!=='CATALOG'&&(['DEGRADED','PERMISSION_REQUIRED'].includes(r.status)||r.source==='CAPABILITY_CLOUD'&&r.status==='CONFIGURATION_NEEDED')).length,topConnectors}};
  return this.bound(snapshot,B.MAX_HOME_PAYLOAD_BYTES);
 }
 workspace(tenant:string,projectId:string,artifactCursor?:string):StarliWorkspaceSnapshot{
  identity(tenant);identity(projectId);
  const project=this.store.db.prepare('SELECT id,title,goal_summary,status FROM creative_projects WHERE id=? AND tenant_id=? AND owner_id=?').get(projectId,tenant,tenant);
  if(!project)throw new Error('Project unavailable');
  let before=['9999-12-31T23:59:59.999Z','~'];
  if(artifactCursor){try{if(artifactCursor.length>1024)throw new Error();const parsed=JSON.parse(Buffer.from(artifactCursor,'base64url').toString());if(!Array.isArray(parsed)||parsed.length!==2||typeof parsed[0]!=='string'||!Number.isFinite(Date.parse(parsed[0]))||typeof parsed[1]!=='string')throw new Error();identity(parsed[1]);before=parsed;}catch{throw new Error('Invalid artifact cursor');}}
  const rows=this.store.db.prepare(`SELECT a.id,a.name,a.kind,a.status,a.updated_at,v.version FROM creative_artifacts a LEFT JOIN (SELECT artifact_id,MAX(version) AS version FROM creative_artifact_versions WHERE tenant_id=? AND project_id=? GROUP BY artifact_id) v ON v.artifact_id=a.id WHERE a.project_id=? AND a.tenant_id=? AND a.owner_id=? AND (a.updated_at<? OR (a.updated_at=? AND a.id<?)) ORDER BY a.updated_at DESC,a.id DESC LIMIT 51`).all(tenant,projectId,projectId,tenant,tenant,before[0],before[0],before[1]);
  const count=this.store.db.prepare('SELECT COUNT(*) AS n FROM creative_artifacts WHERE project_id=? AND tenant_id=? AND owner_id=?').get(projectId,tenant,tenant);
  const mediaArtifacts=this.store.db.prepare('SELECT id FROM creative_artifacts WHERE project_id=? AND tenant_id=? AND owner_id=? ORDER BY updated_at DESC,id DESC LIMIT 100').all(projectId,tenant,tenant) as Array<{id:string}>;
  const mediaRefs=this.store.db.prepare('SELECT domain,entity_id FROM creative_external_refs WHERE project_id=? AND tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(projectId,tenant) as Array<{domain:string;entity_id:string}>;
  const media=this.media?this.media.snapshot({id:tenant,role:'USER'},{projectId,artifactIds:mediaArtifacts.map(r=>String(r.id)),references:mediaRefs.map(r=>({domain:String(r.domain),entityId:String(r.entity_id)}))}):null;
  const kinds:Record<string,StarliWorkspaceSnapshot['artifactGraph']['artifacts'][number]['kind']>={WEBSITE:'website',WEB_APP:'web_app',MOBILE_APP:'mobile_app',BACKEND:'backend',IMAGE:'image',VIDEO:'video',COPY:'copy',CAMPAIGN:'campaign',AGENT:'ai_agent',AUTOMATION:'automation',INTEGRATION:'integration',FILE:'file',REPORT:'report',CUSTOM:'custom'};
  const context={tenantId:tenant,ownerId:tenant},orchestration=this.creativeOrchestration.latestPlanForProject(context,projectId),links=orchestration?this.creativeOrchestration.listProjectLinks(context,projectId,200).filter(link=>link.orchestrationPlanId===orchestration.id):[],linkedByPackage=new Map<string,string[]>();for(const link of links)linkedByPackage.set(link.workPackageId,[...(linkedByPackage.get(link.workPackageId)||[]),link.artifactId]);
  const plan=orchestration?orchestrationWorkspacePlan(orchestration):{summary:'Canonical orchestration plan is not available for this project.',progressPercent:null,status:'DRAFT' as const,steps:[]};if(orchestration)for(const step of plan.steps)step.artifactIds=[...new Set([...step.artifactIds,...(linkedByPackage.get(step.id)||[])])];
  const receipts=orchestration?this.creativeOrchestration.receipts(context,orchestration.id,30).filter(r=>r.kind==='AGENCY_EXECUTION'||r.kind==='PLANNING_RESULT').slice(-20).reverse():[];
  const unavailable=['livePreview','backendState','brandBrain',...(!orchestration?['orchestrationPlan','executionReceipts']:[])];if(!this.media)unavailable.push('media');
  const snapshot:StarliWorkspaceSnapshot={projection:{unavailableSections:unavailable},generatedAt:new Date().toISOString(),projectId,projectName:text(project.title),projectType:'CREATIVE_PROJECT',lifecycle:project.status==='ACTIVE'?'WORKING':project.status==='COMPLETED'?'READY':project.status==='PAUSED'?'BLOCKED':'IDEA',currentMode:'CANVAS',
   plan,
   artifactGraph:{totalArtifacts:Number(count?.n??0),artifacts:rows.slice(0,50).map(r=>({id:String(r.id),name:text(r.name),kind:kinds[String(r.kind)]??'custom',version:Number(r.version??0),status:r.status==='READY'?'ready':r.status==='FAILED'?'failed':r.status==='GENERATING'?'working':'planned',updatedAt:String(r.updated_at)})),pageInfo:{hasMore:rows.length>50,nextCursor:rows.length>50?Buffer.from(JSON.stringify([rows[49].updated_at,rows[49].id])).toString('base64url'):null}},
   livePreview:{activeUrl:null,provider:null,status:'UNKNOWN'},backendState:{serviceStatus:'UNKNOWN',activeMigrationsCount:null,databaseHealth:'UNKNOWN'},brandBrain:null,recentExecutionReceipts:receipts.map(r=>({id:r.id,stepLabel:orchestration!.workPackages.find(p=>p.id===r.workPackageId)?.title||'Starli work',toolName:null,durationMs:null,status:r.toStatus==='SUCCEEDED'?'SUCCESS':r.toStatus==='FAILED'?'FAILED':'BLOCKED',executedAt:r.createdAt,summary:text(r.summary,300)})),media};
  return this.bound(snapshot,B.MAX_WORKSPACE_PAYLOAD_BYTES);
 }
 trust(tenant:string){return this.bound({schemaVersion:1,policy:this.policy.summary(tenant),executionNotice:'Pause prevents new governed actions. Already-started side effects require receipt inspection and cannot be undone by a pause.',approvalsAreDecisionsOnly:true},32768);}
}
