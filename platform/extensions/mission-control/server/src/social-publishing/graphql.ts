import {randomUUID} from 'node:crypto';
import type {Context} from '../security.js';
import {limit,requireUser} from '../security.js';
import type {SocialPublishingService} from './service.js';
import {SOCIAL_PLATFORMS,type SocialPlatform,type SocialPostPlan,type SocialPostVariant} from './types.js';
import {socialConnectionTruthSnapshot} from './connection-truth.js';
import {projectSocialConversation} from './conversation.js';
const PLATFORM_SET=new Set<string>(SOCIAL_PLATFORMS);
const payload=(data:unknown)=>({schemaVersion:1,dataJson:JSON.stringify(data)});
const user=(ctx:Context)=>String(requireUser(ctx).id);
const cleanText=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';
const safeRef=(value:unknown)=>{const s=String(value||'');if(!/^[A-Za-z0-9_.:-]{1,300}$/.test(s))throw new Error('Invalid social reference');return s;};
export function createSocialPublishingGraphQL({service}:{service:SocialPublishingService}){
  const typeDefs=/* GraphQL */`
    type SocialCloudPayload { schemaVersion:Int! dataJson:String! }
    input SocialDraftVariantInput { platform:String! connectionId:ID! caption:String title:String description:String hashtags:[String!] mediaRefs:[ID!] }
    input SocialDraftInput { projectId:ID sourceArtifactRefs:[ID!] variants:[SocialDraftVariantInput!]! disclosureFlags:[String!] }
    extend type Query { socialCloud:SocialCloudPayload! }
    extend type Mutation { createSocialDraft(input:SocialDraftInput!):SocialCloudPayload! beginSocialConnection(platforms:[String!]):SocialCloudPayload! syncSocialConnections:SocialCloudPayload! }
  `;
  const snapshot=(tenantId:string)=>{const providerConfigured=service.providerNames().length>0,connections=service.listConnections(tenantId),plans=service.listDrafts(tenantId),jobs=service.listJobs(tenantId),connectionTruth=socialConnectionTruthSnapshot({providerConfigured,connections,analyticsVerified:false});return{
    supportedPlatforms:[...SOCIAL_PLATFORMS],providerConfigured,providers:service.providerNames(),connectionTruth,
    conversationCards:projectSocialConversation({plans,jobs,connectionTruth}),
    connections:connections.map(c=>({id:c.id,projectId:c.projectId,provider:c.provider,platform:c.platform,safeMetadata:c.safeMetadata,capabilities:c.capabilities,state:c.state,connectedAt:c.connectedAt,refreshedAt:c.refreshedAt})),
    drafts:plans.map(p=>({id:p.id,projectId:p.projectId,sourceArtifactRefs:p.sourceArtifactRefs,variants:p.variants.map(v=>({platform:v.platform,connectionId:v.connectionId,caption:v.caption,title:v.title,hashtags:v.hashtags,mediaRefs:v.mediaRefs})),schedule:p.schedule,disclosureFlags:p.disclosureFlags,createdAt:p.createdAt})),
    jobs:jobs.map(j=>({id:j.id,planId:j.planId,state:j.state,createdAt:j.createdAt,updatedAt:j.updatedAt,results:j.results.map(r=>({platform:r.platform,connectionId:r.connectionId,state:r.state,publishedAt:r.publishedAt,errorCode:r.errorCode,warningCodes:r.warningCodes}))})),
  };};
  return{typeDefs,resolvers:{Query:{socialCloud:(_:unknown,__:unknown,ctx:Context)=>payload(snapshot(user(ctx)))},Mutation:{createSocialDraft:(_:unknown,{input}:{input:any},ctx:Context)=>{const tenantId=user(ctx);limit(`social-draft:${tenantId}`,60,3600000);const variants=(Array.isArray(input.variants)?input.variants:[]).slice(0,12).map((v:any):SocialPostVariant=>{const platform=String(v.platform||'').toUpperCase();if(!PLATFORM_SET.has(platform))throw new Error('Unsupported social platform');return{platform:platform as SocialPlatform,connectionId:safeRef(v.connectionId),caption:cleanText(v.caption,5000)||undefined,title:cleanText(v.title,300)||undefined,description:cleanText(v.description,2000)||undefined,hashtags:Array.isArray(v.hashtags)?v.hashtags.map((h:any)=>cleanText(h,100)).filter(Boolean).slice(0,30):[],mediaRefs:Array.isArray(v.mediaRefs)?v.mediaRefs.map(safeRef).slice(0,20):[]};});const plan:SocialPostPlan={id:`splan-${randomUUID()}`,tenantId,projectId:input.projectId?safeRef(input.projectId):undefined,sourceArtifactRefs:Array.isArray(input.sourceArtifactRefs)?input.sourceArtifactRefs.map(safeRef).slice(0,50):[],variants,schedule:{mode:'DRAFT'},disclosureFlags:Array.isArray(input.disclosureFlags)?input.disclosureFlags.map((v:any)=>cleanText(v,100)).filter(Boolean).slice(0,20):[],createdAt:new Date().toISOString()};service.createDraft(plan);return payload(snapshot(tenantId));},beginSocialConnection:async(_:unknown,{platforms}:{platforms?:string[]},ctx:Context)=>{const tenantId=user(ctx);limit(`social-connect:${tenantId}`,12,3600000);if(!service.providerNames().includes('upload-post'))throw new Error('Social connection provider is not configured.');const requested=(platforms||[]).map(v=>String(v).toUpperCase()).filter(v=>PLATFORM_SET.has(v)).slice(0,12) as SocialPlatform[];const app=new URL(process.env.PUBLIC_APP_URL||'https://starlidigital.ro');if(process.env.NODE_ENV==='production'&&app.protocol!=='https:')throw new Error('Social connection callback requires HTTPS.');const returnUrl=new URL('/app/social?connect_status=success',app.origin).toString();const flow=await service.createConnectionFlow(tenantId,'upload-post',{platforms:requested,returnUrl});return payload({flow:{provider:flow.provider,launchUrl:flow.launchUrl,expiresAt:flow.expiresAt},cloud:snapshot(tenantId)});},syncSocialConnections:async(_:unknown,__:unknown,ctx:Context)=>{const tenantId=user(ctx);limit(`social-sync:${tenantId}`,30,3600000);if(!service.providerNames().includes('upload-post'))throw new Error('Social connection provider is not configured.');await service.syncConnections(tenantId,'upload-post');return payload(snapshot(tenantId));}}}};
}
