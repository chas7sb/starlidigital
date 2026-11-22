import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { HostedAgentService } from '../src/hosted-agents/service.js';
import { createHostedAgentGraphQL, hostedAgentTypeDefs } from '../src/hosted-agents/graphql.js';
import { OpenRouterModelRouter } from '../src/hosted-agents/openrouter.js';
import type { Context } from '../src/security.js';

describe('Hosted Agents - GraphQL Resolvers & Schema Conformance', () => {
  let store: Store;
  let service: HostedAgentService;
  let graphqlModule: ReturnType<typeof createHostedAgentGraphQL>;

  const customerUser = { id: 'usr_cust_1', username: 'alex_cust', role: 'CUSTOMER' };
  const adminUser = { id: 'usr_admin_1', username: 'superadmin', role: 'ADMIN' };

  function makeContext(user: any): Context {
    return {
      store,
      user,
      ip: '127.0.0.1',
      setCookie: () => {}
    } as any;
  }

  beforeEach(() => {
    store = new Store(':memory:');
    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.endsWith('/models')) {
        return new Response(JSON.stringify({
          data: [{ id: 'google/gemma-3-27b-it:free', architecture: {input_modalities:['text'],output_modalities:['text']}, pricing: { prompt: '0', completion: '0' } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        model: 'google/gemma-3-27b-it:free',
        choices: [{ message: { content: 'Răspuns test GraphQL.' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const mockRouter = new OpenRouterModelRouter({
      apiKey: 'test-key',
      fetch: mockFetch as any
    });
    service = new HostedAgentService({ store, router: mockRouter });
    graphqlModule = createHostedAgentGraphQL({ service });
  });

  test('typeDefs are defined and contain expected mutations and queries', () => {
    assert.ok(hostedAgentTypeDefs.includes('enum HostedAgentType'));
    assert.ok(hostedAgentTypeDefs.includes('enum HostedAgentStatus'));
    assert.ok(hostedAgentTypeDefs.includes('type HostedAgent'));
    assert.ok(hostedAgentTypeDefs.includes('type HostedAgentSession'));
    assert.ok(hostedAgentTypeDefs.includes('hostedAgentCreate(input: HostedAgentCreateInput!): HostedAgent!'));
    assert.ok(hostedAgentTypeDefs.includes('hostedAgentSendMessage(publicId: String!, conversationId: ID!, visitorToken: String!, requestId: String!, message: String!): HostedAgentChatResult!'));
  });

  test('executes complete agent management lifecycle via GraphQL resolvers', async () => {
    const custCtx = makeContext(customerUser);
    const adminCtx = makeContext(adminUser);

    // 1. Create agent
    const created = await graphqlModule.resolvers.Mutation.hostedAgentCreate(
      null,
      {
        input: {
          name: 'Solar Bot',
          businessName: 'Helios SRL',
          type: 'SALES',
          instructions: 'Răspunde clar și concis.',
          welcomeMessage: 'Salutare!'
        }
      },
      custCtx
    );

    assert.equal(created.name, 'Solar Bot');
    assert.equal(created.ownerId, customerUser.id);
    assert.equal(created.version, 1);

    // 2. Query single agent
    const queried = await graphqlModule.resolvers.Query.hostedAgent(
      null,
      { id: created.id },
      custCtx
    );
    assert.equal(queried.id, created.id);

    // 3. Update agent
    const updated = await graphqlModule.resolvers.Mutation.hostedAgentUpdate(
      null,
      {
        id: created.id,
        input: { name: 'Solar Bot Pro' },
        expectedVersion: 1
      },
      custCtx
    );
    assert.equal(updated.name, 'Solar Bot Pro');
    assert.equal(updated.version, 2);

    // 4. Set knowledge
    const knowledgeJson = JSON.stringify({ companyDescription: 'Companie de top.' });
    const withKnowledge = await graphqlModule.resolvers.Mutation.hostedAgentSetKnowledge(
      null,
      {
        id: created.id,
        knowledgeJson,
        expectedVersion: 2
      },
      custCtx
    );
    assert.equal(withKnowledge.version, 3);

    // 5. Publish to DEMO
    const published = await graphqlModule.resolvers.Mutation.hostedAgentPublish(
      null,
      {
        id: created.id,
        mode: 'DEMO',
        expectedVersion: 3
      },
      adminCtx
    );
    assert.equal(published.status, 'DEMO');
    assert.equal(published.version, 4);

    // 6. Public config query (no auth required)
    const publicCfg = await graphqlModule.resolvers.Query.hostedAgentPublic(
      null,
      { publicId: published.publicId }
    );
    assert.ok(publicCfg);
    assert.equal(publicCfg.name, 'Solar Bot Pro');
    assert.equal((publicCfg as any).instructions, undefined, 'Public config must not leak instructions');

    // 7. Start visitor conversation via mutation
    const session = await graphqlModule.resolvers.Mutation.hostedAgentStartConversation(
      null,
      { publicId: published.publicId },
      custCtx
    );
    assert.ok(session.conversationId);
    assert.ok(session.visitorToken);

    // 8. Send message via mutation
    const chatResult = await graphqlModule.resolvers.Mutation.hostedAgentSendMessage(
      null,
      {
        publicId: published.publicId,
        conversationId: session.conversationId,
        visitorToken: session.visitorToken,
        requestId: 'req_gql_01',
        message: 'Bună ziua! Mă numesc Mihai, telefon 0799888777, mă interesează panourile.'
      },
      custCtx
    );
    assert.equal(chatResult.conversationId, session.conversationId);
    assert.equal(chatResult.message.role, 'assistant');
    assert.equal(chatResult.capturedLead, true);

    // 9. Query conversations and leads as owner
    const convPage = await graphqlModule.resolvers.Query.hostedAgentConversations(
      null,
      { agentId: published.id },
      custCtx
    );
    assert.equal(convPage.total, 1);

    const leadsPage = await graphqlModule.resolvers.Query.hostedAgentLeads(
      null,
      { agentId: published.id },
      custCtx
    );
    assert.equal(leadsPage.total, 1);
    assert.equal(leadsPage.items[0].phone, '0799888777');

    // 10. Query usage stats
    const usage = await graphqlModule.resolvers.Query.hostedAgentUsage(
      null,
      { agentId: published.id },
      custCtx
    );
    assert.ok(usage.conversations >= 1);
    assert.ok(usage.messages >= 2);
    assert.ok(usage.capturedLeads >= 1);

    // 11. Disable agent via mutation
    const disabled = await graphqlModule.resolvers.Mutation.hostedAgentDisable(
      null,
      { id: published.id, expectedVersion: 4 },
      custCtx
    );
    assert.equal(disabled.status, 'DISABLED');
    assert.equal(disabled.version, 5);
  });
});
