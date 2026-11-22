"""Check that generated backend hash locks still match the source requirements."""
import hashlib
import json
from pathlib import Path
from lock_backend import ROOT, TARGETS

source = ROOT / 'dashboard/backend/requirements.txt'
source_hash = hashlib.sha256(source.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
for name, target in TARGETS.items():
    lock = ROOT / 'packaging/locks' / f'dashboard-{name}-py311.txt'
    metadata = json.loads(lock.with_suffix('.json').read_text(encoding='utf-8'))
    assert metadata['target'] == target, f'Wrong target: {name}'
    assert metadata['python'] == '3.11', f'Wrong Python: {name}'
    assert metadata['requirements_sha256'] == source_hash, f'Stale requirements lock: {name}'
    assert metadata['lock_sha256'] == hashlib.sha256(lock.read_bytes().replace(b'\r\n', b'\n')).hexdigest(), f'Lock hash mismatch: {name}'
    content = lock.read_text(encoding='utf-8')
    assert '--hash=sha256:' in content, f'Package hashes missing: {name}'
    packages = [line for line in content.splitlines() if line and not line.startswith((' ', '#'))]
    assert packages and all('==' in line for line in packages), f'Unpinned requirement: {name}'
    print(f'{name}: {len(packages)} pinned packages; source and lock hashes match')
