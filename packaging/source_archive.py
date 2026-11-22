"""Create a deterministic, reviewed-source ZIP from Git index blobs."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DENIED = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', 'data',
          'uploads', 'backups', '.runtime', '.local', 'work', 'dist', 'build'}
SOURCE_NAMES = {'data', 'dist', 'build'}
ALLOWED = {'platform', 'dashboard', 'installer', 'runtime', 'config', 'security',
           'qa', 'docs', 'packaging', '.github', 'onboarding', 'product', 'product-backend'}
# Only these vendored source roots can contain source directories whose names
# overlap generated directories. Each exception must match an indexed manifest.
SOURCE_EVIDENCE = {
    'platform/extensions/search/source/searx/data/':
        ('platform/extensions/extraction-manifest.json', 'search/source/searx/data/'),
    'platform/extensions/openpencil/source/':
        ('platform/extensions/openpencil/upstream-source-manifest.json', ''),
}

def blobs(root, object_ids):
    """Stream blobs through one Git process, using immutable IDs from the index."""
    process = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=root,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        for oid in object_ids:
            process.stdin.write(oid.encode('ascii') + b'\n')
            process.stdin.flush()
            header = process.stdout.readline().split()
            if len(header) != 3 or header[1] != b'blob' or header[0].decode() != oid:
                raise ValueError(f'Unexpected Git object response for {oid}')
            size = int(header[2])
            content = process.stdout.read(size)
            if len(content) != size or process.stdout.read(1) != b'\n':
                raise ValueError(f'Truncated Git object: {oid}')
            yield content
        process.stdin.close()
        if process.wait(timeout=10):
            raise ValueError('git cat-file failed')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        process.stdout.close()
        if not process.stdin.closed:
            process.stdin.close()

def distribution_path(name):
    # Retain the native Python foundation and its upstream notices, not its
    # superseded frontend source, npm build recipe or static UI payload.
    if name.startswith('dashboard/'):
        parts = PurePosixPath(name).parts
        return name.startswith('dashboard/backend/') or (
            len(parts) == 2 and (parts[1] in {'package.json', 'CHANGELOG.md'} or parts[1].upper().startswith(('LICENSE', 'NOTICE', 'COPYING'))))
    return True


def checked_paths(root, with_oids=False):
    raw = subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=root)
    entries = []
    for record in raw.decode('utf-8').split('\0'):
        if record:
            header, name = record.split('\t', 1)
            mode, oid, stage = header.split()
            entries.append((name, mode, oid, stage))
    indexed = {name: oid for name, _, oid, _ in entries}
    exceptions = {}
    needed = {}
    for name, _, oid, _ in entries:
        denied = {part.lower() for part in PurePosixPath(name).parts} & DENIED
        if denied and denied <= SOURCE_NAMES:
            for prefix, (manifest, manifest_prefix) in SOURCE_EVIDENCE.items():
                if name.startswith(prefix) and manifest in indexed:
                    exceptions[name] = (manifest, manifest_prefix + name[len(prefix):])
                    needed[manifest] = indexed[manifest]
                    needed[name] = oid
                    break
    evidence = {}
    if needed:
        evidence = dict(zip(needed, blobs(root, needed.values())))
    manifests = {}
    for manifest, _ in exceptions.values():
        if manifest not in manifests:
            content = json.loads(evidence[manifest])
            manifests[manifest] = {item['path']: item['sha256'] for item in content.get('files', [])}
    result = []
    resolved_root = root.resolve()
    for name, mode, oid, stage in entries:
        if not distribution_path(name):
            continue
        p = PurePosixPath(name)
        if stage != '0' or mode not in {'100644', '100755'}:
            raise ValueError(f'Unsupported index entry: {name}')
        if p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name:
            raise ValueError(f'Unsafe archive path: {name}')
        if len(p.parts) > 1 and p.parts[0] not in ALLOWED:
            raise ValueError(f'Unreviewed top-level directory: {name}')
        denied = {part.lower() for part in p.parts} & DENIED
        if denied:
            exception = exceptions.get(name)
            verified = False
            if exception:
                manifest, relative = exception
                expected = manifests[manifest].get(relative)
                verified = expected == hashlib.sha256(evidence[name]).hexdigest()
            if not verified:
                raise ValueError(f'Runtime/generated data is tracked (no matching source evidence): {name}')
        lower = p.name.lower()
        if ((lower.startswith('.env') or lower.endswith('.env')) and lower != '.env.example') or lower == '.webui_secret_key' or lower.endswith('.private.json') or lower == '.ephemeral-test-key' or re.search(r'\.(db(?:-wal|-shm)?|sqlite3?(?:-wal|-shm)?|pem|key|pfx|p12|qcow2|vmdk|vdi)$', lower):
            raise ValueError(f'Sensitive/runtime file is tracked: {name}')
        if name == 'SOURCE-MANIFEST.json':
            raise ValueError('Root SOURCE-MANIFEST.json is reserved for archive metadata')
        file = root / name
        if file.is_symlink() or not file.is_file() or resolved_root not in file.resolve().parents:
            raise ValueError(f'Not a regular in-tree file: {name}')
        item = (name, int(mode, 8) & 0o777, oid)
        result.append(item if with_oids else item[:2])
    return sorted(result)

def write_entry(z, version, name, mode, data):
    info = zipfile.ZipInfo(f'starlidigital-{version}/{name}', date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (0o100000 | mode) << 16
    z.writestr(info, data)

def create(root, output, version, index_snapshot=None):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', version):
        raise ValueError('Version must contain only letters, numbers, dots, underscores and hyphens')
    files = checked_paths(root, with_oids=True) if index_snapshot is None else index_snapshot
    names = {name for name, _, _ in files}
    # The product correction supersedes all prior OpenWebUI UI build proofs.
    gate_name = 'packaging/release-gate.json'
    gate_oid = next((oid for name, _, oid in files if name == gate_name), None)
    if gate_oid is None:
        raise ValueError('Product release blocked: reviewed target/preview gate is missing from index')
    gate = json.loads(next(blobs(root, [gate_oid])))
    if gate.get('frontend_directory') != 'product' or gate.get('release_enabled') is not True or gate.get('preview_confirmed') is not True:
        raise ValueError('Product release blocked: new bots/teams/Boss frontend and confirmed preview required; old UI is superseded')
    if gate.get('fresh_git_install_confirmed') is not True or gate.get('actual_model_execution_confirmed') is not True:
        raise ValueError('Product release blocked: fresh Git installation and actual model proof required')
    frontend_manifest = gate.get('frontend_manifest')
    frontend_lockfile = gate.get('frontend_lockfile')
    runtime_inputs = gate.get('runtime_inputs', [])
    pins = gate.get('joined_release_pins_sha256')
    if gate.get('runtime_contract_confirmed') is not True or not isinstance(pins, str) or not re.fullmatch(r'[0-9a-f]{64}', pins):
        raise ValueError('Product release blocked: pinned joined candidate and runtime contract required')
    if not all(isinstance(path, str) and path.startswith('product/') for path in [frontend_manifest, frontend_lockfile]) or not isinstance(runtime_inputs, list) or not runtime_inputs:
        raise ValueError('Product release blocked: explicit frontend manifests and runtime inputs required')
    required = {frontend_manifest, frontend_lockfile, *runtime_inputs, 'product/LICENSE.upstream'}
    if any(name.startswith('dashboard/backend/') for name in names):
        required.update({'dashboard/LICENSE','dashboard/package.json','dashboard/CHANGELOG.md'})
    missing = required - names
    if missing:
        raise ValueError('Required tracked source/provenance missing: ' + ', '.join(sorted(missing)))
    if not any('/' not in name and name.upper().startswith('LICENSE') for name in names):
        raise ValueError('Root distribution license is required; packaging cannot invent one')
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'starlidigital-{version}-source.zip'
    if archive.exists():
        raise ValueError(f'Refusing to overwrite: {archive}')
    manifest = {'format': 1, 'version': version, 'files': []}
    # A single cat-file process streams all immutable blobs, with one file in
    # memory at a time. Concurrent unstaged edits cannot alter these contents.
    try:
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as z:
            for (name, mode, _), data in zip(files, blobs(root, (oid for _, _, oid in files)), strict=True):
                write_entry(z, version, name, mode, data)
                manifest['files'].append({'path': name, 'sha256': hashlib.sha256(data).hexdigest(), 'mode': oct(mode)})
            write_entry(z, version, 'SOURCE-MANIFEST.json', 0o644,
                        (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode())
    except Exception:
        archive.unlink(missing_ok=True)
        raise
    with archive.open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    archive.with_suffix('.zip.sha256').write_text(f'{checksum}  {archive.name}\n', encoding='ascii')
    return archive

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'work' / 'release')
    args = parser.parse_args()
    try:
        print(create(ROOT, args.output.resolve(), args.version))
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f'Packaging blocked: {error}', file=sys.stderr)
        sys.exit(1)
