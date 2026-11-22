import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { authorizedVideoMedia } from '../src/video-media.js';
import type { Context } from '../src/security.js';

test('video outputs require authenticated owner or admin and a completed record', () => {
  const store = new Store(':memory:');
  const ctx = (id?: string, role = 'USER') => ({ store, user: id ? { id, role } : undefined } as Context);
  const render = { id: 'vrnd-ab12', ownerId: 'a', status: 'COMPLETE', outputPath: '/private/movie.mp4', thumbnailPath: '/private/thumb.jpg' };
  store.put('video-renders', render);
  assert.equal(authorizedVideoMedia(store, ctx(), 'vrnd-ab12.mp4'), undefined);
  assert.equal(authorizedVideoMedia(store, ctx('b'), 'vrnd-ab12.mp4'), undefined);
  assert.equal(authorizedVideoMedia(store, ctx('a'), 'vrnd-ab12.mp4'), render.outputPath);
  assert.equal(authorizedVideoMedia(store, ctx('admin', 'ADMIN'), 'vrnd-ab12-thumb.jpg'), render.thumbnailPath);
  assert.equal(authorizedVideoMedia(store, ctx('a'), '../../private/movie.mp4'), undefined);
  store.put('video-renders', { ...render, status: 'CANCELLED' });
  assert.equal(authorizedVideoMedia(store, ctx('a'), 'vrnd-ab12.mp4'), undefined);
  store.put('video-previews', { id: 'prev-ab12', ownerId: 'a', outputPath: '/private/preview.png' });
  assert.equal(authorizedVideoMedia(store, ctx('a'), 'preview-prev-ab12.png'), '/private/preview.png');
  assert.equal(authorizedVideoMedia(store, ctx('b'), 'preview-prev-ab12.png'), undefined);
  store.put('asset-records', { id: 'vast-ab12', ownerId: 'a', storagePath: '/private/voice.wav' });
  assert.equal(authorizedVideoMedia(store, ctx('b'), 'vast-ab12.wav'), undefined);
  assert.equal(authorizedVideoMedia(store, { ...ctx('admin', 'ADMIN'), operatorTokenId: 'token', operatorPermissions: [] }, 'vast-ab12.wav'), undefined);
  store.db.close();
});
