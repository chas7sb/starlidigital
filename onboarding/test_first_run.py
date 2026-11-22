import importlib.util
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('first_run', Path(__file__).with_name('first_run.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class FirstRunTests(unittest.TestCase):
    def test_only_literal_loopback_origins(self):
        for value in ['http://127.0.0.1:8080', 'http://[::1]:4100']:
            self.assertEqual(helper.origin(value), value)
        for value in ['http://localhost:8080', 'http://example.com:80', 'http://127.0.0.1:80/path',
                      'http://u:p@127.0.0.1:80', 'http://127.0.0.1', 'http://127.0.0.1:80?x=1', 'http://127.0.0.1:80\n']:
            with self.assertRaises(ValueError, msg=value):
                helper.origin(value)

    def test_redirect_refused(self):
        with self.assertRaises(RuntimeError):
            helper.NoRedirect().redirect_request(None, None, 302, None, None, 'https://example.com')

    def test_state_and_trusted_header_overrides(self):
        with patch.dict(helper.os.environ, {'DATABASE_PATH': '/production', 'STARLI_DATA_DIR': '/production-data', 'ADMIN_PASSWORD': 'must-not-inherit',
                'WEBUI_AUTH_TRUSTED_EMAIL_HEADER': 'x-admin'}):
            env = helper.environment({'secret': 'test', 'platform': 'http://127.0.0.1:4100', 'dashboard': 'http://127.0.0.1:8080'})
        self.assertEqual(env['DATABASE_PATH'], env['STARLI_SOURCE_DATABASE'])
        self.assertEqual(env['DATA_DIR'], env['STARLI_DATA_DIR'])
        self.assertNotEqual(env['DATABASE_PATH'], '/production')
        self.assertNotIn('ADMIN_PASSWORD', env)
        self.assertNotIn('WEBUI_AUTH_TRUSTED_EMAIL_HEADER', env)
        self.assertEqual(env['WEBUI_AUTH'], 'true')
        self.assertEqual(env['STARLI_LOCAL_VM_ENABLED'], '1')

    def test_existing_private_config_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'private.json'
            helper.private_write(path, {'keep': True})
            with self.assertRaises(FileExistsError):
                helper.private_write(path, {'keep': False})
            self.assertIn('true', path.read_text())

    def test_missing_dependencies_fail_before_private_state(self):
        with tempfile.TemporaryDirectory() as directory:
            local = Path(directory) / 'private'
            with patch.object(helper, 'LOCAL', local), patch.object(helper, 'CONFIG', local / 'setup.json'), \
                 patch.object(helper, 'stopped'), patch.object(helper.importlib.util, 'find_spec', return_value=None), \
                 patch.object(helper.sys, 'version_info', (3, 11, 9)):
                with self.assertRaisesRegex(RuntimeError, 'dependency installation incomplete'):
                    helper.setup(SimpleNamespace(dashboard='http://127.0.0.1:8080', platform='http://127.0.0.1:4100'))
            self.assertFalse(local.exists())

if __name__ == '__main__':
    unittest.main()
