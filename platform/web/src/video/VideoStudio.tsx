import React, { useState, useEffect } from 'react';
import {
  Film,
  Play,
  Pause,
  Download,
  Sparkles,
  Plus,
  RefreshCw,
  Layers,
  Clock,
  Eye,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  ChevronRight,
  Palette,
  ExternalLink,
  Sliders,
  Tv,
} from 'lucide-react';
import { gql } from '../api';
import { resolvePublicEndpoints } from '../transport';
const mediaUrl = (url?: string) => url ? new URL(url, new URL(resolvePublicEndpoints(import.meta.env.VITE_API_URL, import.meta.env.VITE_WS_URL, location.origin).api, location.origin)).href : undefined;
import './video.css';

interface VideoProject {
  id: string;
  title: string;
  slug: string;
  purpose?: string;
  status: string;
  format: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  specJson: string;
  brandProfileId?: string;
  createdAt: string;
  updatedAt: string;
}

interface VideoRender {
  id: string;
  videoProjectId: string;
  status: string;
  progress: number;
  stage: string;
  outputUrl?: string;
  thumbnailUrl?: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  fileSize?: number;
  error?: string;
  completedAt?: string;
  createdAt: string;
}

export function VideoStudio({ admin = false }: { admin?: boolean }) {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<VideoProject | null>(null);
  const [renders, setRenders] = useState<VideoRender[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewTime, setPreviewTime] = useState<number>(1.5);
  const [rendering, setRendering] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchProjects = async () => {
    try {
      const data = await gql<{ videoProjects: VideoProject[] }>(`
        query {
          videoProjects {
            id
            title
            slug
            purpose
            status
            format
            width
            height
            fps
            duration
            specJson
            brandProfileId
            createdAt
            updatedAt
          }
        }
      `);
      setProjects(data.videoProjects || []);
      if (data.videoProjects && data.videoProjects.length > 0 && !selectedProject) {
        setSelectedProject(data.videoProjects[0]);
      }
    } catch (err) {
      console.error('Failed to load video projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRenders = async (projectId: string) => {
    try {
      const data = await gql<{ videoRenders: VideoRender[] }>(
        `
        query($projectId: ID!) {
          videoRenders(projectId: $projectId) {
            id
            videoProjectId
            status
            progress
            stage
            outputUrl
            thumbnailUrl
            duration
            width
            height
            fps
            fileSize
            error
            completedAt
            createdAt
          }
        }
      `,
        { projectId }
      );
      setRenders(data.videoRenders || []);
    } catch (err) {
      console.error('Failed to load renders:', err);
    }
  };

  useEffect(() => {
    void fetchProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      void fetchRenders(selectedProject.id);
      setPreviewDataUrl(null);
    }
  }, [selectedProject?.id]);

  // Periodic poll if any render is QUEUED or in progress
  useEffect(() => {
    const hasActiveRender = renders.some(
      (r) =>
        r.status === 'QUEUED' ||
        r.status === 'VALIDATING' ||
        r.status === 'PREPARING_VOICEOVERS' ||
        r.status === 'MIXING_AUDIO' ||
        r.status === 'RENDERING_FRAMES' ||
        r.status === 'ENCODING'
    );
    if (!hasActiveRender || !selectedProject) return;

    const interval = setInterval(() => {
      void fetchRenders(selectedProject.id);
    }, 2000);
    return () => clearInterval(interval);
  }, [renders, selectedProject?.id]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const data = await gql<{ createVideoProject: VideoProject }>(
        `
        mutation($title: String!) {
          createVideoProject(title: $title, format: VERTICAL_9_16) {
            id
            title
            format
            width
            height
            duration
            status
            specJson
            createdAt
          }
        }
      `,
        { title: newTitle.trim() }
      );
      setNewTitle('');
      await fetchProjects();
      if (data.createVideoProject) {
        setSelectedProject(data.createVideoProject);
      }
    } catch (err: any) {
      alert(`Could not create project: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleStartRender = async () => {
    if (!selectedProject) return;
    setRendering(true);
    try {
      await gql(
        `
        mutation($projectId: ID!) {
          startVideoRender(projectId: $projectId) {
            id
            status
            stage
          }
        }
      `,
        { projectId: selectedProject.id }
      );
      await fetchRenders(selectedProject.id);
    } catch (err: any) {
      alert(`Failed to start render: ${err.message}`);
    } finally {
      setRendering(false);
    }
  };

  const handleGeneratePreview = async () => {
    if (!selectedProject) return;
    setPreviewLoading(true);
    try {
      const data = await gql<{ videoPreviewFrame: { dataUrl: string; url: string } }>(
        `
        query($projectId: ID!, $timestamp: Float!) {
          videoPreviewFrame(projectId: $projectId, timestamp: $timestamp) {
            dataUrl
            url
          }
        }
      `,
        { projectId: selectedProject.id, timestamp: previewTime }
      );
      setPreviewDataUrl(data.videoPreviewFrame.dataUrl);
    } catch (err: any) {
      alert(`Preview failed: ${err.message}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const latestCompleteRender = renders.find((r) => r.status === 'COMPLETE' && r.outputUrl);
  const activeRender = renders.find(
    (r) =>
      r.status === 'QUEUED' ||
      r.status === 'VALIDATING' ||
        r.status === 'PREPARING_VOICEOVERS' ||
        r.status === 'MIXING_AUDIO' ||
      r.status === 'RENDERING_FRAMES' ||
      r.status === 'ENCODING'
  );

  let parsedSpec: any = {};
  try {
    if (selectedProject?.specJson) {
      parsedSpec = JSON.parse(selectedProject.specJson);
    }
  } catch {}

  const scenes = parsedSpec.scenes || [];

  return (
    <div className="video-studio-wrap">
      {/* Studio Header */}
      <div className="video-studio-header">
        <div className="video-studio-title">
          <h2>Programmatic Video Studio</h2>
          <p>
            Universal AI motion-design and video generation engine controlled declaratively via MCP & Starli AI.
          </p>
        </div>
        <div className="video-studio-actions">
          <form onSubmit={handleCreateProject} style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="New video title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={{
                background: '#141c26',
                border: '1px solid rgba(198, 219, 240, 0.2)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: '#f4f6fa',
                fontSize: '13px',
              }}
            />
            <button type="submit" className="pill-button light" disabled={creating}>
              <Plus size={15} /> Create Video
            </button>
          </form>
          <button className="icon-button" onClick={fetchProjects} title="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <LoaderCircle size={28} className="spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <Film size={40} style={{ opacity: 0.4, marginBottom: '16px' }} />
          <h3>No Video Projects Yet</h3>
          <p>Tell Starli AI or ChatGPT to compose your first social media video, or create one above.</p>
        </div>
      ) : (
        <div className="video-detail-layout">
          {/* Main Stage & Timeline Panel */}
          <div className="video-stage-panel">
            {selectedProject ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="video-badge ready" style={{ marginBottom: '8px' }}>
                      {selectedProject.format} · {selectedProject.fps} FPS
                    </span>
                    <h3 style={{ margin: '4px 0', fontSize: '20px', color: '#f4f6fa' }}>
                      {selectedProject.title}
                    </h3>
                    <p style={{ margin: 0, fontSize: '13px', color: '#8993a3' }}>
                      {selectedProject.duration.toFixed(1)}s total duration · {scenes.length} scene
                      {scenes.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      className="pill-button accent"
                      onClick={handleStartRender}
                      disabled={rendering || Boolean(activeRender)}
                    >
                      {activeRender ? (
                        <>
                          <LoaderCircle size={15} className="spin" /> {activeRender.stage} ({Math.round(activeRender.progress * 100)}%)
                        </>
                      ) : (
                        <>
                          <Sparkles size={15} /> Render Full MP4
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* 9:16 Video Player or Preview Frame Viewport */}
                <div className="video-player-container">
                  {latestCompleteRender?.outputUrl ? (
                    <video
                      controls
                      autoPlay
                      loop
                      playsInline
                      crossOrigin="use-credentials" src={mediaUrl(latestCompleteRender.outputUrl)}
                      poster={mediaUrl(latestCompleteRender.thumbnailUrl)}
                    />
                  ) : previewDataUrl ? (
                    <img src={previewDataUrl} alt="Preview frame" />
                  ) : (
                    <div style={{ textAlign: 'center', padding: '20px', color: '#8993a3' }}>
                      <Tv size={36} style={{ marginBottom: '12px', opacity: 0.4 }} />
                      <p style={{ fontSize: '13px', margin: 0 }}>
                        Click "Preview Frame" below or "Render Full MP4" to inspect motion composition.
                      </p>
                    </div>
                  )}
                </div>

                {/* Preview Frame Controls */}
                <div
                  style={{
                    background: '#141c26',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: '13px', color: '#a8b0bd' }}>Inspect Timestamp:</span>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(1, selectedProject.duration)}
                    step="0.5"
                    value={previewTime}
                    onChange={(e) => setPreviewTime(parseFloat(e.target.value))}
                    style={{ flex: 1, minWidth: '120px' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#c6dbf0' }}>
                    {previewTime.toFixed(1)}s
                  </span>
                  <button
                    className="pill-button outline"
                    onClick={handleGeneratePreview}
                    disabled={previewLoading}
                    style={{ padding: '6px 14px', fontSize: '12px' }}
                  >
                    {previewLoading ? <LoaderCircle size={13} className="spin" /> : <Eye size={13} />} Preview Frame
                  </button>
                </div>

                {/* Declarative Scene Timeline Strip */}
                <div className="timeline-strip">
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f4f6fa', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Layers size={14} /> Scene Timeline Composition
                  </div>
                  <div className="scene-timeline-list">
                    {scenes.map((s: any, idx: number) => (
                      <div className="scene-block" key={s.id || idx}>
                        <div className="scene-block-header">
                          <span>Scene {idx + 1}</span>
                          <span>{s.duration}s</span>
                        </div>
                        <div className="scene-block-layers">
                          <strong>BG:</strong> {s.background?.type || 'color'}
                          {s.background?.effect ? ` (${s.background.effect})` : ''}
                        </div>
                        <div className="scene-block-layers">
                          <strong>Layers:</strong> {s.layers?.length || 0}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {/* Sidebar Panel: Projects & Renders History */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Project Selector List */}
            <div style={{ background: '#10151d', borderRadius: '16px', padding: '20px', border: '1px solid rgba(198, 219, 240, 0.12)' }}>
              <h4 style={{ margin: '0 0 14px 0', fontSize: '15px', color: '#f4f6fa' }}>
                Your Video Projects ({projects.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
                {projects.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProject(p)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: selectedProject?.id === p.id ? 'rgba(198, 219, 240, 0.1)' : 'transparent',
                      border: selectedProject?.id === p.id ? '1px solid #c6dbf0' : '1px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#f4f6fa' }}>{p.title}</div>
                      <small style={{ color: '#8993a3' }}>{p.duration.toFixed(1)}s · {p.format}</small>
                    </div>
                    <ChevronRight size={14} style={{ opacity: selectedProject?.id === p.id ? 1 : 0.4 }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Renders History */}
            <div style={{ background: '#10151d', borderRadius: '16px', padding: '20px', border: '1px solid rgba(198, 219, 240, 0.12)' }}>
              <h4 style={{ margin: '0 0 14px 0', fontSize: '15px', color: '#f4f6fa', display: 'flex', justifyContent: 'space-between' }}>
                <span>Render History</span>
                <span style={{ fontSize: '12px', color: '#8993a3' }}>{renders.length} runs</span>
              </h4>
              {renders.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#8993a3', margin: 0 }}>No renders for this project yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {renders.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        background: '#141c26',
                        padding: '12px',
                        borderRadius: '10px',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        fontSize: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span
                          className={`video-badge ${
                            r.status === 'COMPLETE' ? 'complete' : r.status === 'FAILED' ? '' : 'rendering'
                          }`}
                        >
                          {r.status}
                        </span>
                        {r.fileSize && (
                          <span style={{ color: '#a8b0bd' }}>
                            {(r.fileSize / (1024 * 1024)).toFixed(1)} MB
                          </span>
                        )}
                      </div>
                      {r.status === 'COMPLETE' && r.outputUrl && (
                        <div style={{ marginTop: '8px' }}>
                          <a
                            href={mediaUrl(r.outputUrl)}
                            download
                            className="text-link"
                            style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Download size={13} /> Download MP4 Video
                          </a>
                        </div>
                      )}
                      {r.error && <div style={{ color: '#f87171', marginTop: '4px' }}>{r.error}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
