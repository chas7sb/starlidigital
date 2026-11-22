import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope, redactSecrets } from './security.js';

export function registerDatabaseTools(ctx: ToolContext) {
  const { server, principal, store, auditCall } = ctx;

  // 1. database_overview
  server.tool(
    'database_overview',
    'Inspect SQLite database schema: tables, collections, total records, and index coverage. (Read-Only)',
    {},
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('database_overview', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        const collectionsQuery = store.db.prepare('SELECT collection, count(*) as count FROM records GROUP BY collection').all();
        const usersCount = (store.db.prepare('SELECT count(*) as count FROM users').get() as any)?.count || 0;
        const sessionsCount = (store.db.prepare('SELECT count(*) as count FROM sessions').get() as any)?.count || 0;

        const overview = {
          engine: 'node:sqlite (WAL Mode)',
          tables: ['records', 'users', 'sessions', 'resets'],
          usersCount,
          activeSessionsCount: sessionsCount,
          collections: collectionsQuery.map((r: any) => ({
            collection: r.collection,
            count: Number(r.count),
          })),
        };

        auditCall('database_overview', undefined, start, 'SUCCESS', args);
        return jsonResponse(overview);
      } catch (err: any) {
        auditCall('database_overview', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`database_overview failed: ${err.message}`);
      }
    }
  );

  // 2. database_query
  server.tool(
    'database_query',
    'Read-only structured querying of SQLite records collection. Redacts passwords, salts, and secret credentials. (Read-Only)',
    {
      collection: z.string().describe('Target collection (e.g. projects, crm_companies, leads, proposals, mailbox-messages)'),
      search: z.string().optional().describe('Keyword text search within record payload'),
      limit: z.number().int().min(1).max(100).optional().default(25).describe('Max records to return'),
      offset: z.number().int().min(0).optional().default(0).describe('Offset for pagination'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('database_query', args.collection, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        let records = store.list(args.collection);

        if (args.search) {
          const q = args.search.toLowerCase();
          records = records.filter((r: any) => JSON.stringify(r).toLowerCase().includes(q));
        }

        const total = records.length;
        const paged = records.slice(args.offset, args.offset + args.limit).map((r: any) => {
          const sanitized = { ...r };
          delete sanitized.passwordHash;
          delete sanitized.tokenHash;
          delete sanitized.salt;
          return redactSecrets(sanitized);
        });

        const result = {
          collection: args.collection,
          total,
          offset: args.offset,
          limit: args.limit,
          records: paged,
        };

        auditCall('database_query', args.collection, start, 'SUCCESS', args, { count: paged.length, total });
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('database_query', args.collection, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`database_query failed: ${err.message}`);
      }
    }
  );

  // 3. database_record_manage
  server.tool(
    'database_record_manage',
    'Get, update, or remove a record within a collection. Audited and scoped. (Read/Write)',
    {
      action: z.enum(['get', 'put', 'delete']).describe('Record action'),
      collection: z.string().describe('Target collection'),
      id: z.string().describe('Record identifier'),
      payload: z.record(z.unknown()).optional().describe('Data payload for "put" action (must include id)'),
    },
    async (args) => {
      const start = Date.now();
      const isWrite = args.action !== 'get';
      if (!hasScope(principal, isWrite ? 'write' : 'read')) {
        auditCall('database_record_manage', `${args.collection}:${args.id}`, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: insufficient scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        if (args.action === 'get') {
          const record = store.get(args.collection, args.id);
          if (!record) return errorResponse(`Record ${args.id} not found in collection ${args.collection}`, 'NOT_FOUND');
          const clean = { ...record };
          delete clean.passwordHash;
          delete clean.tokenHash;
          auditCall('database_record_manage', `${args.collection}:${args.id}`, start, 'SUCCESS', args);
          return jsonResponse(redactSecrets(clean));
        }

        if (args.action === 'put') {
          if (!args.payload) return errorResponse('Payload is required for "put" action');
          const toSave = { ...args.payload, id: args.id };
          store.put(args.collection, toSave as any);
          auditCall('database_record_manage', `${args.collection}:${args.id}`, start, 'SUCCESS', args);
          return jsonResponse({ status: 'SAVED', collection: args.collection, id: args.id });
        }

        if (args.action === 'delete') {
          store.remove(args.collection, args.id);
          auditCall('database_record_manage', `${args.collection}:${args.id}`, start, 'SUCCESS', args);
          return jsonResponse({ status: 'DELETED', collection: args.collection, id: args.id });
        }

        return errorResponse(`Invalid action: ${args.action}`);
      } catch (err: any) {
        auditCall('database_record_manage', `${args.collection}:${args.id}`, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`database_record_manage failed: ${err.message}`);
      }
    }
  );
}
