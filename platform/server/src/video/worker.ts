import { resolveVideoSpecAssets } from './assets.js';
/**
 * Video Background Render Worker
 * ==============================
 * Asynchronous background job queue that compiles declarative VideoSpecs and invokes
 * the Python video rendering engine under strict resource and concurrency limits.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from '../store.js';
import type { Events } from '../events.js';
import type { AssetServices } from '../assets/service.js';
import type { VideoProjectRecord, VideoRenderRecord } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const RENDER_TIMEOUT_MS = 300000; // 5 minutes max render timeout

export class VideoRenderWorker {
  private store: Store;
  private events: Events;
  private assetServices: AssetServices;
  private baseDir: string;
  private isProcessing = false;
  private timer: NodeJS.Timeout | null = null;
  private pythonExe: string;
  private engineDir: string;

  constructor(options: {
    store: Store;
    events: Events;
    assetServices: AssetServices;
    baseDir?: string;
  }) {
    this.store = options.store;
    this.events = options.events;
    this.assetServices = options.assetServices;
    this.baseDir = options.baseDir || path.join(process.env.VIDEO_STORAGE_DIR || path.resolve(process.cwd(), 'data', 'video'), 'renders');
    this.pythonExe = process.env.PYTHON_BIN || (process.platform === 'win32' ? (fs.existsSync('C:\\Python314\\python.exe') ? 'C:\\Python314\\python.exe' : 'python.exe') : 'python');
    this.engineDir = path.resolve(REPO_ROOT, 'video-engine');

    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
    } catch {}

    // Recover any interrupted render jobs from previous server run
    this.recoverInterruptedJobs();
  }

  public start(): () => void {
    this.timer = setInterval(() => {
      void this.processNext();
    }, 1500);

    return () => {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  private recoverInterruptedJobs(): void {
    const renders = (this.store.list('video-renders') as VideoRenderRecord[]) || [];
    for (const render of renders) {
      if (
        (render.status === 'VALIDATING' ||
        render.status === 'PREPARING_VOICEOVERS' ||
        render.status === 'MIXING_AUDIO' ||
        render.status === 'RENDERING_FRAMES' ||
        render.status === 'ENCODING') && Date.now() - Date.parse(render.updatedAt) > RENDER_TIMEOUT_MS
      ) {
        const updated: VideoRenderRecord = {
          ...render,
          status: 'FAILED',
          stage: 'FAILED',
          error: 'Serverul a fost repornit în timpul randării. Poți relua randarea.',
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.store.put('video-renders', updated);
      }
    }
  }

  public async processNext(): Promise<void> {
    if (this.isProcessing) return;

    this.recoverInterruptedJobs();
    // Find next QUEUED render job
    const allRenders = (this.store.list('video-renders') as VideoRenderRecord[]) || [];
    const queued = allRenders.find((r) => r.status === 'QUEUED');
    if (!queued) return;

    const claimed = this.store.db.prepare(`UPDATE records SET payload=json_set(payload, '$.status', 'VALIDATING', '$.stage', 'VALIDATING', '$.updatedAt', ?) WHERE collection='video-renders' AND id=? AND json_extract(payload, '$.status')='QUEUED' AND NOT EXISTS (SELECT 1 FROM records WHERE collection='video-renders' AND json_extract(payload, '$.status') IN ('VALIDATING','PREPARING_VOICEOVERS','MIXING_AUDIO','RENDERING_FRAMES','ENCODING'))`).run(new Date().toISOString(), queued.id);
    if (!claimed.changes) return;
    this.isProcessing = true;
    try {
      await this.executeJob(queued);
    } catch (err: any) {
      this.updateStatus(queued.id, 'FAILED', 0, 'FAILED', err.message);
      console.error(`[video-worker] Error executing render ${queued.id}:`, err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeJob(render: VideoRenderRecord): Promise<void> {
    const project = this.store.get('video-projects', render.videoProjectId) as VideoProjectRecord | undefined;
    if (!project) {
      this.updateStatus(render.id, 'FAILED', 0.0, 'FAILED', 'Video project not found');
      return;
    }

    const jobDir = path.join(this.baseDir, render.id);
    fs.mkdirSync(jobDir, { recursive: true });

    const specPath = path.join(jobDir, 'spec.json');
    const outMp4Path = path.join(jobDir, 'output.mp4');
    const thumbPath = path.join(jobDir, 'thumbnail.jpg');
    const progressPath = path.join(jobDir, 'progress.json');

    // Prepare spec with concrete asset file paths
    const resolvedSpec = resolveVideoSpecAssets(this.store, render.specSnapshot || project.spec, { id: project.ownerId, role: 'USER' });
    fs.writeFileSync(specPath, JSON.stringify(resolvedSpec, null, 2), 'utf-8');

    this.updateStatus(render.id, 'VALIDATING', 0.05, 'VALIDATING');

    // Run Python renderer CLI subprocess
    await new Promise<void>((resolve) => {
      const args = [
        '-m',
        'engine.cli',
        'render',
        '--spec',
        specPath,
        '--output',
        outMp4Path,
        '--thumbnail',
        thumbPath,
        '--progress',
        progressPath,
      ];

      const env = {
        ...process.env,
        PYTHONPATH: this.engineDir,
      };

      const proc = spawn(this.pythonExe, args, {
        cwd: this.engineDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });

      const killTree = () => {
        if (!proc.pid) return;
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
        else { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} }
      };
      const cancelTimer = setInterval(() => {
        if (this.store.get('video-renders', render.id)?.status === 'CANCELLED') killTree();
      }, 250);
      let timeoutTimer: NodeJS.Timeout | null = setTimeout(() => {
        try {
          killTree();
        } catch {}
        this.updateStatus(render.id, 'FAILED', 0.0, 'FAILED', `Render exceeded maximum timeout of ${RENDER_TIMEOUT_MS / 1000}s`);
      }, RENDER_TIMEOUT_MS);

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('[PROGRESS]')) {
            try {
              const data = JSON.parse(line.slice(10).trim());
              const stage = String(data.stage || 'RENDERING_FRAMES');
              const prog = Number(data.progress || 0.5);
              this.updateStatus(render.id, stage as any, prog, stage);
            } catch {}
          }
        }
      });

      let stderrStr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderrStr = (stderrStr + chunk.toString('utf-8')).slice(-16_000);
      });

      proc.on('close', (code) => {
        clearInterval(cancelTimer);
        if (this.store.get('video-renders', render.id)?.status === 'CANCELLED') { if (timeoutTimer) clearTimeout(timeoutTimer); resolve(); return; }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }

        if (code === 0 && fs.existsSync(outMp4Path) && fs.statSync(outMp4Path).size > 0) {
          const stats = fs.statSync(outMp4Path);
          const current = this.store.get('video-renders', render.id) as VideoRenderRecord;
          const completed: VideoRenderRecord = {
            ...current,
            status: 'COMPLETE',
            progress: 1.0,
            stage: 'COMPLETE',
            outputPath: outMp4Path,
            outputUrl: `/media/videos/${render.id}.mp4`,
            thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : undefined,
            thumbnailUrl: fs.existsSync(thumbPath) ? `/media/videos/${render.id}-thumb.jpg` : undefined,
            fileSize: stats.size,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          this.store.put('video-renders', completed);

          // Update Project status to COMPLETE
          const p = this.store.get('video-projects', render.videoProjectId) as VideoProjectRecord;
          if (p) {
            this.store.put('video-projects', { ...p, status: 'COMPLETE', updatedAt: new Date().toISOString() });
            this.events.publish('video-projects');
          }
          this.events.publish('video-renders');
        } else {
          const errMessage = stderrStr.slice(-500).trim() || `Render process exited with code ${code}`;
          this.updateStatus(render.id, 'FAILED', 0.0, 'FAILED', errMessage);
        }
        resolve();
      });

      proc.on('error', (err) => {
        clearInterval(cancelTimer);
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        this.updateStatus(render.id, 'FAILED', 0.0, 'FAILED', `Process launch error: ${err.message}`);
        resolve();
      });
    });
  }

  private updateStatus(
    renderId: string,
    status: VideoRenderRecord['status'],
    progress: number,
    stage: string,
    error?: string
  ): void {
    const current = this.store.get('video-renders', renderId) as VideoRenderRecord | undefined;
    if (!current || current.status === 'CANCELLED') return;

    const updated: VideoRenderRecord = {
      ...current,
      status,
      progress,
      stage,
      error: error || current.error,
      completedAt: status === 'COMPLETE' || status === 'FAILED' ? new Date().toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    };
    this.store.put('video-renders', updated);
    this.events.publish('video-renders');
  }
}
