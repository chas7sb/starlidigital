import { gql } from '../api';
import { resolvePublicEndpoints } from '../transport';
import type {
  HostedAgent,
  HostedAgentPublic,
  HostedAgentConversationPage,
  HostedAgentLeadPage,
  HostedAgentUsage,
  HostedAgentSession,
  HostedAgentChatResult,
  HostedAgentCreateInput,
  HostedAgentUpdateInput,
  HostedAgentStatus
} from './types';

// For public queries/mutations (no cookies attached)
export async function publicGql<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const endpoints = resolvePublicEndpoints(
    import.meta.env.VITE_API_URL,
    import.meta.env.VITE_WS_URL,
    location.origin
  );

  const response = await fetch(endpoints.api, {
    method: 'POST',
    credentials: 'omit', // Public endpoints omit user cookies
    signal: AbortSignal.timeout(30000),
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  const result = await response.json();
  if (result.errors?.length) {
    throw new Error(result.errors[0].message || 'Agent request error');
  }
  if (!response.ok) {
    throw new Error('Could not connect to the agent runtime.');
  }
  return result.data as T;
}

// ==========================================
// Authenticated Queries & Mutations (Customer / Admin)
// ==========================================

export async function fetchHostedAgents(adminAll: boolean = false, status?: HostedAgentStatus): Promise<HostedAgent[]> {
  const data = await gql<{ hostedAgents: HostedAgent[] }>(
    `query GetHostedAgents($adminAll: Boolean, $status: HostedAgentStatus) {
      hostedAgents(adminAll: $adminAll, status: $status) {
        id
        ownerId
        publicId
        name
        businessName
        slug
        type
        status
        instructions
        welcomeMessage
        businessContext
        knowledgeJson
        appearanceJson
        deploymentJson
        version
        createdAt
        updatedAt
      }
    }`,
    { adminAll, status }
  );
  return data.hostedAgents;
}

export async function fetchHostedAgent(id: string): Promise<HostedAgent> {
  const data = await gql<{ hostedAgent: HostedAgent }>(
    `query GetHostedAgent($id: ID!) {
      hostedAgent(id: $id) {
        id
        ownerId
        publicId
        name
        businessName
        slug
        type
        status
        instructions
        welcomeMessage
        businessContext
        knowledgeJson
        appearanceJson
        deploymentJson
        version
        createdAt
        updatedAt
      }
    }`,
    { id }
  );
  return data.hostedAgent;
}

export async function fetchHostedAgentConversations(
  agentId: string,
  offset: number = 0,
  limit: number = 25
): Promise<HostedAgentConversationPage> {
  const data = await gql<{ hostedAgentConversations: HostedAgentConversationPage }>(
    `query GetHostedAgentConversations($agentId: ID!, $offset: Int, $limit: Int) {
      hostedAgentConversations(agentId: $agentId, offset: $offset, limit: $limit) {
        total
        items {
          id
          agentId
          status
          summary
          qualification
          createdAt
          updatedAt
          messages {
            id
            conversationId
            role
            content
            createdAt
          }
        }
      }
    }`,
    { agentId, offset, limit }
  );
  return data.hostedAgentConversations;
}

export async function fetchHostedAgentLeads(
  agentId: string,
  offset: number = 0,
  limit: number = 25
): Promise<HostedAgentLeadPage> {
  const data = await gql<{ hostedAgentLeads: HostedAgentLeadPage }>(
    `query GetHostedAgentLeads($agentId: ID!, $offset: Int, $limit: Int) {
      hostedAgentLeads(agentId: $agentId, offset: $offset, limit: $limit) {
        total
        items {
          id
          agentId
          conversationId
          name
          email
          phone
          requestedService
          location
          budget
          timeframe
          intent
          summary
          score
          createdAt
          updatedAt
        }
      }
    }`,
    { agentId, offset, limit }
  );
  return data.hostedAgentLeads;
}

export async function fetchHostedAgentUsage(agentId: string): Promise<HostedAgentUsage> {
  const data = await gql<{ hostedAgentUsage: HostedAgentUsage }>(
    `query GetHostedAgentUsage($agentId: ID!) {
      hostedAgentUsage(agentId: $agentId) {
        conversations
        messages
        capturedLeads
        qualifiedLeads
        modelCalls
        failures
        averageLatencyMs
      }
    }`,
    { agentId }
  );
  return data.hostedAgentUsage;
}

export async function createHostedAgent(input: HostedAgentCreateInput): Promise<HostedAgent> {
  const data = await gql<{ hostedAgentCreate: HostedAgent }>(
    `mutation CreateHostedAgent($input: HostedAgentCreateInput!) {
      hostedAgentCreate(input: $input) {
        id
        publicId
        name
        businessName
        slug
        type
        status
        version
      }
    }`,
    { input }
  );
  return data.hostedAgentCreate;
}

export async function updateHostedAgent(
  id: string,
  input: HostedAgentUpdateInput,
  expectedVersion: number
): Promise<HostedAgent> {
  const data = await gql<{ hostedAgentUpdate: HostedAgent }>(
    `mutation UpdateHostedAgent($id: ID!, $input: HostedAgentUpdateInput!, $expectedVersion: Int!) {
      hostedAgentUpdate(id: $id, input: $input, expectedVersion: $expectedVersion) {
        id
        publicId
        name
        businessName
        instructions
        welcomeMessage
        businessContext
        appearanceJson
        deploymentJson
        version
        updatedAt
      }
    }`,
    { id, input, expectedVersion }
  );
  return data.hostedAgentUpdate;
}

export async function setHostedAgentKnowledge(
  id: string,
  knowledgeJson: string,
  expectedVersion: number
): Promise<HostedAgent> {
  const data = await gql<{ hostedAgentSetKnowledge: HostedAgent }>(
    `mutation SetHostedAgentKnowledge($id: ID!, $knowledgeJson: String!, $expectedVersion: Int!) {
      hostedAgentSetKnowledge(id: $id, knowledgeJson: $knowledgeJson, expectedVersion: $expectedVersion) {
        id
        knowledgeJson
        version
        updatedAt
      }
    }`,
    { id, knowledgeJson, expectedVersion }
  );
  return data.hostedAgentSetKnowledge;
}

export async function publishHostedAgent(
  id: string,
  mode: HostedAgentStatus,
  expectedVersion: number
): Promise<HostedAgent> {
  const data = await gql<{ hostedAgentPublish: HostedAgent }>(
    `mutation PublishHostedAgent($id: ID!, $mode: HostedAgentStatus!, $expectedVersion: Int!) {
      hostedAgentPublish(id: $id, mode: $mode, expectedVersion: $expectedVersion) {
        id
        status
        version
        updatedAt
      }
    }`,
    { id, mode, expectedVersion }
  );
  return data.hostedAgentPublish;
}

export async function disableHostedAgent(id: string, expectedVersion: number): Promise<HostedAgent> {
  const data = await gql<{ hostedAgentDisable: HostedAgent }>(
    `mutation DisableHostedAgent($id: ID!, $expectedVersion: Int!) {
      hostedAgentDisable(id: $id, expectedVersion: $expectedVersion) {
        id
        status
        version
        updatedAt
      }
    }`,
    { id, expectedVersion }
  );
  return data.hostedAgentDisable;
}

export async function assignHostedAgentOwner(
  id: string,
  ownerId: string,
  expectedVersion: number
): Promise<HostedAgent> {
  const data = await gql<{ hostedAgentAssignOwner: HostedAgent }>(
    `mutation AssignHostedAgentOwner($id: ID!, $ownerId: ID!, $expectedVersion: Int!) {
      hostedAgentAssignOwner(id: $id, ownerId: $ownerId, expectedVersion: $expectedVersion) {
        id
        ownerId
        version
        updatedAt
      }
    }`,
    { id, ownerId, expectedVersion }
  );
  return data.hostedAgentAssignOwner;
}

// ==========================================
// Public Queries & Mutations (Visitor / Embedded)
// ==========================================

export async function fetchHostedAgentPublic(args: { slug?: string; publicId?: string }): Promise<HostedAgentPublic | null> {
  const data = await publicGql<{ hostedAgentPublic: HostedAgentPublic | null }>(
    `query GetHostedAgentPublic($slug: String, $publicId: String) {
      hostedAgentPublic(slug: $slug, publicId: $publicId) {
        publicId
        slug
        name
        businessName
        type
        status
        welcomeMessage
        appearanceJson
      }
    }`,
    args
  );
  return data.hostedAgentPublic;
}

export async function startHostedAgentConversation(publicId: string): Promise<HostedAgentSession> {
  const data = await publicGql<{ hostedAgentStartConversation: HostedAgentSession }>(
    `mutation StartHostedAgentConversation($publicId: String!) {
      hostedAgentStartConversation(publicId: $publicId) {
        conversationId
        visitorToken
        welcomeMessage
      }
    }`,
    { publicId }
  );
  return data.hostedAgentStartConversation;
}

export async function sendHostedAgentMessage(
  publicId: string,
  conversationId: string,
  visitorToken: string,
  requestId: string,
  message: string
): Promise<HostedAgentChatResult> {
  const data = await publicGql<{ hostedAgentSendMessage: HostedAgentChatResult }>(
    `mutation SendHostedAgentMessage(
      $publicId: String!,
      $conversationId: ID!,
      $visitorToken: String!,
      $requestId: String!,
      $message: String!
    ) {
      hostedAgentSendMessage(
        publicId: $publicId,
        conversationId: $conversationId,
        visitorToken: $visitorToken,
        requestId: $requestId,
        message: $message
      ) {
        conversationId
        capturedLead
        message {
          id
          conversationId
          role
          content
          createdAt
        }
      }
    }`,
    { publicId, conversationId, visitorToken, requestId, message }
  );
  return data.hostedAgentSendMessage;
}
