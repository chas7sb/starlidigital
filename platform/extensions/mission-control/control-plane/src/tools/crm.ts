import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope, redactSecrets } from './security.js';
import type { CrmCompany } from '../../../server/src/crm/types.js';
import { upsertLead, createOrUpdateProposalDemo, promoteOperatorProposal, getProposalDeliveryInfo, getDeliveryClaimCode } from '../../../server/src/leads-proposals.js';

export function registerCrmTools(ctx: ToolContext) {
  const { server, principal, store, events, crmServices, auditCall } = ctx;

  const isAdmin = principal.role === 'admin';
  const hasRead = hasScope(principal, 'read');
  const hasWrite = hasScope(principal, 'write');

  // 1. crm_search_prospects (Preserved identical contract)
  server.tool(
    'crm_search_prospects',
    'Search prospects / companies in Starli CRM with optional search term or qualification filter',
    {
      search: z.string().optional().describe('Search term for company name, domain, or email'),
      qualificationStatus: z.string().optional().describe('Filter by qualification status'),
      limit: z.number().int().min(1).max(100).optional().describe('Max records to return'),
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasRead) {
        auditCall('crm_search_prospects', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires admin read scope', 'UNAUTHORIZED');
      }
      if (!crmServices) return errorResponse('CRM services not initialized');

      try {
        const results = crmServices.listCompanies({
          search: args.search,
          qualificationStatus: args.qualificationStatus,
        });
        const limited = results.slice(0, args.limit ?? 25);
        const sanitized = limited.map((c: CrmCompany) => ({
          id: c.id,
          name: c.name,
          domain: c.domain,
          qualificationStatus: c.qualificationStatus,
          legacyLeadId: c.legacyLeadId,
          proposalId: c.proposalId,
          projectId: c.projectId,
          tags: c.tags,
          version: c.version,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));

        auditCall('crm_search_prospects', undefined, start, 'SUCCESS', args, { count: sanitized.length });
        return jsonResponse(sanitized);
      } catch (err: any) {
        auditCall('crm_search_prospects', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Search prospects failed: ${err.message}`);
      }
    }
  );

  // 2. crm_get_prospect (Preserved identical contract)
  server.tool(
    'crm_get_prospect',
    'Get full prospect / company record, contacts, and opportunities by ID',
    {
      id: z.string().describe('Company / prospect ID'),
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasRead) {
        auditCall('crm_get_prospect', args.id, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires admin read scope', 'UNAUTHORIZED');
      }
      if (!crmServices) return errorResponse('CRM services not initialized');

      try {
        const company = crmServices.getCompany(args.id);
        if (!company) {
          auditCall('crm_get_prospect', args.id, start, 'FAILED', args, undefined, 'Not found');
          return errorResponse(`Prospect with ID ${args.id} not found`, 'NOT_FOUND');
        }

        const contacts = crmServices.listContacts(args.id);
        const opportunities = crmServices.listOpportunities({ companyId: args.id });
        const signals = crmServices.listSignals(args.id);

        const data = {
          company: {
            id: company.id,
            name: company.name,
            domain: company.domain,
            qualificationStatus: company.qualificationStatus,
            legacyLeadId: company.legacyLeadId,
            proposalId: company.proposalId,
            projectId: company.projectId,
            tags: company.tags,
            notes: company.notes,
            version: company.version,
            createdAt: company.createdAt,
            updatedAt: company.updatedAt,
          },
          contacts: contacts.map((c: any) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            role: c.role,
            isPrimary: c.isPrimary,
          })),
          opportunities: opportunities.map((o: any) => ({
            id: o.id,
            title: o.title,
            stageId: o.stageId,
            status: o.status,
            expectedValue: o.expectedValue,
            winProbability: o.winProbability,
          })),
          signalsCount: signals.length,
        };

        auditCall('crm_get_prospect', args.id, start, 'SUCCESS', args);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('crm_get_prospect', args.id, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Get prospect failed: ${err.message}`);
      }
    }
  );

  // 3. crm_upsert_prospect (Preserved identical contract)
  server.tool(
    'crm_upsert_prospect',
    'Create or update a company / prospect record with expectedVersion concurrency protection',
    {
      id: z.string().optional().describe('Opaque company ID; omit to create new'),
      expectedVersion: z.number().int().optional().describe('Concurrency guard version when updating'),
      name: z.string().min(1).describe('Company name'),
      domain: z.string().optional().describe('Company website domain'),
      qualificationStatus: z.enum(['UNQUALIFIED', 'QUALIFYING', 'QUALIFIED', 'DISQUALIFIED']).optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
      legacyLeadId: z.string().optional(),
      proposalId: z.string().optional(),
      projectId: z.string().optional(),
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('crm_upsert_prospect', args.id, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires admin write scope', 'UNAUTHORIZED');
      }
      if (!crmServices) return errorResponse('CRM services not initialized');

      try {
        const caller = { id: principal.id, role: principal.role, email: principal.email };
        const company = crmServices.upsertCompany(caller as any, {
          id: args.id,
          name: args.name,
          domain: args.domain,
          qualificationStatus: args.qualificationStatus as any,
          tags: args.tags,
          notes: args.notes,
          legacyLeadId: args.legacyLeadId,
          proposalId: args.proposalId,
          projectId: args.projectId,
        }, args.expectedVersion);

        auditCall('crm_upsert_prospect', company.id, start, 'SUCCESS', args, { companyId: company.id });
        return jsonResponse({
          id: company.id,
          name: company.name,
          domain: company.domain,
          qualificationStatus: company.qualificationStatus,
          version: company.version,
          updatedAt: company.updatedAt,
        });
      } catch (err: any) {
        auditCall('crm_upsert_prospect', args.id, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Upsert prospect failed: ${err.message}`);
      }
    }
  );

  // 4. crm_add_activity (Preserved identical contract)
  server.tool(
    'crm_add_activity',
    'Add an activity/note to a prospect or deal timeline with idempotent deduplication',
    {
      companyId: z.string().optional(),
      contactId: z.string().optional(),
      opportunityId: z.string().optional(),
      projectId: z.string().optional(),
      kind: z.enum(['NOTE', 'CALL', 'EMAIL', 'MEETING', 'STAGE_CHANGE', 'TASK', 'SYSTEM']).describe('Activity kind'),
      summary: z.string().min(1).describe('Brief summary of the activity'),
      details: z.string().optional().describe('Full note or interaction details'),
      sourceEventId: z.string().optional().describe('External source event ID for idempotent logging'),
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('crm_add_activity', args.companyId, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires admin write scope', 'UNAUTHORIZED');
      }
      if (!crmServices) return errorResponse('CRM services not initialized');

      try {
        const activity = crmServices.logActivity({
          companyId: args.companyId,
          contactId: args.contactId,
          opportunityId: args.opportunityId,
          projectId: args.projectId,
          kind: args.kind as any,
          summary: args.summary,
          details: args.details,
          sourceEventId: args.sourceEventId,
          actorPrincipal: principal.id,
        });

        auditCall('crm_add_activity', activity.id, start, 'SUCCESS', args, { activityId: activity.id });
        return jsonResponse({
          id: activity.id,
          kind: activity.kind,
          summary: activity.summary,
          createdAt: activity.createdAt,
        });
      } catch (err: any) {
        auditCall('crm_add_activity', args.companyId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Add activity failed: ${err.message}`);
      }
    }
  );

  // 5. crm_list_opportunities (Preserved identical contract)
  server.tool(
    'crm_list_opportunities',
    'List CRM opportunities / pipeline deals with values, stage, and win probability',
    {
      companyId: z.string().optional(),
      stageId: z.string().optional(),
      status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasRead) {
        auditCall('crm_list_opportunities', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires admin read scope', 'UNAUTHORIZED');
      }
      if (!crmServices) return errorResponse('CRM services not initialized');

      try {
        const opps = crmServices.listOpportunities({
          companyId: args.companyId,
          stageId: args.stageId,
          status: args.status,
        });
        const limited = opps.slice(0, args.limit ?? 25);
        const data = limited.map((o: any) => ({
          id: o.id,
          companyId: o.companyId,
          title: o.title,
          stageId: o.stageId,
          status: o.status,
          expectedValue: o.expectedValue,
          currency: o.currency,
          winProbability: o.winProbability,
          estimatedCloseDate: o.estimatedCloseDate,
          version: o.version,
        }));

        auditCall('crm_list_opportunities', undefined, start, 'SUCCESS', args, { count: data.length });
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('crm_list_opportunities', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`List opportunities failed: ${err.message}`);
      }
    }
  );

  // 6. proposal_manage
  server.tool(
    'proposal_manage',
    'Manage client proposals and interactive website demos: list, inspect, delivery info, generate demo, or promote proposal. (Read/Write)',
    {
      action: z.enum(['list', 'get', 'get_delivery_info', 'create', 'promote']).describe('Proposal action'),
      proposalId: z.string().optional().describe('Proposal ID (required for get, get_delivery_info, or promote)'),
      businessName: z.string().optional().describe('Client business name (for create)'),
      industry: z.string().optional().describe('Industry category (for create)'),
      locality: z.string().optional().describe('City or region (for create)'),
      phone: z.string().optional().describe('Contact phone number (for create)'),
      email: z.string().optional().describe('Contact email (for create)'),
    },
    async (args) => {
      const start = Date.now();
      const isWrite = args.action === 'create' || args.action === 'promote';
      if (!hasScope(principal, isWrite ? 'write' : 'read')) {
        auditCall('proposal_manage', args.proposalId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: insufficient scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        if (args.action === 'list') {
          const proposals = store.list('proposals').map((p: any) => ({
            id: p.id,
            businessName: p.businessName,
            status: p.status,
            publicSlug: p.publicSlug,
            projectId: p.projectId,
            generationMode: p.generationMode,
            viewCount: p.viewCount || 0,
            createdAt: p.createdAt,
          }));
          auditCall('proposal_manage', undefined, start, 'SUCCESS', args, { count: proposals.length });
          return jsonResponse({ total: proposals.length, proposals });
        }

        if (args.action === 'get') {
          if (!args.proposalId) return errorResponse('proposalId is required for get');
          const p = store.get('proposals', args.proposalId);
          if (!p) return errorResponse(`Proposal ${args.proposalId} not found`, 'NOT_FOUND');
          auditCall('proposal_manage', args.proposalId, start, 'SUCCESS', args);
          const activeCode = getDeliveryClaimCode(p.id);
          return jsonResponse({
            ...p,
            claimCodeAvailable: Boolean(activeCode),
            ...(activeCode ? { claimCode: activeCode } : {}),
            publicUrl: `https://starlidigital.ro/propunere/${p.publicSlug}`,
            deliveryNote: p.status === 'REVENDICAT'
              ? 'Proposal already claimed.'
              : 'To retrieve or reissue client claim code for outreach, call proposal_get_delivery_info.',
          });
        }

        if (args.action === 'get_delivery_info') {
          if (!args.proposalId) return errorResponse('proposalId is required for get_delivery_info');
          const ctxMock = { user: { id: principal.id, role: 'ADMIN', username: 'admin' }, ip: '127.0.0.1' };
          const delivery = getProposalDeliveryInfo(store, events, ctxMock as any, args.proposalId, {
            reissueIfMissing: true,
          });
          auditCall('proposal_manage', args.proposalId, start, 'SUCCESS', args, {
            proposalId: delivery.proposalId,
            reissued: delivery.reissued,
            claimed: delivery.claimed,
          });
          return jsonResponse({
            proposalId: delivery.proposalId,
            businessName: delivery.businessName,
            publicSlug: delivery.publicSlug,
            publicUrl: delivery.publicUrl,
            claimCode: delivery.claimCode,
            status: delivery.status,
            claimExpiresAt: delivery.claimExpiresAt,
            reissued: delivery.reissued,
            claimed: delivery.claimed,
            message: delivery.message,
          });
        }

        if (args.action === 'create') {
          if (!args.businessName) return errorResponse('businessName is required to create a proposal');
          const ctxMock = { user: { id: principal.id, role: 'ADMIN', username: 'admin' }, ip: '127.0.0.1' };

          // Create lead first
          const leadResult = upsertLead(store, events, ctxMock as any, {
            businessName: args.businessName,
            industry: args.industry,
            locality: args.locality,
            phone: args.phone,
            email: args.email,
          });

          // Prepare proposal demo
          const proposalResult = await createOrUpdateProposalDemo(store, events, ctxMock as any, {
            leadId: leadResult.lead.id,
            businessName: args.businessName,
            industry: args.industry,
            locality: args.locality,
            phone: args.phone,
            email: args.email,
            mode: 'snapshot',
          });

          auditCall('proposal_manage', proposalResult.proposal.id, start, 'SUCCESS', args, { proposalId: proposalResult.proposal.id });
          return jsonResponse({
            status: 'PROPOSAL_CREATED',
            proposalId: proposalResult.proposal.id,
            businessName: proposalResult.proposal.businessName,
            publicSlug: proposalResult.proposal.publicSlug,
            projectId: proposalResult.proposal.projectId,
            publicUrl: `https://starlidigital.ro/propunere/${proposalResult.proposal.publicSlug}`,
            claimCode: proposalResult.claimCode,
            proposalStatus: proposalResult.proposal.status,
            claimExpiresAt: proposalResult.proposal.claimExpiresAt,
            deduplicated: proposalResult.deduplicated,
          });
        }

        if (args.action === 'promote') {
          if (!args.proposalId) return errorResponse('proposalId is required for promote');
          const ctxMock = { user: { id: principal.id, role: 'ADMIN', username: 'admin' }, ip: '127.0.0.1' };
          const promoted = await promoteOperatorProposal(store, events, ctxMock as any, args.proposalId, 'bespoke');
          auditCall('proposal_manage', args.proposalId, start, 'SUCCESS', args);
          return jsonResponse({
            status: 'PROMOTED',
            proposalId: promoted.id,
            generationMode: promoted.generationMode,
          });
        }

        return errorResponse(`Invalid action ${args.action}`);
      } catch (err: any) {
        auditCall('proposal_manage', args.proposalId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`proposal_manage failed: ${err.message}`);
      }
    }
  );

  // 6b. proposal_get_delivery_info
  server.tool(
    'proposal_get_delivery_info',
    'Retrieve proposal delivery information for client outreach, including public URL, client claim code, and current status. Automatically reissues if code is missing or expired. Authorized operators only. (Read-Only/Mutating on reissue)',
    {
      proposalId: z.string().describe('Proposal ID'),
      forceReissue: z.boolean().optional().describe('Force generation of a fresh claim code even if one is currently active'),
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasRead) {
        auditCall('proposal_get_delivery_info', args.proposalId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires admin read scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        const ctxMock = { user: { id: principal.id, role: 'ADMIN', username: 'admin' }, ip: '127.0.0.1' };
        const delivery = getProposalDeliveryInfo(store, events, ctxMock as any, args.proposalId, {
          forceReissue: args.forceReissue,
          reissueIfMissing: true,
        });

        auditCall('proposal_get_delivery_info', args.proposalId, start, 'SUCCESS', args, {
          proposalId: delivery.proposalId,
          reissued: delivery.reissued,
          claimed: delivery.claimed,
        });

        return jsonResponse({
          proposalId: delivery.proposalId,
          businessName: delivery.businessName,
          publicSlug: delivery.publicSlug,
          publicUrl: delivery.publicUrl,
          claimCode: delivery.claimCode,
          status: delivery.status,
          claimExpiresAt: delivery.claimExpiresAt,
          reissued: delivery.reissued,
          claimed: delivery.claimed,
          message: delivery.message,
        });
      } catch (err: any) {
        auditCall('proposal_get_delivery_info', args.proposalId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`proposal_get_delivery_info failed: ${err.message}`);
      }
    }
  );

  // 7. client_manage
  server.tool(
    'client_manage',
    'List or inspect registered clients and customer user accounts. Never reveals password hashes or secrets. (Read/Write)',
    {
      action: z.enum(['list', 'get', 'update_role']).describe('Client management action'),
      userId: z.string().optional().describe('User account ID (required for get or update_role)'),
      search: z.string().optional().describe('Search filter by email or username'),
      role: z.enum(['USER', 'ADMIN']).optional().describe('Target role for update_role'),
    },
    async (args) => {
      const start = Date.now();
      const isWrite = args.action === 'update_role';
      if (!hasScope(principal, isWrite ? 'admin' : 'read')) {
        auditCall('client_manage', args.userId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires admin scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        if (args.action === 'list') {
          const users = store.users().map((u: any) => {
            const clean = { ...u };
            delete clean.passwordHash;
            delete clean.salt;
            return clean;
          });
          auditCall('client_manage', undefined, start, 'SUCCESS', args, { count: users.length });
          return jsonResponse({ total: users.length, users });
        }

        if (args.action === 'get') {
          if (!args.userId) return errorResponse('userId is required for get');
          const user = store.user(args.userId);
          if (!user) return errorResponse(`User ${args.userId} not found`, 'NOT_FOUND');
          const clean = { ...user };
          delete clean.passwordHash;
          delete clean.salt;
          auditCall('client_manage', args.userId, start, 'SUCCESS', args);
          return jsonResponse(clean);
        }

        if (args.action === 'update_role') {
          if (!args.userId || !args.role) return errorResponse('userId and role are required');
          const user = store.user(args.userId);
          if (!user) return errorResponse(`User ${args.userId} not found`, 'NOT_FOUND');
          user.role = args.role;
          store.saveUser(user);
          auditCall('client_manage', args.userId, start, 'SUCCESS', args);
          return jsonResponse({ status: 'UPDATED', userId: user.id, role: user.role });
        }

        return errorResponse(`Invalid action ${args.action}`);
      } catch (err: any) {
        auditCall('client_manage', args.userId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`client_manage failed: ${err.message}`);
      }
    }
  );
}
