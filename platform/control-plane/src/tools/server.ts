import { z } from 'zod';
import os from 'node:os';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { boundedExec, hasScope } from './security.js';

const ALLOWED_SERVICES = new Set([
  'starlidigital.service',
  'starlidigital-control.service',
  'nginx.service',
  'nginx',
]);

export function registerServerTools(ctx: ToolContext) {
  const { server, principal, workspaceRoot, auditCall } = ctx;

  // 1. server_info
  server.tool(
    'server_info',
    'Get host system resource information: OS, CPU cores, load average, memory, and uptime. (Read-Only)',
    {},
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('server_info', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();

        const data = {
          hostname: os.hostname(),
          platform: os.platform(),
          release: os.release(),
          uptimeSeconds: Math.floor(os.uptime()),
          cpuModel: os.cpus()[0]?.model || 'Unknown',
          cpuCores: os.cpus().length,
          loadAverage: os.loadavg(),
          memory: {
            totalMb: Math.round(totalMem / (1024 * 1024)),
            freeMb: Math.round(freeMem / (1024 * 1024)),
            usedMb: Math.round((totalMem - freeMem) / (1024 * 1024)),
            usedPercentage: Math.round(((totalMem - freeMem) / totalMem) * 100),
          },
          process: {
            pid: process.pid,
            uptimeSeconds: Math.floor(process.uptime()),
            nodeVersion: process.version,
          },
        };

        auditCall('server_info', undefined, start, 'SUCCESS', args);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('server_info', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to get server info: ${err.message}`);
      }
    }
  );

  // 2. server_exec
  server.tool(
    'server_exec',
    'Administrative fallback execution of bounded shell commands. Strictly logged and audited. Protects against secret leakage. (Admin Privileged)',
    {
      command: z.string().describe('Binary or command to execute (e.g. "node", "npm", "ls")'),
      args: z.array(z.string()).optional().default([]).describe('Arguments array'),
      cwd: z.string().optional().describe('Working directory (defaults to workspace root)'),
      timeoutSeconds: z.number().int().min(1).max(60).optional().default(30).describe('Timeout in seconds'),
    },
    async (toolArgs) => {
      const start = Date.now();
      if (!hasScope(principal, 'admin')) {
        auditCall('server_exec', toolArgs.command, start, 'DENIED', toolArgs, undefined, 'Requires admin role');
        return errorResponse('Access denied: server_exec requires admin role and scope', 'UNAUTHORIZED');
      }

      try {
        const execCwd = toolArgs.cwd || workspaceRoot;
        const res = await boundedExec(toolArgs.command, toolArgs.args || [], execCwd, (toolArgs.timeoutSeconds || 30) * 1000);

        const data = {
          command: toolArgs.command,
          args: toolArgs.args,
          status: res.status,
          exitCode: res.exitCode,
          durationMs: res.durationMs,
          stdout: res.stdout,
          stderr: res.stderr,
        };

        auditCall('server_exec', toolArgs.command, start, res.exitCode === 0 ? 'SUCCESS' : 'FAILED', toolArgs, { exitCode: res.exitCode });
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('server_exec', toolArgs.command, start, 'FAILED', toolArgs, undefined, err.message);
        return errorResponse(`Command execution failed: ${err.message}`);
      }
    }
  );

  // 3. service_manage
  server.tool(
    'service_manage',
    'Manage approved StarliDigital systemd background services (starlidigital, starlidigital-control, nginx). (Admin Mutating)',
    {
      service: z.enum(['starlidigital.service', 'starlidigital-control.service', 'nginx.service']).describe('Service name'),
      action: z.enum(['status', 'start', 'stop', 'restart', 'enable', 'disable']).describe('systemctl action'),
    },
    async (toolArgs) => {
      const start = Date.now();
      const isWrite = toolArgs.action !== 'status';
      if (!hasScope(principal, isWrite ? 'admin' : 'read')) {
        auditCall('service_manage', toolArgs.service, start, 'DENIED', toolArgs, undefined, 'Insufficient scope');
        return errorResponse('Access denied: insufficient scope for service management', 'UNAUTHORIZED');
      }

      try {
        const res = await boundedExec('systemctl', [toolArgs.action, toolArgs.service], workspaceRoot, 15000);
        const data = {
          service: toolArgs.service,
          action: toolArgs.action,
          status: res.status,
          exitCode: res.exitCode,
          output: (res.stdout + '\n' + res.stderr).trim().slice(0, 8000),
        };

        auditCall('service_manage', toolArgs.service, start, res.exitCode === 0 ? 'SUCCESS' : 'FAILED', toolArgs, data);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('service_manage', toolArgs.service, start, 'FAILED', toolArgs, undefined, err.message);
        return errorResponse(`service_manage failed: ${err.message}`);
      }
    }
  );

  // 4. service_logs
  server.tool(
    'service_logs',
    'Read and search recent journalctl logs for approved StarliDigital services. Automatically redacts credentials. (Read-Only)',
    {
      service: z.enum(['starlidigital.service', 'starlidigital-control.service', 'nginx.service']).describe('Service name'),
      lines: z.number().int().min(5).max(300).optional().default(50).describe('Number of recent log lines to retrieve'),
      since: z.string().optional().describe('Time range (e.g. "1 hour ago", "10m ago")'),
      query: z.string().optional().describe('Keyword filter to search inside log entries'),
    },
    async (toolArgs) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('service_logs', toolArgs.service, start, 'DENIED', toolArgs, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const journalArgs = ['-u', toolArgs.service, '-n', String(toolArgs.lines || 50), '--no-pager'];
        if (toolArgs.since) {
          journalArgs.push('--since', toolArgs.since);
        }

        const res = await boundedExec('journalctl', journalArgs, workspaceRoot, 15000);
        let logLines = res.stdout.split('\n');

        if (toolArgs.query) {
          const q = toolArgs.query.toLowerCase();
          logLines = logLines.filter((l) => l.toLowerCase().includes(q));
        }

        const result = {
          service: toolArgs.service,
          linesReturned: logLines.length,
          logs: logLines.slice(-150).join('\n'),
        };

        auditCall('service_logs', toolArgs.service, start, 'SUCCESS', toolArgs);
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('service_logs', toolArgs.service, start, 'FAILED', toolArgs, undefined, err.message);
        return errorResponse(`Failed to read service logs: ${err.message}`);
      }
    }
  );
}
