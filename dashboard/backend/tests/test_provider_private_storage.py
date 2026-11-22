"""Provider vault and route checks using real Windows ACLs and local SQLite."""
import asyncio
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch,AsyncMock
sys.path.insert(0,str(Path(__file__).parents[1]))
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from starli_private_fs import require_private_file

auth=types.ModuleType('open_webui.utils.auth')
def verified():return types.SimpleNamespace(id='local-test-owner',role='admin')
auth.get_verified_user=verified
spec=importlib.util.spec_from_file_location('provider_storage_under_test',Path(__file__).parents[1]/'open_webui/routers/starli_providers.py')
providers=importlib.util.module_from_spec(spec)
previous_auth=sys.modules.get('open_webui.utils.auth')
sys.modules['open_webui.utils.auth']=auth
sys.modules['provider_storage_under_test']=providers
try:spec.loader.exec_module(providers)
finally:
    if previous_auth is None:sys.modules.pop('open_webui.utils.auth',None)
    else:sys.modules['open_webui.utils.auth']=previous_auth

class ProviderPrivateStorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.state=Path(self.temporary.name).resolve()/'state'
        self.location=patch.object(providers,'state_dir',return_value=self.state);self.location.start()
    def tearDown(self):self.location.stop();self.temporary.cleanup()
    @unittest.skipUnless(os.name=='nt','Windows Node bootstrap')
    def test_child_keeps_systemroot_and_excludes_operator_credentials(self):
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test-only-not-a-real-key',
                                   'USERPROFILE':'C:/unrelated-operator-profile'}):
            env=providers.environment('local-test-owner')
        self.assertIn('SYSTEMROOT',env)
        self.assertNotIn('OPENAI_API_KEY',env)
        self.assertEqual(env['USERPROFILE'],env['HOME'])
        self.assertNotEqual(env['USERPROFILE'],'C:/unrelated-operator-profile')

    def test_fresh_vault_is_private_and_round_trips(self):
        data=providers.account('local-test-owner')
        data['selection']={'provider':'test','id':'test-model'}
        providers.persist('local-test-owner',data)
        self.assertEqual(providers.account('local-test-owner')['selection'],data['selection'])
        require_private_file(self.state/'providers/accounts.sqlite')
        require_private_file(self.state/'providers/master.key')
    def test_connect_state_route_works_with_fresh_private_storage(self):
        app=FastAPI();app.include_router(providers.router,prefix='/providers')
        # This is a route/storage test; no external provider catalog is queried.
        with patch.object(providers,'catalog',new=AsyncMock(return_value={'providers':[]})):
            response=TestClient(app).get('/providers')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['items'],[])
        self.assertFalse(response.json()['credentialsVisible'])
        require_private_file(self.state/'providers/accounts.sqlite')
    @unittest.skipUnless(os.name=='nt','Windows inherited broad ACL')
    def test_existing_broad_provider_directory_is_rejected(self):
        (self.state/'providers').mkdir(parents=True)
        with self.assertRaises(HTTPException) as failure:providers.account('local-test-owner')
        self.assertEqual(failure.exception.status_code,503)
        self.assertFalse((self.state/'providers/accounts.sqlite').exists())

if __name__=='__main__':unittest.main()
