import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';

export function registerApiTools(ctx: ToolContext) {
  const { server, principal, config, auditCall } = ctx;

  const API_CATALOG = {
    restEndpoints: [
      { method: 'GET', path: '/health', description: 'Public health status of Starli API and database connectivity' },
      { method: 'GET', path: '/healthz', description: 'Control plane liveness probe' },
      { method: 'GET', path: '/.well-known/oauth-authorization-server', description: 'RFC 8414 OAuth 2.0 authorization server discovery' },
      { method: 'GET', path: '/.well-known/oauth-protected-resource', description: 'RFC 9728 OAuth protected resource discovery for MCP' },
      { method: 'POST', path: '/oauth/token', description: 'OAuth 2.0 token endpoint for authorization code / refresh token' },
      { method: 'GET', path: '/oauth/authorize', description: 'OAuth 2.0 authorization code login consent dialog' },
      { method: 'GET', path: '/media/assets/:id', description: 'Serves binary asset image (PNG, JPEG, WebP) with ownership validation' },
      { method: 'POST', path: '/graphql', description: 'Main GraphQL Yoga endpoint for all business mutations and queries' },
      { method: 'POST', path: '/mcp', description: 'Streamable HTTP Model Context Protocol endpoint' },
    ],
    graphQLQueries: [
      { name: 'projects', returnType: '[Project!]!', description: 'List all customer websites/projects' },
      { name: 'project(id)', returnType: 'Project', description: 'Get full project details, files, and preview HTML' },
      { name: 'conversations', returnType: '[Conversation!]!', description: 'List chat sessions with Starli AI or Alex' },
      { name: 'leads', returnType: '[Lead!]!', description: 'List identified business leads' },
      { name: 'proposals', returnType: '[Proposal!]!', description: 'List prepared commercial proposals and website demos' },
      { name: 'crmCompanies', returnType: '[CrmCompany!]!', description: 'Query CRM companies with search/qualification filter' },
      { name: 'crmOpportunities', returnType: '[CrmOpportunity!]!', description: 'Query CRM deals/pipeline opportunities' },
      { name: 'mailboxMessages', returnType: 'MailMessagesResult!', description: 'List synced emails in Inbox/Sent/Drafts' },
      { name: 'adminOverview', returnType: 'AdminOverview!', description: 'High-level admin metrics (users, projects, posts)' },
    ],
    graphQLMutations: [
      { name: 'createProject(name, brief)', returnType: 'Project!', description: 'Create a new website project' },
      { name: 'updateProject(id, name, brief)', returnType: 'Project!', description: 'Update project metadata' },
      { name: 'buildProject(id, ...)', returnType: 'Project!', description: 'Generate Next.js source code using Starli AI' },
      { name: 'deployProject(id)', returnType: 'Project!', description: 'Trigger Vercel production edge deployment' },
      { name: 'deleteProject(id)', returnType: 'Boolean!', description: 'Delete a project' },
      { name: 'crmUpsertCompany(input)', returnType: 'CrmCompany!', description: 'Create or update CRM company' },
      { name: 'mailboxCreateDraft(input)', returnType: 'MailDraftRecord!', description: 'Create email draft in mailbox' },
      { name: 'mailboxSendApprovedDraft(draftId)', returnType: 'MailMessageRecord!', description: 'Dispatch approved draft via SMTP' },
    ],
  };

  // 1. api_overview
  server.tool(
    'api_overview',
    'Catalog of StarliDigital REST endpoints and GraphQL queries/mutations with descriptions and schemas. (Read-Only)',
    {
      query: z.string().optional().describe('Optional keyword search filter across paths, operations, and descriptions'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('api_overview', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      let rest = API_CATALOG.restEndpoints;
      let queries = API_CATALOG.graphQLQueries;
      let mutations = API_CATALOG.graphQLMutations;

      if (args.query) {
        const q = args.query.toLowerCase();
        rest = rest.filter((e) => e.path.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
        queries = queries.filter((op) => op.name.toLowerCase().includes(q) || op.description.toLowerCase().includes(q));
        mutations = mutations.filter((op) => op.name.toLowerCase().includes(q) || op.description.toLowerCase().includes(q));
      }

      auditCall('api_overview', undefined, start, 'SUCCESS', args);
      return jsonResponse({
        restEndpoints: rest,
        graphQLQueries: queries,
        graphQLMutations: mutations,
        totalMatches: rest.length + queries.length + mutations.length,
      });
    }
  );

  // 2. platform_api_request
  server.tool(
    'platform_api_request',
    'Invoke a StarliDigital REST API endpoint with authenticated server-side credentials injected automatically. (Read/Write)',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
      path: z.string().describe('API path, e.g. /health or /media/assets/:id'),
      query: z.record(z.string()).optional().describe('Query parameters'),
      body: z.record(z.unknown()).optional().describe('Request payload'),
    },
    async (args) => {
      const start = Date.now();
      const isWrite = args.method !== 'GET';
      if (!hasScope(principal, isWrite ? 'write' : 'read')) {
        auditCall('platform_api_request', args.path, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: insufficient scope', 'UNAUTHORIZED');
      }

      try {
        const baseUrl = config?.upstreamHealthUrl ? new URL(config.upstreamHealthUrl).origin : 'http://127.0.0.1:4119';
        const url = new URL(args.path.startsWith('/') ? args.path : `/${args.path}`, baseUrl);

        if (args.query) {
          for (const [k, v] of Object.entries(args.query)) {
            url.searchParams.set(k, String(v));
          }
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'StarliControlPlane/1.0',
        };

        const res = await fetch(url.href, {
          method: args.method,
          headers,
          body: args.body ? JSON.stringify(args.body) : undefined,
          signal: AbortSignal.timeout(15000),
        });

        const text = await res.text();
        let parsedData: unknown;
        try {
          parsedData = JSON.parse(text);
        } catch {
          parsedData = text.slice(0, 4000);
        }

        const result = {
          status: res.status,
          ok: res.ok,
          data: parsedData,
        };

        auditCall('platform_api_request', args.path, start, res.ok ? 'SUCCESS' : 'FAILED', args, result);
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('platform_api_request', args.path, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`API request failed: ${err.message}`);
      }
    }
  );

  // 3. platform_graphql
  server.tool(
    'platform_graphql',
    'Execute a GraphQL query or mutation against the StarliDigital GraphQL schema. (Read/Write)',
    {
      query: z.string().describe('GraphQL query or mutation document'),
      variables: z.record(z.unknown()).optional().describe('Query variables'),
      operationName: z.string().optional().describe('Operation name if document contains multiple operations'),
    },
    async (args) => {
      const start = Date.now();
      const isMutation = args.query.trim().startsWith('mutation');
      if (!hasScope(principal, isMutation ? 'write' : 'read')) {
        auditCall('platform_graphql', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: insufficient scope', 'UNAUTHORIZED');
      }

      try {
        const baseUrl = config?.upstreamHealthUrl ? new URL(config.upstreamHealthUrl).origin : 'http://127.0.0.1:4119';
        const url = new URL('/graphql', baseUrl);

        const res = await fetch(url.href, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'StarliControlPlane/1.0',
          },
          body: JSON.stringify({
            query: args.query,
            variables: args.variables,
            operationName: args.operationName,
          }),
          signal: AbortSignal.timeout(30000),
        });

        const data = await res.json();
        auditCall('platform_graphql', undefined, start, 'SUCCESS', args, { ok: !data.errors });
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('platform_graphql', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`GraphQL execution failed: ${err.message}`);
      }
    }
  );
}
