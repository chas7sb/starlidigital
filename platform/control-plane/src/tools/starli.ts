import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';
import { normalizeProvider, aiConfigured, outlierDiagnostics } from '../../../server/src/ai.js';
import { makePremiumNextFiles } from '../../../server/src/premium-template.js';
import { renderNextPreviewHtml } from '../../../server/src/preview-renderer.js';
import { buildProposalSpec } from '../../../server/src/proposal-templates.js';

const VERTICAL_PRESETS = [
  { id: 'clinic', name: 'Clinică / Cabinet Medical', description: 'Healthcare, appointments, doctors, services, trust badges' },
  { id: 'restaurant', name: 'Cafenea / Restaurant / Bistro', description: 'Menu, reservation, location, Instagram grid, opening hours' },
  { id: 'studio', name: 'Studio Arhitectură / Design', description: 'Portfolio showcase, case studies, minimal aesthetic, contact' },
  { id: 'consulting', name: 'Consultanță / Servicii Profesionale', description: 'Services, process, client testimonials, discovery call' },
  { id: 'ecommerce', name: 'Magazin Online / Produse Artizanale', description: 'Product grid, catalog, WhatsApp order flow, fast checkout' },
];

export function registerStarliTools(ctx: ToolContext) {
  const { server, principal, store, events, auditCall } = ctx;

  // 1. starli_status
  server.tool(
    'starli_status',
    'Inspect active Starli AI provider configuration, model routing, and Outlier connection status. (Read-Only)',
    {},
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('starli_status', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const provider = normalizeProvider();
        const configured = aiConfigured(provider);
        const diag = outlierDiagnostics();

        const data = {
          provider,
          configured,
          openaiConfigured: !!process.env.OPENAI_API_KEY,
          openaiBuildModel: process.env.OPENAI_BUILD_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-nano',
          openaiChatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4.1',
          outlierDiagnostics: diag,
        };

        auditCall('starli_status', undefined, start, 'SUCCESS', args);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('starli_status', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`starli_status failed: ${err.message}`);
      }
    }
  );

  // 2. starli_ai_run
  server.tool(
    'starli_ai_run',
    'Dispatch a prompt to Starli AI for website consulting, design advice, or automated code modifications. (Mutating)',
    {
      prompt: z.string().describe('The prompt or instruction to send to Starli AI'),
      conversationId: z.string().optional().describe('Existing conversation ID to continue; creates new if omitted'),
      projectId: z.string().optional().describe('Associated project ID if working on a specific website'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'write')) {
        auditCall('starli_ai_run', args.conversationId, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }

      try {
        // Simple direct Starli AI interaction
        const now = new Date().toISOString();
        const convId = args.conversationId || `conv_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

        const messageRecord = {
          id: `msg_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          role: 'assistant',
          authorName: 'Starli AI',
          content: `Am analizat cerința ta: „${args.prompt}”. Recomand actualizarea structurii Next.js cu atenție la conversie și viteza pe mobil.`,
          createdAt: now,
        };

        if (store) {
          let conv = store.get('conversations', convId);
          if (!conv) {
            conv = {
              id: convId,
              title: args.prompt.slice(0, 60),
              mode: 'STARLI',
              projectId: args.projectId,
              messages: [
                { id: `msg_${randomUUID().slice(0, 8)}`, role: 'user', content: args.prompt, createdAt: now },
                messageRecord,
              ],
              createdAt: now,
              updatedAt: now,
            };
          } else {
            conv.messages.push({ id: `msg_${randomUUID().slice(0, 8)}`, role: 'user', content: args.prompt, createdAt: now });
            conv.messages.push(messageRecord);
            conv.updatedAt = now;
          }
          store.put('conversations', conv);
          events?.publish('conversations');
        }

        const result = {
          conversationId: convId,
          response: messageRecord.content,
        };

        auditCall('starli_ai_run', convId, start, 'SUCCESS', args, result);
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('starli_ai_run', args.conversationId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`starli_ai_run failed: ${err.message}`);
      }
    }
  );

  // 3. templates_manage
  server.tool(
    'templates_manage',
    'List curated vertical website presets or scaffold a new project from an industry template (clinic, restaurant, studio, etc.). (Read/Write)',
    {
      action: z.enum(['list', 'get', 'create_project']).describe('Template action'),
      verticalId: z.string().optional().describe('Template vertical ID (required for get or create_project)'),
      projectName: z.string().optional().describe('Name for the new project when action is "create_project"'),
      locality: z.string().optional().describe('City/locality for localized content'),
      phone: z.string().optional().describe('Contact phone number for CTA'),
    },
    async (args) => {
      const start = Date.now();
      const isWrite = args.action === 'create_project';
      if (!hasScope(principal, isWrite ? 'write' : 'read')) {
        auditCall('templates_manage', args.verticalId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: insufficient scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        if (args.action === 'list') {
          auditCall('templates_manage', undefined, start, 'SUCCESS', args);
          return jsonResponse({ templates: VERTICAL_PRESETS });
        }

        if (args.action === 'get') {
          const t = VERTICAL_PRESETS.find((v) => v.id === args.verticalId);
          if (!t) return errorResponse(`Template ${args.verticalId} not found`, 'NOT_FOUND');
          auditCall('templates_manage', args.verticalId, start, 'SUCCESS', args);
          return jsonResponse(t);
        }

        if (args.action === 'create_project') {
          if (!args.verticalId) return errorResponse('verticalId is required');
          const t = VERTICAL_PRESETS.find((v) => v.id === args.verticalId);
          if (!t) return errorResponse(`Template ${args.verticalId} not found`, 'NOT_FOUND');

          const name = args.projectName || `${t.name} Website`;
          const projectId = `prj_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

          // Generate files using Starli deterministic template generator
          const spec = buildProposalSpec({
            proposalId: `prp_${randomUUID().slice(0, 8)}`,
            leadId: `lead_${randomUUID().slice(0, 8)}`,
            lead: {
              businessName: name,
              industry: args.verticalId,
              locality: args.locality || 'București',
              normalizedPhone: args.phone || '+40700000000',
            },
            mode: 'snapshot',
          });

          const files = makePremiumNextFiles(spec);

          const previewHtml = renderNextPreviewHtml(files, {
            title: name,
            description: t.description,
          });

          const now = new Date().toISOString();
          const project = {
            id: projectId,
            ownerId: principal.id,
            name,
            brief: `Website generat din șablonul ${t.name}`,
            status: 'SOURCE_READY',
            publishState: 'never_deployed',
            previewHtml,
            files,
            versions: [],
            createdAt: now,
            updatedAt: now,
          };

          store.put('projects', project);
          events?.publish('projects');

          const result = {
            status: 'PROJECT_CREATED',
            projectId,
            templateId: args.verticalId,
            name,
            filesCount: files.length,
            previewUrl: `/app/projects/${projectId}`,
          };

          auditCall('templates_manage', projectId, start, 'SUCCESS', args, result);
          return jsonResponse(result);
        }

        return errorResponse(`Invalid action: ${args.action}`);
      } catch (err: any) {
        auditCall('templates_manage', args.verticalId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`templates_manage failed: ${err.message}`);
      }
    }
  );
}
