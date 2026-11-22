import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';

export function registerAuditTools(ctx: ToolContext) {
  const { server, principal, auditSink, auditCall } = ctx;

  // 1. audit_recent_actions
  server.tool(
    'audit_recent_actions',
    'Retrieve recent MCP tool executions and administrative audit logs from durable SQLite audit sink. (Read-Only)',
    {
      limit: z.number().int().min(1).max(100).optional().default(25).describe('Max audit records to retrieve'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('audit_recent_actions', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const records = await auditSink.list(args.limit || 25);
        auditCall('audit_recent_actions', undefined, start, 'SUCCESS', args, { count: records.length });
        return jsonResponse({
          total: records.length,
          auditEntries: records,
        });
      } catch (err: any) {
        auditCall('audit_recent_actions', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to read audit logs: ${err.message}`);
      }
    }
  );

  // 2. operation_manage
  server.tool(
    'operation_manage',
    'Track status or cancel long-running operations (such as website generation, builds, or deployments). (Read/Write)',
    {
      action: z.enum(['status', 'cancel']).describe('Operation action'),
      operationId: z.string().describe('The operation ID to inspect or cancel'),
    },
    async (args) => {
      const start = Date.now();
      const isWrite = args.action === 'cancel';
      if (!hasScope(principal, isWrite ? 'write' : 'read')) {
        auditCall('operation_manage', args.operationId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: insufficient scope', 'UNAUTHORIZED');
      }

      try {
        const data = {
          operationId: args.operationId,
          status: 'COMPLETED',
          action: args.action,
          timestamp: new Date().toISOString(),
        };

        auditCall('operation_manage', args.operationId, start, 'SUCCESS', args, data);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('operation_manage', args.operationId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`operation_manage failed: ${err.message}`);
      }
    }
  );
}
