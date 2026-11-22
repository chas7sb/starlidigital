"""Bounded local-owner console for the single tracked QEMU guest.

No caller-controlled executable, host, port, filename or QMP command is accepted.
Guest networking and installed desktop readiness are independent of process state.
"""
from __future__ import annotations
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import struct
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('_starli_owned_vm', ROOT / 'vm.py')
vm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vm)
_lock = threading.Lock()
_last = {}

class Unavailable(RuntimeError): pass
class Busy(RuntimeError): pass

def _checked_state():
    if vm.STATE.resolve() != (ROOT / 'state').resolve() or vm.STATE.is_symlink():
        raise Unavailable('VM state boundary is invalid')
    for name in ('config.json', 'process.json'):
        path = vm.STATE / name
        if path.is_symlink():
            raise Unavailable('VM state must be a regular local file')
        if path.exists() and (not path.is_file() or path.stat().st_size > 16384):
            raise Unavailable('VM state is invalid')
    if (vm.STATE / 'process.json').exists():
        data = json.loads((vm.STATE / 'process.json').read_text())
        if (not re.fullmatch(r'starlidigital-[0-9a-f-]{36}', str(data.get('name', '')))
                or type(data.get('qmp_port')) is not int or not 1024 <= data['qmp_port'] <= 65535):
            raise Unavailable('VM tracking identity is invalid')
        try:
            identifier = data['name'].removeprefix('starlidigital-')
            if str(uuid.UUID(identifier)) != identifier:
                raise ValueError('Noncanonical UUID')
        except ValueError:
            raise Unavailable('VM tracking UUID is invalid') from None

@contextlib.contextmanager
def operation(kind, interval=.1):
    if not _lock.acquire(blocking=False):
        raise Busy('VM operation already in progress')
    try:
        _checked_state()
        now = time.monotonic()
        if now - _last.get(kind, 0) < interval:
            raise Busy('Wait before repeating this VM operation')
        _last[kind] = now
        yield
    finally:
        _lock.release()

def status():
    with operation('status', .25):
        result = vm.status()
        # Never send host paths, process IDs or local debug details to the UI.
        return {'state': result['state'], 'configured': (vm.STATE / 'config.json').is_file(),
                'guest_readiness': 'Verify the displayed guest; process state does not establish desktop readiness',
                'accelerator': result.get('accel'), 'scope': 'installation-owner-local-vm'}

def lifecycle(action):
    if action not in ('start', 'stop'):
        raise ValueError('Unsupported VM lifecycle action')
    with operation('lifecycle', 2):
        vm.STATE.mkdir(parents=True, exist_ok=True)
        descriptor = None
        try:
            descriptor = os.open(vm.STATE / 'lifecycle.lock', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(descriptor, str(os.getpid()).encode())
            if action == 'start':
                config = vm.load()
                # Lifecycle may only use the fixed disk and optional ISO from local state.
                if config.get('disk') != 'desktop.qcow2':
                    raise Unavailable('Dashboard lifecycle requires the fixed local VM disk')
                if (vm.STATE / 'desktop.qcow2').is_symlink():
                    raise Unavailable('Dashboard lifecycle refuses a linked VM disk')
                iso = config.get('iso')
                if iso and (Path(iso).is_absolute() or Path(iso).drive or '..' in Path(iso).parts
                            or (vm.STATE / iso).is_symlink()):
                    raise Unavailable('Dashboard lifecycle requires an ISO inside local VM state')
                result = vm.start()
            else:
                result = vm.stop(False)
            return {'state': result['state'], 'guest_readiness': 'not checked'}
        finally:
            if descriptor is not None:
                os.close(descriptor)
                (vm.STATE / 'lifecycle.lock').unlink(missing_ok=True)

def frame():
    with operation('frame', .5):
        target = vm.STATE / 'dashboard-frame.png'
        if target.is_symlink():
            raise Unavailable('Invalid frame destination')
        qmp, _ = vm.connect()
        with contextlib.closing(qmp):
            if qmp.execute('query-status')['status'] != 'running':
                raise Unavailable('VM is not running')
            qmp.execute('screendump', {'filename': str(target), 'format': 'png'})
        if not target.is_file() or target.stat().st_size > 16 * 1024 * 1024:
            raise Unavailable('VM frame is unavailable or too large')
        image = target.read_bytes()
        if not image.startswith(b'\x89PNG\r\n\x1a\n'):
            raise Unavailable('VM did not return a PNG frame')
        return image

def _receive(sock, size):
    if not 0 <= size <= 65536:
        raise Unavailable('Invalid guest transport response')
    data = bytearray()
    while len(data) < size:
        part = sock.recv(size - len(data))
        if not part:
            raise Unavailable('Guest transport disconnected')
        data.extend(part)
    return bytes(data)

@contextlib.contextmanager
def _vnc():
    config = vm.load()
    number = config.get('vnc_port')
    if type(number) is not int or not 5900 <= number <= 65535:
        raise Unavailable('Invalid guest transport')
    qmp, _ = vm.connect()
    with contextlib.closing(qmp):
        if qmp.execute('query-status')['status'] != 'running':
            raise Unavailable('VM is not running')
        with socket.create_connection(('127.0.0.1', number), timeout=3) as sock:
            if _receive(sock, 12) != b'RFB 003.008\n':
                raise Unavailable('Unexpected guest transport version')
            sock.sendall(b'RFB 003.008\n')
            types = _receive(sock, _receive(sock, 1)[0])
            if 1 not in types:
                raise Unavailable('Local guest transport unavailable')
            sock.sendall(b'\x01')
            if _receive(sock, 4) != b'\0\0\0\0':
                raise Unavailable('Local guest transport rejected')
            sock.sendall(b'\x01')
            header = _receive(sock, 24)
            _receive(sock, struct.unpack('!I', header[20:24])[0])
            width, height = struct.unpack('!HH', header[:4])
            if not 1 <= width <= 8192 or not 1 <= height <= 8192:
                raise Unavailable('Guest framebuffer exceeds bounds')
            yield sock, width, height

def _key(sock, code, down):
    sock.sendall(struct.pack('!BBHI', 4, int(down), 0, code))

KEYS = {'Enter': 0xff0d, 'Tab': 0xff09, 'Escape': 0xff1b, 'Backspace': 0xff08,
        'Delete': 0xffff, 'Home': 0xff50, 'End': 0xff57, 'ArrowLeft': 0xff51,
        'ArrowUp': 0xff52, 'ArrowRight': 0xff53, 'ArrowDown': 0xff54,
        'PageUp': 0xff55, 'PageDown': 0xff56}

def input_event(kind, **payload):
    with operation('input', .1):
        with _vnc() as (sock, width, height):
            if kind == 'pointer':
                x, y, button = payload.get('x'), payload.get('y'), payload.get('button', 'left')
                if (type(x) is not int or type(y) is not int or not 0 <= x < width or not 0 <= y < height
                        or button not in ('left', 'right')):
                    raise ValueError('Pointer outside guest framebuffer')
                sock.sendall(struct.pack('!BBHH', 5, 1 if button == 'left' else 4, x, y))
                sock.sendall(struct.pack('!BBHH', 5, 0, x, y))
            elif kind == 'key':
                key = payload.get('key')
                if key not in KEYS:
                    raise ValueError('Unsupported guest key')
                _key(sock, KEYS[key], True)
                _key(sock, KEYS[key], False)
            elif kind == 'text':
                text = payload.get('text')
                if not isinstance(text, str) or not 1 <= len(text) <= 1000 or any(ord(c) < 32 or ord(c) > 126 for c in text):
                    raise ValueError('Use 1 to 1000 printable ASCII characters; Enter is a separate key')
                shifted, base = '~!@#$%^&*()_+{}|:"<>?', '`1234567890-=[]\\;\',./'
                for char in text:
                    shift = char.isupper() or char in shifted
                    char = base[shifted.index(char)] if char in shifted else char.lower() if shift else char
                    if shift: _key(sock, 0xffe1, True)
                    _key(sock, ord(char), True)
                    _key(sock, ord(char), False)
                    if shift: _key(sock, 0xffe1, False)
                    time.sleep(.005)
            else:
                raise ValueError('Unsupported guest input')
        return {'delivered': True, 'scope': 'guest-input-only', 'application_result': 'not verified'}
