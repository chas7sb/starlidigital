import { z } from 'zod';
import type { CompanyEvent } from '../../../server/src/company-events.js';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';
import { PlausibleAnalytics } from '../analytics.js';

const id = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.:-]+$/);
const count = z.number().int().min(1).max(100).default(25);
const projection = (record: any) => Object.fromEntries(
  ['id','type','kind','status','source','taskId','conversationId','companyId','projectId','agentId','ownerId','createdAt','updatedAt','occurredAt','sequence']
    .filter(key => ['string','number','boolean'].includes(typeof record?.[key]))
    .map(key => [key, record[key]])
);

const eventView = (event: CompanyEvent) => ({
  id: event.id,
  cursor: event.sequence,
  type: event.type,
  source: event.source,
  timestamp: event.occurredAt,
  entities: event.entities,
  correlationId: event.correlationKey,
  payload: event.payload,
});

const visitorView = (session: any) => ({
  id: session.id,
  agentId: session.agentId,
  conversationId: session.conversationId,
  firstSeen: session.firstSeen,
  lastSeen: session.lastSeen,
  currentRoute: session.currentRoute,
  pageHistory: Array.isArray(session.pageHistory) ? session.pageHistory.slice(-20).map((entry: any) => ({ route: entry.route, at: entry.at })) : [],
  referrer: session.referrer,
  campaign: session.campaign,
  enabled: !!session.enabled,
  dismissed: !!session.dismissed,
  greetedAt: session.greetedAt ?? null,
});

export function registerCompanyTools(ctx: ToolContext) {
  const { server, store, principal, events, hostedAgentService } = ctx;
  const analytics = new PlausibleAnalytics();
  const actor = { userId: principal.id, role: (principal.role === 'admin' ? 'ADMIN' : 'CUSTOMER') as 'ADMIN'|'CUSTOMER' };

  function tool(name: string, description: string, shape: z.ZodRawShape, write: boolean, fn: (args: any) => unknown | Promise<unknown>) {
    server.tool(name, description, shape, { readOnlyHint: !write, destructiveHint: write, idempotentHint: !write }, async args => {
      const start = Date.now();
      if (principal.role !== 'admin' || !hasScope(principal, write ? 'write' : 'read')) {
        ctx.auditCall(name, undefined, start, 'DENIED', undefined, undefined, 'Permission denied');
        return errorResponse('Administrator and matching scope required', 'FORBIDDEN');
      }
      try {
        if (!store) return errorResponse('Platform database unavailable', 'SERVICE_UNAVAILABLE');
        const result = await fn(z.object(shape).strict().parse(args));
        ctx.auditCall(name, undefined, start, 'SUCCESS', undefined, { readOnly: !write });
        return jsonResponse(result);
      } catch (error) {
        ctx.auditCall(name, undefined, start, 'FAILED', undefined, undefined, 'Company tool operation failed');
        return errorResponse('Company operation could not complete. Inspect referenced state before retrying a write.', 'COMPANY_OPERATION_FAILED');
      }
    });
  }

  function records(collection: string, limit = 100) {
    return store!.db.prepare('SELECT payload FROM records WHERE collection=? ORDER BY rowid DESC LIMIT ?')
      .all(collection, limit).map(row => JSON.parse(String((row as any).payload)));
  }

  const ledgerUnavailable = () => ({
    status: 'DEPENDENCY_UNAVAILABLE',
    dependency: 'Company Brain normalized event foundation',
    note: 'The durable CompanyEventLedger is not initialized. No synthetic events are returned.',
  });

  tool('events_list', 'Read durable Company Brain events by exclusive cursor.', {
    cursor: z.number().int().min(0).default(0),
    type: z.string().max(120).regex(/^[A-Za-z0-9_.:-]+$/).optional(),
    since: z.string().datetime().optional(),
    limit: count,
  }, false, args => {
    const ledger = events?.companyEvents;
    if (!ledger) return ledgerUnavailable();
    const rows = ledger.list({ afterCursor: args.cursor, since: args.since, types: args.type ? [args.type] : undefined, limit: args.limit + 1 });
    const page = rows.slice(0, args.limit);
    return { status: 'OK', events: page.map(eventView), nextCursor: page.at(-1)?.sequence ?? args.cursor, hasMore: rows.length > args.limit };
  });

  tool('events_cursor', 'Inspect a durable Company Brain consumer checkpoint without changing it.', { consumer: id }, false, args => {
    const ledger = events?.companyEvents;
    return ledger ? { status: 'OK', consumer: args.consumer, cursor: ledger.acknowledgement(args.consumer) } : ledgerUnavailable();
  });

  tool('events_get', 'Fetch one durable Company Brain event by cursor.', { cursor: z.number().int().positive() }, false, args => {
    const ledger = events?.companyEvents;
    if (!ledger) return ledgerUnavailable();
    const event = ledger.getBySequence(args.cursor);
    return event ? { status: 'OK', event: eventView(event) } : { status: 'NOT_FOUND' };
  });

  tool('events_summary', 'Count real durable Company Brain events by type/source over a bounded recent window.', {
    hours: z.number().int().min(1).max(720).default(24),
  }, false, args => {
    const ledger = events?.companyEvents;
    if (!ledger) return ledgerUnavailable();
    const since = new Date(Date.now() - args.hours * 3600000).toISOString();
    return { status: 'OK', ...ledger.summary({ since }) };
  });

  tool('events_ack', 'Advance a durable Company Brain consumer cursor monotonically.', {
    consumer: id,
    cursor: z.number().int().min(0),
  }, true, args => {
    const ledger = events?.companyEvents;
    if (!ledger) return ledgerUnavailable();
    if (args.cursor > 0 && !ledger.getBySequence(args.cursor)) return { status: 'NOT_FOUND' };
    return { status: 'ACKNOWLEDGED', consumer: args.consumer, cursor: ledger.acknowledge(args.consumer, args.cursor) };
  });

  tool('company_activity_stream', 'Bounded metadata activity for a company across real CRM activities, proposals and projects.', {
    companyId: id,
    limit: count,
  }, false, args => {
    const collections = ['crm_activities','proposals','projects'];
    const values = collections.flatMap(source => store!.db.prepare("SELECT payload FROM records WHERE collection=? AND json_extract(payload,'$.companyId')=? ORDER BY rowid DESC LIMIT ?")
      .all(source, args.companyId, args.limit)
      .map(row => ({ source, ...projection(JSON.parse(String((row as any).payload))) })));
    return { status: 'OK', activities: values.sort((a: any,b: any) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || ''))).slice(0,args.limit) };
  });

  tool('agency_attention_queue', 'Inspect real failed/blocked/review states across jobs, projects and email. No automatic actions.', { limit: count }, false, args => ({
    items: ['projects','operator-tasks','operator-runs','email-outbox'].flatMap(source => store!.db.prepare("SELECT payload FROM records WHERE collection=? AND json_extract(payload,'$.status') IN ('FAILED','BLOCKED','NEEDS_REVIEW','BUILD_FAILED','UNCONFIRMED') ORDER BY rowid DESC LIMIT ?")
      .all(source,args.limit).map(row => ({ source, ...projection(JSON.parse(String((row as any).payload))) }))).slice(0,args.limit),
  }));

  tool('agency_recent_actions', 'Read recent platform execution receipts and hosted tool activity.', { limit: count }, false, args => ({
    actions: ['operator-task-events','operator-tool-receipts','hosted-agent-tool-executions']
      .flatMap(source => records(source,args.limit).map(record => ({ source, ...projection(record) })))
      .sort((a:any,b:any) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0,args.limit),
  }));

  tool('agency_metrics', 'Read real subsystem record counts without fetching private bodies.', {}, false, () => ({
    counts: ['projects','conversations','hosted-agent-conversations','hosted-agent-leads','crm_companies','mailbox-messages','operator-tasks']
      .map(collection => ({ collection, count: Number((store!.db.prepare('SELECT COUNT(*) AS count FROM records WHERE collection=?').get(collection) as any)?.count || 0) })),
  }));

  tool('visitor_list_active', 'List active authorized visitor sessions from the real VisitorSessions presence service.', {
    agentId: id.optional(),
    limit: count,
  }, false, args => {
    const visitors = hostedAgentService?.visitors;
    if (!visitors) return { status: 'DEPENDENCY_UNAVAILABLE', dependency: 'VisitorSessions' };
    const sessions = args.agentId ? visitors.listActive(actor,args.agentId).slice(0,args.limit) : visitors.listActiveAll(actor,args.limit);
    return { status: 'OK', presenceWindowSeconds: 90, sessions: sessions.map(visitorView) };
  });

  tool('visitor_get_session', 'Read one authorized real visitor session. Capability tokens and IPs are never returned.', {
    sessionId: id,
  }, false, args => {
    const visitors = hostedAgentService?.visitors;
    if (!visitors) return { status: 'DEPENDENCY_UNAVAILABLE', dependency: 'VisitorSessions' };
    return { status: 'OK', session: visitorView(visitors.getSession(actor,args.sessionId)) };
  });

  tool('visitor_get_context', 'Read visitor context. Message content is opt-in and bounded.', {
    sessionId: id,
    includeMessages: z.boolean().default(false),
  }, false, args => {
    const visitors = hostedAgentService?.visitors;
    if (!visitors) return { status: 'DEPENDENCY_UNAVAILABLE', dependency: 'VisitorSessions' };
    const context = visitors.getContext(actor,args.sessionId);
    return {
      status: 'OK',
      session: visitorView(context.session),
      messages: args.includeMessages ? (context.messages || []).slice(-10).map((message:any) => ({ id: message.id, role: message.role, createdAt: message.createdAt, content: String(message.content || '').slice(0,1000) })) : undefined,
    };
  });

  tool('visitor_send_message', 'Send one safe, throttled Starli AI proactive greeting using the authoritative VisitorSessions service.', {
    sessionId: id,
    topic: z.enum(['general','ai-agents']).default('general'),
    confirmed: z.literal(true),
  }, true, args => {
    const visitors = hostedAgentService?.visitors;
    if (!visitors) return { status: 'DEPENDENCY_UNAVAILABLE', dependency: 'VisitorSessions' };
    const message = visitors.sendMessage(actor,args.sessionId,args.topic);
    return { status: 'SENT', sessionId: args.sessionId, message: { id: message.id, role: message.role, content: message.content, createdAt: message.createdAt } };
  });

  const dates = {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  };
  for (const method of ['overview','timeseries','pages','referrers','sources','devices','conversions'] as const) {
    tool('analytics_'+method, 'Read starlidigital.ro analytics from the installed Plausible CE Stats API. Missing token returns CONFIGURATION_NEEDED, not fake zero data.', dates, false, args => analytics[method](args));
  }
}
