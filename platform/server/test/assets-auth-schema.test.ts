import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { createAppSchema } from '../src/schema.js';
import { createAssetServices } from '../src/assets/service.js';
import { createAssetGraphQL } from '../src/assets/graphql.js';
import type { Context } from '../src/security.js';

const fixturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test('schema: deepMergeResolvers integrates Query, Mutation, and entity resolvers without overwriting', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const schema = createAppSchema(store, events);

  // Validate that queries from core, CRM, Mailbox, and Assets all exist in schema
  const queryType = schema.getQueryType();
  assert.ok(queryType, 'Query type exists');
  const queryFields = queryType.getFields();

  // Core queries
  assert.ok(queryFields.me, 'Core Query.me exists');
  assert.ok(queryFields.projects, 'Core Query.projects exists');
  assert.ok(queryFields.wallet, 'Core Query.wallet exists');

  // CRM queries
  assert.ok(queryFields.crmPipeline, 'CRM Query.crmPipeline exists');
  assert.ok(queryFields.crmCompany, 'CRM Query.crmCompany exists');

  // Mailbox queries
  assert.ok(queryFields.mailboxAccount, 'Mailbox Query.mailboxAccount exists');
  assert.ok(queryFields.mailboxMessages, 'Mailbox Query.mailboxMessages exists');

  // Asset queries
  assert.ok(queryFields.asset, 'Asset Query.asset exists');
  assert.ok(queryFields.assets, 'Asset Query.assets exists');

  // Mutation fields
  const mutationType = schema.getMutationType();
  assert.ok(mutationType, 'Mutation type exists');
  const mutFields = mutationType.getFields();

  // Core mutations
  assert.ok(mutFields.register, 'Core Mutation.register exists');
  assert.ok(mutFields.buildProject, 'Core Mutation.buildProject exists');

  // CRM mutations
  assert.ok(mutFields.crmUpsertCompany, 'CRM Mutation.crmUpsertCompany exists');
  assert.ok(mutFields.crmUpsertContact, 'CRM Mutation.crmUpsertContact exists');

  // Mailbox mutations
  assert.ok(mutFields.mailboxCreateDraft, 'Mailbox Mutation.mailboxCreateDraft exists');
  assert.ok(mutFields.mailboxSendApprovedDraft, 'Mailbox Mutation.mailboxSendApprovedDraft exists');
});

test('assets security: GraphQL query authorization & privacy defaults', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const testDir = path.resolve(process.cwd(), 'data', 'test-assets-sec-' + Date.now());

  const assetServices = createAssetServices({
    store,
    events,
    baseStorageDir: testDir
  });

  const { resolvers } = createAssetGraphQL({ services: assetServices });

  // 1. Ingestion defaults to PRIVATE
  const assetDefault = await assetServices.ingestImage({
    buffer: fixturePng,
    mimeType: 'image/png',
    ownerId: 'user-alice'
  });
  assert.equal(assetDefault.visibility, 'PRIVATE', 'Default visibility must be PRIVATE');

  // Ingest a public asset
  const assetPublic = await assetServices.ingestImage({
    buffer: fixturePng,
    mimeType: 'image/png',
    visibility: 'PUBLIC',
    ownerId: 'user-alice'
  });
  assert.equal(assetPublic.visibility, 'PUBLIC');

  const unauthenticatedCtx: Context = {
    store,
    ip: '127.0.0.1',
    setCookie: () => {}
  };

  const userAliceCtx: Context = {
    store,
    user: { id: 'user-alice', username: 'alice', role: 'USER' },
    ip: '127.0.0.1',
    setCookie: () => {}
  };

  const userBobCtx: Context = {
    store,
    user: { id: 'user-bob', username: 'bob', role: 'USER' },
    ip: '127.0.0.1',
    setCookie: () => {}
  };

  const adminCtx: Context = {
    store,
    user: { id: 'admin-1', username: 'admin', role: 'ADMIN' },
    ip: '127.0.0.1',
    setCookie: () => {}
  };

  // 2. Unauthenticated user cannot query asset (fails with UNAUTHENTICATED)
  assert.throws(() => {
    resolvers.Query.asset({}, { id: assetDefault.assetId }, unauthenticatedCtx);
  }, /Autentifică-te/);

  // 3. User Bob cannot query Alice's private asset (fails with FORBIDDEN)
  assert.throws(() => {
    resolvers.Query.asset({}, { id: assetDefault.assetId }, userBobCtx);
  }, /Nu ai acces|Access denied/);

  // 4. User Alice can query her own private asset
  const aliceRes = resolvers.Query.asset({}, { id: assetDefault.assetId }, userAliceCtx);
  assert.ok(aliceRes);
  assert.equal(aliceRes.id, assetDefault.assetId);

  // 5. Admin can query Alice's private asset
  const adminRes = resolvers.Query.asset({}, { id: assetDefault.assetId }, adminCtx);
  assert.ok(adminRes);
  assert.equal(adminRes.id, assetDefault.assetId);

  // 6. User Bob can query public asset
  const bobPublicRes = resolvers.Query.asset({}, { id: assetPublic.assetId }, userBobCtx);
  assert.ok(bobPublicRes);
  assert.equal(bobPublicRes.id, assetPublic.assetId);

  // 7. listAssets filters private assets for Bob, includes for Alice & Admin
  const bobList = resolvers.Query.assets({}, {}, userBobCtx);
  assert.equal(bobList.some((a: any) => a.id === assetDefault.assetId), false);
  assert.equal(bobList.some((a: any) => a.id === assetPublic.assetId), true);

  const aliceList = resolvers.Query.assets({}, {}, userAliceCtx);
  assert.equal(aliceList.some((a: any) => a.id === assetDefault.assetId), true);

  const adminList = resolvers.Query.assets({}, {}, adminCtx);
  assert.equal(adminList.some((a: any) => a.id === assetDefault.assetId), true);

  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});
