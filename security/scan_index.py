#!/usr/bin/env python3
"""Screen immutable staged Git blobs; emit paths/types, never matched values.

No candidate is automatically cleared. With --base-ref, content scanning covers
only added/changed entries; path checks still cover the entire current index.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

RULES = {
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'provider-token': re.compile(r'\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b'),
    'google-key-literal': re.compile(r'\bAIza[A-Za-z0-9_-]{30,45}\b'),
    'credential-url': re.compile(r'''\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?)://[^\s/:"'`{}<>\[\],]{1,256}:[^\s/@"'`{}<>\[\],]{1,512}@'''),
    'credential-literal-review': re.compile(r'''(?i)(?:api[_-]?key|secret|password|access[_-]?token)\s*[=:]\s*["'][^"'\r\n]{8,}["']'''),
}

def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)

def screen(root, base_ref=None, max_bytes=2_000_000):
    raw = git(root, 'ls-files', '--stage', '-z')
    entries = []
    for record in raw.decode('utf-8').split('\0'):
        if record:
            head, path = record.split('\t', 1)
            mode, oid, stage = head.split()
            entries.append({'path': path, 'mode': mode, 'oid': oid, 'stage': stage})
    base, base_oid = {}, None
    if base_ref:
        base_oid = git(root, 'rev-parse', '--verify', base_ref + '^{commit}').decode().strip()
        for record in git(root, 'ls-tree', '-rz', base_oid).decode('utf-8').split('\0'):
            if record:
                head, path = record.split('\t', 1)
                mode, kind, oid = head.split()
                base[path] = (mode, oid)
    findings, skipped, scanned = [], [], []
    selected = []
    for entry in entries:
        path, mode, oid, stage = (entry[k] for k in ['path', 'mode', 'oid', 'stage'])
        parts = PurePosixPath(path).parts
        lower = path.lower()
        if stage != '0' or mode not in {'100644', '100755'}:
            findings.append({'path': path, 'type': 'unsupported-index-entry'})
            continue
        if any(p.lower() in {'data', 'uploads', 'backups', 'node_modules', '.runtime', 'work', 'state', 'vendor'} for p in parts):
            findings.append({'path': path, 'type': 'runtime-or-vendor-path-review'})
        if (PurePosixPath(path).name.startswith('.env') and not lower.endswith(('.example', '.sample', '.template'))) or re.search(r'\.(?:sqlite3?|db)(?:-wal|-shm)?$|\.(?:pem|key|p12|pfx|qcow2|vmdk|vdi)$', lower):
            findings.append({'path': path, 'type': 'sensitive-file-exclude'})
        if not base_ref or base.get(path) != (mode, oid):
            selected.append(entry)
    pipe = subprocess.Popen(['git', '-C', str(root), 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for entry in selected:
            pipe.stdin.write((entry['oid'] + '\n').encode())
            pipe.stdin.flush()
            header = pipe.stdout.readline().decode().strip().split()
            if len(header) != 3 or header[1] != 'blob':
                raise ValueError('Expected an immutable blob')
            size = int(header[2])
            data = pipe.stdout.read(size)
            if len(data) != size or pipe.stdout.read(1) != b'\n':
                raise ValueError('Incomplete Git blob stream')
            item = {**entry, 'sha256': hashlib.sha256(data).hexdigest(), 'size': size}
            scanned.append(item)
            if size > max_bytes or b'\x00' in data:
                skipped.append({'path': entry['path'], 'type': 'oversize-or-binary'})
                continue
            try:
                text = data.decode('utf-8')
            except UnicodeError:
                skipped.append({'path': entry['path'], 'type': 'encoding'})
                continue
            for number, line in enumerate(text.splitlines(), 1):
                for kind, pattern in RULES.items():
                    if kind == 'credential-url' and '@' not in line:
                        continue
                    if pattern.search(line):
                        findings.append({'path': entry['path'], 'line': number, 'type': kind, 'oid': entry['oid']})
        pipe.stdin.close()
        if pipe.wait() != 0:
            raise ValueError('Git blob reader failed')
    finally:
        if pipe.poll() is None:
            pipe.kill()
            pipe.wait()
        for stream in (pipe.stdin, pipe.stdout, pipe.stderr):
            if stream and not stream.closed:
                stream.close()
    return {'schema': 1, 'scope': 'entire-index path checks; changed-content-only' if base_ref else 'entire-index path and content checks',
            'base_commit': base_oid, 'index_listing_sha256': hashlib.sha256(raw).hexdigest(),
            'index_unchanged_during_scan': raw == git(root, 'ls-files', '--stage', '-z'),
            'index_entry_count': len(entries), 'content_selected_count': len(selected),
            'findings': findings, 'skipped': skipped, 'scanned_blobs': scanned, 'index_entries': entries,
            'policy': 'Candidates require review; no prior dispositions or filename-based clearance applied. No network validity checks. Binary/oversized/unchanged content is not cleared by this run.'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True, help='Git checkout to inspect')
    parser.add_argument('--output', type=Path, required=True, help='JSON report destination, relative to caller cwd or absolute')
    parser.add_argument('--base-ref', help='Optional commit/ref; content scan only entries differing from this immutable commit')
    parser.add_argument('--max-bytes', type=int, default=2_000_000)
    args = parser.parse_args()
    if args.max_bytes < 1:
        parser.error('--max-bytes must be positive')
    try:
        report = screen(args.root.resolve(strict=True), args.base_ref, args.max_bytes)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    except (OSError, ValueError, subprocess.SubprocessError):
        parser.exit(2, 'Index scan failed; check root, ref, output path and Git availability. No source values emitted.\n')
    print(json.dumps({'index_entry_count': report['index_entry_count'], 'content_selected_count': report['content_selected_count'],
                      'index_listing_sha256': report['index_listing_sha256'], 'index_unchanged_during_scan': report['index_unchanged_during_scan'],
                      'finding_type_counts': dict(Counter(f['type'] for f in report['findings'])), 'skipped_count': len(report['skipped'])}))
    return 2 if not report['index_unchanged_during_scan'] else 1 if report['findings'] else 0

if __name__ == '__main__':
    raise SystemExit(main())
