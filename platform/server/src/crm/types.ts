import type { RecordData } from '../store.js';

export interface CrmCompany extends RecordData {
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
  customFields?: Record<string, any>;
  legacyLeadId?: string | null;
  proposalId?: string | null;
  projectId?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmContact extends RecordData {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  roleTitle?: string | null;
  isPrimary: boolean;
  ownerId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmSignal extends RecordData {
  id: string;
  companyId: string;
  source: string; // e.g. "WEBSITE_AUDIT", "NEWS", "TECH_STACK", "OUTREACH"
  kind: string;   // e.g. "OUTDATED_WEBSITE", "NO_SSL", "HIRING", "HIRING_DEV"
  title: string;
  summary: string;
  evidenceUrl?: string | null;
  confidenceScore: number; // 0.0 - 1.0
  verified: boolean;
  metadata?: Record<string, any>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStageConfig {
  id: string;
  name: string;
  order: number;
  probability: number; // 0 - 100
  isTerminalWon?: boolean;
  isTerminalLost?: boolean;
}

export interface CrmPipelineConfig extends RecordData {
  id: string; // default "default-pipeline"
  name: string;
  stages: PipelineStageConfig[];
  version: number;
  updatedAt: string;
}

export interface CrmOpportunity extends RecordData {
  id: string;
  companyId: string;
  primaryContactId?: string | null;
  title: string;
  amount: number;
  currency: string; // e.g. "EUR", "USD", "RON"
  stageId: string;
  probability: number;
  closeDate?: string | null;
  wonReason?: string | null;
  lostReason?: string | null;
  status: 'OPEN' | 'WON' | 'LOST';
  ownerId: string;
  projectId?: string | null;
  proposalId?: string | null;
  legacyLeadId?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmTask extends RecordData {
  id: string;
  companyId?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  ownerId: string;
  completedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmActivity extends RecordData {
  id: string;
  kind: 'NOTE' | 'CALL' | 'EMAIL' | 'EMAIL_INBOUND' | 'EMAIL_OUTBOUND' | 'EMAIL_TRANSACTIONAL' | 'MEETING' | 'STAGE_CHANGE' | 'TASK' | 'IMPORT' | 'SYSTEM';
  actorPrincipal: string; // e.g. "admin", "chatgpt-mcp", "operator", "alex@starlidigital.ro"
  occurredAt: string;
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  projectId?: string | null;
  sourceEventId?: string | null; // unique deduplication token
  visibility: 'PUBLIC' | 'INTERNAL_ONLY' | 'REDACTED';
  summary: string;
  details?: string | null;
  version: number;
  createdAt: string;
}

export interface CrmSavedView extends RecordData {
  id: string;
  name: string;
  target: 'COMPANIES' | 'OPPORTUNITIES' | 'TASKS';
  filtersJson: string;
  sortField?: string;
  sortDirection?: 'ASC' | 'DESC';
  ownerId: string;
  isShared: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DedupeMatch {
  existingCompany: CrmCompany;
  matchReason: 'DOMAIN_MATCH' | 'EMAIL_MATCH' | 'NAME_SIMILARITY';
  score: number;
}

export interface CrmImportPreviewResult {
  totalRows: number;
  validRows: number;
  duplicateCount: number;
  rows: Array<{
    rowIndex: number;
    name: string;
    domain?: string;
    email?: string;
    phone?: string;
    industry?: string;
    locality?: string;
    contactName?: string;
    isDuplicate: boolean;
    duplicateReason?: string;
    sanitized: boolean;
  }>;
}

export interface PipelineMetrics {
  totalOpenCount: number;
  totalOpenValueByCurrency: Record<string, number>;
  totalWonCount: number;
  totalWonValueByCurrency: Record<string, number>;
  totalLostCount: number;
  stageBreakdown: Array<{
    stageId: string;
    stageName: string;
    count: number;
    valueByCurrency: Record<string, number>;
    probabilityWeightedValueByCurrency: Record<string, number>;
  }>;
  wonReasonsBreakdown: Record<string, number>;
  lostReasonsBreakdown: Record<string, number>;
}
