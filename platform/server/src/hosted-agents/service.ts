import {BusinessEventService} from '../business-events.js';
import { VisitorSessions } from '../visitors/service.js';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import type { Store, RecordData } from '../store.js';
import type { Events } from '../events.js';
import {
  type Actor,
  type HostedAgent,
  type HostedAgentPublic,
  type HostedAgentMessage,
  type HostedAgentConversation,
  type HostedAgentConversationPage,
  type HostedAgentLead,
  type HostedAgentLeadPage,
  type HostedAgentUsage,
  type HostedAgentSession,
  type HostedAgentChatResult,
  type HostedAgentCreateInput,
  type HostedAgentUpdateInput,
  type HostedAgentStatus,
  HostedAgentTypeEnum,
  HostedAgentStatusEnum
} from './types.js';
import { OpenRouterModelRouter } from './openrouter.js';
import { buildAgentSystemPrompt } from './knowledge.js';
import { validateKnowledge, validateAgentInput } from './validation.js';
import { extractLeadFromMessages } from './lead-extractor.js';
import {
  defaultToolRegistry,
  toOpenAITools,
  calculateToolMetrics,
  DEFAULT_UNIVERSAL_TOOL_IDS,
  type ToolRegistry,
  type AgentTool,
  type AgentToolContext,
  type AgentToolResult,
  type ToolExecutionRecord,
  type ToolMetrics
} from './tools/index.js';

class AgentTurnGuardError extends Error {}

export const COLLECTIONS = {
  AGENTS: 'hosted-agent-agents',
  CONVERSATIONS: 'hosted-agent-conversations',
  MESSAGES: 'hosted-agent-messages',
  LEADS: 'hosted-agent-leads',
  USAGE: 'hosted-agent-usage',
  REQUESTS: 'hosted-agent-requests',
  AUDIT: 'hosted-agent-audit',
  RATE_LIMITS: 'hosted-agent-rate-limits',
  TOOL_EXECUTIONS: 'hosted-agent-tool-executions'
} as const;

export interface HostedAgentServiceOptions {
  store: Store;
  events?: Events;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  clock?: () => number;
  router?: OpenRouterModelRouter;
  toolRegistry?: ToolRegistry;
  turnTimeoutMs?: number;
  businessEvents?: Pick<BusinessEventService, 'append' | 'notifyCommitted'>;
}

export class HostedAgentService {
  public readonly visitors: VisitorSessions;
  private store: Store;
  private businessEvents: Pick<BusinessEventService, 'append' | 'notifyCommitted'>;
  private events?: Events;
  private clock: () => number;
  private router: OpenRouterModelRouter;
  private dailyBudget: number;
  private turnTimeoutMs: number;
  public toolRegistry: ToolRegistry;

  constructor(options: HostedAgentServiceOptions) {
    this.store = options.store;
    this.businessEvents = options.businessEvents || new BusinessEventService(this.store, options.events);
    this.turnTimeoutMs = Number.isFinite(options.turnTimeoutMs) && options.turnTimeoutMs! > 0 ? Math.min(options.turnTimeoutMs!, 90000) : 90000;
    this.visitors = new VisitorSessions(options.store, options.events, (id, token) => {
      const conversation = this.store.get(COLLECTIONS.CONVERSATIONS, id);
      const agent = conversation && this.store.get(COLLECTIONS.AGENTS, conversation.agentId);
      if (!conversation || !agent || !['ACTIVE', 'DEMO'].includes(agent.status) || agent.type === 'INTERNAL_KNOWLEDGE' ||
          conversation.ownerIdAtCreation !== agent.ownerId || conversation.status !== 'ACTIVE' ||
          (options.clock || Date.now)() - Date.parse(conversation.createdAt) >= 86400000 ||
          !this.verifyTokenHash(token, conversation.visitorTokenHash || '')) throw new Error('Visitor session unavailable');
      return conversation;
    }, (actor, agentId) => {
      const agent = this.getAuthorized(actor, agentId);
      if (!['ACTIVE', 'DEMO'].includes(agent.status)) throw new Error('Agent unavailable');
    }, options.clock);

    const budget = Number(options.env?.HOSTED_AGENTS_DAILY_MODEL_BUDGET || process.env.HOSTED_AGENTS_DAILY_MODEL_BUDGET || 200);
    this.dailyBudget = Number.isSafeInteger(budget) && budget > 0 && budget <= 100000 ? budget : 200;
    this.events = options.events;
    this.clock = options.clock || (() => Date.now());
    this.router = options.router || new OpenRouterModelRouter({
      apiKey: options.env?.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY,
      fetch: options.fetch,
      clock: this.clock
    });
    this.toolRegistry = options.toolRegistry || defaultToolRegistry;
  }

  // All callbacks are synchronous: never hold a SQLite transaction across network I/O.
  private transaction<T>(work: () => T): T {
    this.store.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.store.db.exec('COMMIT'); return result; }
    catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }

  public getAgentEnabledTools(agent: HostedAgent): string[] {
    let ids: unknown = agent.enabledTools;
    if (ids === undefined && agent.toolsJson !== undefined) {
      try { ids = JSON.parse(agent.toolsJson); } catch { return []; }
    }
    if (ids === undefined) ids = [...DEFAULT_UNIVERSAL_TOOL_IDS];
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids.filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id)))].slice(0, 50);
  }

  private formatAgent(raw: any): HostedAgent {
    const agent = { ...raw } as HostedAgent;
    if (!agent.enabledTools) {
      agent.enabledTools = this.getAgentEnabledTools(agent);
    }
    if (!agent.toolsJson) {
      agent.toolsJson = JSON.stringify(agent.enabledTools);
    }
    return agent;
  }

  private getAuthorized(actor: Actor, id: string): HostedAgent {
    const raw = this.store.get(COLLECTIONS.AGENTS, id);
    if (!raw) throw new Error('Hosted agent not found');
    const agent = this.formatAgent(raw);
    this.checkAgentAccess(actor, agent);
    return agent;
  }

  private validateOwner(id: string) {
    const user = this.store.user(id);
    if (!user || user.disabled) throw new Error('Target owner must be an active platform user');
  }

  private nowIso(): string {
    return new Date(this.clock()).toISOString();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private verifyTokenHash(providedToken: string, storedHash: string): boolean {
    try {
      const providedHash = this.hashToken(providedToken);
      const a = Buffer.from(providedHash, 'hex');
      const b = Buffer.from(storedHash, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private logAudit(actor: Actor, action: string, agentId: string, details?: any) {
    const record = {
      id: randomUUID(),
      actorUserId: actor.userId,
      actorRole: actor.role,
      principal: actor.principal || actor.userId,
      action,
      agentId,
      details,
      createdAt: this.nowIso()
    };
    this.store.put(COLLECTIONS.AUDIT, record);
  }

  private checkAgentAccess(actor: Actor, agent: HostedAgent): void {
    if (actor.role === 'ADMIN') return;
    if (agent.ownerId !== actor.userId) {
      throw new Error('Access denied: You do not have permission to manage this agent');
    }
  }

  private checkDurableRateLimit(key: string, max: number, windowMs: number, errorMessage: string, cost = 1) {
    const now = this.clock();
    const raw = this.store.get(COLLECTIONS.RATE_LIMITS, key) as any;
    if (cost > max) throw new Error(errorMessage);
    if (!raw || now > (raw.resetAt || 0)) {
      this.store.put(COLLECTIONS.RATE_LIMITS, {
        id: key,
        count: cost,
        resetAt: now + windowMs
      });
      return;
    }
    if (raw.count + cost > max) {
      throw new Error(errorMessage);
    }
    raw.count += cost;
    this.store.put(COLLECTIONS.RATE_LIMITS, raw);
  }

  // ==========================================
  // Canonical Management Methods
  // ==========================================

  async list(actor: Actor, options: { adminAll?: boolean; status?: HostedAgentStatus } = {}): Promise<HostedAgent[]> {
    let items: RecordData[];
    if (actor.role === 'ADMIN' && options.adminAll) {
      items = this.store.list(COLLECTIONS.AGENTS);
    } else {
      items = this.store.list(COLLECTIONS.AGENTS, actor.userId);
    }

    let agents = (items as unknown as HostedAgent[]).map(a => this.formatAgent(a));
    if (options.status) {
      agents = agents.filter(a => a.status === options.status);
    }

    return agents.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async get(actor: Actor, id: string): Promise<HostedAgent> {
    const raw = this.store.get(COLLECTIONS.AGENTS, id);
    if (!raw) {
      throw new Error(`Hosted agent not found: ${id}`);
    }
    const agent = this.formatAgent(raw);
    this.checkAgentAccess(actor, agent);
    return agent;
  }

  async create(actor: Actor, input: HostedAgentCreateInput): Promise<HostedAgent> {
    return this.transaction(() => {
      validateAgentInput(input);
      HostedAgentTypeEnum.parse(input.type);

      let ownerId = actor.userId;
      if (input.ownerId && input.ownerId !== actor.userId) {
        if (actor.role !== 'ADMIN') {
          throw new Error('Only administrators can assign agents to other users');
        }
        this.validateOwner(input.ownerId);
        ownerId = input.ownerId;
      }

      const id = randomUUID();
      const publicId = `ag_${randomBytes(12).toString('hex')}`;
      const slugBase = input.slug?.trim() || `${input.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const slug = `${slugBase.replace(/^-+|-+$/g, '') || 'agent'}-${randomBytes(4).toString('hex')}`;
      const now = this.nowIso();

      let enabledTools: string[] = [...DEFAULT_UNIVERSAL_TOOL_IDS];
      if (Array.isArray(input.enabledTools)) {
        enabledTools = input.enabledTools;
      } else if (input.toolsJson) {
        try {
          const parsed = JSON.parse(input.toolsJson);
          if (Array.isArray(parsed)) enabledTools = parsed;
        } catch {}
      }
      const toolsJson = JSON.stringify(enabledTools);

      const agent: HostedAgent = {
        id,
        ownerId,
        publicId,
        name: input.name.trim(),
        businessName: input.businessName.trim(),
        slug,
        type: input.type,
        status: 'DRAFT',
        instructions: input.instructions?.trim() || '',
        welcomeMessage: input.welcomeMessage?.trim() || 'Hello! How can I help you today?',
        businessContext: input.businessContext?.trim() || '',
        knowledgeJson: input.knowledgeJson ? validateKnowledge(input.knowledgeJson) : '{}',
        appearanceJson: input.appearanceJson || JSON.stringify({
          primaryColor: '#7c3aed',
          accentColor: '#4f46e5',
          position: 'bottom-right'
        }),
        deploymentJson: input.deploymentJson || JSON.stringify({
          enablePublicEmbed: true,
          enableAnonymousDemo: true
        }),
        toolsJson,
        enabledTools,
        version: 1,
        createdAt: now,
        updatedAt: now
      };

      this.store.put(COLLECTIONS.AGENTS, agent as any, ownerId);
      this.logAudit(actor, 'AGENT_CREATE', id, { name: agent.name, type: agent.type });

      return this.formatAgent(agent);
    });
  }

  async update(actor: Actor, id: string, input: HostedAgentUpdateInput, expectedVersion: number): Promise<HostedAgent> {
    return this.transaction(() => {
      const agent = this.getAuthorized(actor, id);

      if (agent.version !== expectedVersion) {
        throw new Error(`Concurrency conflict: agent version is ${agent.version}, expected ${expectedVersion}`);
      }

      validateAgentInput(input);
      const now = this.nowIso();

      let toolsJson = agent.toolsJson;
      let enabledTools = agent.enabledTools;
      if (Array.isArray(input.enabledTools)) {
        enabledTools = input.enabledTools;
        toolsJson = JSON.stringify(enabledTools);
      } else if (input.toolsJson !== undefined && input.toolsJson !== null) {
        toolsJson = input.toolsJson;
        try {
          const parsed = JSON.parse(input.toolsJson);
          if (Array.isArray(parsed)) enabledTools = parsed;
        } catch {}
      }

      const updated: HostedAgent = {
        ...agent,
        name: input.name !== undefined && input.name !== null ? input.name.trim() : agent.name,
        businessName: input.businessName !== undefined && input.businessName !== null ? input.businessName.trim() : agent.businessName,
        instructions: input.instructions !== undefined && input.instructions !== null ? input.instructions.trim() : agent.instructions,
        welcomeMessage: input.welcomeMessage !== undefined && input.welcomeMessage !== null ? input.welcomeMessage.trim() : agent.welcomeMessage,
        businessContext: input.businessContext !== undefined && input.businessContext !== null ? input.businessContext.trim() : agent.businessContext,
        appearanceJson: input.appearanceJson !== undefined && input.appearanceJson !== null ? input.appearanceJson : agent.appearanceJson,
        deploymentJson: input.deploymentJson !== undefined && input.deploymentJson !== null ? input.deploymentJson : agent.deploymentJson,
        toolsJson,
        enabledTools,
        version: agent.version + 1,
        updatedAt: now
      };

      this.store.put(COLLECTIONS.AGENTS, updated as any, updated.ownerId);
      this.logAudit(actor, 'AGENT_UPDATE', id, { version: updated.version });

      return this.formatAgent(updated);
    });
  }

  async setKnowledge(actor: Actor, id: string, knowledgeJson: string, expectedVersion: number): Promise<HostedAgent> {
    return this.transaction(() => {
      const agent = this.getAuthorized(actor, id);

      if (agent.version !== expectedVersion) {
        throw new Error(`Concurrency conflict: agent version is ${agent.version}, expected ${expectedVersion}`);
      }

      const verifiedJson = validateKnowledge(knowledgeJson);
      const now = this.nowIso();
      const updated: HostedAgent = {
        ...agent,
        knowledgeJson: verifiedJson,
        version: agent.version + 1,
        updatedAt: now
      };

      this.store.put(COLLECTIONS.AGENTS, updated as any, updated.ownerId);
      this.logAudit(actor, 'AGENT_SET_KNOWLEDGE', id, { version: updated.version });

      return this.formatAgent(updated);
    });
  }

  async publish(actor: Actor, id: string, mode: HostedAgentStatus, expectedVersion: number): Promise<HostedAgent> {
    return this.transaction(() => {
      HostedAgentStatusEnum.parse(mode);
      if ((mode === 'DEMO' || mode === 'ACTIVE') && actor.role !== 'ADMIN') throw new Error('Only administrators can publish agents');
      const agent = this.getAuthorized(actor, id);

      if (agent.version !== expectedVersion) {
        throw new Error(`Concurrency conflict: agent version is ${agent.version}, expected ${expectedVersion}`);
      }

      if (agent.type === 'INTERNAL_KNOWLEDGE' && (mode === 'DEMO' || mode === 'ACTIVE')) {
        throw new Error('Security restriction: INTERNAL_KNOWLEDGE agents cannot be published as public demos or embeds');
      }

      const now = this.nowIso();
      const updated: HostedAgent = {
        ...agent,
        status: mode,
        version: agent.version + 1,
        updatedAt: now
      };

      this.store.put(COLLECTIONS.AGENTS, updated as any, updated.ownerId);
      this.logAudit(actor, 'AGENT_PUBLISH', id, { previousStatus: agent.status, newStatus: mode });

      return this.formatAgent(updated);
    });
  }

  async disable(actor: Actor, id: string, expectedVersion: number): Promise<HostedAgent> {
    return this.publish(actor, id, 'DISABLED', expectedVersion);
  }

  async assignOwner(actor: Actor, id: string, newOwnerId: string, expectedVersion: number): Promise<HostedAgent> {
    return this.transaction(() => {
      if (actor.role !== 'ADMIN') throw new Error('Only administrators can transfer agent ownership');
      this.validateOwner(newOwnerId);

      const agent = this.getAuthorized(actor, id);
      if (agent.version !== expectedVersion) {
        throw new Error(`Concurrency conflict: agent version is ${agent.version}, expected ${expectedVersion}`);
      }

      const previousOwner = agent.ownerId;
      const now = this.nowIso();
      const updated: HostedAgent = {
        ...agent,
        ownerId: newOwnerId,
        status: 'DRAFT',
        version: agent.version + 1,
        updatedAt: now
      };

      const convs = this.store.list(COLLECTIONS.CONVERSATIONS) as unknown as HostedAgentConversation[];
      for (const c of convs) {
        if (c.agentId === agent.id) {
          const archivedConv = {
            ...c,
            status: 'ARCHIVED',
            updatedAt: now
          };
          delete (archivedConv as any).visitorTokenHash;
          this.store.put(COLLECTIONS.CONVERSATIONS, archivedConv as any, newOwnerId);
        }
      }

      this.store.put(COLLECTIONS.AGENTS, updated as any, newOwnerId);
      this.logAudit(actor, 'AGENT_ASSIGN_OWNER', id, { previousOwner, newOwner: newOwnerId });

      return this.formatAgent(updated);
    });
  }

  async conversations(actor: Actor, agentId: string, options: { offset?: number; limit?: number } = {}): Promise<HostedAgentConversationPage> {
    const agent = this.getAuthorized(actor, agentId);
    const offset = Math.max(0, options.offset || 0);
    const limit = Math.min(100, Math.max(1, options.limit || 25));

    const all = this.store.list(COLLECTIONS.CONVERSATIONS) as unknown as HostedAgentConversation[];
    const agentConvs = all.filter(c => c.agentId === agent.id && c.status !== 'ARCHIVED');

    agentConvs.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    const total = agentConvs.length;
    const pageItems = agentConvs.slice(offset, offset + limit);

    return {
      items: pageItems,
      total
    };
  }

  async leads(actor: Actor, agentId: string, options: { offset?: number; limit?: number } = {}): Promise<HostedAgentLeadPage> {
    const agent = this.getAuthorized(actor, agentId);
    const offset = Math.max(0, options.offset || 0);
    const limit = Math.min(100, Math.max(1, options.limit || 25));

    const all = this.store.list(COLLECTIONS.LEADS) as unknown as HostedAgentLead[];
    const agentLeads = all.filter(l => l.agentId === agent.id);

    agentLeads.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const total = agentLeads.length;
    const pageItems = agentLeads.slice(offset, offset + limit);

    return {
      items: pageItems,
      total
    };
  }

  async usage(actor: Actor, agentId: string): Promise<HostedAgentUsage> {
    const agent = this.getAuthorized(actor, agentId);
    const raw = this.store.get(COLLECTIONS.USAGE, agent.id);

    if (!raw) {
      return {
        conversations: 0,
        messages: 0,
        capturedLeads: 0,
        qualifiedLeads: 0,
        modelCalls: 0,
        failures: 0,
        averageLatencyMs: null
      };
    }

    return raw as unknown as HostedAgentUsage;
  }

  private incrementUsage(agentId: string, delta: Partial<HostedAgentUsage> & { latencySampleMs?: number }) {
    const current = (this.store.get(COLLECTIONS.USAGE, agentId) || {
      id: agentId,
      conversations: 0,
      messages: 0,
      capturedLeads: 0,
      qualifiedLeads: 0,
      modelCalls: 0,
      failures: 0,
      totalLatencyMs: 0
    }) as any;

    if (delta.conversations) current.conversations += delta.conversations;
    if (delta.messages) current.messages += delta.messages;
    if (delta.capturedLeads) current.capturedLeads += delta.capturedLeads;
    if (delta.qualifiedLeads) current.qualifiedLeads += delta.qualifiedLeads;
    if (delta.modelCalls) current.modelCalls += delta.modelCalls;
    if (delta.failures) current.failures += delta.failures;

    if (delta.latencySampleMs !== undefined) {
      current.totalLatencyMs = (current.totalLatencyMs || 0) + delta.latencySampleMs;
    }

    const calls = current.modelCalls || 0;
    current.averageLatencyMs = calls > 0 ? Math.round(current.totalLatencyMs / calls) : null;

    this.store.put(COLLECTIONS.USAGE, current);
  }

  // ==========================================
  // Tool Execution Auditing & Observability
  // ==========================================

  public recordToolExecution(record: ToolExecutionRecord, ownerId?: string): void {
    const sanitize = (value: any, depth = 0): any => {
      if (depth > 4) return '[TRUNCATED]';
      if (typeof value === 'string') return value.slice(0, 1000).replace(/(?:sk-|re_|vcp_|starli_op_)[a-zA-Z0-9_-]{8,}/g, '[REDACTED]');
      if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
      if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, depth + 1));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, /token|password|secret|authorization|cookie|api.?key|email|phone/i.test(key) ? '[REDACTED]' : sanitize(item, depth + 1)]));
      return undefined;
    };
    this.store.put(COLLECTIONS.TOOL_EXECUTIONS, {...record, input:sanitize(record.input), output:sanitize(record.output), error:record.error ? 'Tool execution failed' : undefined} as any, ownerId);
  }

  async toolExecutions(actor: Actor, agentId: string, limit = 50): Promise<ToolExecutionRecord[]> {
    const agent = this.getAuthorized(actor, agentId);
    const boundedLimit = Math.min(200, Math.max(1, limit));
    const all = this.store.list(COLLECTIONS.TOOL_EXECUTIONS) as unknown as ToolExecutionRecord[];
    const agentExecs = all.filter(r => r.agentId === agent.id);
    agentExecs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return agentExecs.slice(0, boundedLimit);
  }

  async toolMetrics(actor: Actor, agentId: string): Promise<ToolMetrics> {
    const agent = this.getAuthorized(actor, agentId);
    const all = this.store.list(COLLECTIONS.TOOL_EXECUTIONS) as unknown as ToolExecutionRecord[];
    const agentExecs = all.filter(r => r.agentId === agent.id);
    return calculateToolMetrics(agentExecs);
  }

  // ==========================================
  // Public Visitor Facing Methods
  // ==========================================

  async publicConfig(params: { slug?: string | null; publicId?: string | null }): Promise<HostedAgentPublic | null> {
    if (!params.slug && !params.publicId) return null;

    const all = this.store.list(COLLECTIONS.AGENTS) as unknown as HostedAgent[];
    const agent = all.find(a =>
      (params.publicId && a.publicId === params.publicId) ||
      (params.slug && a.slug === params.slug)
    );

    if (!agent) return null;

    if (agent.status !== 'DEMO' && agent.status !== 'ACTIVE') {
      return null;
    }

    if (agent.type === 'INTERNAL_KNOWLEDGE') {
      return null;
    }

    return {
      publicId: agent.publicId,
      slug: agent.slug,
      name: agent.name,
      businessName: agent.businessName,
      type: agent.type,
      status: agent.status,
      welcomeMessage: agent.welcomeMessage,
      appearanceJson: agent.appearanceJson
    };
  }

  async startConversation(params: { publicId: string; visitorMetadata?: Record<string, any>; ip?: string }): Promise<HostedAgentSession> {
    if (params.ip) {
      this.transaction(() => this.checkDurableRateLimit(
        `ip:${params.ip}:conv`,
        30,
        3600000,
        'Too many conversations from this IP address. Please try again later.'
      ));
    }

    const all = this.store.list(COLLECTIONS.AGENTS) as unknown as HostedAgent[];
    const rawAgent = all.find(a => a.publicId === params.publicId);

    if (!rawAgent) {
      throw new Error('Agent not found or unavailable');
    }

    const agent = this.formatAgent(rawAgent);

    if (agent.status !== 'DEMO' && agent.status !== 'ACTIVE') {
      throw new Error('This agent is not currently accepting conversations');
    }

    if (agent.type === 'INTERNAL_KNOWLEDGE') {
      throw new Error('Internal knowledge agents cannot be accessed publicly');
    }

    const conversationId = randomUUID();
    const visitorToken = randomBytes(32).toString('hex');
    const visitorTokenHash = this.hashToken(visitorToken);
    const now = this.nowIso();

    const conversation: HostedAgentConversation = {
      id: conversationId,
      agentId: agent.id,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      messages: [],
      visitorTokenHash,
      ownerIdAtCreation: agent.ownerId,
      visitorMetadata: params.visitorMetadata,
      lastIp: params.ip
    };

    let startedCursor = 0;
    this.transaction(() => {
      this.store.put(COLLECTIONS.CONVERSATIONS, conversation as any);
      this.incrementUsage(agent.id, { conversations: 1 });
      startedCursor = this.businessEvents.append({type:'agent.conversation_started', idempotencyKey:conversation.id, correlationId:conversation.id,
        metadata:{agentId:agent.id,conversationId:conversation.id,sessionId:conversation.id,ownerId:agent.ownerId,source:'HOSTED_AGENT',channel:'WEB',status:'STARTED'}}).cursor;
    });
    this.businessEvents.notifyCommitted(startedCursor);

    return {
      conversationId,
      visitorToken,
      welcomeMessage: agent.welcomeMessage || 'Hello! How can I help you today?'
    };
  }

  async chat(params: {
    publicId: string;
    conversationId: string;
    visitorToken: string;
    requestId: string;
    message: string;
    ip?: string;
  }): Promise<HostedAgentChatResult> {
    const rawMessage = (params.message || '').trim();
    if (rawMessage.length === 0 || rawMessage.length > 2000) {
      throw new Error('Message must be between 1 and 2000 characters');
    }

    // 1. Verify Agent
    const allAgents = this.store.list(COLLECTIONS.AGENTS) as unknown as HostedAgent[];
    const rawAgent = allAgents.find(a => a.publicId === params.publicId);
    if (!rawAgent || rawAgent.type === 'INTERNAL_KNOWLEDGE' || (rawAgent.status !== 'DEMO' && rawAgent.status !== 'ACTIVE')) {
      throw new Error('Agent not found or currently inactive');
    }
    const agent = this.formatAgent(rawAgent);

    // 2. Verify Conversation & Visitor Capability Token FIRST before checking cached responses
    const rawConv = this.store.get(COLLECTIONS.CONVERSATIONS, params.conversationId);
    if (!rawConv) {
      throw new Error('Conversation session not found');
    }
    const conversation = rawConv as unknown as HostedAgentConversation;
    if (conversation.agentId !== agent.id) {
      throw new Error('Conversation does not belong to this agent');
    }

    if ((conversation as any).ownerIdAtCreation && (conversation as any).ownerIdAtCreation !== agent.ownerId) {
      throw new Error('Conversation does not belong to current agent owner');
    }

    if (!conversation.visitorTokenHash || !this.verifyTokenHash(params.visitorToken, conversation.visitorTokenHash)) {
      throw new Error('Unauthorized visitor token for this conversation');
    }

    if (conversation.status !== 'ACTIVE' || this.clock() - Date.parse(conversation.createdAt) > 86400000) {
      throw new Error('Conversation session expired');
    }

    if (typeof params.requestId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(params.requestId)) {
      throw new Error('Invalid request identifier');
    }

    const requestKey = this.hashToken(conversation.id + ':' + params.requestId);
    const receivedMessageId = 'msg-' + requestKey.slice(0,32);
    let receivedCursor: number | undefined;
    let leadCursor: number | undefined;
    const fingerprint = this.hashToken(rawMessage);
    const leaseId = randomUUID();

    // 3. Idempotency check via requestId ONLY after visitor token authentication succeeds
    const cached = this.transaction(() => {
      const currentAgent = this.store.get(COLLECTIONS.AGENTS, agent.id);
      if (!currentAgent || currentAgent.version !== agent.version || currentAgent.ownerId !== agent.ownerId || !['DEMO','ACTIVE'].includes(currentAgent.status)) {
        throw new Error('Agent configuration changed; please retry');
      }
      const freshConversation = this.store.get(COLLECTIONS.CONVERSATIONS, conversation.id);
      if (!freshConversation || freshConversation.agentId !== agent.id || freshConversation.status !== 'ACTIVE' || !this.verifyTokenHash(params.visitorToken, freshConversation.visitorTokenHash || '')) {
        throw new Error('Conversation session unavailable');
      }
      Object.assign(conversation, freshConversation);
      const existing = this.store.get(COLLECTIONS.REQUESTS, requestKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error('Request identifier already used for different content');
        if (existing.status === 'SUCCEEDED') return existing.result as HostedAgentChatResult;
      }
      const lock = this.store.get(COLLECTIONS.REQUESTS, 'lock:' + conversation.id);
      if (lock && lock.expiresAt > this.clock()) throw new Error('Conversation turn already in progress; retry the same request shortly');
      this.store.put(COLLECTIONS.REQUESTS, { id: 'lock:' + conversation.id, leaseId, expiresAt: this.clock() + 120000 });
      this.store.put(COLLECTIONS.REQUESTS, { id: requestKey, conversationId: conversation.id, fingerprint, status: 'PENDING', createdAt: this.nowIso() });
      receivedCursor=this.businessEvents.append({type:'agent.message_received',idempotencyKey:requestKey,correlationId:conversation.id,metadata:{agentId:agent.id,conversationId:conversation.id,sessionId:conversation.id,ownerId:agent.ownerId,messageId:receivedMessageId,messageCount:1,source:'HOSTED_AGENT',channel:'WEB',status:'RECEIVED'}}).cursor;
      return null;
    });
    if (cached) return cached;
    if(receivedCursor!==undefined)this.businessEvents.notifyCommitted(receivedCursor);

    try {
      // 4. Durable quota controls: per-conversation session limit, per-IP rate limit, per-agent daily quota
      const currentMessages: HostedAgentMessage[] = Array.isArray(conversation.messages) ? [...conversation.messages] : [];
      if (currentMessages.length >= 60) {
        throw new Error('This session has reached its 60-message limit.');
      }

      if (params.ip) {
        this.transaction(() => this.checkDurableRateLimit(
          `ip:${params.ip}:chat`,
          120,
          3600000,
          'Too many messages from this IP address. Please try again later.'
        ));
      }

      this.transaction(() => this.checkDurableRateLimit(
        `agent:${agent.id}:daily_model_calls`,
        500,
        86400000,
        'This agent has reached its daily message quota.'
      ));

      const now = this.nowIso();

      // Append User Message
      const userMessage: HostedAgentMessage = {
        id: receivedMessageId,
        conversationId: conversation.id,
        role: 'user',
        content: rawMessage,
        createdAt: now
      };
      currentMessages.push(userMessage);

      // Build Initial Model Messages
      const systemPrompt = buildAgentSystemPrompt(agent);
      const recentTurns = currentMessages.slice(-10); // Bounded history
      const openRouterMessages: Array<{
        role: 'system' | 'user' | 'assistant' | 'tool';
        content?: string | null;
        tool_calls?: any[];
        tool_call_id?: string;
      }> = [
        { role: 'system' as const, content: systemPrompt },
        ...recentTurns.map(m => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: m.content
        }))
      ];

      const abortTurn = new AbortController();
      const startedWall = Date.now(), startedClock = this.clock();
      const remainingTurnMs = () => Math.max(0, Math.min(this.turnTimeoutMs - (Date.now() - startedWall), this.turnTimeoutMs - (this.clock() - startedClock)));
      const assertTurnCurrent = () => {
        this.transaction(() => {
          const current = this.store.get(COLLECTIONS.AGENTS, agent.id);
          const lock = this.store.get(COLLECTIONS.REQUESTS, 'lock:' + conversation.id);
          const session = this.store.get(COLLECTIONS.CONVERSATIONS, conversation.id);
          if (!current || current.version !== agent.version || current.ownerId !== agent.ownerId || !['DEMO','ACTIVE'].includes(current.status) || lock?.leaseId !== leaseId || lock.expiresAt <= this.clock() || session?.status !== 'ACTIVE' || session.agentId !== agent.id) throw new AgentTurnGuardError('Agent configuration changed while responding; please retry');
        });
        if (!remainingTurnMs() || abortTurn.signal.aborted) throw new AgentTurnGuardError('Agent turn deadline exceeded');
      };
      const boundedTurnWork = async <T>(work: () => Promise<T>): Promise<T> => {
        assertTurnCurrent();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { abortTurn.abort(); reject(new Error('Agent turn deadline exceeded')); }, remainingTurnMs()); })]);
        } finally { if (timer) clearTimeout(timer); }
      };
      const completeTurn = async (options: Parameters<OpenRouterModelRouter['complete']>[0]) => {
        assertTurnCurrent();
        try { this.transaction(() => this.checkDurableRateLimit('global:daily_model_calls', this.dailyBudget, 86400000, 'Platform model quota reached', 3)); } catch (error) { if (error instanceof Error && error.message === 'Platform model quota reached') throw new AgentTurnGuardError(error.message); throw error; }
        const result = await boundedTurnWork(() => this.router.complete({...options, timeoutMs: remainingTurnMs(), signal: abortTurn.signal}));
        assertTurnCurrent();
        return result;
      };

      // 5. Complete Turn with OpenRouter Router + Tool Execution Loop
      let completionReply = '';
      let latencyMs = 0;
      let totalModelCalls = 0;

      try {
        const enabledToolIds = this.getAgentEnabledTools(agent);
        const enabledToolSet = new Set(enabledToolIds);
        const activeTools = enabledToolIds
          .map(id => this.toolRegistry.get(id))
          .filter((t): t is AgentTool => t !== undefined && ['READ_ONLY','AUTO_EXECUTE'].includes(t.permissionLevel));
        const openAITools = activeTools.length > 0 ? toOpenAITools(activeTools) : undefined;

        let currentLoopTurns = [...openRouterMessages];
        let round = 0;
        const MAX_TOOL_ROUNDS = 5;
        const executedCallsInTurn = new Set<string>();

        while (round < MAX_TOOL_ROUNDS) {
          round++;
          totalModelCalls++;

          const completion = await completeTurn({
            messages: currentLoopTurns,
            temperature: 0.3,
            maxTokens: 800,
            tools: openAITools,
            toolChoice: openAITools ? 'auto' : undefined
          });

          latencyMs += completion.latencyMs;

          // If no tool calls requested, we have our assistant text response
          if (!completion.toolCalls || completion.toolCalls.length === 0) {
            completionReply = completion.reply || '';
            break;
          }

          // Model requested tool calling: append assistant message with tool_calls
          currentLoopTurns.push({
            role: 'assistant',
            content: completion.reply || '',
            tool_calls: completion.toolCalls
          });

          // Execute each tool call requested in this turn
          if (completion.toolCalls.length > 8) throw new Error('Too many tool calls in one round');
          for (const toolCall of completion.toolCalls) {
            assertTurnCurrent();
            const toolName = toolCall.function.name;
            const rawArgs = toolCall.function.arguments;
            if (typeof rawArgs !== 'string' || rawArgs.length > 8192 || typeof toolName !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(toolName)) throw new Error('Invalid tool call');
            const callSignature = `${toolName}:${rawArgs}`;

            let parsedArgs: any = {};
            try {
              parsedArgs = JSON.parse(rawArgs);
            } catch {
              throw new Error('Invalid tool arguments');
            }

            let toolResult: AgentToolResult;

            // Loop detection: identical tool called with identical arguments in the same turn
            if (executedCallsInTurn.has(callSignature)) {
              toolResult = {
                success: false,
                error: `Loop detected: tool "${toolName}" was already executed with identical arguments in this turn.`
              };
            } else {
              executedCallsInTurn.add(callSignature);

              const tool = this.toolRegistry.get(toolName);
              if (!tool || !enabledToolSet.has(toolName)) {
                toolResult = {
                  success: false,
                  error: `Tool "${toolName}" is not registered or not available.`
                };
              } else if (!['READ_ONLY','AUTO_EXECUTE'].includes(tool.permissionLevel)) {
                toolResult = {
                  success: false,
                  error: `Permission requirement: Tool "${toolName}" requires explicit confirmation before execution.`
                };
              } else {
                const callStart = Date.now();
                const toolContext: AgentToolContext = {
                  agentId: agent.id,
                  conversationId: conversation.id,
                  visitorToken: params.visitorToken,
                  requestId: params.requestId,
                  tenantId: agent.ownerId,
                  agentConfig: agent,
                  store: this.store,
                  signal: abortTurn.signal
                };

                assertTurnCurrent();
                toolResult = await boundedTurnWork(() => this.toolRegistry.execute(toolName, parsedArgs, toolContext));
                assertTurnCurrent();
                const duration = Date.now() - callStart;

                // Record audit trace in store
                this.recordToolExecution({
                  id: randomUUID(),
                  agentId: agent.id,
                  conversationId: conversation.id,
                  toolName,
                  toolCategory: tool.category,
                  input: parsedArgs,
                  output: toolResult.data,
                  success: toolResult.success,
                  error: toolResult.error,
                  durationMs: duration,
                  permissionLevel: tool.permissionLevel,
                  createdAt: this.nowIso()
                }, agent.ownerId);
              }
            }

            if (JSON.stringify(toolResult).length > 16000) toolResult = {success:false,error:'Tool result exceeded maximum size'};
            // Append tool execution result message
            currentLoopTurns.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult).slice(0, 16000)
            });
          }
        }

        // If maximum rounds reached and still no final text reply, summarize gracefully
        if (!completionReply.trim()) {
          totalModelCalls++;
          const finalTurn = await completeTurn({
            messages: [
              ...currentLoopTurns,
              {
                role: 'user',
                content: 'Please summarize the findings and provide your response to the user based on the tool results above.'
              }
            ],
            temperature: 0.3,
            maxTokens: 800
          });
          latencyMs += finalTurn.latencyMs;
          completionReply = finalTurn.reply || 'I processed your request.';
        }

      } catch (err: any) {
        this.transaction(() => { if (this.store.get(COLLECTIONS.AGENTS, agent.id)?.ownerId === agent.ownerId) this.incrementUsage(agent.id, { failures: 1 }); });
        abortTurn.abort();
        if (err instanceof AgentTurnGuardError) throw err;
        throw new Error('AI Agent is temporarily busy. Please try again shortly.');
      }

      assertTurnCurrent();
      abortTurn.abort();
      const completed = this.transaction(() => {
        const current = this.store.get(COLLECTIONS.AGENTS, agent.id);
        const lock = this.store.get(COLLECTIONS.REQUESTS, 'lock:' + conversation.id);
        if (!current || current.version !== agent.version || current.ownerId !== agent.ownerId || !['DEMO','ACTIVE'].includes(current.status) || lock?.leaseId !== leaseId || lock.expiresAt <= this.clock()) {
          throw new Error('Agent configuration changed while responding; please retry');
        }

        this.incrementUsage(agent.id, { modelCalls: totalModelCalls, latencySampleMs: latencyMs });

        // Create Assistant Message
        const assistantMessage: HostedAgentMessage = {
          id: randomUUID(),
          conversationId: conversation.id,
          role: 'assistant',
          content: completionReply,
          createdAt: this.nowIso()
        };
        currentMessages.push(assistantMessage);

        // Check & Extract Lead
        let capturedLead = false;
        const existingLeadRaw = this.store.get(COLLECTIONS.LEADS, conversation.id);
        const existingLeadData = existingLeadRaw as unknown as HostedAgentLead | undefined;

        const extracted = extractLeadFromMessages(currentMessages, existingLeadData || undefined);

        if (extracted && (extracted.email || extracted.phone)) {
          const leadRecord: HostedAgentLead = {
            id: conversation.id,
            agentId: agent.id,
            conversationId: conversation.id,
            name: extracted.name || null,
            email: extracted.email || null,
            phone: extracted.phone || null,
            requestedService: extracted.requestedService || null,
            location: extracted.location || null,
            budget: extracted.budget || null,
            timeframe: extracted.timeframe || null,
            intent: extracted.intent || null,
            summary: extracted.summary || null,
            score: extracted.score || 50,
            createdAt: existingLeadData?.createdAt || this.nowIso(),
            updatedAt: this.nowIso()
          };

          this.store.put(COLLECTIONS.LEADS, leadRecord as any, agent.ownerId);

          if (!existingLeadData) {
            capturedLead = true;
            leadCursor=this.businessEvents.append({type:'agent.lead_captured',idempotencyKey:conversation.id,correlationId:conversation.id,
              metadata:{agentId:agent.id,conversationId:conversation.id,sessionId:conversation.id,ownerId:agent.ownerId,leadId:leadRecord.id,hasContact:true,hasEmail:!!leadRecord.email,hasPhone:!!leadRecord.phone,source:'HOSTED_AGENT',channel:'WEB',status:'CAPTURED'}}).cursor;
            this.incrementUsage(agent.id, {
              capturedLeads: 1,
              qualifiedLeads: (extracted.score || 0) >= 60 ? 1 : 0
            });
          }
        }

        // Update Conversation
        conversation.messages = currentMessages;
        conversation.updatedAt = this.nowIso();
        if (params.ip) conversation.lastIp = params.ip;
        if (extracted?.summary) conversation.summary = extracted.summary;
        if (extracted?.intent) conversation.qualification = extracted.intent;

        this.store.put(COLLECTIONS.CONVERSATIONS, conversation as any);
        this.incrementUsage(agent.id, { messages: 2 });

        const result: HostedAgentChatResult = {
          conversationId: conversation.id,
          message: assistantMessage,
          capturedLead
        };

        // Save Idempotency Request Record
        this.store.put(COLLECTIONS.REQUESTS, {
          id: requestKey,
          fingerprint,
          status: 'SUCCEEDED',
          conversationId: conversation.id,
          result,
          createdAt: this.nowIso()
        });

        return result;
      });
      if(leadCursor!==undefined)this.businessEvents.notifyCommitted(leadCursor);
      return completed;
    } finally {
      this.transaction(() => {
        const lock = this.store.get(COLLECTIONS.REQUESTS, 'lock:' + conversation.id);
        if (lock?.leaseId === leaseId) {
          this.store.remove(COLLECTIONS.REQUESTS, 'lock:' + conversation.id);
          const request = this.store.get(COLLECTIONS.REQUESTS, requestKey);
          if (request?.status === 'PENDING') this.store.put(COLLECTIONS.REQUESTS, { ...request, status: 'FAILED' });
        }
      });
    }
  }
}
