import http from 'node:http';
import {HostedAgentService} from '../../server/src/hosted-agents/service.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createControlPlaneServer } from './server.js';
import { SqliteAuditSink } from './audit.js';
import { OAuthJwtVerifier, StarliNativeTokenVerifier, FixtureTokenVerifier } from './auth.js';
import { HttpUpstreamHealthProbe } from './health.js';
import { Store } from '../../server/src/store.js';
import { Events } from '../../server/src/events.js';
import { createCrmServices } from '../../server/src/crm/services.js';
import { createAgencyMailbox as createMailboxServices } from '../../server/src/mailbox/agency-mailbox.js';
import { AssetServices } from '../../server/src/assets/service.js';
import type { ControlPlaneConfig, TokenVerifier } from './types.js';

// Load environment configuration if available
loadDotenv({
  path: [
    fileURLToPath(new URL('../../.env', import.meta.url)),
    fileURLToPath(new URL('../.env', import.meta.url)),
  ],
  quiet: true,
});

function parseConfig(): ControlPlaneConfig {
  const port = parseInt(process.env.CONTROL_PLANE_PORT || '4120', 10);
  const host = process.env.CONTROL_PLANE_HOST || '127.0.0.1';
  const upstreamHealthUrl = process.env.CONTROL_PLANE_UPSTREAM_URL || process.env.UPSTREAM_HEALTH_URL || 'http://127.0.0.1:4119/healthz';
  const controlDbPath = process.env.CONTROL_PLANE_DB_PATH || process.env.CONTROL_DB_PATH || resolve(process.cwd(), 'control-plane.sqlite');
  
  const rawOrigins = process.env.CONTROL_PLANE_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,https://chatgpt.com';
  const allowedOrigins = rawOrigins.split(',').map(s => s.trim()).filter(Boolean);

  const oauthIssuer = process.env.CONTROL_PLANE_OAUTH_ISSUER || process.env.OAUTH_ISSUER || 'https://api.starlidigital.ro';
  const oauthAudience = process.env.CONTROL_PLANE_OAUTH_AUDIENCE || process.env.OAUTH_AUDIENCE || 'starli-mcp';
  const publicResourceUrl = process.env.CONTROL_PLANE_PUBLIC_RESOURCE_URL || process.env.PUBLIC_RESOURCE_URL || (process.env.NODE_ENV === 'production' ? 'https://api.starlidigital.ro/mcp' : undefined);

  return {
    port,
    host,
    upstreamHealthUrl,
    controlDbPath,
    allowedOrigins,
    oauthIssuer,
    oauthAudience,
    publicResourceUrl,
  };
}

export function startControlPlane(configOverride?: Partial<ControlPlaneConfig>): {
  server: http.Server;
  auditSink: SqliteAuditSink;
  close: () => Promise<void>;
} {
  const config: ControlPlaneConfig = { ...parseConfig(), ...configOverride };

  const auditSink = new SqliteAuditSink(config.controlDbPath);
  const healthProbe = new HttpUpstreamHealthProbe(config.upstreamHealthUrl);

  const sharedDbPath = process.env.DATABASE_PATH ||
    (process.env.NODE_ENV === 'production' ? '/var/lib/starlidigital/starli.sqlite' : undefined);
  const sharedStore = new Store(sharedDbPath);
  const sharedEvents = new Events();
  const crmServices = createCrmServices({ store: sharedStore, events: sharedEvents });
  const mailboxServices = createMailboxServices({ store: sharedStore, events: sharedEvents });
  const assetServices = new AssetServices({ store: sharedStore, events: sharedEvents });

  let tokenVerifier: TokenVerifier;
  if (config.oauthIssuer === 'https://api.starlidigital.ro') {
    // Native Starli account OAuth verifier
    tokenVerifier = new StarliNativeTokenVerifier(sharedStore);
  } else if (config.oauthIssuer) {
    tokenVerifier = new OAuthJwtVerifier({
      issuer: config.oauthIssuer,
      audience: config.oauthAudience || 'starli-mcp',
      jwksUri: process.env.CONTROL_PLANE_JWKS_URI || `${config.oauthIssuer.replace(/\/+$/, '')}/.well-known/jwks.json`,
    });
  } else {
    // Fallback in non-OAuth configured local development mode
    const fixtureVerifier = new FixtureTokenVerifier();
    const devToken = process.env.CONTROL_PLANE_DEV_TOKEN;
    if (devToken && process.env.NODE_ENV !== 'production') {
      fixtureVerifier.registerToken(devToken, {
        id: 'local-dev-admin',
        role: 'admin',
        scopes: ['read', 'write', 'admin'],
        email: 'admin@starlidigital.ro',
      });
    }
    tokenVerifier = fixtureVerifier;
  }

  const server = createControlPlaneServer({
    config,
    tokenVerifier,
    auditSink,
    healthProbe,
    crmServices,
    mailboxServices,
    assetServices,
    store: sharedStore,
    events: sharedEvents,
    hostedAgentService:new HostedAgentService({store:sharedStore,events:sharedEvents}),
    workspaceRoot: process.env.STARLI_WORKSPACE_ROOT
      ? resolve(process.env.STARLI_WORKSPACE_ROOT)
      : (resolve(process.cwd()).endsWith('control-plane') || resolve(process.cwd()).endsWith('control-plane/') || resolve(process.cwd()).endsWith('control-plane\\')
          ? resolve(process.cwd(), '..')
          : resolve(process.cwd())),
  });

  const close = async () => {
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
    auditSink.close();
    sharedStore.close();
  };

  return { server, auditSink, close };
}

// If executed directly as process entrypoint
const isMain = process.argv[1] && (
  fileURLToPath(import.meta.url) === resolve(process.argv[1]) ||
  process.argv[1].endsWith('control-plane/src/index.ts') ||
  process.argv[1].endsWith('control-plane\\src\\index.ts')
);

if (isMain) {
  const config = parseConfig();
  const { server, auditSink, close } = startControlPlane(config);

  server.listen(config.port, config.host, () => {
    console.log(`[control-plane] Listening on http://${config.host}:${config.port}`);
    console.log(`[control-plane] Audit DB: ${config.controlDbPath}`);
    console.log(`[control-plane] Upstream health probe: ${config.upstreamHealthUrl}`);
    console.log(`[control-plane] OAuth Issuer: ${config.oauthIssuer}`);
  });

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[control-plane] Received ${signal}, starting graceful shutdown...`);
    try {
      await close();
      console.log('[control-plane] Shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('[control-plane] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
