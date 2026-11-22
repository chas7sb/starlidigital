import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createControlPlaneServer } from '../src/server.js';
import { FixtureTokenVerifier } from '../src/auth.js';
import { SqliteAuditSink } from '../src/audit.js';
import type { UpstreamHealthProbe, ControlPlaneConfig } from '../src/types.js';

describe('Control Plane - Batch 1 Authenticated MCP & ops_health', () => {
  let mockBackendServer: http.Server;
  let controlServer: http.Server;
  let mockBackendPort: number;
  let controlPort: number;
  let auditSink: SqliteAuditSink;
  let tokenVerifier: FixtureTokenVerifier;
  let mockHealthResponse = { status: 'ok', ready: true, database: 'ok' };
  let mockHealthStatusCode = 200;

  before(async () => {
    // 1. Mock upstream Starli backend
    mockBackendServer = http.createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(mockHealthStatusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockHealthResponse));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockBackendServer.listen(0, '127.0.0.1', () => {
        const addr = mockBackendServer.address() as any;
        mockBackendPort = addr.port;
        resolve();
      });
    });

    tokenVerifier = new FixtureTokenVerifier();
    tokenVerifier.registerToken('valid-admin-token', {
      id: 'admin-1',
      role: 'admin',
      scopes: ['read', 'write'],
      email: 'admin@starlidigital.ro',
    });

    tokenVerifier.registerToken('read-only-admin-token', {
      id: 'admin-ro',
      role: 'admin',
      scopes: ['read'],
      email: 'ro@starlidigital.ro',
    });

    tokenVerifier.registerToken('customer-token', {
      id: 'cust-1',
      role: 'customer',
      scopes: ['read'],
      email: 'cust@example.com',
    });

    tokenVerifier.registerToken('no-read-scope-token', {
      id: 'admin-no-scope',
      role: 'admin',
      scopes: ['other'],
      email: 'noscope@starlidigital.ro',
    });

    auditSink = new SqliteAuditSink(':memory:');

    const healthProbe: UpstreamHealthProbe = {
      async probe() {
        return {
          ready: mockHealthResponse.ready,
          service: 'starlidigital-backend',
          dependencies: { api: mockHealthResponse.ready ? 'UP' : 'DOWN' },
          details: mockHealthResponse.ready ? 'Healthy' : 'Degraded',
        };
      },
    };

    const config: ControlPlaneConfig = {
      port: 0,
      host: '127.0.0.1',
      upstreamHealthUrl: `http://127.0.0.1:${mockBackendPort}/healthz`,
      controlDbPath: ':memory:',
      allowedOrigins: ['http://127.0.0.1', 'http://localhost'],
      oauthIssuer: 'https://auth.starlidigital.ro',
      publicResourceUrl: 'https://api.starlidigital.ro/mcp',
      oauthAudience: 'starli-mcp',
    };

    controlServer = createControlPlaneServer({
      config,
      tokenVerifier,
      auditSink,
      healthProbe,
    });

    await new Promise<void>((resolve) => {
      controlServer.listen(0, '127.0.0.1', () => {
        const addr = controlServer.address() as any;
        controlPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    mockBackendServer.close();
    controlServer.close();
    auditSink.close();
  });

  it('rejects unauthenticated requests to /mcp with 401 and Bearer challenge', async () => {
    const res = await fetch(`http://127.0.0.1:${controlPort}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });

    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') || '', /Bearer/);
    assert.match(res.headers.get('www-authenticate') || '', /resource_metadata="https:\/\/api\.starlidigital\.ro\/\.well-known\/oauth-protected-resource"/);
  });

  it('rejects tokens not accepted by the verifier with 401', async () => {
    const res = await fetch(`http://127.0.0.1:${controlPort}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer customer-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });

    assert.equal(res.status, 401);
    const body = await res.json() as any;
    assert.match(body.message, /Non-admin principal denied/);
  });

  it('rejects expired / revoked / wrong-audience tokens', async () => {
    for (const token of ['expired-token', 'revoked-token', 'wrong-aud-token']) {
      const res = await fetch(`http://127.0.0.1:${controlPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      });
      assert.equal(res.status, 401);
    }
  });

  it('denies requests from unauthorized origins', async () => {
    const res = await fetch(`http://127.0.0.1:${controlPort}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer valid-admin-token',
        'Origin': 'https://malicious-site.example.com',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });

    assert.equal(res.status, 403);
  });

  it('allows public healthz probe without revealing secrets or database', async () => {
    const res = await fetch(`http://127.0.0.1:${controlPort}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'starlidigital-control-plane');
    assert.equal(body.env, undefined);
    assert.equal(body.database, undefined);
  });

  it('exposes RFC-compatible OAuth protected resource discovery', async () => {
    const res = await fetch(`http://127.0.0.1:${controlPort}/.well-known/oauth-protected-resource`);
    assert.equal(res.status, 200);
    const meta = await res.json() as any;
    assert.equal(meta.resource, 'https://api.starlidigital.ro/mcp');
    assert.deepEqual(meta.scopes_supported, ['read', 'write', 'admin']);
    assert.deepEqual(meta.authorization_servers, ['https://auth.starlidigital.ro']);
  });

  it('connects via official MCP SDK client, lists tools and calls ops_health', async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${controlPort}/mcp`),
      {
        requestInit: {
          headers: {
            'Authorization': 'Bearer valid-admin-token',
          },
        },
      }
    );

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);

    // List tools
    const tools = await client.listTools();
    assert.ok(Array.isArray(tools.tools));
    const opsHealth = tools.tools.find(t => t.name === 'ops_health');
    assert.ok(opsHealth, 'ops_health must be registered');

    // Call ops_health
    const result = await client.callTool({
      name: 'ops_health',
      arguments: {},
    });

    assert.equal(result.isError, undefined);
    assert.ok(Array.isArray(result.content));
    assert.equal((result.content[0] as any).type, 'text');
    const parsed = JSON.parse((result.content[0] as any).text);
    assert.equal(parsed.status, 'HEALTHY');
    assert.equal(parsed.service, 'starlidigital-backend');
    assert.equal(parsed.dependencies.api, 'UP');

    // Verify audit record was written to SQLite
    const auditLogs = auditSink.list(10);
    const healthAudit = auditLogs.find(l => l.tool === 'ops_health');
    assert.ok(healthAudit, 'Audit record for ops_health must exist');
    assert.equal(healthAudit.status, 'SUCCESS');
    assert.equal(healthAudit.principalId, 'admin-1');

    await client.close();
  });
});
