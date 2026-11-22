import {createHash} from 'node:crypto';
import type {OrchestrationWorkPackageSpec,RequiredCapability} from '../starli-orchestrator/domain.js';
import type {SocialCanonicalConnectionState,SocialConnectionTruthSnapshot} from '../social-publishing/connection-truth.js';
import type {SocialPlatform} from '../social-publishing/types.js';

export const MARKETING_PACKAGE_KINDS=['CAMPAIGN_PLAN','SOCIAL_POST_DRAFT','SHORT_VIDEO_BRIEF','LANDING_CTA_UPDATE','PUBLISH_POSTS','SCHEDULE_POSTS','ANALYTICS_REVIEW'] as const;
export type MarketingPackageKind=typeof MARKETING_PACKAGE_KINDS[number];

export interface MarketingLaunchTemplateInput{
  templateKey:string;
  launchName:string;
  objective:string;
  projectId:string|null;
  platforms:SocialPlatform[];
  socialTruth:SocialConnectionTruthSnapshot;
}

export interface MarketingLaunchWorkPackage extends OrchestrationWorkPackageSpec{
  marketingKind:MarketingPackageKind;
  summary:string;
  platforms:SocialPlatform[];
  draftOrdinal?:number;
  governance:{externalEffect:boolean;providerReceiptRequired:boolean;analyticsTruth:'VERIFIED'|'NO_VERIFIED_DATA'|'UNAVAILABLE'|'NOT_APPLICABLE'};
}

const SAFE=/^[A-Za-z0-9_.:-]{1,128}$/;
const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>`${JSON.stringify(key)}:${stable(val)}`).join(',')}}`:JSON.stringify(value);
const shortHash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex').slice(0,16);
const uniquePlatforms=(platforms:SocialPlatform[])=>[...new Set(platforms)].slice(0,12);
const connected=(state:SocialCanonicalConnectionState)=>state==='CONNECTED';

function socialCapability(snapshot:SocialConnectionTruthSnapshot,platforms:SocialPlatform[],capabilityId:string):RequiredCapability{
  const rows=platforms.map(platform=>snapshot.connections.filter(connection=>connection.platform===platform));
  const allConnected=platforms.length>0&&rows.every(group=>group.some(connection=>connected(connection.state)&&connection.capabilities.includes(capabilityId)));
  return {capabilityId,projectScoped:true,availability:snapshot.providerConfigured?'AVAILABLE':'MISSING',connection:allConnected?'CONNECTED':'MISSING'};
}

export function createMarketingLaunchWorkPackages(input:MarketingLaunchTemplateInput):MarketingLaunchWorkPackage[]{
  if(!SAFE.test(input.templateKey))throw new Error('Invalid marketing template key.');
  const launchName=String(input.launchName||'').trim().slice(0,160),objective=String(input.objective||'').trim().slice(0,600);
  if(!launchName||!objective)throw new Error('Marketing launch name and objective are required.');
  const platforms=uniquePlatforms(input.platforms);
  if(!platforms.length)throw new Error('At least one social platform is required.');
  const prefix=`marketing-${shortHash({templateKey:input.templateKey,launchName,objective,projectId:input.projectId,platforms})}`;
  const id=(suffix:string)=>`${prefix}-${suffix}`;
  const campaignId=id('campaign-plan');
  const draftIds=Array.from({length:5},(_,index)=>id(`social-draft-${index+1}`));
  const videoId=id('video-brief'),ctaId=id('landing-cta'),publishId=id('publish'),scheduleId=id('schedule'),analyticsId=id('analytics-review');
  const sourceRef={kind:'marketing_launch_template',id:input.templateKey};
  const base=(spec:Omit<MarketingLaunchWorkPackage,'projectId'|'sourceRef'>):MarketingLaunchWorkPackage=>({...spec,projectId:input.projectId,sourceRef});
  const packages:MarketingLaunchWorkPackage[]=[];

  packages.push(base({id:campaignId,target:'SOCIAL_CAMPAIGN',title:`Campaign plan · ${launchName}`,executionMode:'PLANNING_ONLY',dependencyPackageIds:[],requiredCapabilities:[],requiredArtifacts:[],requiredInputs:[],requiredApproval:{kind:'NONE',approvalId:null},agencyActionPlanId:null,marketingKind:'CAMPAIGN_PLAN',summary:`Prepare a customer-reviewable campaign plan for: ${objective}`,platforms,governance:{externalEffect:false,providerReceiptRequired:false,analyticsTruth:'NOT_APPLICABLE'}}));

  for(let index=0;index<5;index++)packages.push(base({id:draftIds[index],target:'SOCIAL_CAMPAIGN',title:`Social post draft ${index+1} · ${launchName}`,executionMode:'PLANNING_ONLY',dependencyPackageIds:[campaignId],requiredCapabilities:[],requiredArtifacts:[],requiredInputs:[],requiredApproval:{kind:'NONE',approvalId:null},agencyActionPlanId:null,marketingKind:'SOCIAL_POST_DRAFT',summary:`Draft social post ${index+1} of 5 for ${platforms.join(', ')}. Draft only; no provider side effect.`,platforms,draftOrdinal:index+1,governance:{externalEffect:false,providerReceiptRequired:false,analyticsTruth:'NOT_APPLICABLE'}}));

  packages.push(base({id:videoId,target:'VIDEO_DIRECTOR',title:`Short-video brief · ${launchName}`,executionMode:'PLANNING_ONLY',dependencyPackageIds:[campaignId],requiredCapabilities:[],requiredArtifacts:[],requiredInputs:[],requiredApproval:{kind:'NONE',approvalId:null},agencyActionPlanId:null,marketingKind:'SHORT_VIDEO_BRIEF',summary:'Prepare a short-video creative brief and storyboard request. Rendering is not implied by this package.',platforms,governance:{externalEffect:false,providerReceiptRequired:false,analyticsTruth:'NOT_APPLICABLE'}}));

  packages.push(base({id:ctaId,target:'CREATIVE_PROJECT',title:`Landing-page CTA update request · ${launchName}`,executionMode:'PLANNING_ONLY',dependencyPackageIds:[campaignId],requiredCapabilities:[],requiredArtifacts:[],requiredInputs:[],requiredApproval:{kind:'REVIEW',approvalId:null},agencyActionPlanId:null,marketingKind:'LANDING_CTA_UPDATE',summary:'Prepare a landing-page CTA change request for customer review. No deployment or website mutation occurs here.',platforms:[],governance:{externalEffect:false,providerReceiptRequired:false,analyticsTruth:'NOT_APPLICABLE'}}));

  const publishCapability=socialCapability(input.socialTruth,platforms,'PUBLISH_TEXT');
  packages.push(base({id:publishId,target:'SOCIAL_CAMPAIGN',title:`Publish approved launch posts · ${launchName}`,executionMode:'PLANNING_ONLY',dependencyPackageIds:[...draftIds,videoId,ctaId],requiredCapabilities:[publishCapability],requiredArtifacts:[],requiredInputs:[],requiredApproval:{kind:'EXPLICIT_APPROVAL',approvalId:null},agencyActionPlanId:null,marketingKind:'PUBLISH_POSTS',summary:'Governed publish operation. Requires canonical action-plan binding, explicit approval, connected provider capability, and provider receipts before success can be claimed.',platforms,governance:{externalEffect:true,providerReceiptRequired:true,analyticsTruth:'NOT_APPLICABLE'}}));

  const scheduleCapability=socialCapability(input.socialTruth,platforms,'SCHEDULE');
  packages.push(base({id:scheduleId,target:'SOCIAL_CAMPAIGN',title:`Schedule approved launch posts · ${launchName}`,executionMode:'PLANNING_ONLY',dependencyPackageIds:[...draftIds,videoId,ctaId],requiredCapabilities:[publishCapability,scheduleCapability],requiredArtifacts:[],requiredInputs:[{id:`${scheduleId}:schedule-window`,question:'What approved publish window and timezone should Starli use?'}],requiredApproval:{kind:'EXPLICIT_APPROVAL',approvalId:null},agencyActionPlanId:null,marketingKind:'SCHEDULE_POSTS',summary:'Governed scheduling operation. A proposed time is not SCHEDULED until the provider returns a schedule receipt.',platforms,governance:{externalEffect:true,providerReceiptRequired:true,analyticsTruth:'NOT_APPLICABLE'}}));

  const analyticsTruth=input.socialTruth.analytics.availability==='AVAILABLE'?'VERIFIED':input.socialTruth.analytics.availability==='UNAVAILABLE'?'UNAVAILABLE':'NO_VERIFIED_DATA';
  const analyticsCapability:RequiredCapability={capabilityId:'PROFILE_ANALYTICS',projectScoped:true,availability:analyticsTruth==='VERIFIED'?'AVAILABLE':input.socialTruth.providerConfigured?'UNKNOWN':'MISSING',connection:platforms.some(platform=>input.socialTruth.connections.some(connection=>connection.platform===platform&&connected(connection.state)&&connection.capabilities.includes('PROFILE_ANALYTICS')))?'CONNECTED':'MISSING'};
  packages.push(base({id:analyticsId,target:'KPI_MEASUREMENT',title:`Analytics review · ${launchName}`,executionMode:'PLANNING_ONLY',dependencyPackageIds:[publishId,scheduleId],requiredCapabilities:[analyticsCapability],requiredArtifacts:[],requiredInputs:[],requiredApproval:{kind:'NONE',approvalId:null},agencyActionPlanId:null,marketingKind:'ANALYTICS_REVIEW',summary:analyticsTruth==='VERIFIED'?'Review verified provider analytics after governed distribution receipts exist.':analyticsTruth==='NO_VERIFIED_DATA'?'Analytics review remains blocked from making performance claims because no verified provider analytics have been ingested.':'Analytics review is unavailable because the social provider is unavailable.',platforms,governance:{externalEffect:false,providerReceiptRequired:false,analyticsTruth}}));

  return packages;
}
