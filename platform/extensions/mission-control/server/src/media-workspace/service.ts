import type {Store} from '../store.js';
import type {ActorContext} from '../video/types.js';
import type {VideoDirectorService} from '../video-director/service.js';
import type {SocialPublishingService} from '../social-publishing/service.js';
import type {SocialAnalyticsSnapshot} from '../social-publishing/types.js';
import type {HomeMediaSummary,WorkspaceMediaContext,WorkspaceVideoRender} from './types.js';

type ArtifactReference={domain:string;entityId:string};
const opaque=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(value)?value:'';
const safeRefs=(refs:ArtifactReference[]|undefined)=>(refs||[]).slice(0,100).map(ref=>({domain:opaque(ref.domain).toLowerCase(),entityId:opaque(ref.entityId)})).filter(ref=>ref.domain&&ref.entityId);
function renderReadiness(status:string):WorkspaceVideoRender['readiness']{switch(String(status).toUpperCase()){case'READY':case'VALIDATED':return'READY';case'RENDERING':return'RENDERING';case'COMPLETE':return'COMPLETE';case'FAILED':return'FAILED';default:return'UNKNOWN';}}

export class MediaWorkspaceService{
  constructor(private deps:{store:Store;videoDirector:VideoDirectorService;social:SocialPublishingService}){}
  snapshot(actor:ActorContext,input:{projectId:string;artifactIds:string[];references?:ArtifactReference[]}):WorkspaceMediaContext{
    const projectId=opaque(input.projectId);if(!projectId)throw new Error('Invalid project id');
    const artifactIds=[...new Set((input.artifactIds||[]).map(opaque).filter(Boolean))].slice(0,100),artifacts=new Set(artifactIds),refs=safeRefs(input.references);
    const videoRefs=new Set(refs.filter(ref=>['video','video-director','video_plan','video-plan','video_project','video-project'].includes(ref.domain)).map(ref=>ref.entityId));
    const socialRefs=new Set(refs.filter(ref=>['social','social-publishing','social_plan','social-plan'].includes(ref.domain)).map(ref=>ref.entityId));
    const plans=this.deps.videoDirector.listPlans(actor).filter(plan=>plan.brief.sourceArtifactIds.some(id=>artifacts.has(id))||videoRefs.has(plan.id)).slice(0,20),plan=plans[0];
    const runs=plan?this.deps.videoDirector.listRuns(actor).filter(run=>run.planId===plan.id||videoRefs.has(run.id)):[],run=runs[0];
    const drafts=this.deps.social.listDrafts(actor.id).filter(d=>d.projectId===projectId||socialRefs.has(d.id)||d.sourceArtifactRefs.some(id=>artifacts.has(id))).slice(0,20);
    const jobs=this.deps.social.listJobs(actor.id).filter(j=>drafts.some(d=>d.id===j.planId)).slice(0,20);
    const usedConnectionIds=new Set(drafts.flatMap(d=>d.variants.map(v=>v.connectionId)));
    const connections=this.deps.social.listConnections(actor.id).filter(c=>c.projectId===projectId||usedConnectionIds.has(c.id)).slice(0,20);
    const analytics=(this.deps.store.list('social-analytics-snapshots') as SocialAnalyticsSnapshot[]).filter(s=>s.tenantId===actor.id&&drafts.some(d=>d.variants.some(v=>v.connectionId===s.connectionId))).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0];
    const scheduled=drafts.some(d=>Boolean(d.schedule.publishAt)||d.schedule.mode==='SCHEDULE'),approvalRelevant=drafts.some(d=>d.schedule.mode!=='DRAFT');
    const updatedCandidates=[plan?.createdAt,run?.updatedAt,...drafts.map(d=>d.createdAt),...jobs.map(j=>j.updatedAt),analytics?.capturedAt].filter(Boolean) as string[];
    return{schemaVersion:2,projectId,availability:{storyboard:plan?'AVAILABLE':'EMPTY',variants:plan?.variants.length?'AVAILABLE':'EMPTY',render:run?'AVAILABLE':'UNAVAILABLE',socialDrafts:drafts.length?'AVAILABLE':'EMPTY',schedule:scheduled?'AVAILABLE':drafts.length?'EMPTY':'UNAVAILABLE',approval:approvalRelevant?'AVAILABLE':drafts.length?'EMPTY':'UNAVAILABLE',analytics:analytics?'AVAILABLE':jobs.some(j=>j.state==='PUBLISHED'||j.state==='PARTIAL_SUCCESS')?'UNAVAILABLE':'EMPTY'},video:{planId:plan?.id,storyboard:plan?{id:plan.storyboard.id,hook:plan.storyboard.hook,totalDuration:plan.storyboard.totalDuration,scenes:plan.storyboard.scenes.slice(0,20).map(scene=>({id:scene.id,template:scene.template,duration:scene.duration,headline:scene.headline,hasNarration:Boolean(scene.narration),assetCount:scene.assetRequirements.length}))}:undefined,variants:plan?plan.variants.slice(0,10).map(v=>({id:v.id,format:v.format,platforms:[...v.platforms].slice(0,10),width:v.width,height:v.height})):[],render:run?{runId:run.id,planId:run.planId,status:run.status,readiness:renderReadiness(run.status),variants:run.projects.slice(0,10).map(p=>({...p})),updatedAt:run.updatedAt}:undefined},social:{connections:connections.map(c=>({id:c.id,platform:c.platform,label:c.safeMetadata.displayName||c.safeMetadata.handle||c.platform,state:c.state==='CONNECTED'?'CONNECTED':c.state==='REAUTH_REQUIRED'?'REAUTH_REQUIRED':c.state==='ERROR'?'DEGRADED':'UNAVAILABLE'})),drafts:drafts.map(d=>({id:d.id,platforms:d.variants.map(v=>v.platform).slice(0,14),sourceArtifactRefs:[...d.sourceArtifactRefs].slice(0,50),mode:d.schedule.mode,publishAt:d.schedule.publishAt,timezone:d.schedule.timezone,approval:d.schedule.mode==='DRAFT'?'NOT_REQUIRED':d.approvalReference?'APPROVED':'AWAITING_APPROVAL',createdAt:d.createdAt})),publishResults:jobs.map(j=>({jobId:j.id,planId:j.planId,state:j.state,platforms:j.results.slice(0,14).map(r=>({platform:r.platform,state:r.state,publishedAt:r.publishedAt,warningCodes:r.warningCodes?.slice(0,10),errorCode:r.errorCode})),updatedAt:j.updatedAt})),analytics:analytics?{status:'AVAILABLE',capturedAt:analytics.capturedAt,metrics:Object.fromEntries(Object.entries(analytics.metrics).slice(0,30)),platform:analytics.platform}:{status:'NOT_AVAILABLE'}},updatedAt:updatedCandidates.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||new Date().toISOString()};
  }
  homeSummary(context:WorkspaceMediaContext):HomeMediaSummary{
    const pendingApprovalCount=context.social.drafts.filter(d=>d.approval==='AWAITING_APPROVAL').length,scheduledCount=context.social.drafts.filter(d=>Boolean(d.publishAt)||d.mode==='SCHEDULE').length,hasFailure=context.video.render?.readiness==='FAILED'||context.social.publishResults.some(job=>['FAILED','PARTIAL_SUCCESS','NEEDS_REAUTH','NEEDS_REVIEW'].includes(job.state)),artifactCount=(context.video.storyboard?1:0)+context.video.variants.length+context.social.drafts.length;
    const status:HomeMediaSummary['status']=hasFailure||pendingApprovalCount?'ATTENTION':context.video.render?.readiness==='COMPLETE'||context.social.publishResults.some(j=>j.state==='PUBLISHED')?'READY':artifactCount?'ACTIVE':'EMPTY';
    const headline=status==='ATTENTION'?'Media work needs attention':status==='READY'?'Media ready or published':status==='ACTIVE'?'Starli is preparing campaign media':'No active media work';
    const detail=pendingApprovalCount?`${pendingApprovalCount} publish approval${pendingApprovalCount===1?'':'s'} waiting.`:scheduledCount?`${scheduledCount} social draft${scheduledCount===1?' is':'s are'} scheduled.`:context.video.storyboard?`${context.video.storyboard.scenes.length} storyboard scenes across ${context.video.variants.length} video variant${context.video.variants.length===1?'':'s'}.`:'No authoritative video or social plan is linked to this project yet.';
    return{status,projectId:context.projectId,headline,detail,artifactCount,pendingApprovalCount,scheduledCount,latestAt:context.updatedAt};
  }
}
