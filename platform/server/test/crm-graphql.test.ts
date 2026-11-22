import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { createCrmServices } from '../src/crm/services.js';
import { createCrmGraphQL } from '../src/crm/graphql.js';
import type { Context } from '../src/security.js';

test('CRM GraphQL: executes queries and mutations with admin context', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const services = createCrmServices({ store, events });
  const { resolvers } = createCrmGraphQL({ services });

  const adminUser = {
    id: 'admin_test_1',
    username: 'admin',
    role: 'ADMIN'
  };
  store.saveUser(adminUser as any);

  const mockAdminContext: Context = {
    store,
    user: adminUser,
    ip: '127.0.0.1',
    setCookie: () => {}
  };

  const mockUserContext: Context = {
    store,
    user: { id: 'regular_user', username: 'user1', role: 'USER' },
    ip: '127.0.0.1',
    setCookie: () => {}
  };

  // 1. Regular user is forbidden
  assert.throws(() => {
    resolvers.Query.crmPipeline({}, {}, mockUserContext);
  }, (err: any) => err.extensions?.code === 'FORBIDDEN');

  // 2. Admin can query pipeline
  const pipeline = resolvers.Query.crmPipeline({}, {}, mockAdminContext);
  assert.equal(pipeline.id, 'default-pipeline');
  assert.ok(pipeline.stages.length >= 6);

  // 3. Admin can create company
  const comp = resolvers.Mutation.crmUpsertCompany({}, {
    input: {
      name: 'Alpha Software SRL',
      domain: 'alphasoft.ro',
      industry: 'IT',
      qualificationStatus: 'QUALIFIED'
    }
  }, mockAdminContext);

  assert.equal(comp.name, 'Alpha Software SRL');
  assert.equal(comp.version, 1);

  // 4. Admin can query list of companies
  const companies = resolvers.Query.crmCompanies({}, { search: 'alpha' }, mockAdminContext);
  assert.equal(companies.length, 1);
  assert.equal(companies[0].id, comp.id);

  // 5. Admin can create deal and update stage
  const opp = resolvers.Mutation.crmUpsertOpportunity({}, {
    input: {
      companyId: comp.id,
      title: 'Annual Enterprise Retainer',
      amount: 12000,
      currency: 'EUR',
      stageId: 'negotiation'
    }
  }, mockAdminContext);

  assert.equal(opp.amount, 12000);
  assert.equal(opp.status, 'OPEN');

  // 6. Metrics reflect new opportunity
  const metrics = resolvers.Query.crmPipelineMetrics({}, {}, mockAdminContext);
  assert.equal(metrics.totalOpenCount, 1);
  const openVals = JSON.parse(metrics.totalOpenValueByCurrencyJson);
  assert.equal(openVals['EUR'], 12000);
});
