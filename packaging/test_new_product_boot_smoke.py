"""Boundary tests for the new product smoke; actual boot is a separate command."""
import importlib.util
from pathlib import Path
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


if __name__ == '__main__':
    unittest.main()
