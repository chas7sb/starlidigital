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

describe('Control Plane - Scoped Domain Tools (CRM & Mailbox)', () => {
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
      id: 'admin-operator-1',
      role: 'admin',
      scopes: ['read', 'write'],
      email: 'operator@starlidigital.ro',
    });
    tokenVerifier.registerToken('admin-ro-token', {
      id: 'admin-readonly',
      role: 'admin',
      scopes: ['read'],
      email: 'ro@starlidigital.ro',
    });

    const healthProbe: UpstreamHealthProbe = {
      async probe() {
        return {
          ready: true,
          service: 'starlidigital-backend',
          dependencies: { api: 'UP' },
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

  it('lists all 8 required baseline tools plus complete control plane toolset', async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${controlPort}/mcp`),
      {
        requestInit: {
          headers: { 'Authorization': 'Bearer admin-full-token' },
        },
      }
    );
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);

    const requiredBaseline = [
      'crm_add_activity',
      'crm_get_prospect',
      'crm_list_opportunities',
      'crm_search_prospects',
      'crm_upsert_prospect',
      'ops_health',
      'outreach_create_draft',
      'outreach_get_thread',
    ];

    for (const req of requiredBaseline) {
      assert.ok(names.includes(req), `Expected baseline tool ${req} to be registered`);
    }

    // Verify key control plane tools across categories
    assert.ok(names.includes('platform_overview'), 'platform_overview must be registered');
    assert.ok(names.includes('platform_health'), 'platform_health must be registered');
    assert.ok(names.includes('api_overview'), 'api_overview must be registered');
    assert.ok(names.includes('projects_list'), 'projects_list must be registered');
    assert.ok(names.includes('project_manage'), 'project_manage must be registered');
    assert.ok(names.includes('website_generate'), 'website_generate must be registered');
    assert.ok(names.includes('file_read'), 'file_read must be registered');
    assert.ok(names.includes('file_patch'), 'file_patch must be registered');
    assert.ok(names.includes('git_status'), 'git_status must be registered');
    assert.ok(names.includes('project_build'), 'project_build must be registered');
    assert.ok(names.includes('project_deploy'), 'project_deploy must be registered');
    assert.ok(names.includes('server_info'), 'server_info must be registered');
    assert.ok(names.includes('database_overview'), 'database_overview must be registered');
    assert.ok(names.includes('outreach_send_email'), 'outreach_send_email must be registered');

    await client.close();
  });

  it('executes crm_upsert_prospect and reads it back via crm_get_prospect & crm_search_prospects', async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${controlPort}/mcp`),
      {
        requestInit: {
          headers: { 'Authorization': 'Bearer admin-full-token' },
        },
      }
    );
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    // 1. Upsert prospect
    const createRes = await client.callTool({
      name: 'crm_upsert_prospect',
      arguments: {
        name: 'Alpha Dental SRL',
        domain: 'alphadental.ro',
        qualificationStatus: 'QUALIFIED',
        tags: ['medical', 'bucharest'],
      },
    });
    assert.equal(createRes.isError, undefined);
    const created = JSON.parse(extractTextContent(createRes));
    assert.ok(created.id);
    assert.equal(created.name, 'Alpha Dental SRL');
    assert.equal(created.version, 1);

    // 2. Search prospects
    const searchRes = await client.callTool({
      name: 'crm_search_prospects',
      arguments: { search: 'alphadental' },
    });
    const searchList = JSON.parse(extractTextContent(searchRes));
    assert.equal(searchList.length, 1);
    assert.equal(searchList[0].id, created.id);

    // 3. Get prospect detail
    const getRes = await client.callTool({
      name: 'crm_get_prospect',
      arguments: { id: created.id },
    });
    const detail = JSON.parse(extractTextContent(getRes));
    assert.equal(detail.company.id, created.id);

    // 4. Add activity to timeline
    const actRes = await client.callTool({
      name: 'crm_add_activity',
      arguments: {
        companyId: created.id,
        kind: 'NOTE',
        summary: 'Met at Dental Expo 2026; requested custom proposal',
        sourceEventId: 'expo-note-01',
      },
    });
    const activity = JSON.parse(extractTextContent(actRes));
    assert.equal(activity.summary, 'Met at Dental Expo 2026; requested custom proposal');

    await client.close();
  });

  it('blocks write tools when principal has only read scope', async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${controlPort}/mcp`),
      {
        requestInit: {
          headers: { 'Authorization': 'Bearer admin-ro-token' },
        },
      }
    );
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    const res = await client.callTool({
      name: 'crm_upsert_prospect',
      arguments: { name: 'Blocked Prospect' },
    });
    assert.equal(res.isError, true);
    assert.match(extractTextContent(res), /Access denied: requires admin write scope/);

    await client.close();
  });

  it('creates outreach draft with outreach_create_draft and confirms human approval requirement', async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${controlPort}/mcp`),
      {
        requestInit: {
          headers: { 'Authorization': 'Bearer admin-full-token' },
        },
      }
    );
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    const draftRes = await client.callTool({
      name: 'outreach_create_draft',
      arguments: {
        to: ['contact@alphadental.ro'],
        subject: 'Modern digital storefront for Alpha Dental',
        bodyText: 'Hello team, here is the proposal preview for your dental practice.',
      },
    });

    assert.equal(draftRes.isError, undefined);
    const draftData = JSON.parse(extractTextContent(draftRes));
    assert.equal(draftData.status, 'DRAFT_CREATED');
    assert.ok(draftData.draftId);
    assert.match(draftData.note, /explicit human approval/);

    await client.close();
  });
});
