"""
Universal Video Rendering Engine
================================
Main orchestrator that converts declarative VideoProjectSpec into MP4 video,
preview frames, and poster thumbnails. Streams frames directly into FFmpeg.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Callable, Dict, Optional
from PIL import Image

from engine.audio import AudioMixer
from engine.compositor import ProjectCompositor
from engine.schema import VideoProjectSpec
from engine.voice import VoiceoverEngine


def resolve_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    raise RuntimeError("FFmpeg executable not found on PATH or via imageio_ffmpeg.")


class VideoRenderer:
    """Renders VideoProjectSpec compositions to MP4 and preview images."""

    def __init__(
        self,
        spec: VideoProjectSpec,
        work_dir: Path,
        ffmpeg_exe: Optional[str] = None,
        asset_resolver: Optional[Callable[[str], Optional[str]]] = None,
    ):
        errors = spec.validate()
        if errors:
            raise ValueError(str([error.to_dict() for error in errors]))
        self.spec = spec
        self.work_dir = Path(work_dir)
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.ffmpeg_exe = ffmpeg_exe or resolve_ffmpeg()
        self.asset_resolver = asset_resolver
        self.compositor = ProjectCompositor(spec, asset_resolver=asset_resolver)
        self.voice_engine = VoiceoverEngine(self.work_dir / "voice_cache", ffmpeg_exe=self.ffmpeg_exe)
        self.audio_mixer = AudioMixer(spec, ffmpeg_exe=self.ffmpeg_exe, asset_resolver=asset_resolver)

    def render_preview_frame(self, timestamp: float, output_path: Optional[Path] = None) -> Image.Image:
        """Renders a single frame at timestamp and optionally saves to output_path."""
        frame = self.compositor.render_frame_at(timestamp)
        if output_path:
            p = Path(output_path)
            p.parent.mkdir(parents=True, exist_ok=True)
            if p.suffix.lower() in (".jpg", ".jpeg"):
                frame.convert("RGB").save(p, format="JPEG", quality=90)
            else:
                frame.save(p, format="PNG")
        return frame

    def render_video(
        self,
        output_mp4: Path,
        thumbnail_path: Optional[Path] = None,
        progress_callback: Optional[Callable[[Dict[str, any]], None]] = None,
    ) -> Path:
        """Renders complete MP4 video with audio and poster thumbnail."""
        output_mp4 = Path(output_mp4)
        output_mp4.parent.mkdir(parents=True, exist_ok=True)

        def report(stage: str, percent: float, extra: Optional[dict] = None):
            data = {"stage": stage, "progress": percent, "time": time.time()}
            if extra:
                data.update(extra)
            if progress_callback:
                progress_callback(data)

        # 1. Validation
        report("VALIDATING", 0.05)
        errors = self.spec.validate()
        if errors:
            err_dicts = [e.to_dict() for e in errors]
            raise ValueError(f"Video specification validation failed: {json.dumps(err_dicts)}")

        # 2. Voiceover Synthesis
        report("PREPARING_VOICEOVERS", 0.10)
        voice_wav_map = {}
        for vo in self.spec.voiceovers:
            if vo.text and not vo.assetPath and not vo.assetId:
                vo_wav = self.voice_engine.synthesize(vo.text, voice=vo.voice, language=vo.language)
                if vo_wav:
                    voice_wav_map[vo.id] = str(vo_wav)

        # 3. Master Audio Mix
        report("MIXING_AUDIO", 0.20)
        master_wav = self.work_dir / "master_soundtrack.wav"
        self.audio_mixer.mix_master(master_wav, voice_wav_map=voice_wav_map)

        # 4. Rendering Frames via FFmpeg pipe
        report("RENDERING_FRAMES", 0.25)
        w = self.spec.canvas.width
        h = self.spec.canvas.height
        fps = self.spec.canvas.fps
        duration = self.spec.total_duration
        total_frames = max(1, int(duration * fps))

        ffmpeg_cmd = [
            self.ffmpeg_exe,
            "-y",
            "-loglevel", "error",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-s", f"{w}x{h}",
            "-pix_fmt", "rgb24",
            "-r", str(fps),
            "-i", "-",  # raw frames from stdin
            "-i", str(master_wav),  # master audio
            "-c:v", "libx264",
            "-preset", self.spec.output.preset or "fast",
            "-crf", str(self.spec.output.crf or 20),
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            str(output_mp4),
        ]

        proc = subprocess.Popen(
            ffmpeg_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        assert proc.stdin is not None

        thumb_time = self.spec.output.thumbnailTimestamp
        if thumb_time is None:
            thumb_time = duration / 2.0
        thumb_frame_idx = int(thumb_time * fps)
        thumbnail_saved = False

        for f_idx in range(total_frames):
            t = f_idx / float(fps)
            frame_img = self.compositor.render_frame_at(t)
            rgb_frame = frame_img.convert("RGB")

            # Save poster thumbnail at designated timestamp
            if thumbnail_path and (f_idx == thumb_frame_idx or (not thumbnail_saved and f_idx == total_frames - 1)):
                t_path = Path(thumbnail_path)
                t_path.parent.mkdir(parents=True, exist_ok=True)
                rgb_frame.save(t_path, format="JPEG", quality=90)
                thumbnail_saved = True

            # Write raw bytes to FFmpeg stdin
            try:
                proc.stdin.write(rgb_frame.tobytes())
            except (BrokenPipeError, IOError):
                break

            # Periodically report progress
            if f_idx % 15 == 0 or f_idx == total_frames - 1:
                frame_prog = 0.25 + 0.65 * (f_idx / total_frames)
                report("RENDERING_FRAMES", frame_prog, {"frame": f_idx, "totalFrames": total_frames})

        proc.stdin.close()
        proc.stdin = None
        report("ENCODING", 0.92)
        _, stderr_bytes = proc.communicate()
        ret = proc.wait()

        if ret != 0:
            err_msg = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else f"exit code {ret}"
            raise RuntimeError(f"FFmpeg encoding failed: {err_msg}")

        if not output_mp4.exists() or output_mp4.stat().st_size == 0:
            raise RuntimeError(f"Render completed but output file {output_mp4} was not generated or is empty.")

        file_size_mb = output_mp4.stat().st_size / (1024 * 1024)
        report("COMPLETE", 1.0, {"fileSizeBytes": output_mp4.stat().st_size, "fileSizeMb": file_size_mb})

        return output_mp4
