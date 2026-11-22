import {createClient} from 'graphql-ws';
import {resolvePublicEndpoints} from './transport';
const endpoints=resolvePublicEndpoints(import.meta.env.VITE_API_URL,import.meta.env.VITE_WS_URL,location.origin);
export type User={id:string;username:string;email:string;recoveryEmail:string;role:string;createdAt:string};
export type AgentActionMode='AUTO'|'CHAT'|'PLAN'|'BUILD';
export type StructuredPlan={name:string;brief:string;objective:string;direction:string;pages:string[];steps:{title:string;description:string}[]};
export type InteractiveQuestionOption={label:string;value?:string;recommended?:boolean};
export type InteractiveQuestion={kind?:string;question:string;options:InteractiveQuestionOption[];allowCustom?:boolean;customPlaceholder?:string;moreIdeasLabel?:string;moreIdeasPrompt?:string};
export type ChatAttachment={name:string;mimeType:string;dataUrl?:string;textExcerpt?:string};
export type Message={id:string;role:string;content:string;createdAt:string;authorName?:string;planJson?:string;questionJson?:string;suggestedFollowUp?:string;attachments?:ChatAttachment[];stepsCount?:number;durationMs?:number;agentRunId?:string;selectedElement?:string};
export type Conversation={id:string;projectId?:string;title:string;mode:string;status:string;agentStatus?:string;agentStartedAt?:string;createdAt:string;updatedAt:string;messages:Message[]};
export type SourceFile={path:string;content:string;encoding?:string};
export type ProjectKnowledge={businessSummary:string;audience:string;goals:string;brandDirection:string;language:string;technicalRules:string;customInstructions:string;updatedAt:string};
export type AgentStep={id:string;category:string;title:string;detail?:string;status:string;createdAt:string;completedAt?:string};
export type AgentRun={id:string;projectId:string;conversationId?:string;mode:string;status:string;summary?:string;errorSummary?:string;versionId?:string;steps:AgentStep[];createdAt:string;updatedAt:string;completedAt?:string};
export type ProjectVersion={id:string;projectId:string;source:string;summary:string;createdBy:string;agentRunId?:string;bookmarked:boolean;sourceHash:string;previewHtml?:string;files:SourceFile[];createdAt:string};
export type ProjectNotification={id:string;projectId:string;kind:string;title:string;detail?:string;read:boolean;createdAt:string};
export type Project={
  id:string;name:string;brief:string;status:string;
  lifecycle:string;buildState:string;publishState:string;previewState:string;
  buildStep?:string;previewUrl?:string;deploymentUrl?:string;deploymentId?:string;deploymentStatus?:string;
  paid:boolean;files:SourceFile[];previewHtml?:string;validationStatus:string;validationProvider?:string;
  research?:string;sources:{title:string;url:string}[];buildLog?:string;buildError?:string;
  knowledge:ProjectKnowledge;versions:ProjectVersion[];agentRuns:AgentRun[];notifications:ProjectNotification[];
  createdAt:string;updatedAt:string;
};
export type Post={id:string;title:string;slug:string;excerpt:string;content:string;status:string;coverImage?:string;createdAt:string;publishedAt?:string;author:string};
export type Integration={id:string;name:string;status:string;detail:string};
export type Memory={id:string;title:string;content:string;projectId?:string;publicApproved:boolean;createdAt:string};
export const CONVERSATION_FIELDS='id projectId title mode status agentStatus agentStartedAt createdAt updatedAt messages{id role content createdAt authorName planJson questionJson suggestedFollowUp attachments{name mimeType dataUrl textExcerpt} stepsCount durationMs agentRunId selectedElement}';
export const POST_FIELDS='id title slug excerpt content status coverImage createdAt publishedAt author';
export const PROJECT_FIELDS='id name brief status lifecycle buildState publishState previewState buildStep previewUrl deploymentUrl deploymentId deploymentStatus paid files{path content encoding} previewHtml validationStatus validationProvider research sources{title url} buildLog buildError knowledge{businessSummary audience goals brandDirection language technicalRules customInstructions updatedAt} versions{id projectId source summary createdBy agentRunId bookmarked sourceHash createdAt} agentRuns{id projectId conversationId mode status summary errorSummary versionId createdAt updatedAt completedAt steps{id category title detail status createdAt completedAt}} notifications{id projectId kind title detail read createdAt} createdAt updatedAt';
export const PROJECT_SUMMARY_FIELDS='id name brief status lifecycle buildState publishState previewState deploymentUrl files{path encoding} notifications{id read} updatedAt createdAt';
export async function gql<T=Record<string,unknown>>(query:string,variables:Record<string,unknown>={}):Promise<T>{
 const response=await fetch(endpoints.api,{method:'POST',credentials:'include',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables})});
 const result=await response.json();if(result.errors?.length)throw new Error(result.errors[0].message);if(!response.ok)throw new Error('Could not connect to the platform.');return result.data as T;
}
export function subscribe<T>(query:string,variables:Record<string,unknown>,next:(value:T)=>void){
 const client=createClient({url:endpoints.ws,retryAttempts:3});
 const dispose=client.subscribe({query,variables},{next:value=>{if(value.data)next(value.data as T);},error:()=>{},complete:()=>{}});
 return()=>{dispose();void client.dispose();};
}
