"""Real socket and restart smoke for product/ + product-backend/, not the legacy UI.

No model response is mocked or requested. Only sanitized result JSON may be
uploaded. Private synthetic credentials, cookies, databases and logs stay in work/.
"""
import argparse
import builtins
import hashlib
import http.cookiejar
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / 'product-backend/local_server.py'
CONFIG = ROOT / 'installer/.runtime/product.json'
PHASE = 'arguments'
OUTPUT = ROOT / 'work/new-product-boot-result.json'
TARGETS = {'windows-x64': 'x86_64-pc-windows-msvc', 'linux-x64': 'x86_64-unknown-linux-gnu',
           'macos-x64': 'x86_64-apple-darwin', 'macos-arm64': 'aarch64-apple-darwin'}
ATTEMPT = os.environ.get('STARLI_NEW_PRODUCT_SMOKE_ATTEMPT', '')
if not re.fullmatch('[a-f0-9]{16}', ATTEMPT):
    ATTEMPT = secrets.token_hex(8)


def load_file(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def private_fs():
    return load_file('_new_product_private_fs', ROOT / 'dashboard/backend/starli_private_fs.py')


def literal_origin(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or not parsed.port
            or parsed.username or parsed.password or parsed.path not in ('', '/')
            or parsed.query or parsed.fragment or '\\' in value):
        raise ValueError('Literal 127.0.0.1 HTTP origin with explicit port required')
    return value.rstrip('/')


def checked_case(path):
    path = Path(path).absolute()
    work = ROOT / 'work'
    if '..' in path.parts or path == work or not path.is_relative_to(work) or not path.resolve().is_relative_to(work.resolve()):
        raise ValueError('Smoke state must be a new private subdirectory inside work/')
    for item in (path, *path.parents):
        if item.exists() and (item.is_symlink() or getattr(item.lstat(), 'st_file_attributes', 0) & 0x400):
            raise ValueError('Smoke state cannot traverse links or reparse points')
        if item == work:
            break
    return path


def sanitized_env(case):
    keep = ('PATH', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT',
            'LANG', 'LC_ALL', 'TZ', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE')
    env = {key: os.environ[key] for key in keep if key in os.environ}
    private = private_fs()
    private.ensure_private_directory(case)
    for item in ('home', 'tmp', 'home/appdata', 'home/localappdata'):
        private.ensure_private_directory(case / item)
    env.update(HOME=str(case / 'home'), USERPROFILE=str(case / 'home'), TMP=str(case / 'tmp'), TEMP=str(case / 'tmp'),
               APPDATA=str(case / 'home/appdata'), LOCALAPPDATA=str(case / 'home/localappdata'),
               PYTHONUTF8='1', PYTHONIOENCODING='utf-8', OFFLINE_MODE='true', HF_HUB_OFFLINE='1',
               ANONYMIZED_TELEMETRY='false', DO_NOT_TRACK='true')
    return env


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('REDIRECT_REFUSED')


class ApiError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__('HTTP_CHECK_FAILED')


class Client:
    def __init__(self, base, origin=None):
        self.base = literal_origin(base)
        self.origin = literal_origin(origin or base)
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                                  urllib.request.HTTPCookieProcessor(self.jar), NoRedirect())
        self.token = None

    def request(self, path, payload=None, method=None, key=None, guest=False, expect=(200,)):
        if not path.startswith('/') or path.startswith('//'):
            raise ValueError('Fixed API-relative path required')
        headers = {'Content-Type': 'application/json', 'Origin': self.origin}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        if key:
            headers['Idempotency-Key'] = key
        if guest:
            headers['x-starli-guest-intent'] = '1'
        request = urllib.request.Request(self.base + path, method=method or ('POST' if payload is not None else 'GET'),
                                         headers=headers, data=None if payload is None else json.dumps(payload).encode())
        try:
            with self.opener.open(request, timeout=45) as response:
                if response.status not in expect:
                    raise ApiError(response.status)
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise RuntimeError('RESPONSE_LIMIT')
                if response.headers.get_content_type() == 'text/html':
                    return raw.decode('utf-8')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code in expect:
                return {'expected_status': error.code}
            raise ApiError(error.code) from None


def target_lock():
    system = {'Windows': 'windows', 'Linux': 'linux', 'Darwin': 'macos'}.get(platform.system())
    machine = platform.machine().lower()
    arch = 'arm64' if machine in ('arm64', 'aarch64') else 'x64' if machine in ('amd64', 'x86_64') else None
    target = f'{system}-{arch}'
    if target not in TARGETS:
        raise ValueError('No reviewed backend lock for this host')
    lock = ROOT / 'packaging/locks' / f'dashboard-{target}-py311.txt'
    metadata = json.loads(lock.with_suffix('.json').read_text(encoding='utf-8'))
    digest = lambda path: hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
    if (metadata.get('target') != TARGETS[target] or metadata.get('python') != '3.11'
            or metadata.get('requirements_sha256') != digest(ROOT / 'dashboard/backend/requirements.txt')
            or metadata.get('lock_sha256') != digest(lock)):
        raise ValueError('Backend dependency lock is stale or has another target')
    return target, lock


def bootstrap(args):
    case = checked_case(args.bootstrap)
    private_fs().require_private_file(case / 'credentials.json')
    credentials = json.loads((case / 'credentials.json').read_text(encoding='utf-8'))
    if credentials.get('schema') != 'starli.new-product-smoke-credentials.v1':
        raise ValueError('Not a synthetic product smoke fixture')
    server = load_file('_new_product_server_bootstrap', ENTRY)
    import getpass
    values = iter([credentials['email'], 'New Product Boot QA Owner'])
    builtins.input = lambda _prompt: next(values)
    getpass.getpass = lambda _prompt: credentials['password']
    sys.argv = [str(ENTRY), 'init', '--state', str(case / 'instance'), '--port', str(args.backend_port),
                '--origin', f'http://127.0.0.1:{args.frontend_port if args.installer else args.backend_port}']
    server.main()


def stop(process):
    if process is None or process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        if os.name == 'nt':
            process.kill()
        else:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=10)


def wait_ready(process, client, backend, deadline):
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('PRODUCT_PROCESS_EXITED')
        try:
            health = backend.request('/health')
            if (health.get('status') != 'ready' or not str(health.get('backend', '')).startswith('NEW_COMPANY_')
                    or health.get('nativeAuth') is not True or health.get('nativeMessaging') is not True):
                raise RuntimeError('WRONG_PRODUCT_CAPABILITY_HEALTH')
            if client.base != backend.base:
                proxied = client.request('/health')
                if proxied.get('backend') != health.get('backend'):
                    raise RuntimeError('WRONG_FRONTEND_PROXY_TARGET')
                for path in ('/', '/app'):
                    if '<!doctype html' not in client.request(path).lower():
                        raise RuntimeError('PRODUCT_HTML_NOT_SERVED')
            return health
        except (OSError, ApiError, ValueError):
            time.sleep(1)
    raise RuntimeError('PRODUCT_HEALTH_DEADLINE')


def diagnostic_metadata(case):
    result = {}
    for path in [case / 'init.log', *sorted(case.glob('serve-*.log'))]:
        if not path.is_file():
            continue
        text = path.read_text(encoding='utf-8', errors='replace')[-100000:]
        frames = []
        for filename, line, function in re.findall(r'File "([^"\r\n]+)", line (\d+), in ([A-Za-z0-9_<>]+)', text):
            file = Path(filename)
            name = file.relative_to(ROOT).as_posix() if file.is_relative_to(ROOT) else file.name
            frames.append({'file': name, 'line': int(line), 'function': function})
        result[path.name] = {'lastFrames': frames[-4:],
            'exceptionTypes': re.findall(r'^([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception)):', text, re.MULTILINE)[-3:],
            'missingModules': re.findall(r"ModuleNotFoundError: No module named '([A-Za-z0-9_.]+)'", text)[-3:]}
    return result


def source_metadata():
    files = ('product/src/routes/app/+page.svelte', 'product-backend/local_server.py',
             'product-backend/LOCAL-NATIVE-PINS.json', 'installer/product.mjs')
    result = {'sha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}}
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, timeout=10).strip()
        if re.fullmatch('[a-f0-9]{40,64}', commit):
            result['commit'] = commit
        result['trackedWorkingTreeChanges'] = bool(subprocess.check_output(
            ['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT, timeout=10))
    except (OSError, subprocess.SubprocessError):
        result['gitIdentity'] = 'UNAVAILABLE'
    return result


def run(args):
    global PHASE
    if sys.version_info[:2] != (3, 11):
        raise ValueError('Run the new product smoke with its installed Python3.11')
    target, _ = target_lock()
    contract = json.loads((ROOT / 'product-backend/runtime-contract.json').read_text(encoding='utf-8'))
    if contract.get('entrypoint') != 'product-backend/local_server.py' or contract.get('schema') != 'starli.local-product-backend.v1':
        raise RuntimeError('NEW_PRODUCT_CONTRACT_MISSING')
    if not (ROOT / 'product/src/routes/app/+page.svelte').is_file():
        raise RuntimeError('NEW_PRODUCT_FRONTEND_MISSING')
    if args.installer and CONFIG.exists():
        raise RuntimeError('EXISTING_PRODUCT_INSTALL_CONFIG_REFUSED')
    for port in (args.backend_port, args.frontend_port) if args.installer else (args.backend_port,):
        with socket.socket() as sock:
            try:
                sock.bind(('127.0.0.1', port))
            except OSError:
                raise RuntimeError('OCCUPIED_TEST_PORT_REFUSED') from None
    case = checked_case(ROOT / 'work' / ('new-product-boot-' + secrets.token_hex(6)))
    env = sanitized_env(case)
    credentials = {'schema': 'starli.new-product-smoke-credentials.v1', 'email': 'new-product-owner@example.invalid',
                   'password': secrets.token_urlsafe(24)}
    private_fs().create_private_file(case / 'credentials.json', json.dumps(credentials).encode())
    backend_origin = f'http://127.0.0.1:{args.backend_port}'
    front_origin = f'http://127.0.0.1:{args.frontend_port}' if args.installer else backend_origin
    client, backend = Client(front_origin), Client(backend_origin)
    process, stream, own_config = None, None, None
    checks = []
    report = {'schema': 'starli.new-product-boot-smoke.v1', 'attempt': ATTEMPT, 'host': target, 'status': 'FAIL',
              'productSource': 'product/', 'backendEntrypoint': 'product-backend/local_server.py',
              'launchMode': 'public-installer-start' if args.installer else 'backend-entrypoint-only',
              'publicInstall': 'PASS' if os.environ.get('STARLI_NEW_PRODUCT_PUBLIC_INSTALL_PASSED') == '1' else 'NOT_TESTED',
              'sourceEvidence': source_metadata(),
              'checks': checks, 'requestedModelCalls': 0, 'fixtureBotTurns': 0,
              'modelIntegration': 'NOT_TESTED', 'externalActions': 'NOT_REQUESTED',
              'notTested': ['live model/provider execution', 'autonomous agent delegation', 'generated-app preview lifecycle',
                            'VM execution', 'full browser interaction/parity', 'interactive terminal setup prompts']}
    record = lambda name, **evidence: checks.append({'name': name, 'status': 'PASS', 'evidence': evidence})
    try:
        PHASE = 'actual-local-owner-init'
        command = [sys.executable, str(Path(__file__).resolve()), '--bootstrap', str(case), '--backend-port', str(args.backend_port),
                   '--frontend-port', str(args.frontend_port), '--output', str(case / 'init-result.json')] + (['--installer'] if args.installer else [])
        with (case / 'init.log').open('w', encoding='utf-8') as log:
            result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=log, timeout=240,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode:
            raise RuntimeError('ACTUAL_PRODUCT_OWNER_INIT_FAILED')
        record('actual-product-init-function', credentialsInArguments=False)
        if args.installer:
            PHASE = 'fresh-installer-config'
            own_config = json.dumps({'schema': 'starli.product-install.v1', 'state': str(case / 'instance'),
                                     'frontendPort': args.frontend_port, 'backendPort': args.backend_port}, indent=2).encode()
            CONFIG.parent.mkdir(parents=True, exist_ok=True)
            with os.fdopen(os.open(CONFIG, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'wb') as output:
                output.write(own_config)

        def launch():
            nonlocal stream
            stream = (case / ('serve-' + secrets.token_hex(3) + '.log')).open('w', encoding='utf-8')
            command = ([shutil.which('node') or 'node', str(ROOT / 'installer/starli.mjs'), 'start'] if args.installer else
                       [sys.executable, str(ENTRY), 'serve', '--state', str(case / 'instance'), '--port', str(args.backend_port),
                        '--origin', front_origin])
            return subprocess.Popen(command, cwd=ROOT, env=env, stdout=stream, stderr=stream,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                                    start_new_session=os.name != 'nt')

        PHASE = 'joined-socket-boot'
        process = launch()
        health = wait_ready(process, client, backend, time.monotonic() + args.timeout)
        record('new-product-socket-health', backend=health['backend'], frontendProxy=args.installer)
        PHASE = 'native-owner-login'
        auth = client.request('/api/v1/auths/signin', {key: credentials[key] for key in ('email', 'password')})
        if auth.get('role') != 'admin' or not auth.get('token'):
            raise RuntimeError('NATIVE_OWNER_LOGIN_FAILED')
        client.token = auth['token']
        record('actual-native-owner-login')
        PHASE = 'company-and-bot-install'
        company = client.request('/api/v1/companies', {'name': 'Fresh product smoke company'})['company_id']
        templates = client.request('/api/v1/bot-directory/templates')['templates']
        if not templates:
            raise RuntimeError('NATIVE_BOT_TEMPLATES_MISSING')
        bots = []
        for i in range(2):
            bot = client.request('/api/v1/bot-directory/installs', {'templateId': templates[i % len(templates)]['id'],
                'scope': 'company', 'companyId': company, 'installKey': f'new-product-install-{i}'})['bot']['id']
            client.request(f'/api/v1/company-pilot/{company}/admit-bot', {'bot_id': bot}, key=f'new-product-admit-{i}')
            bots.append(bot)
        if len(set(bots)) != 2:
            raise RuntimeError('TWO_DISTINCT_BOTS_REQUIRED')
        record('actual-company-two-bots-explicit-admission', bots=2)
        PHASE = 'team-and-human-direction'
        prefix = f'/api/v1/starli/companies/{company}/messaging'
        team = client.request(prefix + '/work-sessions', {'name': 'Bounded product smoke team', 'administratorId': auth['id'],
                              'botIds': bots, 'maxTurns': 2}, key='new-product-team', expect=(201,))
        room = team['id']
        team = client.request(prefix + f'/work-sessions/{room}/commands', {'action': 'take_floor',
                              'expectedRevision': team['revision']}, key='new-product-floor')
        text = 'Persisted human direction ' + secrets.token_hex(8)
        team = client.request(prefix + f'/work-sessions/{room}/commands', {'action': 'intervene',
                              'expectedRevision': team['revision'], 'content': text}, key='new-product-direction')
        message_id = team['messageId']
        messages = client.request(prefix + f'/rooms/{room}/messages')['messages']
        if not any(message['id'] == message_id and message['content'] == text and message['speaker']['kind'] == 'human' for message in messages):
            raise RuntimeError('CANONICAL_HUMAN_DIRECTION_NOT_PERSISTED')
        record('bounded-team-and-canonical-human-message', modelTurns=0)
        PHASE = 'unauthenticated-denial'
        anonymous = Client(front_origin)
        if anonymous.request('/api/v1/companies', expect=(401, 403)).get('expected_status') not in (401, 403):
            raise RuntimeError('UNAUTHENTICATED_COMPANIES_ALLOWED')
        record('unauthenticated-company-denial')
        PHASE = 'restart-persistence'
        stop(process)
        stream.close()
        process = launch()
        wait_ready(process, client, backend, time.monotonic() + args.timeout)
        auth = client.request('/api/v1/auths/signin', {key: credentials[key] for key in ('email', 'password')})
        client.token = auth['token']
        persisted = client.request(prefix + f'/work-sessions/{room}')
        messages = client.request(prefix + f'/rooms/{room}/messages')['messages']
        if (persisted['botIds'] != bots or persisted['administratorId'] != auth['id'] or persisted['turn'] != 0
                or persisted['state'] != 'HUMAN_FLOOR' or persisted['maxTurns'] != 2
                or not any(message['id'] == message_id and message['content'] == text for message in messages)):
            raise RuntimeError('PRODUCT_STATE_DID_NOT_SURVIVE_PROCESS_RESTART')
        record('real-process-restart-preserves-bots-team-and-message')
        report['status'] = 'PASS'
    except Exception as error:
        report['failure'] = {'stage': PHASE, 'type': type(error).__name__}
        if isinstance(error, ApiError):
            report['failure']['httpStatus'] = error.status
        elif re.fullmatch('[A-Z][A-Z0-9_]{1,100}', str(error)):
            report['failure']['code'] = str(error)
    finally:
        PHASE = 'own-process-cleanup'
        stop(process)
        if stream:
            stream.close()
        if own_config is not None and CONFIG.is_file() and not CONFIG.is_symlink() and CONFIG.read_bytes() == own_config:
            # Only remove the exact nonsecret config this test created exclusively.
            CONFIG.unlink()
        if report['status'] != 'PASS':
            report['diagnostics'] = diagnostic_metadata(case)
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'target': target, 'checksPassed': len(checks), 'modelIntegration': 'NOT_TESTED'}))
    return 0 if report['status'] == 'PASS' else 1


def main():
    global OUTPUT, PHASE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--install', action='store_true', help='Exercise public root install before the smoke')
    parser.add_argument('--installer', action='store_true', help='Use root start/frontend proxy; requires no existing installer product config')
    parser.add_argument('--bootstrap', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--backend-port', type=int, default=18781)
    parser.add_argument('--frontend-port', type=int, default=18780)
    parser.add_argument('--timeout', type=int, default=240)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    OUTPUT = args.output.absolute()
    if not (1024 <= args.backend_port <= 65535 and 1024 <= args.frontend_port <= 65535 and args.backend_port != args.frontend_port and 30 <= args.timeout <= 600):
        raise ValueError('Bounded distinct loopback ports and timeout required')
    if args.bootstrap:
        PHASE = 'actual-local-owner-init'
        bootstrap(args)
        return 0
    if args.install:
        if not args.installer or CONFIG.exists():
            raise RuntimeError('FRESH_INSTALLER_CHECKOUT_REQUIRED')
        if source_metadata().get('trackedWorkingTreeChanges') is not False:
            raise RuntimeError('CLEAN_TRACKED_CHECKOUT_REQUIRED_FOR_INSTALL_PROOF')
        PHASE = 'public-root-install'
        subprocess.run([shutil.which('node') or 'node', str(ROOT / 'installer/starli.mjs'), 'install'], cwd=ROOT, check=True, timeout=2100)
        py = ROOT / 'installer/.runtime/python' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        if not py.is_file():
            raise RuntimeError('INSTALLER_DID_NOT_CREATE_BACKEND_PYTHON')
        PHASE = 'installed-runtime-reexecution'
        result = subprocess.call([str(py), str(Path(__file__).resolve()), '--run', '--installer', '--backend-port', str(args.backend_port),
                                  '--frontend-port', str(args.frontend_port), '--timeout', str(args.timeout), '--output', str(OUTPUT)], cwd=ROOT,
                                  env={**os.environ, 'STARLI_NEW_PRODUCT_SMOKE_ATTEMPT': ATTEMPT, 'STARLI_NEW_PRODUCT_PUBLIC_INSTALL_PASSED': '1'})
        try:
            child = json.loads(OUTPUT.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            child = {}
        if child.get('attempt') != ATTEMPT or (result == 0) != (child.get('status') == 'PASS'):
            raise RuntimeError('CURRENT_CHILD_RESULT_MISSING_OR_INCONSISTENT')
        return result
    if not args.run:
        parser.error('Choose --run or --install explicitly')
    return run(args)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        report = {'schema': 'starli.new-product-boot-smoke.v1', 'attempt': ATTEMPT, 'status': 'FAIL', 'checks': [],
                  'failure': {'stage': PHASE, 'type': type(error).__name__}, 'modelIntegration': 'NOT_TESTED'}
        if re.fullmatch('[A-Z][A-Z0-9_]{1,100}', str(error)):
            report['failure']['code'] = str(error)
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'status': 'FAIL', 'failure': report['failure']}))
        raise SystemExit(2)
