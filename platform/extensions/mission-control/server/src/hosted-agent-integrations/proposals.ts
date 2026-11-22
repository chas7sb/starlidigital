import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Store, RecordData } from '../store.js';
import type { Events } from '../events.js';
import type { HostedAgentServiceLike, HostedAgentRecord } from './types.js';

export interface HostedAgentProposalRecord extends RecordData {
  id: string;
  kind: 'HOSTED_AGENT';
  publicSlug: string;
  agentId: string;
  agentPublicId: string;
  prospectId?: string | null;
  businessName: string;
  industry?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  status: 'DRAFT' | 'READY' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'ARCHIVED';
  title: string;
  summary: string;
  features: string[];
  recommendedAgentType: string;
  quoteMonthlyEur?: number | null;
  quoteSetupEur?: number | null;
  quoteTerms?: string | null;
  viewCount: number;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
}

export interface CreateAgentProposalInput {
  agentId: string;
  prospectId?: string | null;
  publicSlug?: string | null;
  businessName?: string | null;
  industry?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  title?: string | null;
  summary?: string | null;
  features?: string[] | null;
  quoteMonthlyEur?: number | null;
  quoteSetupEur?: number | null;
  quoteTerms?: string | null;
}

export interface HostedAgentProposalPublicView {
  id: string;
  kind: 'HOSTED_AGENT';
  publicSlug: string;
  agentPublicId: string;
  businessName: string;
  industry?: string | null;
  status: string;
  title: string;
  summary: string;
  features: string[];
  recommendedAgentType: string;
  quoteMonthlyEur?: number | null;
  quoteSetupEur?: number | null;
  quoteTerms?: string | null;
  demoUrl: string;
}

export class HostedAgentProposalService {
  constructor(
    private store: Store,
    private events: Events,
    private agentService: HostedAgentServiceLike
  ) {}

  public async createProposal(
    actor: { userId: string; role: 'ADMIN' | 'CUSTOMER' },
    input: CreateAgentProposalInput
  ): Promise<HostedAgentProposalRecord> {
    if (actor.role !== 'ADMIN') {
      throw new Error('Access denied: only admins can create hosted agent proposals');
    }

    // Verify target agent exists and fetch details
    const agent = await this.agentService.get(actor, input.agentId);
    if (!agent) {
      throw new Error(`Hosted agent not found: ${input.agentId}`);
    }

    this.store.db.exec('BEGIN IMMEDIATE');
    try {
    const currentAgent = this.store.get('hosted-agent-agents', agent.id);
    if (!currentAgent || currentAgent.version !== agent.version || currentAgent.ownerId !== agent.ownerId || currentAgent.status !== agent.status) throw new Error('Agent changed while creating proposal');
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const prior = this.store.list('hosted-agent-proposals').find(p => p.creationFingerprint === fingerprint && p.status !== 'ARCHIVED');
    if (prior) { this.store.db.exec('COMMIT'); return prior as HostedAgentProposalRecord; }
    for (const [key, value] of Object.entries(input)) if (typeof value === 'string' && value.length > 4000) throw new Error('Proposal field too long: ' + key);
    if (input.features && (input.features.length > 30 || input.features.some(v => typeof v !== 'string' || v.length > 500))) throw new Error('Invalid proposal features');
    if (agent.type === 'INTERNAL_KNOWLEDGE' || !['DEMO','ACTIVE'].includes(agent.status)) throw new Error('Publish a public agent before creating a proposal');
    if (input.prospectId && !this.store.get('crm_companies', input.prospectId)) throw new Error('CRM company not found');
    for (const amount of [input.quoteMonthlyEur, input.quoteSetupEur]) if (amount != null && (!Number.isFinite(amount) || amount < 0 || amount > 1000000)) throw new Error('Invalid quote amount');
    const id = 'agprop-' + randomUUID();
    const slugBase = input.publicSlug
      ? input.publicSlug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      : `${agent.slug || 'agent'}-proposal-${randomBytes(4).toString('hex')}`;

    const existingSlug = this.store
      .list('hosted-agent-proposals')
      .find((p: any) => p.publicSlug === slugBase);
    const publicSlug = existingSlug ? `${slugBase}-${randomBytes(2).toString('hex')}` : slugBase;

    const record: HostedAgentProposalRecord = {
      id,
      kind: 'HOSTED_AGENT',
      creationFingerprint: fingerprint,
      publicSlug,
      agentId: agent.id,
      agentPublicId: agent.publicId,
      prospectId: input.prospectId || null,
      businessName: input.businessName || agent.businessName,
      industry: input.industry || null,
      contactName: input.contactName || null,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      status: 'READY',
      title: input.title || `Soluție Asistent Virtual AI — ${agent.businessName}`,
      summary:
        input.summary ||
        `Propunere dedicată de asistent autonom pentru ${agent.businessName}, configurat pentru calificare lead-uri, asistență 24/7 și integrare directă pe website.`,
      features: input.features || [
        'Disponibilitate 24/7 fără timp de așteptare',
        'Calificare automată a contactelor și intenției',
        'Răspunsuri factuale bazate strict pe contextul companiei',
        'Integrare facilă prin widget script sau iframe dedicat'
      ],
      recommendedAgentType: agent.type,
      quoteMonthlyEur: input.quoteMonthlyEur ?? null,
      quoteSetupEur: input.quoteSetupEur ?? null,
      quoteTerms: input.quoteTerms || 'Fără perioadă contractuală minimă. Anulare oricând.',
      viewCount: 0,
      firstViewedAt: null,
      lastViewedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerId: agent.ownerId
    };

    this.store.put('hosted-agent-proposals', record);
    this.events.publish('hosted-agent-proposals');

    // Also link to CRM prospect if provided
    if (input.prospectId) {
      try {
        const company = this.store.get('crm_companies', input.prospectId);
        if (company) {
          this.store.put('crm_companies', {
            ...company,
            hostedAgentProposalId: id,
            hostedAgentId: agent.id,
            updatedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        console.error('[hosted-agent-proposal] Failed to link to CRM company:', err);
      }
    }

    this.store.db.exec('COMMIT');
    return record;
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }

  public getProposal(
    actor: { userId: string; role: 'ADMIN' | 'CUSTOMER' },
    id: string
  ): HostedAgentProposalRecord | null {
    const record = this.store.get('hosted-agent-proposals', id) as HostedAgentProposalRecord | undefined;
    if (!record) return null;

    if (actor.role !== 'ADMIN' && record.ownerId !== actor.userId) {
      throw new Error('Access denied to proposal');
    }

    return record;
  }

  public listProposals(
    actor: { userId: string; role: 'ADMIN' | 'CUSTOMER' },
    filter?: { agentId?: string; prospectId?: string }
  ): HostedAgentProposalRecord[] {
    const list = this.store.list('hosted-agent-proposals') as HostedAgentProposalRecord[];
    return list.filter((p) => {
      if (actor.role !== 'ADMIN' && p.ownerId !== actor.userId) return false;
      if (filter?.agentId && p.agentId !== filter.agentId) return false;
      if (filter?.prospectId && p.prospectId !== filter.prospectId) return false;
      return true;
    });
  }

  public getPublicProposal(slug: string): HostedAgentProposalPublicView | null {
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
    const list = this.store.list('hosted-agent-proposals') as HostedAgentProposalRecord[];
    const proposal = list.find((p) => p.publicSlug === slug);
    if (!proposal || !['READY','SENT','VIEWED','ACCEPTED'].includes(proposal.status)) { this.store.db.exec('COMMIT'); return null; }
    const agent = this.store.get('hosted-agent-agents', proposal.agentId);
    if (!agent || agent.type === 'INTERNAL_KNOWLEDGE' || !['DEMO','ACTIVE'].includes(agent.status) || agent.publicId !== proposal.agentPublicId) { this.store.db.exec('COMMIT'); return null; }

    // Track public view
    const now = new Date().toISOString();
    const updated: HostedAgentProposalRecord = {
      ...proposal,
      viewCount: (proposal.viewCount || 0) + 1,
      firstViewedAt: proposal.firstViewedAt || now,
      lastViewedAt: now,
      status: proposal.status === 'READY' || proposal.status === 'SENT' ? 'VIEWED' : proposal.status,
      updatedAt: now
    };
    this.store.put('hosted-agent-proposals', updated);
    this.events.publish('hosted-agent-proposals');

    const result: HostedAgentProposalPublicView = {
      id: proposal.id,
      kind: 'HOSTED_AGENT',
      publicSlug: proposal.publicSlug,
      agentPublicId: proposal.agentPublicId,
      businessName: proposal.businessName,
      industry: proposal.industry,
      status: updated.status,
      title: proposal.title,
      summary: proposal.summary,
      features: proposal.features,
      recommendedAgentType: proposal.recommendedAgentType,
      quoteMonthlyEur: proposal.quoteMonthlyEur,
      quoteSetupEur: proposal.quoteSetupEur,
      quoteTerms: proposal.quoteTerms,
      demoUrl: `/ai/embed/${proposal.agentPublicId}`
    };
    this.store.db.exec('COMMIT');
    return result;
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
}
