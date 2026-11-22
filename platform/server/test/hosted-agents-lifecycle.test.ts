import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { HostedAgentService } from '../src/hosted-agents/service.js';
import type { Actor, HostedAgentCreateInput } from '../src/hosted-agents/types.js';

describe('Hosted Agents - Lifecycle, Concurrency & Ownership Isolation', () => {
  let store: Store;
  let service: HostedAgentService;

  const adminActor: Actor = { userId: 'admin_1', role: 'ADMIN', principal: 'admin' };
  const customerA: Actor = { userId: 'cust_a', role: 'CUSTOMER', principal: 'cust_a' };
  const customerB: Actor = { userId: 'cust_b', role: 'CUSTOMER', principal: 'cust_b' };

  beforeEach(() => {
    store = new Store(':memory:');
    store.saveUser({id:customerB.userId, username:customerB.userId, role:'CUSTOMER'});
    service = new HostedAgentService({
      store,
      clock: () => 1700000000000
    });
  });

  test('creates fictional solar business agent in DRAFT mode with initial version 1', async () => {
    const input: HostedAgentCreateInput = {
      name: 'Solar Advisor',
      businessName: 'Helios Solar SRL',
      type: 'SALES',
      instructions: 'Ghidează vizitatorii către consultanță gratuită pentru panouri fotovoltaice.',
      welcomeMessage: 'Salut! Vrei să reduci factura la energie cu panouri solare?',
      businessContext: 'Instalator autorizat de sisteme fotovoltaice rezidențiale și industriale.'
    };

    const agent = await service.create(customerA, input);

    assert.ok(agent.id, 'Agent ID should be defined');
    assert.ok(agent.publicId.startsWith('ag_'), 'Public ID should have ag_ prefix');
    assert.equal(agent.ownerId, customerA.userId);
    assert.equal(agent.name, 'Solar Advisor');
    assert.equal(agent.businessName, 'Helios Solar SRL');
    assert.equal(agent.type, 'SALES');
    assert.equal(agent.status, 'DRAFT');
    assert.equal(agent.version, 1);

    const fetched = await service.get(customerA, agent.id);
    assert.equal(fetched.id, agent.id);
  });

  test('enforces strict tenant isolation: customer B cannot read or modify customer A agent', async () => {
    const agent = await service.create(customerA, {
      name: 'Agent A',
      businessName: 'Firma A',
      type: 'SUPPORT'
    });

    // Customer B attempts get -> rejected
    await assert.rejects(
      async () => service.get(customerB, agent.id),
      /Access denied/
    );

    // Customer B attempts update -> rejected
    await assert.rejects(
      async () => service.update(customerB, agent.id, { name: 'Hacked' }, 1),
      /Access denied/
    );

    // Customer B lists agents -> does not see customer A agent
    const bList = await service.list(customerB);
    assert.equal(bList.length, 0);

    // Admin lists agents with adminAll=true -> sees it
    const adminList = await service.list(adminActor, { adminAll: true });
    assert.equal(adminList.length, 1);
    assert.equal(adminList[0].id, agent.id);
  });

  test('enforces expectedVersion optimistic concurrency on updates', async () => {
    const agent = await service.create(customerA, {
      name: 'Original Name',
      businessName: 'Firma Solar',
      type: 'SALES'
    });

    // Update with correct version 1 succeeds and bumps to version 2
    const updated = await service.update(customerA, agent.id, { name: 'Updated Name' }, 1);
    assert.equal(updated.name, 'Updated Name');
    assert.equal(updated.version, 2);

    // Replay or stale update with old version 1 fails
    await assert.rejects(
      async () => service.update(customerA, agent.id, { name: 'Stale' }, 1),
      /Concurrency conflict/
    );
  });

  test('sets structured knowledge and validates JSON parsing', async () => {
    const agent = await service.create(customerA, {
      name: 'Knowledge Agent',
      businessName: 'SolarTech',
      type: 'SALES'
    });

    const knowledgePayload = JSON.stringify({
      companyDescription: 'Lider în energie solară.',
      productsAndServices: [
        { name: 'Sistem 5kW Hibrid', price: '4500 EUR', description: 'Invertor Huawei + panouri Canadian Solar' }
      ],
      openingHours: 'Luni - Vineri: 09:00 - 18:00',
      contactInfo: { phone: '0712345678', email: 'contact@solartech.ro' }
    });

    const updated = await service.setKnowledge(customerA, agent.id, knowledgePayload, 1);
    assert.equal(updated.version, 2);

    const parsed = JSON.parse(updated.knowledgeJson);
    assert.equal(parsed.productsAndServices[0].name, 'Sistem 5kW Hibrid');
  });

  test('publish lifecycle: DRAFT -> DEMO -> ACTIVE -> DISABLED', async () => {
    const agent = await service.create(customerA, {
      name: 'Sales Bot',
      businessName: 'SolarTech',
      type: 'SALES'
    });

    // Publish as DEMO
    const demoAgent = await service.publish({userId: 'admin_1', role: 'ADMIN'}, agent.id, 'DEMO', 1);
    assert.equal(demoAgent.status, 'DEMO');
    assert.equal(demoAgent.version, 2);

    // Publish as ACTIVE
    const activeAgent = await service.publish({userId: 'admin_1', role: 'ADMIN'}, agent.id, 'ACTIVE', 2);
    assert.equal(activeAgent.status, 'ACTIVE');
    assert.equal(activeAgent.version, 3);

    // Disable agent
    const disabledAgent = await service.disable(customerA, agent.id, 3);
    assert.equal(disabledAgent.status, 'DISABLED');
    assert.equal(disabledAgent.version, 4);
  });

  test('security: INTERNAL_KNOWLEDGE cannot be published as public DEMO or ACTIVE', async () => {
    const agent = await service.create(customerA, {
      name: 'Internal Wiki Bot',
      businessName: 'Internal Ops',
      type: 'INTERNAL_KNOWLEDGE'
    });

    await assert.rejects(
      async () => service.publish({userId: 'admin_1', role: 'ADMIN'}, agent.id, 'DEMO', 1),
      /Security restriction.*INTERNAL_KNOWLEDGE/
    );

    await assert.rejects(
      async () => service.publish({userId: 'admin_1', role: 'ADMIN'}, agent.id, 'ACTIVE', 1),
      /Security restriction.*INTERNAL_KNOWLEDGE/
    );
  });

  test('assignOwner: only admin can reassign agent to another customer', async () => {
    const agent = await service.create(customerA, {
      name: 'Handover Agent',
      businessName: 'Solar Partner',
      type: 'SALES'
    });

    // Customer attempts to assign owner -> rejected
    await assert.rejects(
      async () => service.assignOwner(customerA, agent.id, customerB.userId, 1),
      /Only administrators/
    );

    // Admin assigns to customer B -> succeeds
    const reassigned = await service.assignOwner(adminActor, agent.id, customerB.userId, 1);
    assert.equal(reassigned.ownerId, customerB.userId);
    assert.equal(reassigned.version, 2);

    // Now customer B can access it, customer A cannot
    const bGot = await service.get(customerB, agent.id);
    assert.equal(bGot.id, agent.id);

    await assert.rejects(
      async () => service.get(customerA, agent.id),
      /Access denied/
    );
  });
});
