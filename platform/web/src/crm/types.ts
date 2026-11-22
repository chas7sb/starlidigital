export interface CrmCompany {
  id: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
  locality?: string | null;
  country?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  qualificationStatus: 'UNQUALIFIED' | 'QUALIFYING' | 'QUALIFIED' | 'DISQUALIFIED';
  ownerId: string;
  tags: string[];
  legacyLeadId?: string | null;
  proposalId?: string | null;
  projectId?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmContact {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  roleTitle?: string | null;
  isPrimary: boolean;
  version: number;
}

export interface CrmSignal {
  id: string;
  companyId: string;
  source: string;
  kind: string;
  title: string;
  summary: string;
  evidenceUrl?: string | null;
  confidenceScore: number;
  verified: boolean;
  version: number;
  createdAt: string;
}

export interface CrmOpportunity {
  id: string;
  companyId: string;
  primaryContactId?: string | null;
  title: string;
  amount: number;
  currency: string;
  stageId: string;
  probability: number;
  closeDate?: string | null;
  wonReason?: string | null;
  lostReason?: string | null;
  status: 'OPEN' | 'WON' | 'LOST';
  projectId?: string | null;
  proposalId?: string | null;
  legacyLeadId?: string | null;
  version: number;
  updatedAt: string;
}

export interface CrmTask {
  id: string;
  companyId?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  completedAt?: string | null;
  version: number;
}

export interface CrmSavedView {
  id: string;
  name: string;
  target: 'COMPANIES' | 'OPPORTUNITIES' | 'TASKS';
  filtersJson: string;
  sortField?: string | null;
  sortDirection?: 'ASC' | 'DESC' | null;
  ownerId: string;
  isShared: boolean;
  version: number;
}

export interface CrmActivity {
  id: string;
  kind: 'NOTE' | 'CALL' | 'EMAIL' | 'EMAIL_INBOUND' | 'EMAIL_OUTBOUND' | 'EMAIL_TRANSACTIONAL' | 'MEETING' | 'STAGE_CHANGE' | 'TASK' | 'IMPORT' | 'SYSTEM';
  actorPrincipal: string;
  occurredAt: string;
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  projectId?: string | null;
  visibility: 'PUBLIC' | 'INTERNAL_ONLY' | 'REDACTED';
  summary: string;
  details?: string | null;
}

export interface CrmAsset {
  id: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  filenameHint?: string | null;
  altText?: string | null;
  visibility: string;
  url: string;
  createdAt: string;
  prospectId?: string | null;
  projectId?: string | null;
}

export interface CrmPipelineStage {
  id: string;
  name: string;
  order: number;
  probability: number;
  isTerminalWon?: boolean;
  isTerminalLost?: boolean;
}

export interface CrmPipelineConfig {
  id: string;
  name: string;
  stages: CrmPipelineStage[];
  version: number;
}

export interface CrmPipelineMetrics {
  totalOpenCount: number;
  totalOpenValueByCurrencyJson: string;
  totalWonCount: number;
  totalWonValueByCurrencyJson: string;
  totalLostCount: number;
  stageBreakdown: Array<{
    stageId: string;
    stageName: string;
    count: number;
    valueByCurrencyJson: string;
    probabilityWeightedValueByCurrencyJson: string;
  }>;
  wonReasonsBreakdownJson: string;
  lostReasonsBreakdownJson: string;
}
