import { z } from 'zod';
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { safePath, hasScope, redactSecrets } from './security.js';

export function registerFileTools(ctx: ToolContext) {
  const { server, principal, workspaceRoot, auditCall } = ctx;

  // 1. file_read
  server.tool(
    'file_read',
    'Read the contents of a source code or documentation file within approved project roots. Protects against secret exposure and path traversal. (Read-Only)',
    {
      path: z.string().describe('Relative path to the file from repository root'),
      startLine: z.number().int().min(1).optional().describe('First line to read (1-indexed)'),
      endLine: z.number().int().min(1).optional().describe('Last line to read (inclusive)'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('file_read', args.path, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const fullPath = await safePath(workspaceRoot, args.path, false);
        const rawContent = await readFile(fullPath, 'utf8');
        const lines = rawContent.split(/\r?\n/);
        const totalLines = lines.length;

        const s = args.startLine ? Math.max(1, args.startLine) : 1;
        const e = args.endLine ? Math.min(totalLines, args.endLine) : totalLines;
        const selected = lines.slice(s - 1, e);

        // Format with line numbers for easy LLM inspection
        const numberedContent = selected.map((line, idx) => `${s + idx}: ${line}`).join('\n');

        auditCall('file_read', args.path, start, 'SUCCESS', args, { totalLines, linesReturned: selected.length });
        return jsonResponse({
          path: args.path,
          startLine: s,
          endLine: e,
          totalLines,
          content: redactSecrets(numberedContent),
        });
      } catch (err: any) {
        auditCall('file_read', args.path, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to read file: ${err.message}`);
      }
    }
  );

  // 2. file_write
  server.tool(
    'file_write',
    'Write or overwrite a file within approved source directories. Rejects path traversal and sensitive system files. (Mutating)',
    {
      path: z.string().describe('Relative path to write (e.g. server/src/utils.ts, web/src/components/...)'),
      content: z.string().describe('The complete file content to write'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'write')) {
        auditCall('file_write', args.path, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }

      try {
        const fullPath = await safePath(workspaceRoot, args.path, true);
        await writeFile(fullPath, args.content, 'utf8');

        auditCall('file_write', args.path, start, 'SUCCESS', args, { bytesWritten: args.content.length });
        return jsonResponse({
          status: 'WRITTEN',
          path: args.path,
          bytesWritten: args.content.length,
        });
      } catch (err: any) {
        auditCall('file_write', args.path, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to write file: ${err.message}`);
      }
    }
  );

  // 3. file_patch
  server.tool(
    'file_patch',
    'Apply a targeted search-and-replace patch to a file. Preferred over rewriting full files. (Mutating)',
    {
      path: z.string().describe('Relative path to the file to modify'),
      search: z.string().describe('Exact block of code to find and replace'),
      replace: z.string().describe('The replacement block of code'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'write')) {
        auditCall('file_patch', args.path, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }

      try {
        const fullPath = await safePath(workspaceRoot, args.path, true);
        const original = await readFile(fullPath, 'utf8');

        if (!original.includes(args.search)) {
          return errorResponse(`Target code block not found in ${args.path}. Ensure whitespace matches exactly.`, 'TARGET_NOT_FOUND');
        }

        const count = original.split(args.search).length - 1;
        const patched = original.replace(args.search, args.replace);
        await writeFile(fullPath, patched, 'utf8');

        auditCall('file_patch', args.path, start, 'SUCCESS', args, { replacementsCount: 1, totalOccurrences: count });
        return jsonResponse({
          status: 'PATCHED',
          path: args.path,
          replacements: 1,
        });
      } catch (err: any) {
        auditCall('file_patch', args.path, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to patch file: ${err.message}`);
      }
    }
  );

  // 4. code_search
  server.tool(
    'code_search',
    'Search source code across approved workspace directories for keywords or patterns. (Read-Only)',
    {
      query: z.string().min(2).describe('Search term or keyword to look for'),
      subDirectory: z.string().optional().describe('Subdirectory to narrow search (e.g. server/src or web/src)'),
      maxResults: z.number().int().min(1).max(50).optional().default(20).describe('Max matches to return'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('code_search', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const searchRoot = args.subDirectory
          ? await safePath(workspaceRoot, args.subDirectory, false)
          : workspaceRoot;

        const results: Array<{ file: string; line: number; preview: string }> = [];

        async function walk(dir: string) {
          if (results.length >= (args.maxResults || 20)) return;
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= (args.maxResults || 20)) break;
            const full = join(dir, entry.name);
            const rel = relative(workspaceRoot, full).replace(/\\/g, '/');

            if (entry.isDirectory()) {
              if (['node_modules', '.git', 'dist', 'output', 'data', 'private', 'brain'].includes(entry.name)) continue;
              await walk(full);
            } else if (entry.isFile()) {
              if (!/\.(?:ts|tsx|js|mjs|json|css|md|html)$/i.test(entry.name)) continue;
              if (/\.(?:sqlite|db|env|pem|key)/i.test(entry.name)) continue;

              try {
                const content = await readFile(full, 'utf8');
                const lines = content.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].toLowerCase().includes(args.query.toLowerCase())) {
                    results.push({
                      file: rel,
                      line: i + 1,
                      preview: lines[i].trim().slice(0, 150),
                    });
                    if (results.length >= (args.maxResults || 20)) break;
                  }
                }
              } catch {
                // skip unreadable
              }
            }
          }
        }

        await walk(searchRoot);

        auditCall('code_search', undefined, start, 'SUCCESS', args, { matchesCount: results.length });
        return jsonResponse({
          query: args.query,
          matches: results,
          totalReturned: results.length,
        });
      } catch (err: any) {
        auditCall('code_search', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Code search failed: ${err.message}`);
      }
    }
  );
}
