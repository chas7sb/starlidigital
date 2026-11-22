import http from 'node:http';
import type {HostedAgentService} from '../../server/src/hosted-agents/service.js';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { TokenVerifier, AuditSink, UpstreamHealthProbe, ControlPlaneConfig, AuthPrincipal } from './types.js';
import { redactSecrets } from './sanitize.js';
import { registerScopedDomainTools } from './domain-tools.js';
import type { CrmServices } from '../../server/src/crm/services.js';
import type { MailboxServices } from '../../server/src/mailbox/service.js';
import type { AssetServices } from '../../server/src/assets/service.js';
import type { VideoServices } from '../../server/src/video/service.js';
import type { Store } from '../../server/src/store.js';
import type { Events } from '../../server/src/events.js';
import {handleBrowserRequest} from './browser-bridge.js';
import {createReadOnlyMissionControlDashboard} from './lcg9-dashboard-host.js';

export interface CreateControlPlaneServerOptions {
  config: ControlPlaneConfig;
  tokenVerifier: TokenVerifier;
  auditSink: AuditSink;
  healthProbe: UpstreamHealthProbe;
  crmServices?: CrmServices;
  mailboxServices?: MailboxServices;
  assetServices?: AssetServices;
  videoServices?: VideoServices;
  store?: Store;
  events?: Events;
  workspaceRoot?: string;
  hostedAgentService?:HostedAgentService;
}

export function createControlPlaneServer(options: CreateControlPlaneServerOptions) {
  const { config, tokenVerifier, auditSink, healthProbe, crmServices, mailboxServices, assetServices, videoServices, store, events, workspaceRoot,hostedAgentService } = options;
  const resourceUrl = new URL(config.publicResourceUrl || `http://${config.host}:${config.port}/mcp`);
  if (process.env.NODE_ENV === 'production' && (!config.publicResourceUrl || resourceUrl.protocol !== 'https:')) {
    throw new Error('Production MCP requires CONTROL_PLANE_PUBLIC_RESOURCE_URL with an HTTPS URL');
  }
  const metadataUrl = new URL('/.well-known/oauth-protected-resource', resourceUrl).href;

  function createMcpInstance(principal: AuthPrincipal) {
    const server = new McpServer({
      name: 'starlidigital-control-plane',
      version: '0.1.0',
    });

    // 1. ops_health tool (Batch 1 baseline)
    server.tool(
      'ops_health',
      'Check Starli backend and dependency health state (read-only, no sensitive env or DB exposed)',
      {},
      async () => {
        const start = Date.now();
        const callId = randomUUID();

        // Enforce admin role and read scope
        if (principal.role !== 'admin' || (!principal.scopes.includes('read') && !principal.scopes.includes('*'))) {
          const deniedEntry = {
            id: callId,
            timestamp: new Date().toISOString(),
            principalId: principal.id,
            tool: 'ops_health',
            durationMs: Date.now() - start,
            status: 'DENIED' as const,
            error: 'Insufficient scope or not admin',
          };
          auditSink.record(deniedEntry);
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Access denied: insufficient scope or non-admin role' }],
          };
        }

        try {
          const probeResult = await healthProbe.probe();
          const duration = Date.now() - start;

          auditSink.record({
            id: callId,
            timestamp: new Date().toISOString(),
            principalId: principal.id,
            tool: 'ops_health',
            durationMs: duration,
            status: probeResult.ready ? 'SUCCESS' : 'FAILED',
            sanitizedResult: redactSecrets(probeResult) as Record<string, unknown>,
          });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: probeResult.ready ? 'HEALTHY' : 'UNHEALTHY',
                  service: probeResult.service,
                  dependencies: probeResult.dependencies,
                  details: probeResult.details,
                }, null, 2),
              },
            ],
          };
        } catch (err: any) {
          const duration = Date.now() - start;
          const sanitizedError = redactSecrets(err?.message || 'Health probe failed');
          auditSink.record({
            id: callId,
            timestamp: new Date().toISOString(),
            principalId: principal.id,
            tool: 'ops_health',
            durationMs: duration,
            status: 'FAILED',
            error: String(sanitizedError),
          });

          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Health check error: ${sanitizedError}` }],
          };
        }
      }
    );

    // Register scoped domain tools (CRM, Mailbox, and complete platform control plane)
    registerScopedDomainTools({
      server,
      principal,
      auditSink,
      crmServices,
      mailboxServices,
      assetServices,
      videoServices,
      store,
      events,
      workspaceRoot,
      healthProbe,
      config,
      hostedAgentService,
    });

    return server;
  }

  // An authorized, read-only dashboard uses this same durable Store.db.
  const missionDashboard = store ? createReadOnlyMissionControlDashboard(store) : undefined;

  // HTTP Request Handler
  const httpServer = http.createServer(async (req, res) => {
    // 1. Host / DNS Rebinding Protection
    const hostHeader = req.headers.host || '';
    const originHeader = req.headers.origin;

    // Legacy device HTTP uses its separately enrolled bearer token. This
    // bridge is the SAME command Store used by Mission Control's WSS outbox.
    const legacyBridgeRoute=(req.url||'').startsWith('/browser-bridge/v1/');
    const validExtensionOrigin=legacyBridgeRoute && typeof originHeader==='string' &&
      /^chrome-extension:\/\/[a-p]{32}$/.test(originHeader);

    // Check origin if present
    if (originHeader) {
      const allowed = legacyBridgeRoute ? (validExtensionOrigin && config.allowedOrigins.includes(originHeader)) : config.allowedOrigins.some(o => o === '*' || o === originHeader);
      if (!allowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Origin not allowed' }));
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', originHeader);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${hostHeader || '127.0.0.1'}`);

    if (legacyBridgeRoute) {
      if(!store){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'bridge unavailable'}));return;}
      try{await handleBrowserRequest(store,req,res,url);}
      catch{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'bridge unavailable'}));}else res.destroy();}
      return;
    }

    if(url.pathname === '/mission-control' || url.pathname.startsWith('/mission-control/')){
      if(!missionDashboard){res.writeHead(503,{ 'Cache-Control':'no-store'});res.end();return;}
      await missionDashboard(req,res);return;
    }

    // Public liveness check - does not reveal internal details
    if (url.pathname === '/healthz' || url.pathname === '/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'starlidigital-control-plane' }));
      return;
    }

    // Protected OAuth Discovery endpoint
    if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      if (!config.oauthIssuer) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'oauth_not_configured', message: 'An authorization server must be configured before connecting ChatGPT.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        resource: resourceUrl.href,
        authorization_servers: config.oauthIssuer ? [config.oauthIssuer] : [],
        scopes_supported: ['read', 'write', 'admin'],
        bearer_methods_supported: ['header'],
      }));
      return;
    }

    // MCP Streamable HTTP endpoint
    if (url.pathname === '/mcp') {
      // Authenticate via Authorization: Bearer <token>
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"`,
        });
        res.end(JSON.stringify({
          error: 'Unauthorized',
          message: 'Authorization header with Bearer token is required',
        }));
        return;
      }

      const token = authHeader.slice(7).trim();
      const verification = await tokenVerifier.verify(token);

      if (!verification.valid || !verification.principal) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`,
        });
        res.end(JSON.stringify({
          error: 'Forbidden',
          message: verification.error || 'Token verification failed',
        }));
        return;
      }

      const principal = verification.principal;

      // Spin up isolated MCP server instance for this authenticated request / transport
      const mcpServer = createMcpInstance(principal);
      const transport = new StreamableHTTPServerTransport();

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return httpServer;
}
