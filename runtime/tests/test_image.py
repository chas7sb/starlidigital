import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

RUNTIME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME))
spec = importlib.util.spec_from_file_location('starli_image', RUNTIME/'image.py')
image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image)

def fixture(path, backing=0, features=0, snapshots=0, encryption=0):
    header = bytearray(104)
    header[:4] = b'QFI\xfb'
    struct.pack_into('>I', header, 4, 3)
    struct.pack_into('>Q', header, 8, backing)
    struct.pack_into('>I', header, 20, 16)
    struct.pack_into('>Q', header, 24, 1024**3)
    struct.pack_into('>I', header, 32, encryption)
    struct.pack_into('>I', header, 60, snapshots)
    struct.pack_into('>Q', header, 72, features)
    struct.pack_into('>I', header, 100, 104)
    path.write_bytes(header + b'guest-fixture')
    return path

class ImageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.runtime = self.root/'project/runtime'; self.runtime.mkdir(parents=True)
        self.state = self.runtime/'state'
        self.patches = [patch.object(image.vm,'ROOT',self.runtime), patch.object(image.vm,'STATE',self.state)]
        for p in self.patches: p.start()
    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()
    def ready(self):
        self.state.mkdir()
        fixture(self.state/'desktop.qcow2')
        (self.state/'config.json').write_text(json.dumps({'disk':'desktop.qcow2'}))
    def fake_qemu(self,args,timeout=1800):
        if args[0]=='convert': Path(args[-1]).write_bytes(Path(args[-2]).read_bytes())
        elif args[0]=='info': return json.dumps({'format':'qcow2','virtual-size':1024**3})
        elif args[0]=='check': return json.dumps({'check-errors':0,'corruptions':0,'leaks':0})
        return ''
    def test_running_and_unreachable_export_refused_before_qemu(self):
        self.ready()
        for status in ['running','unreachable','shutdown-requested']:
            with patch.object(image.vm,'status',return_value={'state':status}), patch.object(image,'qemu') as qemu:
                with self.assertRaises(RuntimeError): image.export_image(clean_base_reviewed=True)
                qemu.assert_not_called()
    def test_clean_base_attestation_required(self):
        with self.assertRaises(ValueError): image.export_image()
        self.assertFalse(self.state.exists())
    def test_backing_external_dirty_encrypted_snapshots_rejected_before_qemu(self):
        source=self.root/'source.qcow2'
        for options in [{'backing':104},{'features':1},{'features':2},{'features':4},{'snapshots':1},{'encryption':2}]:
            fixture(source,**options)
            with patch.object(image,'qemu') as qemu:
                with self.assertRaises(ValueError): image.verify(source,image.digest(source))
                qemu.assert_not_called()
    def test_wrong_hash_refused_before_qemu_and_state_creation(self):
        source=fixture(self.root/'source.qcow2')
        with patch.object(image,'qemu') as qemu:
            with self.assertRaises(ValueError): image.import_image(source,'0'*64,accel='tcg')
            qemu.assert_not_called()
        self.assertFalse(self.state.exists())
    def test_export_contains_only_image_manifest_checksum_and_preserves_source(self):
        self.ready(); source=self.state/'desktop.qcow2'; before=image.digest(source)
        with patch.object(image.vm,'status',return_value={'state':'stopped'}), patch.object(image,'qemu',side_effect=self.fake_qemu):
            result=image.export_image(clean_base_reviewed=True)
        output=Path(result['directory'])
        self.assertEqual({p.name for p in output.iterdir()},{'starlidigital-base.qcow2','manifest.json','starlidigital-base.qcow2.sha256'})
        self.assertEqual(image.digest(source),before)
        self.assertEqual(result['manifest']['guest_sanitization'],'NOT_AUTOMATICALLY_VERIFIED')
        self.assertNotIn('config',result['manifest'])
    def test_export_cannot_write_tracked_repository_or_overwrite(self):
        self.ready()
        with patch.object(image.vm,'status',return_value={'state':'stopped'}), patch.object(image,'qemu',side_effect=self.fake_qemu):
            with self.assertRaises(ValueError): image.export_image(self.runtime.parent/'deliverable',True)
            output=self.root/'existing'; output.mkdir()
            with self.assertRaises(ValueError): image.export_image(output,True)
    def test_import_clones_bytes_without_source_mutation_and_has_fresh_instance_identity(self):
        source=fixture(self.root/'source.qcow2'); expected=image.digest(source)
        with patch.object(image,'qemu',side_effect=self.fake_qemu):
            result=image.import_image(source,expected,accel='tcg',vnc_port=5909)
        config=json.loads((self.state/'config.json').read_text())
        self.assertEqual(image.digest(source),expected)
        self.assertEqual(image.digest(self.state/'desktop.qcow2'),expected)
        self.assertEqual(config['network'],'none'); self.assertIsNone(config['iso'])
        self.assertEqual(config['instance_id'],result['instance_id'])
        self.assertFalse((self.state/'process.json').exists())
        with patch.object(image,'qemu') as qemu:
            with self.assertRaises(ValueError): image.import_image(source,expected,accel='tcg')
            qemu.assert_not_called()
    def test_existing_lock_and_partial_state_preserved(self):
        self.state.mkdir(); (self.state/'lifecycle.lock').write_text('another-process')
        with self.assertRaises(FileExistsError):
            with image.lifecycle_lock(): pass
        self.assertEqual((self.state/'lifecycle.lock').read_text(),'another-process')
    def test_import_requires_software_emulation_for_x86_image_on_arm(self):
        source=fixture(self.root/'source.qcow2')
        with patch.object(image.platform,'machine',return_value='arm64'):
            self.assertEqual(image.accelerator_default(),'tcg')
            with self.assertRaises(ValueError): image.import_image(source,image.digest(source),accel='hvf')

if __name__=='__main__': unittest.main()
