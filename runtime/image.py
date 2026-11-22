"""Verify, export and import a reviewed standalone StarliDigital qcow2 guest.

Standard library only. A SHA256 verifies identity, not trust or guest sanitization.
"""
from __future__ import annotations
import argparse
import contextlib
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import struct
import subprocess
import sys
import uuid
import vm

SCHEMA = 'starlidigital.vm-image.v1'
MAX_DISK = 256 * 1024 ** 3

def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()

def regular(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Image must be an existing regular file, not a symlink')
    return path.resolve(strict=True)

def qcow_header(path):
    """Reject file dependencies before invoking QEMU on the trusted-hash image."""
    with path.open('rb') as stream:
        header = stream.read(104)
    if len(header) < 72 or header[:4] != b'QFI\xfb':
        raise ValueError('Not a qcow2 image')
    version = struct.unpack_from('>I', header, 4)[0]
    if version not in (2, 3) or (version == 3 and len(header) < 104):
        raise ValueError('Unsupported qcow2 header')
    backing_offset, backing_size = struct.unpack_from('>QI', header, 8)
    size = struct.unpack_from('>Q', header, 24)[0]
    encryption = struct.unpack_from('>I', header, 32)[0]
    snapshots = struct.unpack_from('>I', header, 60)[0]
    if backing_offset or backing_size:
        raise ValueError('Backing-file images are not portable standalone images')
    if not 1 <= size <= MAX_DISK:
        raise ValueError('Virtual disk must be at most 256 GiB')
    if encryption or snapshots:
        raise ValueError('Encrypted images and internal snapshots are not distributable base images')
    if version == 3:
        features = struct.unpack_from('>Q', header, 72)[0]
        if features & 7:
            raise ValueError('Dirty, corrupt or external-data qcow2 image refused')
        if features & ~31:
            raise ValueError('Unknown qcow2 incompatible feature')
    return {'format': 'qcow2', 'virtual_size': size, 'version': version}

def image_tool():
    executable = vm.binary('qemu-img')
    if not executable:
        raise RuntimeError('Install QEMU first; qemu-img is required')
    return executable

def qemu(args, timeout=1800):
    result = subprocess.run([image_tool(), *args], capture_output=True, text=True,
                            timeout=timeout, check=False)
    if result.returncode:
        # Do not propagate disk content, arbitrary image metadata or local path errors.
        raise RuntimeError('qemu-img operation failed; image is unchanged or partial output is retained')
    return result.stdout

def check(path):
    header = qcow_header(path)
    info = json.loads(qemu(['info', '--output=json', '-f', 'qcow2', str(path)], 30))
    if (info.get('format') != 'qcow2' or info.get('virtual-size') != header['virtual_size']
            or info.get('backing-filename') or info.get('full-backing-filename') or info.get('snapshots')):
        raise ValueError('Standalone qcow2 metadata did not match the validated header')
    result = json.loads(qemu(['check', '--output=json', '-f', 'qcow2', str(path)], 300))
    if result.get('check-errors', 0) or result.get('corruptions', 0) or result.get('leaks', 0):
        raise ValueError('qcow2 consistency check failed; no repair attempted')
    return header

def expected_hash(value):
    if not re.fullmatch('[0-9a-fA-F]{64}', value or ''):
        raise ValueError('Supply an explicit trusted 64-character SHA256')
    return value.lower()

def verify(path, expected):
    expected = expected_hash(expected)
    source = regular(Path(path))
    before = source.stat()
    actual = digest(source)
    after = source.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise ValueError('Source image changed while being verified')
    if actual != expected:
        raise ValueError('SHA256 mismatch; no image imported')
    metadata = check(source)
    return {'sha256': actual, 'bytes': after.st_size, **metadata}

def _state_boundary():
    if vm.STATE.is_symlink() or vm.STATE.resolve() != vm.ROOT.resolve() / 'state':
        raise ValueError('VM state directory boundary is invalid')

@contextlib.contextmanager
def lifecycle_lock():
    _state_boundary()
    vm.STATE.mkdir(parents=True, exist_ok=True)
    if os.name != 'nt': vm.STATE.chmod(0o700)
    lock = vm.STATE / 'lifecycle.lock'
    descriptor = None
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.write(descriptor, str(os.getpid()).encode())
        yield
    finally:
        if descriptor is not None:
            os.close(descriptor)
            lock.unlink(missing_ok=True)

def stopped():
    state = vm.status()
    if state.get('state') != 'stopped' or (vm.STATE / 'process.json').exists():
        raise RuntimeError('Guest must be cleanly stopped; running, unreachable or stale tracking is refused')

def _write_private(path, data):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(data, indent=2) + '\n')
    if os.name != 'nt': path.chmod(0o600)

def export_image(output=None, clean_base_reviewed=False):
    if clean_base_reviewed is not True:
        raise ValueError('Explicit --clean-base-reviewed is required; export does not sanitize guest data')
    with lifecycle_lock():
        stopped()
        if (vm.STATE / 'config.json').is_symlink():
            raise ValueError('VM configuration cannot be a symlink')
        config = vm.load()
        if config.get('disk') != 'desktop.qcow2':
            raise ValueError('Only the fixed project guest disk can be exported')
        source = regular(vm.STATE / 'desktop.qcow2')
        if source.parent != vm.STATE.resolve():
            raise ValueError('Guest disk must be inside local state')
        check(source)
        source_hash = digest(source)
        destination = Path(output).expanduser() if output else vm.STATE / 'exports' / ('base-' + uuid.uuid4().hex)
        if destination.is_symlink(): raise ValueError('Export directory cannot be a symlink')
        destination = destination.resolve()
        repository = vm.ROOT.parent.resolve()
        if destination.is_relative_to(repository) and not destination.is_relative_to(vm.STATE.resolve()):
            raise ValueError('Export inside this repository is only allowed under ignored runtime/state')
        if destination == source.parent or destination.exists():
            raise ValueError('Export directory exists; refusing overwrite')
        destination.mkdir(parents=True, exist_ok=False, mode=0o700)
        target = destination / 'starlidigital-base.qcow2'
        qemu(['convert', '-c', '-f', 'qcow2', '-O', 'qcow2', str(source), str(target)])
        metadata = check(target)
        if digest(source) != source_hash:
            raise RuntimeError('Source changed during export; partial package retained, do not distribute')
        result = {
            'schema': SCHEMA, 'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'image': {'filename': target.name, 'format': 'qcow2', 'architecture': 'x86_64',
                      'sha256': digest(target), 'bytes': target.stat().st_size, 'virtual_size': metadata['virtual_size']},
            'clean_base_review': {'attested': True, 'scope': 'operator-attestation-not-automatic-sanitization'},
            'excluded': ['installer-iso', 'host-config', 'process-tracking', 'host-tokens', 'host-session-state'],
            'guest_sanitization': 'NOT_AUTOMATICALLY_VERIFIED',
            'source_image_mutated': False,
            'network_default': 'none',
            'readiness': 'Image consistency verified; desktop, browser and fresh-instance behavior require runtime checks'
        }
        _write_private(destination / 'manifest.json', result)
        checksum = destination / (target.name + '.sha256')
        with checksum.open('x', encoding='ascii', newline='\n') as stream:
            stream.write(result['image']['sha256'] + '  ' + target.name + '\n')
        return {'exported': True, 'directory': str(destination), 'manifest': result}

def accelerator_default():
    if platform.machine().lower() in ('arm64', 'aarch64'):
        return 'tcg'  # This distribution is x86_64; hardware cross-ISA acceleration is unavailable.
    return {'Windows': 'whpx', 'Darwin': 'hvf', 'Linux': 'kvm'}.get(platform.system(), 'tcg')

def import_image(path, expected, accel=None, memory_mb=4096, cpus=2, vnc_port=5901, network='none'):
    expected = expected_hash(expected)
    source = regular(Path(path))
    accel = accel or accelerator_default()
    if accel not in ('whpx', 'hvf', 'kvm', 'tcg') or network not in ('none', 'nat'):
        raise ValueError('Invalid accelerator or network mode')
    if accel != 'tcg' and platform.machine().lower() in ('arm64', 'aarch64'):
        raise ValueError('This x86_64 image requires explicit TCG emulation on ARM64 hosts')
    if not (type(memory_mb) is int and 256 <= memory_mb <= 32768 and type(cpus) is int and 1 <= cpus <= 16
            and type(vnc_port) is int and 5900 <= vnc_port <= 65535):
        raise ValueError('Resource or loopback VNC port bounds are invalid')
    _state_boundary()
    if vm.STATE.exists() and any(vm.STATE.iterdir()):
        raise ValueError('Import requires blank local state; no existing files are overwritten')
    verify(source, expected)
    with lifecycle_lock():
        if any(p.name != 'lifecycle.lock' for p in vm.STATE.iterdir()):
            raise ValueError('Local state is no longer blank; refusing overwrite')
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', vnc_port))
        target = vm.STATE / 'desktop.qcow2'
        with source.open('rb') as incoming, target.open('xb') as outgoing:
            shutil.copyfileobj(incoming, outgoing, 4 * 1024 * 1024)
        if os.name != 'nt': target.chmod(0o600)
        if digest(target) != expected:
            raise RuntimeError('Copied image checksum mismatch; partial private state retained for inspection')
        metadata = check(target)
        identifier = str(uuid.uuid4())
        config = {'disk': 'desktop.qcow2', 'iso': None, 'memory_mb': memory_mb, 'cpus': cpus,
                  'accel': accel, 'network': network, 'vnc_port': vnc_port, 'instance_id': identifier}
        _write_private(vm.STATE / 'config.json', config)
        _write_private(vm.STATE / 'image-origin.json', {'schema': SCHEMA, 'sha256': expected,
                       'instance_id': identifier, 'virtual_size': metadata['virtual_size']})
        return {'imported': True, 'instance_id': identifier, 'configured': True, 'state': 'stopped',
                'accelerator': accel, 'network': network, 'next': 'python runtime/vm.py start; verify guest desktop and fresh identity'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    export = commands.add_parser('export')
    export.add_argument('--output-dir', type=Path)
    export.add_argument('--clean-base-reviewed', action='store_true', required=True)
    verify_parser = commands.add_parser('verify')
    verify_parser.add_argument('image', type=Path)
    verify_parser.add_argument('--sha256', required=True)
    install = commands.add_parser('import')
    install.add_argument('image', type=Path)
    install.add_argument('--sha256', required=True)
    install.add_argument('--accel', choices=['whpx', 'hvf', 'kvm', 'tcg'])
    install.add_argument('--memory-mb', type=int, default=4096)
    install.add_argument('--cpus', type=int, default=2)
    install.add_argument('--vnc-port', type=int, default=5901)
    install.add_argument('--network', choices=['none', 'nat'], default='none')
    args = parser.parse_args()
    try:
        if args.action == 'export': result = export_image(args.output_dir, args.clean_base_reviewed)
        elif args.action == 'verify': result = verify(args.image, args.sha256)
        else: result = import_image(args.image, args.sha256, args.accel, args.memory_mb, args.cpus, args.vnc_port, args.network)
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__': sys.exit(main())
