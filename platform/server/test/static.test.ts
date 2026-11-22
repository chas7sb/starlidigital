import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeStaticPath } from '../src/static.js';
test('static serving stays inside web dist, including encoded Windows separators',()=>{
 assert.ok(safeStaticPath('/assets/index-12345678.js')?.endsWith('index-12345678.js'));
 assert.equal(safeStaticPath('/%2e%2e/%2e%2e/.env'),null);
 assert.equal(safeStaticPath('/..%5c..%5c.env'),null);
 assert.equal(safeStaticPath('/bad%00path'),null);
 assert.equal(safeStaticPath('/bad%ZZpath'),null);
});
