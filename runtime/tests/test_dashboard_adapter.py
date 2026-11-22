import importlib.util
import json
from pathlib import Path
import tempfile
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

if __name__ == '__main__': unittest.main()
