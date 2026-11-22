export const BACKEND_TEMPLATE_VERSION='starli-express-prisma-v1' as const;
export const BACKEND_NODE_VERSION='24' as const;
export const BACKEND_BUILD_STATES=['DRAFT','VALIDATED','BUILDING','SUCCEEDED','FAILED','BLOCKED','NEEDS_REVIEW'] as const;
export type BackendBuildState=typeof BACKEND_BUILD_STATES[number];
export type BackendFieldType='string'|'int'|'float'|'boolean'|'dateTime'|'json'|'uuid';
export type BackendField={name:string;type:BackendFieldType;required:boolean;unique?:boolean};
export type BackendModel={name:string;fields:BackendField[]};
export type BackendSpecification={
  templateVersion:typeof BACKEND_TEMPLATE_VERSION;
  displayName:string;
  description?:string;
  models:BackendModel[];
  features?:{cors?:boolean;requestLogging?:boolean};
};
export type RuntimePolicy={
  nodeVersion:typeof BACKEND_NODE_VERSION;
  maxMemoryMb:number;
  maxCpuMillisPerSecond:number;
  requestTimeoutMs:number;
  outboundNetwork:'DENY_BY_DEFAULT';
  filesystem:'APP_READONLY_WITH_TMP';
};
export type EnvironmentRequirement={name:'DATABASE_URL'|'PORT'|'NODE_ENV';kind:'SECRET_REFERENCE'|'PLATFORM_VALUE';required:boolean;description:string};
export type DatabaseBinding={id:string;tenantId:string;ownerId:string;backendProjectId:string;engine:'POSTGRESQL';bindingRef:string;status:'PLANNED'|'BOUND'|'DISABLED';createdAt:string;updatedAt:string};
export type MigrationRisk='SAFE_ADDITIVE'|'REVIEW_REQUIRED'|'BLOCKED';
export type MigrationPlan={id:string;tenantId:string;ownerId:string;backendProjectId:string;fromVersionId:string|null;toVersionId:string;toSpecificationHash:string;risk:MigrationRisk;operations:string[];requiresApproval:boolean;createdAt:string};
export type GeneratedBackendFile={path:string;content:string};
export type StaticValidationReport={valid:boolean;errors:string[];warnings:string[];fileCount:number;totalBytes:number};
export type BackendVersion={id:string;tenantId:string;ownerId:string;backendProjectId:string;ordinal:number;specificationHash:string;sourceHash:string;templateVersion:typeof BACKEND_TEMPLATE_VERSION;specification:BackendSpecification;files:GeneratedBackendFile[];createdAt:string};
export type BackendBuild={id:string;tenantId:string;ownerId:string;backendProjectId:string;versionId:string;status:BackendBuildState;validation?:StaticValidationReport;createdAt:string;updatedAt:string};
export type BackendService={id:string;tenantId:string;ownerId:string;backendProjectId:string;runtimePolicy:RuntimePolicy;databaseBindingId:string|null;currentVersionId:string|null;createdAt:string;updatedAt:string};
export type BackendProject={id:string;tenantId:string;ownerId:string;name:string;status:'DRAFT'|'SPECIFIED'|'VERSIONED'|'ARCHIVED';specification:BackendSpecification|null;specificationHash:string|null;serviceId:string;createdAt:string;updatedAt:string};
export type BackendActor={userId:string;role?:string;workspaceTenantId?:string};
export type BackendFactoryEvent={type:string;source:'backend-factory';occurredAt:string;entities:Array<{kind:string;id:string}>;payload:Record<string,string|number|boolean|null>};
export interface BackendFactoryEventSink{emit(event:BackendFactoryEvent):void;}

/** Immutable, content-free release file metadata passed toward Backend Runtime. */
export type BackendReleaseFileManifest={path:string;sha256:string;bytes:number};
export type BackendRuntimeHandoff={
  tenantId:string;
  backendProjectId:string;
  serviceId:string;
  versionId:string;
  buildId:string;
  sourceHash:string;
  templateVersion:typeof BACKEND_TEMPLATE_VERSION;
  files:BackendReleaseFileManifest[];
  runtimePolicyRequest:{nodeVersion:typeof BACKEND_NODE_VERSION;memoryMb:number;cpuMillisPerSecond:number;requestTimeoutMs:number;networkPolicy:'DENY'};
  databaseBinding:{databaseBindingId:string;engine:'POSTGRESQL';status:DatabaseBinding['status'];reference:string};
  migration:{migrationPlanId:string;risk:MigrationRisk;requiresApproval:boolean};
  secretRequirements:Array<{name:'DATABASE_URL';reference:string}>;
  platformEnvironment:Array<'PORT'|'NODE_ENV'>;
};

/** Customer-facing normalized projection composed later with Runtime state. */
export interface BackendSummary{
  backendProjectId:string;
  serviceId:string;
  name:string;
  stack:'NODE_EXPRESS_PRISMA';
  environment:'STAGING'|'PRODUCTION'|null;
  lifecycle:'DRAFT'|'GENERATING'|'VALIDATING'|'BUILDING'|'READY'|'DEPLOYING'|'LIVE'|'BLOCKED'|'NEEDS_REVIEW'|'FAILED'|'ROLLED_BACK';
  versionId:string|null;
  endpoint:string|null;
  health:'UNKNOWN'|'HEALTHY'|'UNHEALTHY';
  readiness:'UNKNOWN'|'READY'|'NOT_READY';
  database:{engine:'POSTGRESQL';status:'PLANNED'|'BOUND'|'DISABLED'}|null;
  migrationRisk:MigrationRisk|null;
  updatedAt:string;
}
