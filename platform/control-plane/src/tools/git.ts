import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { boundedExec, hasScope } from './security.js';

export function registerGitTools(ctx: ToolContext) {
  const { server, principal, workspaceRoot, auditCall } = ctx;

  // 1. git_status
  server.tool(
    'git_status',
    'Get current Git working tree status: branch, staged changes, modified files, and untracked files. (Read-Only)',
    {},
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('git_status', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const branchRes = await boundedExec('git', ['branch', '--show-current'], workspaceRoot, 10000);
        const statusRes = await boundedExec('git', ['status', '--porcelain=v1'], workspaceRoot, 10000);

        const currentBranch = branchRes.stdout.trim() || 'HEAD';
        const lines = statusRes.stdout.split('\n').filter(Boolean);
        const staged: string[] = [];
        const modified: string[] = [];
        const untracked: string[] = [];

        for (const line of lines) {
          const x = line[0];
          const y = line[1];
          const file = line.slice(3).trim();

          if (x !== ' ' && x !== '?') staged.push(file);
          if (y === 'M' || y === 'D') modified.push(file);
          if (x === '?' && y === '?') untracked.push(file);
        }

        const data = {
          branch: currentBranch,
          isClean: lines.length === 0,
          staged,
          modified,
          untracked,
          totalChanges: lines.length,
        };

        auditCall('git_status', undefined, start, 'SUCCESS', args, data);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('git_status', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`git_status failed: ${err.message}`);
      }
    }
  );

  // 2. git_diff
  server.tool(
    'git_diff',
    'View Git diff of modified files or staged changes. Does not expose credentials or secrets. (Read-Only)',
    {
      staged: z.boolean().optional().default(false).describe('View staged changes instead of working tree diff'),
      path: z.string().optional().describe('Optional file path to limit diff output'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('git_diff', args.path, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const gitArgs = ['diff'];
        if (args.staged) gitArgs.push('--staged');
        if (args.path) gitArgs.push('--', args.path);

        const diffRes = await boundedExec('git', gitArgs, workspaceRoot, 15000);
        const result = {
          staged: args.staged,
          path: args.path,
          diff: diffRes.stdout.slice(0, 32000) || '(No changes)',
          truncated: diffRes.stdout.length > 32000,
        };

        auditCall('git_diff', args.path, start, 'SUCCESS', args);
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('git_diff', args.path, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`git_diff failed: ${err.message}`);
      }
    }
  );

  // 3. git_manage
  server.tool(
    'git_manage',
    'Execute controlled Git operations: add, commit, push, pull, checkout, or create branch. Never forces push. (Mutating)',
    {
      action: z.enum(['add', 'commit', 'push', 'pull', 'checkout', 'branch_create', 'restore']).describe('Git action to perform'),
      files: z.array(z.string()).optional().describe('Files for add or restore (defaults to "." for add)'),
      message: z.string().optional().describe('Commit message (required for commit)'),
      branch: z.string().optional().describe('Branch name (for checkout or branch_create)'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'write')) {
        auditCall('git_manage', args.action, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }

      try {
        let execArgs: string[] = [];

        if (args.action === 'add') {
          const files = args.files && args.files.length > 0 ? args.files : ['.'];
          execArgs = ['add', ...files];
        } else if (args.action === 'commit') {
          if (!args.message) return errorResponse('Commit message is required for git commit');
          execArgs = ['commit', '-m', args.message];
        } else if (args.action === 'push') {
          execArgs = ['push'];
        } else if (args.action === 'pull') {
          execArgs = ['pull'];
        } else if (args.action === 'checkout') {
          if (!args.branch) return errorResponse('Branch name is required for checkout');
          execArgs = ['checkout', args.branch];
        } else if (args.action === 'branch_create') {
          if (!args.branch) return errorResponse('Branch name is required for branch_create');
          execArgs = ['checkout', '-b', args.branch];
        } else if (args.action === 'restore') {
          if (!args.files || args.files.length === 0) return errorResponse('Files list required for restore');
          execArgs = ['restore', ...args.files];
        }

        const res = await boundedExec('git', execArgs, workspaceRoot, 30000);
        const data = {
          action: args.action,
          status: res.status,
          exitCode: res.exitCode,
          output: res.stdout || res.stderr,
        };

        auditCall('git_manage', args.action, start, res.exitCode === 0 ? 'SUCCESS' : 'FAILED', args, data);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('git_manage', args.action, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`git_manage failed: ${err.message}`);
      }
    }
  );
}
