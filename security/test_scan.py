import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('scan', Path(__file__).with_name('scan.py'))
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)

class ScannerTests(unittest.TestCase):
    def test_redaction_and_exclusions(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            sentinel = 'sk-' + 'Z' * 24
            (root / '.env').write_text('API_KEY=' + sentinel)
            (root / 'contacts.json').write_text('person@example.test')
            (root / 'node_modules').mkdir()
            (root / 'node_modules' / 'ignored').write_text(sentinel)
            report = scan.scan(root)
            import json
            self.assertNotIn(sentinel, json.dumps(report))
            self.assertNotIn('person@example.test', json.dumps(report))
            self.assertEqual(report['counts']['files'], 2)
            self.assertIn({'path': '.env', 'type': 'provider-token'}, report['findings'])
            self.assertIn({'path': '.env', 'type': 'credential-file-exclude'}, report['findings'])
            self.assertIn({'path': 'contacts.json', 'type': 'email-review'}, report['findings'])

if __name__ == '__main__':
    unittest.main()
