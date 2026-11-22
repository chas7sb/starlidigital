import { resolveVideoSpecAssets } from './assets.js';
/**
 * Video Studio Services & Domain Business Logic
 * =============================================
 * Manages video projects, brand profiles, render lifecycles, preview generation,
 * and safe multi-tenant access controls.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Store } from '../store.js';
import type { Events } from '../events.js';
import type { AssetServices } from '../assets/service.js';
import type {
  ActorContext,
  BrandProfileRecord,
  VideoFormat,
  VideoProjectRecord,
  VideoRenderRecord,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const execFileAsync = promisify(execFile);
let videoSubprocesses = 0;

export class VideoServices {
  private store: Store;
  public readonly events: Events;
  private assetServices: AssetServices;
  private pythonExe: string;
  private engineDir: string;
  private storageDir: string;

  constructor(options: {
    store: Store;
    events: Events;
    assetServices: AssetServices;
    storageDir?: string;
  }) {
    this.store = options.store;
    this.events = options.events;
    this.assetServices = options.assetServices;
    this.pythonExe = process.env.PYTHON_BIN || (process.platform === 'win32' ? (fs.existsSync('C:\\Python314\\python.exe') ? 'C:\\Python314\\python.exe' : 'python.exe') : 'python');
    this.engineDir = path.resolve(REPO_ROOT, 'video-engine');
    this.storageDir = options.storageDir || process.env.VIDEO_STORAGE_DIR || path.resolve(process.cwd(), 'data', 'video');

    try {
      fs.mkdirSync(path.join(this.storageDir, 'previews'), { recursive: true });
      fs.mkdirSync(path.join(this.storageDir, 'renders'), { recursive: true });
    } catch {}

    // Ensure default StarliDigital brand profile exists
    this.ensureDefaultBrandProfile();
  }

  private ensureDefaultBrandProfile(): void {
    const defaultId = 'bprof-starlidigital-default';
    const existing = this.store.get('brand-profiles', defaultId);
    if (!existing) {
      const starliBrand: BrandProfileRecord = {
        id: defaultId,
        ownerId: 'system',
        businessName: 'StarliDigital',
        primaryColor: '#080C12',
        secondaryColor: '#10151D',
        accentColor: '#C6DBF0',
        textColor: '#F4F6FA',
        silverColor: '#A8B0BD',
        onlineColor: '#ACDBBF',
        fontHeading: 'semibold',
        fontBody: 'regular',
        visualStyle: 'Obsidian Minimalist & Polar Ice Bloom',
        tagline: 'Agenția Digitală Condusă de Starli AI',
        website: 'starlidigital.ro',
        ctaText: 'Construiește cu Starli',
        ctaUrl: 'https://starlidigital.ro',
        voicePreference: 'ro-RO-AlinaNeural',
        language: 'ro',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.store.put('brand-profiles', starliBrand);
    }
  }

  private assertOwnerOrAdmin(ownerId: string, actor: ActorContext, resourceName = 'Resource'): void {
    const isAdmin = actor.role === 'ADMIN' || actor.role === 'admin';
    const isOwner = Boolean(actor.id && ownerId === actor.id);
    if (!isAdmin && !isOwner) {
      throw new Error(`Access denied: you do not have permission to access this ${resourceName}`);
    }
  }

  // =========================================================================
  // BRAND PROFILES
  // =========================================================================

  public createBrandProfile(actor: ActorContext, input: Partial<BrandProfileRecord>): BrandProfileRecord {
    const profileId = 'bprof-' + randomUUID();
    const now = new Date().toISOString();

    const record: BrandProfileRecord = {
      id: profileId,
      ownerId: actor.id,
      businessName: input.businessName || 'My Brand',
      logoAssetId: input.logoAssetId,
      symbolAssetId: input.symbolAssetId,
      primaryColor: input.primaryColor || '#080C12',
      secondaryColor: input.secondaryColor || '#10151D',
      accentColor: input.accentColor || '#C6DBF0',
      textColor: input.textColor || '#F4F6FA',
      silverColor: input.silverColor || '#A8B0BD',
      onlineColor: input.onlineColor || '#ACDBBF',
      fontHeading: input.fontHeading || 'semibold',
      fontBody: input.fontBody || 'regular',
      visualStyle: input.visualStyle || 'Modern Minimalist',
      tagline: input.tagline || 'Leading Digital Innovation',
      website: input.website || 'example.com',
      ctaText: input.ctaText || 'Learn More',
      ctaUrl: input.ctaUrl,
      socialHandles: input.socialHandles || {},
      voicePreference: input.voicePreference || 'ro-RO-AlinaNeural',
      language: input.language || 'en',
      createdAt: now,
      updatedAt: now,
    };

    this.store.put('brand-profiles', record);
    this.events.publish('brand-profiles');
    return record;
  }

  public getBrandProfile(profileId: string, actor?: ActorContext): BrandProfileRecord | undefined {
    const profile = this.store.get('brand-profiles', profileId) as BrandProfileRecord | undefined;
    if (!profile) return undefined;
    if (profile.ownerId !== 'system' && actor) {
      this.assertOwnerOrAdmin(profile.ownerId, actor, 'brand profile');
    }
    return profile;
  }

  public listBrandProfiles(actor: ActorContext): BrandProfileRecord[] {
    const all = (this.store.list('brand-profiles') as BrandProfileRecord[]) || [];
    const isAdmin = actor.role === 'ADMIN' || actor.role === 'admin';
    return all.filter((p) => p.ownerId === 'system' || isAdmin || p.ownerId === actor.id);
  }

  public updateBrandProfile(profileId: string, input: Partial<BrandProfileRecord>, actor: ActorContext): BrandProfileRecord {
    const existing = this.getBrandProfile(profileId, actor);
    if (!existing) throw new Error(`Brand profile ${profileId} not found`);
    this.assertOwnerOrAdmin(existing.ownerId, actor, 'brand profile');

    const updated: BrandProfileRecord = {
      ...existing,
      ...input,
      id: existing.id,
      ownerId: existing.ownerId,
      updatedAt: new Date().toISOString(),
    };
    this.store.put('brand-profiles', updated);
    this.events.publish('brand-profiles');
    return updated;
  }

  // =========================================================================
  // VIDEO PROJECTS
  // =========================================================================

  public createProject(
    actor: ActorContext,
    input: {
      title: string;
      format?: VideoFormat;
      purpose?: string;
      brandProfileId?: string;
      spec?: any;
    }
  ): VideoProjectRecord {
    const projectId = 'vproj-' + randomUUID();
    const format = input.format || 'VERTICAL_9_16';
    let width = 1080;
    let height = 1920;

    if (format === 'SQUARE_1_1') {
      width = 1080;
      height = 1080;
    } else if (format === 'HORIZONTAL_16_9') {
      width = 1920;
      height = 1080;
    }

    const brand = this.getBrandProfile(input.brandProfileId || 'bprof-starlidigital-default', actor);

    // Initial default spec
    const defaultSpec = input.spec || {
      version: '1.0',
      title: input.title,
      canvas: { width, height, fps: 30, backgroundColor: brand?.primaryColor || '#080C12' },
      brand: {
        businessName: brand?.businessName || 'StarliDigital',
        primaryColor: brand?.primaryColor || '#080C12',
        secondaryColor: brand?.secondaryColor || '#10151D',
        accentColor: brand?.accentColor || '#C6DBF0',
        textColor: brand?.textColor || '#F4F6FA',
        silverColor: brand?.silverColor || '#A8B0BD',
        website: brand?.website || 'starlidigital.ro',
        tagline: brand?.tagline || 'Agenția Digitală Condusă de Starli AI',
        ctaText: brand?.ctaText || 'Construiește cu Starli',
      },
      scenes: [
        {
          id: 'scene_01',
          duration: 4.0,
          background: { type: 'color', color: brand?.primaryColor || '#080C12' },
          layers: [
            {
              type: 'text',
              text: input.title,
              fontSize: 64,
              fontWeight: 'bold',
              align: 'center',
              anchor: 'center',
              x: width / 2,
              y: height / 2,
            },
          ],
        },
      ],
      audioTracks: [],
      voiceovers: [],
    };

    resolveVideoSpecAssets(this.store, defaultSpec, actor);
    const duration = defaultSpec.scenes.reduce((acc: number, s: any) => acc + (Number(s.duration) || 0), 0);
    const now = new Date().toISOString();
    const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || projectId;

    const project: VideoProjectRecord = {
      id: projectId,
      ownerId: actor.id,
      title: input.title,
      slug,
      purpose: input.purpose,
      status: 'DRAFT',
      format,
      width,
      height,
      fps: 30,
      duration,
      spec: defaultSpec,
      brandProfileId: brand?.id,
      createdAt: now,
      updatedAt: now,
    };

    this.store.put('video-projects', project);
    this.events.publish('video-projects');
    return project;
  }

  public getProject(projectId: string, actor: ActorContext): VideoProjectRecord | undefined {
    const project = this.store.get('video-projects', projectId) as VideoProjectRecord | undefined;
    if (!project) return undefined;
    this.assertOwnerOrAdmin(project.ownerId, actor, 'video project');
    return project;
  }

  public listProjects(filter: { ownerId?: string } = {}, actor: ActorContext): VideoProjectRecord[] {
    const all = (this.store.list('video-projects') as VideoProjectRecord[]) || [];
    const isAdmin = actor.role === 'ADMIN' || actor.role === 'admin';
    return all.filter((p) => {
      if (filter.ownerId && p.ownerId !== filter.ownerId) return false;
      if (!isAdmin && p.ownerId !== actor.id) return false;
      return true;
    });
  }

  public applySpec(projectId: string, spec: any, actor: ActorContext): VideoProjectRecord {
    const project = this.getProject(projectId, actor);
    if (!project) throw new Error(`Video project ${projectId} not found`);

    if (!spec || !Array.isArray(spec.scenes) || spec.scenes.length === 0) {
      throw new Error(`Video specification must contain at least one scene`);
    }

    resolveVideoSpecAssets(this.store, spec, actor);
    const duration = spec.scenes.reduce((acc: number, s: any) => acc + (Number(s.duration) || 0), 0);
    const width = Number(spec.canvas?.width) || project.width;
    const height = Number(spec.canvas?.height) || project.height;
    const fps = Number(spec.canvas?.fps) || project.fps;

    const updated: VideoProjectRecord = {
      ...project,
      width,
      height,
      fps,
      duration,
      spec,
      status: 'READY',
      updatedAt: new Date().toISOString(),
    };

    this.store.put('video-projects', updated);
    this.events.publish('video-projects');
    return updated;
  }

  public patchSpec(projectId: string, patch: Partial<any>, actor: ActorContext): VideoProjectRecord {
    const project = this.getProject(projectId, actor);
    if (!project) throw new Error(`Video project ${projectId} not found`);

    const currentSpec = JSON.parse(JSON.stringify(project.spec || {}));

    // Deep merge patch elements
    if (patch.canvas) currentSpec.canvas = { ...currentSpec.canvas, ...patch.canvas };
    if (patch.brand) currentSpec.brand = { ...currentSpec.brand, ...patch.brand };
    if (patch.scenes) currentSpec.scenes = patch.scenes;
    if (patch.audioTracks) currentSpec.audioTracks = patch.audioTracks;
    if (patch.voiceovers) currentSpec.voiceovers = patch.voiceovers;
    if (patch.output) currentSpec.output = { ...currentSpec.output, ...patch.output };

    return this.applySpec(projectId, currentSpec, actor);
  }

  public deleteProject(projectId: string, actor: ActorContext): void {
    const project = this.getProject(projectId, actor);
    if (!project) return;
    this.store.remove('video-projects', projectId);
    this.events.publish('video-projects');
  }

  public async validateSpec(spec: any): Promise<{ valid: boolean; errors: any[]; duration?: number }> {
    if (videoSubprocesses >= 2) throw new Error('Video engine busy; retry later');
    if (JSON.stringify(spec).length > 500_000) throw new Error('Video specification exceeds size limit');
    videoSubprocesses++;
    const tmpSpec = path.join(this.storageDir, `val_${randomUUID()}.json`);
    try {
      fs.writeFileSync(tmpSpec, JSON.stringify(spec, null, 2), 'utf-8');
      const { stdout } = await execFileAsync(
        this.pythonExe,
        ['-m', 'engine.cli', 'validate', '--spec', tmpSpec],
        { cwd: this.engineDir, timeout: 30_000, maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONPATH: this.engineDir } }
      );
      return JSON.parse(stdout.trim());
    } catch (err: any) {
      if (err.stdout) {
        try {
          return JSON.parse(err.stdout.trim());
        } catch {}
      }
      return { valid: false, errors: [{ path: 'spec', code: 'VALIDATION_ERROR', message: err.message }] };
    } finally {
      videoSubprocesses--;
      try {
        fs.unlinkSync(tmpSpec);
      } catch {}
    }
  }

  // =========================================================================
  // PREVIEWS & RENDERS
  // =========================================================================

  public async generatePreviewFrame(
    projectId: string,
    timestamp: number,
    actor: ActorContext
  ): Promise<{ dataUrl: string; buffer: Buffer; url: string }> {
    const project = this.getProject(projectId, actor);
    if (!project) throw new Error(`Video project ${projectId} not found`);

    if (videoSubprocesses >= 2) throw new Error('Video engine busy; retry later');
    videoSubprocesses++;
    const previewId = `prev-${randomUUID()}`;
    const tmpSpec = path.join(this.storageDir, 'previews', `${previewId}.json`);
    const outPng = path.join(this.storageDir, 'previews', `${previewId}.png`);

    try {
      const resolvedSpec = resolveVideoSpecAssets(this.store, project.spec, actor);
      fs.writeFileSync(tmpSpec, JSON.stringify(resolvedSpec, null, 2), 'utf-8');
      await execFileAsync(
        this.pythonExe,
        ['-m', 'engine.cli', 'preview', '--spec', tmpSpec, '--time', String(timestamp), '--output', outPng],
        { cwd: this.engineDir, timeout: 30_000, maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONPATH: this.engineDir } }
      );

      const buffer = fs.readFileSync(outPng);
      const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      const url = `/media/videos/preview-${previewId}.png`;

      this.store.put('video-previews', { id: previewId, ownerId: actor.id, outputPath: outPng });
      return { dataUrl, buffer, url };
    } finally {
      videoSubprocesses--;
      try {
        fs.unlinkSync(tmpSpec);
      } catch {}
    }
  }

  public startRender(
    projectId: string,
    actor: ActorContext,
    options: { thumbnailTimestamp?: number } = {}
  ): VideoRenderRecord {
    const project = this.getProject(projectId, actor);
    if (!project) throw new Error(`Video project ${projectId} not found`);

    const active = this.store.list('video-renders').filter(render => !['COMPLETE','FAILED','CANCELLED'].includes(render.status));
    if (active.length >= 20 || active.filter(render => render.ownerId === actor.id).length >= 3) throw new Error('Video render queue limit reached');
    const renderId = 'vrnd-' + randomUUID();
    const now = new Date().toISOString();

    const snapshot = JSON.parse(JSON.stringify(project.spec));
    snapshot.output = { ...snapshot.output, ...(options.thumbnailTimestamp !== undefined ? { thumbnailTimestamp: options.thumbnailTimestamp } : {}) };
    const record: VideoRenderRecord = {
      specSnapshot: snapshot,
      id: renderId,
      videoProjectId: projectId,
      ownerId: actor.id,
      status: 'QUEUED',
      progress: 0.0,
      stage: 'QUEUED',
      duration: project.duration,
      width: project.width,
      height: project.height,
      fps: project.fps,
      createdAt: now,
      updatedAt: now,
    };

    this.store.put('video-renders', record);

    // Update project state
    this.store.put('video-projects', {
      ...project,
      status: 'RENDERING',
      updatedAt: now,
    });

    this.events.publish('video-renders');
    this.events.publish('video-projects');
    return record;
  }

  public getRender(renderId: string, actor: ActorContext): VideoRenderRecord | undefined {
    const render = this.store.get('video-renders', renderId) as VideoRenderRecord | undefined;
    if (!render) return undefined;
    this.assertOwnerOrAdmin(render.ownerId, actor, 'video render');
    return render;
  }

  public listRenders(projectId: string, actor: ActorContext): VideoRenderRecord[] {
    // Check permission on parent project
    this.getProject(projectId, actor);
    const all = (this.store.list('video-renders') as VideoRenderRecord[]) || [];
    return all.filter((r) => r.videoProjectId === projectId);
  }

  public cancelRender(renderId: string, actor: ActorContext): VideoRenderRecord {
    const render = this.getRender(renderId, actor);
    if (!render) throw new Error(`Render ${renderId} not found`);

    if (render.status === 'COMPLETE' || render.status === 'FAILED') {
      return render;
    }

    const updated: VideoRenderRecord = {
      ...render,
      status: 'CANCELLED',
      stage: 'CANCELLED',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.store.put('video-renders', updated);
    this.events.publish('video-renders');
    return updated;
  }

  public async synthesizeVoiceover(
    actor: ActorContext,
    input: { text: string; voice?: string; language?: string; projectId?: string }
  ): Promise<{ assetId: string; url: string; durationEstimate: number }> {
    if (!input.text?.trim() || input.text.length > 3000) throw new Error('Voiceover text must contain 1 to 3000 characters');
    if (input.voice && !/^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(input.voice)) throw new Error('Invalid voice identifier');
    if (input.projectId && !this.getProject(input.projectId, actor)) throw new Error('Video project not found');
    if (videoSubprocesses >= 2) throw new Error('Video engine busy; retry later');
    videoSubprocesses++;
    try {
    const assetId = 'vast-' + randomUUID();
    const filename = `${assetId}.wav`;
    const audioDir = path.join(this.storageDir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const destinationPath = path.join(audioDir, filename);

    await execFileAsync(
      this.pythonExe,
      [
        '-m',
        'engine.cli',
        'voiceover',
        '--text',
        input.text,
        '--voice',
        input.voice || 'en-US-JennyNeural',
        '--language',
        input.language || 'en',
        '--output',
        destinationPath,
      ],
      { cwd: this.engineDir, timeout: 30_000, maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONPATH: this.engineDir } }
    );

    const stats = fs.statSync(destinationPath);
    const durationEstimate = Math.max(1.0, input.text.length / 14.0);
    const url = `/media/videos/${filename}`;

    const record = {
      id: assetId,
      ownerId: actor.id,
      projectId: input.projectId,
      type: 'VOICEOVER',
      filename,
      mimeType: 'audio/wav',
      size: stats.size,
      storagePath: destinationPath,
      url,
      text: input.text,
      voice: input.voice || 'en-US-JennyNeural',
      createdAt: new Date().toISOString(),
    };

    this.store.put('asset-records', record);
    this.events.publish('assets');

    return {
      assetId,
      url,
      durationEstimate,
    };
    } finally { videoSubprocesses--; }
  }
}

export function createVideoServices(options: {
  store: Store;
  events: Events;
  assetServices: AssetServices;
  storageDir?: string;
}): VideoServices {
  return new VideoServices(options);
}
