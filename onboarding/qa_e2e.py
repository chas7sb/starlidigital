"""Disposable real-service QA; synthetic credentials stay in ignored private work state."""
import importlib.util
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import types
import urllib.parse

spec = importlib.util.spec_from_file_location('first_run', Path(__file__).with_name('first_run.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def checked_work_path(path):
    work = (m.ROOT / 'work').absolute()
    candidate = Path(path).expanduser().absolute()
    try:
        candidate.relative_to(work)
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(work.resolve(strict=True))
    except (ValueError, OSError):
        raise ValueError('Resume state must be an existing private directory inside ROOT/work') from None
    if resolved == work.resolve() or not resolved.is_dir():
        raise ValueError('Resume requires a private state subdirectory')
    for item in (candidate, *candidate.parents):
        info = item.lstat()
        if item.is_symlink() or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Resume state cannot traverse a link or reparse point')
        if item == work:
            break
    return resolved

def resume_state(path):
    local = checked_work_path(path)
    m.private_storage().ensure_private_directory(local)  # Validate existing directory; never repair.
    config = m.private_read(local / 'setup.json')
    credentials = m.private_read(local / 'qa-credentials.json')
    owner = m.private_read(local / 'owner.json')
    bindings = m.private_read(local / 'bindings.json')
    m.origin(config['dashboard']); m.origin(config['platform'])
    if config['dashboard'] == config['platform'] or not isinstance(config.get('secret'), str) or len(config['secret']) < 32:
        raise ValueError('Resume configuration is invalid')
    if not all(isinstance(owner.get(key), str) and owner[key] for key in ('dashboard_id', 'node_id', 'company_id')):
        raise ValueError('Resume owner metadata is invalid')
    if bindings.get('memberships', {}).get(owner['dashboard_id'], {}).get('v2UserId') != owner['node_id']:
        raise ValueError('Resume administrator ID binding does not match owner metadata')
    if not isinstance(credentials.get('email'), str) or not isinstance(credentials.get('password'), str):
        raise ValueError('Resume credentials are invalid')
    for relative in ('data/dashboard/webui.db', 'data/platform.sqlite', 'data/dashboard/company-authority.sqlite3', 'data/company-bot.sqlite'):
        database = local / relative
        if not database.is_file() or database.stat().st_nlink != 1:
            raise ValueError('Resume database is missing or linked')
        for item in (database, *database.parents):
            if item.is_symlink() or getattr(item.lstat(), 'st_file_attributes', 0) & 0x400:
                raise ValueError('Resume database cannot traverse a link or reparse point')
            if item == local:
                break
    return local, config, credentials

def record(name, data):
    path = m.LOCAL / name
    if path.exists():
        m.private_storage().require_private_file(path)
        # Preserve previous evidence; only test metadata is rotated, never owner state/secrets.
        path.rename(path.with_name(path.stem + '-before-' + secrets.token_hex(6) + path.suffix))
    m.private_write(path, data)

def execute():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume', type=Path, help='Reuse validated private QA state inside ROOT/work; services must be stopped')
    parser.add_argument('--serve', action='store_true', help='Keep successfully authenticated services running for visual QA')
    parser.add_argument('--bootstrap', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.bootstrap:
        if args.resume or args.serve:
            parser.error('Internal bootstrap cannot combine with resume/serve')
        m.LOCAL = checked_work_path(args.bootstrap); m.CONFIG = m.LOCAL / 'setup.json'
        credentials = m.private_read(m.LOCAL / 'qa-credentials.json')
        values = iter([credentials['email'], 'Synthetic Local QA Owner', 'qaowner', 'Synthetic Local QA Company'])
        m.input = lambda prompt: next(values)
        m.getpass.getpass = lambda prompt: credentials['password']
        m.sys.stdin = types.SimpleNamespace(isatty=lambda: True)
        m.setup(types.SimpleNamespace(dashboard='http://127.0.0.1:18280', platform='http://127.0.0.1:18281'))
        return 0
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    if args.resume:
        m.LOCAL, config, credentials = resume_state(args.resume)
        m.CONFIG = m.LOCAL / 'setup.json'
        m.stopped(config['dashboard']); m.stopped(config['platform'])
    else:
        m.stopped('http://127.0.0.1:18280'); m.stopped('http://127.0.0.1:18281')
        m.LOCAL = m.ROOT / 'work' / ('onboarding-e2e-' + secrets.token_hex(6)); m.CONFIG = m.LOCAL / 'setup.json'
        credentials = {'email': 'owner@example.invalid', 'password': secrets.token_urlsafe(24)}
        m.private_write(m.LOCAL / 'qa-credentials.json', credentials)
        with (m.LOCAL / 'bootstrap.log').open('w') as log:
            result = subprocess.run([sys.executable, __file__, '--bootstrap', str(m.LOCAL)], stdout=log, stderr=log, creationflags=creationflags)
        if result.returncode:
            print('FAIL: offline bootstrap; inspect private bootstrap.log under ' + str(m.LOCAL))
            return 1
        config = m.private_read(m.CONFIG)
    preserved = {name: hashlib.sha256((m.LOCAL / name).read_bytes()).digest()
        for name in ('setup.json', 'owner.json', 'bindings.json', 'qa-credentials.json')}
    env = m.environment(config)
    run_id = secrets.token_hex(6)
    children = []; logs = []
    try:
        for label, command, cwd in [
            ('platform', [os.getenv('STARLI_NODE24', 'node'), '--import', 'tsx', 'server/src/index.ts'], m.ROOT / 'platform'),
            ('dashboard', [sys.executable, '-m', 'uvicorn', 'workspace_entry:app', '--host', urllib.parse.urlsplit(config['dashboard']).hostname,
                '--port', str(urllib.parse.urlsplit(config['dashboard']).port)], m.ROOT / 'dashboard/backend')]:
            stream = (m.LOCAL / (label + '-' + run_id + '.log')).open('w'); logs.append(stream)
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
        owner = m.private_read(m.LOCAL / 'owner.json')
        if auth['id'] != owner['dashboard_id']:
            raise RuntimeError('Authenticated dashboard user does not match preserved owner')
        admin = m.request(config['dashboard'], '/api/v1/starli/platform/admin', token=token)
        if admin.get('services', {}).get('sourceDatabase') != 'read-only connected':
            raise RuntimeError('Platform administrator binding failed')
        identity = m.request(config['dashboard'], '/api/v1/starli/customer-identity', token=token)
        expected = m.private_read(m.LOCAL / 'bindings.json')['memberships'][auth['id']]['v2UserId']
        if expected != owner['node_id']:
            raise RuntimeError('Preserved Node owner and private binding differ')
        if not identity.get('active') or identity.get('nodeUserId') != expected:
            raise RuntimeError('Authenticated customer bridge selected the wrong Node owner')
        companies = m.request(config['dashboard'], '/api/v1/companies', token=token)
        if not any(row[0] == owner['company_id'] and row[2] == 'owner' for row in companies):
            raise RuntimeError('Fresh company not visible to owner')
        capabilities = m.request(config['dashboard'], '/api/v1/companies/' + owner['company_id'] + '/capabilities', token=token)
        if capabilities.get('role') != 'owner' or capabilities.get('user_id') != auth['id']:
            raise RuntimeError('Company owner authority failed')
        try:
            m.request(config['dashboard'], '/api/v1/starli/platform/admin')
        except RuntimeError as error:
            if 'HTTP 401' not in str(error) and 'HTTP 403' not in str(error):
                raise
        else:
            raise RuntimeError('Unauthenticated administrator request succeeded')
        print('PASS: fresh owner/company, two service health checks, real sign-in, admin binding, customer identity, company list/owner authority, unauthenticated denial')
        providers = m.request(config['dashboard'], '/api/v1/starli/providers', token=token)
        provider_items = providers.get('items')
        if not isinstance(provider_items, list) or len(provider_items) != 42:
            raise RuntimeError('Authenticated provider catalog did not contain the expected 42 providers')
        print('PASS: authenticated SDK catalog returned 42 providers; no credentials or inference used')
        catalog = m.request(config['dashboard'], '/api/v1/starli/tools/catalog', token=token)
        tools = catalog.get('tools')
        if not isinstance(tools, list) or len(tools) != 69 or catalog.get('isError'):
            raise RuntimeError('Authenticated tool catalog did not contain the expected 69 authorized tools')
        print('PASS: authenticated account catalog returned 69 authorized tools; no tool execution sent')
        vm_result = {'passed': False}
        try:
            status = m.request(config['dashboard'], '/api/v1/starli/local-vm/status', token=token)
            if status.get('enabled') is not True:
                raise RuntimeError('Local VM owner bridge disabled')
            frame = m.request(config['dashboard'], '/api/v1/starli/local-vm/frame', token=token, raw=True)
            if frame['content_type'] != 'image/png' or not frame['data'].startswith(b'\x89PNG\r\n\x1a\n'):
                raise RuntimeError('VM frame did not return a PNG')
            (m.LOCAL / 'vm-frame.png').write_bytes(frame['data'])
            vm_result = {'passed': True, 'frame_bytes': len(frame['data'])}
            print('PASS: authenticated same-origin VM status and PNG frame; no guest control sent')
        except Exception as error:
            print('VM read check failed: ' + str(error))
            vm_result['error'] = str(error)
        if any(hashlib.sha256((m.LOCAL / name).read_bytes()).digest() != digest for name, digest in preserved.items()):
            raise RuntimeError('Owner identity, credential, binding or session-secret file changed during QA')
        record('qa-result.json', {'core_passed': True, 'provider_count': len(provider_items), 'tool_count': len(tools), 'resumed': bool(args.resume),
            'owner_files_unchanged': True, 'vm': vm_result})
        print('Private disposable artifacts: ' + str(m.LOCAL))
        if args.serve:
            record('qa-processes.json', {'supervisor': os.getpid(), 'children': [child.pid for child in children]})
            print('READY for visual QA: ' + config['dashboard'] + '/setup', flush=True)
            while all(child.poll() is None for child in children):
                time.sleep(1)
            raise RuntimeError('A QA service exited during visual handoff')
        return 0 if vm_result['passed'] else 1
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
    try:
        sys.exit(execute())
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print('QA refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
