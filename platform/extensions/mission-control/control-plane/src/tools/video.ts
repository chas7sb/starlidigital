/**
 * Video Studio MCP Tools Registry
 * ===============================
 * Exposes production-grade video orchestration primitives to ChatGPT and external AI agents.
 * Enables asset ingestion, declarative timeline composition, preview generation,
 * rendering, and multi-tenant security verification.
 */

import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';
import { VideoServices } from '../../../server/src/video/service.js';
import { importMediaFromUrl } from '../../../server/src/video/ingest.js';
import { AssetServices } from '../../../server/src/assets/service.js';

export function registerVideoTools(ctx: ToolContext) {
  const { server, principal, store, events, auditCall } = ctx;

  const isAdmin = principal.role === 'admin';
  const hasRead = hasScope(principal, 'read');
  const hasWrite = hasScope(principal, 'write');

  const actor = {
    id: principal.id,
    role: isAdmin ? 'ADMIN' : 'USER',
  };

  // Resolve or initialize AssetServices and VideoServices
  const assetServices = ctx.assetServices || (store && events ? new AssetServices({ store, events }) : undefined);
  const videoServices =
    (ctx as any).videoServices ||
    (store && events && assetServices ? new VideoServices({ store, events, assetServices }) : undefined);

  // 1. video_project_create
  server.tool(
    'video_project_create',
    'Create a new Starli video project with canvas format and brand identity for AI programmatic production. (Write)',
    {
      title: z.string().describe('Title of the video project'),
      format: z.enum(['VERTICAL_9_16', 'SQUARE_1_1', 'HORIZONTAL_16_9', 'CUSTOM']).optional().default('VERTICAL_9_16').describe('Aspect ratio and canvas format'),
      purpose: z.string().optional().describe('Brief description or campaign goal'),
      brandProfileId: z.string().optional().describe('Associated brand profile ID (e.g. bprof-starlidigital-default)'),
      spec: z.record(z.unknown()).optional().describe('Optional initial declarative VideoSpec composition'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasWrite) {
        auditCall('video_project_create', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const project = videoServices.createProject(actor, {
          title: args.title,
          format: args.format,
          purpose: args.purpose,
          brandProfileId: args.brandProfileId,
          spec: args.spec,
        });

        auditCall('video_project_create', project.id, start, 'SUCCESS', args);
        return jsonResponse({
          status: 'CREATED',
          project: {
            id: project.id,
            title: project.title,
            format: project.format,
            width: project.width,
            height: project.height,
            fps: project.fps,
            duration: project.duration,
            status: project.status,
            createdAt: project.createdAt,
          },
        });
      } catch (err: any) {
        auditCall('video_project_create', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to create video project: ${err.message}`);
      }
    }
  );

  // 2. video_project_get
  server.tool(
    'video_project_get',
    'Retrieve video project metadata and complete declarative VideoSpec composition. (Read)',
    {
      projectId: z.string().describe('The video project ID (vproj-...)'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasRead) {
        auditCall('video_project_get', args.projectId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const project = videoServices.getProject(args.projectId, actor);
        if (!project) return errorResponse(`Video project ${args.projectId} not found`, 'NOT_FOUND');

        auditCall('video_project_get', project.id, start, 'SUCCESS', args);
        return jsonResponse({ project });
      } catch (err: any) {
        auditCall('video_project_get', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(err.message);
      }
    }
  );

  // 3. video_project_list
  server.tool(
    'video_project_list',
    'List all video projects owned by the caller or workspace. (Read)',
    {
      limit: z.number().int().min(1).max(100).optional().default(20).describe('Max projects to return'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasRead) {
        auditCall('video_project_list', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const all = videoServices.listProjects({}, actor);
        const paged = all.slice(0, args.limit || 20).map((p: any) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          format: p.format,
          width: p.width,
          height: p.height,
          duration: p.duration,
          updatedAt: p.updatedAt,
        }));

        auditCall('video_project_list', undefined, start, 'SUCCESS', args, { count: paged.length });
        return jsonResponse({ total: all.length, projects: paged });
      } catch (err: any) {
        auditCall('video_project_list', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(err.message);
      }
    }
  );

  // 4. video_project_apply_spec
  server.tool(
    'video_project_apply_spec',
    'Set or replace the entire declarative composition VideoSpec (canvas, scenes, layers, animations, audio). (Write)',
    {
      projectId: z.string().describe('The video project ID (vproj-...)'),
      spec: z.record(z.unknown()).describe('The complete declarative VideoSpec object'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasWrite) {
        auditCall('video_project_apply_spec', args.projectId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const updated = videoServices.applySpec(args.projectId, args.spec, actor);
        auditCall('video_project_apply_spec', args.projectId, start, 'SUCCESS', args);
        return jsonResponse({
          status: 'SPEC_APPLIED',
          projectId: updated.id,
          duration: updated.duration,
          scenesCount: updated.spec?.scenes?.length || 0,
        });
      } catch (err: any) {
        auditCall('video_project_apply_spec', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(err.message);
      }
    }
  );

  // 5. video_project_patch_spec
  server.tool(
    'video_project_patch_spec',
    'Perform safe partial updates to an existing project VideoSpec (e.g. adjust scene duration, tweak a layer, update brand). (Write)',
    {
      projectId: z.string().describe('The video project ID (vproj-...)'),
      patch: z.record(z.unknown()).describe('Partial spec changes to merge'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasWrite) {
        auditCall('video_project_patch_spec', args.projectId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const updated = videoServices.patchSpec(args.projectId, args.patch, actor);
        auditCall('video_project_patch_spec', args.projectId, start, 'SUCCESS', args);
        return jsonResponse({
          status: 'SPEC_PATCHED',
          projectId: updated.id,
          duration: updated.duration,
        });
      } catch (err: any) {
        auditCall('video_project_patch_spec', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(err.message);
      }
    }
  );

  // 6. video_asset_upload
  server.tool(
    'video_asset_upload',
    'Upload a base64-encoded image or media file to StarliDigital for inclusion in a video scene. (Write)',
    {
      base64Data: z.string().describe('Base64 encoded file data (with or without data URI prefix)'),
      mimeType: z.string().describe('MIME type: image/png, image/jpeg, or image/webp'),
      filenameHint: z.string().optional().describe('Filename hint, e.g. "hero_artwork.png"'),
      altText: z.string().optional().describe('Description of the visual artwork'),
      projectId: z.string().optional().describe('Optional video project ID to associate with'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasWrite) {
        auditCall('video_asset_upload', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!assetServices) return errorResponse('Asset services unavailable on server context');

      try {
        const cleanBase64 = args.base64Data.replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        const result = await assetServices.ingestImage({
          buffer,
          mimeType: args.mimeType,
          filenameHint: args.filenameHint,
          altText: args.altText,
          visibility: 'PRIVATE',
          ownerId: actor.id,
          projectId: args.projectId,
        });

        auditCall('video_asset_upload', result.assetId, start, 'SUCCESS', args);
        return jsonResponse({
          status: 'UPLOADED',
          assetId: result.assetId,
          sha256: result.sha256,
          mimeType: result.mimeType,
          byteSize: result.byteSize,
          url: result.url,
        });
      } catch (err: any) {
        auditCall('video_asset_upload', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Asset upload failed: ${err.message}`);
      }
    }
  );

  // 7. video_asset_import
  server.tool(
    'video_asset_import',
    'Securely import an AI-generated image from an authorized external URL into StarliDigital with SSRF protection and verification. (Write)',
    {
      url: z.string().url().describe('Direct HTTP or HTTPS URL to the generated image file'),
      filenameHint: z.string().optional().describe('Suggested filename hint'),
      altText: z.string().optional().describe('Description of the asset'),
      projectId: z.string().optional().describe('Associated video project ID'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasWrite) {
        auditCall('video_asset_import', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!assetServices) return errorResponse('Asset services unavailable on server context');

      try {
        const result = await importMediaFromUrl({
          url: args.url,
          assetServices,
          ownerId: actor.id,
          projectId: args.projectId,
          filenameHint: args.filenameHint,
          altText: args.altText,
        });

        auditCall('video_asset_import', result.assetId, start, 'SUCCESS', args);
        return jsonResponse({
          status: 'IMPORTED',
          assetId: result.assetId,
          sha256: result.sha256,
          mimeType: result.mimeType,
          byteSize: result.byteSize,
          url: result.url,
        });
      } catch (err: any) {
        auditCall('video_asset_import', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Asset import failed: ${err.message}`);
      }
    }
  );

  // 8. video_voiceover_create
  server.tool(
    'video_voiceover_create',
    'Synthesize neural Romanian or English speech for timeline placement. Returns audio asset ID and preview URL. (Write)',
    {
      text: z.string().min(1).max(2000).describe('Voiceover speech text (supports Romanian diacritics)'),
      voice: z.string().optional().default('ro-RO-AlinaNeural').describe('Neural TTS voice (e.g. ro-RO-AlinaNeural for Starli AI, ro-RO-EmilNeural, en-US-JennyNeural)'),
      language: z.string().optional().default('ro').describe('Language code'),
      projectId: z.string().optional().describe('Associated video project ID'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasWrite) {
        auditCall('video_voiceover_create', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const result = await videoServices.synthesizeVoiceover(actor, args);
        auditCall('video_voiceover_create', result.assetId, start, 'SUCCESS', args);
        return jsonResponse({
          status: 'SYNTHESIZED',
          assetId: result.assetId,
          url: result.url,
          durationEstimate: result.durationEstimate,
        });
      } catch (err: any) {
        auditCall('video_voiceover_create', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Voiceover synthesis failed: ${err.message}`);
      }
    }
  );

  // 9. video_validate
  server.tool(
    'video_validate',
    'Validate a video composition against schema, timing, bounds, and asset availability before rendering. (Read)',
    {
      projectId: z.string().optional().describe('Project ID to validate'),
      spec: z.record(z.unknown()).optional().describe('Raw spec object to validate directly'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasRead) {
        auditCall('video_validate', args.projectId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        let specToValidate = args.spec;
        if (!specToValidate && args.projectId) {
          const project = videoServices.getProject(args.projectId, actor);
          if (!project) return errorResponse(`Project ${args.projectId} not found`, 'NOT_FOUND');
          specToValidate = project.spec;
        }

        if (!specToValidate) return errorResponse('Must provide either projectId or spec');

        const result = await videoServices.validateSpec(specToValidate);
        auditCall('video_validate', args.projectId, start, 'SUCCESS', args);
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('video_validate', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Validation error: ${err.message}`);
      }
    }
  );

  // 10. video_preview_frame
  server.tool(
    'video_preview_frame',
    'Render a high-resolution preview frame at a specific timestamp for inspection before committing to full render. (Read)',
    {
      projectId: z.string().describe('The video project ID (vproj-...)'),
      timestamp: z.number().min(0).describe('Timestamp in seconds to capture'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasRead) {
        auditCall('video_preview_frame', args.projectId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const preview = await videoServices.generatePreviewFrame(args.projectId, args.timestamp, actor);
        auditCall('video_preview_frame', args.projectId, start, 'SUCCESS', args);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  status: 'SUCCESS',
                  projectId: args.projectId,
                  timestamp: args.timestamp,
                  url: preview.url,
                  byteSize: preview.buffer.length,
                },
                null,
                2
              ),
            },
            {
              type: 'image' as const,
              data: preview.buffer.toString('base64'),
              mimeType: 'image/png',
            },
          ],
        };
      } catch (err: any) {
        auditCall('video_preview_frame', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Preview frame generation failed: ${err.message}`);
      }
    }
  );

  // 11. video_render_start
  server.tool(
    'video_render_start',
    'Enqueue asynchronous background MP4 video rendering for a validated project composition. (Write)',
    {
      projectId: z.string().describe('The video project ID (vproj-...)'),
      thumbnailTimestamp: z.number().optional().describe('Timestamp in seconds for the social poster thumbnail'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasWrite) {
        auditCall('video_render_start', args.projectId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const render = videoServices.startRender(args.projectId, actor, {
          thumbnailTimestamp: args.thumbnailTimestamp,
        });
        auditCall('video_render_start', render.id, start, 'SUCCESS', args);

        return jsonResponse({
          status: 'QUEUED',
          renderId: render.id,
          projectId: render.videoProjectId,
          duration: render.duration,
          width: render.width,
          height: render.height,
          fps: render.fps,
        });
      } catch (err: any) {
        auditCall('video_render_start', args.projectId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to start render: ${err.message}`);
      }
    }
  );

  // 12. video_render_status
  server.tool(
    'video_render_status',
    'Check progress, current stage, and error details of an ongoing or completed render. (Read)',
    {
      renderId: z.string().describe('The unique render ID (vrnd-...)'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasRead) {
        auditCall('video_render_status', args.renderId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const render = videoServices.getRender(args.renderId, actor);
        if (!render) return errorResponse(`Render ${args.renderId} not found`, 'NOT_FOUND');

        auditCall('video_render_status', render.id, start, 'SUCCESS', args);
        return jsonResponse({
          renderId: render.id,
          projectId: render.videoProjectId,
          status: render.status,
          progress: render.progress,
          stage: render.stage,
          outputUrl: render.outputUrl,
          thumbnailUrl: render.thumbnailUrl,
          fileSize: render.fileSize,
          error: render.error,
          startedAt: render.startedAt,
          completedAt: render.completedAt,
        });
      } catch (err: any) {
        auditCall('video_render_status', args.renderId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(err.message);
      }
    }
  );

  // 13. video_output_get
  server.tool(
    'video_output_get',
    'Retrieve the finished video MP4 artifact reference, public URL, thumbnail, and media metadata. (Read)',
    {
      renderId: z.string().describe('The completed render ID (vrnd-...)'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasRead) {
        auditCall('video_output_get', args.renderId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const render = videoServices.getRender(args.renderId, actor);
        if (!render) return errorResponse(`Render ${args.renderId} not found`, 'NOT_FOUND');
        if (render.status !== 'COMPLETE') {
          return errorResponse(`Render ${args.renderId} has not completed yet (current status: ${render.status})`);
        }

        auditCall('video_output_get', render.id, start, 'SUCCESS', args);
        return jsonResponse({
          renderId: render.id,
          projectId: render.videoProjectId,
          status: 'COMPLETE',
          outputUrl: render.outputUrl,
          thumbnailUrl: render.thumbnailUrl,
          duration: render.duration,
          width: render.width,
          height: render.height,
          fps: render.fps,
          fileSizeBytes: render.fileSize,
          completedAt: render.completedAt,
        });
      } catch (err: any) {
        auditCall('video_output_get', args.renderId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(err.message);
      }
    }
  );

  // 14. brand_profile_create
  server.tool(
    'brand_profile_create',
    'Create a brand profile defining colors, fonts, voice, and design tokens for customer video creation. (Write)',
    {
      businessName: z.string().describe('Company or brand name'),
      primaryColor: z.string().optional().default('#080C12').describe('Primary background color hex'),
      secondaryColor: z.string().optional().default('#10151D').describe('Surface card color hex'),
      accentColor: z.string().optional().default('#C6DBF0').describe('Accent highlight color hex'),
      textColor: z.string().optional().default('#F4F6FA').describe('Main text color hex'),
      tagline: z.string().optional().default('Leading Digital Innovation').describe('Brand tagline'),
      website: z.string().optional().default('starlidigital.ro').describe('Website domain'),
      ctaText: z.string().optional().default('Build with Starli').describe('Default CTA button text'),
      voicePreference: z.string().optional().default('ro-RO-AlinaNeural').describe('Preferred neural TTS voice'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasWrite) {
        auditCall('brand_profile_create', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires write scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const profile = videoServices.createBrandProfile(actor, args);
        auditCall('brand_profile_create', profile.id, start, 'SUCCESS', args);
        return jsonResponse({
          status: 'CREATED',
          brandProfile: profile,
        });
      } catch (err: any) {
        auditCall('brand_profile_create', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(err.message);
      }
    }
  );

  // 15. brand_profile_get
  server.tool(
    'brand_profile_get',
    'Get brand profile details, color palette, and styling rules. (Read)',
    {
      profileId: z.string().describe('Brand profile ID (bprof-...)'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasRead) {
        auditCall('brand_profile_get', args.profileId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }
      if (!videoServices) return errorResponse('Video services unavailable on server context');

      try {
        const profile = videoServices.getBrandProfile(args.profileId, actor);
        if (!profile) return errorResponse(`Brand profile ${args.profileId} not found`, 'NOT_FOUND');

        auditCall('brand_profile_get', profile.id, start, 'SUCCESS', args);
        return jsonResponse({ brandProfile: profile });
      } catch (err: any) {
        auditCall('brand_profile_get', args.profileId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(err.message);
      }
    }
  );
}
