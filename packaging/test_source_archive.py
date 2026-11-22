import hashlib
import json
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('archive', Path(__file__).with_name('source_archive.py'))
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        subprocess.run(['git', 'config', 'core.autocrlf', 'false'], cwd=self.root, check=True)
        for name, content in {
            'LICENSE': 'Fixture license', 'dashboard/LICENSE': 'Upstream notice',
            'platform/package.json': '{}', 'platform/package-lock.json': '{}',
            'dashboard/package.json': '{}', 'dashboard/package-lock.json': '{}',
            'dashboard/pyproject.toml': '[project]', 'installer/start.sh': '#!/bin/sh\n',
        }.items():
            self.write(name, content)
        self.stage()

    def write(self, name, content):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding='utf-8')

    def stage(self):
        subprocess.run(['git', 'add', '--all'], cwd=self.root, check=True)

    def test_reproducible_and_index_only(self):
        self.write('untracked.txt', 'do not include')
        self.write('LICENSE', 'unstaged alteration')
        first = archive.create(self.root, self.root / 'out-a', 'test')
        second = archive.create(self.root, self.root / 'out-b', 'test')
        self.assertEqual(hashlib.sha256(first.read_bytes()).digest(), hashlib.sha256(second.read_bytes()).digest())
        with zipfile.ZipFile(first) as z:
            self.assertFalse(any('untracked' in n for n in z.namelist()))
            self.assertEqual(z.read('starlidigital-test/LICENSE'), b'Fixture license')
            self.assertIn('starlidigital-test/SOURCE-MANIFEST.json', z.namelist())

    def test_tracked_sensitive_file_blocks_release(self):
        self.write('installer/local.env', 'dummy=fixture')
        self.stage()
        with self.assertRaisesRegex(ValueError, 'Sensitive/runtime'):
            archive.create(self.root, self.root / 'out', 'test')

    def test_tracked_runtime_state_blocks_release(self):
        self.write('platform/server/data/database.sqlite-wal', 'fixture')
        self.write('platform/server/data/preview.mp4', 'fixture')
        self.stage()
        with self.assertRaisesRegex(ValueError, 'Runtime/generated'):
            archive.checked_paths(self.root)

    def test_missing_license_blocks_release(self):
        (self.root / 'dashboard/LICENSE').unlink()
        self.stage()
        with self.assertRaisesRegex(ValueError, 'provenance missing'):
            archive.create(self.root, self.root / 'out', 'test')

    def test_invalid_version_blocks_path_injection(self):
        with self.assertRaisesRegex(ValueError, 'Version must'):
            archive.create(self.root, self.root / 'out', '../bad')

    def test_symlink_index_entry_is_rejected(self):
        blob = subprocess.check_output(['git', 'hash-object', '-w', '--stdin'], input=b'../elsewhere', cwd=self.root).decode().strip()
        subprocess.run(['git', 'update-index', '--add', '--cacheinfo', f'120000,{blob},platform/link'], cwd=self.root, check=True)
        with self.assertRaisesRegex(ValueError, 'Unsupported index entry'):
            archive.checked_paths(self.root)

    def test_onboarding_is_included_but_local_state_is_rejected(self):
        self.write('onboarding/first_run.py', '# fixture')
        self.stage()
        self.assertIn(('onboarding/first_run.py', 0o644), archive.checked_paths(self.root))
        self.write('onboarding/.local/owner.json', '{}')
        self.stage()
        with self.assertRaisesRegex(ValueError, 'Runtime/generated'):
            archive.checked_paths(self.root)

    def test_vendored_source_exception_requires_indexed_hash_evidence(self):
        name = 'platform/extensions/search/source/searx/data/engine_traits.json'
        self.write(name, '{"fixture": true}')
        digest = hashlib.sha256((self.root / name).read_bytes()).hexdigest()
        self.write('platform/extensions/extraction-manifest.json', json.dumps({
            'files': [{'path': 'search/source/searx/data/engine_traits.json', 'sha256': digest}]}))
        self.stage()
        self.assertIn((name, 0o644), archive.checked_paths(self.root))
        self.write(name, '{"changed": true}')
        # Unstaged edits do not change the indexed provenance decision.
        self.assertIn((name, 0o644), archive.checked_paths(self.root))
        self.stage()
        with self.assertRaisesRegex(ValueError, 'no matching source evidence'):
            archive.checked_paths(self.root)

    def test_batch_preserves_unicode_paths_and_repeated_blob_ids(self):
        self.write('docs/space name.txt', 'same content')
        self.write('docs/\u00e9vidence.txt', 'same content')
        self.stage()
        self.write('docs/space name.txt', 'unstaged content')
        result = archive.create(self.root, self.root / 'out', 'test')
        with zipfile.ZipFile(result) as z:
            self.assertEqual(z.read('starlidigital-test/docs/space name.txt'), b'same content')
            self.assertEqual(z.read('starlidigital-test/docs/\u00e9vidence.txt'), b'same content')

if __name__ == '__main__':
    unittest.main()
