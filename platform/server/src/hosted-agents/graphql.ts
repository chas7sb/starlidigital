import { GraphQLError } from 'graphql';
import type { HostedAgentService } from './service.js';
import type { Actor } from './types.js';
import { requireUser, type Context } from '../security.js';

export const hostedAgentTypeDefs = `#graphql
  input VisitorPresenceInput {
    sessionId: ID!
    conversationId: ID!
    visitorToken: String!
    route: String
    referrer: String
    campaign: String
    enabled: Boolean!
    dismissed: Boolean
  }
  extend type Subscription {
    visitorMessage(conversationId: ID!, visitorToken: String!): HostedAgentMessage!
  }
  enum HostedAgentType {
    SALES
    SUPPORT
    BOOKING
    LEAD_QUALIFICATION
    ECOMMERCE
    INTERNAL_KNOWLEDGE
    CUSTOM
  }

  enum HostedAgentStatus {
    DRAFT
    DEMO
    ACTIVE
    DISABLED
  }

  type HostedAgent {
    id: ID!
    ownerId: ID!
    publicId: String!
    name: String!
    businessName: String!
    slug: String!
    type: HostedAgentType!
    status: HostedAgentStatus!
    instructions: String!
    welcomeMessage: String!
    businessContext: String!
    knowledgeJson: String!
    appearanceJson: String!
    deploymentJson: String!
    toolsJson: String
    enabledTools: [String!]!
    version: Int!
    createdAt: String!
    updatedAt: String!
  }

  type HostedAgentPublic {
    publicId: String!
    slug: String!
    name: String!
    businessName: String!
    type: HostedAgentType!
    status: HostedAgentStatus!
    welcomeMessage: String!
    appearanceJson: String!
  }

  type HostedAgentMessage {
    id: ID!
    conversationId: ID!
    role: String!
    content: String!
    createdAt: String!
  }

  type HostedAgentConversation {
    id: ID!
    agentId: ID!
    status: String!
    summary: String
    qualification: String
    createdAt: String!
    updatedAt: String!
    messages: [HostedAgentMessage!]!
  }

  type HostedAgentConversationPage {
    items: [HostedAgentConversation!]!
    total: Int!
  }

  type HostedAgentLead {
    id: ID!
    agentId: ID!
    conversationId: ID!
    name: String
    email: String
    phone: String
    requestedService: String
    location: String
    budget: String
    timeframe: String
    intent: String
    summary: String
    score: Int
    createdAt: String!
    updatedAt: String!
  }

  type HostedAgentLeadPage {
    items: [HostedAgentLead!]!
    total: Int!
  }

  type HostedAgentUsage {
    conversations: Int!
    messages: Int!
    capturedLeads: Int!
    qualifiedLeads: Int!
    modelCalls: Int!
    failures: Int!
    averageLatencyMs: Float
  }

  type HostedAgentSession {
    conversationId: ID!
    visitorToken: String!
    welcomeMessage: String!
  }

  type HostedAgentChatResult {
    conversationId: ID!
    message: HostedAgentMessage!
    capturedLead: Boolean!
  }

  type HostedAgentToolExecution {
    id: ID!
    agentId: ID!
    conversationId: ID!
    toolName: String!
    toolCategory: String!
    inputJson: String!
    outputJson: String
    success: Boolean!
    error: String
    durationMs: Int!
    permissionLevel: String!
    createdAt: String!
  }

  type HostedAgentToolMetrics {
    totalExecutions: Int!
    successfulExecutions: Int!
    failedExecutions: Int!
    averageDurationMs: Float
    byToolJson: String!
  }

  input HostedAgentCreateInput {
    ownerId: ID
    name: String!
    businessName: String!
    slug: String
    type: HostedAgentType!
    instructions: String
    welcomeMessage: String
    businessContext: String
    knowledgeJson: String
    appearanceJson: String
    deploymentJson: String
    toolsJson: String
    enabledTools: [String!]
  }

  input HostedAgentUpdateInput {
    name: String
    businessName: String
    instructions: String
    welcomeMessage: String
    businessContext: String
    appearanceJson: String
    deploymentJson: String
    toolsJson: String
    enabledTools: [String!]
  }

  extend type Query {
    visitorListActive(agentId: ID!): String!
    visitorGetSession(id: ID!): String!
    visitorGetContext(id: ID!): String!
    visitorMessages(conversationId: ID!, visitorToken: String!): [HostedAgentMessage!]!
    hostedAgents(adminAll: Boolean = false, status: HostedAgentStatus): [HostedAgent!]!
    hostedAgent(id: ID!): HostedAgent!
    hostedAgentPublic(slug: String, publicId: String): HostedAgentPublic
    hostedAgentConversations(agentId: ID!, offset: Int = 0, limit: Int = 25): HostedAgentConversationPage!
    hostedAgentLeads(agentId: ID!, offset: Int = 0, limit: Int = 25): HostedAgentLeadPage!
    hostedAgentUsage(agentId: ID!): HostedAgentUsage!
    hostedAgentToolExecutions(agentId: ID!, limit: Int = 50): [HostedAgentToolExecution!]!
    hostedAgentToolMetrics(agentId: ID!): HostedAgentToolMetrics!
  }

  extend type Mutation {
    visitorPresence(input: VisitorPresenceInput!): Boolean!
    visitorSendMessage(id: ID!, topic: String): HostedAgentMessage!
    hostedAgentCreate(input: HostedAgentCreateInput!): HostedAgent!
    hostedAgentUpdate(id: ID!, input: HostedAgentUpdateInput!, expectedVersion: Int!): HostedAgent!
    hostedAgentSetKnowledge(id: ID!, knowledgeJson: String!, expectedVersion: Int!): HostedAgent!
    hostedAgentPublish(id: ID!, mode: HostedAgentStatus!, expectedVersion: Int!): HostedAgent!
    hostedAgentDisable(id: ID!, expectedVersion: Int!): HostedAgent!
    hostedAgentAssignOwner(id: ID!, ownerId: ID!, expectedVersion: Int!): HostedAgent!
    hostedAgentStartConversation(publicId: String!): HostedAgentSession!
    hostedAgentSendMessage(publicId: String!, conversationId: ID!, visitorToken: String!, requestId: String!, message: String!): HostedAgentChatResult!
  }
`;

function getActor(context: Context): Actor {
  const user = requireUser(context);
  return {
    userId: user.id,
    role: user.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER',
    principal: user.username || user.id
  };
}

export function createHostedAgentGraphQL({ service }: { service: HostedAgentService }) {
  const resolvers = {
    Subscription: {
      visitorMessage: {
        subscribe: (_: any, args: any) => service.visitors.subscribe(args.conversationId, args.visitorToken),
        resolve: (message: any) => message
      }
    },
    Query: {
      visitorListActive: (_: any, {agentId}: any, context: Context) => JSON.stringify(service.visitors.listActive(getActor(context), agentId)),
      visitorGetSession: (_: any, {id}: any, context: Context) => JSON.stringify(service.visitors.getSession(getActor(context), id)),
      visitorGetContext: (_: any, {id}: any, context: Context) => JSON.stringify(service.visitors.getContext(getActor(context), id)),
      visitorMessages: (_: any, args: any) => service.visitors.messages(args.conversationId, args.visitorToken),
      hostedAgents: async (_: any, args: { adminAll?: boolean; status?: any }, context: Context) => {
        const actor = getActor(context);
        return service.list(actor, args);
      },
      hostedAgent: async (_: any, { id }: { id: string }, context: Context) => {
        const actor = getActor(context);
        return service.get(actor, id);
      },
      hostedAgentPublic: async (_: any, args: { slug?: string; publicId?: string }) => {
        return service.publicConfig(args);
      },
      hostedAgentConversations: async (_: any, args: { agentId: string; offset?: number; limit?: number }, context: Context) => {
        const actor = getActor(context);
        return service.conversations(actor, args.agentId, args);
      },
      hostedAgentLeads: async (_: any, args: { agentId: string; offset?: number; limit?: number }, context: Context) => {
        const actor = getActor(context);
        return service.leads(actor, args.agentId, args);
      },
      hostedAgentUsage: async (_: any, { agentId }: { agentId: string }, context: Context) => {
        const actor = getActor(context);
        return service.usage(actor, agentId);
      },
      hostedAgentToolExecutions: async (_: any, args: { agentId: string; limit?: number }, context: Context) => {
        const actor = getActor(context);
        const records = await service.toolExecutions(actor, args.agentId, args.limit);
        return records.map(r => ({
          ...r,
          inputJson: JSON.stringify(r.input || {}),
          outputJson: r.output ? JSON.stringify(r.output) : null
        }));
      },
      hostedAgentToolMetrics: async (_: any, { agentId }: { agentId: string }, context: Context) => {
        const actor = getActor(context);
        const metrics = await service.toolMetrics(actor, agentId);
        return {
          totalExecutions: metrics.totalExecutions,
          successfulExecutions: metrics.successfulExecutions,
          failedExecutions: metrics.failedExecutions,
          averageDurationMs: metrics.averageDurationMs,
          byToolJson: JSON.stringify(metrics.byTool || {})
        };
      }
    },
    Mutation: {
      visitorPresence: (_: any, {input}: any) => service.visitors.update(input),
      visitorSendMessage: (_: any, {id, topic}: any, context: Context) => service.visitors.sendMessage(getActor(context), id, topic),
      hostedAgentCreate: async (_: any, { input }: { input: any }, context: Context) => {
        const actor = getActor(context);
        return service.create(actor, input);
      },
      hostedAgentUpdate: async (_: any, { id, input, expectedVersion }: { id: string; input: any; expectedVersion: number }, context: Context) => {
        const actor = getActor(context);
        return service.update(actor, id, input, expectedVersion);
      },
      hostedAgentSetKnowledge: async (_: any, { id, knowledgeJson, expectedVersion }: { id: string; knowledgeJson: string; expectedVersion: number }, context: Context) => {
        const actor = getActor(context);
        return service.setKnowledge(actor, id, knowledgeJson, expectedVersion);
      },
      hostedAgentPublish: async (_: any, { id, mode, expectedVersion }: { id: string; mode: any; expectedVersion: number }, context: Context) => {
        const actor = getActor(context);
        return service.publish(actor, id, mode, expectedVersion);
      },
      hostedAgentDisable: async (_: any, { id, expectedVersion }: { id: string; expectedVersion: number }, context: Context) => {
        const actor = getActor(context);
        return service.disable(actor, id, expectedVersion);
      },
      hostedAgentAssignOwner: async (_: any, { id, ownerId, expectedVersion }: { id: string; ownerId: string; expectedVersion: number }, context: Context) => {
        const actor = getActor(context);
        return service.assignOwner(actor, id, ownerId, expectedVersion);
      },
      hostedAgentStartConversation: async (_: any, { publicId }: { publicId: string }, context: Context) => {
        return service.startConversation({ publicId, ip: context.ip });
      },
      hostedAgentSendMessage: async (_: any, args: { publicId: string; conversationId: string; visitorToken: string; requestId: string; message: string }, context: Context) => {
        try {
          return await service.chat({
            publicId: args.publicId,
            conversationId: args.conversationId,
            visitorToken: args.visitorToken,
            requestId: args.requestId,
            message: args.message,
            ip: context.ip
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'AI Agent is temporarily busy. Please try again shortly.') {
            throw new GraphQLError(error.message, { extensions: { code: 'AI_TEMPORARILY_UNAVAILABLE', retryAfterSeconds: 30 } });
          }
          throw error;
        }
      }
    }
  };

  return {
    typeDefs: hostedAgentTypeDefs,
    resolvers
  };
}
