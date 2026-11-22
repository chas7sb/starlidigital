import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { AssetServices } from '../src/assets/service.js';
import { VideoServices } from '../src/video/service.js';
import { isForbiddenIP } from '../src/video/ingest.js';

test('SSRF Protection: blocks loopback, private, link-local, and metadata IPs', () => {
  // Loopback
  assert.equal(isForbiddenIP('127.0.0.1'), true);
  assert.equal(isForbiddenIP('127.0.0.2'), true);
  assert.equal(isForbiddenIP('::1'), true);

  // Cloud metadata service (critical security requirement)
  assert.equal(isForbiddenIP('169.254.169.254'), true);
  assert.equal(isForbiddenIP('169.254.1.1'), true);

  // Private networks (RFC 1918)
  assert.equal(isForbiddenIP('10.0.0.1'), true);
  assert.equal(isForbiddenIP('10.255.255.255'), true);
  assert.equal(isForbiddenIP('172.16.0.1'), true);
  assert.equal(isForbiddenIP('172.31.255.255'), true);
  assert.equal(isForbiddenIP('192.168.1.1'), true);
  assert.equal(isForbiddenIP('192.168.0.100'), true);

  // Unspecified & broadcast
  assert.equal(isForbiddenIP('0.0.0.0'), true);
  assert.equal(isForbiddenIP('255.255.255.255'), true);

  // Valid public IPs allowed
  assert.equal(isForbiddenIP('8.8.8.8'), false);
  assert.equal(isForbiddenIP('1.1.1.1'), false);
  assert.equal(isForbiddenIP('93.184.216.34'), false);
});

test('Video Project Lifecycle & Multi-Tenancy Enforcement', () => {
  const store = new Store(':memory:');
  const events = new Events();
  const assetServices = new AssetServices({ store, events });
  const videoServices = new VideoServices({ store, events, assetServices });

  const userA = { id: 'usr-alice-123', role: 'USER' };
  const userB = { id: 'usr-bob-456', role: 'USER' };
  const admin = { id: 'usr-admin-999', role: 'ADMIN' };

  // 1. User A creates a video project
  const projectA = videoServices.createProject(userA, {
    title: 'Campanie Starli AI — Social Media',
    format: 'VERTICAL_9_16',
    purpose: 'Promovare agenție pe TikTok și Instagram Reels',
  });

  assert.ok(projectA.id.startsWith('vproj-'));
  assert.equal(projectA.ownerId, userA.id);
  assert.equal(projectA.width, 1080);
  assert.equal(projectA.height, 1920);
  assert.equal(projectA.fps, 30);
  assert.equal(projectA.status, 'DRAFT');

  // 2. User A can retrieve it
  const retrievedA = videoServices.getProject(projectA.id, userA);
  assert.ok(retrievedA);
  assert.equal(retrievedA.title, projectA.title);

  // 3. Admin can retrieve it
  const adminRetrieved = videoServices.getProject(projectA.id, admin);
  assert.ok(adminRetrieved);

  // 4. User B MUST be denied access (Cross-tenant security check)
  assert.throws(
    () => {
      videoServices.getProject(projectA.id, userB);
    },
    /Access denied/i
  );

  // 5. User A updates spec declaratively
  const newSpec = {
    canvas: { width: 1080, height: 1920, fps: 30 },
    brand: { businessName: 'StarliDigital' },
    scenes: [
      {
        id: 's1',
        duration: 3.5,
        background: { type: 'color', color: '#080C12' },
        layers: [
          { type: 'text', text: 'Starli AI Agents', fontSize: 50 },
        ],
      },
      {
        id: 's2',
        duration: 4.5,
        background: { type: 'color', color: '#10151D' },
        layers: [
          { type: 'ui', component: 'status_pill', componentProps: { label: 'ONLINE' } },
        ],
      },
    ],
  };

  const updatedA = videoServices.applySpec(projectA.id, newSpec, userA);
  assert.equal(updatedA.status, 'READY');
  assert.equal(updatedA.duration, 8.0);
  assert.equal(updatedA.spec.scenes.length, 2);

  // 6. User B cannot patch User A's project
  assert.throws(
    () => {
      videoServices.patchSpec(projectA.id, { canvas: { fps: 60 } }, userB);
    },
    /Access denied/i
  );

  // 7. User A patches project spec safely
  const patchedA = videoServices.patchSpec(projectA.id, { brand: { tagline: 'Creativity Unleashed' } }, userA);
  assert.equal(patchedA.spec.brand.tagline, 'Creativity Unleashed');

  // 8. Listing projects is tenant-scoped
  const listA = videoServices.listProjects({}, userA);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].id, projectA.id);

  const listB = videoServices.listProjects({}, userB);
  assert.equal(listB.length, 0);

  const listAdmin = videoServices.listProjects({}, admin);
  assert.equal(listAdmin.length, 1);
});

test('Brand Profile Management & Access Control', () => {
  const store = new Store(':memory:');
  const events = new Events();
  const assetServices = new AssetServices({ store, events });
  const videoServices = new VideoServices({ store, events, assetServices });

  const user = { id: 'usr-customer-1', role: 'USER' };

  // Default Starli brand profile is available to all
  const defaultBrand = videoServices.getBrandProfile('bprof-starlidigital-default', user);
  assert.ok(defaultBrand);
  assert.equal(defaultBrand.businessName, 'StarliDigital');
  assert.equal(defaultBrand.primaryColor, '#080C12');

  // User creates custom customer brand profile
  const customBrand = videoServices.createBrandProfile(user, {
    businessName: 'DiamondLux SRL',
    primaryColor: '#0E1726',
    accentColor: '#E2B93B',
    website: 'diamondlux.ro',
    ctaText: 'Descoperă Colecția',
  });

  assert.ok(customBrand.id.startsWith('bprof-'));
  assert.equal(customBrand.businessName, 'DiamondLux SRL');
  assert.equal(customBrand.accentColor, '#E2B93B');

  // Retrieve brand profile
  const retrieved = videoServices.getBrandProfile(customBrand.id, user);
  assert.ok(retrieved);
  assert.equal(retrieved.website, 'diamondlux.ro');
});

test('Video Spec Python Validation Bridge', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const assetServices = new AssetServices({ store, events });
  const videoServices = new VideoServices({ store, events, assetServices });

  // Valid spec
  const validSpec = {
    canvas: { width: 1080, height: 1920, fps: 30 },
    scenes: [
      {
        duration: 4.0,
        layers: [{ type: 'text', text: 'Valid test' }],
      },
    ],
  };

  const resValid = await videoServices.validateSpec(validSpec);
  assert.equal(resValid.valid, true);
  assert.equal(resValid.errors.length, 0);
  assert.equal(resValid.duration, 4.0);

  // Invalid spec: duration 0, invalid layer type
  const invalidSpec = {
    canvas: { width: 1080, height: 1920, fps: 30 },
    scenes: [
      {
        duration: 0.0,
        layers: [{ type: 'non_existent_layer_type' }],
      },
    ],
  };

  const resInvalid = await videoServices.validateSpec(invalidSpec);
  assert.equal(resInvalid.valid, false);
  assert.ok(resInvalid.errors.length >= 2);
});

test('Preview Frame Generation', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const assetServices = new AssetServices({ store, events });
  const videoServices = new VideoServices({ store, events, assetServices });

  const user = { id: 'usr-tester', role: 'USER' };
  const project = videoServices.createProject(user, {
    title: 'Preview Test Video',
    spec: {
      canvas: { width: 480, height: 854, fps: 30 },
      scenes: [
        {
          duration: 3.0,
          background: { type: 'color', color: '#080C12' },
          layers: [
            { type: 'shape', shape: 'starli_star', x: 240, y: 200, width: 60, height: 60 },
            { type: 'text', text: 'Cadrul de Previzualizare', x: 240, y: 350, fontSize: 32, align: 'center', anchor: 'top_center' },
          ],
        },
      ],
    },
  });

  const preview = await videoServices.generatePreviewFrame(project.id, 1.0, user);
  assert.ok(preview.dataUrl.startsWith('data:image/png;base64,'));
  assert.ok(preview.buffer.length > 1000);
  assert.ok(preview.url.includes('/media/videos/preview-'));
});


test('video specs cannot reference server files or other tenants private assets', () => {
  const store = new Store(':memory:');
  const events = new Events();
  const service = new VideoServices({ store, events, assetServices: new AssetServices({ store, events }) });
  const actor = { id: 'alice', role: 'USER' };
  const project = service.createProject(actor, { title: 'Private test' });
  assert.throws(() => service.applySpec(project.id, { scenes: [{ duration: 1, layers: [{ type: 'image', assetPath: 'C:/Windows/private.png' }] }] }, actor), /Filesystem paths/);
  store.put('asset-records', { id: 'private-image', ownerId: 'bob', visibility: 'PRIVATE', storagePath: 'unused' });
  assert.throws(() => service.applySpec(project.id, { scenes: [{ duration: 1, layers: [{ type: 'image', assetId: 'private-image' }] }] }, actor), /access denied/);
  store.close();
});


test('worker preserves queued jobs at startup and completes a real small MP4', async () => {
  const { VideoRenderWorker } = await import('../src/video/worker.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starli-video-test-'));
  const store = new Store(':memory:');
  const events = new Events();
  const assetServices = new AssetServices({ store, events });
  const service = new VideoServices({ store, events, assetServices, storageDir: dir });
  const actor = { id: 'worker-test', role: 'USER' };
  try {
    const project = service.createProject(actor, { title: 'Worker encoding', spec: { canvas: { width: 240, height: 240, fps: 10 }, scenes: [{ duration: 0.3, layers: [{ type: 'text', text: 'Starli', fontSize: 24 }] }] } });
    const render = service.startRender(project.id, actor);
    const worker = new VideoRenderWorker({ store, events, assetServices, baseDir: path.join(dir, 'renders') });
    assert.equal(service.getRender(render.id, actor)?.status, 'QUEUED');
    await worker.processNext();
    const completed = service.getRender(render.id, actor)!;
    assert.equal(completed.status, 'COMPLETE', completed.error);
    assert.ok(fs.statSync(completed.outputPath!).size > 1000);
    const cancelled = service.startRender(project.id, actor);
    service.cancelRender(cancelled.id, actor);
    await worker.processNext();
    assert.equal(service.getRender(cancelled.id, actor)?.status, 'CANCELLED');
    const running = service.startRender(project.id, actor);
    const executing = worker.processNext();
    service.cancelRender(running.id, actor);
    await executing;
    assert.equal(service.getRender(running.id, actor)?.status, 'CANCELLED');
    assert.equal(service.getRender(running.id, actor)?.outputPath, undefined);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
