"""Build restored OpenPencil in a scratch checkout using its exact Bun release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OFFICIAL_SOURCE = ROOT / 'platform/extensions/openpencil/source'
RELEASE = json.loads(Path(__file__).with_name('bun-1.4.2-assets.json').read_text())

def validate_source(source):
    package = json.loads((source / 'package.json').read_text(encoding='utf-8-sig'))
    if package.get('name') != 'open-pencil-app' or package.get('version') != '0.16.0':
        raise ValueError('Expected restored OpenPencil 0.16.0 manifest')
    expected = 'bun@' + RELEASE['version']
    if package.get('packageManager') != expected:
        raise ValueError(f'Expected reviewed {expected}, found {package.get("packageManager")}')
    if not (source / 'bun.lock').is_file():
        raise ValueError('Frozen Bun lockfile missing')
    for workspace in package.get('workspaces', []):
        path = (source / workspace).resolve()
        if not path.is_relative_to(source.resolve()) or not (path / 'package.json').is_file():
            raise ValueError(f'Missing/unsafe workspace: {workspace}')
    if not package.get('scripts', {}).get('build'):
        raise ValueError('Actual upstream build script missing')
    return package

def asset_name():
    system = {'Windows':'windows', 'Darwin':'darwin', 'Linux':'linux'}[platform.system()]
    machine = platform.machine().lower()
    if machine in ('amd64', 'x86_64'):
        arch = 'x64'
    elif machine in ('arm64', 'aarch64'):
        arch = 'aarch64'
    else:
        raise ValueError(f'Unsupported architecture: {machine}')
    if system == 'linux' and platform.libc_ver()[0] != 'glibc':
        raise ValueError('Reviewed Linux bootstrap currently requires glibc, not musl')
    return f'bun-{system}-{arch}.zip'

def bootstrap(cache):
    asset = next(a for a in RELEASE['assets'] if a['name'] == asset_name())
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / asset['name']
    if not archive.exists():
        pending = archive.with_suffix('.download')
        with urllib.request.urlopen(asset['url'], timeout=120) as response, pending.open('wb') as target:
            while block := response.read(1024 * 1024):
                target.write(block)
        pending.replace(archive)
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != asset['sha256']:
            raise ValueError(f'Bun archive SHA256 mismatch: {archive}')
    filename = 'bun.exe' if platform.system() == 'Windows' else 'bun'
    with zipfile.ZipFile(archive) as z:
        members = [info for info in z.infolist() if Path(info.filename).name == filename]
        if len(members) != 1:
            raise ValueError('Official archive must contain exactly one Bun executable')
        executable = cache / filename
        executable.write_bytes(z.read(members[0]))
        executable.chmod(0o755)
    return executable

def run(source, cache, action, bun=None):
    source = source.resolve()
    cache = cache.resolve()
    if source == OFFICIAL_SOURCE.resolve():
        raise ValueError('Use a scratch copy; authoritative extracted source is not a build workspace')
    package = validate_source(source)
    executable = Path(bun).resolve() if bun else bootstrap(cache / 'runtime')
    version = subprocess.check_output([str(executable), '--version'], text=True).strip()
    if version != RELEASE['version']:
        raise ValueError(f'Bun version mismatch: {version}')
    # Official installers expose Bun's bunx entry point as an alias too.
    shims = cache / 'bin'
    shims.mkdir(parents=True, exist_ok=True)
    bunx = shims / ('bunx.exe' if platform.system() == 'Windows' else 'bunx')
    if not bunx.exists():
        try:
            os.link(executable, bunx)
        except OSError:
            shutil.copy2(executable, bunx)
    elif bunx.is_symlink() or hashlib.sha256(bunx.read_bytes()).digest() != hashlib.sha256(executable.read_bytes()).digest():
        raise ValueError('Cached bunx alias differs from reviewed Bun executable')
    environment = dict(os.environ)
    environment['PATH'] = str(shims) + os.pathsep + str(executable.parent) + os.pathsep + environment.get('PATH', '')
    environment['BUN_INSTALL_CACHE_DIR'] = str((cache / 'packages').resolve())
    environment['PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD'] = '1'
    before = hashlib.sha256((source / 'bun.lock').read_bytes()).hexdigest()
    command = [str(executable), 'install', '--frozen-lockfile'] if action == 'install' else [str(executable), 'run', 'build']
    subprocess.run(command, cwd=source, env=environment, check=True, timeout=1800)
    if before != hashlib.sha256((source / 'bun.lock').read_bytes()).hexdigest():
        raise ValueError('Build/install changed the frozen lockfile')
    if action == 'build' and not (source / 'dist/index.html').is_file():
        raise ValueError('Build returned success but dist/index.html missing')
    print(f'{package["name"]} {package["version"]}: {action} succeeded using Bun {version}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'build'])
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / 'work/openpencil-tools')
    parser.add_argument('--bun', type=Path, help='Use an explicitly supplied local Bun instead of verified bootstrap')
    args = parser.parse_args()
    run(args.source, args.cache, args.action, args.bun)
