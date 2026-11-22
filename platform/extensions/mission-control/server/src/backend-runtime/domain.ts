export const BACKEND_RUNTIME_STATES=['DRAFT','VALIDATED','BUILDING','STAGED','READY','DEPLOYING','LIVE','FAILED','BLOCKED','NEEDS_REVIEW','ROLLED_BACK'] as const;
export type BackendRuntimeState=typeof BACKEND_RUNTIME_STATES[number];
export type BackendRuntimeEnvironment='STAGING'|'PRODUCTION';
export type MigrationRisk='SAFE_ADDITIVE'|'REVIEW_REQUIRED'|'BLOCKED';
export type ResourcePolicy={cpuMillisPerSecond:number;memoryMb:number;ephemeralDiskMb:number;requestTimeoutMs:number;maxConcurrentRequests:number;networkPolicy:'DENY'|'HTTPS_EXTERNAL'};
export type RuntimeSecretReference={name:string;reference:string};
export type RuntimeDatabaseBinding={databaseBindingId:string;tenantId:string;projectId:string;engine:'POSTGRESQL';reference:string;environment:BackendRuntimeEnvironment;access:'READ_WRITE';};
export type RuntimeSpecification={tenantId:string;projectId:string;serviceId:string;releaseId:string;environment:BackendRuntimeEnvironment;serviceName:string;port:number;resourcePolicy:ResourcePolicy;healthPath:'/health';readinessPath:'/readiness';secrets:RuntimeSecretReference[];databaseBinding:RuntimeDatabaseBinding|null;};
export type ReleaseFileManifest={path:string;sha256:string;bytes:number};
export type BackendReleaseManifest={releaseId:string;tenantId:string;projectId:string;versionId:string;sourceHash:string;templateVersion:string;files:ReleaseFileManifest[];createdAt:string};
export type MigrationApproval={migrationPlanId:string|null;risk:MigrationRisk;approved:boolean;approvedBy?:string;approvedAt?:string};
export type DeploymentReceipt={deploymentId:string;tenantId:string;projectId:string;serviceId:string;releaseId:string;environment:BackendRuntimeEnvironment;migrationRisk:MigrationRisk;requestKey:string;state:BackendRuntimeState;runtimeRef:string|null;endpointRef:string|null;healthStatus:'UNKNOWN'|'HEALTHY'|'UNHEALTHY';readinessStatus:'UNKNOWN'|'READY'|'NOT_READY';message:string|null;createdAt:string;updatedAt:string};
export type RuntimeLogEntry={timestamp:string;level:'debug'|'info'|'warn'|'error';event:string;message?:string;};
export type RuntimeStatus={state:BackendRuntimeState;runtimeRef:string|null;endpointRef:string|null;healthStatus:DeploymentReceipt['healthStatus'];readinessStatus:DeploymentReceipt['readinessStatus'];updatedAt:string};
export type RuntimeProbeResult={healthy:boolean;ready:boolean;statusCode?:number;detail?:string};
export type RuntimeDeployRequest={manifest:BackendReleaseManifest;runtime:RuntimeSpecification;deploymentId:string;requestKey:string;};
export type RuntimeDeployResult={runtimeRef:string;endpointRef:string;};
export interface BackendSummary {backendProjectId:string;serviceId:string;name:string;stack:'NODE_EXPRESS_PRISMA';environment:BackendRuntimeEnvironment|null;lifecycle:'DRAFT'|'GENERATING'|'VALIDATING'|'BUILDING'|'READY'|'DEPLOYING'|'LIVE'|'BLOCKED'|'NEEDS_REVIEW'|'FAILED'|'ROLLED_BACK';versionId:string|null;endpoint:string|null;health:'UNKNOWN'|'HEALTHY'|'UNHEALTHY';readiness:'UNKNOWN'|'READY'|'NOT_READY';database:{engine:'POSTGRESQL';status:'PLANNED'|'BOUND'|'DISABLED'}|null;migrationRisk:MigrationRisk|null;updatedAt:string;}
export type BackendRuntimeHandoff={tenantId:string;backendProjectId:string;serviceId:string;versionId:string;releaseId:string;sourceHash:string;templateVersion:string;files:ReleaseFileManifest[];createdAt:string;environment:BackendRuntimeEnvironment;requestKey:string;resourcePolicy?:Partial<ResourcePolicy>;databaseBinding?:RuntimeDatabaseBinding|null;migration?:{migrationPlanId:string|null;risk:MigrationRisk};secrets?:RuntimeSecretReference[];};
export type RuntimeSecurityContext={ownerId?:string;userId?:string;tenantId?:string;role?:string};
export interface BackendRuntimeAdapter{
 stage(request:RuntimeDeployRequest):Promise<{runtimeRef:string}>;
 deploy(request:RuntimeDeployRequest):Promise<RuntimeDeployResult>;
 probe(runtimeRef:string,healthPath:string,readinessPath:string):Promise<RuntimeProbeResult>;
 logs(runtimeRef:string,input:{after?:string;limit:number}):Promise<RuntimeLogEntry[]>;
 stop(runtimeRef:string):Promise<void>;
 rollback(input:{tenantId:string;projectId:string;fromRuntimeRef:string;targetRuntimeRef:string;requestKey:string}):Promise<RuntimeDeployResult>;
}
export interface PortAllocator{allocate(identity:{tenantId:string;projectId:string;serviceId:string}):number;release(port:number,identity:{tenantId:string;projectId:string;serviceId:string}):void;}
export interface MigrationApprovalHook{check(input:{tenantId:string;projectId:string;migrationPlanId:string|null;risk:MigrationRisk}):MigrationApproval;}
export interface BackendRuntimeEventSink{emit(event:{type:string;source:'backend-runtime';occurredAt:string;entities:Array<{kind:string;id:string}>;payload:Record<string,string|number|boolean|null>}):void;}
