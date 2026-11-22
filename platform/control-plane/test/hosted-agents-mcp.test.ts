import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../server/src/store.js';
import { Events } from '../../server/src/events.js';
import { registerHostedAgentTools } from '../src/tools/hosted-agents.js';
import type { ToolContext } from '../src/tools/common.js';
import type { HostedAgentServiceLike, HostedAgentRecord } from '../../server/src/hosted-agent-integrations/types.js';

class MockAgentService implements HostedAgentServiceLike {
  public agents = new Map<string, HostedAgentRecord>();
  public conversationsList: any[] = [];
  public leadsList: any[] = [];

  async list(actor: any) { return Array.from(this.agents.values()); }
  async get(actor: any, id: string): Promise<HostedAgentRecord> {
    const ag = this.agents.get(id);
    if (!ag) throw new Error(`Agent not found: ${id}`);
    return ag;
  }
  async create(actor: any, input: any) {
    const record: HostedAgentRecord = {
      id: 'ag-mcp-1',
      ownerId: actor.userId,
      publicId: 'pub-mcp-1',
      name: input.name,
      businessName: input.businessName,
      slug: input.slug || 'solar-mcp',
      type: input.type,
      status: 'DRAFT',
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
  async update(actor: any, id: string, input: any, expectedVersion: number) {
    const ag = await this.get(actor, id);
    if (ag.version !== expectedVersion) throw new Error('CONFLICT: Version mismatch');
    const updated = { ...ag, ...input, version: ag.version + 1, updatedAt: new Date().toISOString() };
    this.agents.set(id, updated);
    return updated;
  }
  async setKnowledge(actor: any, id: string, knowledgeJson: string, expectedVersion: number) {
    const ag = await this.get(actor, id);
    if (ag.version !== expectedVersion) throw new Error('CONFLICT: Version mismatch');
    const updated = { ...ag, knowledgeJson, version: ag.version + 1, updatedAt: new Date().toISOString() };
    this.agents.set(id, updated);
    return updated;
  }
  async publish(actor: any, id: string, mode: any, expectedVersion: number) {
    const ag = await this.get(actor, id);
    if (ag.version !== expectedVersion) throw new Error('CONFLICT: Version mismatch');
    const updated = { ...ag, status: mode, version: ag.version + 1, updatedAt: new Date().toISOString() };
    this.agents.set(id, updated);
    return updated;
  }
  async disable(actor: any, id: string, expectedVersion: number) {
    const ag = await this.get(actor, id);
    if (ag.version !== expectedVersion) throw new Error('CONFLICT: Version mismatch');
    const updated = { ...ag, status: 'DISABLED' as const, version: ag.version + 1, updatedAt: new Date().toISOString() };
    this.agents.set(id, updated);
    return updated;
  }
  async assignOwner(actor: any, id: string, ownerId: string, expectedVersion: number) {
    const ag = await this.get(actor, id);
    if (ag.version !== expectedVersion) throw new Error('CONFLICT: Version mismatch');
    const updated = { ...ag, ownerId, version: ag.version + 1, updatedAt: new Date().toISOString() };
    this.agents.set(id, updated);
    return updated;
  }
  async conversations(actor: any, agentId: string) {
    return { items: this.conversationsList, total: this.conversationsList.length };
  }
  async leads(actor: any, agentId: string) {
    return { items: this.leadsList, total: this.leadsList.length };
  }
  async usage(actor: any, agentId: string) {
    return { conversations: 1, messages: 2, capturedLeads: 1, qualifiedLeads: 1, modelCalls: 2, failures: 0 };
  }
  async publicConfig(q: any) { return null; }
  async startConversation(a: any) { return { conversationId: 'c1', visitorToken: 't1', welcomeMessage: 'hi' }; }
  async chat(a: any) { return { conversationId: 'c1', message: { id: 'm1', conversationId: 'c1', role: 'assistant' as const, content: 'hi', createdAt: '' }, capturedLead: false }; }
}

function createMockToolServer() {
  const tools = new Map<string, { description: string; schema: any; handler: Function }>();
  return {
    tool: (name: string, description: string, schema: any, handler: Function) => {
      tools.set(name, { description, schema, handler });
    },
    tools
  };
}

test('MCP hosted-agents: registers narrow agent_* tool suite with strict scopes and audit', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const mockServer = createMockToolServer();
  const mockAgentService = new MockAgentService();

  const auditEvents: any[] = [];
  const ctx: ToolContext = {
    server: mockServer as any,
    principal: { id: 'admin-1', role: 'admin', scopes: ['read', 'write'] } as any,
    auditSink: { record: (evt: any) => auditEvents.push(evt) } as any,
    store,
    events,
    workspaceRoot: process.cwd(),
    auditCall: (tool, target, start, status, args, result, err) => {
      auditEvents.push({ tool, target, status, args, result, err });
    }
  };
  (ctx as any).hostedAgentService = mockAgentService;

  registerHostedAgentTools(ctx);

  const expectedTools = [
    'agent_create',
    'agent_get',
    'agent_update',
    'agent_add_knowledge',
    'agent_configure',
    'agent_create_demo',
    'agent_create_proposal',
    'agent_publish',
    'agent_list_conversations',
    'agent_list_customer_leads',
    'agent_disable',
    'agent_assign_owner'
  ];

  for (const toolName of expectedTools) {
    assert.ok(mockServer.tools.has(toolName), `Missing expected MCP tool: ${toolName}`);
  }

  // 1. Execute agent_create
  const createTool = mockServer.tools.get('agent_create')!;
  const createRes = await createTool.handler({
    name: 'Cosmin Solar',
    businessName: 'Solar Systems SRL',
    type: 'SALES',
    instructions: 'Ești un consultant specializat.'
  });

  assert.equal(createRes.isError, undefined);
  const createdData = JSON.parse(createRes.content[0].text);
  assert.equal(createdData.name, 'Cosmin Solar');
  assert.equal(createdData.businessName, 'Solar Systems SRL');
  assert.equal(createdData.version, 1);

  // 2. Execute agent_create_demo
  const demoTool = mockServer.tools.get('agent_create_demo')!;
  const demoRes = await demoTool.handler({
    id: createdData.id,
    expectedVersion: 1
  });
  assert.equal(demoRes.isError, undefined);
  const demoData = JSON.parse(demoRes.content[0].text);
  assert.equal(demoData.agent.status, 'DEMO');
  assert.ok(demoData.demoUrl.startsWith('/ai/demo/'));

  // Proposal visibility checks use the shared durable agent record, not the mock map.
  store.put('hosted-agent-agents', demoData.agent);

  // 3. Execute agent_create_proposal
  const proposalTool = mockServer.tools.get('agent_create_proposal')!;
  const propRes = await proposalTool.handler({
    agentId: createdData.id,
    title: 'Propunere Solar Systems',
    quoteMonthlyEur: 149
  });
  assert.equal(propRes.isError, undefined);
  const propData = JSON.parse(propRes.content[0].text);
  assert.equal(propData.proposal.recommendedAgentType, 'SALES');
  assert.ok(propData.proposalUrl.startsWith('/ai/proposal/'));

  // 4. Concurrency conflict on stale version
  const updateTool = mockServer.tools.get('agent_update')!;
  const staleRes = await updateTool.handler({
    id: createdData.id,
    expectedVersion: 1, // Currently version 2 after demo publish
    businessName: 'Updated Name'
  });
  assert.equal(staleRes.isError, true);
  assert.ok(staleRes.content[0].text.includes('CONFLICT'));

  // 5. Test permission denial for unprivileged user
  const unprivCtx: ToolContext = {
    ...ctx,
    principal: { id: 'cust-1', role: 'customer', scopes: ['read'] } as any
  };
  const unprivServer = createMockToolServer();
  unprivCtx.server = unprivServer as any;
  registerHostedAgentTools(unprivCtx);

  const deniedRes = await unprivServer.tools.get('agent_create')!.handler({
    name: 'Hacker Agent',
    businessName: 'Evil Corp',
    type: 'SALES'
  });
  assert.equal(deniedRes.isError, true);
  assert.ok(deniedRes.content[0].text.includes('Access denied'));
});
