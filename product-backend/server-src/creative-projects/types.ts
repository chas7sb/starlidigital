export const ARTIFACT_KINDS = ['WEBSITE','WEB_APP','MOBILE_APP','BACKEND','IMAGE','VIDEO','COPY','CAMPAIGN','AGENT','AUTOMATION','INTEGRATION','FILE','REPORT','CUSTOM'] as const;
export type ArtifactKind = typeof ARTIFACT_KINDS[number];
export const PROJECT_STATUSES = ['DRAFT','ACTIVE','PAUSED','COMPLETED','ARCHIVED'] as const;
export type CreativeProjectStatus = typeof PROJECT_STATUSES[number];
export const ARTIFACT_STATUSES = ['PLANNED','DRAFT','GENERATING','READY','BLOCKED','FAILED','ARCHIVED'] as const;
export type ArtifactStatus = typeof ARTIFACT_STATUSES[number];

export type TenantContext = { tenantId:string; ownerId:string };
export type ProjectGoal = { summary:string; updatedAt:string };
export type CreativeProject = { id:string; tenantId:string; ownerId:string; title:string; goal:ProjectGoal; status:CreativeProjectStatus; createdAt:string; updatedAt:string };
export type ExternalDomainReference = { id:string; artifactId:string; domain:string; entityId:string; serviceId:string|null; versionId:string|null; metadata:Record<string,unknown>; createdAt:string };
export type BackendReference = { backendProjectId:string; serviceId:string; versionId:string|null };
export type Artifact = { id:string; projectId:string; tenantId:string; ownerId:string; kind:ArtifactKind; name:string; status:ArtifactStatus; metadata:Record<string,unknown>; provenance:Record<string,unknown>; createdAt:string; updatedAt:string; externalReferences:ExternalDomainReference[]; backend:BackendReference|null };
export type ArtifactVersion = { id:string; artifactId:string; projectId:string; tenantId:string; version:number; status:ArtifactStatus; label:string|null; metadata:Record<string,unknown>; provenance:Record<string,unknown>; externalVersionId:string|null; createdAt:string };
export type ArtifactDependency = { id:string; projectId:string; tenantId:string; artifactId:string; dependsOnArtifactId:string; createdAt:string };
export type ProjectTaskReference = { id:string; projectId:string; tenantId:string; taskId:string; source:string; createdAt:string };
export type ApprovalReference = { id:string; projectId:string; artifactId:string|null; tenantId:string; approvalId:string; source:string; status:string|null; createdAt:string };
export type PublishTargetReference = { id:string; projectId:string; artifactId:string|null; tenantId:string; targetId:string; source:string; environment:string|null; createdAt:string };
export type CreativeActivity = { sequence:number; id:string; tenantId:string; projectId:string; type:string; artifactId:string|null; createdAt:string; metadata:Record<string,unknown> };
export type Page<T> = { items:T[]; nextCursor:number|null };
export type BackendArtifactProjection = { artifactId:string; backendProjectId:string; serviceId:string; versionId:string|null; status:ArtifactStatus };
export type StudioProjectSummary = { project:CreativeProject; artifactCounts:Partial<Record<ArtifactKind,number>>; totalArtifacts:number; recentArtifacts:Artifact[]; backends:BackendArtifactProjection[]; approvalCount:number; publishTargetCount:number; taskReferenceCount:number; dependencyCount:number; updatedAt:string };

export type ExternalReferenceInput = { domain:string; entityId:string; serviceId?:string|null; versionId?:string|null; metadata?:Record<string,unknown> };
export type ExternalReferenceResolution = { exists:boolean; tenantId?:string; ownerId?:string; canonical?:{ entityId?:string; serviceId?:string|null; versionId?:string|null } };
export interface ExternalReferenceResolver { resolve(context:TenantContext, reference:ExternalReferenceInput): ExternalReferenceResolution | Promise<ExternalReferenceResolution>; }

export type OrchestrationArtifactLink = { id:string; tenantId:string; ownerId:string; projectId:string; orchestrationPlanId:string; workPackageId:string; artifactId:string; createdAt:string };
