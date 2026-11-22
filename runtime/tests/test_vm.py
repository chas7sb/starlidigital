import importlib.util
from pathlib import Path
import socket
import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('vm', Path(__file__).parents[1] / 'vm.py')
vm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vm)

class LifecycleTests(unittest.TestCase):
    def test_default_boundary_and_explicit_accelerator(self):
        cfg = dict(disk='C:/some,where/disk.qcow2', iso='installer.iso', memory_mb=1024,
                   cpus=1, accel='whpx', network='none', vnc_port=5901)
        with patch.object(vm, 'binary', return_value='qemu'), patch.object(vm.platform, 'machine', return_value='x86_64'):
            args = vm.command(cfg, 12345, 'test')
        self.assertEqual(args[args.index('-accel') + 1], 'whpx')
        self.assertEqual(args[args.index('-nic') + 1], 'none')
        self.assertEqual(args[args.index('-vnc') + 1], '127.0.0.1:1')
        self.assertIn('server=on,wait=off', args[args.index('-qmp') + 1])
        self.assertIn('some,,where', args[args.index('-drive') + 1])
        for unsafe in ('-virtfs', '-fsdev', '-spice', '-usbdevice'):
            self.assertNotIn(unsafe, args)

    def test_qmp_ignores_events_and_matches_response(self):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        def server():
            conn, _ = listener.accept()
            with conn, conn.makefile('rwb') as stream:
                stream.write(b'{"QMP":{}}\n')
                stream.flush()
                for result in ({}, {'status': 'running'}):
                    request = json.loads(stream.readline())
                    stream.write(b'{"event":"RESUME"}\n')
                    stream.write(json.dumps({'return': result, 'id': request['id']}).encode() + b'\n')
                    stream.flush()
            listener.close()
        thread = threading.Thread(target=server, daemon=True)
        thread.start()
        qmp = vm.QMP(listener.getsockname()[1])
        self.assertEqual(qmp.execute('query-status'), {'status': 'running'})
        qmp.close()
        thread.join(5)
        self.assertFalse(thread.is_alive())

    def test_bad_vnc_port_rejected(self):
        with patch.object(vm, 'binary', return_value='qemu'):
            with self.assertRaises(RuntimeError):
                vm.command({'vnc_port': 80, 'accel': 'tcg'}, 12345, 'test')

    def test_arm_requires_explicit_software_emulation(self):
        with patch.object(vm.platform, 'machine', return_value='arm64'):
            with self.assertRaisesRegex(RuntimeError, 'explicitly select --accel tcg'):
                vm.init(SimpleNamespace(accel=None))
            with patch.object(vm, 'binary', return_value='qemu'):
                with self.assertRaisesRegex(RuntimeError, 'ARM host'):
                    vm.command({'accel': 'hvf'}, 12345, 'test')

    def test_persistent_uuid_passed_to_guest(self):
        identity = '5b66e7d1-9e4f-4c28-a8fb-e6275c252a9e'
        cfg = dict(disk='desktop.qcow2', iso=None, memory_mb=1024, cpus=1,
                   accel='tcg', network='none', vnc_port=5901, instance_id=identity)
        with patch.object(vm, 'binary', return_value='qemu'):
            args = vm.command(cfg, 12345, 'test')
        self.assertEqual(args[args.index('-uuid') + 1], identity)

if __name__ == '__main__':
    unittest.main()
