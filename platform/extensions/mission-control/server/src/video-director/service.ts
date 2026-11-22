import { createHash } from 'node:crypto';
import type { Store } from '../store.js';
import type { Events } from '../events.js';
import type { VideoServices } from '../video/service.js';
import type { ActorContext, BrandProfileRecord } from '../video/types.js';
import { compileScene } from './templates.js';
import { assertOpaqueId, sanitizeDirectorText, validateBriefInput, validateStoryboard } from './validation.js';
import type { AudioPlan, Storyboard, StoryboardScene, VideoBrief, VideoBriefInput, VideoDirectorPlan, VideoDirectorReceipt, VideoDirectorRun, VideoPlatformTarget, VideoVariantPlan } from './types.js';

const stableHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const now = () => new Date().toISOString();

const VARIANTS: Record<'VERTICAL_9_16'|'SQUARE_1_1'|'HORIZONTAL_16_9', Omit<VideoVariantPlan,'id'|'platforms'>> = {
  VERTICAL_9_16:{format:'VERTICAL_9_16',width:1080,height:1920,safeArea:{top:180,right:96,bottom:300,left:96},layoutProfile:'VERTICAL'},
  SQUARE_1_1:{format:'SQUARE_1_1',width:1080,height:1080,safeArea:{top:96,right:96,bottom:120,left:96},layoutProfile:'SQUARE'},
  HORIZONTAL_16_9:{format:'HORIZONTAL_16_9',width:1920,height:1080,safeArea:{top:72,right:140,bottom:96,left:140},layoutProfile:'HORIZONTAL'},
};

export class VideoDirectorService {
  constructor(private deps:{store:Store;events:Events;videoServices:VideoServices}){}

  private company(type:string, ownerId:string, entities:Array<{kind:string;id:string}>, payload:Record<string,unknown>, idempotencyKey:string){
    if (!this.deps.events.companyEvents) return;
    this.deps.events.company({type,source:'video-director',entities:[{kind:'user',id:ownerId},...entities],idempotencyKey,payload});
  }

  private assertArtifacts(actor:ActorContext, ids:string[]){
    for(const id of ids){
      assertOpaqueId(id,'artifactId');
      const artifact=['creative-artifacts','artifacts','project-artifacts'].map(c=>this.deps.store.get(c,id)).find(Boolean);
      if(!artifact || (artifact.ownerId!==actor.id && artifact.visibility!=='PUBLIC' && !['ADMIN','admin'].includes(actor.role||''))) throw new Error('Source artifact not found or access denied');
    }
  }

  private assertAssets(actor:ActorContext, ids:string[]){
    for(const id of ids){
      assertOpaqueId(id,'assetId'); const asset=this.deps.store.get('asset-records',id);
      if(!asset || (asset.visibility!=='PUBLIC' && asset.ownerId!==actor.id && !['ADMIN','admin'].includes(actor.role||''))) throw new Error('Video asset not found or access denied');
    }
  }

  listPlans(actor:ActorContext):VideoDirectorPlan[]{return (this.deps.store.list('video-director-plans') as any[]).filter(row=>row.ownerId===actor.id||['ADMIN','admin'].includes(actor.role||'')).map(row=>row.plan as VideoDirectorPlan).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,50);}
  getPlan(actor:ActorContext,id:string):VideoDirectorPlan|undefined{assertOpaqueId(id,'planId');const row=this.deps.store.get('video-director-plans',id) as any;if(!row)return undefined;if(row.ownerId!==actor.id&&!['ADMIN','admin'].includes(actor.role||''))throw new Error('Video director plan access denied');return row.plan as VideoDirectorPlan;}
  listRuns(actor:ActorContext):VideoDirectorRun[]{return (this.deps.store.list('video-director-runs') as VideoDirectorRun[]).filter(run=>run.ownerId===actor.id||['ADMIN','admin'].includes(actor.role||'')).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,50);}
  getRun(actor:ActorContext,id:string):VideoDirectorRun|undefined{assertOpaqueId(id,'runId');const run=this.deps.store.get('video-director-runs',id) as VideoDirectorRun|undefined;if(!run)return undefined;if(run.ownerId!==actor.id&&!['ADMIN','admin'].includes(actor.role||''))throw new Error('Video director run access denied');return run;}

  createBrief(actor:ActorContext,input:VideoBriefInput):VideoBrief{
    validateBriefInput(input); this.assertAssets(actor,[...(input.assetIds||[]),...(input.musicAssetId?[input.musicAssetId]:[])]); this.assertArtifacts(actor,input.sourceArtifactIds||[]);
    if(input.brandProfileId && !this.deps.videoServices.getBrandProfile(input.brandProfileId,actor)) throw new Error('Brand profile not found or access denied');
    const normalized={...input,platformTargets:[...(input.platformTargets?.length?input.platformTargets:['TIKTOK' as const])].sort()};
    const key=stableHash({actor:actor.id,input:normalized}); const existing=this.deps.store.list('video-director-briefs').find(x=>x.ownerId===actor.id&&x.idempotencyKey===key) as any;
    if(existing) return existing.brief;
    const brief:VideoBrief={id:`vbrief-${key}`,ownerId:actor.id,title:sanitizeDirectorText(input.title,'title',160),objective:sanitizeDirectorText(input.objective,'objective'),audience:sanitizeDirectorText(input.audience||'Target customers','audience'),product:sanitizeDirectorText(input.product||input.title,'product'),cta:sanitizeDirectorText(input.cta||'Learn more','cta',160),platformTargets:normalized.platformTargets,durationTarget:input.durationTarget??30,tone:sanitizeDirectorText(input.tone||'confident','tone',120),style:sanitizeDirectorText(input.style||'premium modern','style',160),language:input.language||'en',brandProfileId:input.brandProfileId,sourceArtifactIds:[...(input.sourceArtifactIds||[])],assetIds:[...(input.assetIds||[])],complianceConstraints:[...(input.complianceConstraints||[])],voiceover:input.voiceover??true,musicAssetId:input.musicAssetId,createdAt:now()};
    this.deps.store.put('video-director-briefs',{id:brief.id,ownerId:actor.id,idempotencyKey:key,brief});
    this.company('video.brief.created',actor.id,[{kind:'video_brief',id:brief.id}],{durationTarget:brief.durationTarget,platformCount:brief.platformTargets.length,assetCount:brief.assetIds.length,language:brief.language},`video.brief:${brief.id}`); return brief;
  }

  createStoryboard(actor:ActorContext,brief:VideoBrief):Storyboard{
    if(brief.ownerId!==actor.id && !['ADMIN','admin'].includes(actor.role||'')) throw new Error('Video brief access denied'); this.assertAssets(actor,brief.assetIds);
    const existing=this.deps.store.get('video-director-storyboards',`vstory-${stableHash({briefId:brief.id,brief})}`) as any; if(existing)return existing.storyboard;
    const desired=Math.max(3,Math.min(8,Math.round(brief.durationTarget/5))); const per=Math.max(1.5,Math.min(8,brief.durationTarget/desired)); const assets=[...brief.assetIds];
    const sceneDefs:Array<Partial<StoryboardScene>&Pick<StoryboardScene,'template'|'headline'>>=[
      {template:'HOOK_TITLE',headline:brief.objective},
      ...(assets.length?[{template:'PRODUCT_SCREENSHOT' as const,headline:brief.product,body:`See ${brief.product} in action.`}]:[{template:'FEATURE_CARDS' as const,headline:`Built for ${brief.audience}`,body:brief.product}]),
      {template:'BENEFIT_CARDS',headline:'Why it matters',body:`A clear, focused experience for ${brief.audience}.`},
      {template:'CTA_END_CARD',headline:brief.cta,body:brief.product},
    ];
    while(sceneDefs.length<desired) sceneDefs.splice(sceneDefs.length-1,0,{template:sceneDefs.length%2?'KINETIC_TYPOGRAPHY':'FEATURE_CARDS',headline:sceneDefs.length%2?brief.product:`Designed for ${brief.audience}`,body:brief.tone});
    const scenes=sceneDefs.slice(0,desired).map((d,i):StoryboardScene=>({id:`scene-${String(i+1).padStart(2,'0')}`,template:d.template, duration:i===desired-1?Math.max(1.5,brief.durationTarget-per*(desired-1)):per,headline:sanitizeDirectorText(d.headline,'headline',220),body:d.body?sanitizeDirectorText(d.body,'body',500):undefined,assetRequirements:i===1&&assets[0]?[{id:`asset-${i}`,source:'STARLI_ASSET',purpose:'Primary product visual',assetId:assets[0],required:true}]:[],narration:brief.voiceover?sanitizeDirectorText(i===0?brief.objective:i===desired-1?brief.cta:(d.body||d.headline),'narration',800):undefined}));
    const storyboard:Storyboard={id:`vstory-${stableHash({briefId:brief.id,scenes})}`,briefId:brief.id,hook:scenes[0].headline,scenes,totalDuration:scenes.reduce((s,x)=>s+x.duration,0),createdAt:now()}; validateStoryboard(storyboard);
    this.deps.store.put('video-director-storyboards',{id:storyboard.id,ownerId:brief.ownerId,storyboard}); this.company('video.storyboard.created',brief.ownerId,[{kind:'video_brief',id:brief.id},{kind:'storyboard',id:storyboard.id}],{sceneCount:scenes.length,duration:storyboard.totalDuration},`video.storyboard:${storyboard.id}`); return storyboard;
  }

  private variants(targets:VideoPlatformTarget[]):VideoVariantPlan[]{
    const groups:{format:keyof typeof VARIANTS; platforms:VideoPlatformTarget[]}[]=[]; const add=(format:keyof typeof VARIANTS,p:VideoPlatformTarget)=>{let g=groups.find(x=>x.format===format);if(!g)groups.push(g={format,platforms:[]});g.platforms.push(p)};
    for(const p of targets){if(['TIKTOK','INSTAGRAM_REELS','YOUTUBE_SHORTS'].includes(p))add('VERTICAL_9_16',p);else if(p==='SOCIAL_FEED')add('SQUARE_1_1',p);else add('HORIZONTAL_16_9',p)}
    return groups.sort((a,b)=>a.format.localeCompare(b.format)).map(g=>({id:`variant-${g.format.toLowerCase()}-${stableHash(g.platforms.sort())}`,...VARIANTS[g.format],platforms:g.platforms.sort()}));
  }

  createPlan(actor:ActorContext,input:VideoBriefInput):VideoDirectorPlan{
    const brief=this.createBrief(actor,input),storyboard=this.createStoryboard(actor,brief); const variants=this.variants(brief.platformTargets);
    const audioPlan:AudioPlan={voiceover:{enabled:brief.voiceover,language:brief.language,segments:storyboard.scenes.filter(s=>s.narration).map(s=>({sceneId:s.id,text:s.narration!}))},...(brief.musicAssetId?{music:{assetId:brief.musicAssetId,volume:.28}}:{})};
    const idempotencyKey=stableHash({brief:brief.id,storyboard:storyboard.id,variants,audioPlan}); const existing=this.deps.store.list('video-director-plans').find(x=>x.ownerId===actor.id&&x.idempotencyKey===idempotencyKey) as any;if(existing)return existing.plan;
    const plan:VideoDirectorPlan={id:`vplan-${idempotencyKey}`,ownerId:actor.id,brief,storyboard,audioPlan,variants,idempotencyKey,createdAt:now()}; this.deps.store.put('video-director-plans',{id:plan.id,ownerId:actor.id,idempotencyKey,plan});return plan;
  }

  compileSpec(plan:VideoDirectorPlan,variant:VideoVariantPlan,brand?:BrandProfileRecord){
    validateStoryboard(plan.storyboard); const scenes=plan.storyboard.scenes.map(s=>compileScene(s,variant,brand)); const duration=scenes.reduce((n:number,s:any)=>n+s.duration,0);
    const spec={version:'1.0',title:plan.brief.title,canvas:{width:variant.width,height:variant.height,fps:30,duration,backgroundColor:brand?.primaryColor||'#080C12'},brand:{businessName:brand?.businessName||'StarliDigital',logoAssetId:brand?.logoAssetId,primaryColor:brand?.primaryColor||'#080C12',secondaryColor:brand?.secondaryColor||'#10151D',accentColor:brand?.accentColor||'#C6DBF0',textColor:brand?.textColor||'#F4F6FA',silverColor:brand?.silverColor||'#A8B0BD',tagline:brand?.tagline||'',website:brand?.website||'',ctaText:brand?.ctaText||plan.brief.cta},scenes,audioTracks:plan.audioPlan.music?[{id:'music',assetId:plan.audioPlan.music.assetId,start:0,duration,volume:plan.audioPlan.music.volume,fadeIn:.4,fadeOut:.8,loop:true}]:[],voiceovers:plan.audioPlan.voiceover.enabled?plan.audioPlan.voiceover.segments.map((x,i)=>({id:`vo-${i+1}`,text:x.text,language:plan.audioPlan.voiceover.language,start:plan.storyboard.scenes.slice(0,i).reduce((n,s)=>n+s.duration,0),volume:1,ducking:true,duckVolume:.25})):[],output:{format:'mp4',codec:'h264',crf:20,preset:'fast'}};
    if(JSON.stringify(spec).length>500_000)throw new Error('Compiled video specification exceeds size limit'); return spec;
  }

  async prepareRun(actor:ActorContext,plan:VideoDirectorPlan):Promise<VideoDirectorReceipt>{
    if(plan.ownerId!==actor.id&&!['ADMIN','admin'].includes(actor.role||''))throw new Error('Video director plan access denied');
    const existing=this.deps.store.list('video-director-runs').find(x=>x.ownerId===actor.id&&x.planId===plan.id) as VideoDirectorRun|undefined;if(existing)return this.receipt(existing);
    const brand=this.deps.videoServices.getBrandProfile(plan.brief.brandProfileId||'bprof-starlidigital-default',actor); const projects:VideoDirectorRun['projects']=[];
    for(const variant of plan.variants){const spec=this.compileSpec(plan,variant,brand);this.assertAssets(actor,[...plan.brief.assetIds,...(plan.brief.musicAssetId?[plan.brief.musicAssetId]:[])]);const validation=await this.deps.videoServices.validateSpec(spec);if(!validation.valid)throw new Error(`Compiled video spec failed validation: ${validation.errors.map(e=>e.message||e.code).join('; ')}`); const draft=this.deps.videoServices.createProject(actor,{title:`${plan.brief.title} — ${variant.format}`,format:variant.format,purpose:plan.brief.objective,brandProfileId:brand?.id,spec}); const project=this.deps.videoServices.applySpec(draft.id,spec,actor); projects.push({variantId:variant.id,videoProjectId:project.id});this.company('video.spec.created',actor.id,[{kind:'video_plan',id:plan.id},{kind:'video_project',id:project.id}],{format:variant.format,sceneCount:plan.storyboard.scenes.length,duration:plan.storyboard.totalDuration},`video.spec:${plan.id}:${variant.id}`)}
    const run:VideoDirectorRun={id:`vrun-${stableHash({planId:plan.id,actor:actor.id})}`,ownerId:actor.id,planId:plan.id,status:'READY',projects,createdAt:now(),updatedAt:now()};this.deps.store.put('video-director-runs',run);return this.receipt(run);
  }

  async generatePreviews(actor:ActorContext,runId:string,timestamp=0.5):Promise<VideoDirectorReceipt>{
    const run=this.deps.store.get('video-director-runs',runId) as VideoDirectorRun|undefined;if(!run)throw new Error('Video director run not found');if(run.ownerId!==actor.id&&!['ADMIN','admin'].includes(actor.role||''))throw new Error('Video director run access denied');if(!Number.isFinite(timestamp)||timestamp<0||timestamp>180)throw new Error('Invalid preview timestamp');
    const projects=[] as VideoDirectorRun['projects']; for(const p of run.projects){const preview=await this.deps.videoServices.generatePreviewFrame(p.videoProjectId,timestamp,actor);projects.push({...p,previewUrl:preview.url})} const updated={...run,projects,updatedAt:now()};this.deps.store.put('video-director-runs',updated);return this.receipt(updated);
  }

  startRender(actor:ActorContext,runId:string):VideoDirectorReceipt{
    const run=this.deps.store.get('video-director-runs',runId) as VideoDirectorRun|undefined;if(!run)throw new Error('Video director run not found');if(run.ownerId!==actor.id&&!['ADMIN','admin'].includes(actor.role||''))throw new Error('Video director run access denied');if(run.status==='RENDERING'||run.status==='COMPLETE')return this.receipt(run);
    const projects=run.projects.map(p=>{const r=this.deps.videoServices.startRender(p.videoProjectId,actor);this.company('video.render.started',actor.id,[{kind:'video_run',id:run.id},{kind:'video_project',id:p.videoProjectId},{kind:'video_render',id:r.id}],{status:r.status},`video.render.started:${r.id}`);return{...p,renderId:r.id}});const updated={...run,status:'RENDERING' as const,projects,updatedAt:now()};this.deps.store.put('video-director-runs',updated);return this.receipt(updated);
  }

  refreshRun(actor:ActorContext,runId:string):VideoDirectorReceipt{
    const run=this.deps.store.get('video-director-runs',runId) as VideoDirectorRun|undefined;if(!run)throw new Error('Video director run not found');if(run.ownerId!==actor.id&&!['ADMIN','admin'].includes(actor.role||''))throw new Error('Video director run access denied'); const renders=run.projects.map(p=>p.renderId?this.deps.videoServices.getRender(p.renderId,actor):undefined); let status=run.status;
    if(renders.some(r=>r?.status==='FAILED'))status='FAILED'; else if(renders.length&&renders.every(r=>r?.status==='COMPLETE'))status='COMPLETE';
    if(status!==run.status){const updated={...run,status,updatedAt:now()};this.deps.store.put('video-director-runs',updated);for(const r of renders.filter(Boolean)){if(r!.status==='COMPLETE')this.company('video.render.completed',actor.id,[{kind:'video_run',id:run.id},{kind:'video_render',id:r!.id}],{status:r!.status,fileSize:r!.fileSize||0},`video.render.completed:${r!.id}`);if(r!.status==='FAILED')this.company('video.render.failed',actor.id,[{kind:'video_run',id:run.id},{kind:'video_render',id:r!.id}],{status:r!.status,hasError:true},`video.render.failed:${r!.id}`)}return this.receipt(updated)} return this.receipt(run);
  }

  private receipt(run:VideoDirectorRun):VideoDirectorReceipt{return{runId:run.id,planId:run.planId,status:run.status,projects:run.projects,createdAt:run.createdAt}}
}
