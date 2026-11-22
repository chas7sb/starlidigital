export type AgencyApprovalStatus='PENDING'|'APPROVED'|'REJECTED'|'EXPIRED';
export interface AgencyApprovalRecord{
  id:string;tenantId:string;actionPlanId:string;opportunityId:string;title:string;detail:string;impact:'LOW'|'MEDIUM'|'HIGH';status:AgencyApprovalStatus;
  capabilityLabel:string;workflowLabel:string|null;payloadHash:string;requestedAt:string;expiresAt:string;resolvedAt:string|null;resolvedBy:string|null;
}
