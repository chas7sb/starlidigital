export type ApprovalCenterDecision='APPROVE'|'REJECT';
export type ApprovalCenterStatus='PENDING'|'APPROVED'|'REJECTED'|'EXPIRED';
export type ReceiptResult='SUCCEEDED'|'FAILED'|'DENIED'|'APPROVED'|'REJECTED';

export interface ApprovalCenterCard{
  id:string;
  title:string;
  what:string;
  why:string;
  affected:{label:string;projectId:string|null;businessEngineId:string|null};
  capability:string;
  risk:'LOW'|'MEDIUM'|'HIGH';
  sideEffect:string;
  status:ApprovalCenterStatus;
  requestedAt:string;
  expiresAt:string|null;
  actionPlanId:string;
}

export interface CustomerActionReceipt{
  id:string;
  action:string;
  result:ReceiptResult;
  timestamp:string;
  capability:string|null;
  projectId:string|null;
  evidenceReference:string|null;
  nextStep:string;
  source:'CAPABILITY'|'APPROVAL';
}

export interface ApprovalCenterSnapshot{
  schemaVersion:1;
  generatedAt:string;
  pendingCount:number;
  approvals:ApprovalCenterCard[];
  receipts:CustomerActionReceipt[];
  nextReceiptCursor:string|null;
}
