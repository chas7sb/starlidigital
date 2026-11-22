/**
 * Video Studio GraphQL Schema & Resolvers
 * =======================================
 */

import { requireUser, type Context } from '../security.js';
import type { VideoServices } from './service.js';

export const videoTypeDefs = /* GraphQL */ `
  enum VideoFormat {
    VERTICAL_9_16
    SQUARE_1_1
    HORIZONTAL_16_9
    CUSTOM
  }

  enum VideoProjectStatus {
    DRAFT
    READY
    RENDERING
    COMPLETE
    FAILED
    ARCHIVED
  }

  enum VideoRenderStatus {
    QUEUED
    VALIDATING
    PREPARING_VOICEOVERS
    MIXING_AUDIO
    RENDERING_FRAMES
    ENCODING
    COMPLETE
    FAILED
    CANCELLED
  }

  type BrandProfile {
    id: ID!
    ownerId: String!
    businessName: String!
    primaryColor: String!
    secondaryColor: String!
    accentColor: String!
    textColor: String!
    silverColor: String!
    tagline: String!
    website: String!
    ctaText: String!
    ctaUrl: String
    voicePreference: String!
    language: String!
    createdAt: String!
    updatedAt: String!
  }

  type VideoRender {
    id: ID!
    videoProjectId: ID!
    ownerId: String!
    status: VideoRenderStatus!
    progress: Float!
    stage: String!
    outputUrl: String
    thumbnailUrl: String
    duration: Float!
    width: Int!
    height: Int!
    fps: Int!
    fileSize: Int
    error: String
    completedAt: String
    createdAt: String!
    updatedAt: String!
  }

  type VideoProject {
    id: ID!
    ownerId: String!
    title: String!
    slug: String!
    purpose: String
    status: VideoProjectStatus!
    format: VideoFormat!
    width: Int!
    height: Int!
    fps: Int!
    duration: Float!
    specJson: String!
    brandProfileId: String
    renders: [VideoRender!]!
    createdAt: String!
    updatedAt: String!
  }

  type VideoPreviewResult {
    dataUrl: String!
    url: String!
  }

  type VoiceoverResult {
    assetId: ID!
    url: String!
    durationEstimate: Float!
  }

  type SpecValidationResult {
    valid: Boolean!
    errorsJson: String!
    duration: Float
  }

  extend type Query {
    videoProjects: [VideoProject!]!
    videoProject(id: ID!): VideoProject
    videoRenders(projectId: ID!): [VideoRender!]!
    videoRender(id: ID!): VideoRender
    brandProfiles: [BrandProfile!]!
    brandProfile(id: ID!): BrandProfile
    videoPreviewFrame(projectId: ID!, timestamp: Float!): VideoPreviewResult!
    validateVideoSpec(specJson: String!): SpecValidationResult!
  }

  extend type Mutation {
    createVideoProject(
      title: String!
      format: VideoFormat
      purpose: String
      brandProfileId: ID
      specJson: String
    ): VideoProject!

    applyVideoSpec(projectId: ID!, specJson: String!): VideoProject!

    patchVideoSpec(projectId: ID!, patchJson: String!): VideoProject!

    deleteVideoProject(projectId: ID!): Boolean!

    startVideoRender(projectId: ID!, thumbnailTimestamp: Float): VideoRender!

    cancelVideoRender(renderId: ID!): VideoRender!

    createBrandProfile(
      businessName: String!
      primaryColor: String
      secondaryColor: String
      accentColor: String
      textColor: String
      website: String
      ctaText: String
      tagline: String
    ): BrandProfile!

    synthesizeVoiceover(
      text: String!
      voice: String
      language: String
      projectId: ID
    ): VoiceoverResult!
  }

  extend type Subscription {
    videoProjectsUpdated: [VideoProject!]!
    videoRendersUpdated(projectId: ID!): [VideoRender!]!
  }
`;

export function createVideoResolvers(videoServices: VideoServices) {
  return {
    VideoProject: {
      specJson: (project: any) => JSON.stringify(project.spec || {}),
      renders: (project: any, _: any, ctx: Context) => {
        const actor = { id: ctx.user?.id || 'guest', role: ctx.user?.role };
        return videoServices.listRenders(project.id, actor);
      },
    },
    Query: {
      videoProjects: (_: any, __: any, ctx: Context) => {
        const actor = { id: ctx.user?.id || 'guest', role: ctx.user?.role };
        return videoServices.listProjects({}, actor);
      },
      videoProject: (_: any, args: { id: string }, ctx: Context) => {
        const actor = { id: ctx.user?.id || 'guest', role: ctx.user?.role };
        return videoServices.getProject(args.id, actor);
      },
      videoRenders: (_: any, args: { projectId: string }, ctx: Context) => {
        const actor = { id: ctx.user?.id || 'guest', role: ctx.user?.role };
        return videoServices.listRenders(args.projectId, actor);
      },
      videoRender: (_: any, args: { id: string }, ctx: Context) => {
        const actor = { id: ctx.user?.id || 'guest', role: ctx.user?.role };
        return videoServices.getRender(args.id, actor);
      },
      brandProfiles: (_: any, __: any, ctx: Context) => {
        const actor = { id: ctx.user?.id || 'guest', role: ctx.user?.role };
        return videoServices.listBrandProfiles(actor);
      },
      brandProfile: (_: any, args: { id: string }, ctx: Context) => {
        const actor = { id: ctx.user?.id || 'guest', role: ctx.user?.role };
        return videoServices.getBrandProfile(args.id, actor);
      },
      videoPreviewFrame: async (_: any, args: { projectId: string; timestamp: number }, ctx: Context) => {
        const actor = { id: ctx.user?.id || 'guest', role: ctx.user?.role };
        return await videoServices.generatePreviewFrame(args.projectId, args.timestamp, actor);
      },
      validateVideoSpec: async (_: any, args: { specJson: string }, ctx: Context) => {
        requireUser(ctx);
        let parsed: any;
        try {
          parsed = JSON.parse(args.specJson);
        } catch (e: any) {
          return { valid: false, errorsJson: JSON.stringify([{ path: 'spec', code: 'JSON_ERROR', message: e.message }]) };
        }
        const res = await videoServices.validateSpec(parsed);
        return {
          valid: res.valid,
          errorsJson: JSON.stringify(res.errors || []),
          duration: res.duration,
        };
      },
    },
    Mutation: {
      createVideoProject: (_: any, args: any, ctx: Context) => {
        const user = requireUser(ctx);
        const spec = args.specJson ? JSON.parse(args.specJson) : undefined;
        return videoServices.createProject(user, {
          title: args.title,
          format: args.format,
          purpose: args.purpose,
          brandProfileId: args.brandProfileId,
          spec,
        });
      },
      applyVideoSpec: (_: any, args: { projectId: string; specJson: string }, ctx: Context) => {
        const user = requireUser(ctx);
        const spec = JSON.parse(args.specJson);
        return videoServices.applySpec(args.projectId, spec, user);
      },
      patchVideoSpec: (_: any, args: { projectId: string; patchJson: string }, ctx: Context) => {
        const user = requireUser(ctx);
        const patch = JSON.parse(args.patchJson);
        return videoServices.patchSpec(args.projectId, patch, user);
      },
      deleteVideoProject: (_: any, args: { projectId: string }, ctx: Context) => {
        const user = requireUser(ctx);
        videoServices.deleteProject(args.projectId, user);
        return true;
      },
      startVideoRender: (_: any, args: { projectId: string; thumbnailTimestamp?: number }, ctx: Context) => {
        const user = requireUser(ctx);
        return videoServices.startRender(args.projectId, user, { thumbnailTimestamp: args.thumbnailTimestamp });
      },
      cancelVideoRender: (_: any, args: { renderId: string }, ctx: Context) => {
        const user = requireUser(ctx);
        return videoServices.cancelRender(args.renderId, user);
      },
      createBrandProfile: (_: any, args: any, ctx: Context) => {
        const user = requireUser(ctx);
        return videoServices.createBrandProfile(user, args);
      },
      synthesizeVoiceover: async (_: any, args: any, ctx: Context) => {
        const user = requireUser(ctx);
        return await videoServices.synthesizeVoiceover(user, args);
      },
    },
    Subscription: {
      videoProjectsUpdated: {
        subscribe: (_: any, __: any, ctx: Context) => {
          requireUser(ctx);
          return videoServices.events.iterator('video-projects');
        },
        resolve: (_: any, __: any, ctx: Context) => videoServices.listProjects({}, requireUser(ctx)),
      },
      videoRendersUpdated: {
        subscribe: (_: any, { projectId }: any, ctx: Context) => {
          requireUser(ctx);
          return videoServices.events.iterator('video-renders');
        },
        resolve: (_: any, { projectId }: any, ctx: Context) => videoServices.listRenders(projectId, requireUser(ctx)),
      },
    },
  };
}

export function createVideoGraphQL(options: { services: VideoServices }) {
  return {
    typeDefs: videoTypeDefs,
    resolvers: createVideoResolvers(options.services),
  };
}
