import { createHash, randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { Events } from './events.js';
import { requireAdmin, type Context } from './security.js';

export const BUSINESS_EVENT_TYPES = [
  'visitor.session_started', 'visitor.message_received', 'visitor.lead_captured',
  'agent.conversation_started', 'agent.message_received', 'agent.lead_captured',
  'proposal.viewed', 'proposal.claimed', 'email.received',
  'project.build_completed', 'project.build_failed', 'deployment.completed', 'deployment.failed',
] as const;
export type BusinessEventType = typeof BUSINESS_EVENT_TYPES[number];
export const BUSINESS_EVENT_SOURCES = ['HOSTED_AGENT','VISITOR','PROPOSAL','MAILBOX','PROJECT','DEPLOYMENT'] as const;
export type BusinessEventSource = typeof BUSINESS_EVENT_SOURCES[number];
export type BusinessEvent = Readonly<{
  id: string; cursor: number; type: BusinessEventType; source: BusinessEventSource; correlationId: string;
  occurredAt: string; timestamp: string; createdAt: string; metadata: Readonly<Record<string, string | number | boolean>>;
}>;
export type AppendBusinessEvent = {
  type: BusinessEventType; source?: BusinessEventSource; idempotencyKey: string; correlationId?: string;
  occurredAt?: string; metadata?: Record<string, unknown>;
};
export type BusinessEventPage = { events: BusinessEvent[]; nextCursor: number; hasMore: boolean };
const ID_KEYS = new Set(['actorId','companyId','agentId','conversationId','messageId','leadId','projectId','proposalId','deploymentId','emailId','userId','ownerId','sessionId']);
const NUMBER_KEYS = new Set(['messageCount','tokenCount','inputTokens','outputTokens','costMicros','durationMs','attachmentCount']);
const BOOLEAN_KEYS = new Set(['hasContact','hasEmail','hasPhone','isAuthenticated','success']);
const ENUMS: Record<string, readonly string[]> = {
  channel: ['WEB','WHATSAPP','EMAIL','SMS','MCP','API'],
  source: ['HOSTED_AGENT','VISITOR','PROPOSAL','MAILBOX','PROJECT','DEPLOYMENT','SYSTEM'],
  status: ['STARTED','RECEIVED','CAPTURED','VIEWED','CLAIMED','COMPLETE','COMPLETED','FAILED','SUCCEEDED'],
  language: ['en','ro'],
};
function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value) && !/^(?:starli_op_|starli_mcp_|sk[-_]|re_|vcp_|cfut_)/i.test(value) && !/^[a-f0-9]{40,}$/i.test(value);
}
/** No recursive arbitrary payload: all unrecognised fields, free text and PII are dropped. */
export function sanitizeBusinessEventMetadata(input?: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const key of [...ID_KEYS, ...NUMBER_KEYS, ...BOOLEAN_KEYS, ...Object.keys(ENUMS)]) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (ID_KEYS.has(key) && safeId(value)) out[key] = value;
    else if (NUMBER_KEYS.has(key) && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000) out[key] = value;
    else if (BOOLEAN_KEYS.has(key) && typeof value === 'boolean') out[key] = value;
    else if (ENUMS[key]?.includes(value as string)) out[key] = value as string;
  }
  return out;
}
function cursorNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid business event cursor');
  return value;
}
function iso(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid business event timestamp');
  return new Date(value).toISOString();
}

/** Internal producers append; every administrative read and acknowledgement requires a real admin Context. */
export class BusinessEventService {
  constructor(private readonly store: Store, private readonly events?: Events) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS business_events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        idempotency_hash TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS business_events_type_cursor ON business_events(type,cursor);
      CREATE INDEX IF NOT EXISTS business_events_occurred_cursor ON business_events(occurred_at,cursor);
      CREATE TABLE IF NOT EXISTS business_event_acks (
        consumer TEXT PRIMARY KEY, cursor INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS business_events_immutable_update BEFORE UPDATE ON business_events BEGIN SELECT RAISE(ABORT,'Business events are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS business_events_immutable_delete BEFORE DELETE ON business_events BEGIN SELECT RAISE(ABORT,'Business events are immutable'); END;
    `);
  }
  private admin(ctx: Context): void {
    requireAdmin(ctx);
    if (ctx.store !== this.store) throw new Error('Business event context store mismatch');
  }
  private decode(row: any): BusinessEvent {
    const value = JSON.parse(String(row.event_json));
    return Object.freeze({ ...value, metadata: Object.freeze(value.metadata), cursor: Number(row.cursor) });
  }
  append(input: AppendBusinessEvent): BusinessEvent {
    if (!BUSINESS_EVENT_TYPES.includes(input.type)) throw new Error('Unsupported business event type');
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.length || input.idempotencyKey.length > 2048) throw new Error('An idempotency key of 1 to 2048 characters is required');
    if (input.correlationId !== undefined && !safeId(input.correlationId)) throw new Error('Invalid business event correlation identifier');
    const defaults: Record<string, BusinessEventSource> = { agent: 'HOSTED_AGENT', visitor: 'VISITOR', proposal: 'PROPOSAL', email: 'MAILBOX', project: 'PROJECT', deployment: 'DEPLOYMENT' };
    const source = input.source ?? defaults[input.type.split('.')[0]];
    if (!BUSINESS_EVENT_SOURCES.includes(source)) throw new Error('Unsupported business event source');
    const hash = createHash('sha256').update(source).update('\0').update(input.type).update('\0').update(input.idempotencyKey).digest('hex');
    const createdAt = new Date().toISOString();
    const id = randomUUID();
    const occurredAt = input.occurredAt ? iso(input.occurredAt) : createdAt;
    const event = {
      id, type: input.type, source, correlationId: input.correlationId ?? id,
      occurredAt, timestamp: occurredAt, createdAt,
      metadata: sanitizeBusinessEventMetadata(input.metadata),
    };
    const nested = this.store.db.isTransaction;
    const savepoint = 'business_event_' + randomUUID().replace(/-/g,'');
    this.store.db.exec(`SAVEPOINT ${savepoint}`);
    let result: BusinessEvent;
    let inserted = false;
    try {
      const receipt = this.store.db.prepare('INSERT OR IGNORE INTO business_events(id,type,idempotency_hash,occurred_at,event_json) VALUES(?,?,?,?,?)').run(event.id, event.type, hash, event.occurredAt, JSON.stringify(event));
      inserted = Number(receipt.changes) === 1;
      const row = this.store.db.prepare('SELECT cursor,event_json FROM business_events WHERE idempotency_hash=?').get(hash);
      if (!row) throw new Error('Business event receipt missing');
      result = this.decode(row);
      this.store.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (error) {
      this.store.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      this.store.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
    // Outer transactions own their commit: call notifyCommitted afterwards. Hints never replace durable replay.
    if (inserted && !nested) this.notifyCommitted(result.cursor);
    return result;
  }
  notifyCommitted(cursor: number): void {
    cursorNumber(cursor);
    // Do not leak uncommitted cursor hints or let a failing consumer break the primary write.
    if (this.store.db.isTransaction) return;
    if (!this.store.db.prepare('SELECT cursor FROM business_events WHERE cursor=?').get(cursor)) return;
    try { this.events?.publish('business-events', { cursor }); } catch { /* Replay by cursor is authoritative. */ }
  }
  list(ctx: Context, filter: { cursor?: number; type?: BusinessEventType; since?: string; limit?: number } = {}): BusinessEventPage {
    this.admin(ctx);
    const cursor = cursorNumber(filter.cursor ?? 0);
    const limit = filter.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Business event limit must be 1 to 200');
    const clauses = ['cursor > ?']; const args: (string | number)[] = [cursor];
    if (filter.type !== undefined) {
      if (!BUSINESS_EVENT_TYPES.includes(filter.type)) throw new Error('Unsupported business event type');
      clauses.push('type=?'); args.push(filter.type);
    }
    if (filter.since !== undefined) { clauses.push('occurred_at>=?'); args.push(iso(filter.since)); }
    args.push(limit + 1);
    const rows = this.store.db.prepare(`SELECT cursor,event_json FROM business_events WHERE ${clauses.join(' AND ')} ORDER BY cursor ASC LIMIT ?`).all(...args);
    const events = rows.slice(0,limit).map(row => this.decode(row));
    return { events, nextCursor: events.at(-1)?.cursor ?? cursor, hasMore: rows.length > limit };
  }
  get(ctx: Context, cursor: number): BusinessEvent | undefined {
    this.admin(ctx);
    const row = this.store.db.prepare('SELECT cursor,event_json FROM business_events WHERE cursor=?').get(cursorNumber(cursor));
    return row ? this.decode(row) : undefined;
  }
  acknowledgedCursor(ctx: Context, consumer: string): number {
    this.admin(ctx);
    if (!safeId(consumer)) throw new Error('Invalid business event consumer');
    const row = this.store.db.prepare('SELECT cursor FROM business_event_acks WHERE consumer=?').get(consumer);
    return row ? Number(row.cursor) : 0;
  }
  /** Cumulative watermark: consumer confirms successful processing of every event UP TO this cursor. */
  ack(ctx: Context, consumer: string, cursor: number): number {
    this.admin(ctx);
    if (!safeId(consumer)) throw new Error('Invalid business event consumer');
    cursorNumber(cursor);
    if (cursor !== 0 && !this.store.db.prepare('SELECT cursor FROM business_events WHERE cursor=?').get(cursor)) throw new Error('Cannot acknowledge a nonexistent event');
    this.store.db.prepare('INSERT INTO business_event_acks(consumer,cursor,updated_at) VALUES(?,?,?) ON CONFLICT(consumer) DO UPDATE SET cursor=MAX(business_event_acks.cursor,excluded.cursor),updated_at=excluded.updated_at').run(consumer,cursor,new Date().toISOString());
    return this.acknowledgedCursor(ctx, consumer);
  }
}
