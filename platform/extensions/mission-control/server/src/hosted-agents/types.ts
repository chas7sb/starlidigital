import { z } from 'zod';
export * from './tools/types.js';

export const HostedAgentTypeEnum = z.enum([
  'SALES',
  'SUPPORT',
  'BOOKING',
  'LEAD_QUALIFICATION',
  'ECOMMERCE',
  'INTERNAL_KNOWLEDGE',
  'CUSTOM'
]);
export type HostedAgentType = z.infer<typeof HostedAgentTypeEnum>;

export const HostedAgentStatusEnum = z.enum([
  'DRAFT',
  'DEMO',
  'ACTIVE',
  'DISABLED'
]);
export type HostedAgentStatus = z.infer<typeof HostedAgentStatusEnum>;

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
  toolsJson?: string;
  enabledTools?: string[];
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
  visitorTokenHash?: string;
  ownerIdAtCreation?: string;
  visitorMetadata?: Record<string, any>;
  lastIp?: string;
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
  averageLatencyMs: number | null;
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
  ownerId?: string | null;
  name: string;
  businessName: string;
  slug?: string | null;
  type: HostedAgentType;
  instructions?: string | null;
  welcomeMessage?: string | null;
  businessContext?: string | null;
  knowledgeJson?: string | null;
  appearanceJson?: string | null;
  deploymentJson?: string | null;
  toolsJson?: string | null;
  enabledTools?: string[] | null;
}

export interface HostedAgentUpdateInput {
  name?: string | null;
  businessName?: string | null;
  instructions?: string | null;
  welcomeMessage?: string | null;
  businessContext?: string | null;
  appearanceJson?: string | null;
  deploymentJson?: string | null;
  toolsJson?: string | null;
  enabledTools?: string[] | null;
}

export interface Actor {
  userId: string;
  role: 'ADMIN' | 'CUSTOMER';
  principal?: string;
}

export interface StructuredKnowledge {
  companyDescription?: string;
  productsAndServices?: Array<{
    name: string;
    description?: string;
    price?: string;
    features?: string[];
  }>;
  locations?: Array<{
    address?: string;
    city?: string;
    operatingHours?: string;
  }>;
  openingHours?: string;
  pricingDetails?: string;
  faqs?: Array<{
    question: string;
    answer: string;
  }>;
  policies?: {
    cancellation?: string;
    refund?: string;
    privacy?: string;
    terms?: string;
  };
  contactInfo?: {
    phone?: string;
    email?: string;
    website?: string;
    emergencyContact?: string;
  };
  customKnowledgeText?: string;
}

export interface AgentAppearance {
  title?: string;
  subtitle?: string;
  placeholderText?: string;
  quickPrompts?: string[];
  primaryColor?: string;
  accentColor?: string;
  headerBackground?: string;
  botAvatarUrl?: string;
  botName?: string;
  launcherIcon?: 'chat' | 'message' | 'sparkle' | 'headset';
  position?: 'bottom-right' | 'bottom-left';
  greetingTitle?: string;
  greetingSubtitle?: string;
}

export interface AgentDeployment {
  allowedDomains?: string[];
  enablePublicEmbed?: boolean;
  enableAnonymousDemo?: boolean;
  requireLeadBeforeChat?: boolean;
  notificationEmail?: string;
}

export interface ExtractedLeadData {
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
}
