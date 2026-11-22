import hashlib,json,tempfile,unittest
from pathlib import Path
from install_reviewed import load_review
class Pins(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.p=Path(self.tmp.name);self.data=b'reviewed source';(self.p/'source.py').write_bytes(self.data)
  raw=json.dumps({'source.py':hashlib.sha256(self.data).hexdigest()}).encode();(self.p/'FILES.json').write_bytes(raw);self.pin=hashlib.sha256(raw).hexdigest()
 def tearDown(self):self.tmp.cleanup()
 def load(self,pin=None):return load_review(self.p,pin or self.pin,ownership_check=lambda path:None)
 def test_valid_exact_bytes(self):self.assertEqual(self.load(),{'source.py':self.data})
 def test_external_pin_mismatch(self):
  with self.assertRaisesRegex(ValueError,'MANIFEST_PIN_MISMATCH'):self.load('0'*64)
 def test_source_changed(self):
  (self.p/'source.py').write_bytes(b'changed')
  with self.assertRaisesRegex(ValueError,'SOURCE_PIN_MISMATCH'):self.load()
 def test_symlink_source_rejected(self):
  (self.p/'actual.py').write_bytes(self.data);(self.p/'source.py').unlink();(self.p/'source.py').symlink_to('actual.py')
  with self.assertRaises(OSError):self.load()
 def test_symlink_manifest_rejected(self):
  (self.p/'FILES.json').rename(self.p/'real.json');(self.p/'FILES.json').symlink_to('real.json')
  with self.assertRaises(OSError):self.load()
if __name__=='__main__':unittest.main()
