import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';
import { buildNextSite } from '../../../server/src/site-builder.js';
import { validateNextProjectFiles, type SourceFile } from '../../../server/src/next-template.js';
import { renderNextPreviewHtml } from '../../../server/src/preview-renderer.js';

function validateFiles(files: unknown): { valid: boolean; error?: string } {
  try {
    validateNextProjectFiles(files);
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

export function registerWebsiteTools(ctx: ToolContext) {
  const { server, principal, store, events, auditCall } = ctx;

  // 1. website_generate
  server.tool(
    'website_generate',
    'Generate or iteratively rebuild a Next.js website using the Starli AI website generator. Reuses existing files for iterative section editing. (Mutating)',
    {
      projectId: z.string().optional().describe('Existing project ID to iteratively rebuild; if omitted, creates a new project'),
      name: z.string().describe('Business or website name'),
      brief: z.string().describe('Detailed prompt describing the business, services, target audience, and styling instructions'),
      selectedElementContext: z.string().optional().describe('Focus the edit on a specific section (e.g. "hero section", "services", "contact")'),
      regenerateImages: z.boolean().optional().default(false).describe('Whether to regenerate AI hero & logo raster images'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'write')) {
        auditCall('website_generate', args.projectId, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        let projectId = args.projectId;
        let existingFiles: SourceFile[] | undefined;
        let projectRecord: any;

        if (projectId) {
          projectRecord = store.get('projects', projectId);
          if (projectRecord && Array.isArray(projectRecord.files) && projectRecord.files.length > 0) {
            existingFiles = projectRecord.files;
          }
        }

        const buildResult = await buildNextSite(args.brief, args.name, {
          existingFiles,
          selectedElementContext: args.selectedElementContext,
          regenerateImages: args.regenerateImages,
        });

        const check = validateFiles(buildResult.files);
        if (!check.valid) {
          return errorResponse(`AST validation failed: ${check.error}`, 'VALIDATION_FAILED');
        }

        const previewHtml = buildResult.previewHtml || renderNextPreviewHtml(buildResult.files, {
          title: args.name,
          description: args.brief.slice(0, 160),
        });

        const now = new Date().toISOString();
        if (!projectId) {
          projectId = `prj_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
          projectRecord = {
            id: projectId,
            ownerId: principal.id,
            name: args.name,
            brief: args.brief,
            status: 'SOURCE_READY',
            publishState: 'never_deployed',
            previewHtml,
            files: buildResult.files,
            research: buildResult.research || null,
            sources: buildResult.sources || [],
            versions: [],
            createdAt: now,
            updatedAt: now,
          };
        } else {
          projectRecord = {
            ...projectRecord,
            name: args.name || projectRecord.name,
            brief: args.brief || projectRecord.brief,
            status: 'SOURCE_READY',
            previewHtml,
            files: buildResult.files,
            research: buildResult.research || projectRecord.research,
            sources: buildResult.sources || projectRecord.sources,
            updatedAt: now,
          };
        }

        store.put('projects', projectRecord);
        events?.publish('projects');

        const summary = {
          projectId,
          status: projectRecord.status,
          filesGenerated: buildResult.files.length,
          files: buildResult.files.map((f: any) => f.path),
          hasPreview: !!previewHtml,
          previewUrl: `/app/projects/${projectId}`,
          researchSummary: buildResult.research ? buildResult.research.slice(0, 300) + '...' : undefined,
        };

        auditCall('website_generate', projectId, start, 'SUCCESS', args, summary);
        return jsonResponse(summary);
      } catch (err: any) {
        auditCall('website_generate', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Website generation failed: ${err.message}`);
      }
    }
  );

  // 2. website_get_structure
  server.tool(
    'website_get_structure',
    'Inspect the React/Next.js architecture of a generated website: pages, CSS design tokens, and components. (Read-Only)',
    {
      projectId: z.string().describe('The project ID to inspect'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('website_get_structure', args.projectId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        const project = store.get('projects', args.projectId);
        if (!project) return errorResponse(`Project ${args.projectId} not found`, 'NOT_FOUND');

        const files: SourceFile[] = project.files || [];
        const pages = files.filter((f) => f.path.startsWith('app/') && f.path.endsWith('.tsx')).map((f) => f.path);
        const components = files.filter((f) => f.path.startsWith('components/')).map((f) => f.path);
        const assets = files.filter((f) => f.path.startsWith('public/')).map((f) => f.path);

        const globalsCss = files.find((f) => f.path === 'app/globals.css')?.content || '';
        const rootVarsMatch = globalsCss.match(/:root\s*\{([^}]+)\}/);
        const tokens: Record<string, string> = {};
        if (rootVarsMatch) {
          const lines = rootVarsMatch[1].split(';');
          for (const line of lines) {
            const parts = line.split(':');
            if (parts.length === 2) {
              tokens[parts[0].trim()] = parts[1].trim();
            }
          }
        }

        const structure = {
          projectId: project.id,
          name: project.name,
          pages,
          components,
          assets,
          designTokens: tokens,
          totalFiles: files.length,
        };

        auditCall('website_get_structure', args.projectId, start, 'SUCCESS', args);
        return jsonResponse(structure);
      } catch (err: any) {
        auditCall('website_get_structure', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to get website structure: ${err.message}`);
      }
    }
  );
}
