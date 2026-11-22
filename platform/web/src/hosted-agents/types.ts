export type HostedAgentType =
  | 'SALES'
  | 'SUPPORT'
  | 'BOOKING'
  | 'LEAD_QUALIFICATION'
  | 'ECOMMERCE'
  | 'INTERNAL_KNOWLEDGE'
  | 'CUSTOM';

export type HostedAgentStatus = 'DRAFT' | 'DEMO' | 'ACTIVE' | 'DISABLED';

export interface HostedAgentAppearance {
  primaryColor?: string;
  theme?: 'dark' | 'light' | 'auto';
  title?: string;
  subtitle?: string;
  avatarUrl?: string;
  placeholderText?: string;
  position?: 'bottom-right' | 'bottom-left';
  greetingTitle?: string;
  quickPrompts?: string[];
}

export interface HostedAgentDeployment {
  allowedDomains?: string[];
  enableEmbed?: boolean;
  enablePublicDemo?: boolean;
}

export interface HostedAgentStructuredKnowledge {
  companyDescription?: string;
  productsAndServices?: string;
  pricingPolicy?: string;
  openingHours?: string;
  locations?: string;
  contactDetails?: string;
  frequentlyAskedQuestions?: string;
  customRules?: string;
}

export interface HostedAgent {
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

export interface HostedAgentConversationPage {
  items: HostedAgentConversation[];
  total: number;
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

export interface HostedAgentLeadPage {
  items: HostedAgentLead[];
  total: number;
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

export interface HostedAgentCreateInput {
  ownerId?: string;
  name: string;
  businessName: string;
  slug?: string;
  type: HostedAgentType;
  instructions?: string;
  welcomeMessage?: string;
  businessContext?: string;
  knowledgeJson?: string;
  appearanceJson?: string;
  deploymentJson?: string;
}

export interface HostedAgentUpdateInput {
  name?: string;
  businessName?: string;
  instructions?: string;
  welcomeMessage?: string;
  businessContext?: string;
  appearanceJson?: string;
  deploymentJson?: string;
}
