import type {SocialPlatform,SocialPublishState} from '../social-publishing/types.js';
import type {VideoFormat} from '../video/types.js';
export type MediaSectionAvailability='AVAILABLE'|'EMPTY'|'UNAVAILABLE';
export interface MediaAvailability { storyboard:MediaSectionAvailability; variants:MediaSectionAvailability; render:MediaSectionAvailability; socialDrafts:MediaSectionAvailability; schedule:MediaSectionAvailability; approval:MediaSectionAvailability; analytics:MediaSectionAvailability; }
export interface WorkspaceStoryboardScene { id:string; template:string; duration:number; headline:string; hasNarration:boolean; assetCount:number; }
export interface WorkspaceVideoVariant { id:string; format:Exclude<VideoFormat,'CUSTOM'>; platforms:string[]; width:number; height:number; }
export interface WorkspaceVideoRender { runId:string; planId:string; status:string; readiness:'READY'|'RENDERING'|'COMPLETE'|'FAILED'|'UNKNOWN'; variants:Array<{variantId:string;videoProjectId:string;renderId?:string;previewUrl?:string}>; updatedAt:string; }
export interface WorkspaceSocialDraft { id:string; platforms:SocialPlatform[]; sourceArtifactRefs:string[]; mode:string; publishAt?:string; timezone?:string; approval:'NOT_REQUIRED'|'AWAITING_APPROVAL'|'APPROVED'; createdAt:string; }
export interface WorkspacePublishResult { jobId:string; planId:string; state:SocialPublishState; platforms:Array<{platform:SocialPlatform;state:SocialPublishState;publishedAt?:string;warningCodes?:string[];errorCode?:string}>; updatedAt:string; }
export interface WorkspaceAnalyticsResult { status:'AVAILABLE'|'NOT_AVAILABLE'; capturedAt?:string; metrics?:Record<string,number>; platform?:SocialPlatform; }
export interface WorkspaceSocialConnectionSummary { id:string; platform:SocialPlatform; label:string; state:'CONNECTED'|'REAUTH_REQUIRED'|'DEGRADED'|'UNAVAILABLE'; }
export interface WorkspaceMediaContext { schemaVersion:2; projectId:string; availability:MediaAvailability; video:{planId?:string;storyboard?:{id:string;hook:string;totalDuration:number;scenes:WorkspaceStoryboardScene[]};variants:WorkspaceVideoVariant[];render?:WorkspaceVideoRender};social:{connections:WorkspaceSocialConnectionSummary[];drafts:WorkspaceSocialDraft[];publishResults:WorkspacePublishResult[];analytics:WorkspaceAnalyticsResult};updatedAt:string; }
export interface HomeMediaSummary { status:'ACTIVE'|'READY'|'ATTENTION'|'EMPTY'; projectId:string; headline:string; detail:string; artifactCount:number; pendingApprovalCount:number; scheduledCount:number; latestAt:string; }
