"""Actual Windows Node startup and SDK catalog under restricted server environments."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[1]))
import starli_portable as portable

@unittest.skipUnless(os.name=='nt','Windows Node OS environment')
class WindowsNodeEnvironmentTests(unittest.TestCase):
    def test_no_operator_profile_or_credentials_are_added(self):
        with tempfile.TemporaryDirectory() as temporary:
            home=Path(temporary).resolve()/'private-home'
            with patch.dict(os.environ,{'OPENAI_API_KEY':'test-only-not-a-key','HTTPS_PROXY':'http://example.invalid'}):
                env=portable.child_environment({'PATH':os.environ['PATH'],'HOME':str(home)})
            self.assertIn('SYSTEMROOT',env)
            self.assertNotIn('OPENAI_API_KEY',env)
            self.assertNotIn('HTTPS_PROXY',env)
            self.assertEqual(env['USERPROFILE'],str(home))
            self.assertTrue(env['APPDATA'].startswith(str(home)))
            self.assertTrue(env['LOCALAPPDATA'].startswith(str(home)))
    def test_actual_node_sdk_catalog_without_credentials(self):
        root=Path(__file__).parents[3]
        runtime=root/'platform/extensions/starli-runtime'
        node=shutil.which('node')
        if not node or not (runtime/'node_modules').is_dir():self.skipTest('Installed Node runtime required')
        with tempfile.TemporaryDirectory() as temporary:
            env=portable.child_environment({'PATH':os.environ['PATH'],'HOME':str(Path(temporary).resolve()/'private-home')})
            result=subprocess.run([node,'--import','tsx',str(runtime/'provider-runtime.mts')],
                input=json.dumps({'operation':'catalog','credentials':{}})+'\n',cwd=runtime,env=env,
                capture_output=True,text=True,timeout=60)
            self.assertEqual(result.returncode,0,'Restricted Windows Node catalog process failed')
            payloads=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
            self.assertTrue(payloads)
            self.assertGreater(len(payloads[-1].get('providers',[])),0)
            self.assertGreater(len(payloads[-1].get('models',[])),0)

if __name__=='__main__':unittest.main()
