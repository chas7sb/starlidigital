#!/usr/bin/env python3
"""Cryptographic pin verification, clean manifest-only cloning, and before/after source integrity."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_sha256sums(manifest_path: Path) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    for raw in manifest_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            raise ValueError(f"Malformed SHA256SUMS line in {manifest_path}: {raw!r}")
        digest, rel = parts[0].lower(), parts[1].strip()
        if rel.startswith("*"):
            rel = rel[1:]
        if rel.startswith("./"):
            rel = rel[2:]
        if Path(rel).is_absolute() or ".." in Path(rel).parts:
            raise ValueError(f"Unsafe relative path in {manifest_path}: {rel!r}")
        entries.append((digest, rel))
    return entries


def verify_manifest(root_dir: Path, manifest_path: Path, expected_manifest_sha256: str) -> dict[str, Any]:
    actual_manifest_sha = sha256_file(manifest_path)
    if actual_manifest_sha != expected_manifest_sha256.lower():
        raise RuntimeError(
            f"MANIFEST_SHA256_MISMATCH for {manifest_path}: "
            f"expected={expected_manifest_sha256} actual={actual_manifest_sha}"
        )
    entries = parse_sha256sums(manifest_path)
    verified: dict[str, str] = {}
    for expected_digest, rel in entries:
        target = (root_dir / rel).resolve()
        if not str(target).startswith(str(root_dir.resolve()) + os.sep):
            raise RuntimeError(f"PATH_ESCAPE in {manifest_path}: {rel}")
        if not target.is_file():
            raise RuntimeError(f"MISSING_PINNED_FILE: {target}")
        actual_digest = sha256_file(target)
        if actual_digest != expected_digest:
            raise RuntimeError(
                f"PINNED_FILE_MISMATCH for {target}: expected={expected_digest} actual={actual_digest}"
            )
        verified[rel] = actual_digest
    return {
        "dir": str(root_dir),
        "manifestPath": str(manifest_path),
        "manifestSha256": actual_manifest_sha,
        "fileCount": len(verified),
        "files": verified,
    }


def clone_manifest_only(root_dir: Path, manifest_path: Path, dest_dir: Path) -> dict[str, Any]:
    """Copy strictly the files listed in SHA256SUMS.txt into dest_dir (excluding untracked files)."""
    entries = parse_sha256sums(manifest_path)
    if dest_dir.exists():
        shutil.rmtree(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for _digest, rel in entries:
        src = root_dir / rel
        dst = dest_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied.append(rel)
    # Also copy SHA256SUMS.txt itself for reference
    shutil.copy2(manifest_path, dest_dir / manifest_path.name)
    # Explicitly assert no untracked .browser-generated directory exists in clean clone
    browser_gen = dest_dir / "ui" / ".browser-generated"
    if browser_gen.exists():
        raise RuntimeError(f"UNTRACKED_BROWSER_GENERATED_PRESENT_IN_CLONE: {browser_gen}")
    return {
        "sourceDir": str(root_dir),
        "destDir": str(dest_dir),
        "copiedCount": len(copied),
        "untrackedBrowserGeneratedPresent": browser_gen.exists(),
    }


def snapshot_tree(root_dir: Path) -> dict[str, str]:
    """Snapshot every file under root_dir (detects both modifications and newly created untracked files)."""
    snap: dict[str, str] = {}
    root_resolved = root_dir.resolve()
    for dirpath, dirnames, filenames in os.walk(root_resolved):
        dirnames.sort()
        for fn in sorted(filenames):
            p = Path(dirpath) / fn
            rel = str(p.relative_to(root_resolved))
            try:
                snap[rel] = sha256_file(p)
            except PermissionError:
                st = p.stat()
                snap[rel] = f"UNREADABLE_STAT:{st.st_ino}:{st.st_size}:{st.st_mtime_ns}" 
    return snap


def verify_all_pins(pins_path: Path) -> dict[str, Any]:
    pins = json.loads(pins_path.read_text(encoding="utf-8"))
    results: dict[str, Any] = {}
    for name, cfg in pins["frozenInputs"].items():
        if "manifestPath" in cfg:
            results[name] = verify_manifest(
                Path(cfg["dir"]),
                Path(cfg["manifestPath"]),
                cfg["manifestSha256"],
            )
        elif "filePath" in cfg:
            fp = Path(cfg["filePath"])
            actual = sha256_file(fp)
            if actual != cfg["sha256"].lower():
                raise RuntimeError(
                    f"PINNED_SINGLE_FILE_MISMATCH for {fp}: expected={cfg['sha256']} actual={actual}"
                )
            results[name] = {"filePath": str(fp), "sha256": actual, "fileCount": 1}
    return results


def diff_snapshots(before: dict[str, str], after: dict[str, str]) -> dict[str, list[str]]:
    added = sorted(set(after.keys()) - set(before.keys()))
    removed = sorted(set(before.keys()) - set(after.keys()))
    modified = sorted(k for k in set(before.keys()) & set(after.keys()) if before[k] != after[k])
    return {"added": added, "removed": removed, "modified": modified}


if __name__ == "__main__":
    pins_file = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "INPUT-PINS.json"
    res = verify_all_pins(pins_file)
    summary = {k: {"fileCount": v["fileCount"], "sha256": v.get("manifestSha256") or v.get("sha256")} for k, v in res.items()}
    print(json.dumps({"status": "PASS", "pinsFile": str(pins_file), "verified": summary}, indent=2))
