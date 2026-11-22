import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Store } from '../../server/src/store.js';
import { Events } from '../../server/src/events.js';
import { MailboxServices } from '../../server/src/mailbox/service.js';
import { registerOutreachTools } from '../src/tools/outreach.js';
import type { AuthPrincipal } from '../src/types.js';
import type { SmtpSendArgs } from '../../server/src/smtp.js';

async function fixture(principal: AuthPrincipal = { id: 'admin', role: 'admin', scopes: ['read', 'write'] }, failDraft = false) {
  const store = new Store(':memory:');
  const sent: SmtpSendArgs[] = [];
  const audits: unknown[][] = [];
  const mailbox = new MailboxServices({accountConfig:{id: 'local-test',email: 'mailbox@example.test',displayName: 'Test mailbox'}, store, events: new Events(), transport: async args => {
    sent.push(args); return { success: true, response: '250 fixture accepted', messageId: args.messageId };
  }});
  if (failDraft) mailbox.createDraft = () => { throw new Error('Fixture draft persistence failed'); };
  const server = new McpServer({ name: 'outreach-fixture', version: '1' });
  registerOutreachTools({ server, principal, store, mailboxServices: mailbox, workspaceRoot: process.cwd(),
    auditSink: { record() {}, list() { return []; } }, auditCall: (...args) => { audits.push(args); } });
  const client = new Client({ name: 'outreach-tests', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { store, sent, audits, client, async call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok('content' in result);
    const content = result.content as { type: string; text: string }[];
    return { isError: 'isError' in result ? result.isError : undefined, data: JSON.parse(content[0].text) };
  }, async close() { await client.close(); await server.close(); store.close(); } };
}

test('MCP discovers readonly outreach limits schema and inspection never reserves or sends', async () => {
  const f = await fixture({ id: 'reader', role: 'admin', scopes: ['read'] });
  try {
    const list = await f.client.listTools();
    const schema = list.tools.find(t => t.name === 'outreach_get_limits');
    assert.ok(schema); assert.equal(schema.inputSchema.type, 'object');
    assert.equal(schema.annotations?.readOnlyHint, true);
    assert.ok(schema.inputSchema.properties?.to); assert.ok(schema.inputSchema.properties?.domains);
    const result = await f.call('outreach_get_limits', { to: ['TEST@Example.org'], domains: ['example.net'] });
    assert.equal(result.isError, undefined);
    assert.equal(typeof result.data.effective.hourly, 'number');
    assert.equal(result.data.hourly.used, 0);
    assert.ok(result.data.domains.some((budget: any) => budget.domain === 'example.org'));
    assert.ok(result.data.domains.some((budget: any) => budget.domain === 'example.net'));
    assert.equal(f.store.list('outreach-send-requests').length, 0); assert.equal(f.sent.length, 0);
    const denied = await f.call('outreach_send_email', { to: ['test@example.org'], subject: 'Test', bodyText: 'No real send' });
    assert.equal(denied.isError, true); assert.equal(denied.data.error.code, 'UNAUTHORIZED');
    assert.ok(f.audits.some(a => a[0] === 'outreach_get_limits' && a[3] === 'SUCCESS'));
  } finally { await f.close(); }
});

test('MCP sends each normalized unique recipient once and preserves cached retry semantics', async () => {
  const f = await fixture();
  try {
    const args = { to: ['UPPER@example.org', 'upper@example.org', 'UPPER@example.org'], subject: 'Fixture', bodyText: 'Mock transport only', idempotencyKey: 'same-request' };
    const first = await f.call('outreach_send_email', args);
    assert.equal(first.isError, undefined); assert.equal(first.data.transportStatus, 'SMTP_ACCEPTED');
    assert.equal(first.data.deliveryConfirmed, false); assert.equal(f.sent.length, 1);
    assert.deepEqual(first.data.to, [{ address: 'upper@example.org' }]);
    assert.deepEqual(f.store.list('outreach-send-requests')[0].to, ['upper@example.org']);
    const second = await f.call('outreach_send_email', { ...args, to: ['upper@example.org'] });
    assert.equal(second.data.messageId, first.data.messageId); assert.equal(f.sent.length, 1);
    const limits = await f.call('outreach_get_limits'); assert.equal(limits.data.hourly.used, 1);
  } finally { await f.close(); }
});

test('MCP returns actionable structured budget errors without transport calls', async () => {
  const f = await fixture();
  try {
    const limits = (await f.call('outreach_get_limits')).data;
    f.store.put('outreach-send-requests', { id: 'full-hour', status: 'ACCEPTED', createdAtMs: Date.now() - 61000,
      to: Array.from({ length: limits.effective.hourly }, (_, i) => `used${i}@prior.example`), fingerprint: 'prior' });
    const blocked = await f.call('outreach_send_email', { to: ['next@example.org'], subject: 'Fixture', bodyText: 'Never send' });
    assert.equal(blocked.isError, true);
    const error = blocked.data.error;
    assert.equal(error.code, 'OUTREACH_RATE_LIMIT'); assert.equal(error.scope, 'hourly');
    assert.equal(error.limit, limits.effective.hourly); assert.equal(error.used, limits.effective.hourly);
    assert.equal(error.requested, 1); assert.equal(error.remaining, 0);
    assert.ok(error.retryAfterSeconds > 0); assert.ok(Number.isFinite(Date.parse(error.resetAt)));
    assert.equal(f.sent.length, 0); assert.equal(f.store.list('outreach-send-requests').length, 1);
  } finally { await f.close(); }
});

test('MCP limits inspection requires an admin with read-capable scope', async () => {
  for (const principal of [{ id: 'unscoped', role: 'admin' as const, scopes: [] }, { id: 'customer', role: 'customer' as const, scopes: ['read'] }]) {
    const f = await fixture(principal);
    try {
      const denied = await f.call('outreach_get_limits');
      assert.equal(denied.isError, true); assert.equal(denied.data.error.code, 'UNAUTHORIZED');
      assert.equal(f.store.list('outreach-send-requests').length, 0);
    } finally { await f.close(); }
  }
});


test('MCP pre-transport failures are definitely-not-sent and release their quota reservation', async () => {
  const f = await fixture(undefined, true);
  try {
    const failed = await f.call('outreach_send_email', { to: ['never@example.org'], subject: 'Fixture failure', bodyText: 'No transport' });
    assert.equal(failed.isError, true); assert.equal(f.sent.length, 0);
    const limits = (await f.call('outreach_get_limits')).data;
    assert.equal(limits.minute.used, 0); assert.equal(limits.hourly.used, 0); assert.equal(limits.daily.used, 0);
    assert.equal(f.store.list('outreach-send-requests')[0].status, 'REJECTED');
  } finally { await f.close(); }
});

test('MCP exposes unlimited rates honestly while retaining real provider ceilings', async () => {
  const keys = ['OUTREACH_MAX_RECIPIENTS_PER_MINUTE', 'OUTREACH_MAX_RECIPIENTS_PER_HOUR', 'OUTREACH_MAX_RECIPIENTS_PER_DAY', 'OUTREACH_MAX_RECIPIENTS_PER_DOMAIN_PER_HOUR', 'OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_MINUTE', 'OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_HOUR', 'OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_DAY', 'OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_DOMAIN_PER_HOUR'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const f = await fixture();
  try {
    for (const key of keys) {
      if (key.includes('_PROVIDER_')) delete process.env[key]; else process.env[key] = '0';
    }
    let limits = (await f.call('outreach_get_limits', { domains: ['example.org'] })).data;
    assert.equal(limits.configured.hourly, null); assert.equal(limits.effective.hourly, null);
    for (const budget of [limits.minute, limits.hourly, limits.daily, limits.domains[0]]) {
      assert.equal(budget.unlimited, true); assert.equal(budget.limit, null); assert.equal(budget.remaining, null);
    }
    assert.equal(limits.maxRecipientsPerMessage, 20);
    process.env.OUTREACH_PROVIDER_MAX_RECIPIENTS_PER_HOUR = '50';
    limits = (await f.call('outreach_get_limits')).data;
    assert.equal(limits.configured.hourly, null); assert.equal(limits.providerCeilings.hourly, 50);
    assert.equal(limits.effective.hourly, 50); assert.equal(limits.hourly.unlimited, false);
    assert.equal(limits.hourly.remaining, 50); assert.equal(f.sent.length, 0);
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    await f.close();
  }
});
