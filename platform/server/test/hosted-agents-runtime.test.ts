import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { HostedAgentService, COLLECTIONS } from '../src/hosted-agents/service.js';
import { OpenRouterModelRouter, PREFERRED_FREE_MODELS } from '../src/hosted-agents/openrouter.js';
import type { Actor } from '../src/hosted-agents/types.js';

describe('Hosted Agents - OpenRouter Model Router & Runtime Execution', () => {
  let store: Store;
  const customerA: Actor = { userId: 'cust_solar', role: 'CUSTOMER', principal: 'cust_solar' };

  beforeEach(() => {
    store = new Store(':memory:');
  });

  test('OpenRouterModelRouter respects preferred pool order and fails over on 429 rate limit', async () => {
    const callLog: string[] = [];

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);

      if (urlStr.endsWith('/models')) {
        return new Response(JSON.stringify({
          data: PREFERRED_FREE_MODELS.map(id => ({
            id,
            architecture: {input_modalities:['text'],output_modalities:['text']}, pricing: { prompt: '0', completion: '0' }
          }))
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (urlStr.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body || '{}'));
        callLog.push(body.model);

        // First candidate model (google/gemma-3-27b-it:free) simulates rate limit 429
        if (body.model === PREFERRED_FREE_MODELS[0]) {
          return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Second candidate model (google/gemma-3-12b-it:free) succeeds
        if (body.model === PREFERRED_FREE_MODELS[1]) {
          return new Response(JSON.stringify({
            model: body.model,
            choices: [{ message: { content: 'Salut! Sistemul de 5kW costă 4500 EUR.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 50, completion_tokens: 15, total_tokens: 65 }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }

      return new Response('Not found', { status: 404 });
    };

    const router = new OpenRouterModelRouter({
      apiKey: 'test-openrouter-key',
      fetch: mockFetch as any
    });

    const result = await router.complete({
      messages: [{ role: 'user', content: 'Cât costă sistemul solar de 5kW?' }]
    });

    assert.equal(result.model, PREFERRED_FREE_MODELS[1]);
    assert.equal(result.reply, 'Salut! Sistemul de 5kW costă 4500 EUR.');
    assert.deepEqual(callLog, [PREFERRED_FREE_MODELS[0], PREFERRED_FREE_MODELS[1]]);
  });

  function makeMockFetch(reply = 'Răspuns test.') {
    return async (url: string | URL | Request): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.endsWith('/models')) {
        return new Response(JSON.stringify({
          data: PREFERRED_FREE_MODELS.map(id => ({
            id,
            architecture: {input_modalities:['text'],output_modalities:['text']}, pricing: { prompt: '0', completion: '0' }
          }))
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        model: PREFERRED_FREE_MODELS[0],
        choices: [{ message: { content: reply }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }

  test('visitor session creation, capability token hashing, and tamper protection', async () => {
    const mockRouter = new OpenRouterModelRouter({
      apiKey: 'test-key',
      fetch: makeMockFetch('Cu siguranță, te pot ajuta cu oferta.') as any
    });

    const service = new HostedAgentService({
      store,
      router: mockRouter
    });

    // Create & publish agent as DEMO
    const agent = await service.create(customerA, {
      name: 'Solar Assistant',
      businessName: 'Helios SRL',
      type: 'SALES',
      welcomeMessage: 'Bun venit la Helios!'
    });
    await service.publish({userId: 'admin_1', role: 'ADMIN'}, agent.id, 'DEMO', 1);

    // 1. Visitor starts conversation
    const session = await service.startConversation({
      publicId: agent.publicId,
      ip: '192.168.1.1'
    });

    assert.ok(session.conversationId);
    assert.ok(session.visitorToken);
    assert.equal(session.welcomeMessage, 'Bun venit la Helios!');

    // Verify token is NOT stored in plain text in database
    const convRaw = store.get(COLLECTIONS.CONVERSATIONS, session.conversationId);
    assert.ok(convRaw);
    assert.notEqual(convRaw.visitorTokenHash, session.visitorToken);
    assert.equal(typeof convRaw.visitorTokenHash, 'string');
    assert.equal(convRaw.visitorTokenHash.length, 64); // SHA-256 hex length

    // 2. Chat with valid token succeeds
    const chatResult = await service.chat({
      publicId: agent.publicId,
      conversationId: session.conversationId,
      visitorToken: session.visitorToken,
      requestId: 'req_001',
      message: 'Bună ziua, aș dori o ofertă pentru casă.'
    });

    assert.equal(chatResult.conversationId, session.conversationId);
    assert.equal(chatResult.message.role, 'assistant');
    assert.equal(chatResult.message.content, 'Cu siguranță, te pot ajuta cu oferta.');

    // 3. Chat with forged/tampered token is rejected
    await assert.rejects(
      async () => service.chat({
        publicId: agent.publicId,
        conversationId: session.conversationId,
        visitorToken: 'forged_visitor_token_1234567890abcdef',
        requestId: 'req_002',
        message: 'Tentativă neautorizată'
      }),
      /Unauthorized visitor token/
    );
  });

  test('structured lead capture from visitor evidence and idempotency', async () => {
    const mockRouter = new OpenRouterModelRouter({
      apiKey: 'test-key',
      fetch: makeMockFetch('Mulțumesc Andrei, colegul nostru te va suna la 0722111222!') as any
    });

    const service = new HostedAgentService({
      store,
      router: mockRouter
    });

    const agent = await service.create(customerA, {
      name: 'Lead Bot',
      businessName: 'Helios SRL',
      type: 'LEAD_QUALIFICATION'
    });
    await service.publish({userId: 'admin_1', role: 'ADMIN'}, agent.id, 'ACTIVE', 1);

    const session = await service.startConversation({ publicId: agent.publicId });

    // Visitor provides contact details in Romanian
    const chatResult = await service.chat({
      publicId: agent.publicId,
      conversationId: session.conversationId,
      visitorToken: session.visitorToken,
      requestId: 'req_lead_turn_1',
      message: 'Mă numesc Andrei Ionescu, email andrei@gmail.com, telefon 0722111222, vreau un sistem solar 5kW cu buget 4500 EUR urgent.'
    });

    assert.equal(chatResult.capturedLead, true);

    // Verify lead record in separate hosted-agent-leads collection
    const leadRaw = store.get(COLLECTIONS.LEADS, session.conversationId);
    assert.ok(leadRaw, 'Lead record must be persisted in hosted-agent-leads');
    assert.equal(leadRaw.agentId, agent.id);
    assert.equal(leadRaw.name, 'Andrei Ionescu');
    assert.equal(leadRaw.email, 'andrei@gmail.com');
    assert.equal(leadRaw.phone, '0722111222');
    assert.equal(leadRaw.budget, '4500 EUR');
    assert.equal(leadRaw.timeframe, 'urgent');
    assert.ok(leadRaw.score >= 70, 'Qualified lead score should be high');

    // Verify owner queries leads
    const leadsPage = await service.leads(customerA, agent.id);
    assert.equal(leadsPage.total, 1);
    assert.equal(leadsPage.items[0].email, 'andrei@gmail.com');

    // Idempotency: replaying same requestId returns cached result without extra processing
    const replayResult = await service.chat({
      publicId: agent.publicId,
      conversationId: session.conversationId,
      visitorToken: session.visitorToken,
      requestId: 'req_lead_turn_1',
      message: 'Mă numesc Andrei Ionescu, email andrei@gmail.com, telefon 0722111222, vreau un sistem solar 5kW cu buget 4500 EUR urgent.'
    });

    assert.equal(replayResult.message.content, chatResult.message.content);

    // Security release blocker verification:
    // Attacker sends the same requestId with a forged or wrong visitorToken -> MUST be rejected, never return cache!
    await assert.rejects(
      async () => service.chat({
        publicId: agent.publicId,
        conversationId: session.conversationId,
        visitorToken: 'stolen_or_wrong_token_123456789',
        requestId: 'req_lead_turn_1',
        message: 'Any message'
      }),
      /Unauthorized visitor token/
    );
  });

  test('durable quota controls enforce IP rate limits and session bounds', async () => {
    let mockTime = 1700000000000;
    const service = new HostedAgentService({
      store,
      clock: () => mockTime
    });

    const agent = await service.create(customerA, {
      name: 'Quota Test Bot',
      businessName: 'Limits SRL',
      type: 'SALES'
    });
    await service.publish({userId: 'admin_1', role: 'ADMIN'}, agent.id, 'DEMO', 1);

    // IP rate limit on startConversation (max 30 per hour)
    const testIp = '198.51.100.42';
    for (let i = 0; i < 30; i++) {
      await service.startConversation({ publicId: agent.publicId, ip: testIp });
    }

    // 31st conversation from same IP in same hour window is blocked
    await assert.rejects(
      async () => service.startConversation({ publicId: agent.publicId, ip: testIp }),
      /Too many conversations from this IP address/
    );

    // Advance clock past 1 hour -> should succeed again
    mockTime += 3600001;
    const freshSession = await service.startConversation({ publicId: agent.publicId, ip: testIp });
    assert.ok(freshSession.conversationId);
  });

  test('disabling agent immediately blocks public config, session start and chat', async () => {
    const service = new HostedAgentService({ store });

    const agent = await service.create(customerA, {
      name: 'To Be Disabled',
      businessName: 'Temp SRL',
      type: 'SUPPORT'
    });

    await service.publish({userId: 'admin_1', role: 'ADMIN'}, agent.id, 'DEMO', 1);

    const publicCfgBefore = await service.publicConfig({ publicId: agent.publicId });
    assert.ok(publicCfgBefore);

    const session = await service.startConversation({ publicId: agent.publicId });
    assert.ok(session.conversationId);

    // Now disable agent
    await service.disable(customerA, agent.id, 2);

    // Public config returns null
    const publicCfgAfter = await service.publicConfig({ publicId: agent.publicId });
    assert.equal(publicCfgAfter, null);

    // Starting new conversation fails
    await assert.rejects(
      async () => service.startConversation({ publicId: agent.publicId }),
      /not currently accepting conversations/
    );

    // Chat on existing session fails
    await assert.rejects(
      async () => service.chat({
        publicId: agent.publicId,
        conversationId: session.conversationId,
        visitorToken: session.visitorToken,
        requestId: 'req_post_disable',
        message: 'Hello?'
      }),
      /Agent not found or currently inactive/
    );
  });
});
