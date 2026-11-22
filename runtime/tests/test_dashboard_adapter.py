import importlib.util
import json
from pathlib import Path
import socket
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dashboard_adapter', Path(__file__).parents[1] / 'dashboard_adapter.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

class FakeQMP:
    def __init__(self, name, expected): self.name, self.expected, self.calls = name, expected, []
    def execute(self, method, args=None):
        self.calls.append((method, args))
        if method == 'query-status': return {'status': 'running'}
        if method == 'screendump': Path(args['filename']).write_bytes(b'\x89PNG\r\n\x1a\nfixture')
    def close(self): pass

class AdapterTests(unittest.TestCase):
    def setUp(self): adapter._last.clear()
    def test_frame_has_fixed_path_and_checks_vm_before_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); state = root / 'state'; state.mkdir()
            qmp = FakeQMP('guest', 'guest')
            with patch.object(adapter, 'ROOT', root), patch.object(adapter.vm, 'STATE', state), patch.object(adapter.vm, 'connect', return_value=(qmp, {})):
                self.assertTrue(adapter.frame().startswith(b'\x89PNG'))
                self.assertEqual(qmp.calls[0][0], 'query-status')
                self.assertEqual(qmp.calls[1][1]['filename'], str(state / 'dashboard-frame.png'))
                with self.assertRaises(adapter.Busy): adapter.frame()
    def test_tracking_state_rejects_unexpected_qmp_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); state = root / 'state'; state.mkdir()
            (state/'process.json').write_text(json.dumps({'name':'other-service','qmp_port':4120}))
            with patch.object(adapter, 'ROOT', root), patch.object(adapter.vm, 'STATE', state):
                with self.assertRaises(adapter.Unavailable): adapter.status()
    def test_canonical_tracking_uuid_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); state = root / 'state'; state.mkdir()
            (state/'process.json').write_text(json.dumps({'name':'starlidigital-4cae0f4e-fd9a-44d2-b72f-51128c105229','qmp_port':54321}))
            with patch.object(adapter, 'ROOT', root), patch.object(adapter.vm, 'STATE', state), patch.object(adapter.vm, 'status', return_value={'state':'running','accel':'whpx'}):
                self.assertEqual(adapter.status()['state'],'running')
    def test_lifecycle_refuses_disk_paths_outside_fixed_guest_disk(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); state = root / 'state'; state.mkdir()
            (state/'config.json').write_text(json.dumps({'disk':'../../private.qcow2'}))
            with patch.object(adapter, 'ROOT', root), patch.object(adapter.vm, 'STATE', state), patch.object(adapter.vm, 'start') as start:
                with self.assertRaises(adapter.Unavailable): adapter.lifecycle('start')
                start.assert_not_called()
                self.assertFalse((state/'lifecycle.lock').exists())
    def test_existing_lifecycle_lock_is_not_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); state = root / 'state'; state.mkdir()
            lock = state/'lifecycle.lock'; lock.write_text('other owner')
            with patch.object(adapter, 'ROOT', root), patch.object(adapter.vm, 'STATE', state):
                with self.assertRaises(FileExistsError): adapter.lifecycle('stop')
                self.assertEqual(lock.read_text(), 'other owner')
    def test_input_does_not_accept_control_characters_or_arbitrary_keys(self):
        class Sock:
            def sendall(self, payload): raise AssertionError('No packets should be sent')
        from contextlib import contextmanager
        @contextmanager
        def fake(): yield Sock(), 640, 480
        with patch.object(adapter, '_checked_state'), patch.object(adapter, '_vnc', fake):
            for kind, payload in [('text', {'text':'shell\ncommand'}), ('key', {'key':'arbitrary'}), ('pointer', {'x':640,'y':0})]:
                adapter._last.clear()
                with self.assertRaises(ValueError): adapter.input_event(kind, **payload)
    def test_stop_uses_graceful_powerdown_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); state = root / 'state'; state.mkdir()
            with patch.object(adapter, 'ROOT', root), patch.object(adapter.vm, 'STATE', state), patch.object(adapter.vm, 'stop', return_value={'state':'shutdown-requested'}) as stop:
                self.assertEqual(adapter.lifecycle('stop')['state'], 'shutdown-requested')
                stop.assert_called_once_with(False)

class RFBProtocolTests(unittest.TestCase):
    """Exercise actual loopback socket packets; never touch the real guest."""
    def setUp(self): adapter._last.clear()

    def protocol(self, expected_packets, action):
        listener = socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(1)
        number=listener.getsockname()[1]
        errors=[]; observed=[]
        def receive(sock,size):
            data=b''
            while len(data)<size:
                block=sock.recv(size-len(data))
                if not block: raise AssertionError('RFB client disconnected early')
                data+=block
            return data
        def server():
            try:
                client,_=listener.accept()
                with client:
                    client.settimeout(3)
                    client.sendall(b'RFB 003.008\n')
                    self.assertEqual(receive(client,12),b'RFB 003.008\n')
                    client.sendall(b'\x01\x01')
                    self.assertEqual(receive(client,1),b'\x01')
                    client.sendall(b'\0\0\0\0')
                    self.assertEqual(receive(client,1),b'\x01')
                    name=b'isolated-test-frame'
                    client.sendall(struct.pack('!HH',800,600)+b'\0'*16+struct.pack('!I',len(name))+name)
                    # Must come before every client's input, rather than treating
                    # absolute coordinates as relative movement on a fresh client.
                    self.assertEqual(receive(client,8),struct.pack('!BBHi',2,0,1,0))
                    for size in expected_packets: observed.append(receive(client,size))
            except Exception as error: errors.append(error)
            finally: listener.close()
        worker=threading.Thread(target=server,daemon=True); worker.start()
        qmp=FakeQMP('tracked','tracked')
        try:
            with patch.object(adapter,'_checked_state'),patch.object(adapter.vm,'load',return_value={'vnc_port':number}),patch.object(adapter.vm,'connect',return_value=(qmp,{})):
                action()
        finally:
            worker.join(5)
            listener.close()
        self.assertFalse(worker.is_alive(),'RFB protocol server failed to complete')
        if errors: raise errors[0]
        self.assertEqual(qmp.calls[0][0],'query-status')
        return observed

    def test_set_encodings_precedes_absolute_pointer_press_and_release(self):
        observed=self.protocol([6,6],lambda:adapter.input_event('pointer',x=123,y=234,button='left'))
        self.assertEqual([struct.unpack('!BBHH',packet) for packet in observed],[(5,1,123,234),(5,0,123,234)])

    def test_uppercase_keysyms_and_shifted_punctuation_match_console(self):
        expected=[]
        for code,shift in [(ord('A'),True),(ord('z'),False),(ord('2'),True),(ord('/'),True),(ord(';'),True)]:
            if shift: expected.append((4,1,0,0xffe1))
            expected.extend([(4,1,0,code),(4,0,0,code)])
            if shift: expected.append((4,0,0,0xffe1))
        observed=self.protocol([8]*len(expected),lambda:adapter.input_event('text',text='Az@?:'))
        self.assertEqual([struct.unpack('!BBHI',packet) for packet in observed],expected)

if __name__ == '__main__': unittest.main()
