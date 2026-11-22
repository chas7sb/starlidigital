import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { createAssetServices, detectImageMagic } from '../src/assets/service.js';

test('assets: detects valid image magics and rejects SVG or scripts', () => {
  // 1x1 valid PNG
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  assert.equal(detectImageMagic(pngHeader), 'image/png');

  // JPEG
  const jpgHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  assert.equal(detectImageMagic(jpgHeader), 'image/jpeg');

  // SVG / HTML / Script disguise rejected
  const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal(detectImageMagic(svgBuffer), null);

  const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff');
  assert.equal(detectImageMagic(exeBuffer), null);
});

test('assets: ingests valid PNG, computes SHA-256, writes disk atomically, and serves URL', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const testStorageDir = path.resolve(process.cwd(), 'data', 'test-assets-' + Date.now());

  const assetService = createAssetServices({
    store,
    events,
    baseStorageDir: testStorageDir,
    publicApiBase: 'https://api.starlidigital.ro'
  });

  // Valid 1x1 PNG fixture bytes
  const fixturePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  const result = await assetService.ingestImage({
    buffer: fixturePng,
    mimeType: 'image/png',
    filenameHint: 'chatgpt-hero-banner.png',
    altText: 'A modern landing page hero graphic',
    visibility: 'PUBLIC',
    projectId: 'proj-123',
    prospectId: 'prosp-456'
  });

  assert.ok(result.assetId.startsWith('ast-'));
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.byteSize, fixturePng.length);
  assert.ok(result.url.startsWith('https://api.starlidigital.ro/media/assets/'));

  // File exists on disk and exact bytes match
  const stored = assetService.getAsset(result.assetId);
  assert.ok(stored);
  assert.equal(stored.sha256, result.sha256);
  assert.equal(fs.existsSync(stored.storagePath), true);
  const diskBytes = fs.readFileSync(stored.storagePath);
  assert.deepEqual(diskBytes, fixturePng);

  // Clean up
  try {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  } catch {}
});
