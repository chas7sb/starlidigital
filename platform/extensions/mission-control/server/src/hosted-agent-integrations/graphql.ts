import { requireUser, type Context } from '../security.js';
import type { Store } from '../store.js';
import type { Events } from '../events.js';
import type { HostedAgentServiceLike } from './types.js';
import { HostedAgentProposalService, type CreateAgentProposalInput } from './proposals.js';

export function createHostedAgentProposalGraphQL(options: {
  store: Store;
  events: Events;
  agentService: HostedAgentServiceLike;
}) {
  const proposalService = new HostedAgentProposalService(
    options.store,
    options.events,
    options.agentService
  );

  const typeDefs = `
    type HostedAgentProposal {
      id: ID!
      kind: String!
      publicSlug: String!
      agentId: ID!
      agentPublicId: String!
      prospectId: ID
      businessName: String!
      industry: String
      contactName: String
      contactEmail: String
      contactPhone: String
      status: String!
      title: String!
      summary: String!
      features: [String!]!
      recommendedAgentType: String!
      quoteMonthlyEur: Float
      quoteSetupEur: Float
      quoteTerms: String
      viewCount: Int!
      firstViewedAt: String
      lastViewedAt: String
      createdAt: String!
      updatedAt: String!
    }

    type HostedAgentProposalPublicView {
      id: ID!
      kind: String!
      publicSlug: String!
      agentPublicId: String!
      businessName: String!
      industry: String
      status: String!
      title: String!
      summary: String!
      features: [String!]!
      recommendedAgentType: String!
      quoteMonthlyEur: Float
      quoteSetupEur: Float
      quoteTerms: String
      demoUrl: String!
    }

    input CreateAgentProposalInput {
      agentId: ID!
      prospectId: ID
      publicSlug: String
      businessName: String
      industry: String
      contactName: String
      contactEmail: String
      contactPhone: String
      title: String
      summary: String
      features: [String!]
      quoteMonthlyEur: Float
      quoteSetupEur: Float
      quoteTerms: String
    }

    extend type Query {
      hostedAgentProposals(agentId: ID, prospectId: ID): [HostedAgentProposal!]!
      hostedAgentProposal(id: ID!): HostedAgentProposal
      hostedAgentProposalPublic(slug: String!): HostedAgentProposalPublicView
    }

    extend type Mutation {
      hostedAgentCreateProposal(input: CreateAgentProposalInput!): HostedAgentProposal!
    }
  `;

  const resolvers = {
    Query: {
      hostedAgentProposals: (_: any, args: any, context: any) => {
        const actor = requireActor(context);
        return proposalService.listProposals(actor, args);
      },
      hostedAgentProposal: (_: any, { id }: { id: string }, context: any) => {
        const actor = requireActor(context);
        return proposalService.getProposal(actor, id);
      },
      hostedAgentProposalPublic: (_: any, { slug }: { slug: string }) => {
        return proposalService.getPublicProposal(slug);
      }
    },
    Mutation: {
      hostedAgentCreateProposal: (_: any, { input }: { input: CreateAgentProposalInput }, context: any) => {
        const actor = requireActor(context);
        return proposalService.createProposal(actor, input);
      }
    }
  };

  return { typeDefs, resolvers, proposalService };
}

function requireActor(context: Context): { userId: string; role: 'ADMIN' | 'CUSTOMER' } {
 const user = requireUser(context);
 return {userId: user.id, role: user.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER'};
}
