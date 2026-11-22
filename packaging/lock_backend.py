"""Resolve a dashboard backend lock for one exact OS/architecture and Python 3.11."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    'windows-x64': 'x86_64-pc-windows-msvc',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'macos-x64': 'x86_64-apple-darwin',
    'macos-arm64': 'aarch64-apple-darwin',
}

def generate(target, cache):
    source = ROOT / 'dashboard/backend/requirements.txt'
    source_hash = hashlib.sha256(source.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
    output = ROOT / 'packaging/locks' / f'dashboard-{target}-py311.txt'
    output.parent.mkdir(parents=True, exist_ok=True)
    pending = output.with_suffix('.pending')
    version = subprocess.check_output(['uv', '--version'], text=True).strip()
    command = ['uv', '--cache-dir', str(cache.resolve()), 'pip', 'compile',
               'dashboard/backend/requirements.txt', '--python-version', '3.11',
               '--python-platform', TARGETS[target], '--generate-hashes',
               '--no-header', '--no-annotate', '--output-file', str(pending)]
    subprocess.run(command, cwd=ROOT, check=True, timeout=1800)
    if source_hash != hashlib.sha256(source.read_bytes().replace(b'\r\n', b'\n')).hexdigest():
        raise ValueError('Requirements changed during resolution; rerun against a stable source')
    content = pending.read_text(encoding='utf-8')
    if '--hash=sha256:' not in content:
        raise ValueError('Resolver produced no package hashes')
    pending.replace(output)
    output.with_suffix('.json').write_text(json.dumps({
        'schema': 1, 'hash_normalization': 'LF', 'target': TARGETS[target], 'python': '3.11', 'resolver': version,
        'requirements': 'dashboard/backend/requirements.txt',
        'requirements_sha256': source_hash,
        'lock_sha256': hashlib.sha256(output.read_bytes().replace(b'\r\n', b'\n')).hexdigest(),
        'status': 'resolved-with-hashes; installation-not-verified',
    }, indent=2) + '\n', encoding='utf-8')
    print(output)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=TARGETS)
    parser.add_argument('--cache-dir', type=Path, default=ROOT / 'work/package-lock-cache')
    args = parser.parse_args()
    generate(args.target, args.cache_dir)
