"""
Video Engine CLI Interface
==========================
CLI entrypoint invoked by the StarliDigital background render worker.
Supports: validate, preview, render, and voiceover subcommands.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from engine.renderer import VideoRenderer
from engine.schema import parse_video_spec
from engine.voice import VoiceoverEngine


def handle_validate(args: argparse.Namespace) -> int:
    spec_path = Path(args.spec)
    if not spec_path.exists():
        print(json.dumps({"valid": False, "errors": [{"path": "spec", "code": "FILE_NOT_FOUND", "message": f"Spec file {spec_path} does not exist"}]}))
        return 1

    try:
        with open(spec_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        spec = parse_video_spec(data)
        errors = spec.validate()
        if errors:
            print(json.dumps({"valid": False, "errors": [e.to_dict() for e in errors]}))
            return 1
        print(json.dumps({"valid": True, "errors": [], "duration": spec.total_duration, "scenes": len(spec.scenes)}))
        return 0
    except Exception as e:
        print(json.dumps({"valid": False, "errors": [{"path": "spec", "code": "PARSE_ERROR", "message": str(e)}]}))
        return 1


def handle_preview(args: argparse.Namespace) -> int:
    spec_path = Path(args.spec)
    out_path = Path(args.output)
    t = float(args.time)

    with open(spec_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    spec = parse_video_spec(data)

    errors = spec.validate()
    if errors:
        raise ValueError(str([e.to_dict() for e in errors]))
    work_dir = out_path.parent / ".work"
    renderer = VideoRenderer(spec, work_dir=work_dir)
    renderer.render_preview_frame(timestamp=t, output_path=out_path)
    print(json.dumps({"status": "SUCCESS", "outputPath": str(out_path.resolve())}))
    return 0


def handle_render(args: argparse.Namespace) -> int:
    spec_path = Path(args.spec)
    out_mp4 = Path(args.output)
    thumb_path = Path(args.thumbnail) if args.thumbnail else None
    progress_file = Path(args.progress) if args.progress else None

    with open(spec_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    spec = parse_video_spec(data)

    work_dir = out_mp4.parent / ".work"

    def on_progress(p_data: dict):
        if progress_file:
            try:
                progress_file.parent.mkdir(parents=True, exist_ok=True)
                with open(progress_file, "w", encoding="utf-8") as pf:
                    json.dump(p_data, pf)
            except Exception:
                pass
        # Print progress line to stdout
        print(f"[PROGRESS] {json.dumps(p_data)}", flush=True)

    renderer = VideoRenderer(spec, work_dir=work_dir)
    try:
        final_mp4 = renderer.render_video(
            output_mp4=out_mp4,
            thumbnail_path=thumb_path,
            progress_callback=on_progress,
        )
        print(json.dumps({
            "status": "SUCCESS",
            "outputPath": str(final_mp4.resolve()),
            "thumbnailPath": str(thumb_path.resolve()) if thumb_path else None,
            "duration": spec.total_duration,
            "fileSize": final_mp4.stat().st_size,
        }))
        return 0
    except Exception as e:
        on_progress({"stage": "FAILED", "progress": 0.0, "error": str(e)})
        print(json.dumps({"status": "FAILED", "error": str(e)}), file=sys.stderr)
        return 1


def handle_voiceover(args: argparse.Namespace) -> int:
    out_wav = Path(args.output)
    engine = VoiceoverEngine(out_wav.parent / "voice_cache")
    res = engine.synthesize(text=args.text, voice=args.voice, language=args.language)
    if res and res.exists():
        if res != out_wav:
            import shutil
            shutil.copyfile(res, out_wav)
        print(json.dumps({"status": "SUCCESS", "outputPath": str(out_wav.resolve())}))
        return 0
    print(json.dumps({"status": "FAILED", "error": "Synthesis failed"}), file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="StarliDigital Universal Video Engine CLI")
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    # 1. validate
    p_val = subparsers.add_parser("validate", help="Validate a VideoSpec JSON file")
    p_val.add_argument("--spec", required=True, help="Path to VideoSpec JSON")

    # 2. preview
    p_prev = subparsers.add_parser("preview", help="Render a preview frame at timestamp")
    p_prev.add_argument("--spec", required=True, help="Path to VideoSpec JSON")
    p_prev.add_argument("--time", type=float, default=0.0, help="Timestamp in seconds")
    p_prev.add_argument("--output", required=True, help="Path to output PNG/JPG")

    # 3. render
    p_ren = subparsers.add_parser("render", help="Render complete MP4 video")
    p_ren.add_argument("--spec", required=True, help="Path to VideoSpec JSON")
    p_ren.add_argument("--output", required=True, help="Path to output MP4")
    p_ren.add_argument("--thumbnail", help="Path to output thumbnail image")
    p_ren.add_argument("--progress", help="Path to progress JSON file")

    # 4. voiceover
    p_vo = subparsers.add_parser("voiceover", help="Synthesize voiceover WAV")
    p_vo.add_argument("--text", required=True, help="Text to speak")
    p_vo.add_argument("--voice", default="ro-RO-AlinaNeural", help="TTS voice model")
    p_vo.add_argument("--language", default="ro", help="Language code")
    p_vo.add_argument("--output", required=True, help="Path to output WAV")

    args = parser.parse_args()

    if args.subcommand == "validate":
        return handle_validate(args)
    elif args.subcommand == "preview":
        return handle_preview(args)
    elif args.subcommand == "render":
        return handle_render(args)
    elif args.subcommand == "voiceover":
        return handle_voiceover(args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
