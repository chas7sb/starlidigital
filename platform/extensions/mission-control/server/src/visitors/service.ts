import { randomUUID } from 'node:crypto';
import type { Store, RecordData } from '../store.js';
import type { Events } from '../events.js';
import type { Actor } from '../hosted-agents/types.js';

const COLLECTION = 'visitor-sessions';
const TTL = 86400000;
export interface VisitorEventAdapter { publish(topic: string, value: unknown): void }
export interface VisitorUpdate {
  sessionId: string; conversationId: string; visitorToken: string;
  route?: string; referrer?: string; campaign?: string;
  enabled: boolean; dismissed?: boolean;
}
// Accept route templates only: arbitrary URLs, slugs, search and hashes can contain personal data.
export function safeRoute(value = ''): string {
  return /^\/[a-zA-Z0-9/_-]{0,120}$/.test(value) && !/@|\d{5}/.test(value) ? value : '/';
}
export class VisitorSessions {
  constructor(private store: Store, private events: Events | undefined,
    private authenticate: (conversationId: string, token: string) => RecordData,
    private authorize: (actor: Actor, agentId: string) => void,
    private clock = () => Date.now(), private adapter?: VisitorEventAdapter) {}
  private prune() {
    this.store.db.prepare("DELETE FROM records WHERE collection=? AND CAST(json_extract(payload,'$.expiresAt') AS INTEGER)<=?").run(COLLECTION, this.clock());
  }
  update(input: VisitorUpdate) {
    const conversation = this.authenticate(input.conversationId, input.visitorToken);
    if (!/^[a-f0-9-]{36}$/i.test(input.sessionId)) throw new Error('Invalid opaque session ID');
    this.prune();
    const key = conversation.agentId + ':' + input.sessionId;
    const old = this.store.get(COLLECTION, key);
    if (old && old.conversationId !== conversation.id) throw new Error('Session already bound');
    const now = this.clock();
    const route = safeRoute(input.route);
    const history = old?.pageHistory || [];
    if (history.at(-1)?.route !== route) history.push({ route, at: now });
    let referrer: string | undefined;
    try { const url = new URL(input.referrer || ''); if (['https:', 'http:'].includes(url.protocol)) referrer = url.origin; } catch {}
    // Campaign codes must be curated labels, never arbitrary query strings.
    const campaign = /^[a-z0-9_-]{1,64}$/i.test(input.campaign || '') ? input.campaign : undefined;
    const session = { ...old, id: key, agentId: conversation.agentId, conversationId: conversation.id,
      firstSeen: old?.firstSeen ?? now, lastSeen: now, expiresAt: old?.expiresAt ?? now + TTL,
      currentRoute: route, pageHistory: history.slice(-20), referrer: old?.referrer ?? referrer,
      campaign: old?.campaign ?? campaign, enabled: input.enabled,
      dismissed: !!old?.dismissed || !!input.dismissed };
    // Stop retaining contextual data when permission is withdrawn.
    if (!input.enabled) { session.pageHistory = []; session.currentRoute = '/'; session.referrer = undefined; session.campaign = undefined; }
    this.store.put(COLLECTION, session);
    return true;
  }
  getSession(actor: Actor, id: string) {
    this.prune();
    const session = this.store.get(COLLECTION, id);
    if (!session) throw new Error('Visitor session unavailable');
    this.authorize(actor, session.agentId);
    return session;
  }
  getContext(actor: Actor, id: string) {
    const session = this.getSession(actor, id);
    const conversation = this.store.get('hosted-agent-conversations', session.conversationId);
    return { session, messages: conversation?.messages || [] };
  }
  listActive(actor: Actor, agentId: string) {
    this.authorize(actor, agentId); this.prune();
    return this.store.list(COLLECTION).filter(s => s.agentId === agentId && s.enabled && this.clock() - s.lastSeen < 90000).slice(0, 100);
  }
  listActiveAll(actor: Actor, limit = 100) {
    this.prune();
    const bounded = Math.min(100, Math.max(1, Number(limit) || 100));
    const sessions = this.store.list(COLLECTION)
      .filter(s => s.enabled && this.clock() - Number(s.lastSeen || 0) < 90000)
      .sort((a,b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0));
    const visible = [];
    for (const session of sessions) {
      try { this.authorize(actor, session.agentId); visible.push(session); } catch {}
      if (visible.length >= bounded) break;
    }
    return visible;
  }
  sendMessage(actor: Actor, id: string, topic = 'general') {
    const session = this.getSession(actor, id);
    const now = this.clock();
    if (!session.enabled || session.dismissed || session.greetedAt || now - session.lastSeen >= 90000 || now - session.firstSeen < 15000) throw new Error('Proactive greeting unavailable');
    const conversation = this.store.get('hosted-agent-conversations', session.conversationId)!;
    if (conversation.status !== 'ACTIVE' || conversation.messages?.length) throw new Error('Conversation already started or inactive');
    const lock = this.store.get('hosted-agent-requests', 'lock:' + conversation.id);
    if (lock?.expiresAt > now) throw new Error('Conversation turn in progress');
    // Templates permit useful context without letting callers expose tracking or impersonate a human.
    const text = topic === 'ai-agents'
      ? 'Hey — I’m Starli AI, the AI assistant here. If you’re exploring our AI agents, tell me what your business does and I can suggest what you could automate.'
      : 'Hey — I’m Starli AI, the AI assistant here. Can I help you find what you need?';
    const message = { id: randomUUID(), conversationId: conversation.id, role: 'assistant', content: text, createdAt: new Date(now).toISOString() };
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.put('hosted-agent-conversations', { ...conversation, messages: [message], updatedAt: message.createdAt });
      this.store.put(COLLECTION, { ...session, greetedAt: now });
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.events?.publish('visitor:' + conversation.id, message);
    // Optional durable integration must not invalidate a successfully persisted message.
    try { this.adapter?.publish('visitor.message.created', { sessionId: id, messageId: message.id }); } catch {}
    return message;
  }
  messages(conversationId: string, token: string) {
    return this.authenticate(conversationId, token).messages || [];
  }
  subscribe(conversationId: string, token: string) {
    this.authenticate(conversationId, token);
    if (!this.events) throw new Error('Realtime unavailable');
    const iterator = this.events.iterator('visitor:' + conversationId);
    const authenticate = this.authenticate;
    return { [Symbol.asyncIterator]() { return this; }, async next() {
      const item = await iterator.next();
      try { authenticate(conversationId, token); } catch (error) { await iterator.return?.(); throw error; }
      return item;
    }, return: () => iterator.return!() };
  }
}
