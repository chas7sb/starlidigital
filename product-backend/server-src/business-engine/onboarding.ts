import {createHash} from 'node:crypto';
import type {RecordData,Store} from '../store.js';
import {now} from '../store.js';
import {BusinessEngineCompiler} from './compiler.js';
import type {ApprovalClass,CompilerInput,EngineActor,RecipeId} from './domain.js';
import {BusinessEngineService} from './service.js';

export const ONBOARDING_COLLECTIONS={profiles:'business-engine-onboarding-profiles',idempotency:'business-engine-onboarding-idempotency'} as const;
export const MACHINERY_READINESS=['READY','NEEDS_INPUT','NEEDS_CONNECTION','NEEDS_APPROVAL_POLICY','UNAVAILABLE'] as const;
export type MachineryReadiness=typeof MACHINERY_READINESS[number];
export type ConnectionReadiness='CONNECTED'|'NOT_CONNECTED'|'UNAVAILABLE'|'UNKNOWN';
export type AutonomyPreference='LOW'|'BALANCED'|'HIGH';

export type BusinessIdentityInput={name?:string;offer?:string;targetCustomers?:string;goals?:string[]};
export type BrandBasics={voice?:string;positioning?:string};
export type CurrentPresence={websiteUrl?:string|null;channels?:Array<{kind:string;handleOrUrl?:string}>};
export type ConnectionPreference={capabilityId:string;allowed:boolean;requiredForGoal:boolean};
export type OnboardingReadinessEvidence={connections?:Array<{capabilityId:string;status:ConnectionReadiness}>};
export type ApprovalPreferences={
 defaultApprovalClass?:ApprovalClass;
 requireApprovalForExternalCommunication?:boolean;
 requireApprovalForPublishing?:boolean;
 requireApprovalForDeploy?:boolean;
 requireApprovalForSpend?:boolean;
};
export type CommunicationPolicy={outboundAllowed?:boolean;dncPolicy?:'HONOR_CANONICAL_DNC'};
export type BusinessHours={timezone?:string;days?:string[];startLocal?:string;endLocal?:string};
export type OptionalWorkspaceLinks={crmReferenceId?:string;workspaceReferenceId?:string};

export type BusinessOnboardingInput={
 recipeId?:RecipeId;
 business?:BusinessIdentityInput;
 brand?:BrandBasics;
 presence?:CurrentPresence;
 connections?:ConnectionPreference[];
 autonomyPreference?:AutonomyPreference;
 approvalPreferences?:ApprovalPreferences;
 communicationPolicy?:CommunicationPolicy;
 businessHours?:BusinessHours;
 links?:OptionalWorkspaceLinks;
};

export type BusinessOnboardingProfile=RecordData&{
 tenantId:string;ownerId:string;revision:number;input:BusinessOnboardingInput;createdAt:string;updatedAt:string;
};
export type MachineryReadinessProjection={
 status:MachineryReadiness;
 missingFacts:string[];
 connectionBlockers:Array<{capabilityId:string;status:ConnectionReadiness}>;
 policyGaps:string[];
 unavailableReasons:string[];
 canCompileBusinessEngine:boolean;
 nextQuestion:string|null;
};
export type BusinessEngineBootstrapPlan={profile:BusinessOnboardingProfile;readiness:MachineryReadinessProjection;compilerInput:CompilerInput|null};

type Idem=RecordData&{tenantId:string;ownerId:string;scope:string;key:string;fingerprint:string;resultId:string};
const SAFE_KEY=/^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_REF=/^[A-Za-z0-9_.:-]{1,180}$/;
const stable=(x:unknown):string=>Array.isArray(x)?`[${x.map(stable).join(',')}]`:x&&typeof x==='object'?`{${Object.entries(x as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`:JSON.stringify(x);
const digest=(x:unknown)=>createHash('sha256').update(stable(x)).digest('hex');
const clean=(v:string|undefined,max:number)=>v?.trim().replace(/\s+/g,' ').slice(0,max)||undefined;
const clone=<T>(v:T):T=>structuredClone(v);
const validTime=(v:string|undefined)=>!!v&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const validTimezone=(v:string|undefined)=>{if(!v)return false;try{new Intl.DateTimeFormat('en-US',{timeZone:v}).format();return true}catch{return false}};
const validUrl=(v:string|undefined|null)=>{if(!v)return true;try{const u=new URL(v);return u.protocol==='https:'||u.protocol==='http:'}catch{return false}};

export class BusinessEngineOnboardingService{
 private engines:BusinessEngineService;
 private compiler=new BusinessEngineCompiler();
 constructor(private store:Store){this.engines=new BusinessEngineService(store)}
 private tenant(a:EngineActor){return a.workspaceTenantId||a.userId}
 private auth(a:EngineActor,p:Pick<BusinessOnboardingProfile,'tenantId'|'ownerId'>){if(a.role==='ADMIN')return;if(p.tenantId!==this.tenant(a)||p.ownerId!==a.userId)throw new Error('Business onboarding access denied.')}
 private profileId(a:EngineActor){return `be-onboarding:${digest({tenantId:this.tenant(a),ownerId:a.userId}).slice(0,32)}`}
 getProfile(a:EngineActor){const p=this.store.get(ONBOARDING_COLLECTIONS.profiles,this.profileId(a)) as BusinessOnboardingProfile|undefined;if(!p)return undefined;this.auth(a,p);return clone(p)}
 saveProfile(a:EngineActor,input:BusinessOnboardingInput,idempotencyKey:string){
  if(!SAFE_KEY.test(idempotencyKey))throw new Error('Invalid onboarding idempotency key.');
  const normalized=this.normalize(input),fingerprint=digest({tenantId:this.tenant(a),ownerId:a.userId,input:normalized}),idemId=`onboarding-idem:${digest({tenantId:this.tenant(a),ownerId:a.userId,key:idempotencyKey}).slice(0,40)}`;
  const oldIdem=this.store.get(ONBOARDING_COLLECTIONS.idempotency,idemId) as Idem|undefined;
  if(oldIdem){if(oldIdem.tenantId!==this.tenant(a)||oldIdem.ownerId!==a.userId||oldIdem.fingerprint!==fingerprint)throw new Error('Onboarding idempotency key conflict.');const old=this.getProfile(a);if(!old||old.id!==oldIdem.resultId)throw new Error('Idempotent onboarding profile unavailable.');return old}
  const existing=this.getProfile(a),t=now(),profile:BusinessOnboardingProfile={id:this.profileId(a),tenantId:this.tenant(a),ownerId:a.userId,revision:(existing?.revision||0)+1,input:normalized,createdAt:existing?.createdAt||t,updatedAt:t};
  this.store.db.exec('BEGIN IMMEDIATE');try{this.store.put(ONBOARDING_COLLECTIONS.profiles,profile,a.userId);this.store.put(ONBOARDING_COLLECTIONS.idempotency,{id:idemId,tenantId:profile.tenantId,ownerId:profile.ownerId,scope:'profile',key:idempotencyKey,fingerprint,resultId:profile.id},a.userId);this.store.db.exec('COMMIT')}catch(err){this.store.db.exec('ROLLBACK');throw err}
  return clone(profile);
 }
 readiness(a:EngineActor,evidence:OnboardingReadinessEvidence={}):MachineryReadinessProjection{const p=this.getProfile(a);if(!p)return{status:'NEEDS_INPUT',missingFacts:['business.name','business.offer','business.targetCustomers','business.goals','recipeId'],connectionBlockers:[],policyGaps:[],unavailableReasons:[],canCompileBusinessEngine:false,nextQuestion:'Tell me the business name, offer, target customers, goal, and business type.'};return this.project(p.input,evidence)}
 plan(a:EngineActor,evidence:OnboardingReadinessEvidence={}):BusinessEngineBootstrapPlan{const profile=this.getProfile(a);if(!profile)throw new Error('Business onboarding profile not found.');const readiness=this.project(profile.input,evidence);return{profile,readiness,compilerInput:readiness.canCompileBusinessEngine?this.toCompilerInput(profile.input,evidence):null}}
 bootstrap(a:EngineActor,input:{idempotencyKey:string;engineId?:string}){
  const {profile,readiness,compilerInput}=this.plan(a);if(!compilerInput||!readiness.canCompileBusinessEngine)throw new Error(`Business onboarding is not ready: ${readiness.status}.`);
  const name=compilerInput.goal.name,objective=compilerInput.goal.objective;
  const engine=input.engineId?this.engines.getEngine(a,input.engineId):this.engines.createEngine(a,{name,objective,idempotencyKey:`onboarding:${input.idempotencyKey}:engine`});
  const compiled=this.compiler.compile(compilerInput);const saved=engine.blueprint&&digest(engine.blueprint)===digest(compiled.blueprint)?engine:this.engines.saveBlueprint(a,engine.id,compiled.blueprint);const version=this.engines.createVersion(a,saved.id,{idempotencyKey:`onboarding:${input.idempotencyKey}:version`});
  return{profile,readiness,engine:saved,version,compilerOutput:compiled};
 }
 private project(input:BusinessOnboardingInput,evidence:OnboardingReadinessEvidence):MachineryReadinessProjection{
  const missingFacts:string[]=[];if(!input.recipeId)missingFacts.push('recipeId');if(!input.business?.name)missingFacts.push('business.name');if(!input.business?.offer)missingFacts.push('business.offer');if(!input.business?.targetCustomers)missingFacts.push('business.targetCustomers');if(!input.business?.goals?.length)missingFacts.push('business.goals');
  const policyGaps:string[]=[];if(!input.autonomyPreference)policyGaps.push('autonomyPreference');const ap=input.approvalPreferences;if(!ap?.defaultApprovalClass)policyGaps.push('approvalPreferences.defaultApprovalClass');for(const k of ['requireApprovalForExternalCommunication','requireApprovalForPublishing','requireApprovalForDeploy','requireApprovalForSpend'] as const)if(typeof ap?.[k]!=='boolean')policyGaps.push(`approvalPreferences.${k}`);if(typeof input.communicationPolicy?.outboundAllowed!=='boolean')policyGaps.push('communicationPolicy.outboundAllowed');if(input.communicationPolicy?.dncPolicy!=='HONOR_CANONICAL_DNC')policyGaps.push('communicationPolicy.dncPolicy');if(!validTimezone(input.businessHours?.timezone)||!validTime(input.businessHours?.startLocal)||!validTime(input.businessHours?.endLocal))policyGaps.push('businessHours');
  const evidenceById=new Map((evidence.connections||[]).map(c=>[c.capabilityId,c.status]));const required=(input.connections||[]).filter(c=>c.allowed&&c.requiredForGoal);const connectionBlockers=required.map(c=>({capabilityId:c.capabilityId,status:evidenceById.get(c.capabilityId)||'UNKNOWN' as ConnectionReadiness})).filter(c=>c.status!=='CONNECTED');const unavailableReasons=connectionBlockers.filter(c=>c.status==='UNAVAILABLE').map(c=>`Required connection ${c.capabilityId} is unavailable.`);
  const status:MachineryReadiness=unavailableReasons.length?'UNAVAILABLE':missingFacts.length?'NEEDS_INPUT':policyGaps.length?'NEEDS_APPROVAL_POLICY':connectionBlockers.length?'NEEDS_CONNECTION':'READY';
  const nextQuestion=missingFacts[0]?`Please provide ${missingFacts[0]}.`:policyGaps[0]?`Please configure ${policyGaps[0]}.`:connectionBlockers[0]?`Please connect ${connectionBlockers[0].capabilityId}.`:unavailableReasons[0]||null;
  return{status,missingFacts,connectionBlockers,policyGaps,unavailableReasons,canCompileBusinessEngine:missingFacts.length===0&&policyGaps.length===0,nextQuestion};
 }
 private toCompilerInput(input:BusinessOnboardingInput,evidence:OnboardingReadinessEvidence={}):CompilerInput{if(!input.recipeId||!input.business?.name||!input.business.offer||!input.business.targetCustomers||!input.business.goals?.length||!input.autonomyPreference||!input.approvalPreferences?.defaultApprovalClass)throw new Error('Critical onboarding facts are missing.');return{goal:{name:input.business.name,objective:input.business.goals.join('; '),customerPromise:input.business.offer,targetCustomer:input.business.targetCustomers,offers:[input.business.offer]},recipeId:input.recipeId,availableCapabilities:(evidence.connections||[]).filter(c=>c.status==='CONNECTED'&&(input.connections||[]).some(p=>p.capabilityId===c.capabilityId&&p.allowed)).map(c=>c.capabilityId),policy:{autonomy:input.autonomyPreference,defaultApprovalClass:input.approvalPreferences.defaultApprovalClass}}}
 private normalize(input:BusinessOnboardingInput):BusinessOnboardingInput{
  if(input.presence?.websiteUrl&&!validUrl(input.presence.websiteUrl))throw new Error('Invalid website URL.');if(input.businessHours?.timezone&&!validTimezone(input.businessHours.timezone))throw new Error('Invalid business timezone.');if(input.businessHours?.startLocal&&!validTime(input.businessHours.startLocal))throw new Error('Invalid business start time.');if(input.businessHours?.endLocal&&!validTime(input.businessHours.endLocal))throw new Error('Invalid business end time.');
  const refs=input.links||{};for(const v of [refs.crmReferenceId,refs.workspaceReferenceId])if(v&&!SAFE_REF.test(v))throw new Error('Invalid workspace reference.');const connections=(input.connections||[]).slice(0,50).map(c=>{if(!SAFE_REF.test(c.capabilityId))throw new Error('Invalid capability id.');return{...c}});if(new Set(connections.map(c=>c.capabilityId)).size!==connections.length)throw new Error('Duplicate capability preference.');
  return{recipeId:input.recipeId,business:input.business?{name:clean(input.business.name,120),offer:clean(input.business.offer,300),targetCustomers:clean(input.business.targetCustomers,300),goals:(input.business.goals||[]).slice(0,10).map(g=>clean(g,300)!).filter(Boolean)}:undefined,brand:input.brand?{voice:clean(input.brand.voice,300),positioning:clean(input.brand.positioning,300)}:undefined,presence:input.presence?{websiteUrl:input.presence.websiteUrl||null,channels:(input.presence.channels||[]).slice(0,20).map(c=>({kind:clean(c.kind,80)!,handleOrUrl:clean(c.handleOrUrl,300)}))}:undefined,connections,autonomyPreference:input.autonomyPreference,approvalPreferences:input.approvalPreferences?{...input.approvalPreferences}:undefined,communicationPolicy:input.communicationPolicy?{...input.communicationPolicy}:undefined,businessHours:input.businessHours?{timezone:input.businessHours.timezone,days:(input.businessHours.days||[]).slice(0,7).map(d=>clean(d,16)!).filter(Boolean),startLocal:input.businessHours.startLocal,endLocal:input.businessHours.endLocal}:undefined,links:{...refs}};
 }
}
