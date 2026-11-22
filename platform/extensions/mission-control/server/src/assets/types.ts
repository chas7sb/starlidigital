export type AssetVisibility = 'PRIVATE' | 'PUBLIC';

export interface AssetRecord {
  id: string;
  sha256: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteSize: number;
  width?: number;
  height?: number;
  filenameHint?: string;
  altText?: string;
  visibility: AssetVisibility;
  ownerId?: string;
  prospectId?: string;
  projectId?: string;
  storagePath: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface IngestAssetArgs {
  buffer: Buffer;
  mimeType: string;
  filenameHint?: string;
  altText?: string;
  visibility?: AssetVisibility;
  ownerId?: string;
  prospectId?: string;
  projectId?: string;
}

export interface IngestAssetResult {
  assetId: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  visibility: AssetVisibility;
  url: string;
}
