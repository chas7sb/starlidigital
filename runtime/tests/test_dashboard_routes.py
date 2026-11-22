"""Router authorization tests against real FastAPI and the private-binding principal.

Run with FastAPI 0.115.7 and httpx installed. The application's session verifier is
injected at its dependency boundary; tests use real SQLite role/binding checks.
"""
import json
import contextlib
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[2] / 'dashboard/backend'
sys.path.insert(0, str(BACKEND))
package = types.ModuleType('open_webui')
package.__path__ = [str(BACKEND/'open_webui')]
sys.modules['open_webui'] = package
auth = types.ModuleType('open_webui.utils.auth')
def verified(): raise RuntimeError('Test session verifier must be overridden')
auth.get_verified_user = verified
sys.modules['open_webui.utils.auth'] = auth
from open_webui.routers import starli_local_vm as router, starli_platform as platform

class RouterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.database = root/'source.sqlite'
        with contextlib.closing(sqlite3.connect(self.database)) as db, db:
            db.execute('CREATE TABLE users(id TEXT PRIMARY KEY,payload TEXT)')
            db.execute('INSERT INTO users VALUES (?,?)', ('node-admin', json.dumps({'role':'ADMIN','disabled':False})))
        self.binding = root/'bindings.json'
        self.binding.write_text(json.dumps({'memberships':{'owner':{'v2UserId':'node-admin'}}}))
        @contextlib.contextmanager
        def connection():
            with contextlib.closing(sqlite3.connect(self.database)) as db:
                yield db
        self.patches = [patch.object(platform,'DATABASE',str(self.database)), patch.object(platform,'BINDINGS',str(self.binding)),
                        patch.object(platform,'connection',connection),
                        patch.dict(os.environ,{'STARLI_LOCAL_VM_ENABLED':'1'})]
        for p in self.patches: p.start()
        self.actor = {'id':'owner','role':'admin'}
        app = FastAPI(); app.include_router(router.router)
        app.dependency_overrides[verified] = lambda: self.actor
        self.client = TestClient(app)
        self.headers = {'Authorization':'Bearer test-session'}
    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.client.close()
        self.temporary.cleanup()
    def test_bearer_required_before_runtime_access(self):
        with patch.object(router,'adapter') as adapter:
            self.assertEqual(self.client.get('/status').status_code,401)
            adapter.assert_not_called()
    def test_foreign_origin_denied(self):
        self.assertEqual(self.client.post('/stop',headers={**self.headers,'Origin':'https://other.invalid'}).status_code,403)
    def test_unbound_admin_and_revoked_source_role_denied(self):
        self.actor = {'id':'unbound','role':'admin'}
        self.assertEqual(self.client.get('/status',headers=self.headers).status_code,403)
        self.actor = {'id':'owner','role':'admin'}
        with contextlib.closing(sqlite3.connect(self.database)) as db, db:
            db.execute('UPDATE users SET payload=?',(json.dumps({'role':'USER'}),))
        self.assertEqual(self.client.post('/start',headers=self.headers).status_code,403)
    def test_disabled_console_never_calls_runtime(self):
        with patch.dict(os.environ,{'STARLI_LOCAL_VM_ENABLED':'0'}), patch.object(router,'adapter') as adapter:
            response = self.client.get('/status',headers=self.headers)
            self.assertEqual(response.json()['state'],'disabled')
            self.assertEqual(response.status_code,200)
            adapter.assert_not_called()
    def test_strict_input_and_arbitrary_action_rejected(self):
        with patch.object(router,'adapter') as adapter:
            self.assertEqual(self.client.post('/input',headers=self.headers,json={'kind':'command','command':'host-shell'}).status_code,422)
            self.assertEqual(self.client.post('/input',headers=self.headers,json={'kind':'pointer','x':True,'y':0}).status_code,422)
            self.assertEqual(self.client.post('/quit',headers=self.headers,json={}).status_code,404)
            adapter.assert_not_called()
    def test_frame_no_store_and_error_has_no_runtime_details(self):
        class Runtime:
            class Busy(RuntimeError): pass
            def frame(self): return b'\x89PNG\r\n\x1a\n'
            def status(self): raise RuntimeError('private-host-path-and-content')
        with patch.object(router,'adapter',return_value=Runtime()):
            response = self.client.get('/frame',headers=self.headers)
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.headers['cache-control'],'no-store')
            response = self.client.get('/status',headers=self.headers)
            self.assertEqual(response.status_code,503)
            self.assertNotIn('private-host-path',response.text)

if __name__ == '__main__': unittest.main()
