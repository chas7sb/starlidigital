"""
Audio & Soundtrack Mixing Engine
================================
Blends background music, neural voiceovers, and synthesized cosmic soundscapes.
Features automated voice ducking, envelope smoothing, and soft-limit clipping prevention.
"""

from __future__ import annotations

import math
from pathlib import Path
import subprocess
from typing import Callable, List, Optional
import wave

import numpy as np

from engine.schema import AudioTrackSpec, VideoProjectSpec, VoiceoverSpec


SAMPLE_RATE = 44100


def synthesize_cosmic_pad(duration: float, root_freq: float = 65.41) -> np.ndarray:
    """Synthesizes deep obsidian sub-bass drone and warm harmonic ambient pad."""
    total_samples = int(duration * SAMPLE_RATE)
    t = np.linspace(0.0, duration, total_samples, endpoint=False)

    # Sub-bass: Root + Sub-octave (32.7Hz) + Fifth (98.0Hz)
    sub = (
        0.42 * np.sin(2.0 * math.pi * (root_freq * 0.5) * t)
        + 0.35 * np.sin(2.0 * math.pi * root_freq * t)
        + 0.18 * np.sin(2.0 * math.pi * (root_freq * 1.5) * t)
    )

    # Shimmer harmonic chords (Minor 9th / Obsidian resonance)
    m3 = root_freq * (2.0 ** (3.0 / 12.0))
    p5 = root_freq * (2.0 ** (7.0 / 12.0))
    m7 = root_freq * (2.0 ** (10.0 / 12.0))
    m9 = root_freq * (2.0 ** (14.0 / 12.0))

    harmonics = (
        0.18 * np.sin(2.0 * math.pi * m3 * t + 0.4)
        + 0.16 * np.sin(2.0 * math.pi * p5 * t + 0.9)
        + 0.12 * np.sin(2.0 * math.pi * m7 * t + 1.5)
        + 0.08 * np.sin(2.0 * math.pi * m9 * t + 2.1)
    )

    # LFO modulation
    lfo = 0.85 + 0.15 * np.sin(2.0 * math.pi * 0.22 * t)
    pad = (sub + harmonics) * lfo

    # Crystalline chimes at scene intervals
    chimes = np.zeros(total_samples, dtype=np.float32)
    chime_times = [0.2, 4.0, 8.0, 12.0]
    for ct in chime_times:
        c_start = int(ct * SAMPLE_RATE)
        c_dur = int(2.5 * SAMPLE_RATE)
        if c_start + c_dur <= total_samples:
            ct_t = np.linspace(0.0, 2.5, c_dur, endpoint=False)
            decay = np.exp(-ct_t * 2.8)
            bell = (
                0.15 * np.sin(2.0 * math.pi * 1046.5 * ct_t)
                + 0.12 * np.sin(2.0 * math.pi * 1318.5 * ct_t)
                + 0.08 * np.sin(2.0 * math.pi * 1567.98 * ct_t)
            ) * decay
            chimes[c_start : c_start + c_dur] += bell

    combined = (pad * 0.7 + chimes * 0.5)

    # Fade in (1.0s) & fade out (1.2s)
    fade_in_len = min(total_samples // 4, int(1.0 * SAMPLE_RATE))
    fade_out_len = min(total_samples // 4, int(1.2 * SAMPLE_RATE))
    if fade_in_len > 0:
        combined[:fade_in_len] *= np.linspace(0.0, 1.0, fade_in_len)
    if fade_out_len > 0:
        combined[-fade_out_len:] *= np.linspace(1.0, 0.0, fade_out_len)

    # Stereo widening
    left = combined * 0.95
    right = combined * 1.05
    stereo = np.column_stack((left, right))
    return stereo.astype(np.float32)


class AudioMixer:
    """Combines background music, sound effects, voiceovers, and ducking."""

    def __init__(self, spec: VideoProjectSpec, ffmpeg_exe: str = "ffmpeg", asset_resolver: Optional[Callable[[str], Optional[str]]] = None):
        self.spec = spec
        self.ffmpeg_exe = ffmpeg_exe
        self.asset_resolver = asset_resolver
        self.duration = spec.total_duration
        self.total_samples = int(self.duration * SAMPLE_RATE)

    def _load_audio_file(self, path: Path) -> Optional[np.ndarray]:
        if not path.exists():
            return None
        # Convert to raw 44.1kHz 16-bit stereo PCM via FFmpeg stdout
        cmd = [
            self.ffmpeg_exe,
            "-v", "error",
            "-i", str(path),
            "-f", "s16le",
            "-ac", "2",
            "-ar", str(SAMPLE_RATE),
            "-",
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, check=True)
            raw = np.frombuffer(res.stdout, dtype=np.int16).astype(np.float32) / 32768.0
            stereo = raw.reshape(-1, 2)
            return stereo
        except Exception as e:
            print(f"[!] Failed to decode audio file {path}: {e}")
            return None

    def mix_master(self, out_wav_path: Path, voice_wav_map: Optional[dict] = None) -> Path:
        """Mixes all timeline audio into master WAV file with ducking."""
        out_wav_path = Path(out_wav_path)
        out_wav_path.parent.mkdir(parents=True, exist_ok=True)

        if self.total_samples <= 0:
            self.total_samples = int(4.0 * SAMPLE_RATE)

        music_layer = np.zeros((self.total_samples, 2), dtype=np.float32)
        voice_layer = np.zeros((self.total_samples, 2), dtype=np.float32)
        ducking_mask = np.ones(self.total_samples, dtype=np.float32)

        # 1. Synthesize base ambient pad if requested or if no audio tracks provided
        has_custom_track = any(t.assetId or t.assetPath for t in self.spec.audioTracks)
        if not has_custom_track:
            pad = synthesize_cosmic_pad(self.duration)
            music_layer += pad * 0.65

        # 2. Add user audio tracks
        for track in self.spec.audioTracks:
            if track.syntheticType:
                pad = synthesize_cosmic_pad(self.duration)
                music_layer += pad * track.volume
                continue

            track_path = track.assetPath
            if not track_path and self.asset_resolver and track.assetId:
                track_path = self.asset_resolver(track.assetId)

            if track_path:
                audio_data = self._load_audio_file(Path(track_path))
                if audio_data is not None:
                    start_s = int(track.start * SAMPLE_RATE)
                    samples_needed = self.total_samples - start_s
                    if samples_needed > 0:
                        if track.loop and len(audio_data) < samples_needed:
                            repeats = (samples_needed // len(audio_data)) + 1
                            audio_data = np.tile(audio_data, (repeats, 1))
                        chunk = audio_data[:samples_needed]
                        music_layer[start_s : start_s + len(chunk)] += chunk * track.volume

        # 3. Add voiceover tracks and compute ducking mask
        voice_map = voice_wav_map or {}
        for vo in self.spec.voiceovers:
            vo_path = vo.assetPath
            if not vo_path and vo.id in voice_map:
                vo_path = voice_map[vo.id]
            if not vo_path and self.asset_resolver and vo.assetId:
                vo_path = self.asset_resolver(vo.assetId)

            if vo_path:
                vo_data = self._load_audio_file(Path(vo_path))
                if vo_data is not None:
                    v_start = int(vo.start * SAMPLE_RATE)
                    v_len = min(len(vo_data), self.total_samples - v_start)
                    if v_len > 0:
                        voice_layer[v_start : v_start + v_len] += vo_data[:v_len] * vo.volume

                        # Ducking attenuation
                        if vo.ducking:
                            attack = int(0.25 * SAMPLE_RATE)
                            release = int(0.35 * SAMPLE_RATE)
                            d_start = max(0, v_start - attack)
                            d_end = min(self.total_samples, v_start + v_len + release)
                            duck_target = vo.duckVolume

                            # Apply smooth ramp down and up
                            ducking_mask[v_start : v_start + v_len] = np.minimum(
                                ducking_mask[v_start : v_start + v_len], duck_target
                            )
                            if v_start > d_start:
                                ramp_down = np.linspace(1.0, duck_target, v_start - d_start)
                                ducking_mask[d_start:v_start] = np.minimum(ducking_mask[d_start:v_start], ramp_down)
                            if d_end > (v_start + v_len):
                                ramp_up = np.linspace(duck_target, 1.0, d_end - (v_start + v_len))
                                ducking_mask[v_start + v_len : d_end] = np.minimum(
                                    ducking_mask[v_start + v_len : d_end], ramp_up
                                )

        # 4. Multiply music by ducking mask
        ducked_music = music_layer * ducking_mask[:, None]

        # 5. Master sum with soft limiting
        master = ducked_music + voice_layer

        # Soft limiter (tanh saturation)
        peak = np.max(np.abs(master))
        if peak > 0.95:
            master = np.tanh(master * 0.95)

        master_16 = np.clip(master * 32767.0, -32767.0, 32767.0).astype(np.int16)

        # Write to WAV
        with wave.open(str(out_wav_path), "wb") as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(master_16.tobytes())

        return out_wav_path
