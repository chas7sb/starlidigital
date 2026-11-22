export type MachineryAuditStage='PLANNED'|'WAITING_INPUT'|'WAITING_APPROVAL'|'APPROVED'|'WAITING_CONNECTION'|'BLOCKED'|'RUNNING'|'PROVIDER_ACCEPTED'|'DEVICE_ACCEPTED'|'SUCCEEDED'|'FAILED'|'UNCERTAIN'|'STOPPED';
export type MachineryAuditSource='MACHINERY_RUN'|'ORCHESTRATION'|'APPROVAL'|'AGENCY_EXECUTION'|'CAPABILITY'|'ARTIFACT'|'DEVICE_JOB'|'CONNECTION';
export type MachineryAuditEvent={id:string;stage:MachineryAuditStage;source:MachineryAuditSource;sourceLabel?:string;occurredAt:string|null;title:string;detail:string;projectId:string|null;workPackageId:string|null;artifactId:string|null;evidenceReference:{kind:string;id:string;label?:string}|null};
export type MachineryAuditTimelineOptions={limit?:number;cursor?:string|null};
export type MachineryAuditPageInfo={limit:number;hasMore:boolean;nextCursor:string|null};
export type MachineryAuditTimeline={runId:string;state:string;generatedAt:string;events:MachineryAuditEvent[];unavailableSources:string[];openWork:{label:'Open Work';href:string}|null;pageInfo:MachineryAuditPageInfo};
