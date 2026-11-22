export const ORCHESTRATION_SCHEMA_VERSION=1 as const;

export type StarliIntentKind='BUILD'|'OPERATE'|'GROW'|'FIX'|'CREATE_MEDIA'|'CONNECT'|'ANALYZE'|'MIXED';
export type OutcomeClassification={primary:StarliIntentKind;signals:StarliIntentKind[]};
export type UserGoal={id:string;tenantId:string;ownerId:string;text:string;projectId:string|null;businessEngineId:string|null;createdAt:string};
export type BusinessEngineDecision={mode:'NONE'|'REFERENCE_EXISTING'|'CREATE_OR_UPDATE';businessEngineId:string|null;engineVersionId:string|null};
export type ProjectDecision={mode:'NONE'|'REFERENCE_EXISTING'|'CREATE_OR_UPDATE';projectId:string|null};

export type CapabilityAvailability='AVAILABLE'|'MISSING'|'UNKNOWN';
export type CapabilityConnection='CONNECTED'|'MISSING'|'UNKNOWN'|'NOT_REQUIRED';
export type RequiredCapability={capabilityId:string;projectScoped:boolean;availability:CapabilityAvailability;connection:CapabilityConnection};
export type RequiredArtifact={kind:string;artifactId:string|null;projectId:string|null};
export type ApprovalRequirementKind='NONE'|'REVIEW'|'EXPLICIT_APPROVAL';
export type RequiredApproval={kind:ApprovalRequirementKind;approvalId:string|null};
export type RequiredInput={id:string;question:string};

export type OrchestrationWorkTarget=
 |'CREATIVE_PROJECT'|'BACKEND_FACTORY'|'HOSTED_AGENT'|'VIDEO_DIRECTOR'|'SOCIAL_CAMPAIGN'
 |'CAPABILITY_REQUIREMENT'|'AGENCY_WORKFLOW'|'KPI_MEASUREMENT'|'AGENCY_ACTION'|'CUSTOM';
export type OrchestrationExecutionMode='PLANNING_ONLY'|'EXECUTABLE';
export const ORCHESTRATION_WORK_STATUSES=['WAITING_INPUT','WAITING_APPROVAL','BLOCKED','READY','RUNNING','SUCCEEDED','FAILED','STOPPED'] as const;
export type OrchestrationWorkStatus=typeof ORCHESTRATION_WORK_STATUSES[number];
export type OrchestrationRetryClass='NOT_RETRYABLE'|'SAFE_IDEMPOTENT_RETRY';
export type OrchestrationBlockCode='DEPENDENCY_PENDING'|'DEPENDENCY_FAILED'|'CAPABILITY_MISSING'|'CONNECTION_MISSING'|'INPUT_REQUIRED'|'APPROVAL_REQUIRED'|'APPROVAL_INVALID'|'ACTION_PLAN_UNAVAILABLE'|'ACTION_PLAN_CHANGED'|'STOPPED'|'EXECUTION_FAILED';

export type OrchestrationWorkPackageSpec={
 id:string;
 target:OrchestrationWorkTarget;
 title:string;
 executionMode:OrchestrationExecutionMode;
 dependencyPackageIds:string[];
 requiredCapabilities:RequiredCapability[];
 requiredArtifacts:RequiredArtifact[];
 requiredInputs:RequiredInput[];
 requiredApproval:RequiredApproval;
 agencyActionPlanId:string|null;
 /** Canonical immutable AgencyActionPlan hash captured when executable work is bound. */
 agencyActionPlanHash?:string|null;
 projectId:string|null;
 sourceRef:{kind:string;id:string}|null;
};

export type OrchestrationWorkPackage=OrchestrationWorkPackageSpec&{
 specHash:string;
 status:OrchestrationWorkStatus;
 blockCodes:OrchestrationBlockCode[];
 satisfiedInputIds:string[];
 receiptIds:string[];
 lastExecutionReceiptId:string|null;
 /** Durable binding to the existing Agency Execution request, never a second executor. */
 executionRequestId?:string|null;
 executionAttempt?:number;
 retryClass:OrchestrationRetryClass;
 updatedAt:string;
};

export type OrchestrationPlanStatus='WAITING_INPUT'|'WAITING_APPROVAL'|'BLOCKED'|'READY'|'RUNNING'|'SUCCEEDED'|'FAILED'|'STOPPED';
export type OrchestrationPlan={
 id:string;
 schemaVersion:typeof ORCHESTRATION_SCHEMA_VERSION;
 tenantId:string;
 ownerId:string;
 goal:UserGoal;
 classification:OutcomeClassification;
 businessEngineDecision:BusinessEngineDecision;
 projectDecision:ProjectDecision;
 businessMaterializationRef:{businessEngineId:string;engineVersionId:string;materializationId:string}|null;
 workPackages:OrchestrationWorkPackage[];
 status:OrchestrationPlanStatus;
 planHash:string;
 /** Tamper-evident hash of mutable lifecycle state; optional for legacy persisted plans. */
 stateHash?:string;
 revision:number;
 createdAt:string;
 updatedAt:string;
 stoppedAt:string|null;
 stopReason:string|null;
};

export type OrchestrationReceiptKind='STATE_TRANSITION'|'PLANNING_RESULT'|'AGENCY_EXECUTION';
export type OrchestrationReceipt={
 id:string;tenantId:string;orchestrationPlanId:string;workPackageId:string;kind:OrchestrationReceiptKind;
 fromStatus:OrchestrationWorkStatus;toStatus:OrchestrationWorkStatus;revision:number;
 sourceRef:{kind:string;id:string}|null;agencyExecutionReceiptId:string|null;capabilityReceiptId:string|null;
 retryClass:OrchestrationRetryClass;summary:string;createdAt:string;
};

export type OrchestrationActor={userId:string;role?:string;workspaceTenantId?:string};
export type CreateOrchestrationPlanInput={
 goal:string;idempotencyKey:string;projectId?:string|null;businessEngineId?:string|null;engineVersionId?:string|null;
 classification?:OutcomeClassification;businessEngineDecision?:BusinessEngineDecision;projectDecision?:ProjectDecision;
 businessMaterializationRef?:OrchestrationPlan['businessMaterializationRef'];workPackages:OrchestrationWorkPackageSpec[];
};
export type AgencyExecutionBinding={agencyActionPlanId:string;projectId?:string;approvalId?:string;capabilityApprovalReferenceId?:string};
export type AgencyExecutionReceiptProjection={id:string;state:'SUCCEEDED'|'FAILED'|'BLOCKED'|'STOPPED';retryClass:OrchestrationRetryClass;capabilityReceiptId?:string;blockCode?:string;errorCode?:string};
