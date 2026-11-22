import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolve } from 'node:path';
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
  assert.ok(first && typeof first === 'object' && 'text' in first && typeof first.text === 'string');
  return first.text;
}

describe('Proposal Delivery MCP - Creation, Delivery Info Retrieval and Reissue', () => {
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
    tokenVerifier.registerToken('unauthorized-token', {
      id: 'user-guest',
      role: 'customer',
      scopes: [],
      email: 'guest@example.com',
    });

    const healthProbe: UpstreamHealthProbe = {
      async probe() {
        return { ready: true, service: 'starlidigital-backend', dependencies: {}, details: 'OK' };
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
      store,
      events,
      crmServices,
      mailboxServices,
      workspaceRoot: resolve(process.cwd()),
    });

    await new Promise<void>((res) => {
      controlServer.listen(0, '127.0.0.1', () => {
        const addr = controlServer.address() as any;
        controlPort = addr.port;
        res();
      });
    });
  });

  after(async () => {
    controlServer.close();
    auditSink.close();
    store.close();
  });

  it('exposes proposal_get_delivery_info tool and supports proposal creation with claimCode', async () => {
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

    // Verify tool list includes proposal_get_delivery_info
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    assert.ok(names.includes('proposal_get_delivery_info'), 'Must register proposal_get_delivery_info');
    assert.ok(names.includes('proposal_manage'), 'Must register proposal_manage');

    // 1. Create a proposal using proposal_manage
    const createRes = await client.callTool({
      name: 'proposal_manage',
      arguments: {
        action: 'create',
        businessName: 'Avocat Ion Ionescu',
        industry: 'Avocatură',
        locality: 'București',
        phone: '+40740111222',
        email: 'avocat@ionescu.ro',
      },
    });

    const createData = JSON.parse(extractTextContent(createRes));
    assert.equal(createData.status, 'PROPOSAL_CREATED');
    assert.ok(createData.proposalId);
    assert.equal(createData.businessName, 'Avocat Ion Ionescu');
    assert.ok(createData.publicSlug);
    assert.ok(createData.publicUrl.includes('/propunere/'));
    assert.ok(createData.claimCode, 'Creation response must include claimCode');
    assert.match(createData.claimCode, /^\d{5}$/, 'Claim code must be 5 digits');

    const proposalId = createData.proposalId;
    const initialCode = createData.claimCode;

    // 2. Retrieve proposal delivery info via proposal_get_delivery_info
    const deliveryRes = await client.callTool({
      name: 'proposal_get_delivery_info',
      arguments: {
        proposalId,
      },
    });

    const deliveryData = JSON.parse(extractTextContent(deliveryRes));
    assert.equal(deliveryData.proposalId, proposalId);
    assert.equal(deliveryData.businessName, 'Avocat Ion Ionescu');
    assert.equal(deliveryData.publicUrl, createData.publicUrl);
    assert.equal(deliveryData.claimCode, initialCode, 'Should return active claim code without rotating');
    assert.equal(deliveryData.reissued, false);
    assert.equal(deliveryData.claimed, false);

    // 3. proposal_manage action 'get_delivery_info' returns identical information
    const getDeliveryRes = await client.callTool({
      name: 'proposal_manage',
      arguments: {
        action: 'get_delivery_info',
        proposalId,
      },
    });
    const getDeliveryData = JSON.parse(extractTextContent(getDeliveryRes));
    assert.equal(getDeliveryData.proposalId, proposalId);
    assert.equal(getDeliveryData.claimCode, initialCode);
    assert.equal(getDeliveryData.publicUrl, createData.publicUrl);

    // 4. Force reissue generates a fresh claim code
    const reissueRes = await client.callTool({
      name: 'proposal_get_delivery_info',
      arguments: {
        proposalId,
        forceReissue: true,
      },
    });
    const reissueData = JSON.parse(extractTextContent(reissueRes));
    assert.equal(reissueData.proposalId, proposalId);
    assert.ok(reissueData.claimCode);
    assert.match(reissueData.claimCode, /^\d{5}$/);
    assert.notEqual(reissueData.claimCode, initialCode, 'Reissued code must differ from old code');
    assert.equal(reissueData.reissued, true);

    await client.close();
  });

  it('rejects unauthorized access to proposal_get_delivery_info', async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${controlPort}/mcp`),
      {
        requestInit: {
          headers: { 'Authorization': 'Bearer unauthorized-token' },
        },
      }
    );
    transport.onerror = () => {};
    const client = new Client({ name: 'unauthorized-client', version: '1.0.0' }, { capabilities: {} });
    await assert.rejects(
      async () => {
        await client.connect(transport);
      },
      /Forbidden|Non-admin principal denied/i
    );
  });
});
