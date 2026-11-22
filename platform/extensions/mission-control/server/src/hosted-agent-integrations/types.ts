export type HostedAgentType =
  | 'SALES'
  | 'SUPPORT'
  | 'BOOKING'
  | 'LEAD_QUALIFICATION'
  | 'ECOMMERCE'
  | 'INTERNAL_KNOWLEDGE'
  | 'CUSTOM';

export type HostedAgentStatus = 'DRAFT' | 'DEMO' | 'ACTIVE' | 'DISABLED';

export interface HostedAgentActor {
  userId: string;
  role: 'ADMIN' | 'CUSTOMER';
}

export interface HostedAgentRecord {
  id: string;
  ownerId: string;
  publicId: string;
  name: string;
  businessName: string;
  slug: string;
  type: HostedAgentType;
  status: HostedAgentStatus;
  instructions: string;
  welcomeMessage: string;
  businessContext: string;
  knowledgeJson: string;
  appearanceJson: string;
  deploymentJson: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HostedAgentPublic {
  publicId: string;
  slug: string;
  name: string;
  businessName: string;
  type: HostedAgentType;
  status: HostedAgentStatus;
  welcomeMessage: string;
  appearanceJson: string;
}

export interface HostedAgentMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface HostedAgentConversation {
  id: string;
  agentId: string;
  status: string;
  summary?: string | null;
  qualification?: string | null;
  createdAt: string;
  updatedAt: string;
  messages: HostedAgentMessage[];
}

export interface HostedAgentLead {
  id: string;
  agentId: string;
  conversationId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  requestedService?: string | null;
  location?: string | null;
  budget?: string | null;
  timeframe?: string | null;
  intent?: string | null;
  summary?: string | null;
  score?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostedAgentUsage {
  conversations: number;
  messages: number;
  capturedLeads: number;
  qualifiedLeads: number;
  modelCalls: number;
  failures: number;
  averageLatencyMs?: number | null;
}

export interface HostedAgentSession {
  conversationId: string;
  visitorToken: string;
  welcomeMessage: string;
}

export interface HostedAgentChatResult {
  conversationId: string;
  message: HostedAgentMessage;
  capturedLead: boolean;
}

export interface HostedAgentServiceLike {
  list(actor: HostedAgentActor, filter?: { adminAll?: boolean; status?: HostedAgentStatus }): Promise<HostedAgentRecord[]> | HostedAgentRecord[];
  get(actor: HostedAgentActor, id: string): Promise<HostedAgentRecord> | HostedAgentRecord;
  create(actor: HostedAgentActor, input: any): Promise<HostedAgentRecord> | HostedAgentRecord;
  update(actor: HostedAgentActor, id: string, input: any, expectedVersion: number): Promise<HostedAgentRecord> | HostedAgentRecord;
  setKnowledge(actor: HostedAgentActor, id: string, knowledgeJson: string, expectedVersion: number): Promise<HostedAgentRecord> | HostedAgentRecord;
  publish(actor: HostedAgentActor, id: string, mode: HostedAgentStatus, expectedVersion: number): Promise<HostedAgentRecord> | HostedAgentRecord;
  disable(actor: HostedAgentActor, id: string, expectedVersion: number): Promise<HostedAgentRecord> | HostedAgentRecord;
  assignOwner(actor: HostedAgentActor, id: string, ownerId: string, expectedVersion: number): Promise<HostedAgentRecord> | HostedAgentRecord;
  conversations(actor: HostedAgentActor, agentId: string, pagination?: { offset?: number; limit?: number }): Promise<{ items: HostedAgentConversation[]; total: number }> | { items: HostedAgentConversation[]; total: number };
  leads(actor: HostedAgentActor, agentId: string, pagination?: { offset?: number; limit?: number }): Promise<{ items: HostedAgentLead[]; total: number }> | { items: HostedAgentLead[]; total: number };
  usage(actor: HostedAgentActor, agentId: string): Promise<HostedAgentUsage> | HostedAgentUsage;
  publicConfig(query: { slug?: string; publicId?: string }): Promise<HostedAgentPublic | null> | HostedAgentPublic | null;
  startConversation(args: { publicId: string; visitorMetadata?: Record<string, unknown>; ip?: string }): Promise<HostedAgentSession> | HostedAgentSession;
  chat(args: { publicId: string; conversationId: string; visitorToken: string; requestId: string; message: string; ip?: string }): Promise<HostedAgentChatResult> | HostedAgentChatResult;
}
