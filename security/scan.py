#!/usr/bin/env python3
"""Read-only release review. JSON contains paths/types only, never matched values."""
import argparse
import json
import os
from pathlib import Path
import re
import sys

SKIP = {'.git', 'node_modules', '.venv', '__pycache__', '.pytest_cache'}
RULES = {
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'provider-token': re.compile(r'\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b'),
    'credential-url': re.compile(r'''\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?)://[^\s/:"'`{}<>\[\],]{1,256}:[^\s/@"'`{}<>\[\],]{1,512}@'''),
    'credential-literal-review': re.compile(r'''(?i)(?:api[_-]?key|secret|password|access[_-]?token)\s*[=:]\s*["'][^"'\r\n]{8,}["']'''),
    'email-review': re.compile(r'\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}\b'),
}

def scan(root, progress=False):
    findings, licenses, manifests = [], [], []
    counts = {'files': 0, 'text_scanned': 0, 'oversize': 0, 'binary': 0}
    def add(path, kind):
        findings.append({'path': path, 'type': kind})
    for parent, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not Path(parent, d).is_symlink())
        for name in sorted(files):
            file = Path(parent, name)
            rel = file.relative_to(root).as_posix()
            if progress:
                print(rel, file=sys.stderr, flush=True)
            counts['files'] += 1
            if file.is_symlink():
                add(rel, 'symlink-not-followed')
                continue
            lower = name.lower()
            if lower.startswith(('license', 'licence', 'notice', 'copying')):
                licenses.append(rel)
            if lower in {'package.json', 'package-lock.json', 'requirements.txt', 'pyproject.toml', 'cargo.lock', 'go.sum'}:
                manifests.append(rel)
            if (lower.startswith('.env') and lower not in {'.env.example', '.env.sample', '.env.template'}) or lower.endswith(('.pem', '.key', '.p12', '.pfx')):
                add(rel, 'credential-file-exclude')
            if lower.endswith(('.db', '.sqlite', '.sqlite3', '.sql', '.log', '.har', '.zip', '.tar', '.gz', '.bak')):
                add(rel, 'runtime-or-archive-exclude-review')
            if any(p.lower() in {'uploads', 'backups', 'sessions', 'recordings', 'customer-data', 'logs', 'data'} for p in file.relative_to(root).parts[:-1]):
                add(rel, 'runtime-data-path-exclude-review')
            try:
                if file.stat().st_size > 2_000_000:
                    counts['oversize'] += 1
                    add(rel, 'oversize-unscanned')
                    continue
                raw = file.read_bytes()
                if b'\x00' in raw:
                    counts['binary'] += 1
                    add(rel, 'binary-unscanned-review')
                    continue
                content = raw.decode('utf-8')
                counts['text_scanned'] += 1
                for kind, rule in RULES.items():
                    if kind in {'email-review', 'credential-url'} and '@' not in content:
                        continue
                    if rule.search(content):
                        add(rel, kind)
            except (OSError, UnicodeError):
                add(rel, 'unreadable-or-encoding-review')
    return {'schema': 1, 'scope': 'working-tree-only; dependencies and VCS history excluded',
            'counts': counts, 'license_notice_paths': licenses, 'manifest_paths': manifests,
            'findings': findings, 'status': 'review-required' if findings else 'no-pattern-findings'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--progress', action='store_true', help='Write relative paths only to stderr while scanning')
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    if not root.is_dir():
        parser.error('root must be a directory')
    report = scan(root, args.progress)
    print(json.dumps(report, indent=2))
    return 1 if report['findings'] else 0

if __name__ == '__main__':
    raise SystemExit(main())
