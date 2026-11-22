import type { VideoBriefInput, Storyboard } from './types.js';

export const VIDEO_DIRECTOR_LIMITS = {
  maxScenes: 20,
  maxDuration: 180,
  maxBriefBytes: 64_000,
  maxText: 500,
  maxAssets: 40,
  maxArtifacts: 40,
} as const;

const unsafeControl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const pathLike = /(?:^|[\s"'])\.{0,2}[\\/]|(?:^|[\s"'])[A-Za-z]:[\\/]|file:\/\/|\\\\[^\s]+|\/etc\/|\/proc\/|\/var\/|\/home\//i;
const commandLike = /(?:^|\s)(?:python(?:3)?|bash|sh|powershell|cmd|ffmpeg)\s+[-/]|(?:;|&&|\|\|)\s*(?:python|bash|sh|ffmpeg|curl|wget)\b/i;
const urlLike = /(?:https?|ftp|file):\/\//i;

export function sanitizeDirectorText(value: unknown, field = 'text', max: number = VIDEO_DIRECTOR_LIMITS.maxText): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length > max) throw new Error(`${field} exceeds length limit`);
  if (unsafeControl.test(text)) throw new Error(`${field} contains unsafe control characters`);
  if (pathLike.test(text)) throw new Error(`${field} contains a filesystem path`);
  if (commandLike.test(text)) throw new Error(`${field} contains an unsafe command-like string`);
  return text;
}

export function assertOpaqueId(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)) throw new Error(`${field} must be an opaque resource id`);
  if (urlLike.test(value) || pathLike.test(value)) throw new Error(`${field} must not contain a URL or path`);
  return value;
}

export function validateBriefInput(input: VideoBriefInput): void {
  if (!input || JSON.stringify(input).length > VIDEO_DIRECTOR_LIMITS.maxBriefBytes) throw new Error('Video brief exceeds size limit');
  sanitizeDirectorText(input.title, 'title', 160);
  sanitizeDirectorText(input.objective, 'objective');
  if (input.audience) sanitizeDirectorText(input.audience, 'audience');
  if (input.product) sanitizeDirectorText(input.product, 'product');
  if (input.cta) sanitizeDirectorText(input.cta, 'cta', 160);
  if (input.tone) sanitizeDirectorText(input.tone, 'tone', 120);
  if (input.style) sanitizeDirectorText(input.style, 'style', 160);
  if (input.language && !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(input.language)) throw new Error('Invalid language');
  const duration = input.durationTarget ?? 30;
  if (!Number.isFinite(duration) || duration < 5 || duration > VIDEO_DIRECTOR_LIMITS.maxDuration) throw new Error('Duration target must be between 5 and 180 seconds');
  if ((input.assetIds?.length ?? 0) > VIDEO_DIRECTOR_LIMITS.maxAssets) throw new Error('Too many asset references');
  if ((input.sourceArtifactIds?.length ?? 0) > VIDEO_DIRECTOR_LIMITS.maxArtifacts) throw new Error('Too many artifact references');
  for (const id of input.assetIds ?? []) assertOpaqueId(id, 'assetId');
  for (const id of input.sourceArtifactIds ?? []) assertOpaqueId(id, 'artifactId');
  if (input.musicAssetId) assertOpaqueId(input.musicAssetId, 'musicAssetId');
  if (input.brandProfileId) assertOpaqueId(input.brandProfileId, 'brandProfileId');
  for (const value of input.complianceConstraints ?? []) sanitizeDirectorText(value, 'complianceConstraint', 300);
}

export function validateStoryboard(storyboard: Storyboard): void {
  if (storyboard.scenes.length < 1 || storyboard.scenes.length > VIDEO_DIRECTOR_LIMITS.maxScenes) throw new Error('Storyboard scene count is outside safe bounds');
  const duration = storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0);
  if (duration <= 0 || duration > VIDEO_DIRECTOR_LIMITS.maxDuration) throw new Error('Storyboard duration is outside safe bounds');
  for (const scene of storyboard.scenes) {
    if (!Number.isFinite(scene.duration) || scene.duration < 1 || scene.duration > 30) throw new Error('Storyboard scene duration is outside safe bounds');
    sanitizeDirectorText(scene.headline, 'scene.headline', 220);
    if (scene.body) sanitizeDirectorText(scene.body, 'scene.body', 500);
    if (scene.narration) sanitizeDirectorText(scene.narration, 'scene.narration', 800);
    for (const asset of scene.assetRequirements) if (asset.assetId) assertOpaqueId(asset.assetId, 'scene.assetId');
  }
}
