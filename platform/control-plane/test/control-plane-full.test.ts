import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createControlPlaneServer } from '../src/server.js';
import { FixtureTokenVerifier } from '../src/auth.js';
import { SqliteAuditSink } from '../src/audit.js';
import { Store } from '../../server/src/store.js';
import { Events } from '../../server/src/events.js';
import { CrmServices } from '../../server/src/crm/services.js';
import { MailboxServices } from '../../server/src/mailbox/service.js';
import type { UpstreamHealthProbe, ControlPlaneConfig } from '../src/types.js';

function extractTextContent(result: unknown): string {
  assert.ok(result && typeof result === 'object', 'Result must be an object');
  assert.ok('content' in result, 'Result must contain content property');
  const content = (result as { content: unknown }).content;
  assert.ok(Array.isArray(content), 'Result content must be an array');
  const first = content[0];
  assert.ok(first && typeof first === 'object' && 'text' in first && typeof first.text === 'string', 'First item must have text property');
  return first.text;
}

describe('Control Plane - Full Complete Toolset Verification', () => {
  let controlServer: http.Server;
  let controlPort: number;
  let auditSink: SqliteAuditSink;
  let tokenVerifier: FixtureTokenVerifier;
  let store: Store;
  let events: Events;
  let crmServices: CrmServices;
  let mailboxServices: MailboxServices;

  before(async () => {
    store = new Store(':memory:');
    events = new Events();
    crmServices = new CrmServices(store, events);
    mailboxServices = new MailboxServices({ store, events });

    auditSink = new SqliteAuditSink(':memory:');
    tokenVerifier = new FixtureTokenVerifier();
    tokenVerifier.registerToken('admin-full-token', {
      id: 'admin-operator-full',
      role: 'admin',
      scopes: ['read', 'write', 'admin'],
      email: 'admin@starlidigital.ro',
    });

    const healthProbe: UpstreamHealthProbe = {
      async probe() {
        return {
          ready: true,
          service: 'starlidigital-backend',
          dependencies: { api: 'UP', db: 'UP' },
          details: 'Healthy',
        };
      },
    };

    const config: ControlPlaneConfig = {
      port: 0,
      host: '127.0.0.1',
      upstreamHealthUrl: 'http://127.0.0.1:4119/healthz',
      controlDbPath: ':memory:',
      allowedOrigins: ['http://127.0.0.1'],
      oauthIssuer: 'https://auth.starlidigital.ro',
      oauthAudience: 'starli-mcp',
    };

    controlServer = createControlPlaneServer({
      config,
      tokenVerifier,
      auditSink,
      healthProbe,
      crmServices,
      mailboxServices,
      store,
      events,
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
    controlServer.close();
    auditSink.close();
    store.close();
  });

  async function getClient() {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${controlPort}/mcp`),
      {
        requestInit: {
          headers: { 'Authorization': 'Bearer admin-full-token' },
        },
      }
    );
    const client = new Client({ name: 'test-admin-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    return client;
  }

  it('verifies platform discovery tools (platform_overview, platform_capabilities, platform_health)', async () => {
    const client = await getClient();

    const overviewRes = await client.callTool({ name: 'platform_overview', arguments: { includeMetrics: true } });
    const overview = JSON.parse(extractTextContent(overviewRes));
    assert.equal(overview.service, 'starlidigital-control-plane');
    assert.ok(overview.architecture);
    assert.ok(overview.metrics);

    const capRes = await client.callTool({ name: 'platform_capabilities', arguments: {} });
    const cap = JSON.parse(extractTextContent(capRes));
    assert.equal(cap.websiteGeneration, true);
    assert.equal(cap.caller.role, 'admin');

    const healthRes = await client.callTool({ name: 'platform_health', arguments: {} });
    const health = JSON.parse(extractTextContent(healthRes));
    assert.equal(health.status, 'HEALTHY');

    await client.close();
  });

  it('verifies api discovery (api_overview)', async () => {
    const client = await getClient();

    const apiRes = await client.callTool({ name: 'api_overview', arguments: { query: 'project' } });
    const api = JSON.parse(extractTextContent(apiRes));
    assert.ok(api.graphQLQueries.length > 0);
    assert.ok(api.graphQLMutations.length > 0);

    await client.close();
  });

  it('verifies project lifecycle (project_manage create -> get -> list)', async () => {
    const client = await getClient();

    // Create project
    const createRes = await client.callTool({
      name: 'project_manage',
      arguments: { action: 'create', name: 'Test Studio Boutique', brief: 'Architectural studio website' },
    });
    const created = JSON.parse(extractTextContent(createRes));
    assert.equal(created.status, 'CREATED');
    const projectId = created.project.id;
    assert.ok(projectId);

    // Get project
    const getRes = await client.callTool({
      name: 'project_get',
      arguments: { projectId },
    });
    const proj = JSON.parse(extractTextContent(getRes));
    assert.equal(proj.id, projectId);
    assert.equal(proj.name, 'Test Studio Boutique');

    // List projects
    const listRes = await client.callTool({
      name: 'projects_list',
      arguments: { search: 'Boutique' },
    });
    const list = JSON.parse(extractTextContent(listRes));
    assert.equal(list.total, 1);
    assert.equal(list.projects[0].id, projectId);

    await client.close();
  });

  it('verifies file inspection and code search (file_read, code_search)', async () => {
    const client = await getClient();

    const fileRes = await client.callTool({
      name: 'file_read',
      arguments: { path: 'package.json', startLine: 1, endLine: 5 },
    });
    const file = JSON.parse(extractTextContent(fileRes));
    assert.equal(file.path, 'package.json');
    assert.ok(file.content.includes('starlidigital'));

    const searchRes = await client.callTool({
      name: 'code_search',
      arguments: { query: 'starlidigital', maxResults: 5 },
    });
    const search = JSON.parse(extractTextContent(searchRes));
    assert.ok(search.matches.length > 0);

    await client.close();
  });

  it('verifies git status inspection (git_status)', async () => {
    const client = await getClient();

    const gitRes = await client.callTool({ name: 'git_status', arguments: {} });
    const git = JSON.parse(extractTextContent(gitRes));
    assert.ok(typeof git.branch === 'string');
    assert.ok(Array.isArray(git.modified));

    await client.close();
  });

  it('verifies database tools (database_overview, database_query)', async () => {
    const client = await getClient();

    const dbRes = await client.callTool({ name: 'database_overview', arguments: {} });
    const db = JSON.parse(extractTextContent(dbRes));
    assert.ok(db.engine.includes('sqlite'));
    assert.ok(Array.isArray(db.tables));

    const queryRes = await client.callTool({
      name: 'database_query',
      arguments: { collection: 'projects' },
    });
    const q = JSON.parse(extractTextContent(queryRes));
    assert.ok(q.records.length > 0);

    await client.close();
  });

  it('verifies configuration and secret status (config_overview, secret_manage)', async () => {
    const client = await getClient();

    const cfgRes = await client.callTool({ name: 'config_overview', arguments: {} });
    const cfg = JSON.parse(extractTextContent(cfgRes));
    assert.ok(cfg.variables);

    const secretRes = await client.callTool({
      name: 'secret_manage',
      arguments: { action: 'status', key: 'NON_EXISTENT_KEY_XYZ' },
    });
    const sec = JSON.parse(extractTextContent(secretRes));
    assert.equal(sec.configured, false);

    await client.close();
  });

  it('verifies server info (server_info)', async () => {
    const client = await getClient();

    const srvRes = await client.callTool({ name: 'server_info', arguments: {} });
    const srv = JSON.parse(extractTextContent(srvRes));
    assert.ok(srv.cpuCores > 0);
    assert.ok(srv.memory.totalMb > 0);

    await client.close();
  });

  it('verifies audit logs trail (audit_recent_actions)', async () => {
    const client = await getClient();

    const auditRes = await client.callTool({ name: 'audit_recent_actions', arguments: { limit: 10 } });
    const audit = JSON.parse(extractTextContent(auditRes));
    assert.ok(audit.auditEntries.length > 0);
    assert.ok(audit.auditEntries.some((e: any) => e.principalId === 'admin-operator-full'));

    await client.close();
  });
});
