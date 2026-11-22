"""Disposable real-service QA; synthetic credentials stay in ignored private work state."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import types

spec = importlib.util.spec_from_file_location('first_run', Path(__file__).with_name('first_run.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def execute():
    if len(sys.argv) == 3 and sys.argv[1] == '--bootstrap':
        m.LOCAL = Path(sys.argv[2]); m.CONFIG = m.LOCAL / 'setup.json'
        credentials = json.loads((m.LOCAL / 'qa-credentials.json').read_text())
        values = iter([credentials['email'], 'Synthetic Local QA Owner', 'qaowner', 'Synthetic Local QA Company'])
        m.input = lambda prompt: next(values)
        m.getpass.getpass = lambda prompt: credentials['password']
        m.sys.stdin = types.SimpleNamespace(isatty=lambda: True)
        m.setup(types.SimpleNamespace(dashboard='http://127.0.0.1:18980', platform='http://127.0.0.1:18981'))
        return 0
    m.LOCAL = m.ROOT / 'work' / ('onboarding-e2e-' + secrets.token_hex(6)); m.CONFIG = m.LOCAL / 'setup.json'
    credentials = {'email': 'owner@example.invalid', 'password': secrets.token_urlsafe(24)}
    m.private_write(m.LOCAL / 'qa-credentials.json', credentials)
    m.stopped('http://127.0.0.1:18980'); m.stopped('http://127.0.0.1:18981')
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    with (m.LOCAL / 'bootstrap.log').open('w') as log:
        result = subprocess.run([sys.executable, __file__, '--bootstrap', str(m.LOCAL)], stdout=log, stderr=log, creationflags=creationflags)
    if result.returncode:
        print('FAIL: offline bootstrap; inspect private bootstrap.log under ' + str(m.LOCAL))
        return 1
    config = json.loads(m.CONFIG.read_text()); env = m.environment(config)
    children = []; logs = []
    try:
        for label, command, cwd in [
            ('platform', [os.getenv('STARLI_NODE24', 'node'), '--import', 'tsx', 'server/src/index.ts'], m.ROOT / 'platform'),
            ('dashboard', [sys.executable, '-m', 'uvicorn', 'workspace_entry:app', '--host', '127.0.0.1', '--port', '18980'], m.ROOT / 'dashboard/backend')]:
            stream = (m.LOCAL / (label + '.log')).open('w'); logs.append(stream)
            children.append(subprocess.Popen(command, cwd=cwd, env=env, stdout=stream, stderr=stream, creationflags=creationflags))
        deadline = time.monotonic() + 180
        while True:
            if any(child.poll() is not None for child in children):
                raise RuntimeError('A fresh service exited; inspect private logs')
            try:
                assert m.request(config['platform'], '/health').get('ok') is True
                assert m.request(config['dashboard'], '/health').get('status') is True
                break
            except Exception:
                if time.monotonic() > deadline:
                    raise RuntimeError('Fresh service health deadline exceeded')
                time.sleep(2)
        auth = m.request(config['dashboard'], '/api/v1/auths/signin', credentials)
        if auth.get('role') != 'admin' or not auth.get('token'):
            raise RuntimeError('Fresh owner did not sign in as dashboard admin')
        token = auth['token']
        admin = m.request(config['dashboard'], '/api/v1/starli/platform/admin', token=token)
        if admin.get('services', {}).get('sourceDatabase') != 'read-only connected':
            raise RuntimeError('Platform administrator binding failed')
        identity = m.request(config['dashboard'], '/api/v1/starli/customer-identity', token=token)
        expected = json.loads((m.LOCAL / 'bindings.json').read_text())['memberships'][auth['id']]['v2UserId']
        if not identity.get('active') or identity.get('nodeUserId') != expected:
            raise RuntimeError('Authenticated customer bridge selected the wrong Node owner')
        owner = json.loads((m.LOCAL / 'owner.json').read_text())
        companies = m.request(config['dashboard'], '/api/v1/companies', token=token)
        if not any(row[0] == owner['company_id'] and row[2] == 'owner' for row in companies):
            raise RuntimeError('Fresh company not visible to owner')
        capabilities = m.request(config['dashboard'], '/api/v1/companies/' + owner['company_id'] + '/capabilities', token=token)
        if capabilities.get('role') != 'owner' or capabilities.get('user_id') != auth['id']:
            raise RuntimeError('Company owner authority failed')
        try:
            m.request(config['dashboard'], '/api/v1/starli/platform/admin')
        except RuntimeError:
            pass
        else:
            raise RuntimeError('Unauthenticated administrator request succeeded')
        print('PASS: fresh owner/company, two service health checks, real sign-in, admin binding, customer identity, company list/owner authority, unauthenticated denial')
        print('Private disposable artifacts: ' + str(m.LOCAL))
        return 0
    except Exception as error:
        print('FAIL: ' + str(error) + '; private artifacts: ' + str(m.LOCAL))
        return 1
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill(); child.wait()
        for stream in logs:
            stream.close()

if __name__ == '__main__':
    sys.exit(execute())
