export type VideoFormat = 'VERTICAL_9_16' | 'SQUARE_1_1' | 'HORIZONTAL_16_9' | 'CUSTOM';

export type VideoProjectStatus = 'DRAFT' | 'READY' | 'RENDERING' | 'COMPLETE' | 'FAILED' | 'ARCHIVED';

export type VideoRenderStatus =
  | 'QUEUED'
  | 'VALIDATING'
  | 'PREPARING_VOICEOVERS'
  | 'MIXING_AUDIO'
  | 'RENDERING_FRAMES'
  | 'ENCODING'
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED';

export interface VideoProjectRecord {
  id: string; // vproj-...
  ownerId: string;
  customerId?: string;
  title: string;
  slug: string;
  purpose?: string;
  status: VideoProjectStatus;
  format: VideoFormat;
  width: number;
  height: number;
  fps: number;
  duration: number;
  spec: any; // Raw declarative VideoSpec JSON
  brandProfileId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrandProfileRecord {
  id: string; // bprof-...
  ownerId: string;
  businessName: string;
  logoAssetId?: string;
  symbolAssetId?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
  silverColor: string;
  mutedColor?: string;
  onlineColor?: string;
  fontHeading?: string;
  fontBody?: string;
  visualStyle?: string;
  tagline: string;
  website: string;
  ctaText: string;
  ctaUrl?: string;
  socialHandles?: Record<string, string>;
  voicePreference: string;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoRenderRecord {
  specSnapshot?: any;
  id: string; // vrnd-...
  videoProjectId: string;
  ownerId: string;
  status: VideoRenderStatus;
  progress: number; // 0.0 to 1.0
  stage: string;
  outputPath?: string;
  outputUrl?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  fileSize?: number;
  error?: string;
  logs?: string[];
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActorContext {
  id: string;
  role?: string;
}
