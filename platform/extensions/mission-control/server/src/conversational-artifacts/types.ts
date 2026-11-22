import type {ArtifactKind,ArtifactStatus} from '../creative-projects/types.js';

export type ConversationalReceiptStatus='SUCCESS'|'FAILED'|'BLOCKED';
export type ArtifactActivityKind='CREATED'|'UPDATED'|'VERSION_CHANGED'|'OTHER';
export type PreviewEvidence={state:'AVAILABLE';url:string;source:string}|{state:'UNAVAILABLE';reason:string};
export type ArtifactDependencyContext={dependsOnArtifactIds:string[];dependentArtifactIds:string[];workPackageBlockCodes:string[]};
export type ConversationalArtifactCard={
 id:string;projectId:string;name:string;kind:ArtifactKind;artifactStatus:ArtifactStatus;
 latestVersion:number|null;activity:ArtifactActivityKind;updatedAt:string;
 preview:PreviewEvidence;dependencyContext:ArtifactDependencyContext;
 openWork:{label:'Open Work';href:string};
};
export type ConversationalReceiptCard={
 id:string;artifactId:string;projectId:string;orchestrationPlanId:string;workPackageId:string;
 status:ConversationalReceiptStatus;kind:'AGENCY_EXECUTION'|'PLANNING_RESULT';summary:string;
 occurredAt:string;evidenceReference:{kind:string;id:string}|null;
 openWork:{label:'Open Work';href:string};
};
export type ConversationalArtifactBundle={artifact:ConversationalArtifactCard;receipts:ConversationalReceiptCard[]};
