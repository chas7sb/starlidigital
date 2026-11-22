import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { boundedExec, hasScope } from './security.js';
import { validateNextProjectFiles } from '../../../server/src/next-template.js';
import { deployNextSite, vercelConfigured } from '../../../server/src/integrations/vercel.js';

function validateFiles(files: unknown): { valid: boolean; error?: string } {
  try {
    validateNextProjectFiles(files);
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

export function registerDeployTools(ctx: ToolContext) {
  const { server, principal, store, events, workspaceRoot, auditCall } = ctx;

  // 1. project_build
  server.tool(
    'project_build',
    'Build and validate a StarliDigital Next.js project using the production Next.js AST validation pipeline. (Write/Validation)',
    {
      projectId: z.string().describe('The project ID to validate and build'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'write')) {
        auditCall('project_build', args.projectId, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        const project = store.get('projects', args.projectId);
        if (!project) return errorResponse(`Project ${args.projectId} not found`, 'NOT_FOUND');

        if (!project.files || project.files.length === 0) {
          return errorResponse('Project has no generated source files to build', 'NO_SOURCE');
        }

        const check = validateFiles(project.files);
        const durationMs = Date.now() - start;

        project.status = check.valid ? 'SOURCE_READY' : 'BUILD_FAILED';
        project.updatedAt = new Date().toISOString();
        store.put('projects', project);
        events?.publish('projects');

        const result = {
          projectId: project.id,
          name: project.name,
          valid: check.valid,
          errors: check.error ? [check.error] : [],
          warnings: [] as string[],
          filesCount: project.files.length,
          status: project.status,
          durationMs,
        };

        auditCall('project_build', args.projectId, start, check.valid ? 'SUCCESS' : 'FAILED', args, result);
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('project_build', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Project build failed: ${err.message}`);
      }
    }
  );

  // 2. project_test
  server.tool(
    'project_test',
    'Run automated test suites for backend, control plane, or web workspace. (Read-Only/Test)',
    {
      suite: z.enum(['control-plane', 'server', 'all']).optional().default('control-plane').describe('Test suite to execute'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('project_test', args.suite, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        let testArgs: string[] = [];
        if (args.suite === 'control-plane') {
          testArgs = ['tsx', '--test', 'control-plane/test/batch-01.test.ts', 'control-plane/test/domain-tools.test.ts'];
        } else if (args.suite === 'server') {
          testArgs = ['tsx', '--test', 'server/test/crm-services.test.ts'];
        } else {
          testArgs = ['tsx', '--test', 'control-plane/test/*.test.ts'];
        }

        const res = await boundedExec('npx', testArgs, workspaceRoot, 60000);
        const data = {
          suite: args.suite,
          status: res.status,
          exitCode: res.exitCode,
          durationMs: res.durationMs,
          output: (res.stdout + '\n' + res.stderr).slice(0, 16000),
        };

        auditCall('project_test', args.suite, start, res.exitCode === 0 ? 'SUCCESS' : 'FAILED', args, data);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('project_test', args.suite, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Test execution failed: ${err.message}`);
      }
    }
  );

  // 3. project_deploy
  server.tool(
    'project_deploy',
    'Deploy a verified StarliDigital Next.js website project to live Vercel edge infrastructure. (Mutating/Deploy)',
    {
      projectId: z.string().describe('The project ID to deploy'),
      environment: z.enum(['production', 'preview']).optional().default('production').describe('Target deployment environment'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'write')) {
        auditCall('project_deploy', args.projectId, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Database store is not initialized');

      try {
        const project = store.get('projects', args.projectId);
        if (!project) return errorResponse(`Project ${args.projectId} not found`, 'NOT_FOUND');

        if (!project.files || project.files.length === 0) {
          return errorResponse('Cannot deploy project without generated source files', 'NO_FILES');
        }

        const check = validateFiles(project.files);
        if (!check.valid) {
          return errorResponse(`Cannot deploy invalid project: ${check.error}`, 'INVALID_SOURCE');
        }

        if (!vercelConfigured()) {
          project.status = 'SOURCE_READY';
          project.publishState = 'never_deployed';
          store.put('projects', project);
          return jsonResponse({
            status: 'READY_TO_DEPLOY',
            projectId: project.id,
            note: 'Vercel API token not set in environment. Source files are validated and packaged for deployment.',
          });
        }

        project.status = 'DEPLOYING';
        project.publishState = 'deploying';
        store.put('projects', project);
        events?.publish('projects');

        const deploymentName = project.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50) || 'project';

        const deployment = await deployNextSite({
          name: deploymentName,
          files: project.files,
          projectId: project.id,
        });

        project.status = deployment.status === 'READY' ? 'LIVE' : 'DEPLOYING';
        project.publishState = deployment.status === 'READY' ? 'live' : 'deploying';
        project.deploymentId = deployment.id;
        project.deploymentUrl = deployment.url;
        project.updatedAt = new Date().toISOString();

        store.put('projects', project);
        events?.publish('projects');

        const result = {
          projectId: project.id,
          status: project.status,
          deploymentId: deployment.id,
          url: deployment.url,
          liveUrl: `https://${deployment.url}`,
        };

        auditCall('project_deploy', args.projectId, start, 'SUCCESS', args, result);
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('project_deploy', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Deployment failed: ${err.message}`);
      }
    }
  );

  // 4. project_verify_live
  server.tool(
    'project_verify_live',
    'Verify that a deployed website URL is live, reachable, and returns valid HTML content with 200 OK. (Read-Only)',
    {
      url: z.string().url().describe('The website URL to verify (e.g. https://starlidigital.ro or custom domain)'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('project_verify_live', args.url, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        const res = await fetch(args.url, {
          method: 'GET',
          headers: { 'User-Agent': 'StarliVerifier/1.0' },
          signal: AbortSignal.timeout(15000),
        });

        const text = await res.text();
        const durationMs = Date.now() - start;

        const titleMatch = text.match(/<title\b[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : null;

        const data = {
          url: args.url,
          statusCode: res.status,
          statusText: res.statusText,
          isLive: res.ok,
          title,
          contentLengthBytes: text.length,
          latencyMs: durationMs,
          headers: {
            contentType: res.headers.get('content-type'),
            server: res.headers.get('server'),
            strictTransportSecurity: res.headers.get('strict-transport-security'),
          },
        };

        auditCall('project_verify_live', args.url, start, res.ok ? 'SUCCESS' : 'FAILED', args, data);
        return jsonResponse(data);
      } catch (err: any) {
        auditCall('project_verify_live', args.url, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Live verification failed: ${err.message}`);
      }
    }
  );
}
