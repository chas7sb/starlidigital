"""Local QEMU Linux VM lifecycle. Python 3.10+, standard library only."""
from __future__ import annotations
import argparse
import contextlib
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parent
STATE = ROOT / 'state'

def binary(name):
    suffix = '.exe' if os.name == 'nt' else ''
    candidates = [ROOT / 'vendor' / 'qemu' / (name + suffix)]
    if os.name == 'nt':
        candidates.append(Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'qemu' / (name + suffix))
    return next((str(p) for p in candidates if p.is_file()), shutil.which(name))

def load():
    return json.loads((STATE / 'config.json').read_text())

def save(path, obj):
    pending = path.with_suffix('.tmp')
    pending.write_text(json.dumps(obj, indent=2) + '\n')
    pending.replace(path)
    if os.name != 'nt':
        path.chmod(0o600)

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

class QMP:
    def __init__(self, number):
        self.sock = socket.create_connection(('127.0.0.1', number), timeout=3)
        self.file = self.sock.makefile('rwb')
        if 'QMP' not in self.read():
            raise RuntimeError('Invalid QMP greeting')
        self.execute('qmp_capabilities')

    def read(self):
        line = self.file.readline(1024 * 1024)
        if not line:
            raise RuntimeError('QMP disconnected')
        return json.loads(line)

    def execute(self, command, arguments=None):
        request = {'execute': command, 'id': str(uuid.uuid4())}
        if arguments is not None:
            request['arguments'] = arguments
        self.file.write(json.dumps(request).encode() + b'\n')
        self.file.flush()
        while True:
            result = self.read()
            if result.get('id') == request['id']:
                if 'error' in result:
                    raise RuntimeError(str(result['error']))
                return result.get('return')

    def close(self):
        self.file.close()
        self.sock.close()

def connect():
    meta = json.loads((STATE / 'process.json').read_text())
    qmp = QMP(meta['qmp_port'])
    if qmp.execute('query-name').get('name') != meta['name']:
        qmp.close()
        raise RuntimeError('VM identity mismatch; refusing control')
    return qmp, meta

def probe():
    executable = binary('qemu-system-x86_64')
    recommended = {'Windows': 'whpx', 'Linux': 'kvm', 'Darwin': 'hvf'}.get(platform.system())
    explicit = platform.machine().lower() not in ('amd64', 'x86_64') or recommended is None
    if explicit:
        recommended = 'tcg'
    result = {'host': platform.system(), 'architecture': platform.machine(),
              'qemu': executable, 'recommended_accelerator': recommended,
              'requires_explicit_accelerator_selection': explicit,
              'note': 'Accelerator listing is compile-time availability, not a successful VM boot.'}
    if executable:
        for flag, key in [('--version', 'version'), ('-accel help', 'accelerators')]:
            run = subprocess.run([executable, *flag.split()], capture_output=True, text=True, timeout=15)
            result[key] = (run.stdout + run.stderr).strip()
    return result

def init(args):
    if args.accel is None:
        if platform.machine().lower() not in ('amd64', 'x86_64'):
            raise RuntimeError('This launcher boots an x86_64 guest. On ARM hosts explicitly select --accel tcg; native ARM guests are not implemented.')
        args.accel = {'Windows': 'whpx', 'Linux': 'kvm', 'Darwin': 'hvf'}.get(platform.system())
        if not args.accel:
            raise RuntimeError('Unknown host accelerator; explicitly choose --accel tcg')
    if (STATE / 'config.json').exists():
        raise RuntimeError('VM already configured; config and disk are retained')
    image = binary('qemu-img')
    if not image:
        raise RuntimeError('Install QEMU first (qemu-img is missing)')
    STATE.mkdir(parents=True, exist_ok=True)
    if os.name != 'nt':
        STATE.chmod(0o700)
    disk = STATE / 'desktop.qcow2'
    if disk.exists():
        raise RuntimeError('Existing disk found; refusing overwrite')
    subprocess.run([image, 'create', '-f', 'qcow2', str(disk), f'{args.disk_gb}G'], check=True)
    iso = Path(args.iso).resolve()
    if not iso.is_file():
        disk.unlink()
        raise RuntimeError('Installer ISO does not exist')
    try:
        iso_name = str(iso.relative_to(STATE))
    except ValueError:
        iso_name = str(iso)
    save(STATE / 'config.json', {'disk': disk.name, 'iso': iso_name,
         'instance_id': str(uuid.uuid4()),
         'memory_mb': args.memory_mb, 'cpus': args.cpus, 'accel': args.accel,
         'network': args.network, 'vnc_port': args.vnc_port})
    return {'configured': True, 'guest_installed': False, 'next': 'start, then complete Linux installation through local VNC'}

def command(config, qmp_port, name, serial_port=None):
    executable = binary('qemu-system-x86_64')
    if not executable:
        raise RuntimeError('QEMU missing; run doctor for details')
    if config['accel'] != 'tcg' and platform.machine().lower() not in ('amd64', 'x86_64'):
        raise RuntimeError('An x86_64 guest cannot use this hardware accelerator on an ARM host. Explicitly configure accel:tcg or use an x86_64 host.')
    if config['vnc_port'] < 5900 or config['vnc_port'] > 65535:
        raise RuntimeError('VNC port outside range 5900..65535')
    def esc(value):
        return str(value).replace(',', ',,')
    def local(value):
        candidate = Path(value)
        return str(candidate if candidate.is_absolute() else STATE / candidate)
    cmd = [executable, '-name', name, '-machine', 'q35', '-accel', config['accel'],
           '-m', str(config['memory_mb']), '-smp', str(config['cpus']),
           '-drive', f"file={esc(local(config['disk']))},format=qcow2,if=virtio",
           '-vga', 'std', '-display', 'none', '-vnc', f"127.0.0.1:{config['vnc_port'] - 5900}",
           '-qmp', f'tcp:127.0.0.1:{qmp_port},server=on,wait=off',
           '-monitor', 'none',
           '-device', 'qemu-xhci', '-device', 'usb-tablet',
           '-object', 'rng-builtin,id=entropy', '-device', 'virtio-rng-pci,rng=entropy', '-no-reboot']
    if config.get('instance_id'):
        try:
            identity = str(uuid.UUID(config['instance_id']))
        except (ValueError, AttributeError, TypeError) as error:
            raise RuntimeError('Invalid persistent VM instance_id UUID') from error
        cmd += ['-uuid', identity]
    if serial_port:
        cmd += ['-chardev', f"socket,id=console,host=127.0.0.1,port={serial_port},server=on,wait=off,logfile={esc(STATE / 'serial.log')}", '-serial', 'chardev:console']
    else:
        cmd += ['-serial', f"file:{STATE / 'serial.log'}"]
    if config.get('iso'):
        cmd += ['-cdrom', local(config['iso']), '-boot', 'order=d,menu=on']
    if config['network'] == 'nat':
        cmd += ['-nic', 'user,model=virtio-net-pci,ipv6=off']
    else:
        cmd += ['-nic', 'none']
    return cmd

def status():
    if not (STATE / 'process.json').exists():
        return {'state': 'stopped', 'configured': (STATE / 'config.json').exists()}
    try:
        qmp, meta = connect()
        with contextlib.closing(qmp):
            result = qmp.execute('query-status')
        return {'state': result['status'], 'pid': meta['pid'], 'vnc': meta['vnc'],
                'accel': meta['accel'], 'guest_readiness': 'not checked'}
    except (OSError, ValueError, RuntimeError) as error:
        return {'state': 'unreachable', 'detail': str(error),
                'note': 'Stale state or VM failure; start refuses to overwrite tracking. Inspect log and process before clearing state.'}

def start():
    if (STATE / 'process.json').exists():
        raise RuntimeError('Tracked VM exists; use status/stop first')
    config = load()
    number, serial_port, name = port(), port(), 'starlidigital-' + str(uuid.uuid4())
    cmd = command(config, number, name, serial_port)
    with (STATE / 'qemu.log').open('ab') as log:
        options = {'stdin': subprocess.DEVNULL, 'stdout': log, 'stderr': log}
        if os.name == 'nt':
            options['creationflags'] = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
        else:
            options['start_new_session'] = True
        proc = subprocess.Popen(cmd, **options)
    meta = {'pid': proc.pid, 'qmp_port': number, 'name': name,
            'vnc': f"127.0.0.1:{config['vnc_port']}", 'accel': config['accel'], 'serial_port': serial_port}
    save(STATE / 'process.json', meta)
    for _ in range(40):
        if proc.poll() is not None:
            (STATE / 'process.json').unlink()
            raise RuntimeError('QEMU exited; inspect runtime/state/qemu.log. No accelerator fallback was attempted.')
        try:
            qmp, _ = connect()
            qmp.close()
            return status()
        except (OSError, RuntimeError):
            time.sleep(.25)
    raise RuntimeError('QMP readiness timeout; process tracking retained for inspection')

def stop(force=False):
    qmp, meta = connect()
    with contextlib.closing(qmp):
        qmp.execute('quit' if force else 'system_powerdown')
    for _ in range(60):
        try:
            qmp, _ = connect()
            qmp.close()
        except OSError:
            (STATE / 'process.json').unlink(missing_ok=True)
            return {'state': 'stopped', 'forced': force}
        time.sleep(.5)
    return {'state': 'shutdown-requested', 'note': 'Guest did not exit within 30s. Use stop --force only if disk data loss is acceptable.'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('doctor')
    create = sub.add_parser('init')
    create.add_argument('--iso', required=True)
    create.add_argument('--accel', choices=['whpx', 'kvm', 'hvf', 'tcg'], help='Default WHPX/KVM/HVF on x86 hosts; ARM requires explicit tcg')
    create.add_argument('--memory-mb', type=int, default=4096)
    create.add_argument('--cpus', type=int, default=2)
    create.add_argument('--disk-gb', type=int, default=24)
    create.add_argument('--vnc-port', type=int, default=5901)
    create.add_argument('--network', choices=['none', 'nat'], default='none')
    sub.add_parser('start')
    sub.add_parser('status')
    halt = sub.add_parser('stop')
    halt.add_argument('--force', action='store_true')
    args = parser.parse_args()
    lock = None
    try:
        if args.action in ('init', 'start', 'stop'):
            STATE.mkdir(parents=True, exist_ok=True)
            lock = os.open(STATE / 'lifecycle.lock', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(lock, str(os.getpid()).encode())
        if args.action == 'init':
            if not (256 <= args.memory_mb <= 32768 and 1 <= args.cpus <= 16 and 1 <= args.disk_gb <= 256):
                raise RuntimeError('Resource bounds: RAM 256..32768 MiB, CPUs 1..16, disk 1..256 GiB')
            result = init(args)
        else:
            result = {'doctor': probe, 'start': start, 'status': status,
                      'stop': lambda: stop(args.force)}[args.action]()
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 1
    finally:
        if lock is not None:
            os.close(lock)
            (STATE / 'lifecycle.lock').unlink(missing_ok=True)
    return 0

if __name__ == '__main__':
    sys.exit(main())
