import type {Store} from '../store.js';
import {CreativeProjectService} from '../creative-projects/service.js';
import {CreativeOrchestrationLinkService} from '../creative-projects/orchestration-links.js';
import type {TenantContext} from '../creative-projects/types.js';
import type {OrchestrationReceipt} from '../starli-orchestrator/domain.js';
import type {AgencyExecutionReceipt} from '../agency-execution/types.js';
import type {ArtifactActivityKind,ConversationalArtifactBundle,ConversationalReceiptCard} from './types.js';

const MAX_RECEIPTS=20;
const activityKind=(type:string):ArtifactActivityKind=>type==='artifact.created'?'CREATED':type==='artifact.updated'?'UPDATED':type==='artifact.version.created'?'VERSION_CHANGED':'OTHER';
const safeWorkHref=(projectId:string,artifactId:string)=>`/app/workspace?project=${encodeURIComponent(projectId)}&artifact=${encodeURIComponent(artifactId)}`;
const receiptStatus=(r:OrchestrationReceipt):ConversationalReceiptCard['status']=>r.toStatus==='SUCCEEDED'?'SUCCESS':r.toStatus==='FAILED'?'FAILED':'BLOCKED';
export class ConversationalArtifactService{
 private creative:CreativeProjectService;private links:CreativeOrchestrationLinkService;
 constructor(private store:Store){this.creative=new CreativeProjectService(store);this.links=new CreativeOrchestrationLinkService(store)}
 artifact(context:TenantContext,artifactId:string,options:{receiptLimit?:number}={}):ConversationalArtifactBundle{
  const artifact=this.creative.getArtifact(context,artifactId),versions=this.creative.listArtifactVersions(context,artifact.id,{limit:1}),limit=Math.min(MAX_RECEIPTS,Math.max(1,Number(options.receiptLimit)||10));
  const activity=this.store.db.prepare("SELECT type FROM creative_activity WHERE tenant_id=? AND project_id=? AND artifact_id=? AND type IN ('artifact.created','artifact.updated','artifact.version.created') ORDER BY sequence DESC LIMIT 1").get(context.tenantId,artifact.projectId,artifact.id) as {type?:string}|undefined;
  const outgoing=this.store.db.prepare('SELECT depends_on_artifact_id AS id FROM creative_dependencies WHERE tenant_id=? AND project_id=? AND artifact_id=? ORDER BY created_at,id LIMIT 100').all(context.tenantId,artifact.projectId,artifact.id) as Array<{id:string}>;
  const incoming=this.store.db.prepare('SELECT artifact_id AS id FROM creative_dependencies WHERE tenant_id=? AND project_id=? AND depends_on_artifact_id=? ORDER BY created_at,id LIMIT 100').all(context.tenantId,artifact.projectId,artifact.id) as Array<{id:string}>;
  const projectLinks=this.links.listProjectLinks(context,artifact.projectId,200).filter(l=>l.artifactId===artifact.id),planIds=[...new Set(projectLinks.map(l=>l.orchestrationPlanId))];
  const blockCodes:string[]=[];for(const planId of planIds){let plan;try{plan=this.links.getPlan(context,planId)}catch{continue}for(const link of projectLinks.filter(l=>l.orchestrationPlanId===plan.id)){const pkg=plan.workPackages.find(p=>p.id===link.workPackageId);if(pkg)blockCodes.push(...pkg.blockCodes)}}
  const href=safeWorkHref(artifact.projectId,artifact.id),receipts=this.links.receiptsForArtifact(context,artifact.id,limit).filter(r=>r.kind==='AGENCY_EXECUTION'||r.kind==='PLANNING_RESULT').map(r=>{let status=receiptStatus(r);if(r.kind==='AGENCY_EXECUTION'&&r.agencyExecutionReceiptId){const agency=this.store.get('agency-execution-receipts',r.agencyExecutionReceiptId) as AgencyExecutionReceipt|undefined;if(agency&&agency.tenantId===context.tenantId&&(!agency.projectId||agency.projectId===artifact.projectId)){status=agency.state==='SUCCEEDED'?'SUCCESS':agency.state==='FAILED'?'FAILED':'BLOCKED'}}return{id:r.id,artifactId:artifact.id,projectId:artifact.projectId,orchestrationPlanId:r.orchestrationPlanId,workPackageId:r.workPackageId,status,kind:r.kind as 'AGENCY_EXECUTION'|'PLANNING_RESULT',summary:r.summary,occurredAt:r.createdAt,evidenceReference:r.sourceRef?{kind:r.sourceRef.kind,id:r.sourceRef.id}:null,openWork:{label:'Open Work' as const,href}}});
  return{artifact:{id:artifact.id,projectId:artifact.projectId,name:artifact.name,kind:artifact.kind,artifactStatus:artifact.status,latestVersion:versions.items[0]?.version??null,activity:activityKind(String(activity?.type||'')),updatedAt:artifact.updatedAt,preview:{state:'UNAVAILABLE',reason:'No verified preview evidence is available from the Artifact Graph.'},dependencyContext:{dependsOnArtifactIds:outgoing.map(r=>String(r.id)),dependentArtifactIds:incoming.map(r=>String(r.id)),workPackageBlockCodes:[...new Set(blockCodes)]},openWork:{label:'Open Work',href}},receipts};
 }
}
