"""Local VM screenshot and keyboard bridge; never connects to remote hosts."""
import argparse
import contextlib
import json
from pathlib import Path
import socket
import struct
import sys
import time
import vm

def receive(sock, size):
    result = b''
    while len(result) < size:
        block = sock.recv(size - len(result))
        if not block:
            raise RuntimeError('VNC disconnected')
        result += block
    return result

@contextlib.contextmanager
def vnc():
    cfg = vm.load()
    # Verify this is our tracked running VM before sending input.
    qmp, _ = vm.connect()
    qmp.close()
    with socket.create_connection(('127.0.0.1', cfg['vnc_port']), timeout=5) as sock:
        version = receive(sock, 12)
        if version != b'RFB 003.008\n':
            raise RuntimeError('Expected RFB 3.8')
        sock.sendall(version)
        choices = receive(sock, receive(sock, 1)[0])
        if 1 not in choices:
            raise RuntimeError('Expected local VNC no-auth transport')
        sock.sendall(b'\x01')
        if receive(sock, 4) != b'\0\0\0\0':
            raise RuntimeError('VNC security handshake failed')
        sock.sendall(b'\x01')
        header = receive(sock, 24)
        receive(sock, struct.unpack('!I', header[20:24])[0])
        # QEMU initializes per-client absolute pointer mode in SetEncodings.
        # Without this normal RFB handshake step it treats clicks as relative.
        sock.sendall(struct.pack('!BBHi', 2, 0, 1, 0))
        yield sock, struct.unpack('!HH', header[:4])

def type_text(text):
    with vnc() as (sock, size):
        for char in text:
            shifted = '~!@#$%^&*()_+{}|:"<>?'
            base = '`1234567890-=[]\\;\',./'
            shift = char.isascii() and char.isupper() or char in shifted
            if char in shifted:
                char = base[shifted.index(char)]
            key = {'\n': 0xff0d, '\r': 0xff0d, '\t': 0xff09, '\b': 0xff08}.get(char, ord(char))
            if key > 0xffff:
                key |= 0x01000000
            if shift:
                sock.sendall(struct.pack('!BBHI', 4, 1, 0, 0xffe1))
            sock.sendall(struct.pack('!BBHI', 4, 1, 0, key))
            sock.sendall(struct.pack('!BBHI', 4, 0, 0, key))
            if shift:
                sock.sendall(struct.pack('!BBHI', 4, 0, 0, 0xffe1))
            time.sleep(.015)

def pointer(x, y, button):
    with vnc() as (sock, (width, height)):
        if not (0 <= x < width and 0 <= y < height):
            raise RuntimeError(f'Coordinates outside {width}x{height} framebuffer')
        mask = {'move': 0, 'left': 1, 'middle': 2, 'right': 4}[button]
        sock.sendall(struct.pack('!BBHH', 5, mask, x, y))
        if mask:
            time.sleep(.05)
            sock.sendall(struct.pack('!BBHH', 5, 0, x, y))
        time.sleep(.05)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    actions.add_parser('type', help='Type stdin into the VM; include a newline to press Enter')
    snap = actions.add_parser('screenshot')
    snap.add_argument('path', help='Output .ppm or .png file (PNG requires QEMU PNG support)')
    click = actions.add_parser('pointer', help='Move/click guest pointer in framebuffer coordinates')
    click.add_argument('x', type=int)
    click.add_argument('y', type=int)
    click.add_argument('--button', choices=['move', 'left', 'middle', 'right'], default='left')
    args = parser.parse_args()
    if args.action == 'type':
        type_text(sys.stdin.read())
    elif args.action == 'pointer':
        pointer(args.x, args.y, args.button)
    else:
        qmp, _ = vm.connect()
        with contextlib.closing(qmp):
            path = Path(args.path).resolve()
            qmp.execute('screendump', {'filename': str(path), 'format': 'png' if path.suffix.lower() == '.png' else 'ppm'})

if __name__ == '__main__':
    main()
