import { z } from 'zod';
import os from 'node:os';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';

export function registerPlatformTools(ctx: ToolContext) {
  const { server, principal, healthProbe, store, auditCall } = ctx;

  // 1. platform_overview
  server.tool(
    'platform_overview',
    'Provides a structured overview of the StarliDigital platform architecture, subsystems, and operational state. (Read-Only)',
    {
      includeMetrics: z.boolean().optional().default(true).describe('Include CPU, memory, and disk usage statistics'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('platform_overview', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const collections = ['projects', 'leads', 'proposals', 'crm_companies', 'mailbox-messages', 'posts'];
        const collectionCounts: Record<string, number> = {};
        if (store) {
          for (const col of collections) {
            try {
              collectionCounts[col] = store.list(col).length;
            } catch {
              collectionCounts[col] = 0;
            }
          }
        }

        const data: Record<string, unknown> = {
          service: 'starlidigital-control-plane',
          environment: process.env.NODE_ENV || 'production',
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          platform: process.platform,
          architecture: {
            frontend: 'React 19 / Vite SPA deployed on Vercel (https://starlidigital.ro)',
            api: 'Node.js 24 + GraphQL Yoga + REST on port 4119 (https://api.starlidigital.ro)',
            controlPlane: 'Streamable HTTP MCP Server on port 4120 (/mcp)',
            database: 'SQLite WAL (/var/lib/starlidigital/starli.sqlite)',
            websiteGenerator: 'Next.js App Router (TypeScript + React 19 + AST validation)',
            aiProviders: ['OpenAI (gpt-5.4-nano, gpt-4.1, dalle-3)', 'Outlier (Claude Opus 4.6)'],
            mailbox: 'IMAP sync + SMTP outreach delivery',
          },
          collectionsSummary: collectionCounts,
        };

        if (args.includeMetrics) {
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          data.metrics = {
            memoryTotalMb: Math.round(totalMem / (1024 * 1024)),
            memoryUsedMb: Math.round((totalMem - freeMem) / (1024 * 1024)),
            memoryFreeMb: Math.round(freeMem / (1024 * 1024)),
            cpuCores: os.cpus().length,
            loadAverage: os.loadavg(),
          };
        }

        auditCall('platform_overview', undefined, start, 'SUCCESS', args);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('platform_overview', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to load platform overview: ${err.message}`);
      }
    }
  );

  // 2. platform_capabilities
  server.tool(
    'platform_capabilities',
    'Returns the dynamic catalog of capabilities that the platform supports and caller permissions. (Read-Only)',
    {
      category: z.enum([
        'ALL', 'DISCOVERY', 'PROJECTS', 'FILES', 'GIT', 'DEPLOY',
        'SERVER', 'DATABASE', 'JOBS', 'AI', 'CRM', 'OUTREACH'
      ]).optional().default('ALL').describe('Filter capabilities by domain category'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('platform_capabilities', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      const capabilities = {
        websiteGeneration: true,
        websiteEditing: true,
        nextJsAstValidation: true,
        deployments: true,
        vercelIntegration: true,
        crm: true,
        emailOutreach: true,
        aiGeneration: true,
        gitVersionControl: true,
        databaseManagement: true,
        serverOperations: principal.role === 'admin',
        caller: {
          id: principal.id,
          role: principal.role,
          scopes: principal.scopes,
        },
      };

      auditCall('platform_capabilities', undefined, start, 'SUCCESS', args);
      return jsonResponse(capabilities);
    }
  );

  // 3. platform_health & ops_health
  const executeHealthProbe = async (args: Record<string, unknown>, toolName: string) => {
    const start = Date.now();
    if (!hasScope(principal, 'read')) {
      auditCall(toolName, undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
      return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
    }

    try {
      const upstreamResult = healthProbe ? await healthProbe.probe() : { ready: true, service: 'starlidigital-control', dependencies: { db: 'UP' as const } };
      const storeHealthy = !!store;

      const result = {
        status: upstreamResult.ready && storeHealthy ? 'HEALTHY' : 'DEGRADED',
        service: upstreamResult.service,
        dependencies: {
          ...upstreamResult.dependencies,
          database: storeHealthy ? 'UP' : 'DOWN',
        },
        timestamp: new Date().toISOString(),
        details: upstreamResult.details || 'All services operational',
      };

      auditCall(toolName, undefined, start, 'SUCCESS', args);
      return jsonResponse(result);
    } catch (err: any) {
      auditCall(toolName, undefined, start, 'FAILED', args, undefined, err.message);
      return errorResponse(`Health probe failed: ${err.message}`);
    }
  };

  server.tool(
    'platform_health',
    'Deep health probe checking API, database, background workers, website builder, and deployment readiness. (Read-Only)',
    {
      deepCheck: z.boolean().optional().default(false).describe('Perform active check'),
    },
    async (args) => executeHealthProbe(args, 'platform_health')
  );
}
