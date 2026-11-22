import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import {
  ToolRegistry,
  defaultToolRegistry,
  toOpenAITools,
  toOpenAIFunction,
  dateTimeTool,
  calculatorTool,
  contactValidatorTool,
  referenceIdTool,
  calculateToolMetrics,
  type AgentTool,
  type AgentToolContext
} from '../src/hosted-agents/tools/index.js';
import { HostedAgentService, COLLECTIONS } from '../src/hosted-agents/service.js';
import { OpenRouterModelRouter } from '../src/hosted-agents/openrouter.js';

const mockContext: AgentToolContext = {
  agentId: 'agent-123',
  conversationId: 'conv-456',
  visitorToken: 'token-abc',
  requestId: 'req-789',
  tenantId: 'user-001'
};

// ==========================================
// 1. Tool Registry & Schema Validation Tests
// ==========================================

test('ToolRegistry: registers valid tools and rejects duplicates or invalid IDs', () => {
  const registry = new ToolRegistry();

  const customTool: AgentTool = {
    id: 'test_tool',
    name: 'Test Tool',
    description: 'A test tool',
    category: 'UTILITY',
    permissionLevel: 'READ_ONLY',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query']
    },
    execute: async (input) => ({ success: true, data: { echoed: input.query } })
  };

  registry.register(customTool);
  assert.equal(registry.has('test_tool'), true);
  assert.equal(registry.get('test_tool')?.name, 'Test Tool');

  // Duplicate ID rejected
  assert.throws(() => registry.register(customTool), /already registered/);

  // Invalid ID rejected
  assert.throws(() => {
    registry.register({ ...customTool, id: 'bad tool id with spaces' });
  }, /Invalid tool ID/);

  // Missing description rejected
  assert.throws(() => {
    registry.register({ ...customTool, id: 'tool_no_desc', description: '' });
  }, /missing description/);

  // Filter list by category and permissionLevel
  const utils = registry.list({ category: 'UTILITY' });
  assert.equal(utils.length, 1);
  const crm = registry.list({ category: 'CRM' });
  assert.equal(crm.length, 0);

  // Unregister
  assert.equal(registry.unregister('test_tool'), true);
  assert.equal(registry.has('test_tool'), false);
});

test('ToolRegistry: validates input against schema and enforces required fields and types', async () => {
  const registry = new ToolRegistry();
  const tool: AgentTool = {
    id: 'type_tester',
    name: 'Type Tester',
    description: 'Validates types',
    category: 'CUSTOM',
    permissionLevel: 'AUTO_EXECUTE',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number', minimum: 1, maximum: 10 },
        mode: { type: 'string', enum: ['fast', 'slow'] }
      },
      required: ['name', 'count']
    },
    execute: async (input) => ({ success: true, data: input })
  };

  registry.register(tool);

  // Missing required field
  const missing = await registry.execute('type_tester', { name: 'Alice' }, mockContext);
  assert.equal(missing.success, false);
  assert.match(missing.error || '', /Missing required field: "count"/);

  // Wrong type (string instead of number)
  const wrongType = await registry.execute('type_tester', { name: 'Alice', count: 'five' }, mockContext);
  assert.equal(wrongType.success, false);
  assert.match(wrongType.error || '', /must be a valid number/);

  // Enum violation
  const enumViolated = await registry.execute('type_tester', { name: 'Alice', count: 5, mode: 'turbo' }, mockContext);
  assert.equal(enumViolated.success, false);
  assert.match(enumViolated.error || '', /must be one of: fast, slow/);

  // Range violation
  const outOfBounds = await registry.execute('type_tester', { name: 'Alice', count: 99 }, mockContext);
  assert.equal(outOfBounds.success, false);
  assert.match(outOfBounds.error || '', /must be at most 10/);

  // Valid execution
  const valid = await registry.execute('type_tester', { name: 'Alice', count: 5, mode: 'fast' }, mockContext);
  assert.equal(valid.success, true);
  assert.deepEqual(valid.data, { name: 'Alice', count: 5, mode: 'fast' });
});

// ==========================================
// 2. Universal Tool: get_current_datetime
// ==========================================

test('dateTimeTool: formats date/time across timezones and rejects invalid identifiers', async () => {
  // Default Europe/Bucharest
  const resDefault = await dateTimeTool.execute({}, mockContext);
  assert.equal(resDefault.success, true);
  assert.equal(resDefault.data.timezone, 'Europe/Bucharest');
  assert.ok(resDefault.data.formatted.length > 5);

  // UTC iso format
  const resUtc = await dateTimeTool.execute({ timezone: 'UTC', format: 'iso' }, mockContext);
  assert.equal(resUtc.success, true);
  assert.equal(resUtc.data.timezone, 'UTC');
  assert.match(resUtc.data.formatted, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

  // Date only format
  const resDate = await dateTimeTool.execute({ timezone: 'America/New_York', format: 'date' }, mockContext);
  assert.equal(resDate.success, true);
  assert.match(resDate.data.formatted, /^\d{4}-\d{2}-\d{2}$/);

  // Time only format
  const resTime = await dateTimeTool.execute({ timezone: 'Europe/London', format: 'time' }, mockContext);
  assert.equal(resTime.success, true);
  assert.match(resTime.data.formatted, /^\d{2}:\d{2}:\d{2}$/);

  // Invalid timezone returns error without crashing
  const resInvalid = await dateTimeTool.execute({ timezone: 'Mars/Phobos' }, mockContext);
  assert.equal(resInvalid.success, false);
  assert.match(resInvalid.error || '', /Invalid IANA timezone/);
});

// ==========================================
// 3. Universal Tool: calculator
// ==========================================

test('calculatorTool: evaluates safe arithmetic, precedence, parentheses, and math functions without eval', async () => {
  const calc = async (expr: string) => {
    const res = await calculatorTool.execute({ expression: expr }, mockContext);
    if (!res.success) throw new Error(res.error);
    return res.data.result;
  };

  // Precedence
  assert.equal(await calc('2 + 3 * 4'), 14);
  assert.equal(await calc('(2 + 3) * 4'), 20);

  // Decimals & negative numbers
  assert.equal(await calc('150 * 1.19'), 178.5);
  assert.equal(await calc('-10 + 25'), 15);
  assert.equal(await calc('-(5 + 3) * 2'), -16);

  // Exponentiation & modulo
  assert.equal(await calc('2 ^ 3'), 8);
  assert.equal(await calc('10 % 3'), 1);
  assert.equal(await calc('2 ^ 3 ^ 2'), 512); // right-associative

  // Functions
  assert.equal(await calc('sqrt(144)'), 12);
  assert.equal(await calc('abs(-50) + 10'), 60);
  assert.equal(await calc('round(12.7)'), 13);
  assert.equal(await calc('floor(12.7)'), 12);
  assert.equal(await calc('ceil(12.1)'), 13);
  assert.equal(await calc('min(15, 3, 9)'), 3);
  assert.equal(await calc('max(15, 3, 9)'), 15);

  // Constants
  assert.equal(Math.round(await calc('pi * 2')), Math.round(Math.PI * 2));

  // Division by zero handled gracefully
  const divZero = await calculatorTool.execute({ expression: '100 / 0' }, mockContext);
  assert.equal(divZero.success, false);
  assert.match(divZero.error || '', /Division by zero/);

  // Modulo by zero handled gracefully
  const modZero = await calculatorTool.execute({ expression: '100 % 0' }, mockContext);
  assert.equal(modZero.success, false);
  assert.match(modZero.error || '', /Modulo by zero/);

  // Injection / arbitrary identifier attempts rejected
  for (const malicious of [
    'eval("1+1")',
    'Function("return 1")()',
    'constructor.prototype',
    '__proto__',
    'process.exit(1)',
    'require("fs")',
    'window.alert(1)'
  ]) {
    const maliciousAttempt = await calculatorTool.execute({ expression: malicious }, mockContext);
    assert.equal(maliciousAttempt.success, false);
    assert.match(maliciousAttempt.error || '', /Calculation error|Unsupported identifier|Invalid/);
  }
});

// ==========================================
// 4. Universal Tool: validate_contact_information
// ==========================================

test('contactValidatorTool: validates email and normalizes Romanian/international phone numbers', async () => {
  // Valid Romanian contact
  const resRo = await contactValidatorTool.execute({
    email: 'contact@starlidigital.ro',
    phone: '0721234567'
  }, mockContext);
  assert.equal(resRo.success, true);
  assert.equal(resRo.data.valid, true);
  assert.equal(resRo.data.email.valid, true);
  assert.equal(resRo.data.email.normalized, 'contact@starlidigital.ro');
  assert.equal(resRo.data.phone.valid, true);
  assert.equal(resRo.data.phone.e164, '+40721234567');
  assert.equal(resRo.data.phone.formatted, '+40 721 234 567');
  assert.equal(resRo.data.phone.country, 'RO');

  // Romanian phone with international prefix
  const resRoInt = await contactValidatorTool.execute({
    phone: '+40 722 345 678'
  }, mockContext);
  assert.equal(resRoInt.data.phone.valid, true);
  assert.equal(resRoInt.data.phone.e164, '+40722345678');

  // Invalid email
  const resBadEmail = await contactValidatorTool.execute({
    email: 'not-an-email@'
  }, mockContext);
  assert.equal(resBadEmail.data.valid, false);
  assert.equal(resBadEmail.data.email.valid, false);

  // North American phone
  const resUs = await contactValidatorTool.execute({
    phone: '415 555 2671',
    countryCode: 'US'
  }, mockContext);
  assert.equal(resUs.data.phone.valid, true);
  assert.equal(resUs.data.phone.e164, '+14155552671');
});

// ==========================================
// 5. Universal Tool: generate_reference_id
// ==========================================

test('referenceIdTool: generates secure, unique reference IDs with prefixes and bounded lengths', async () => {
  const res1 = await referenceIdTool.execute({ prefix: 'STARLI', length: 8 }, mockContext);
  assert.equal(res1.success, true);
  assert.match(res1.data.referenceId, /^STARLI-[A-Z0-9]{8}$/);

  // Different runs produce different IDs
  const res2 = await referenceIdTool.execute({ prefix: 'STARLI', length: 8 }, mockContext);
  assert.notEqual(res1.data.referenceId, res2.data.referenceId);

  // Numeric style
  const resNum = await referenceIdTool.execute({ prefix: 'TICK', type: 'numeric', length: 6 }, mockContext);
  assert.match(resNum.data.referenceId, /^TICK-\d{6}$/);

  // Hex style
  const resHex = await referenceIdTool.execute({ prefix: 'HEX', type: 'hex', length: 10 }, mockContext);
  assert.match(resHex.data.referenceId, /^HEX-[0-9A-F]{10}$/);
});

// ==========================================
// 6. Provider Adapter
// ==========================================

test('toOpenAITools: converts internal tools into standard OpenAI function calling format', () => {
  const tools = [dateTimeTool, calculatorTool];
  const openAITools = toOpenAITools(tools);

  assert.equal(openAITools.length, 2);
  assert.equal(openAITools[0].type, 'function');
  assert.equal(openAITools[0].function.name, 'get_current_datetime');
  assert.equal(openAITools[0].function.parameters.type, 'object');
  assert.ok(openAITools[0].function.parameters.properties.timezone);

  assert.equal(openAITools[1].function.name, 'calculator');
  assert.deepEqual(openAITools[1].function.parameters.required, ['expression']);
});

// ==========================================
// 7. HostedAgentService Multi-Turn Tool Execution Loop & Auditing
// ==========================================

test('HostedAgentService: executes multi-turn tool calling, records audit trace, and protects visitor response', async () => {
  const store = new Store(':memory:');

  // Seed user
  const owner = store.saveUser({
    id: 'usr_admin',
    username: 'admin',
    role: 'ADMIN',
    disabled: false
  });

  let callCount = 0;
  const mockRouter = new OpenRouterModelRouter({
    apiKey: 'mock-key',
    clock: () => 1000,
    fetch: async (url: any, init: any) => {
      const u = String(url);
      if (u.endsWith('/models')) {
        return Response.json({
          data: [{
            id: 'mock/chat:free',
            pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            endpoints: ['/api/v1/chat/completions']
          }]
        });
      }

      callCount++;
      const body = JSON.parse(init.body);

      // Turn 1: Model calls the calculator tool
      if (callCount === 1) {
        return Response.json({
          model: 'mock/chat:free',
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_calc_01',
                type: 'function',
                function: {
                  name: 'calculator',
                  arguments: JSON.stringify({ expression: '450 * 1.19' })
                }
              }]
            },
            finish_reason: 'tool_calls'
          }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
        });
      }

      // Turn 2: Model receives tool result and produces final answer
      return Response.json({
        model: 'mock/chat:free',
        choices: [{
          message: {
            role: 'assistant',
            content: 'The total price including VAT is 535.50 RON.'
          },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 80, completion_tokens: 15, total_tokens: 95 }
      });
    }
  });

  const service = new HostedAgentService({
    store,
    router: mockRouter,
    clock: () => 1000
  });

  // Create an active agent
  const agent = await service.create({ userId: owner.id, role: 'ADMIN' }, {
    name: 'Sales Bot',
    businessName: 'Starli Demo',
    type: 'SALES'
  });
  await service.publish({ userId: owner.id, role: 'ADMIN' }, agent.id, 'ACTIVE', 1);

  // Start conversation
  const session = await service.startConversation({ publicId: agent.publicId });

  // Visitor chats: asks for price calculation
  const chatResult = await service.chat({
    publicId: agent.publicId,
    conversationId: session.conversationId,
    visitorToken: session.visitorToken,
    requestId: 'req_001',
    message: 'Can you calculate the total for 450 with 19% VAT?'
  });

  // Verify visitor received final clean text response, NOT raw JSON
  assert.equal(chatResult.message.role, 'assistant');
  assert.equal(chatResult.message.content, 'The total price including VAT is 535.50 RON.');

  // Verify exactly 2 router calls were made (Turn 1 tool request -> Turn 2 response)
  assert.equal(callCount, 2);

  // Verify tool execution was persisted in SQLite store audit log
  const auditRecords = await service.toolExecutions({ userId: owner.id, role: 'ADMIN' }, agent.id);
  assert.equal(auditRecords.length, 1);
  assert.equal(auditRecords[0].toolName, 'calculator');
  assert.equal(auditRecords[0].success, true);
  assert.deepEqual(auditRecords[0].input, { expression: '450 * 1.19' });
  assert.equal(auditRecords[0].output?.result, 535.5);

  // Verify metrics computation
  const metrics = await service.toolMetrics({ userId: owner.id, role: 'ADMIN' }, agent.id);
  assert.equal(metrics.totalExecutions, 1);
  assert.equal(metrics.successfulExecutions, 1);
  assert.equal(metrics.failedExecutions, 0);
  assert.ok(metrics.byTool.calculator);
  assert.equal(metrics.byTool.calculator.total, 1);
  assert.equal(metrics.byTool.calculator.success, 1);
});

test('HostedAgentService: loop detection prevents infinite tool cycling in a turn', async () => {
  const store = new Store(':memory:');
  const owner = store.saveUser({ id: 'usr_admin', username: 'admin', role: 'ADMIN' });

  let calls = 0;
  const mockRouter = new OpenRouterModelRouter({
    apiKey: 'mock-key',
    clock: () => 1000,
    fetch: async (url: any, init: any) => {
      const u = String(url);
      if (u.endsWith('/models')) {
        return Response.json({
          data: [{
            id: 'mock/chat:free',
            pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            endpoints: ['/api/v1/chat/completions']
          }]
        });
      }

      calls++;
      const body = JSON.parse(init.body);

      // Model keeps requesting the exact same calculator call
      if (calls <= 2) {
        return Response.json({
          model: 'mock/chat:free',
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: `call_loop_${calls}`,
                type: 'function',
                function: {
                  name: 'calculator',
                  arguments: JSON.stringify({ expression: '1 + 1' })
                }
              }]
            },
            finish_reason: 'tool_calls'
          }]
        });
      }

      // After loop detection error returned, model answers
      return Response.json({
        model: 'mock/chat:free',
        choices: [{
          message: {
            role: 'assistant',
            content: 'I noticed a repeated calculation and stopped.'
          },
          finish_reason: 'stop'
        }]
      });
    }
  });

  const service = new HostedAgentService({
    store,
    router: mockRouter,
    clock: () => 1000
  });

  const agent = await service.create({ userId: owner.id, role: 'ADMIN' }, {
    name: 'Loop Test Bot',
    businessName: 'Starli',
    type: 'SUPPORT'
  });
  await service.publish({ userId: owner.id, role: 'ADMIN' }, agent.id, 'ACTIVE', 1);

  const session = await service.startConversation({ publicId: agent.publicId });

  const res = await service.chat({
    publicId: agent.publicId,
    conversationId: session.conversationId,
    visitorToken: session.visitorToken,
    requestId: 'req_loop_1',
    message: 'Calculate something'
  });

  assert.equal(res.message.content, 'I noticed a repeated calculation and stopped.');
});
