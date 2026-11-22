import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { createAssetServices, detectImageMagic, extractImageDimensions } from '../src/assets/service.js';

test('assets adversarial: oversized payloads (>10 MiB) and dimension bombs (>8192px) rejected', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const testStorageDir = path.resolve(process.cwd(), 'data', 'test-assets-adv-' + Date.now());

  const assetService = createAssetServices({
    store,
    events,
    baseStorageDir: testStorageDir
  });

  // 1. Oversized buffer (>10 MiB)
  const bigBuffer = Buffer.alloc(10 * 1024 * 1024 + 1);
  bigBuffer[0] = 0x89;
  bigBuffer[1] = 0x50;
  bigBuffer[2] = 0x4e;
  bigBuffer[3] = 0x47;
  bigBuffer[4] = 0x0d;
  bigBuffer[5] = 0x0a;
  bigBuffer[6] = 0x1a;
  bigBuffer[7] = 0x0a;

  await assert.rejects(
    async () => {
      await assetService.ingestImage({
        buffer: bigBuffer,
        mimeType: 'image/png'
      });
    },
    /exceeds maximum limit of 10 MiB/
  );

  // 2. Decompression / dimension bomb (e.g., width claimed as 65535 in PNG IHDR)
  const fakeBombPng = Buffer.alloc(32);
  // PNG signature
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(fakeBombPng, 0);
  // IHDR chunk: length 13, type IHDR
  fakeBombPng.writeUInt32BE(13, 8);
  fakeBombPng.write('IHDR', 12);
  fakeBombPng.writeUInt32BE(10000, 16); // 10000 px width (>8192 max)
  fakeBombPng.writeUInt32BE(500, 20);   // 500 px height

  await assert.rejects(
    async () => {
      await assetService.ingestImage({
        buffer: fakeBombPng,
        mimeType: 'image/png'
      });
    },
    /exceed maximum allowed 8192x8192/
  );

  try {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  } catch {}
});

test('assets permissions: private assets strictly enforce owner/admin access and block path traversal', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const testStorageDir = path.resolve(process.cwd(), 'data', 'test-assets-perm-' + Date.now());

  const assetService = createAssetServices({
    store,
    events,
    baseStorageDir: testStorageDir
  });

  const fixturePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  // Ingest private image owned by user-1
  const ingested = await assetService.ingestImage({
    buffer: fixturePng,
    mimeType: 'image/png',
    visibility: 'PRIVATE',
    ownerId: 'user-1'
  });

  const filename = path.basename(ingested.url);

  // 1. Path traversal attempt in getAssetByFilename
  const traversalResult = assetService.getAssetByFilename(`../../etc/${filename}`, { id: 'user-1' });
  // path.basename neutralizes the traversal and still resolves the file safely
  assert.ok(traversalResult);
  assert.equal(traversalResult.record.id, ingested.assetId);

  // 2. Unauthenticated access to private asset rejected
  assert.throws(
    () => {
      assetService.getAssetByFilename(filename);
    },
    /Access denied/
  );

  // 3. Different unprivileged user access rejected
  assert.throws(
    () => {
      assetService.getAssetByFilename(filename, { id: 'unauthorized-user', role: 'USER' });
    },
    /Access denied/
  );

  // 4. Owner access granted
  const ownerAccess = assetService.getAssetByFilename(filename, { id: 'user-1', role: 'USER' });
  assert.ok(ownerAccess);
  assert.deepEqual(ownerAccess.buffer, fixturePng);

  // 5. Admin access granted
  const adminAccess = assetService.getAssetByFilename(filename, { id: 'admin-alex', role: 'ADMIN' });
  assert.ok(adminAccess);
  assert.deepEqual(adminAccess.buffer, fixturePng);

  try {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  } catch {}
});
