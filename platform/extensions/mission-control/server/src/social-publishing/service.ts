import { createHash, randomUUID } from 'node:crypto';
import type { SocialCapability, SocialCapabilityPolicy, SocialConnection, SocialEventSink, SocialPlatformResult, SocialPostPlan, SocialProviderAdapter, SocialPublishJob, SocialPublishState } from './types.js';
import type { SocialRepository } from './repository.js';
import { assertOpaqueRef, assertPlan, boundedLimit, sanitizeProviderData, sanitizeSocialEventPayload } from './validation.js';

export class SocialPublishingService {
  constructor(private repo:SocialRepository, private providers:Map<string,SocialProviderAdapter>, private policy:SocialCapabilityPolicy, private events?:SocialEventSink){}
  saveConnection(connection:SocialConnection){
    assertOpaqueRef(connection.providerProfileRef,'provider profile reference'); assertOpaqueRef(connection.accountRef,'account reference');
    const clean=sanitizeProviderData(connection); this.repo.putConnection(clean); this.emit('social.connection.connected',{tenantId:clean.tenantId,projectId:clean.projectId,connectionId:clean.id,provider:clean.provider,platform:clean.platform,state:clean.state}); return clean;
  }
  listConnections(tenantId:string){return this.repo.listConnections(tenantId);}
  listDrafts(tenantId:string){return this.repo.listPlans(tenantId).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,50);}
  listJobs(tenantId:string){return this.repo.listJobs(tenantId).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,50);}
  providerNames(){return [...this.providers.keys()].sort();}
  async createConnectionFlow(tenantId:string,providerName:string,input:{platforms?:any[];returnUrl:string}){const provider=this.requireProvider(providerName);return provider.createConnectionFlow({tenantId,platforms:(input.platforms||[]).slice(0,12),returnUrl:input.returnUrl});}
  async syncConnections(tenantId:string,providerName:string){const provider=this.requireProvider(providerName),rows=await provider.listConnectedAccounts({tenantId}),now=new Date().toISOString(),existing=this.repo.listConnections(tenantId).filter(c=>c.provider===providerName),seen=new Set<string>(),saved:SocialConnection[]=[];for(const row of rows.slice(0,100)){const id=`sconn-${this.connectionKey(providerName,row.providerProfileRef,row.platform,row.accountRef)}`;seen.add(id);const previous=this.repo.getConnection(tenantId,id);saved.push(this.saveConnection({id,tenantId,projectId:row.projectId,provider:row.provider,platform:row.platform,providerProfileRef:row.providerProfileRef,accountRef:row.accountRef,safeMetadata:row.safeMetadata,capabilities:row.capabilities,state:row.state,connectedAt:previous?.connectedAt||now,refreshedAt:now}));}for(const connection of existing)if(!seen.has(connection.id)&&connection.state!=='DISCONNECTED')this.repo.putConnection({...connection,state:'DISCONNECTED',refreshedAt:now});return saved;}
  createDraft(plan:SocialPostPlan){assertPlan(plan); for(const v of plan.variants){const c=this.requireConnection(plan.tenantId,v.connectionId); if(c.platform!==v.platform)throw new Error('Connection platform mismatch');} this.repo.putPlan(sanitizeProviderData(plan)); this.emit('social.post.drafted',{tenantId:plan.tenantId,projectId:plan.projectId,planId:plan.id,platforms:plan.variants.map(v=>v.platform),variantCount:plan.variants.length}); return plan;}
  async publish(tenantId:string,planId:string,idempotencyKey:string):Promise<SocialPublishJob>{
    assertOpaqueRef(idempotencyKey,'idempotency key'); const existing=this.repo.findJobByIdempotency(tenantId,idempotencyKey); if(existing)return structuredClone(existing);
    const plan=this.repo.getPlan(tenantId,planId); if(!plan)throw new Error('Social post plan not found'); assertPlan(plan);
    if(plan.schedule.mode==='DRAFT')throw new Error('Draft plans cannot be published');
    for(const variant of plan.variants){ const connection=this.requireConnection(tenantId,variant.connectionId); this.requireProvider(connection.provider); const capability:SocialCapability=(variant.mediaRefs?.some(x=>/video/i.test(x))?'PUBLISH_VIDEO':variant.mediaRefs?.length?'PUBLISH_IMAGES':'PUBLISH_TEXT'); const auth=await this.policy.authorize({tenantId,projectId:plan.projectId,capability,approvalReference:plan.approvalReference,externalWrite:true}); if(!auth.allowed)throw new Error(`Approval required${auth.reason?`: ${auth.reason}`:''}`); if(plan.schedule.mode==='SCHEDULE'){ const scheduleAuth=await this.policy.authorize({tenantId,projectId:plan.projectId,capability:'SCHEDULE',approvalReference:plan.approvalReference,externalWrite:true}); if(!scheduleAuth.allowed)throw new Error('Schedule approval required'); } if(plan.schedule.mode==='QUEUE'){ const queueAuth=await this.policy.authorize({tenantId,projectId:plan.projectId,capability:'QUEUE',approvalReference:plan.approvalReference,externalWrite:true}); if(!queueAuth.allowed)throw new Error('Queue approval required'); } if(connection.state==='DISCONNECTED'||connection.state==='ERROR')throw new Error('Connection unavailable'); }
    const now=new Date().toISOString(); const job:SocialPublishJob={id:`spub-${randomUUID()}`,tenantId,planId,state:'PUBLISHING',idempotencyKey,results:[],createdAt:now,updatedAt:now}; this.repo.putJob(job);
    for(const variant of plan.variants){
      const connection=this.requireConnection(tenantId,variant.connectionId); let result:SocialPlatformResult;
      if(connection.state==='REAUTH_REQUIRED'){ result={platform:variant.platform,connectionId:connection.id,state:'NEEDS_REAUTH',errorCode:'REAUTH_REQUIRED'}; }
      else {
        const provider=this.providers.get(connection.provider); if(!provider)throw new Error(`Provider adapter unavailable: ${connection.provider}`);
        const capability:SocialCapability=(variant.mediaRefs?.some(x=>/video/i.test(x))?'PUBLISH_VIDEO':variant.mediaRefs?.length?'PUBLISH_IMAGES':'PUBLISH_TEXT');
        if(!connection.capabilities.includes(capability)) { result={platform:variant.platform,connectionId:connection.id,state:'FAILED',errorCode:'CAPABILITY_UNAVAILABLE'}; }
        else {
          const input={connection,variant,schedule:plan.schedule,idempotencyKey:`${idempotencyKey}:${variant.platform}`};
          try{
            const p=capability==='PUBLISH_VIDEO'?await provider.publishVideo(input):capability==='PUBLISH_IMAGES'?await provider.publishImages(input):await provider.publishText(input);
            result={platform:variant.platform,connectionId:connection.id,...sanitizeProviderData(p)};
            if(result.state==='NEEDS_REAUTH')this.repo.putConnection({...connection,state:'REAUTH_REQUIRED',refreshedAt:new Date().toISOString()});
          }catch{
            result={platform:variant.platform,connectionId:connection.id,state:'FAILED',errorCode:'PROVIDER_UNAVAILABLE'};
            this.repo.putConnection({...connection,state:'ERROR',refreshedAt:new Date().toISOString()});
          }
        }
      }
      job.results.push(result);
    }
    job.state=this.overall(job.results); job.updatedAt=new Date().toISOString(); this.repo.putJob(job); this.emit(job.state==='PUBLISHED'?'social.post.published':job.state==='PARTIAL_SUCCESS'?'social.post.partial_success':job.state==='NEEDS_REAUTH'?'social.connection.reauth_required':'social.post.failed',{tenantId,projectId:plan.projectId,planId,jobId:job.id,state:job.state,results:job.results.map(r=>({platform:r.platform,state:r.state,errorCode:r.errorCode,warningCodes:r.warningCodes}))}); return structuredClone(job);
  }

  async listComments(tenantId:string,connectionId:string,providerPostRef?:string,limit?:number){const c=this.requireConnection(tenantId,connectionId);this.requireCapability(c,'COMMENTS_READ');await this.authorize(c,'COMMENTS_READ',false);return this.requireProvider(c.provider).listComments({connection:c,providerPostRef,limit:boundedLimit(limit)});}
  async listDms(tenantId:string,connectionId:string,limit?:number){const c=this.requireConnection(tenantId,connectionId);this.requireCapability(c,'DMS_READ');await this.authorize(c,'DMS_READ',false);return this.requireProvider(c.provider).listDms({connection:c,limit:boundedLimit(limit,50)});}
  async listGoogleBusinessReviews(tenantId:string,connectionId:string,limit?:number){const c=this.requireConnection(tenantId,connectionId);this.requireCapability(c,'GOOGLE_REVIEWS_READ');await this.authorize(c,'GOOGLE_REVIEWS_READ',false);return this.requireProvider(c.provider).listGoogleBusinessReviews({connection:c,limit:boundedLimit(limit)});}
  async replyToComment(tenantId:string,connectionId:string,interactionRef:string,text:string,approvalReference:string,idempotencyKey:string){const c=this.requireConnection(tenantId,connectionId);this.requireCapability(c,'COMMENTS_REPLY');await this.authorize(c,'COMMENTS_REPLY',true,approvalReference);return this.requireProvider(c.provider).replyToComment({connection:c,interactionRef,text:this.boundedText(text),idempotencyKey});}
  async moderateComment(tenantId:string,connectionId:string,interactionRef:string,action:'HIDE'|'UNHIDE'|'DELETE'|'REPORT',approvalReference:string,idempotencyKey:string){const c=this.requireConnection(tenantId,connectionId);this.requireCapability(c,'COMMENTS_MODERATE');await this.authorize(c,'COMMENTS_MODERATE',true,approvalReference);return this.requireProvider(c.provider).moderateComment({connection:c,interactionRef,action,idempotencyKey});}
  async sendDm(tenantId:string,connectionId:string,conversationRef:string,text:string,approvalReference:string,idempotencyKey:string){const c=this.requireConnection(tenantId,connectionId);this.requireCapability(c,'DMS_SEND');await this.authorize(c,'DMS_SEND',true,approvalReference);return this.requireProvider(c.provider).sendDm({connection:c,conversationRef,text:this.boundedText(text),idempotencyKey});}
  async replyGoogleBusinessReview(tenantId:string,connectionId:string,reviewRef:string,text:string,approvalReference:string,idempotencyKey:string){const c=this.requireConnection(tenantId,connectionId);this.requireCapability(c,'GOOGLE_REVIEWS_REPLY');await this.authorize(c,'GOOGLE_REVIEWS_REPLY',true,approvalReference);return this.requireProvider(c.provider).replyGoogleBusinessReview({connection:c,reviewRef,text:this.boundedText(text),idempotencyKey});}
  async profileAnalytics(tenantId:string,connectionId:string){const c=this.requireConnection(tenantId,connectionId); if(!c.capabilities.includes('PROFILE_ANALYTICS'))throw new Error('Capability unavailable'); const auth=await this.policy.authorize({tenantId,projectId:c.projectId,capability:'PROFILE_ANALYTICS',externalWrite:false}); if(!auth.allowed)throw new Error('Analytics access denied'); const provider=this.requireProvider(c.provider); return sanitizeProviderData(await provider.profileAnalytics({connection:c}));}
  async history(tenantId:string,connectionId:string,limit?:number){const c=this.requireConnection(tenantId,connectionId); return this.requireProvider(c.provider).history({connection:c,limit:boundedLimit(limit)});}
  private connectionKey(provider:string,profileRef:string,platform:string,accountRef:string){return createHash('sha256').update(`${provider}:${profileRef}:${platform}:${accountRef}`).digest('hex').slice(0,24);}
  private requireConnection(tenantId:string,id:string){const c=this.repo.getConnection(tenantId,id); if(!c)throw new Error('Social connection not found'); return c;}
  private requireProvider(name:string){const p=this.providers.get(name);if(!p)throw new Error(`Provider adapter unavailable: ${name}`);return p;}
  private requireCapability(c:SocialConnection,capability:SocialCapability){if(!c.capabilities.includes(capability))throw new Error('Capability unavailable');}
  private async authorize(c:SocialConnection,capability:SocialCapability,externalWrite:boolean,approvalReference?:string){const r=await this.policy.authorize({tenantId:c.tenantId,projectId:c.projectId,capability,approvalReference,externalWrite});if(!r.allowed)throw new Error(externalWrite?'Approval required':'Access denied');}
  private boundedText(text:string){if(typeof text!=='string'||!text.trim()||text.length>5000)throw new Error('Text out of bounds');return text;}
  private overall(results:SocialPlatformResult[]):SocialPublishState{const states=results.map(r=>r.state); if(states.every(s=>s==='PUBLISHED'))return 'PUBLISHED'; if(states.every(s=>s==='SCHEDULED'))return 'SCHEDULED'; if(states.every(s=>s==='NEEDS_REAUTH'))return 'NEEDS_REAUTH'; if(states.every(s=>s==='FAILED'))return 'FAILED'; if(states.some(s=>s==='PUBLISHED'||s==='SCHEDULED')&&states.some(s=>['FAILED','NEEDS_REAUTH','NEEDS_REVIEW'].includes(s)))return 'PARTIAL_SUCCESS'; return states[0]||'FAILED';}
  private emit(type:string,payload:Record<string,unknown>){this.events?.publish(type,sanitizeSocialEventPayload(payload));}
}
