export const MACHINERY_RUN_SCHEMA_VERSION=1 as const;

export type MachineryRunActor={userId:string;workspaceTenantId?:string;role?:string};
export type MachineryRunSelectionInput={orchestrationPlanId:string;workPackageIds?:string[]};
export type MachineryRunSelection={orchestrationPlanId:string;workPackageIds:string[]};
export type StartMachineryRunInput={idempotencyKey:string;objective:string;selections:MachineryRunSelectionInput[]};

export type MachineryRunState='WAITING_INPUT'|'WAITING_APPROVAL'|'WAITING_CONNECTION'|'PAUSED'|'BLOCKED'|'READY'|'RUNNING'|'COMPLETED'|'FAILED'|'UNCERTAIN'|'STOPPED';
export type MachineryWorkState=Exclude<MachineryRunState,'PAUSED'>;
export type MachineryRunBlockerKind='INPUT'|'APPROVAL'|'CONNECTION'|'CAPABILITY'|'DEPENDENCY'|'EXECUTION'|'STOPPED'|'UNAVAILABLE';
export type MachineryReceiptKind='ORCHESTRATION'|'AGENCY_EXECUTION'|'CAPABILITY';

export type MachineryRunRecord={
 id:string;
 schemaVersion:typeof MACHINERY_RUN_SCHEMA_VERSION;
 tenantId:string;
 ownerId:string;
 workspaceId:string;
 objective:string;
 selections:MachineryRunSelection[];
 observationSequence:number;
 lastObservationFingerprint:string|null;
 lastObservedAt:string|null;
 createdAt:string;
 updatedAt:string;
};

export type MachineryReceiptReference={kind:MachineryReceiptKind;id:string;orchestrationPlanId:string;workPackageId:string};
export type MachineryRunBlocker={kind:MachineryRunBlockerKind;code:string;orchestrationPlanId:string;workPackageId:string;referenceId:string|null};
export type MachineryWorkProjection={
 orchestrationPlanId:string;
 orchestrationPlanRevision:number|null;
 workPackageId:string;
 title:string|null;
 projectId:string|null;
 target:string|null;
 state:MachineryWorkState;
 canonicalStatus:string|null;
 blockCodes:string[];
 executionRequestId:string|null;
 agencyExecutionState:string|null;
 receiptRefs:MachineryReceiptReference[];
};
export type MachineryRunCounts={total:number;completed:number;failed:number;stopped:number;running:number;uncertain:number;waitingInput:number;waitingApproval:number;waitingConnection:number;blocked:number;ready:number};
export type MachineryRunSnapshot={
 runId:string;
 tenantId:string;
 ownerId:string;
 workspaceId:string;
 objective:string;
 state:MachineryRunState;
 globalPause:{paused:boolean;policyId:string;updatedAt:string|null};
 work:MachineryWorkProjection[];
 blockers:MachineryRunBlocker[];
 receiptRefs:MachineryReceiptReference[];
 counts:MachineryRunCounts;
 summary:{headline:string;detail:string};
 reconnect:{cursor:string;observationSequence:number;changedSinceCursor:boolean;lastObservedAt:string};
 generatedAt:string;
};
