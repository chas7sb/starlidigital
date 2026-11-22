import type { VideoFormat } from '../video/types.js';

export type VideoSceneTemplate =
  | 'HOOK_TITLE' | 'KINETIC_TYPOGRAPHY' | 'FEATURE_CARDS' | 'BENEFIT_CARDS'
  | 'PRODUCT_SCREENSHOT' | 'APP_MOCKUP' | 'WEBSITE_SHOWCASE' | 'STAT_METRIC'
  | 'TESTIMONIAL_QUOTE' | 'BEFORE_AFTER' | 'LOGO_BRAND_MOMENT' | 'CTA_END_CARD';

export type VideoPlatformTarget = 'TIKTOK' | 'INSTAGRAM_REELS' | 'YOUTUBE_SHORTS' | 'SOCIAL_FEED' | 'YOUTUBE' | 'WEB' | 'PRESENTATION';
export type SceneAssetSource = 'STARLI_ASSET' | 'GENERATED_IMAGE' | 'UPLOAD' | 'WEBSITE_SCREENSHOT' | 'APP_SCREENSHOT' | 'BRAND_ASSET' | 'VOICEOVER' | 'APPROVED_AUDIO';

export interface VideoBriefInput {
  title: string;
  objective: string;
  audience?: string;
  product?: string;
  cta?: string;
  platformTargets?: VideoPlatformTarget[];
  durationTarget?: number;
  tone?: string;
  style?: string;
  language?: string;
  brandProfileId?: string;
  sourceArtifactIds?: string[];
  assetIds?: string[];
  complianceConstraints?: string[];
  voiceover?: boolean;
  musicAssetId?: string;
}

export interface VideoBrief extends Required<Pick<VideoBriefInput, 'title' | 'objective'>> {
  id: string;
  ownerId: string;
  audience: string;
  product: string;
  cta: string;
  platformTargets: VideoPlatformTarget[];
  durationTarget: number;
  tone: string;
  style: string;
  language: string;
  brandProfileId?: string;
  sourceArtifactIds: string[];
  assetIds: string[];
  complianceConstraints: string[];
  voiceover: boolean;
  musicAssetId?: string;
  createdAt: string;
}

export interface SceneAssetRequirement {
  id: string;
  source: SceneAssetSource;
  purpose: string;
  assetId?: string;
  artifactId?: string;
  required: boolean;
}

export interface StoryboardScene {
  id: string;
  template: VideoSceneTemplate;
  duration: number;
  headline: string;
  body?: string;
  supportingText?: string[];
  metric?: { value: string; label: string };
  quote?: { text: string; attribution?: string };
  assetRequirements: SceneAssetRequirement[];
  narration?: string;
}

export interface Storyboard {
  id: string;
  briefId: string;
  hook: string;
  scenes: StoryboardScene[];
  totalDuration: number;
  createdAt: string;
}

export interface AudioPlan {
  voiceover: { enabled: boolean; voice?: string; language: string; segments: Array<{ sceneId: string; text: string }> };
  music?: { assetId: string; volume: number };
}

export interface VideoVariantPlan {
  id: string;
  format: Exclude<VideoFormat, 'CUSTOM'>;
  width: number;
  height: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
  platforms: VideoPlatformTarget[];
  layoutProfile: 'VERTICAL' | 'SQUARE' | 'HORIZONTAL';
}

export interface VideoDirectorPlan {
  id: string;
  ownerId: string;
  brief: VideoBrief;
  storyboard: Storyboard;
  audioPlan: AudioPlan;
  variants: VideoVariantPlan[];
  idempotencyKey: string;
  createdAt: string;
}

export interface VideoDirectorRun {
  id: string;
  ownerId: string;
  planId: string;
  status: 'PLANNED' | 'VALIDATED' | 'READY' | 'RENDERING' | 'COMPLETE' | 'FAILED';
  projects: Array<{ variantId: string; videoProjectId: string; renderId?: string; previewUrl?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface VideoDirectorReceipt {
  runId: string;
  planId: string;
  status: VideoDirectorRun['status'];
  projects: VideoDirectorRun['projects'];
  createdAt: string;
}
