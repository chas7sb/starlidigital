import { Store, id, now } from '../store.js';
import { Events } from '../events.js';
import { fail } from '../security.js';
import type {
  CrmCompany,
  CrmContact,
  CrmSignal,
  CrmOpportunity,
  CrmTask,
  CrmActivity,
  CrmPipelineConfig,
  CrmSavedView,
  PipelineMetrics,
  CrmImportPreviewResult
} from './types.js';
import { normalizeDomain, normalizeEmail, parseCsvString, toCsvString, sanitizeCsvField } from './csv.js';
import { agencyOverview, reconcileLegacyLeads } from './journey.js';

export const CRM_COLLECTIONS = {
  COMPANIES: 'crm_companies',
  CONTACTS: 'crm_contacts',
  SIGNALS: 'crm_signals',
  PIPELINES: 'crm_pipelines',
  OPPORTUNITIES: 'crm_opportunities',
  TASKS: 'crm_tasks',
  ACTIVITIES: 'crm_activities',
  SAVED_VIEWS: 'crm_saved_views'
} as const;

export const DEFAULT_PIPELINE_STAGES = [
  { id: 'lead', name: 'Lead / Prospect', order: 1, probability: 10 },
  { id: 'discovery', name: 'Discovery / Research', order: 2, probability: 25 },
  { id: 'proposal', name: 'Proposal / Demo Spec', order: 3, probability: 50 },
  { id: 'negotiation', name: 'Negotiation', order: 4, probability: 75 },
  { id: 'closed_won', name: 'Closed Won', order: 5, probability: 100, isTerminalWon: true },
  { id: 'closed_lost', name: 'Closed Lost', order: 6, probability: 0, isTerminalLost: true }
];

export interface CallerContext {
  userId: string;
  role?: string;
  principal?: string;
}

export class CrmServices {
  agencyOverview() { return agencyOverview(this.store,this); }
  reconcileLegacyLeads(caller:CallerContext, options:{dryRun?:boolean;limit?:number;after?:string}={}) {return reconcileLegacyLeads(this.store,this,caller,options);}
  constructor(private store: Store, private events: Events) {
    this.ensureDefaultPipeline();
  }

  private ensureDefaultPipeline() {
    const existing = this.store.get(CRM_COLLECTIONS.PIPELINES, 'default-pipeline');
    if (!existing) {
      const defaultPipeline: CrmPipelineConfig = {
        id: 'default-pipeline',
        name: 'Standard Direct Sales Pipeline',
        stages: DEFAULT_PIPELINE_STAGES,
        version: 1,
        updatedAt: now()
      };
      this.store.put(CRM_COLLECTIONS.PIPELINES, defaultPipeline);
    }
  }

  // ==========================================
  // Pipeline Operations
  // ==========================================
  getPipeline(pipelineId = 'default-pipeline'): CrmPipelineConfig {
    const p = this.store.get(CRM_COLLECTIONS.PIPELINES, pipelineId) as CrmPipelineConfig | undefined;
    if (!p) fail('Pipeline not found', 'NOT_FOUND');
    return p;
  }

  updatePipelineStages(caller: CallerContext, stages: CrmPipelineConfig['stages'], expectedVersion: number): CrmPipelineConfig {
    const existing = this.getPipeline();
    if (existing.version !== expectedVersion) {
      fail(`Version conflict on pipeline: expected ${expectedVersion}, got ${existing.version}`, 'CONFLICT');
    }
    // Validation: make sure order and probability are valid
    for (const stage of stages) {
      if (!stage.id || !stage.name) fail('Stage must have id and name', 'BAD_USER_INPUT');
      if (stage.probability < 0 || stage.probability > 100) fail('Probability must be between 0 and 100', 'BAD_USER_INPUT');
    }
    const updated: CrmPipelineConfig = {
      ...existing,
      stages,
      version: existing.version + 1,
      updatedAt: now()
    };
    this.store.put(CRM_COLLECTIONS.PIPELINES, updated);
    this.logActivity({
      kind: 'SYSTEM',
      actorPrincipal: caller.principal || caller.userId,
      occurredAt: now(),
      summary: `Updated pipeline configuration to version ${updated.version}`,
      visibility: 'INTERNAL_ONLY'
    });
    return updated;
  }

  // ==========================================
  // Companies / Prospects
  // ==========================================
  getCompany(idStr: string): CrmCompany | undefined {
    return this.store.get(CRM_COLLECTIONS.COMPANIES, idStr) as CrmCompany | undefined;
  }

  listCompanies(filter?: {
    search?: string;
    industry?: string;
    qualificationStatus?: string;
    tag?: string;
    ownerId?: string;
  }): CrmCompany[] {
    let all = this.store.list(CRM_COLLECTIONS.COMPANIES) as CrmCompany[];
    if (filter?.ownerId) {
      all = all.filter(c => c.ownerId === filter.ownerId);
    }
    if (filter?.industry) {
      all = all.filter(c => c.industry?.toLowerCase() === filter.industry?.toLowerCase());
    }
    if (filter?.qualificationStatus) {
      all = all.filter(c => c.qualificationStatus === filter.qualificationStatus);
    }
    if (filter?.tag) {
      all = all.filter(c => c.tags?.includes(filter.tag!));
    }
    if (filter?.search) {
      const term = filter.search.toLowerCase();
      all = all.filter(c => 
        c.name.toLowerCase().includes(term) ||
        c.domain?.toLowerCase().includes(term) ||
        c.locality?.toLowerCase().includes(term) ||
        c.email?.toLowerCase().includes(term)
      );
    }
    return all.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  upsertCompany(caller: CallerContext, input: Partial<CrmCompany> & { name: string }, expectedVersion?: number): CrmCompany {
    const currentTime = now();
    const domainNorm = normalizeDomain(input.domain || input.website);
    const emailNorm = normalizeEmail(input.email);

    if (input.id) {
      const existing = this.getCompany(input.id);
      if (!existing) fail('Company not found', 'NOT_FOUND');
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        fail(`Version conflict: company was modified (expected ${expectedVersion}, found ${existing.version})`, 'CONFLICT');
      }

      const updated: CrmCompany = {
        ...existing,
        ...input,
        name: input.name.trim(),
        domain: domainNorm ?? existing.domain,
        email: emailNorm ?? existing.email,
        qualificationStatus: input.qualificationStatus ?? existing.qualificationStatus,
        tags: Array.isArray(input.tags) ? Array.from(new Set(input.tags)) : existing.tags,
        legacyLeadId: input.legacyLeadId !== undefined ? input.legacyLeadId : existing.legacyLeadId,
        proposalId: input.proposalId !== undefined ? input.proposalId : existing.proposalId,
        projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
        version: existing.version + 1,
        updatedAt: currentTime
      };
      this.store.put(CRM_COLLECTIONS.COMPANIES, updated);
      this.events.publish('crm:company:updated', updated);
      return updated;
    } else {
      const newCompany: CrmCompany = {
        id: id(),
        name: input.name.trim(),
        domain: domainNorm,
        industry: input.industry?.trim() || null,
        locality: input.locality?.trim() || null,
        country: input.country?.trim() || 'RO',
        website: input.website?.trim() || null,
        phone: input.phone?.trim() || null,
        email: emailNorm,
        qualificationStatus: input.qualificationStatus || 'UNQUALIFIED',
        ownerId: input.ownerId || caller.userId,
        tags: Array.isArray(input.tags) ? Array.from(new Set(input.tags)) : [],
        customFields: input.customFields || {},
        legacyLeadId: input.legacyLeadId || null,
        proposalId: input.proposalId || null,
        projectId: input.projectId || null,
        version: 1,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      this.store.put(CRM_COLLECTIONS.COMPANIES, newCompany);
      this.events.publish('crm:company:created', newCompany);

      this.logActivity({
        kind: 'SYSTEM',
        actorPrincipal: caller.principal || caller.userId,
        occurredAt: currentTime,
        companyId: newCompany.id,
        summary: `Created prospect / company "${newCompany.name}"`,
        visibility: 'INTERNAL_ONLY'
      });

      return newCompany;
    }
  }

  findDuplicateCandidates(name: string, domain?: string | null, email?: string | null): CrmCompany[] {
    const normDomain = normalizeDomain(domain);
    const normEmail = normalizeEmail(email);
    const normName = name.trim().toLowerCase();

    const companies = this.store.list(CRM_COLLECTIONS.COMPANIES) as CrmCompany[];
    return companies.filter(c => {
      if (normDomain && c.domain && normalizeDomain(c.domain) === normDomain) return true;
      if (normEmail && c.email && normalizeEmail(c.email) === normEmail) return true;
      if (c.name.trim().toLowerCase() === normName) return true;
      return false;
    });
  }

  mergeCompanies(
    caller: CallerContext,
    targetCompanyId: string,
    sourceCompanyId: string,
    expectedTargetVersion: number,
    expectedSourceVersion: number
  ): CrmCompany {
    if (targetCompanyId === sourceCompanyId) {
      fail('Cannot merge a company into itself', 'BAD_USER_INPUT');
    }
    const target = this.getCompany(targetCompanyId);
    const source = this.getCompany(sourceCompanyId);
    if (!target || !source) fail('Company not found for merge', 'NOT_FOUND');

    if (target.version !== expectedTargetVersion) {
      fail(`Target version conflict: expected ${expectedTargetVersion}, found ${target.version}`, 'CONFLICT');
    }
    if (source.version !== expectedSourceVersion) {
      fail(`Source version conflict: expected ${expectedSourceVersion}, found ${source.version}`, 'CONFLICT');
    }

    // Merge tags
    const mergedTags = Array.from(new Set([...(target.tags || []), ...(source.tags || [])]));

    // Re-link legacy relationships if target is missing them
    const updatedTarget: CrmCompany = {
      ...target,
      domain: target.domain || source.domain,
      industry: target.industry || source.industry,
      locality: target.locality || source.locality,
      phone: target.phone || source.phone,
      email: target.email || source.email,
      website: target.website || source.website,
      legacyLeadId: target.legacyLeadId || source.legacyLeadId,
      proposalId: target.proposalId || source.proposalId,
      projectId: target.projectId || source.projectId,
      tags: mergedTags,
      version: target.version + 1,
      updatedAt: now()
    };

    // Re-parent contacts, signals, opportunities, tasks, activities from source to target
    const contacts = (this.store.list(CRM_COLLECTIONS.CONTACTS) as CrmContact[]).filter(c => c.companyId === sourceCompanyId);
    for (const c of contacts) {
      this.store.put(CRM_COLLECTIONS.CONTACTS, { ...c, companyId: targetCompanyId, version: c.version + 1, updatedAt: now() });
    }

    const signals = (this.store.list(CRM_COLLECTIONS.SIGNALS) as CrmSignal[]).filter(s => s.companyId === sourceCompanyId);
    for (const s of signals) {
      this.store.put(CRM_COLLECTIONS.SIGNALS, { ...s, companyId: targetCompanyId, version: s.version + 1, updatedAt: now() });
    }

    const opps = (this.store.list(CRM_COLLECTIONS.OPPORTUNITIES) as CrmOpportunity[]).filter(o => o.companyId === sourceCompanyId);
    for (const o of opps) {
      this.store.put(CRM_COLLECTIONS.OPPORTUNITIES, { ...o, companyId: targetCompanyId, version: o.version + 1, updatedAt: now() });
    }

    const tasks = (this.store.list(CRM_COLLECTIONS.TASKS) as CrmTask[]).filter(t => t.companyId === sourceCompanyId);
    for (const t of tasks) {
      this.store.put(CRM_COLLECTIONS.TASKS, { ...t, companyId: targetCompanyId, version: t.version + 1, updatedAt: now() });
    }

    const activities = (this.store.list(CRM_COLLECTIONS.ACTIVITIES) as CrmActivity[]).filter(a => a.companyId === sourceCompanyId);
    for (const a of activities) {
      this.store.put(CRM_COLLECTIONS.ACTIVITIES, { ...a, companyId: targetCompanyId, version: a.version + 1 });
    }

    // Persist target and remove source
    this.store.put(CRM_COLLECTIONS.COMPANIES, updatedTarget);
    this.store.remove(CRM_COLLECTIONS.COMPANIES, sourceCompanyId);

    this.logActivity({
      kind: 'SYSTEM',
      actorPrincipal: caller.principal || caller.userId,
      occurredAt: now(),
      companyId: targetCompanyId,
      summary: `Merged company "${source.name}" (${sourceCompanyId}) into "${target.name}" (${targetCompanyId})`,
      visibility: 'INTERNAL_ONLY'
    });

    return updatedTarget;
  }

  // ==========================================
  // Contacts
  // ==========================================
  listContacts(companyId?: string): CrmContact[] {
    const all = this.store.list(CRM_COLLECTIONS.CONTACTS) as CrmContact[];
    if (companyId) return all.filter(c => c.companyId === companyId);
    return all;
  }

  getContact(idStr: string): CrmContact | undefined {
    return this.store.get(CRM_COLLECTIONS.CONTACTS, idStr) as CrmContact | undefined;
  }

  upsertContact(caller: CallerContext, input: Partial<CrmContact> & { companyId: string; firstName: string; lastName: string }, expectedVersion?: number): CrmContact {
    const company = this.getCompany(input.companyId);
    if (!company) fail('Company not found for contact', 'NOT_FOUND');

    const currentTime = now();
    const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();

    if (input.id) {
      const existing = this.getContact(input.id);
      if (!existing) fail('Contact not found', 'NOT_FOUND');
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        fail(`Version conflict: contact modified (expected ${expectedVersion}, got ${existing.version})`, 'CONFLICT');
      }
      const updated: CrmContact = {
        ...existing,
        ...input,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        fullName,
        email: normalizeEmail(input.email) ?? existing.email,
        isPrimary: input.isPrimary !== undefined ? input.isPrimary : existing.isPrimary,
        version: existing.version + 1,
        updatedAt: currentTime
      };
      this.store.put(CRM_COLLECTIONS.CONTACTS, updated);
      return updated;
    } else {
      const newContact: CrmContact = {
        id: id(),
        companyId: input.companyId,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        fullName,
        email: normalizeEmail(input.email),
        phone: input.phone?.trim() || null,
        roleTitle: input.roleTitle?.trim() || null,
        isPrimary: input.isPrimary ?? false,
        ownerId: input.ownerId || caller.userId,
        version: 1,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      this.store.put(CRM_COLLECTIONS.CONTACTS, newContact);
      return newContact;
    }
  }

  // ==========================================
  // Signals & Evidence
  // ==========================================
  listSignals(companyId?: string): CrmSignal[] {
    const all = this.store.list(CRM_COLLECTIONS.SIGNALS) as CrmSignal[];
    if (companyId) return all.filter(s => s.companyId === companyId);
    return all;
  }

  addSignal(caller: CallerContext, input: Omit<CrmSignal, 'id' | 'version' | 'createdAt' | 'updatedAt'>): CrmSignal {
    const company = this.getCompany(input.companyId);
    if (!company) fail('Company not found for signal', 'NOT_FOUND');

    const currentTime = now();
    const newSignal: CrmSignal = {
      id: id(),
      companyId: input.companyId,
      source: input.source.trim(),
      kind: input.kind.trim(),
      title: input.title.trim(),
      summary: input.summary.trim(),
      evidenceUrl: input.evidenceUrl?.trim() || null,
      confidenceScore: Math.min(1.0, Math.max(0.0, input.confidenceScore ?? 0.5)),
      verified: !!input.verified,
      metadata: input.metadata || {},
      version: 1,
      createdAt: currentTime,
      updatedAt: currentTime
    };
    this.store.put(CRM_COLLECTIONS.SIGNALS, newSignal);
    return newSignal;
  }

  verifySignal(caller: CallerContext, signalId: string, verified: boolean, expectedVersion?: number): CrmSignal {
    const signal = this.store.get(CRM_COLLECTIONS.SIGNALS, signalId) as CrmSignal | undefined;
    if (!signal) fail('Signal not found', 'NOT_FOUND');
    if (expectedVersion !== undefined && signal.version !== expectedVersion) {
      fail(`Version conflict on signal: expected ${expectedVersion}, got ${signal.version}`, 'CONFLICT');
    }
    const updated: CrmSignal = {
      ...signal,
      verified,
      version: signal.version + 1,
      updatedAt: now()
    };
    this.store.put(CRM_COLLECTIONS.SIGNALS, updated);
    return updated;
  }

  // ==========================================
  // Opportunities / Deals
  // ==========================================
  listOpportunities(filter?: { companyId?: string; stageId?: string; status?: string; ownerId?: string }): CrmOpportunity[] {
    let all = this.store.list(CRM_COLLECTIONS.OPPORTUNITIES) as CrmOpportunity[];
    if (filter?.companyId) all = all.filter(o => o.companyId === filter.companyId);
    if (filter?.stageId) all = all.filter(o => o.stageId === filter.stageId);
    if (filter?.status) all = all.filter(o => o.status === filter.status);
    if (filter?.ownerId) all = all.filter(o => o.ownerId === filter.ownerId);
    return all.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  getOpportunity(idStr: string): CrmOpportunity | undefined {
    return this.store.get(CRM_COLLECTIONS.OPPORTUNITIES, idStr) as CrmOpportunity | undefined;
  }

  upsertOpportunity(caller: CallerContext, input: Partial<CrmOpportunity> & { companyId: string; title: string; amount: number; currency: string; stageId: string }, expectedVersion?: number): CrmOpportunity {
    const company = this.getCompany(input.companyId);
    if (!company) fail('Company not found for opportunity', 'NOT_FOUND');

    const pipeline = this.getPipeline();
    const stage = pipeline.stages.find(s => s.id === input.stageId);
    if (!stage) fail(`Stage ${input.stageId} does not exist in pipeline`, 'BAD_USER_INPUT');

    const currentTime = now();
    const probability = input.probability !== undefined ? input.probability : stage.probability;
    let status: 'OPEN' | 'WON' | 'LOST' = 'OPEN';
    if (stage.isTerminalWon) status = 'WON';
    else if (stage.isTerminalLost) status = 'LOST';

    if (input.id) {
      const existing = this.getOpportunity(input.id);
      if (!existing) fail('Opportunity not found', 'NOT_FOUND');
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        fail(`Version conflict on opportunity: expected ${expectedVersion}, got ${existing.version}`, 'CONFLICT');
      }

      const updated: CrmOpportunity = {
        ...existing,
        ...input,
        title: input.title.trim(),
        amount: Math.max(0, input.amount),
        currency: (input.currency || existing.currency).trim().toUpperCase(),
        stageId: input.stageId,
        probability,
        status,
        wonReason: status === 'WON' ? (input.wonReason || existing.wonReason || null) : null,
        lostReason: status === 'LOST' ? (input.lostReason || existing.lostReason || null) : null,
        version: existing.version + 1,
        updatedAt: currentTime
      };

      this.store.put(CRM_COLLECTIONS.OPPORTUNITIES, updated);
      if (existing.stageId !== updated.stageId) {
        this.logActivity({
          kind: 'STAGE_CHANGE',
          actorPrincipal: caller.principal || caller.userId,
          occurredAt: currentTime,
          companyId: updated.companyId,
          opportunityId: updated.id,
          summary: `Moved deal "${updated.title}" to stage "${stage.name}" (${status})`,
          visibility: 'INTERNAL_ONLY'
        });
      }
      return updated;
    } else {
      const newOpp: CrmOpportunity = {
        id: id(),
        companyId: input.companyId,
        primaryContactId: input.primaryContactId || null,
        title: input.title.trim(),
        amount: Math.max(0, input.amount),
        currency: input.currency.trim().toUpperCase(),
        stageId: input.stageId,
        probability,
        closeDate: input.closeDate || null,
        wonReason: status === 'WON' ? (input.wonReason || null) : null,
        lostReason: status === 'LOST' ? (input.lostReason || null) : null,
        status,
        ownerId: input.ownerId || caller.userId,
        projectId: input.projectId || company.projectId || null,
        proposalId: input.proposalId || company.proposalId || null,
        legacyLeadId: input.legacyLeadId || company.legacyLeadId || null,
        version: 1,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      this.store.put(CRM_COLLECTIONS.OPPORTUNITIES, newOpp);

      this.logActivity({
        kind: 'STAGE_CHANGE',
        actorPrincipal: caller.principal || caller.userId,
        occurredAt: currentTime,
        companyId: newOpp.companyId,
        opportunityId: newOpp.id,
        summary: `Created deal "${newOpp.title}" in stage "${stage.name}" (${status})`,
        visibility: 'INTERNAL_ONLY'
      });

      return newOpp;
    }
  }

  // ==========================================
  // Tasks
  // ==========================================
  listTasks(filter?: { companyId?: string; opportunityId?: string; status?: string; ownerId?: string }): CrmTask[] {
    let all = this.store.list(CRM_COLLECTIONS.TASKS) as CrmTask[];
    if (filter?.companyId) all = all.filter(t => t.companyId === filter.companyId);
    if (filter?.opportunityId) all = all.filter(t => t.opportunityId === filter.opportunityId);
    if (filter?.status) all = all.filter(t => t.status === filter.status);
    if (filter?.ownerId) all = all.filter(t => t.ownerId === filter.ownerId);
    return all.sort((a, b) => {
      if (a.dueDate && b.dueDate) return Date.parse(a.dueDate) - Date.parse(b.dueDate);
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  }

  upsertTask(caller: CallerContext, input: Partial<CrmTask> & { title: string }, expectedVersion?: number): CrmTask {
    const currentTime = now();
    if (input.id) {
      const existing = this.store.get(CRM_COLLECTIONS.TASKS, input.id) as CrmTask | undefined;
      if (!existing) fail('Task not found', 'NOT_FOUND');
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        fail(`Version conflict on task: expected ${expectedVersion}, got ${existing.version}`, 'CONFLICT');
      }
      const isCompleted = input.status === 'COMPLETED';
      const updated: CrmTask = {
        ...existing,
        ...input,
        title: input.title.trim(),
        completedAt: isCompleted ? (existing.completedAt || currentTime) : null,
        version: existing.version + 1,
        updatedAt: currentTime
      };
      this.store.put(CRM_COLLECTIONS.TASKS, updated);
      return updated;
    } else {
      const newTask: CrmTask = {
        id: id(),
        companyId: input.companyId || null,
        opportunityId: input.opportunityId || null,
        contactId: input.contactId || null,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        dueDate: input.dueDate || null,
        priority: input.priority || 'MEDIUM',
        status: input.status || 'PENDING',
        ownerId: input.ownerId || caller.userId,
        completedAt: input.status === 'COMPLETED' ? currentTime : null,
        version: 1,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      this.store.put(CRM_COLLECTIONS.TASKS, newTask);
      return newTask;
    }
  }

  // ==========================================
  // Activities & Timeline
  // ==========================================
  logActivity(activityInput: Omit<CrmActivity, 'id' | 'version' | 'createdAt'>): CrmActivity {
    // Deduplicate by sourceEventId if provided
    if (activityInput.sourceEventId) {
      const all = this.store.list(CRM_COLLECTIONS.ACTIVITIES) as CrmActivity[];
      const dup = all.find(a => a.sourceEventId === activityInput.sourceEventId);
      if (dup) return dup;
    }

    const newAct: CrmActivity = {
      id: id(),
      kind: activityInput.kind,
      actorPrincipal: activityInput.actorPrincipal,
      occurredAt: activityInput.occurredAt || now(),
      companyId: activityInput.companyId || null,
      contactId: activityInput.contactId || null,
      opportunityId: activityInput.opportunityId || null,
      projectId: activityInput.projectId || null,
      sourceEventId: activityInput.sourceEventId || null,
      visibility: activityInput.visibility || 'INTERNAL_ONLY',
      summary: activityInput.summary.trim(),
      details: activityInput.details?.trim() || null,
      version: 1,
      createdAt: now()
    };
    this.store.put(CRM_COLLECTIONS.ACTIVITIES, newAct);
    this.events.publish('crm:activity:logged', newAct);
    return newAct;
  }

  listActivities(filter?: { companyId?: string; opportunityId?: string; contactId?: string }): CrmActivity[] {
    let all = this.store.list(CRM_COLLECTIONS.ACTIVITIES) as CrmActivity[];
    if (filter?.companyId) all = all.filter(a => a.companyId === filter.companyId);
    if (filter?.opportunityId) all = all.filter(a => a.opportunityId === filter.opportunityId);
    if (filter?.contactId) all = all.filter(a => a.contactId === filter.contactId);
    return all.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  }

  // ==========================================
  // Saved Views
  // ==========================================
  listSavedViews(caller: CallerContext, target?: string): CrmSavedView[] {
    let all = this.store.list(CRM_COLLECTIONS.SAVED_VIEWS) as CrmSavedView[];
    if (target) {
      all = all.filter(v => v.target === target);
    }
    // Only return views owned by caller or shared views
    all = all.filter(v => v.isShared || v.ownerId === caller.userId);
    return all.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  upsertSavedView(caller: CallerContext, input: Partial<CrmSavedView> & { name: string; target: string; filtersJson: string }, expectedVersion?: number): CrmSavedView {
    const currentTime = now();
    if (input.id) {
      const existing = this.store.get(CRM_COLLECTIONS.SAVED_VIEWS, input.id) as CrmSavedView | undefined;
      if (!existing) fail('Saved view not found', 'NOT_FOUND');
      if (existing.ownerId !== caller.userId && caller.role !== 'ADMIN') {
        fail('Cannot modify another user saved view', 'FORBIDDEN');
      }
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        fail(`Version conflict on saved view: expected ${expectedVersion}, got ${existing.version}`, 'CONFLICT');
      }
      const updated: CrmSavedView = {
        ...existing,
        ...input,
        name: input.name.trim(),
        target: (input.target || existing.target) as any,
        filtersJson: input.filtersJson || existing.filtersJson,
        sortField: input.sortField !== undefined ? input.sortField : existing.sortField,
        sortDirection: input.sortDirection !== undefined ? input.sortDirection : existing.sortDirection,
        isShared: input.isShared !== undefined ? input.isShared : existing.isShared,
        version: existing.version + 1,
        updatedAt: currentTime
      };
      this.store.put(CRM_COLLECTIONS.SAVED_VIEWS, updated);
      return updated;
    } else {
      const newView: CrmSavedView = {
        id: id(),
        name: input.name.trim(),
        target: input.target as any,
        filtersJson: input.filtersJson,
        sortField: input.sortField,
        sortDirection: input.sortDirection,
        ownerId: caller.userId,
        isShared: input.isShared ?? false,
        version: 1,
        createdAt: currentTime,
        updatedAt: currentTime
      };
      this.store.put(CRM_COLLECTIONS.SAVED_VIEWS, newView);
      return newView;
    }
  }

  deleteSavedView(caller: CallerContext, idStr: string): boolean {
    const existing = this.store.get(CRM_COLLECTIONS.SAVED_VIEWS, idStr) as CrmSavedView | undefined;
    if (!existing) return false;
    if (existing.ownerId !== caller.userId && caller.role !== 'ADMIN') {
      fail('Cannot delete another user saved view', 'FORBIDDEN');
    }
    this.store.remove(CRM_COLLECTIONS.SAVED_VIEWS, idStr);
    return true;
  }

  // ==========================================
  // Ground-Truth Reporting (No Fake Metrics)
  // ==========================================
  getPipelineMetrics(): PipelineMetrics {
    const opps = this.store.list(CRM_COLLECTIONS.OPPORTUNITIES) as CrmOpportunity[];
    const pipeline = this.getPipeline();

    const openOpps = opps.filter(o => o.status === 'OPEN');
    const wonOpps = opps.filter(o => o.status === 'WON');
    const lostOpps = opps.filter(o => o.status === 'LOST');

    const sumByCurrency = (list: CrmOpportunity[]): Record<string, number> => {
      const res: Record<string, number> = {};
      for (const o of list) {
        const curr = o.currency || 'EUR';
        res[curr] = (res[curr] || 0) + o.amount;
      }
      return res;
    };

    const stageBreakdown = pipeline.stages.map(st => {
      const inStage = opps.filter(o => o.stageId === st.id);
      const valByCurr: Record<string, number> = {};
      const weightedByCurr: Record<string, number> = {};
      for (const o of inStage) {
        const curr = o.currency || 'EUR';
        valByCurr[curr] = (valByCurr[curr] || 0) + o.amount;
        weightedByCurr[curr] = (weightedByCurr[curr] || 0) + (o.amount * (o.probability / 100));
      }
      return {
        stageId: st.id,
        stageName: st.name,
        count: inStage.length,
        valueByCurrency: valByCurr,
        probabilityWeightedValueByCurrency: weightedByCurr
      };
    });

    const wonReasons: Record<string, number> = {};
    for (const o of wonOpps) {
      const r = o.wonReason || 'Unspecified';
      wonReasons[r] = (wonReasons[r] || 0) + 1;
    }

    const lostReasons: Record<string, number> = {};
    for (const o of lostOpps) {
      const r = o.lostReason || 'Unspecified';
      lostReasons[r] = (lostReasons[r] || 0) + 1;
    }

    return {
      totalOpenCount: openOpps.length,
      totalOpenValueByCurrency: sumByCurrency(openOpps),
      totalWonCount: wonOpps.length,
      totalWonValueByCurrency: sumByCurrency(wonOpps),
      totalLostCount: lostOpps.length,
      stageBreakdown,
      wonReasonsBreakdown: wonReasons,
      lostReasonsBreakdown: lostReasons
    };
  }

  // ==========================================
  // Scoped CSV Import & Export with Preview
  // ==========================================
  previewCsvImport(csvContent: string): CrmImportPreviewResult {
    const { rows } = parseCsvString(csvContent);
    const existingCompanies = this.store.list(CRM_COLLECTIONS.COMPANIES) as CrmCompany[];
    const existingDomains = new Set(existingCompanies.map(c => normalizeDomain(c.domain)).filter(Boolean));
    const existingEmails = new Set(existingCompanies.map(c => normalizeEmail(c.email)).filter(Boolean));
    const existingNames = new Set(existingCompanies.map(c => c.name.trim().toLowerCase()));

    const previewRows: CrmImportPreviewResult['rows'] = [];
    let duplicateCount = 0;
    let validRows = 0;

    rows.forEach((r, idx) => {
      const name = r.name || r.company || r.business || '';
      if (!name) return; // skip empty lines

      const domain = normalizeDomain(r.domain || r.website || r.url);
      const email = normalizeEmail(r.email || r.contact_email);
      const phone = r.phone || r.telephone || '';
      const industry = r.industry || r.sector || '';
      const locality = r.locality || r.city || '';
      const contactName = r.contact || r.contact_name || '';

      let isDuplicate = false;
      let duplicateReason: string | undefined;

      if (domain && existingDomains.has(domain)) {
        isDuplicate = true;
        duplicateReason = `Domain ${domain} already registered`;
      } else if (email && existingEmails.has(email)) {
        isDuplicate = true;
        duplicateReason = `Email ${email} already registered`;
      } else if (existingNames.has(name.trim().toLowerCase())) {
        isDuplicate = true;
        duplicateReason = `Company name "${name}" matches existing prospect`;
      }

      if (isDuplicate) duplicateCount++;
      else validRows++;

      previewRows.push({
        rowIndex: idx + 1,
        name,
        domain: domain || undefined,
        email: email || undefined,
        phone: phone || undefined,
        industry: industry || undefined,
        locality: locality || undefined,
        contactName: contactName || undefined,
        isDuplicate,
        duplicateReason,
        sanitized: true
      });
    });

    return {
      totalRows: previewRows.length,
      validRows,
      duplicateCount,
      rows: previewRows
    };
  }

  executeCsvImport(caller: CallerContext, csvContent: string, options: { skipDuplicates: boolean }): { importedCount: number; skippedCount: number } {
    const preview = this.previewCsvImport(csvContent);
    let importedCount = 0;
    let skippedCount = 0;

    for (const row of preview.rows) {
      if (row.isDuplicate && options.skipDuplicates) {
        skippedCount++;
        continue;
      }

      const comp = this.upsertCompany(caller, {
        name: row.name,
        domain: row.domain || null,
        email: row.email || null,
        phone: row.phone || null,
        industry: row.industry || null,
        locality: row.locality || null,
        qualificationStatus: 'UNQUALIFIED'
      });

      if (row.contactName) {
        const parts = row.contactName.trim().split(/\s+/);
        const firstName = parts[0] || 'Contact';
        const lastName = parts.slice(1).join(' ') || '';
        this.upsertContact(caller, {
          companyId: comp.id,
          firstName,
          lastName,
          email: row.email || null,
          phone: row.phone || null,
          isPrimary: true
        });
      }

      importedCount++;
    }

    this.logActivity({
      kind: 'IMPORT',
      actorPrincipal: caller.principal || caller.userId,
      occurredAt: now(),
      summary: `Imported ${importedCount} prospects from CSV (${skippedCount} duplicates skipped)`,
      visibility: 'INTERNAL_ONLY'
    });

    return { importedCount, skippedCount };
  }

  exportCompaniesCsv(): string {
    const companies = this.store.list(CRM_COLLECTIONS.COMPANIES) as CrmCompany[];
    const headers = [
      'ID', 'Name', 'Domain', 'Industry', 'Locality', 'Email', 'Phone',
      'QualificationStatus', 'Tags', 'LegacyLeadId', 'ProposalId', 'ProjectId', 'CreatedAt'
    ];

    const rows = companies.map(c => [
      c.id,
      c.name,
      c.domain || '',
      c.industry || '',
      c.locality || '',
      c.email || '',
      c.phone || '',
      c.qualificationStatus,
      (c.tags || []).join(';'),
      c.legacyLeadId || '',
      c.proposalId || '',
      c.projectId || '',
      c.createdAt
    ]);

    return toCsvString(headers, rows);
  }
}

export function createCrmServices(options: {
  store: Store;
  events: Events;
  mailboxActivityIntegration?: boolean;
}): CrmServices {
  const services = new CrmServices(options.store, options.events);
  return services;
}
