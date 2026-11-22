import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../store.js';
import type { Events } from '../events.js';
import type { AssetRecord, IngestAssetArgs, IngestAssetResult } from './types.js';

const MAX_ASSET_BYTES = 10 * 1024 * 1024; // 10 MiB limit
const MAX_DIMENSION = 8192; // 8192 pixels max width/height

export function detectImageMagic(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // WEBP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function extractImageDimensions(buffer: Buffer, mime: 'image/png' | 'image/jpeg' | 'image/webp'): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' && buffer.length >= 24) {
      // IHDR chunk begins at offset 12; width at 16, height at 20 (big-endian 32-bit int)
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    if (mime === 'image/webp' && buffer.length >= 30) {
      // VP8 / VP8L / VP8X
      const chunkHeader = buffer.toString('ascii', 12, 16);
      if (chunkHeader === 'VP8 ' && buffer.length >= 30) {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        return { width, height };
      }
      if (chunkHeader === 'VP8L' && buffer.length >= 25) {
        const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
        const width = 1 + (((b2 & 0x3f) << 8) | b1);
        const height = 1 + (((b4 & 0xf) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
        return { width, height };
      }
    }
    if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) { // SOF0 or SOF2
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    }
  } catch {}
  return null;
}

export class AssetServices {
  private store: Store;
  private events: Events;
  private baseStorageDir: string;
  private publicApiBase: string;

  constructor(options: {
    store: Store;
    events: Events;
    baseStorageDir?: string;
    publicApiBase?: string;
  }) {
    this.store = options.store;
    this.events = options.events;
    this.baseStorageDir =
      options.baseStorageDir ||
      process.env.ASSET_STORAGE_DIR ||
      path.resolve(process.cwd(), 'data', 'assets', 'generated');
    this.publicApiBase =
      options.publicApiBase ||
      process.env.PUBLIC_API_URL ||
      'https://api.starlidigital.ro';

    try {
      fs.mkdirSync(this.baseStorageDir, { recursive: true });
    } catch {}
  }

  public async ingestImage(args: IngestAssetArgs): Promise<IngestAssetResult> {
    const { buffer, filenameHint, altText, visibility = 'PRIVATE', ownerId, prospectId, projectId } = args;

    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw new Error('Asset payload must be valid binary bytes');
    }

    if (buffer.length === 0) {
      throw new Error('Cannot ingest empty image');
    }

    if (buffer.length > MAX_ASSET_BYTES) {
      throw new Error(`Asset size (${buffer.length} bytes) exceeds maximum limit of 10 MiB`);
    }

    // Verify magic bytes (reject SVG, HTML, script, disguised executables)
    const detectedMime = detectImageMagic(buffer);
    if (!detectedMime) {
      throw new Error('Invalid image format. Only safe raster formats (PNG, JPEG, WebP) are accepted.');
    }

    const dims = extractImageDimensions(buffer, detectedMime);
    if (dims) {
      if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
        throw new Error(`Image dimensions ${dims.width}x${dims.height} exceed maximum allowed ${MAX_DIMENSION}x${MAX_DIMENSION}`);
      }
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const ext = detectedMime === 'image/png' ? 'png' : detectedMime === 'image/jpeg' ? 'jpg' : 'webp';
    const assetId = 'ast-' + randomUUID();
    const filename = `${assetId}.${ext}`;
    const destinationPath = path.join(this.baseStorageDir, filename);

    // Atomically write file (write to tmp then rename)
    const tmpPath = `${destinationPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, destinationPath);

    const backendUrl = `${this.publicApiBase.replace(/\/+$/, '')}/media/assets/${filename}`;

    const record: AssetRecord = {
      id: assetId,
      sha256,
      mimeType: detectedMime,
      byteSize: buffer.length,
      width: dims?.width,
      height: dims?.height,
      filenameHint: filenameHint ? path.basename(filenameHint).replace(/[^a-zA-Z0-9_.-]/g, '') : undefined,
      altText: altText ? String(altText).slice(0, 300) : undefined,
      visibility,
      ownerId,
      prospectId,
      projectId,
      storagePath: destinationPath,
      url: backendUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.store.put('asset-records', record);
    this.events.publish('assets');

    return {
      assetId: record.id,
      sha256: record.sha256,
      mimeType: record.mimeType,
      byteSize: record.byteSize,
      visibility: record.visibility,
      url: record.url
    };
  }

  public getAsset(assetId: string, requestingUser?: { id: string; role?: string }): AssetRecord | undefined {
    const record = this.store.get('asset-records', assetId) as AssetRecord | undefined;
    if (!record) return undefined;
    if (record.visibility === 'PRIVATE') {
      const isAdmin = requestingUser?.role === 'ADMIN' || requestingUser?.role === 'admin';
      const isOwner = Boolean(requestingUser?.id && record.ownerId === requestingUser.id);
      if (!isAdmin && !isOwner) {
        throw new Error('Access denied: private asset requires owner or admin authorization');
      }
    }
    return record;
  }

  public getAssetByFilename(filename: string, requestingUser?: { id: string; role?: string }): { record: AssetRecord; buffer: Buffer } | null {
    // Prevent path traversal
    const cleanFilename = path.basename(filename);
    const assetId = cleanFilename.split('.')[0];
    const record = this.store.get('asset-records', assetId) as AssetRecord | undefined;
    if (!record) return null;

    // Check visibility permissions
    if (record.visibility === 'PRIVATE') {
      const isAdmin = requestingUser?.role === 'ADMIN' || requestingUser?.role === 'admin';
      const isOwner = Boolean(requestingUser?.id && record.ownerId === requestingUser.id);
      if (!isAdmin && !isOwner) {
        throw new Error('Access denied: private asset requires owner or admin authorization');
      }
    }

    if (!fs.existsSync(record.storagePath)) {
      return null;
    }

    const buffer = fs.readFileSync(record.storagePath);
    return { record, buffer };
  }

  public listAssets(filter: { prospectId?: string; projectId?: string; visibility?: string } = {}, requestingUser?: { id: string; role?: string }): AssetRecord[] {
    const all = (this.store.list('asset-records') as AssetRecord[]) || [];
    const isAdmin = requestingUser?.role === 'ADMIN' || requestingUser?.role === 'admin';
    return all.filter(a => {
      if (filter.prospectId && a.prospectId !== filter.prospectId) return false;
      if (filter.projectId && a.projectId !== filter.projectId) return false;
      if (filter.visibility && a.visibility !== filter.visibility) return false;
      if (a.visibility === 'PRIVATE') {
        const isOwner = Boolean(requestingUser?.id && a.ownerId === requestingUser.id);
        if (!isAdmin && !isOwner) return false;
      }
      return true;
    });
  }
}

export function createAssetServices(options: {
  store: Store;
  events: Events;
  baseStorageDir?: string;
  publicApiBase?: string;
}): AssetServices {
  return new AssetServices(options);
}
