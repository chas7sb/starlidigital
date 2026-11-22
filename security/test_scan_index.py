import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('scan_index.py').resolve()
spec = importlib.util.spec_from_file_location('scan_index', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class IndexScannerTests(unittest.TestCase):
    def test_immutable_staged_bytes_and_delta(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def git(*args):
                return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)
            git('init')
            source = root / 'sample.txt'
            source.write_text('initial\n')
            git('add', 'sample.txt')
            git('-c', 'user.name=Scanner Test', '-c', 'user.email=scanner@example.invalid', 'commit', '-m', 'baseline')
            sentinel = 'sk-' + 'Z' * 24
            source.write_text(sentinel + '\n')
            git('add', 'sample.txt')
            source.write_text('unstaged clean text\n')
            report = module.screen(root, 'HEAD')
            self.assertEqual(report['content_selected_count'], 1)
            self.assertTrue(report['index_unchanged_during_scan'])
            self.assertTrue(any(f['type'] == 'provider-token' for f in report['findings']))
            self.assertNotIn(sentinel, json.dumps(report))
            self.assertEqual(report['scanned_blobs'][0]['oid'], git('rev-parse', ':sample.txt').decode().strip())

    def test_help_does_not_require_checkout_or_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(['python', str(SCRIPT), '--help'], cwd=tmp, capture_output=True)
            self.assertEqual(result.returncode, 0)
            self.assertIn(b'--root', result.stdout)

if __name__ == '__main__':
    unittest.main()
