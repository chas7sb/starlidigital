import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { BusinessEventService, sanitizeBusinessEventMetadata } from '../src/business-events.js';
import type { Context } from '../src/security.js';
const context = (store: Store, role = 'ADMIN'): Context => ({ store, user: { id: 'admin-fixture', role }, ip: 'local', setCookie() {} });

test('durable event ordering, hashed idempotency and pagination survive reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'starli-business-events-')); const db = join(dir,'events.sqlite');
  let store = new Store(db);
  try {
    let service = new BusinessEventService(store);
    const first = service.append({ type: 'agent.conversation_started', idempotencyKey: 'secret-visitor-token', correlationId: 'trace-1', occurredAt: '2026-01-01T00:00:00Z', metadata: { agentId: 'agent-1' } });
    const duplicate = service.append({ type: 'agent.conversation_started', idempotencyKey: 'secret-visitor-token', metadata: { agentId: 'different' } });
    assert.deepEqual(first, duplicate);
    const second = service.append({ type: 'agent.message_received', idempotencyKey: 'm-1', occurredAt: '2026-02-01T00:00:00Z' });
    assert.ok(second.cursor > first.cursor);
    const raw = JSON.stringify(store.db.prepare('SELECT * FROM business_events').all());
    assert.ok(!raw.includes('secret-visitor-token'));
    const page = service.list(context(store), { limit: 1 });
    assert.equal(page.hasMore,true); assert.equal(page.events[0].id,first.id);
    service.ack(context(store),'brain-v1',first.cursor);
    store.close(); store = new Store(db); service = new BusinessEventService(store);
    const remainder = service.list(context(store), { cursor: page.nextCursor });
    assert.deepEqual(remainder.events.map(event => event.id),[second.id]);
    assert.equal(service.acknowledgedCursor(context(store),'brain-v1'), first.cursor);
    assert.equal(service.list(context(store), { type:'agent.message_received' }).events.length,1);
    assert.equal(service.list(context(store), { since:'2026-01-15T00:00:00Z' }).events[0].id,second.id);
    assert.deepEqual(service.get(context(store),first.cursor),first);
    assert.equal(service.ack(context(store),'brain-v1',second.cursor),second.cursor);
    assert.equal(service.ack(context(store),'brain-v1',first.cursor),second.cursor);
    assert.equal(service.acknowledgedCursor(context(store),'other-consumer'),0);
    assert.throws(() => service.ack(context(store),'brain-v1',999999), /nonexistent/);
    assert.throws(() => store.db.prepare('UPDATE business_events SET type=?').run('email.received'), /immutable/);
    assert.throws(() => store.db.prepare('DELETE FROM business_events').run(), /immutable/);
  } finally { store.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('allowlisted metadata strips raw content, PII, credentials and nested objects', () => {
  const safe = sanitizeBusinessEventMetadata({ agentId:'agent-1', conversationId:'conv-1', email:'person@example.com', text:'private chat', visitorToken:'secret', password:'password', nested:{phone:'+40700000000'}, messageCount:2, tokenCount:Infinity, hasContact:true, source:'HOSTED_AGENT', status:'FAILED', language:'en', ownerId:'owner@example.com', sessionId:'a'.repeat(48), projectId:'sk-live-secret' });
  assert.deepEqual(safe,{agentId:'agent-1',conversationId:'conv-1',messageCount:2,hasContact:true,source:'HOSTED_AGENT',status:'FAILED',language:'en'});
  const store = new Store(':memory:');
  try {
    const service = new BusinessEventService(store);
    assert.throws(() => service.append({ type:'email.received',idempotencyKey:'', }), /idempotency/);
    assert.throws(() => service.append({ type:'email.received',idempotencyKey:'k', correlationId:'user@example.com' }), /correlation/);
    assert.throws(() => service.append({ type:'invalid' as any,idempotencyKey:'k' }), /Unsupported/);
  } finally { store.close(); }
});

test('admin authorization, stable cursor bounds and consumer validation', () => {
  const store = new Store(':memory:');
  try {
    const service = new BusinessEventService(store);
    const user = context(store,'USER'); const guest = {...context(store), user:undefined};
    for (const ctx of [user,guest]) {
      assert.throws(() => service.list(ctx)); assert.throws(() => service.get(ctx,1));
      assert.throws(() => service.ack(ctx,'brain',0)); assert.throws(() => service.acknowledgedCursor(ctx,'brain'));
    }
    assert.throws(() => service.list(context(store),{cursor:-1}), /cursor/);
    assert.throws(() => service.list(context(store),{limit:201}), /limit/);
    assert.throws(() => service.list(context(store),{since:'yesterday'}), /timestamp/);
    assert.throws(() => service.ack(context(store),'bad@consumer',0), /consumer/);
  } finally { store.close(); }
});

test('outer rollback removes event; append failure preserves outer transaction; notification failures cannot undo commits', () => {
  const store = new Store(':memory:'); const events = new Events(); let notified = 0;
  events.publish = () => { notified++; throw new Error('broken consumer'); };
  try {
    const service = new BusinessEventService(store,events);
    store.db.exec('BEGIN IMMEDIATE');
    const rolled = service.append({type:'agent.message_received',idempotencyKey:'rolled'});
    assert.equal(notified,0); service.notifyCommitted(rolled.cursor); assert.equal(notified,0);
    store.db.exec('ROLLBACK');
    assert.equal(service.list(context(store)).events.length,0);
    const persisted = service.append({type:'agent.message_received',idempotencyKey:'committed'});
    assert.equal(notified,1); assert.equal(service.get(context(store),persisted.cursor)?.id,persisted.id);
    store.db.exec('BEGIN IMMEDIATE');
    service.append({type:'agent.lead_captured',idempotencyKey:'outer'});
    assert.equal(notified,1); store.db.exec('COMMIT');
    service.notifyCommitted(service.list(context(store)).events.at(-1)!.cursor); assert.equal(notified,2);
    // An actual database write rejection must propagate while rolling back only its savepoint.
    store.db.exec("CREATE TRIGGER reject_email BEFORE INSERT ON business_events WHEN NEW.type='email.received' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
    store.db.exec('BEGIN IMMEDIATE'); store.put('fixture',{id:'primary',value:1});
    assert.throws(() => service.append({type:'email.received',idempotencyKey:'rejected'}), /fixture failure/);
    assert.equal(store.db.isTransaction,true); assert.equal(store.get('fixture','primary')?.value,1);
    store.db.exec('ROLLBACK'); assert.equal(store.get('fixture','primary'),undefined);
  } finally { store.close(); }
});


test('top-level source, timestamp and correlation defaults; source-scoped idempotency', () => {
  const store = new Store(':memory:');
  try {
    const service = new BusinessEventService(store);
    const event = service.append({type:'agent.message_received',idempotencyKey:'source-key',metadata:{actorId:'actor-1',companyId:'company-1'}});
    assert.equal(event.source,'HOSTED_AGENT'); assert.equal(event.timestamp,event.occurredAt); assert.equal(event.correlationId,event.id);
    assert.deepEqual(event.metadata,{actorId:'actor-1',companyId:'company-1'});
    const different = service.append({type:'agent.message_received',source:'VISITOR',idempotencyKey:'source-key'});
    assert.notEqual(different.id,event.id);
    assert.equal(service.append({type:'proposal.viewed',idempotencyKey:'proposal'}).source,'PROPOSAL');
    assert.throws(() => service.append({type:'email.received',source:'WRONG' as any,idempotencyKey:'wrong'}), /source/);
  } finally { store.close(); }
});

test('64hex visitor capabilities and MCP credentials never enter allowed identifier fields', () => {
  const token = 'b'.repeat(64);
  for (const credential of [token, 'starli_mcp_secret_token', 'starli_op_secret_token', 'sk-live-secret', 're_secret']) {
    assert.deepEqual(sanitizeBusinessEventMetadata({actorId:credential,companyId:credential,agentId:credential,sessionId:credential}),{});
    const store = new Store(':memory:');
    try { assert.throws(() => new BusinessEventService(store).append({type:'agent.message_received',idempotencyKey:'private',correlationId:credential}), /correlation/); }
    finally { store.close(); }
  }
});
