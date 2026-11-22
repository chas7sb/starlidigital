import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { createCrmServices } from '../src/crm/services.js';
import { sanitizeCsvField, toCsvString, parseCsvString } from '../src/crm/csv.js';

test('CRM: creates company, contacts, signals, opportunities and enforces expectedVersion concurrency', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const crm = createCrmServices({ store, events });
  const caller = { userId: 'admin-1', role: 'ADMIN', principal: 'admin' };

  // 1. Create company
  const comp = crm.upsertCompany(caller, {
    name: 'Starli Corp',
    domain: 'https://starlidigital.ro/about',
    industry: 'Software',
    email: 'hello@starlidigital.ro',
    qualificationStatus: 'QUALIFYING',
    tags: ['vip', 'tech']
  });

  assert.equal(comp.version, 1);
  assert.equal(comp.domain, 'starlidigital.ro');
  assert.deepEqual(comp.tags, ['vip', 'tech']);

  // 2. Successful update with expectedVersion = 1
  const compV2 = crm.upsertCompany(caller, {
    id: comp.id,
    name: 'Starli Digital SRL',
    qualificationStatus: 'QUALIFIED'
  }, 1);

  assert.equal(compV2.version, 2);
  assert.equal(compV2.name, 'Starli Digital SRL');

  // 3. Stale update with expectedVersion = 1 must throw CONFLICT
  assert.throws(() => {
    crm.upsertCompany(caller, {
      id: comp.id,
      name: 'Stale Name'
    }, 1);
  }, (err: any) => err.extensions?.code === 'CONFLICT');

  // 4. Add contact
  const contact = crm.upsertContact(caller, {
    companyId: comp.id,
    firstName: 'Alex',
    lastName: 'Ionescu',
    email: 'alex@starlidigital.ro',
    isPrimary: true
  });
  assert.equal(contact.fullName, 'Alex Ionescu');
  assert.equal(contact.companyId, comp.id);
  assert.equal(contact.version, 1);

  // 5. Add signal & verify
  const signal = crm.addSignal(caller, {
    companyId: comp.id,
    source: 'WEBSITE_AUDIT',
    kind: 'OUTDATED_WEBSITE',
    title: 'Missing SSL and mobile layout',
    summary: 'Homepage viewport meta tag missing',
    confidenceScore: 0.95,
    verified: false
  });
  assert.equal(signal.verified, false);
  const verifiedSignal = crm.verifySignal(caller, signal.id, true, 1);
  assert.equal(verifiedSignal.verified, true);
  assert.equal(verifiedSignal.version, 2);

  // 6. Create opportunity with stage movement
  const opp = crm.upsertOpportunity(caller, {
    companyId: comp.id,
    title: 'Website Redesign & Custom CRM',
    amount: 3500,
    currency: 'EUR',
    stageId: 'proposal'
  });
  assert.equal(opp.amount, 3500);
  assert.equal(opp.currency, 'EUR');
  assert.equal(opp.status, 'OPEN');

  // Move to Closed Won
  const wonOpp = crm.upsertOpportunity(caller, {
    id: opp.id,
    companyId: comp.id,
    title: opp.title,
    amount: opp.amount,
    currency: opp.currency,
    stageId: 'closed_won',
    wonReason: 'High quality prototype'
  }, 1);
  assert.equal(wonOpp.status, 'WON');
  assert.equal(wonOpp.wonReason, 'High quality prototype');

  // Ground truth metrics test
  const metrics = crm.getPipelineMetrics();
  assert.equal(metrics.totalWonCount, 1);
  assert.equal(metrics.totalWonValueByCurrency['EUR'], 3500);
  assert.equal(metrics.wonReasonsBreakdown['High quality prototype'], 1);
});

test('CRM: company merge re-parents contacts, signals, opportunities and preserves links', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const crm = createCrmServices({ store, events });
  const caller = { userId: 'admin-1', role: 'ADMIN', principal: 'admin' };

  const target = crm.upsertCompany(caller, {
    name: 'Primary Target Ltd',
    domain: 'target.ro',
    tags: ['target']
  });

  const source = crm.upsertCompany(caller, {
    name: 'Duplicate Source Ltd',
    domain: 'source.ro',
    legacyLeadId: 'lead_123',
    proposalId: 'prop_456',
    projectId: 'proj_789',
    tags: ['source', 'target']
  });

  crm.upsertContact(caller, {
    companyId: source.id,
    firstName: 'Dan',
    lastName: 'Popa',
    isPrimary: false
  });

  crm.upsertOpportunity(caller, {
    companyId: source.id,
    title: 'Deal 1',
    amount: 1200,
    currency: 'EUR',
    stageId: 'discovery'
  });

  // Merge
  const merged = crm.mergeCompanies(caller, target.id, source.id, 1, 1);
  assert.equal(merged.id, target.id);
  assert.equal(merged.legacyLeadId, 'lead_123');
  assert.equal(merged.proposalId, 'prop_456');
  assert.equal(merged.projectId, 'proj_789');
  assert.deepEqual(merged.tags.sort(), ['source', 'target']);

  // Source should be removed
  assert.equal(crm.getCompany(source.id), undefined);

  // Contacts and opportunities re-parented
  const targetContacts = crm.listContacts(target.id);
  assert.equal(targetContacts.length, 1);
  assert.equal(targetContacts[0].companyId, target.id);

  const targetOpps = crm.listOpportunities({ companyId: target.id });
  assert.equal(targetOpps.length, 1);
  assert.equal(targetOpps[0].companyId, target.id);
});

test('CRM: CSV formula injection neutralization, preview, deduplication and export', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const crm = createCrmServices({ store, events });
  const caller = { userId: 'admin-1', role: 'ADMIN', principal: 'admin' };

  // Pre-insert an existing company
  crm.upsertCompany(caller, {
    name: 'Existing Dental Clinic',
    domain: 'dentalclinic.ro',
    email: 'office@dentalclinic.ro'
  });

  // Malicious CSV with formula injection attacks and duplicate entries
  const csvRaw = `Name,Domain,Email,Industry,Contact
"=cmd|' /C calc'!A0",malicious.com,attacker@bad.org,Attacks,John Hacker
"+123456",safe.com,safe@safe.com,Safe,Safe Contact
Existing Dental Clinic,dentalclinic.ro,duplicate@dentalclinic.ro,Healthcare,Dr. Clean
`;

  // Preview
  const preview = crm.previewCsvImport(csvRaw);
  assert.equal(preview.totalRows, 3);
  assert.equal(preview.duplicateCount, 1);
  assert.equal(preview.validRows, 2);

  // The malicious formula `=cmd|' /C calc'!A0` is sanitized with a prefix quote `'`
  const formulaRow = preview.rows[0];
  assert.match(formulaRow.name, /^'=cmd/);

  // Import skipping duplicates
  const importResult = crm.executeCsvImport(caller, csvRaw, { skipDuplicates: true });
  assert.equal(importResult.importedCount, 2);
  assert.equal(importResult.skippedCount, 1);

  // Export and verify formula protection
  const exported = crm.exportCompaniesCsv();
  assert.match(exported, /'=cmd/);
  assert.match(exported, /dentalclinic\.ro/);
});

test('CRM: timeline activity logging, mailbox activity sink, and deduplication via sourceEventId', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const crm = createCrmServices({ store, events });

  const act1 = crm.logActivity({
    kind: 'EMAIL_INBOUND',
    actorPrincipal: 'alex@starlidigital.ro',
    occurredAt: new Date().toISOString(),
    summary: 'Inbound message from client@domain.com',
    sourceEventId: 'msg_rfc_123456@domain.com',
    visibility: 'INTERNAL_ONLY'
  });

  const act2 = crm.logActivity({
    kind: 'EMAIL_INBOUND',
    actorPrincipal: 'alex@starlidigital.ro',
    occurredAt: new Date().toISOString(),
    summary: 'Duplicate sync should return same activity',
    sourceEventId: 'msg_rfc_123456@domain.com',
    visibility: 'INTERNAL_ONLY'
  });

  assert.equal(act1.id, act2.id);
  const list = crm.listActivities();
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'EMAIL_INBOUND');
});

test('CRM: saved views lifecycle, owner filtering and expectedVersion enforcement', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const crm = createCrmServices({ store, events });
  const adminCaller = { userId: 'admin-1', role: 'ADMIN', principal: 'admin' };
  const userCaller = { userId: 'user-2', role: 'USER', principal: 'user2' };

  // 1. Create a private saved view
  const view1 = crm.upsertSavedView(userCaller, {
    name: 'My Tech Prospects',
    target: 'COMPANIES',
    filtersJson: JSON.stringify({ industry: 'tech' }),
    isShared: false
  });
  assert.equal(view1.version, 1);
  assert.equal(view1.ownerId, 'user-2');

  // 2. Another non-admin cannot view or modify it
  const otherCaller = { userId: 'user-3', role: 'USER', principal: 'user3' };
  const otherViews = crm.listSavedViews(otherCaller, 'COMPANIES');
  assert.equal(otherViews.find(v => v.id === view1.id), undefined);

  assert.throws(() => {
    crm.upsertSavedView(otherCaller, {
      id: view1.id,
      name: 'Hacked View',
      target: 'COMPANIES',
      filtersJson: '{}'
    }, 1);
  }, (err: any) => err.extensions?.code === 'FORBIDDEN');

  // 3. Version conflict enforcement
  assert.throws(() => {
    crm.upsertSavedView(userCaller, {
      id: view1.id,
      name: 'Updated View',
      target: 'COMPANIES',
      filtersJson: '{}'
    }, 99);
  }, (err: any) => err.extensions?.code === 'CONFLICT');

  // 4. Successful update
  const updated = crm.upsertSavedView(userCaller, {
    id: view1.id,
    name: 'Updated View',
    target: 'COMPANIES',
    filtersJson: '{}',
    isShared: true
  }, 1);
  assert.equal(updated.version, 2);
  assert.equal(updated.isShared, true);

  // Now other caller can see it because isShared is true
  const visibleNow = crm.listSavedViews(otherCaller, 'COMPANIES');
  assert.ok(visibleNow.find(v => v.id === view1.id));
});
