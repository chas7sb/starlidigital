import { z } from 'zod';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';

export function registerConfigTools(ctx: ToolContext) {
  const { server, principal, store, auditCall } = ctx;

  // 1. config_overview
  server.tool(
    'config_overview',
    'List configured environment variables and integration settings with secret values strictly masked. (Read-Only)',
    {},
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('config_overview', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      const envList: Record<string, { configured: boolean; preview?: string }> = {};
      const knownKeys = [
        'NODE_ENV', 'PORT', 'CONTROL_PLANE_PORT', 'DATABASE_PATH',
        'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BUILD_MODEL',
        'OUTLIER_COOKIE', 'OUTLIER_CSRF_TOKEN',
        'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_ENABLED',
        'VERCEL_API_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID',
        'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
        'CONTROL_PLANE_PUBLIC_RESOURCE_URL', 'CONTROL_PLANE_OAUTH_ISSUER',
      ];

      for (const key of knownKeys) {
        const val = process.env[key];
        if (!val) {
          envList[key] = { configured: false };
        } else if (/KEY|PASS|SECRET|TOKEN|COOKIE/i.test(key)) {
          envList[key] = {
            configured: true,
            preview: val.length > 8 ? `${val.slice(0, 3)}...${val.slice(-3)}` : '***',
          };
        } else {
          envList[key] = {
            configured: true,
            preview: val,
          };
        }
      }

      auditCall('config_overview', undefined, start, 'SUCCESS', args);
      return jsonResponse({
        environment: process.env.NODE_ENV || 'production',
        variables: envList,
      });
    }
  );

  // 2. secret_manage
  server.tool(
    'secret_manage',
    'Check if a secret is configured (without revealing it) or set/update a secret key on the server. (Admin Mutating)',
    {
      action: z.enum(['status', 'set']).describe('Action: "status" to check presence, "set" to update'),
      key: z.string().describe('Environment variable name (e.g. OPENAI_API_KEY, VERCEL_API_TOKEN)'),
      value: z.string().optional().describe('Secret value to set (required for "set")'),
    },
    async (args) => {
      const start = Date.now();
      const isWrite = args.action === 'set';
      if (!hasScope(principal, isWrite ? 'admin' : 'read')) {
        auditCall('secret_manage', args.key, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires admin scope', 'UNAUTHORIZED');
      }

      try {
        if (args.action === 'status') {
          const val = process.env[args.key];
          const result = {
            key: args.key,
            configured: !!val && val.trim().length > 0,
            length: val ? val.length : 0,
          };
          auditCall('secret_manage', args.key, start, 'SUCCESS', args, result);
          return jsonResponse(result);
        }

        if (args.action === 'set') {
          if (!args.value) return errorResponse('Value is required for "set" action');

          process.env[args.key] = args.value;

          // Also persist safely to server environment file if in production
          try {
            const envFilePath = resolve('/etc/starlidigital/production.env');
            await appendFile(envFilePath, `\n${args.key}="${args.value}"\n`, 'utf8');
          } catch {
            // If local development, ignore /etc write failure
          }

          auditCall('secret_manage', args.key, start, 'SUCCESS', args, { key: args.key, set: true });
          return jsonResponse({
            status: 'SET',
            key: args.key,
            configured: true,
          });
        }

        return errorResponse(`Invalid action ${args.action}`);
      } catch (err: any) {
        auditCall('secret_manage', args.key, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`secret_manage failed: ${err.message}`);
      }
    }
  );

  // 3. job_manage
  server.tool(
    'job_manage',
    'List, inspect, cancel, or retry background fulfillment and operator jobs. (Read/Write)',
    {
      action: z.enum(['list', 'status', 'cancel', 'retry']).describe('Job management action'),
      jobId: z.string().optional().describe('Job ID (required for status, cancel, retry)'),
      statusFilter: z.string().optional().describe('Filter by status (QUEUED, RUNNING, COMPLETED, FAILED)'),
      limit: z.number().int().min(1).max(50).optional().default(20).describe('Max jobs to return'),
    },
    async (args) => {
      const start = Date.now();
      const isWrite = args.action === 'cancel' || args.action === 'retry';
      if (!hasScope(principal, isWrite ? 'write' : 'read')) {
        auditCall('job_manage', args.jobId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: insufficient scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        if (args.action === 'list') {
          let jobs = store.list('fulfillment-jobs');
          if (jobs.length === 0) {
            jobs = store.list('operator-jobs');
          }
          if (args.statusFilter) {
            jobs = jobs.filter((j: any) => j.status === args.statusFilter);
          }
          const paged = jobs.slice(0, args.limit || 20);
          auditCall('job_manage', undefined, start, 'SUCCESS', args, { count: paged.length });
          return jsonResponse({ total: jobs.length, jobs: paged });
        }

        if (args.action === 'status') {
          if (!args.jobId) return errorResponse('jobId is required for status check');
          const job = store.get('fulfillment-jobs', args.jobId) || store.get('operator-jobs', args.jobId);
          if (!job) return errorResponse(`Job ${args.jobId} not found`, 'NOT_FOUND');
          auditCall('job_manage', args.jobId, start, 'SUCCESS', args);
          return jsonResponse(job);
        }

        if (args.action === 'cancel') {
          if (!args.jobId) return errorResponse('jobId is required for cancellation');
          let job = store.get('fulfillment-jobs', args.jobId) || store.get('operator-jobs', args.jobId);
          if (!job) return errorResponse(`Job ${args.jobId} not found`, 'NOT_FOUND');
          job.status = 'CANCELED';
          job.updatedAt = new Date().toISOString();
          store.put('fulfillment-jobs', job);
          auditCall('job_manage', args.jobId, start, 'SUCCESS', args);
          return jsonResponse({ status: 'CANCELED', jobId: args.jobId });
        }

        if (args.action === 'retry') {
          if (!args.jobId) return errorResponse('jobId is required for retry');
          let job = store.get('fulfillment-jobs', args.jobId) || store.get('operator-jobs', args.jobId);
          if (!job) return errorResponse(`Job ${args.jobId} not found`, 'NOT_FOUND');
          job.status = 'QUEUED';
          job.retryCount = (job.retryCount || 0) + 1;
          job.updatedAt = new Date().toISOString();
          store.put('fulfillment-jobs', job);
          auditCall('job_manage', args.jobId, start, 'SUCCESS', args);
          return jsonResponse({ status: 'QUEUED', jobId: args.jobId, retryCount: job.retryCount });
        }

        return errorResponse(`Invalid action ${args.action}`);
      } catch (err: any) {
        auditCall('job_manage', args.jobId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`job_manage failed: ${err.message}`);
      }
    }
  );
}
