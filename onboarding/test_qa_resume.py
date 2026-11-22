import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('qa_resume', Path(__file__).with_name('qa_e2e.py'))
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)

class ResumeTests(unittest.TestCase):
    def test_outside_work_and_work_root_refused(self):
        for path in (qa.m.ROOT, qa.m.ROOT / 'work'):
            with self.assertRaises(ValueError):
                qa.checked_work_path(path)

    def test_linked_state_directory_refused(self):
        with tempfile.TemporaryDirectory(dir=qa.m.ROOT / 'work') as directory:
            base = Path(directory)
            target = base / 'target'; target.mkdir()
            link = base / 'linked'
            try:
                link.symlink_to(target, target_is_directory=True)
            except OSError:
                self.skipTest('Symlink privilege unavailable')
            with self.assertRaises(ValueError):
                qa.checked_work_path(link)

    def test_resume_validates_binding_and_preserves_secret(self):
        with tempfile.TemporaryDirectory(dir=qa.m.ROOT / 'work') as directory:
            local = Path(directory) / 'private'
            config = {'dashboard': 'http://127.0.0.1:18280', 'platform': 'http://127.0.0.1:18281', 'secret': 'a' * 96}
            qa.m.private_write(local / 'setup.json', config)
            qa.m.private_write(local / 'qa-credentials.json', {'email': 'owner@example.invalid', 'password': 'test-only-not-an-account'})
            qa.m.private_write(local / 'owner.json', {'dashboard_id': 'native', 'node_id': 'node', 'company_id': 'company'})
            qa.m.private_write(local / 'bindings.json', {'memberships': {'native': {'v2UserId': 'wrong-node'}}})
            before = (local / 'setup.json').read_bytes()
            with self.assertRaisesRegex(ValueError, 'binding'):
                qa.resume_state(local)
            self.assertEqual((local / 'setup.json').read_bytes(), before)

    def test_occupied_resume_ports_prevent_bootstrap_and_spawn(self):
        config = {'dashboard': 'http://127.0.0.1:18280', 'platform': 'http://127.0.0.1:18281'}
        with patch.object(qa.sys, 'argv', ['qa_e2e.py', '--resume', 'work/private', '--serve']), \
             patch.object(qa, 'resume_state', return_value=(qa.m.ROOT / 'work/private', config, {})), \
             patch.object(qa.m, 'stopped', side_effect=RuntimeError('occupied')), \
             patch.object(qa.subprocess, 'Popen') as spawn, patch.object(qa.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'occupied'):
                qa.execute()
            spawn.assert_not_called(); run.assert_not_called()

if __name__ == '__main__':
    unittest.main()
