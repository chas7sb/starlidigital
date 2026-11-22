import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';
import type { HostedAgentServiceLike, HostedAgentType, HostedAgentStatus } from '../../../server/src/hosted-agent-integrations/types.js';
import { HostedAgentProposalService } from '../../../server/src/hosted-agent-integrations/proposals.js';

export function registerHostedAgentTools(ctx: ToolContext) {
  const { server, principal, store, events, auditCall } = ctx;

  const isAdmin = principal.role === 'admin';
  const hasRead = hasScope(principal, 'read');
  const hasWrite = hasScope(principal, 'write');

  // Derive or use the shared HostedAgentService from context if provided
  const agentService: HostedAgentServiceLike | undefined = (ctx as any).hostedAgentService;
  const proposalService = store && events && agentService
    ? new HostedAgentProposalService(store, events, agentService)
    : undefined;

  const actor = {
    userId: principal.id,
    role: (isAdmin ? 'ADMIN' : 'CUSTOMER') as 'ADMIN' | 'CUSTOMER'
  };

  // 1. agent_create
  server.tool(
    'agent_create',
    'Create a new Starli Hosted AI Agent for a business with instructions and initial configuration',
    {
      name: z.string().describe('Agent display name, e.g. "Cosmin — Consultant Energetic"'),
      businessName: z.string().describe('Target business name, e.g. "Solar Power SRL"'),
      type: z.enum(['SALES', 'SUPPORT', 'BOOKING', 'LEAD_QUALIFICATION', 'ECOMMERCE', 'INTERNAL_KNOWLEDGE', 'CUSTOM']).describe('Agent specialization type'),
      slug: z.string().optional().describe('URL slug hint for public demo'),
      instructions: z.string().optional().describe('Core system instructions and persona'),
      welcomeMessage: z.string().optional().describe('Opening message for chat visitors'),
      businessContext: z.string().optional().describe('Brief context about the business'),
      knowledgeJson: z.string().optional().describe('Structured knowledge facts as JSON string'),
      ownerId: z.string().optional().describe('Customer owner user ID if assigning directly')
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('agent_create', undefined, start, 'DENIED', args, undefined, 'Requires admin write scope');
        return errorResponse('Access denied: requires admin write scope', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized on server context');

      try {
        const agent = await agentService.create(actor, {
          name: args.name,
          businessName: args.businessName,
          type: args.type as HostedAgentType,
          slug: args.slug,
          instructions: args.instructions,
          welcomeMessage: args.welcomeMessage,
          businessContext: args.businessContext,
          knowledgeJson: args.knowledgeJson,
          ownerId: args.ownerId
        });

        auditCall('agent_create', agent.id, start, 'SUCCESS', args, { id: agent.id, publicId: agent.publicId });
        return jsonResponse(agent);
      } catch (err: any) {
        auditCall('agent_create', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to create agent: ${err.message}`);
      }
    }
  );

  // 2. agent_get
  server.tool(
    'agent_get',
    'Retrieve complete configuration and status of a hosted agent by ID',
    {
      id: z.string().describe('Hosted Agent ID')
    },
    async (args) => {
      const start = Date.now();
      if (!hasRead) {
        auditCall('agent_get', args.id, start, 'DENIED', args, undefined, 'Requires read scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized');

      try {
        const agent = await agentService.get(actor, args.id);
        auditCall('agent_get', args.id, start, 'SUCCESS', args, { id: agent.id });
        return jsonResponse(agent);
      } catch (err: any) {
        auditCall('agent_get', args.id, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to get agent: ${err.message}`);
      }
    }
  );

  // 3. agent_update
  server.tool(
    'agent_update',
    'Update agent core configuration (name, businessName, instructions, welcomeMessage, businessContext)',
    {
      id: z.string().describe('Hosted Agent ID'),
      expectedVersion: z.number().int().describe('Expected current version for optimistic concurrency'),
      name: z.string().optional(),
      businessName: z.string().optional(),
      instructions: z.string().optional(),
      welcomeMessage: z.string().optional(),
      businessContext: z.string().optional(),
      appearanceJson: z.string().optional(),
      deploymentJson: z.string().optional()
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('agent_update', args.id, start, 'DENIED', args, undefined, 'Requires admin write scope');
        return errorResponse('Access denied: requires admin write scope', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized');

      try {
        const updated = await agentService.update(
          actor,
          args.id,
          {
            name: args.name,
            businessName: args.businessName,
            instructions: args.instructions,
            welcomeMessage: args.welcomeMessage,
            businessContext: args.businessContext,
            appearanceJson: args.appearanceJson,
            deploymentJson: args.deploymentJson
          },
          args.expectedVersion
        );

        auditCall('agent_update', args.id, start, 'SUCCESS', args, { id: updated.id, version: updated.version });
        return jsonResponse(updated);
      } catch (err: any) {
        auditCall('agent_update', args.id, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to update agent: ${err.message}`);
      }
    }
  );

  // 4. agent_add_knowledge
  server.tool(
    'agent_add_knowledge',
    'Set or replace structured knowledge base facts for an agent',
    {
      id: z.string().describe('Hosted Agent ID'),
      expectedVersion: z.number().int().describe('Expected current version'),
      knowledgeJson: z.string().describe('JSON array of knowledge facts or document items')
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('agent_add_knowledge', args.id, start, 'DENIED', args, undefined, 'Requires admin write scope');
        return errorResponse('Access denied: requires admin write scope', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized');

      try {
        // Validate JSON
        JSON.parse(args.knowledgeJson);
        const updated = await agentService.setKnowledge(actor, args.id, args.knowledgeJson, args.expectedVersion);
        auditCall('agent_add_knowledge', args.id, start, 'SUCCESS', args, { id: updated.id, version: updated.version });
        return jsonResponse(updated);
      } catch (err: any) {
        auditCall('agent_add_knowledge', args.id, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to set knowledge: ${err.message}`);
      }
    }
  );

  // 5. agent_configure
  server.tool(
    'agent_configure',
    'Convenience tool to configure agent behavior, knowledge, and appearance in a single call',
    {
      id: z.string().describe('Hosted Agent ID'),
      expectedVersion: z.number().int().describe('Current version'),
      instructions: z.string().optional(),
      welcomeMessage: z.string().optional(),
      knowledgeJson: z.string().optional(),
      appearanceJson: z.string().optional()
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('agent_configure', args.id, start, 'DENIED', args, undefined, 'Requires admin write scope');
        return errorResponse('Access denied', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized');

      try {
        let current = await agentService.get(actor, args.id);
        let ver = args.expectedVersion;

        if (args.instructions !== undefined || args.welcomeMessage !== undefined || args.appearanceJson !== undefined) {
          current = await agentService.update(
            actor,
            args.id,
            {
              instructions: args.instructions,
              welcomeMessage: args.welcomeMessage,
              appearanceJson: args.appearanceJson
            },
            ver
          );
          ver = current.version;
        }

        if (args.knowledgeJson !== undefined) {
          JSON.parse(args.knowledgeJson);
          current = await agentService.setKnowledge(actor, args.id, args.knowledgeJson, ver);
        }

        auditCall('agent_configure', args.id, start, 'SUCCESS', args, { id: current.id, version: current.version });
        return jsonResponse(current);
      } catch (err: any) {
        auditCall('agent_configure', args.id, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to configure agent: ${err.message}`);
      }
    }
  );

  // 6. agent_create_demo
  server.tool(
    'agent_create_demo',
    'Publish an agent in DEMO mode for public pre-sales prospect testing and return live demo URL',
    {
      id: z.string().describe('Hosted Agent ID'),
      expectedVersion: z.number().int().describe('Current version')
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('agent_create_demo', args.id, start, 'DENIED', args, undefined, 'Requires admin write scope');
        return errorResponse('Access denied: requires admin write scope', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized');

      try {
        const published = await agentService.publish(actor, args.id, 'DEMO', args.expectedVersion);
        const demoUrl = `/ai/demo/${published.slug}`;
        const embedUrl = `/ai/embed/${published.publicId}`;

        auditCall('agent_create_demo', args.id, start, 'SUCCESS', args, { id: published.id, demoUrl });
        return jsonResponse({
          agent: published,
          demoUrl,
          embedUrl,
          embedSnippet: `<script src="https://starlidigital.ro/agent.js" data-agent="${published.publicId}"></script>`
        });
      } catch (err: any) {
        auditCall('agent_create_demo', args.id, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to create demo: ${err.message}`);
      }
    }
  );

  // 7. agent_create_proposal
  server.tool(
    'agent_create_proposal',
    'Create an interactive Hosted Agent proposal linked to a CRM prospect with real embedded chat demo',
    {
      agentId: z.string().describe('Hosted Agent ID to feature in proposal'),
      prospectId: z.string().optional().describe('Optional CRM Company / Prospect ID to link'),
      publicSlug: z.string().optional().describe('Custom slug for proposal, e.g. "solar-power-agent"'),
      title: z.string().optional().describe('Proposal title'),
      summary: z.string().optional().describe('Executive summary'),
      quoteMonthlyEur: z.number().optional().describe('Monthly price in EUR (informational quote)'),
      quoteSetupEur: z.number().optional().describe('Setup price in EUR')
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('agent_create_proposal', args.agentId, start, 'DENIED', args, undefined, 'Requires admin write scope');
        return errorResponse('Access denied', 'UNAUTHORIZED');
      }
      if (!proposalService) return errorResponse('Proposal service not initialized');

      try {
        const proposal = await proposalService.createProposal(actor, args);
        const proposalUrl = `/ai/proposal/${proposal.publicSlug}`;

        auditCall('agent_create_proposal', proposal.id, start, 'SUCCESS', args, { id: proposal.id, url: proposalUrl });
        return jsonResponse({
          proposal,
          proposalUrl,
          publicViewUrl: `https://starlidigital.ro${proposalUrl}`
        });
      } catch (err: any) {
        auditCall('agent_create_proposal', args.agentId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to create agent proposal: ${err.message}`);
      }
    }
  );

  // 8. agent_publish
  server.tool(
    'agent_publish',
    'Set agent status to ACTIVE or DEMO (explicit commercial publication)',
    {
      id: z.string().describe('Hosted Agent ID'),
      mode: z.enum(['DEMO', 'ACTIVE']).describe('Target publication mode'),
      expectedVersion: z.number().int().describe('Current version')
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('agent_publish', args.id, start, 'DENIED', args, undefined, 'Requires admin write scope');
        return errorResponse('Access denied', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized');

      try {
        const published = await agentService.publish(actor, args.id, args.mode as HostedAgentStatus, args.expectedVersion);
        auditCall('agent_publish', args.id, start, 'SUCCESS', args, { id: published.id, status: published.status });
        return jsonResponse(published);
      } catch (err: any) {
        auditCall('agent_publish', args.id, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to publish agent: ${err.message}`);
      }
    }
  );

  // 9. agent_list_conversations
  server.tool(
    'agent_list_conversations',
    'List conversations and messages for an agent with pagination',
    {
      agentId: z.string().describe('Hosted Agent ID'),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(50).optional()
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasRead) {
        auditCall('agent_list_conversations', args.agentId, start, 'DENIED', args, undefined, 'Requires read scope');
        return errorResponse('Access denied', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized');

      try {
        const result = await agentService.conversations(actor, args.agentId, {
          offset: args.offset,
          limit: args.limit
        });

        auditCall('agent_list_conversations', args.agentId, start, 'SUCCESS', args, { total: result.total });
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('agent_list_conversations', args.agentId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to list conversations: ${err.message}`);
      }
    }
  );

  // 10. agent_list_customer_leads
  server.tool(
    'agent_list_customer_leads',
    'List leads captured by an agent from visitor conversations',
    {
      agentId: z.string().describe('Hosted Agent ID'),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(50).optional()
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasRead) {
        auditCall('agent_list_customer_leads', args.agentId, start, 'DENIED', args, undefined, 'Requires read scope');
        return errorResponse('Access denied', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized');

      try {
        const result = await agentService.leads(actor, args.agentId, {
          offset: args.offset,
          limit: args.limit
        });

        auditCall('agent_list_customer_leads', args.agentId, start, 'SUCCESS', args, { total: result.total });
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('agent_list_customer_leads', args.agentId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to list customer leads: ${err.message}`);
      }
    }
  );

  // 11. agent_disable
  server.tool(
    'agent_disable',
    'Immediately disable an agent, revoking public config, chat access, and embeds',
    {
      id: z.string().describe('Hosted Agent ID'),
      expectedVersion: z.number().int().describe('Current version')
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('agent_disable', args.id, start, 'DENIED', args, undefined, 'Requires admin write scope');
        return errorResponse('Access denied: requires admin write scope', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized');

      try {
        const disabled = await agentService.disable(actor, args.id, args.expectedVersion);
        auditCall('agent_disable', args.id, start, 'SUCCESS', args, { id: disabled.id, status: disabled.status });
        return jsonResponse(disabled);
      } catch (err: any) {
        auditCall('agent_disable', args.id, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to disable agent: ${err.message}`);
      }
    }
  );

  // 12. agent_assign_owner (Admin-only ownership transfer)
  server.tool(
    'agent_assign_owner',
    'Assign or transfer an agent to a customer user ID',
    {
      id: z.string().describe('Hosted Agent ID'),
      ownerId: z.string().describe('Target customer user ID'),
      expectedVersion: z.number().int().describe('Current version')
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('agent_assign_owner', args.id, start, 'DENIED', args, undefined, 'Requires admin write scope');
        return errorResponse('Access denied: requires admin write scope', 'UNAUTHORIZED');
      }
      if (!agentService) return errorResponse('Hosted Agent service not initialized');

      try {
        const transferred = await agentService.assignOwner(actor, args.id, args.ownerId, args.expectedVersion);
        auditCall('agent_assign_owner', args.id, start, 'SUCCESS', args, { id: transferred.id, newOwnerId: args.ownerId });
        return jsonResponse(transferred);
      } catch (err: any) {
        auditCall('agent_assign_owner', args.id, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to assign owner: ${err.message}`);
      }
    }
  );
}
