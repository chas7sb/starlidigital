"""
Voiceover Synthesis Engine
==========================
Generates high-fidelity neural voiceover using Edge TTS (Romanian & English),
converts to 44.1kHz WAV, and caches audio files.
"""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from typing import Optional
import subprocess

try:
    import edge_tts
    HAS_EDGE_TTS = True
except ImportError:
    HAS_EDGE_TTS = False


DEFAULT_RO_VOICE = "ro-RO-AlinaNeural"  # Official Starli AI voice
DEFAULT_EN_VOICE = "en-US-JennyNeural"


class VoiceoverEngine:
    """Manages text-to-speech generation and audio conversion."""

    def __init__(self, cache_dir: Path, ffmpeg_exe: str = "ffmpeg"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.ffmpeg_exe = ffmpeg_exe

    async def _synthesize_edge_tts(self, text: str, voice: str, out_mp3: Path) -> bool:
        if not HAS_EDGE_TTS:
            return False
        try:
            comm = edge_tts.Communicate(text=text, voice=voice, rate="+3%", pitch="+0Hz")
            await comm.save(str(out_mp3))
            return out_mp3.exists() and out_mp3.stat().st_size > 200
        except Exception as e:
            print(f"[!] Edge TTS error ({voice}): {e}")
            return False

    def synthesize(self, text: str, voice: Optional[str] = None, language: str = "ro") -> Optional[Path]:
        """Synthesizes text into a clean 44.1kHz mono WAV file."""
        if not text.strip():
            return None

        chosen_voice = voice or (DEFAULT_RO_VOICE if language == "ro" else DEFAULT_EN_VOICE)

        # Cache key based on voice and text
        cache_key = hashlib.sha256(f"{chosen_voice}:{text}".encode("utf-8")).hexdigest()[:16]
        out_wav = self.cache_dir / f"vo_{cache_key}.wav"
        out_mp3 = self.cache_dir / f"vo_{cache_key}.mp3"

        if out_wav.exists() and out_wav.stat().st_size > 1000:
            return out_wav

        # Generate MP3 via Edge TTS
        ok = False
        if HAS_EDGE_TTS:
            try:
                ok = asyncio.run(self._synthesize_edge_tts(text, chosen_voice, out_mp3))
            except Exception as e:
                print(f"[!] Voiceover synthesis failed: {e}")
                ok = False

        if not ok or not out_mp3.exists():
            return None

        # Convert MP3 to standard 44.1kHz 16-bit mono WAV
        try:
            subprocess.run(
                [
                    self.ffmpeg_exe,
                    "-y",
                    "-loglevel", "error",
                    "-i", str(out_mp3),
                    "-ac", "1",
                    "-ar", "44100",
                    str(out_wav),
                ],
                check=True,
                capture_output=True,
            )
            return out_wav if out_wav.exists() else None
        except Exception as e:
            print(f"[!] FFmpeg WAV conversion error: {e}")
            return None
