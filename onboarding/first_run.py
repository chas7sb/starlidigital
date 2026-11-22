"""Local trusted first-owner setup; run with the installed dashboard Python."""
import argparse
import getpass
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / 'onboarding/.local'
CONFIG = LOCAL / 'setup.json'

def origin(value):
    if not isinstance(value, str) or any(ord(char) <= 32 or ord(char) == 127 for char in value) or '\\' in value:
        raise ValueError('Origin contains invalid characters')
    parsed = urllib.parse.urlsplit(value)
    # Literal loopback only: no DNS rebinding, credentials, paths, proxies or redirects.
    try:
        valid = ipaddress.ip_address(parsed.hostname or '').is_loopback
    except ValueError:
        valid = False
    if not valid or parsed.scheme != 'http' or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('Use an HTTP literal loopback origin, for example http://127.0.0.1:8080')
    if not parsed.port:
        raise ValueError('An explicit port is required')
    return value.rstrip('/')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Redirect refused')

def request(base, path, payload=None, token=None, raw=False):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
        headers['Origin'] = origin(base)
    req = urllib.request.Request(origin(base) + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=15) as response:
            if raw:
                data = response.read(20 * 1024 * 1024 + 1)
                if len(data) > 20 * 1024 * 1024:
                    raise RuntimeError('Response exceeded 20 MiB limit')
                return {'content_type': response.headers.get_content_type(), 'data': data}
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'{path}: HTTP {error.code}; response omitted to protect credentials') from None

def private_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == 'nt':
        # Numeric current-user SID avoids localized account names. Do not rely on inherited ACLs.
        result = subprocess.run(['whoami', '/user', '/fo', 'csv', '/nh'], capture_output=True, text=True, check=True)
        import csv
        sid = next(csv.reader([result.stdout.strip()]))[1]
        subprocess.run(['icacls', str(path.parent), '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F'],
            capture_output=True, check=True)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        json.dump(data, stream, indent=2)

def environment(config):
    data = LOCAL / 'data'
    env = dict(os.environ)
    # Explicit fresh data paths override inherited production configuration.
    env.update(WEBUI_SECRET_KEY=config['secret'], WEBUI_AUTH='true', ENABLE_SIGNUP='false', ENABLE_LOGIN_FORM='true',
        PYTHONIOENCODING='utf-8', PYTHONUTF8='1',
        ENABLE_PERSISTENT_CONFIG='false', DATA_DIR=str(data / 'dashboard'), DATABASE_URL='sqlite:///' + (data / 'dashboard/webui.db').as_posix(),
        STARLI_DATA_DIR=str(data / 'dashboard'), STARLI_CONFIG_DIR=str(LOCAL / 'config'),
        STARLI_WORKSPACE_ROOT=str(data / 'workspace'), ASSET_STORAGE_DIR=str(data / 'assets'), VIDEO_STORAGE_DIR=str(data / 'videos'),
        DATABASE_PATH=str(data / 'platform.sqlite'), STARLI_SOURCE_DATABASE=str(data / 'platform.sqlite'),
        STARLI_BINDINGS_PATH=str(LOCAL / 'bindings.json'), STARLI_STATE_DIR=str(data / 'state'),
        STARLI_COMPANY_DATABASE=str(data / 'dashboard/company-authority.sqlite3'), STARLI_COMPANY_BOT_DATABASE=str(data / 'company-bot.sqlite'),
        ACCOUNT_EMAIL_DOMAIN='local.invalid',
        STARLI_LOCAL_VM_ENABLED='1',
        STARLI_COMPANY_MESSAGING_ENABLED='1',
        STARLI_TASK_HOME=str(data / 'tasks'), STARLI_MEMORY_ROOT=str(data / 'memory'),
        STARLI_PLATFORM_SOURCE_ROOT=str(ROOT / 'platform'), STARLI_RUNTIME_CODE_DIR=str(ROOT / 'platform/extensions/starli-runtime'),
        STARLI_NODE_BINARY=os.getenv('STARLI_NODE24') or shutil.which('node') or 'node',
        STARLI_PLATFORM_ORIGIN=config['platform'], PUBLIC_API_URL=config['platform'],
        WEBUI_URL=config['dashboard'], PUBLIC_APP_URL=config['dashboard'], STARLI_PUBLIC_ORIGIN=config['dashboard'],
        CORS_ALLOW_ORIGIN=config['dashboard'], STARLI_ALLOWED_ORIGINS=config['dashboard'],
        ALLOWED_ORIGINS=config['dashboard'], HOST='127.0.0.1', PORT=str(urllib.parse.urlsplit(config['platform']).port),
        STARLI_DASHBOARD_PORT=str(urllib.parse.urlsplit(config['dashboard']).port),
        ENABLE_OPENAI_API='false', ENABLE_OLLAMA_API='false', OFFLINE_MODE='true', HF_HUB_OFFLINE='1',
        ANONYMIZED_TELEMETRY='false', DO_NOT_TRACK='true')
    for key in ('ADMIN_USERNAME', 'ADMIN_PASSWORD', 'WEBUI_AUTH_TRUSTED_EMAIL_HEADER', 'WEBUI_AUTH_TRUSTED_NAME_HEADER'):
        env.pop(key, None)
    return env

def stopped(base):
    parsed = urllib.parse.urlsplit(origin(base))
    try:
        with socket.create_connection((parsed.hostname, parsed.port), timeout=1):
            raise RuntimeError('Stop services before owner setup; configured port is occupied')
    except (ConnectionRefusedError, TimeoutError, OSError) as error:
        if isinstance(error, RuntimeError):
            raise

def setup(args):
    if CONFIG.exists() or (LOCAL / 'data').exists():
        raise RuntimeError('Existing setup or data preserved; use check/start. Partial setup requires operator review.')
    config = {'dashboard': origin(args.dashboard), 'platform': origin(args.platform), 'secret': secrets.token_hex(48)}
    if config['dashboard'] == config['platform']:
        raise ValueError('Dashboard and platform ports must differ')
    stopped(config['dashboard']); stopped(config['platform'])
    if sys.version_info[:2] not in ((3, 11), (3, 12)):
        raise RuntimeError('Use installed dashboard Python 3.11 or 3.12')
    required = ['typer', 'uvicorn', 'fastapi', 'sqlalchemy', 'alembic', 'passlib', 'bcrypt', 'peewee',
                'peewee_migrate', 'redis', 'jwt', 'pytz', 'markdown', 'bs4', 'requests', 'pydantic']
    missing = [name for name in required if importlib.util.find_spec(name) is None]
    if missing:
        raise RuntimeError('Dashboard dependency installation incomplete: ' + ', '.join(missing))
    probe = subprocess.run([os.getenv('STARLI_NODE24', 'node'), '--import', 'tsx', '-e',
        'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'], cwd=ROOT / 'platform', capture_output=True)
    if probe.returncode:
        raise RuntimeError('Node 24+ with installed platform tsx dependencies is required')
    if not sys.stdin.isatty():
        raise RuntimeError('Interactive terminal required; passwords are never accepted through arguments or redirected input')
    email = input('Owner email: ').strip().lower()
    name = input('Owner display name: ').strip()
    username = input('Platform owner username (3-30 lowercase letters/digits/._-): ').strip()
    company_name = input('Company/workspace name (1-100 characters): ').strip()
    password = getpass.getpass('Owner password (14+ characters, maximum 72 UTF-8 bytes): ')
    if password != getpass.getpass('Confirm password: '):
        raise ValueError('Passwords differ')
    if len(password) < 14 or len(password.encode()) > 72:
        raise ValueError('Password length invalid')
    import re
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,29}', username) or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email) or not 1 <= len(name) <= 120 or not 1 <= len(company_name) <= 100 or any(ord(c) < 32 for c in company_name):
        raise ValueError('Owner identity invalid')
    private_write(CONFIG, config)
    env = environment(config)
    (LOCAL / 'data/dashboard').mkdir(parents=True, mode=0o700)
    os.environ.update(env)
    sys.path.insert(0, str(ROOT / 'dashboard/backend'))
    # Uses application migrations, password hashing and account insertion. No public bootstrap endpoint exists.
    import open_webui.config  # applies the application's Alembic migrations before inserting the owner
    from open_webui.models.auths import Auths
    from open_webui.models.users import Users
    from open_webui.utils.auth import get_password_hash
    if Users.get_num_users() != 0:
        raise RuntimeError('Dashboard already contains users; preserved')
    result = subprocess.run([os.getenv('STARLI_NODE24', 'node'), '--import', 'tsx', str(ROOT / 'onboarding/platform-owner.mjs')],
        cwd=ROOT / 'platform', env=env, input=json.dumps({'username': username, 'password': password, 'email': email}),
        text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Platform bootstrap failed; output withheld. Partial setup preserved for review.')
    node_id = json.loads(result.stdout)['id']
    user = Auths.insert_new_auth(email, get_password_hash(password), name, role='admin')
    password = None
    if not user:
        raise RuntimeError('Dashboard owner creation failed; partial setup preserved')
    private_write(LOCAL / 'bindings.json', {'memberships': {user.id: {'v2UserId': node_id}}})
    from open_webui.company_authority.company_rbac import Authority
    authority = Authority(env['STARLI_COMPANY_DATABASE'])
    try:
        company_id = authority.create(user.id, company_name, name)
        if authority.require_member(user.id, company_id)['role'] != 'owner':
            raise RuntimeError('Company owner membership not established')
    finally:
        authority.db.close()
    private_write(LOCAL / 'owner.json', {'dashboard_id': user.id, 'node_id': node_id, 'company_id': company_id})
    print('Created fresh local owner accounts, explicit administrator binding and owner company. Runtime login not yet checked.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['setup', 'start', 'check'])
    parser.add_argument('--dashboard', default='http://127.0.0.1:8080')
    parser.add_argument('--platform', default='http://127.0.0.1:4100')
    args = parser.parse_args()
    if args.action == 'setup':
        return setup(args)
    config = json.loads(CONFIG.read_text(encoding='utf-8'))
    origin(config['dashboard']); origin(config['platform'])
    if args.action == 'start':
        return subprocess.call([os.getenv('STARLI_NODE24', 'node'), str(ROOT / 'installer/native.mjs'), 'start', 'all'], env=environment(config), cwd=ROOT)
    failures = 0
    for label, base in [('platform', config['platform']), ('dashboard', config['dashboard'])]:
        try:
            result = request(base, '/health')
            if result.get('ok') is not True and result.get('status') is not True:
                raise RuntimeError('Health response did not confirm readiness')
            print(label + ': HTTP health verified')
        except Exception as error:
            print(label + ': ' + str(error)); failures += 1
    if not sys.stdin.isatty():
        raise RuntimeError('Interactive terminal required for hidden password verification')
    email = input('Dashboard owner email: ').strip().lower()
    password = getpass.getpass('Dashboard owner password: ')
    try:
        auth = request(config['dashboard'], '/api/v1/auths/signin', {'email': email, 'password': password})
        password = None
        if auth.get('role') != 'admin' or not auth.get('token'):
            raise RuntimeError('Dashboard administrator sign-in not established')
        token = auth['token']
        result = request(config['dashboard'], '/api/v1/starli/platform/admin', token=token)
        if result.get('services', {}).get('sourceDatabase') != 'read-only connected':
            raise RuntimeError('Platform administrator bridge not confirmed')
        print('Dashboard sign-in and explicit platform administrator bridge verified')
        owner = json.loads((LOCAL / 'owner.json').read_text())
        companies = request(config['dashboard'], '/api/v1/companies', token=token)
        if not any(row[0] == owner['company_id'] and row[2] == 'owner' for row in companies):
            raise RuntimeError('Fresh company is absent from authenticated company list')
        capability = request(config['dashboard'], '/api/v1/companies/' + owner['company_id'] + '/capabilities', token=token)
        if capability.get('role') != 'owner' or capability.get('user_id') != auth['id']:
            raise RuntimeError('Company owner authority not confirmed')
        print('Company list and owner capabilities verified; provider execution and VM readiness remain separate checks.')
        vm = request(config['dashboard'], '/api/v1/starli/local-vm/status', token=token)
        if vm.get('enabled') is not True:
            raise RuntimeError('Installation-owner local VM bridge is not enabled')
        print('Local VM status bridge verified; guest readiness and control are not established by this check.')
    except Exception as error:
        print('Authentication/bridge: ' + str(error)); failures += 1
    return 1 if failures else 0

if __name__ == '__main__':
    try:
        sys.exit(main() or 0)
    except Exception as error:
        print('First-run failed: ' + type(error).__name__ + ': ' + str(error), file=sys.stderr)
        sys.exit(1)
