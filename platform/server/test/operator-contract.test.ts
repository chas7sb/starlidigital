import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, validate } from 'graphql';
import { createAppSchema } from '../src/schema.js';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';

test('CLI token status and public proposal queries match the server schema', () => {
  const store = new Store(':memory:');
  try {
    const schema = createAppSchema(store, new Events());
    const cliQuery = '{ me { id email username role } operatorTokens { id label tokenPrefix permissions expiresAt lastUsedAt revokedAt } }';
    assert.deepEqual(validate(schema, parse(cliQuery)).map(e => e.message), []);
    const source = readFileSync(new URL('../../web/src/PublicProposal.tsx', import.meta.url), 'utf8');
    const query = source.match(/`(query\(\$slug:[\s\S]*?)`/);
    assert.ok(query, 'Public proposal query must be checked against the API');
    assert.deepEqual(validate(schema, parse(query[1])).map(e => e.message), []);
  } finally { store.db.close(); }
});

test('every operator console operation matches the GraphQL schema', () => {
  const store = new Store(':memory:');
  try {
    const schema = createAppSchema(store,new Events());
    const source=readFileSync(new URL('../../web/src/OperatorConsole.tsx',import.meta.url),'utf8');
    const operations=[...source.matchAll(/`\s*((?:query|mutation|subscription)\b[^`]*?)`/g)];
    assert.ok(operations.length>=10);
    for(const operation of operations)assert.deepEqual(validate(schema,parse(operation[1])).map(e=>e.message),[],operation[1]);
  } finally {store.close();}
});
