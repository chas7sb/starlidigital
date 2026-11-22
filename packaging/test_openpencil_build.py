import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('openpencil_build',Path(__file__).with_name('openpencil_build.py'))
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)

class OpenPencilContractTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.package={'name':'open-pencil-app','version':'0.16.0','packageManager':'bun@1.4.2','workspaces':['packages/core'],'scripts':{'build':'actual-upstream-build'}}
        (self.root/'packages/core').mkdir(parents=True)
        (self.root/'packages/core/package.json').write_text('{}')
        (self.root/'bun.lock').write_text('fixture frozen input')
        self.save()
    def save(self):(self.root/'package.json').write_text(json.dumps(self.package))
    def test_changed_runtime_contract_is_rejected(self):
        self.package['packageManager']='bun@9.0.0';self.save()
        with self.assertRaisesRegex(ValueError,'Expected reviewed'):build.validate_source(self.root)
    def test_missing_workspace_cannot_be_silently_omitted(self):
        (self.root/'packages/core/package.json').unlink()
        with self.assertRaisesRegex(ValueError,'Missing/unsafe workspace'):build.validate_source(self.root)
    def test_workspace_cannot_escape_source(self):
        self.package['workspaces']=['../elsewhere'];self.save()
        with self.assertRaisesRegex(ValueError,'Missing/unsafe workspace'):build.validate_source(self.root)
    def test_missing_frozen_lock_blocks_build(self):
        (self.root/'bun.lock').unlink()
        with self.assertRaisesRegex(ValueError,'Frozen Bun lockfile'):build.validate_source(self.root)
    def test_tampered_cached_bun_archive_is_rejected_without_download(self):
        (self.root/'bun-windows-x64.zip').write_bytes(b'corrupted fixture')
        with patch.object(build,'asset_name',return_value='bun-windows-x64.zip'),patch.object(build.urllib.request,'urlopen') as network:
            with self.assertRaisesRegex(ValueError,'SHA256 mismatch'):build.bootstrap(self.root)
            network.assert_not_called()
    def test_authoritative_source_is_never_used_as_build_workspace(self):
        with patch.object(build,'OFFICIAL_SOURCE',self.root):
            with self.assertRaisesRegex(ValueError,'scratch copy'):build.run(self.root,self.root/'cache','build')

if __name__=='__main__':unittest.main()
