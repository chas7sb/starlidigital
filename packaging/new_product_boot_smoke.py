"""Real socket and restart smoke for product/ + product-backend/, not the legacy UI.

No model response is mocked or requested. Only sanitized result JSON may be
uploaded. Private synthetic credentials, cookies, databases and logs stay in work/.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
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
import threading
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
    def __init__(self, status, diagnostic_code=None):
        self.status = status
        self.diagnostic_code = diagnostic_code
        super().__init__('HTTP_CHECK_FAILED')


class Client:
    def __init__(self, base, origin=None):
        self.base = literal_origin(base)
        self.origin = literal_origin(origin or base)
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                                  urllib.request.HTTPCookieProcessor(self.jar), NoRedirect())
        self.token = None

    def request(self, path, payload=None, method=None, key=None, guest=False, expect=(200,), status_only=False, include_status=False, setup=False):
        if not path.startswith('/') or path.startswith('//'):
            raise ValueError('Fixed API-relative path required')
        headers = {'Content-Type': 'application/json', 'Origin': self.origin}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        if key:
            headers['Idempotency-Key'] = key
        if guest:
            headers['x-starli-guest-intent'] = '1'
        if setup:
            headers['x-starli-setup'] = '1'
        request = urllib.request.Request(self.base + path, method=method or ('POST' if payload is not None else 'GET'),
                                         headers=headers, data=None if payload is None else json.dumps(payload).encode())
        try:
            with self.opener.open(request, timeout=45) as response:
                if response.status not in expect:
                    raise ApiError(response.status)
                if status_only:
                    return response.status
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise RuntimeError('RESPONSE_LIMIT')
                if response.headers.get_content_type() == 'text/html':
                    return raw.decode('utf-8')
                value = json.loads(raw)
                return (response.status, value) if include_status else value
        except urllib.error.HTTPError as error:
            try:
                if error.code in expect:
                    if include_status:
                        return error.code, {}
                    return error.code if status_only else {'expected_status': error.code}
                diagnostic_code = None
                try:
                    body = json.loads(error.read(16385))
                    code = body.get('error', {}).get('code') if isinstance(body.get('error'), dict) else body.get('detail')
                    if code in {'MESSAGING_UNAVAILABLE', 'MEMBERSHIP_INCARNATION_REQUIRED', 'ATOMIC_AUTHORITY_REQUIRED',
                                'AUTHORITY_TABLE_COLLISION', 'COMPANY_INTEGRATION_GATES_REQUIRED', 'CANONICAL_CHANNEL_MISSING'}:
                        diagnostic_code = code
                except (ValueError, TypeError, AttributeError):
                    pass
                raise ApiError(error.code, diagnostic_code) from None
            finally:
                error.close()


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


def setup_status(client, required):
    status = client.request('/api/v1/setup/status')
    if (status.get('setupRequired') is not required or status.get('singleCompany') is not True
            or status.get('registrationAllowed') is not False or status.get('setupLocked') is not (not required)
            or status.get('companyConfigured') is not (not required) or status.get('requiresMigration') is not False):
        raise RuntimeError('SINGLE_COMPANY_SETUP_STATUS_MISMATCH')


def browser_setup_race(base, credentials):
    """Exercise the public HTTP first-admin flow, never a patched initializer."""
    payload = {key: credentials[key] for key in ('email', 'password')}
    payload.update(name='New Product Boot QA Owner', companyName='Fresh singleton smoke company')
    barrier = threading.Barrier(2)
    def attempt():
        client = Client(base)
        barrier.wait(timeout=10)
        return client.request('/api/v1/setup', payload, expect=(201, 409), include_status=True, setup=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(attempt) for _ in range(2)]
        responses = [future.result(timeout=60) for future in futures]
        statuses = sorted(status for status, _ in responses)
    if statuses != [201, 409]:
        raise RuntimeError('FIRST_ADMIN_RACE_MUST_HAVE_EXACTLY_ONE_WINNER')
    created = next(body for status, body in responses if status == 201)
    if (created.get('setupComplete') is not True or not created.get('companyId')
            or any(key in created for key in ('password', 'token', 'access_token'))):
        raise RuntimeError('FIRST_ADMIN_RESPONSE_CONTRACT_MISMATCH')
    Client(base).request('/api/v1/setup', payload, expect=(409,), setup=True)
    return created['companyId']


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


def wait_ports_released(ports, timeout=20):
    """A wrapper's exit does not mean its gracefully stopping listeners exited.

    Probe TCP listeners instead of binding without SO_REUSEADDR: a closed POSIX
    server can leave TIME_WAIT sockets that Node itself can legitimately reuse.
    No other process is signalled or adopted by this check.
    """
    import errno
    refused = {errno.ECONNREFUSED, 10061}
    deadline = time.monotonic() + timeout
    while True:
        active = False
        for port in ports:
            with socket.socket() as probe:
                # Windows may take about two seconds to report a refused local
                # connection. A shorter timeout falsely treats a closed port
                # as a still-running listener.
                probe.settimeout(3)
                if probe.connect_ex(('127.0.0.1', port)) not in refused:
                    active = True
        if not active:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError('OWNED_PRODUCT_LISTENERS_DID_NOT_STOP')
        time.sleep(.05)


def wait_ready(process, client, backend, deadline):
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('PRODUCT_PROCESS_EXITED')
        try:
            health = backend.request('/health')
            if (health.get('status') not in ('ready', 'setup_required') or not str(health.get('backend', '')).startswith('NEW_COMPANY_')
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
            'missingModules': re.findall(r"ModuleNotFoundError: No module named '([A-Za-z0-9_.]+)'", text)[-3:],
            'lifecycleSignals': [code for code, pattern in (
                ('START_PORT_OCCUPIED', r'Loopback port\s*\d+ is occupied'),
                ('PRODUCT_CHILD_EXITED_EARLY', r'A product process exited before readiness'),
                ('PRODUCT_READINESS_FAILED', r'New product readiness failed'),
                ('NODE_EXECUTABLE_OR_PATH_MISSING', r'\bENOENT\b'),
                ('WINDOWS_ARCHIVE_RUNTIME_MISMATCH', r'ExtractToDirectory.*argument count'),
            ) if re.search(pattern, text)],
            'commandExitCodes': [int(code) for code in re.findall(r'Command exited (-?\d+)', text)[-3:]]}
    return result


def source_metadata():
    files = ('product/src/routes/+page.svelte', 'product/src/routes/app/+page.svelte',
             'product-backend/local_server.py', 'product-backend/local_installation.py',
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
    report = {'schema': 'starli.new-product-boot-smoke.v2', 'attempt': ATTEMPT, 'host': target, 'status': 'FAIL',
              'deploymentProfile': 'single-company-browser-first',
              'productSource': 'product/', 'backendEntrypoint': 'product-backend/local_server.py',
              'launchMode': 'public-installer-start' if args.installer else 'backend-entrypoint-only',
              'publicInstall': 'PASS' if os.environ.get('STARLI_NEW_PRODUCT_PUBLIC_INSTALL_PASSED') == '1' else 'NOT_TESTED',
              'sourceEvidence': source_metadata(),
              'checks': checks, 'requestedModelCalls': 0, 'fixtureBotTurns': 0,
              'modelIntegration': 'NOT_TESTED', 'externalActions': 'NOT_REQUESTED',
              'notTested': ['live model/provider execution', 'autonomous agent delegation', 'generated-app preview lifecycle',
                            'VM execution', 'full browser interaction/parity']}
    record = lambda name, **evidence: checks.append({'name': name, 'status': 'PASS', 'evidence': evidence})
    try:
        if args.installer:
            # Root start itself must support a fresh unconfigured installation.
            # Only nonsecret path/ports are injected; no CLI owner initializer.
            env.update(STARLI_PRODUCT_STATE=str(case / 'instance'),
                       STARLI_PRODUCT_FRONTEND_PORT=str(args.frontend_port),
                       STARLI_PRODUCT_BACKEND_PORT=str(args.backend_port))
            if args.instance:
                env['STARLI_PRODUCT_INSTANCE'] = args.instance

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
        if args.installer:
            candidate = CONFIG.read_bytes()
            config = json.loads(candidate)
            if (Path(config.get('state', '')).resolve() != (case / 'instance').resolve()
                    or config.get('frontendPort') != args.frontend_port or config.get('backendPort') != args.backend_port):
                raise RuntimeError('ROOT_START_CONFIG_DOES_NOT_MATCH_FRESH_TEST_INSTANCE')
            own_config = candidate
        record('new-product-socket-health', backend=health['backend'], frontendProxy=args.installer)
        PHASE = 'browser-first-owner-setup'
        setup_status(client, True)
        # Wrong frontend Origin must not acquire this fresh installation.
        wrong_origin = 'http://127.0.0.1:1'
        Client(front_origin, origin=wrong_origin).request('/api/v1/setup', {
            'email': credentials['email'], 'password': credentials['password'],
            'name': 'Origin denied owner', 'companyName': 'Origin denied company'}, expect=(403,), setup=True)
        setup_status(client, True)
        bootstrap_company = browser_setup_race(front_origin, credentials)
        setup_status(client, False)
        record('public-http-first-admin-atomic-race-and-replay-denial', concurrentRequests=2,
               createdAdmins=1, replayStatus=409, frontendProxy=args.installer, cliOwnerInitialization=False)
        PHASE = 'native-owner-login'
        auth = client.request('/api/v1/auths/signin', {key: credentials[key] for key in ('email', 'password')})
        if auth.get('role') != 'admin' or not auth.get('token'):
            raise RuntimeError('NATIVE_OWNER_LOGIN_FAILED')
        client.token = auth['token']
        record('actual-native-owner-login')
        PHASE = 'autoprovisioned-singleton-company-read'
        companies = client.request('/api/v1/companies')
        if not isinstance(companies, list) or len(companies) != 1:
            raise RuntimeError('EXACTLY_ONE_AUTOPROVISIONED_COMPANY_REQUIRED')
        company = companies[0]['id'] if isinstance(companies[0], dict) else companies[0][0]
        if company != bootstrap_company:
            raise RuntimeError('SETUP_AND_WORKSPACE_COMPANY_ID_MISMATCH')
        PHASE = 'second-company-creation-denial'
        client.request('/api/v1/companies', {'name': 'Forbidden second company'}, expect=(409,))
        PHASE = 'signup-and-guest-denial'
        anonymous = Client(front_origin)
        anonymous.request('/api/v1/auths/signup', {'email': 'second@example.invalid', 'name': 'Forbidden registration',
                          'password': credentials['password']}, expect=(403, 404))
        anonymous.request('/api/v1/starli/public/grokbot1/intents', {'text': 'Forbidden guest'}, guest=True, expect=(403, 404))
        anonymous.request('/api/v1/starli/public/grokbot1/provisional', {'intentId': 'forbidden-smoke-intent'}, guest=True, expect=(403, 404))
        if client.request('/api/v1/companies') != companies:
            raise RuntimeError('DENIED_REQUESTS_CHANGED_SINGLETON_COMPANY')
        record('singleton-company-autoprovisioned-registration-and-guest-disabled', companies=1)
        PHASE = 'company-and-bot-install'
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
        # Bot admission legitimately increments membership revisions. Snapshot
        # after those mutations so restart compares the same state boundary.
        companies = client.request('/api/v1/companies')
        if (len(companies) != 1 or (companies[0]['id'] if isinstance(companies[0], dict) else companies[0][0]) != company):
            raise RuntimeError('SINGLETON_COMPANY_CHANGED_DURING_WORKSPACE_OPERATIONS')
        stop(process)
        stream.close()
        # Public root start is a nested Node launcher. On POSIX the outer
        # wrapper can exit before the inner launcher's SIGTERM cleanup ends.
        wait_ports_released((args.backend_port, args.frontend_port) if args.installer else (args.backend_port,))
        process = launch()
        wait_ready(process, client, backend, time.monotonic() + args.timeout)
        auth = client.request('/api/v1/auths/signin', {key: credentials[key] for key in ('email', 'password')})
        client.token = auth['token']
        setup_status(Client(front_origin), False)
        restarted_companies = client.request('/api/v1/companies')
        if restarted_companies != companies:
            raise RuntimeError('SINGLETON_COMPANY_CHANGED_AFTER_RESTART')
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
            if error.diagnostic_code:
                report['failure']['code'] = error.diagnostic_code
        elif re.fullmatch('[A-Z][A-Z0-9_]{1,100}', str(error)):
            report['failure']['code'] = str(error)
    finally:
        PHASE = 'own-process-cleanup'
        try:
            stop(process)
            wait_ports_released((args.backend_port, args.frontend_port) if args.installer else (args.backend_port,))
        except Exception as error:
            # Cleanup failure must fail the run while retaining earlier evidence.
            report['status'] = 'FAIL'
            report['cleanupFailure'] = {'stage': PHASE, 'type': type(error).__name__}
            if re.fullmatch('[A-Z][A-Z0-9_]{1,100}', str(error)):
                report['cleanupFailure']['code'] = str(error)
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
    global OUTPUT, PHASE, CONFIG
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--install', action='store_true', help='Exercise public root install before the smoke')
    parser.add_argument('--installer', action='store_true', help='Use root start/frontend proxy; requires no existing installer product config')
    parser.add_argument('--instance', default='', help='Explicit fresh named installer instance; preserves the default preview configuration')
    parser.add_argument('--backend-port', type=int, default=18781)
    parser.add_argument('--frontend-port', type=int, default=18780)
    parser.add_argument('--timeout', type=int, default=240)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    OUTPUT = args.output.absolute()
    if args.instance:
        if not args.installer or not re.fullmatch('[a-z0-9_-]{1,40}', args.instance):
            raise ValueError('A bounded fresh installer instance name is required')
        CONFIG = ROOT / 'installer/.runtime' / f'product-{args.instance}.json'
    if not (1024 <= args.backend_port <= 65535 and 1024 <= args.frontend_port <= 65535 and args.backend_port != args.frontend_port and 30 <= args.timeout <= 600):
        raise ValueError('Bounded distinct loopback ports and timeout required')
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
                                  '--frontend-port', str(args.frontend_port), '--timeout', str(args.timeout), '--output', str(OUTPUT),
                                  *(['--instance', args.instance] if args.instance else [])], cwd=ROOT,
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
        report = {'schema': 'starli.new-product-boot-smoke.v2', 'deploymentProfile': 'single-company-browser-first',
                  'attempt': ATTEMPT, 'status': 'FAIL', 'checks': [],
                  'failure': {'stage': PHASE, 'type': type(error).__name__}, 'modelIntegration': 'NOT_TESTED'}
        if re.fullmatch('[A-Z][A-Z0-9_]{1,100}', str(error)):
            report['failure']['code'] = str(error)
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'status': 'FAIL', 'failure': report['failure']}))
        raise SystemExit(2)
