import type {BackendSummary,MigrationRisk} from '../backend-factory/domain.js';

export type ContextualBackendBlockerCode='NO_VERSION'|'BUILD_FAILED'|'MIGRATION_REVIEW'|'MIGRATION_BLOCKED'|'NOT_READY'|'UNHEALTHY'|'APPROVAL_REQUIRED'|'NO_RUNTIME';
export interface ContextualBackendBlocker {code:ContextualBackendBlockerCode;message:string;recoverable:boolean;requiresApproval:boolean;}
export interface ContextualBackendModelField {name:string;type:string;required:boolean;unique:boolean;}
export interface ContextualBackendModel {name:string;fields:ContextualBackendModelField[];}
export interface ContextualBackendEndpoint {method:'GET'|'POST'|'PATCH'|'DELETE';path:string;description:string;}
export interface ContextualBackendBuild {status:'NOT_STARTED'|'DRAFT'|'VALIDATED'|'BUILDING'|'SUCCEEDED'|'FAILED'|'BLOCKED'|'NEEDS_REVIEW';errorCount:number;warningCount:number;updatedAt:string|null;}
export interface ContextualBackendMigration {risk:MigrationRisk|null;operationCount:number;requiresApproval:boolean;status:'NOT_PLANNED'|'SAFE'|'REVIEW_REQUIRED'|'BLOCKED';}
export interface ContextualBackendDeployment {environment:'STAGING'|'PRODUCTION'|null;state:BackendSummary['lifecycle'];lastDeploymentAt:string|null;deployApprovalRequired:boolean;rollbackAvailable:boolean;}
export interface ContextualBackendLogs {available:boolean;summary:string;levels:{debug:number;info:number;warn:number;error:number}|null;}
export interface ContextualBackendProjection {
  backend:BackendSummary;
  schema:{models:ContextualBackendModel[];modelCount:number;fieldCount:number};
  api:{endpoints:ContextualBackendEndpoint[];endpointCount:number};
  build:ContextualBackendBuild;
  migration:ContextualBackendMigration;
  deployment:ContextualBackendDeployment;
  logs:ContextualBackendLogs;
  blockers:ContextualBackendBlocker[];
  allowedActions:Array<'add_model'|'add_authentication'|'preview_migration'|'build'|'deploy_staging'|'request_production_deploy'|'diagnose'|'rollback'>;
  updatedAt:string;
}
