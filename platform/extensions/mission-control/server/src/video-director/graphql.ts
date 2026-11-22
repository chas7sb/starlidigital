import type {Context} from '../security.js';
import {limit,requireUser} from '../security.js';
import type {VideoDirectorService} from './service.js';
import type {VideoBriefInput,VideoPlatformTarget} from './types.js';

const TARGETS=new Set<VideoPlatformTarget>(['TIKTOK','INSTAGRAM_REELS','YOUTUBE_SHORTS','SOCIAL_FEED','YOUTUBE','WEB','PRESENTATION']);
const actor=(context:Context)=>{const user=requireUser(context);return{id:String(user.id),role:String(user.role||'CUSTOMER')};};
const targetList=(value:unknown)=>Array.isArray(value)?[...new Set(value.map(String).filter(v=>TARGETS.has(v as VideoPlatformTarget)))].slice(0,7) as VideoPlatformTarget[]:[];
const idList=(value:unknown)=>Array.isArray(value)?value.map(String).filter(v=>/^[A-Za-z0-9_-]{1,160}$/.test(v)).slice(0,20):[];
const text=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';

export function createVideoDirectorGraphQL({service}:{service:VideoDirectorService}){
  const typeDefs=/* GraphQL */`
    type VideoDirectorPayload { schemaVersion: Int! dataJson: String! }
    input VideoDirectorBriefInput {
      title:String! objective:String! audience:String product:String cta:String
      platformTargets:[String!] durationTarget:Float tone:String style:String language:String
      brandProfileId:ID sourceArtifactIds:[ID!] assetIds:[ID!] complianceConstraints:[String!]
      voiceover:Boolean musicAssetId:ID
    }
    extend type Query {
      videoDirectorPlans: VideoDirectorPayload!
      videoDirectorRuns: VideoDirectorPayload!
      videoDirectorPlan(id:ID!): VideoDirectorPayload!
      videoDirectorRun(id:ID!): VideoDirectorPayload!
    }
    extend type Mutation {
      createVideoDirectorPlan(input:VideoDirectorBriefInput!): VideoDirectorPayload!
      prepareVideoDirectorRun(planId:ID!): VideoDirectorPayload!
      generateVideoDirectorPreviews(runId:ID!, timestamp:Float): VideoDirectorPayload!
    }
  `;
  const brief=(input:any):VideoBriefInput=>({
    title:text(input.title,160),objective:text(input.objective,2000),audience:text(input.audience,500)||undefined,product:text(input.product,500)||undefined,cta:text(input.cta,160)||undefined,
    platformTargets:targetList(input.platformTargets),durationTarget:typeof input.durationTarget==='number'?input.durationTarget:undefined,tone:text(input.tone,120)||undefined,style:text(input.style,160)||undefined,language:text(input.language,16)||undefined,
    brandProfileId:input.brandProfileId?String(input.brandProfileId):undefined,sourceArtifactIds:idList(input.sourceArtifactIds),assetIds:idList(input.assetIds),complianceConstraints:Array.isArray(input.complianceConstraints)?input.complianceConstraints.map((v:any)=>text(v,300)).filter(Boolean).slice(0,20):[],voiceover:input.voiceover!==false,musicAssetId:input.musicAssetId?String(input.musicAssetId):undefined,
  });
  const payload=(data:unknown)=>({schemaVersion:1,dataJson:JSON.stringify(data)});
  return{typeDefs,resolvers:{
    Query:{
      videoDirectorPlans:(_:unknown,__:unknown,context:Context)=>payload(service.listPlans(actor(context))),
      videoDirectorRuns:(_:unknown,__:unknown,context:Context)=>payload(service.listRuns(actor(context)).map(run=>({id:run.id,planId:run.planId,status:run.status,projects:run.projects,createdAt:run.createdAt,updatedAt:run.updatedAt}))),
      videoDirectorPlan:(_:unknown,{id}:{id:string},context:Context)=>{const plan=service.getPlan(actor(context),String(id));if(!plan)throw new Error('Video Director plan not found.');return payload(plan);},
      videoDirectorRun:(_:unknown,{id}:{id:string},context:Context)=>{const run=service.getRun(actor(context),String(id));if(!run)throw new Error('Video Director run not found.');return payload(run);},
    },
    Mutation:{
      createVideoDirectorPlan:(_:unknown,{input}:{input:any},context:Context)=>{const a=actor(context);limit(`video-director-plan:${a.id}`,30,3600000);return payload(service.createPlan(a,brief(input)));},
      prepareVideoDirectorRun:async(_:unknown,{planId}:{planId:string},context:Context)=>{const a=actor(context);limit(`video-director-prepare:${a.id}`,12,3600000);const plan=service.getPlan(a,String(planId));if(!plan)throw new Error('Video Director plan not found.');return payload(await service.prepareRun(a,plan));},
      generateVideoDirectorPreviews:async(_:unknown,{runId,timestamp}:{runId:string;timestamp?:number},context:Context)=>{const a=actor(context);limit(`video-director-preview:${a.id}`,20,3600000);return payload(await service.generatePreviews(a,String(runId),typeof timestamp==='number'?timestamp:.5));},
    }
  }};
}
