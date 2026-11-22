"""Audit staged Git blobs, never working-tree substitutions; emits paths/types only."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
from scan import RULES

raw = subprocess.check_output(['git', 'ls-files', '--stage', '-z'])
entries = []
for record in raw.decode('utf-8').split('\0'):
    if record:
        header, path = record.split('\t', 1)
        mode, oid, stage = header.split()
        entries.append((path, mode, oid, stage))
pipe = subprocess.Popen(['git', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
findings, hashes, targeted = [], [], {}
targets = {
    'platform/server/src/index.ts', 'platform/extensions/mission-control/server/src/index.ts',
    'platform/server/src/mailbox/service.ts', 'platform/extensions/mission-control/server/src/mailbox/service.ts',
    'platform/extensions/search/source/searx/engines/pexels.py',
    'platform/extensions/search/init-settings.py', 'platform/extensions/search/wsgi.py',
    'platform/extensions/openpencil/source/packages/core/src/constants.ts', '.gitignore'
}
patterns = {k: v for k, v in RULES.items() if k not in {'email-review'}}
patterns['google-key-literal'] = re.compile(r'\bAIza[A-Za-z0-9_-]{30,45}\b')
skipped = []
for path, mode, oid, stage in entries:
    parts = PurePosixPath(path).parts
    lower = path.lower()
    if stage != '0' or mode not in {'100644', '100755'}:
        findings.append({'path': path, 'type': 'unsupported-index-entry'})
    if any(x.lower() in {'data', 'uploads', 'backups', 'node_modules', '.runtime', 'work', 'state', 'vendor'} for x in parts):
        findings.append({'path': path, 'type': 'runtime-or-vendor-path-review'})
    if (PurePosixPath(path).name.startswith('.env') and not lower.endswith(('.example', '.sample', '.template'))) or re.search(r'\.(?:sqlite3?|db)(?:-wal|-shm)?$|\.(?:pem|key|p12|pfx|qcow2|vmdk|vdi)$', lower):
        findings.append({'path': path, 'type': 'sensitive-file-exclude'})
    pipe.stdin.write((oid + '\n').encode())
    pipe.stdin.flush()
    header = pipe.stdout.readline().decode().strip().split()
    size = int(header[-1])
    content = pipe.stdout.read(size)
    assert pipe.stdout.read(1) == b'\n'
    digest = hashlib.sha256(content).hexdigest()
    hashes.append({'path': path, 'oid': oid, 'sha256': digest})
    if path in targets:
        text = content.decode('utf-8')
        targeted[path] = {'oid': oid, 'sha256': digest, 'working_tree_matches_index': Path(path).exists() and hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest,
                          'recovery_fallback': 'ADMIN_RECOVERY_EMAIL||' in text or 'ADMIN_RECOVERY_EMAIL ||' in text,
                          'upstream_mailbox_literal_lines': [i for i, s in enumerate(text.splitlines(), 1) if '@starlidigital.ro' in s and ('imapUser' in s or 'email:' in s or 'user:' in s)]}
    if size > 2_000_000 or b'\x00' in content:
        skipped.append({'path': path, 'type': 'oversize-or-binary'})
        continue
    try:
        text = content.decode('utf-8')
    except UnicodeError:
        skipped.append({'path': path, 'type': 'encoding'})
        continue
    for kind, rule in patterns.items():
        if kind == 'credential-url' and '@' not in text:
            continue
        for number, line in enumerate(text.splitlines(), 1):
            if rule.search(line):
                findings.append({'path': path, 'line': number, 'type': kind})
pipe.stdin.close()
pipe.wait()
snapshot = hashlib.sha256(raw).hexdigest()
report = {'schema': 1, 'date': '2026-11-22', 'index_entry_count': len(entries), 'index_listing_sha256': snapshot,
          'scope': 'staged Git blob bytes only; no network validity checks; binary/large files require asset review',
          'target_verification': targeted, 'findings': findings, 'skipped': skipped, 'blobs': hashes}
Path('security/index-audit.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'index_entry_count': len(entries), 'index_listing_sha256': snapshot, 'finding_count': len(findings), 'skipped_count': len(skipped), 'target_verification': targeted}, indent=2))
