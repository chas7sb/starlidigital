import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { HostedAgentProposalService } from '../src/hosted-agent-integrations/proposals.js';
import type { HostedAgentServiceLike, HostedAgentRecord } from '../src/hosted-agent-integrations/types.js';

class MockHostedAgentService implements HostedAgentServiceLike {
  public agents: Map<string, HostedAgentRecord> = new Map();

  async list(actor: any) {
    return Array.from(this.agents.values());
  }
  async get(actor: any, id: string): Promise<HostedAgentRecord> {
    const ag = this.agents.get(id);
    if (!ag) throw new Error(`Agent not found: ${id}`);
    if (actor.role !== 'ADMIN' && ag.ownerId !== actor.userId) {
      throw new Error('Access denied to agent');
    }
    return ag;
  }
  async create(actor: any, input: any) {
    const record: HostedAgentRecord = {
      id: 'ag-' + Date.now(),
      ownerId: actor.userId,
      publicId: 'pub-' + Date.now(),
      name: input.name,
      businessName: input.businessName,
      slug: input.slug || 'slug-test',
      type: input.type,
      status: 'DEMO',
      instructions: input.instructions || '',
      welcomeMessage: input.welcomeMessage || '',
      businessContext: input.businessContext || '',
      knowledgeJson: input.knowledgeJson || '[]',
      appearanceJson: '{}',
      deploymentJson: '{}',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.agents.set(record.id, record);
    return record;
  }
  async update(actor: any, id: string, input: any, expectedVersion: number): Promise<HostedAgentRecord> {
    const ag = await this.get(actor, id);
    return { ...ag, ...input, version: expectedVersion + 1 };
  }
  async setKnowledge(actor: any, id: string, knowledgeJson: string, expectedVersion: number): Promise<HostedAgentRecord> {
    const ag = await this.get(actor, id);
    return { ...ag, knowledgeJson, version: expectedVersion + 1 };
  }
  async publish(actor: any, id: string, mode: any, expectedVersion: number): Promise<HostedAgentRecord> {
    const ag = await this.get(actor, id);
    return { ...ag, status: mode, version: expectedVersion + 1 };
  }
  async disable(actor: any, id: string, expectedVersion: number): Promise<HostedAgentRecord> {
    const ag = await this.get(actor, id);
    return { ...ag, status: 'DISABLED', version: expectedVersion + 1 };
  }
  async assignOwner(actor: any, id: string, ownerId: string, expectedVersion: number): Promise<HostedAgentRecord> {
    const ag = await this.get(actor, id);
    return { ...ag, ownerId, version: expectedVersion + 1 };
  }
  async conversations() { return { items: [], total: 0 }; }
  async leads() { return { items: [], total: 0 }; }
  async usage() { return { conversations: 0, messages: 0, capturedLeads: 0, qualifiedLeads: 0, modelCalls: 0, failures: 0 }; }
  async publicConfig() { return null; }
  async startConversation() { return { conversationId: 'c1', visitorToken: 'vt1', welcomeMessage: 'hi' }; }
  async chat() { return { conversationId: 'c1', message: { id: 'm1', conversationId: 'c1', role: 'assistant' as const, content: 'reply', createdAt: '' }, capturedLead: false }; }
}

test('hosted-agent proposal: creates proposal linked to agent and prospect without fake website builds', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const mockAgentService = new MockHostedAgentService();

  const agent = await mockAgentService.create(
    { userId: 'admin-1', role: 'ADMIN' },
    { name: 'Andrei AI', businessName: 'Solar Tech SRL', type: 'SALES', slug: 'solar-tech' }
  );

  store.put('hosted-agent-agents', agent);
  store.put('crm_companies', {id:'crm-prospect-123', name:'Solar Tech'});
  const proposalService = new HostedAgentProposalService(store, events, mockAgentService);

  const proposal = await proposalService.createProposal(
    { userId: 'admin-1', role: 'ADMIN' },
    {
      agentId: agent.id,
      prospectId: 'crm-prospect-123',
      businessName: 'Solar Tech SRL',
      title: 'Propunere Agent Inteligent Vânzări',
      quoteMonthlyEur: 199,
      quoteSetupEur: 0
    }
  );

  assert.equal(proposal.kind, 'HOSTED_AGENT');
  assert.equal(proposal.agentId, agent.id);
  assert.equal(proposal.agentPublicId, agent.publicId);
  assert.equal(proposal.prospectId, 'crm-prospect-123');
  assert.equal(proposal.quoteMonthlyEur, 199);
  assert.equal(proposal.quoteSetupEur, 0);
  assert.ok(proposal.publicSlug.includes('solar-tech'));

  // Test public view access
  const publicView = proposalService.getPublicProposal(proposal.publicSlug);
  assert.ok(publicView);
  assert.equal(publicView.title, 'Propunere Agent Inteligent Vânzări');
  assert.equal(publicView.demoUrl, `/ai/embed/${agent.publicId}`);
  assert.equal(publicView.quoteMonthlyEur, 199);

  // Check view count increment
  const updatedProposal = proposalService.getProposal({ userId: 'admin-1', role: 'ADMIN' }, proposal.id);
  assert.equal(updatedProposal?.viewCount, 1);
  assert.equal(updatedProposal?.status, 'VIEWED');
});

test('hosted-agent proposal security: customer cannot create proposals or access cross-tenant proposals', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const mockAgentService = new MockHostedAgentService();

  const agent = await mockAgentService.create(
    { userId: 'admin-1', role: 'ADMIN' },
    { name: 'Agent Support', businessName: 'Support Co', type: 'SUPPORT' }
  );

  store.put('hosted-agent-agents', agent);
  store.put('crm_companies', {id:'crm-prospect-123', name:'Solar Tech'});
  const proposalService = new HostedAgentProposalService(store, events, mockAgentService);

  // 1. Non-admin customer cannot create proposal
  await assert.rejects(
    async () => {
      await proposalService.createProposal(
        { userId: 'cust-1', role: 'CUSTOMER' },
        { agentId: agent.id }
      );
    },
    /Access denied: only admins can create hosted agent proposals/
  );

  // 2. Admin creates proposal
  const prop = await proposalService.createProposal(
    { userId: 'admin-1', role: 'ADMIN' },
    { agentId: agent.id }
  );

  // 3. Different customer cannot get proposal directly by ID
  assert.throws(
    () => {
      proposalService.getProposal({ userId: 'cust-2', role: 'CUSTOMER' }, prop.id);
    },
    /Access denied to proposal/
  );

  // 4. Admin can get proposal
  const adminGet = proposalService.getProposal({ userId: 'admin-1', role: 'ADMIN' }, prop.id);
  assert.ok(adminGet);
});
