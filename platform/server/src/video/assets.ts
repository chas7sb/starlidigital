import fs from 'node:fs';
import type { Store } from '../store.js';
import type { ActorContext } from './types.js';

/** Client specifications may reference authorized vault assets, never server paths. */
export function resolveVideoSpecAssets(store: Store, spec: any, actor: ActorContext): any {
  if (JSON.stringify(spec).length > 500_000) throw new Error('Video specification exceeds size limit');
  const canvas = spec?.canvas || {};
  if ((canvas.width !== undefined && (!Number.isInteger(canvas.width) || canvas.width < 240 || canvas.width > 3840)) || (canvas.height !== undefined && (!Number.isInteger(canvas.height) || canvas.height < 240 || canvas.height > 3840)) || (canvas.fps !== undefined && (!Number.isInteger(canvas.fps) || canvas.fps < 10 || canvas.fps > 60))) throw new Error('Invalid video canvas bounds');
  if (!Array.isArray(spec?.scenes) || spec.scenes.length < 1 || spec.scenes.length > 60) throw new Error('Video must contain 1 to 60 scenes');
  if (spec.scenes.reduce((n: number, scene: any) => n + Number(scene.duration || 0), 0) > 180 || (canvas.duration !== undefined && (!Number.isFinite(canvas.duration) || canvas.duration <= 0 || canvas.duration > 180))) throw new Error('Video duration exceeds limit');
  const walk = (value: any, depth = 0): any => {
    if (depth > 25) throw new Error("Video specification nesting exceeds limit");
    if (Array.isArray(value)) return value.map(item => walk(item, depth + 1));
    if (!value || typeof value !== 'object') return value;
    const copy: any = {};
    if (value.layers && (!Array.isArray(value.layers) || value.layers.length > 100)) throw new Error('Too many video layers');
    if (value.particleCount !== undefined && (!Number.isInteger(value.particleCount) || value.particleCount < 0 || value.particleCount > 1000)) throw new Error('Invalid particle count');
    if (value.type && ['image', 'shape', 'ui', 'text', 'overlay'].includes(value.type)) {
      for (const dimension of ['width', 'height', 'fontSize']) if (value[dimension] !== undefined && (!Number.isFinite(value[dimension]) || value[dimension] < 0 || value[dimension] > 7680)) throw new Error('Layer dimensions exceed limit');
    }
    for (const [key, item] of Object.entries(value)) {
      if (['assetPath', 'logoPath', 'symbolPath'].includes(key) && item) throw new Error('Filesystem paths are forbidden in video specifications');
      copy[key] = walk(item, depth + 1);
    }
    for (const [key, target] of [['assetId', 'assetPath'], ['logoAssetId', 'logoPath'], ['symbolAssetId', 'symbolPath']]) {
      if (!value[key]) continue;
      const asset = store.get('asset-records', String(value[key]));
      if (!asset || (asset.visibility !== 'PUBLIC' && asset.ownerId !== actor.id && !['ADMIN', 'admin'].includes(actor.role || ''))) throw new Error('Video asset not found or access denied');
      if (!asset.storagePath || !fs.existsSync(asset.storagePath)) throw new Error('Video asset file is unavailable');
      copy[target] = asset.storagePath;
    }
    return copy;
  };
  return walk(spec);
}
