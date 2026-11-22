import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';

export function registerProjectTools(ctx: ToolContext) {
  const { server, principal, store, events, auditCall } = ctx;

  // 1. projects_list
  server.tool(
    'projects_list',
    'List StarliDigital customer website projects with pagination, search, and status filters. (Read-Only)',
    {
      search: z.string().optional().describe('Keyword filter for project name or brief'),
      status: z.string().optional().describe('Filter by project status (BRIEF, BUILDING, SOURCE_READY, LIVE, etc.)'),
      limit: z.number().int().min(1).max(100).optional().default(25).describe('Max records to return'),
      offset: z.number().int().min(0).optional().default(0).describe('Records offset'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('projects_list', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        let projects = store.list('projects');
        if (args.search) {
          const q = args.search.toLowerCase();
          projects = projects.filter((p: any) =>
            (p.name && p.name.toLowerCase().includes(q)) ||
            (p.brief && p.brief.toLowerCase().includes(q)) ||
            (p.id && p.id.toLowerCase().includes(q))
          );
        }
        if (args.status) {
          projects = projects.filter((p: any) => p.status === args.status);
        }

        const total = projects.length;
        const paged = projects.slice(args.offset, args.offset + args.limit).map((p: any) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          publishState: p.publishState,
          previewUrl: p.previewUrl,
          deploymentUrl: p.deploymentUrl,
          filesCount: (p.files || []).length,
          updatedAt: p.updatedAt,
          createdAt: p.createdAt,
        }));

        auditCall('projects_list', undefined, start, 'SUCCESS', args, { count: paged.length, total });
        return jsonResponse({ total, offset: args.offset, limit: args.limit, projects: paged });
      } catch (err: any) {
        auditCall('projects_list', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to list projects: ${err.message}`);
      }
    }
  );

  // 2. project_get
  server.tool(
    'project_get',
    'Retrieve full details of a StarliDigital website project, including files manifest, preview HTML, and build status. (Read-Only)',
    {
      projectId: z.string().describe('The unique project ID'),
      includeFilesContent: z.boolean().optional().default(false).describe('Whether to include full content of all files (can be large)'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('project_get', args.projectId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        const project = store.get('projects', args.projectId);
        if (!project) return errorResponse(`Project ${args.projectId} not found`, 'NOT_FOUND');

        const filesSummary = (project.files || []).map((f: any) => ({
          path: f.path,
          sizeBytes: f.content ? f.content.length : 0,
          encoding: f.encoding,
          content: args.includeFilesContent ? f.content : undefined,
        }));

        const result = {
          id: project.id,
          name: project.name,
          brief: project.brief,
          status: project.status,
          publishState: project.publishState,
          previewUrl: project.previewUrl,
          deploymentUrl: project.deploymentUrl,
          research: project.research,
          knowledge: project.knowledge,
          files: filesSummary,
          versionsCount: (project.versions || []).length,
          updatedAt: project.updatedAt,
          createdAt: project.createdAt,
        };

        auditCall('project_get', args.projectId, start, 'SUCCESS', args);
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('project_get', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to get project: ${err.message}`);
      }
    }
  );

  // 3. project_manage
  server.tool(
    'project_manage',
    'Manage project lifecycle: create, update metadata, delete, or duplicate a website project. (Mutating)',
    {
      action: z.enum(['create', 'update', 'delete', 'duplicate']).describe('Action to perform'),
      companyId: z.string().optional().describe('Existing CRM company ID to link when creating a project.'),
      workspaceId: z.string().optional().describe('Existing client workspace ID to link when creating a project.'),
      projectId: z.string().optional().describe('Project ID (required for update, delete, duplicate)'),
      name: z.string().optional().describe('Project name (for create or update)'),
      brief: z.string().optional().describe('Business brief or requirements (for create or update)'),
      confirmDelete: z.boolean().optional().describe('Must be true to authorize deletion'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'write')) {
        auditCall('project_manage', args.projectId, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        const now = new Date().toISOString();

        if (args.action === 'create') {
          let linkedCompanyId=args.companyId;
          if(args.workspaceId){const workspace=store.get('client-workspaces',args.workspaceId);if(!workspace)return errorResponse('Workspace not found','NOT_FOUND');if(linkedCompanyId&&linkedCompanyId!==workspace.companyId)return errorResponse('Workspace and company do not match','BAD_USER_INPUT');linkedCompanyId=workspace.companyId;}
          if(linkedCompanyId&&!store.get('crm_companies',linkedCompanyId))return errorResponse('CRM company not found','NOT_FOUND');
          if (!args.name) return errorResponse('Project name is required for create');
          const newId = `prj_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
          const project = {
            id: newId,
            ownerId: principal.id,
            companyId: linkedCompanyId,
            workspaceId: args.workspaceId,
            name: args.name,
            brief: args.brief || '',
            status: 'BRIEF',
            publishState: 'never_deployed',
            files: [],
            versions: [],
            knowledge: { rules: [], language: 'en' },
            createdAt: now,
            updatedAt: now,
          };
          store.put('projects', project);
          events?.publish('projects');
          auditCall('project_manage', newId, start, 'SUCCESS', args, { id: newId });
          return jsonResponse({ status: 'CREATED', project });
        }

        if (args.action === 'update') {
          if (!args.projectId) return errorResponse('projectId is required for update');
          const project = store.get('projects', args.projectId);
          if (!project) return errorResponse(`Project ${args.projectId} not found`, 'NOT_FOUND');

          if (args.name !== undefined) project.name = args.name;
          if (args.brief !== undefined) project.brief = args.brief;
          project.updatedAt = now;

          store.put('projects', project);
          events?.publish('projects');
          auditCall('project_manage', args.projectId, start, 'SUCCESS', args);
          return jsonResponse({ status: 'UPDATED', project });
        }

        if (args.action === 'delete') {
          if (!args.projectId) return errorResponse('projectId is required for delete');
          if (!args.confirmDelete) return errorResponse('confirmDelete: true is required for project deletion');
          store.remove('projects', args.projectId);
          events?.publish('projects');
          auditCall('project_manage', args.projectId, start, 'SUCCESS', args);
          return jsonResponse({ status: 'DELETED', projectId: args.projectId });
        }

        if (args.action === 'duplicate') {
          if (!args.projectId) return errorResponse('projectId is required for duplicate');
          const orig = store.get('projects', args.projectId);
          if (!orig) return errorResponse(`Project ${args.projectId} not found`, 'NOT_FOUND');

          const dupId = `prj_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
          const clone = {
            ...orig,
            id: dupId,
            name: `${orig.name} (Copy)`,
            publishState: 'never_deployed',
            createdAt: now,
            updatedAt: now,
          };
          store.put('projects', clone);
          events?.publish('projects');
          auditCall('project_manage', dupId, start, 'SUCCESS', args, { originalId: args.projectId, newId: dupId });
          return jsonResponse({ status: 'DUPLICATED', project: clone });
        }

        return errorResponse(`Unsupported action ${args.action}`);
      } catch (err: any) {
        auditCall('project_manage', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Project operation failed: ${err.message}`);
      }
    }
  );
}
