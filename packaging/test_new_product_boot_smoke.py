"""Boundary tests for the new product smoke; actual boot is a separate command."""
import importlib.util
from pathlib import Path
import os
import select
import socket
import subprocess
import sys
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location('new_product_boot_smoke', Path(__file__).with_name('new_product_boot_smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class Boundaries(unittest.TestCase):
    def test_literal_loopback_only(self):
        self.assertEqual(smoke.literal_origin('http://127.0.0.1:18781/'), 'http://127.0.0.1:18781')
        for value in ('https://example.com', 'http://localhost:80', 'http://user:pass@127.0.0.1:90',
                      'http://127.0.0.1:80/path', 'http://127.0.0.1:80?token=example'):
            with self.assertRaises(ValueError):
                smoke.literal_origin(value)

    def test_state_cannot_escape_ignored_work(self):
        for value in (smoke.ROOT, smoke.ROOT / 'work', smoke.ROOT / 'work/../config/private'):
            with self.assertRaises(ValueError):
                smoke.checked_case(value)

    def test_dependencies_use_actual_host_hash_lock(self):
        target, lock = smoke.target_lock()
        self.assertIn(target, smoke.TARGETS)
        self.assertTrue(lock.is_file())

    def test_no_remote_or_protocol_relative_api_path(self):
        client = smoke.Client('http://127.0.0.1:18781')
        for path in ('https://example.com', '//example.com'):
            with self.assertRaises(ValueError):
                client.request(path)

    def test_listener_release_is_waited_for_and_bounded(self):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(16)
        port = listener.getsockname()[1]
        done = threading.Event()
        def serve():
            while not done.is_set():
                ready, _, _ = select.select([listener], [], [], .02)
                if ready:
                    connection, _ = listener.accept()
                    connection.close()
            listener.close()
        thread = threading.Thread(target=serve)
        thread.start()
        try:
            with self.assertRaisesRegex(RuntimeError, 'LISTENERS_DID_NOT_STOP'):
                smoke.wait_ports_released((port,), timeout=.15)
            done.set()
            smoke.wait_ports_released((port,), timeout=3)
        finally:
            done.set()
            thread.join(3)
        self.assertFalse(thread.is_alive())

    @unittest.skipIf(os.name == 'nt', 'POSIX nested-launcher signal semantics')
    def test_exited_wrapper_can_leave_gracefully_stopping_listener(self):
        with socket.socket() as available:
            available.bind(('127.0.0.1', 0))
            port = available.getsockname()[1]
        server = '''import signal,socket,sys,time
s=socket.socket();s.bind(('127.0.0.1',int(sys.argv[1])));s.listen(16)
def shutdown(*_):
 time.sleep(.7);s.close();sys.exit(0)
signal.signal(signal.SIGTERM,shutdown)
while True:
 c,_=s.accept();c.close()
'''
        wrapper = 'import subprocess,sys; subprocess.call([sys.executable,"-c",sys.argv[1],sys.argv[2]])'
        process = subprocess.Popen([sys.executable, '-c', wrapper, server, str(port)],
                                   start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 5
            while True:
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.2):
                        break
                except OSError:
                    if time.monotonic() > deadline:
                        self.fail('Synthetic nested listener failed to start')
                    time.sleep(.02)
            smoke.stop(process)
            self.assertIsNotNone(process.poll())
            # The wrapper is gone, but its child's intentional graceful delay
            # keeps the service port live. Waiting for wrapper alone is wrong.
            with socket.create_connection(('127.0.0.1', port), timeout=.2):
                pass
            smoke.wait_ports_released((port,), timeout=5)
        finally:
            smoke.stop(process)


if __name__ == '__main__':
    unittest.main()
