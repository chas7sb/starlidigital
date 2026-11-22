"""Boot the actual native APIs with a disposable first owner, without providers or a VM.

Only the sanitized result JSON is suitable for CI upload. Private state/logs and
synthetic passwords remain under ignored work/ and are deliberately not removed.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import signal
import subprocess
import sys
import time
import types
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {'windows-x64': 'x86_64-pc-windows-msvc', 'linux-x64': 'x86_64-unknown-linux-gnu',
           'macos-x64': 'x86_64-apple-darwin', 'macos-arm64': 'aarch64-apple-darwin'}
ATTEMPT = os.environ.get('STARLI_NATIVE_BOOT_ATTEMPT', '')
if not re.fullmatch(r'[a-f0-9]{16}', ATTEMPT):
    ATTEMPT = secrets.token_hex(8)
CONTEXT = {'phase': 'arguments', 'output': ROOT / 'work/native-boot-result.json',
           'target': None, 'local': None}
NOT_TESTED = ['frontend rendering', 'VM boot/control', 'provider login/inference',
              'email/social sends', 'publishing/payment', 'complete feature parity']


def phase(name):
    CONTEXT['phase'] = name


def failure_metadata(error, code=None):
    """Only types, fixed stage/code labels and numeric status; never exception values."""
    if code is None:
        if isinstance(error, subprocess.TimeoutExpired):
            code = 'BOUNDED_COMMAND_TIMEOUT'
        elif type(error).__name__ == 'PrivateStorageError':
            code = 'PRIVATE_STORAGE_POLICY_REJECTED'
        elif isinstance(error, PermissionError):
            code = 'PATH_ACCESS_DENIED'
        elif isinstance(error, FileNotFoundError):
            code = 'REQUIRED_PATH_OR_EXECUTABLE_MISSING'
        elif isinstance(error, subprocess.CalledProcessError):
            code = 'DEPENDENCY_OR_CHILD_COMMAND_FAILED'
        elif isinstance(error, OSError):
            code = 'FILESYSTEM_OR_PROCESS_ERROR'
        elif isinstance(error, ValueError):
            code = 'ARGUMENT_LOCK_OR_PREREQUISITE_REJECTED'
        else:
            code = 'NATIVE_BOOT_CHECK_FAILED'
    metadata = {'type': type(error).__name__, 'stage': CONTEXT['phase'], 'code': code}
    for key in ('errno', 'winerror', 'returncode'):
        value = getattr(error, key, None)
        if isinstance(value, int):
            metadata[key] = value
    match = re.search(r'HTTP ([1-5][0-9]{2})', str(error))
    if match:
        metadata['http_status'] = int(match.group(1))
    return metadata


def write_report(report, output):
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        return True
    except OSError as error:
        # Even an unwritable artifact destination gets a machine-readable console result.
        print(json.dumps({'status': 'FAIL', 'attempt': ATTEMPT, 'failure':
                          failure_metadata(error, 'RESULT_ARTIFACT_WRITE_FAILED')}))
        return False


def report_unhandled(error, code=None):
    report = {'schema': 1, 'attempt': ATTEMPT, 'host': CONTEXT['target'],
              'python': platform.python_version(), 'status': 'FAIL', 'checks': [],
              'scope': 'native boot validation stopped before or outside API checks',
              'not_tested': NOT_TESTED, 'failure': failure_metadata(error, code)}
    local = CONTEXT['local']
    if local is not None:
        try:
            report['diagnostic_metadata'] = diagnostic_metadata(local)
        except (OSError, ValueError) as diagnostic_error:
            report['diagnostic_collection_failure'] = {'type': type(diagnostic_error).__name__}
    written = write_report(report, CONTEXT['output'])
    print(json.dumps({'status': 'FAIL', 'attempt': ATTEMPT, 'failure': report['failure'],
                      'artifact_written': written}))


def onboarding():
    spec = importlib.util.spec_from_file_location('_native_boot_first_run', ROOT / 'onboarding/first_run.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def target_lock():
    system = {'Windows': 'windows', 'Linux': 'linux', 'Darwin': 'macos'}.get(platform.system())
    machine = platform.machine().lower()
    arch = 'arm64' if machine in ('arm64', 'aarch64') else 'x64' if machine in ('amd64', 'x86_64') else None
    target = f'{system}-{arch}'
    if target not in TARGETS:
        raise ValueError('This host has no reviewed native backend lock')
    lock = ROOT / 'packaging/locks' / f'dashboard-{target}-py311.txt'
    metadata = json.loads(lock.with_suffix('.json').read_text(encoding='utf-8'))
    digest = lambda path: hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
    if (metadata.get('target') != TARGETS[target] or metadata.get('python') != '3.11'
            or metadata.get('requirements_sha256') != digest(ROOT / 'dashboard/backend/requirements.txt')
            or metadata.get('lock_sha256') != digest(lock)):
        raise ValueError('The selected backend hash lock is stale or targets another host')
    return target, lock


def base_environment(local):
    allowed = ('PATH', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT',
               'LANG', 'LC_ALL', 'TZ', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE')
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    helper = onboarding().private_storage()
    # POSIX mkdir(parents=True, mode=0700) applies mode only to the final
    # component. Create this private state root FIRST, not indirectly via home/.
    phase('private_state_root_creation')
    helper.ensure_private_directory(local)
    for suffix in ('home', 'tmp', 'home/appdata', 'home/localappdata'):
        phase('private_child_directory_creation')
        helper.ensure_private_directory(local / suffix)
    env.update(HOME=str(local / 'home'), USERPROFILE=str(local / 'home'),
               APPDATA=str(local / 'home/appdata'), LOCALAPPDATA=str(local / 'home/localappdata'),
               TMP=str(local / 'tmp'), TEMP=str(local / 'tmp'),
               PYTHONUTF8='1', PYTHONIOENCODING='utf-8',
               ANONYMIZED_TELEMETRY='false', DO_NOT_TRACK='true')
    node = shutil.which('node')
    if not node:
        raise ValueError('Node 24 is required on PATH')
    env['STARLI_NODE24'] = node
    phase('node_version_check')
    result = subprocess.run([node, '-p', 'process.versions.node'], capture_output=True, text=True, timeout=15)
    if result.returncode or int(result.stdout.strip().split('.')[0]) < 24:
        raise ValueError('Native API smoke requires Node 24 or later')
    return env


def private_state(path):
    path = path.expanduser().absolute()
    work = (ROOT / 'work').absolute()
    if ('..' in path.parts or not path.is_relative_to(work) or path == work
            or not path.resolve().is_relative_to(work.resolve())):
        raise ValueError('Disposable state must be a subdirectory of ignored ROOT/work')
    for candidate in (path, *path.parents):
        if candidate.exists() and (candidate.is_symlink() or getattr(candidate.lstat(), 'st_file_attributes', 0) & 0x400):
            raise ValueError('Disposable state may not traverse a link or reparse point')
        if candidate == work:
            break
    m = onboarding()
    m.private_storage().ensure_private_directory(path)
    return m, path


def bootstrap(local, dashboard, api):
    CONTEXT['local'] = local
    phase('bootstrap_private_state_validation')
    m, local = private_state(local)
    m.LOCAL = local
    m.CONFIG = local / 'setup.json'
    credentials = m.private_read(local / 'credentials.json')
    values = iter([credentials['email'], 'Native Boot QA Owner', 'nativeqa', 'Native Boot QA Company'])
    m.input = lambda _prompt: next(values)
    m.getpass.getpass = lambda _prompt: credentials['password']
    # This injection is confined to the test child. Public setup remains interactive.
    m.sys.stdin = types.SimpleNamespace(isatty=lambda: True)
    phase('actual_first_owner_setup')
    m.setup(types.SimpleNamespace(dashboard=dashboard, platform=api))


def stop_children(children):
    for child in children:
        if child.poll() is not None:
            continue
        if os.name == 'nt':
            subprocess.run(['taskkill.exe', '/PID', str(child.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for child in children:
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                child.kill()
            else:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            child.wait(timeout=10)


def diagnostic_metadata(local):
    """Keep only traceback frame names/types, never raw log or exception values."""
    result = {}
    for label in ('bootstrap', 'platform', 'dashboard'):
        path = local / f'{label}.log'
        if not path.is_file():
            continue
        text = path.read_text(encoding='utf-8', errors='replace')[-100000:]
        frames = []
        for filename, line, function in re.findall(r'File "([^"\r\n]+)", line (\d+), in ([A-Za-z0-9_<>]+)', text):
            candidate = Path(filename)
            try:
                name = candidate.relative_to(ROOT).as_posix()
            except ValueError:
                name = candidate.name
            frames.append({'file': name, 'line': int(line), 'function': function})
        missing = re.findall(r"ModuleNotFoundError: No module named '([A-Za-z0-9_.]+)'", text)
        exceptions = re.findall(r'^([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception)):', text, re.MULTILINE)
        result[label] = {'last_frames': frames[-4:], 'exception_types': exceptions[-3:],
                         'missing_modules': missing[-3:]}
    child_result = local / 'bootstrap-result.json'
    if child_result.is_file():
        try:
            child = json.loads(child_result.read_text(encoding='utf-8'))
            failure = child.get('failure', {})
            safe = {key: failure[key] for key in ('type', 'stage', 'code')
                    if isinstance(failure.get(key), str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', failure[key])}
            safe.update({key: failure[key] for key in ('errno', 'winerror', 'returncode', 'http_status')
                         if type(failure.get(key)) is int})
            result['bootstrap_child'] = {'status': 'FAIL', 'failure': safe}
        except (OSError, ValueError, TypeError):
            result['bootstrap_child'] = {'status': 'unreadable-structured-result'}
    return result


def boot(args):
    phase('python_version_check')
    if sys.version_info[:2] != (3, 11):
        raise ValueError('Run with the installed dashboard Python 3.11')
    phase('target_lock_validation')
    target, _ = target_lock()
    CONTEXT['target'] = target
    m = onboarding()
    local = ROOT / 'work' / ('native-boot-' + secrets.token_hex(6))
    CONTEXT['local'] = local
    env = base_environment(local)
    credentials = {'email': 'native-owner@example.invalid', 'password': secrets.token_urlsafe(24)}
    phase('synthetic_private_fixture_creation')
    m.private_write(local / 'credentials.json', credentials)
    m.LOCAL = local
    m.CONFIG = local / 'setup.json'
    dashboard = m.origin(f'http://127.0.0.1:{args.dashboard_port}')
    api = m.origin(f'http://127.0.0.1:{args.platform_port}')
    if dashboard == api:
        raise ValueError('Dashboard and platform ports must differ')
    phase('loopback_port_availability')
    m.stopped(dashboard)
    m.stopped(api)
    children, logs, checks = [], [], []
    artifact_written = False
    record = lambda name, **evidence: checks.append({'name': name, 'status': 'PASS', 'evidence': evidence})
    report = {'schema': 1, 'attempt': ATTEMPT, 'host': target, 'python': platform.python_version(), 'status': 'FAIL',
              'scope': 'real native API boot and disposable first-owner/provider/tool catalog checks',
              'not_tested': NOT_TESTED, 'checks': checks}
    try:
        phase('first_owner_bootstrap_child')
        with (local / 'bootstrap.log').open('w', encoding='utf-8') as log:
            result = subprocess.run([sys.executable, __file__, '--bootstrap', str(local),
                                     '--dashboard-port', str(args.dashboard_port), '--platform-port', str(args.platform_port),
                                     '--output', str(local / 'bootstrap-result.json')],
                                    cwd=ROOT, env=env, stdout=log, stderr=log, timeout=240,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode:
            raise RuntimeError('Actual trusted first-owner bootstrap failed; private log retained')
        phase('created_owner_state_validation')
        config = m.private_read(m.CONFIG)
        owner = m.private_read(local / 'owner.json')
        record('actual-first-owner-and-company-created')
        original = os.environ.copy()
        try:
            os.environ.clear()
            os.environ.update(env)
            runtime_env = m.environment(config)
        finally:
            os.environ.clear()
            os.environ.update(original)
        runtime_env.update(STARLI_LOCAL_VM_ENABLED='0', ANONYMIZED_TELEMETRY='false', DO_NOT_TRACK='true')
        phase('api_process_launch')
        for label, command, cwd in (
                ('platform', [env['STARLI_NODE24'], '--import', 'tsx', 'server/src/index.ts'], ROOT / 'platform'),
                ('dashboard', [sys.executable, '-m', 'uvicorn', 'workspace_entry:app', '--host', '127.0.0.1',
                               '--port', str(args.dashboard_port)], ROOT / 'dashboard/backend')):
            stream = (local / f'{label}.log').open('w', encoding='utf-8')
            logs.append(stream)
            children.append(subprocess.Popen(command, cwd=cwd, env=runtime_env, stdout=stream, stderr=stream,
                                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                                             start_new_session=os.name != 'nt'))
        phase('actual_api_health')
        deadline = time.monotonic() + args.boot_timeout
        while True:
            if any(child.poll() is not None for child in children):
                raise RuntimeError('A real API process exited before readiness; private logs retained')
            try:
                if m.request(api, '/health').get('ok') is not True:
                    raise RuntimeError('Platform not ready')
                if m.request(dashboard, '/health').get('status') is not True:
                    raise RuntimeError('Dashboard not ready')
                break
            except (OSError, RuntimeError):
                if time.monotonic() >= deadline:
                    raise RuntimeError('Actual API boot deadline exceeded; private logs retained')
                time.sleep(2)
        record('actual-api-health', platform=True, dashboard=True)
        phase('actual_owner_sign_in')
        auth = m.request(dashboard, '/api/v1/auths/signin', credentials)
        if auth.get('role') != 'admin' or not auth.get('token'):
            raise RuntimeError('Actual owner sign-in failed')
        token = auth['token']
        record('actual-owner-sign-in')
        phase('administrator_binding')
        admin = m.request(dashboard, '/api/v1/starli/platform/admin', token=token)
        if admin.get('services', {}).get('sourceDatabase') != 'read-only connected':
            raise RuntimeError('Actual private administrator binding failed')
        record('private-administrator-binding')
        phase('company_authority')
        companies = m.request(dashboard, '/api/v1/companies', token=token)
        if not any(row[0] == owner['company_id'] and row[2] == 'owner' for row in companies):
            raise RuntimeError('Created company is not visible to the authenticated owner')
        capability = m.request(dashboard, f"/api/v1/companies/{owner['company_id']}/capabilities", token=token)
        if capability.get('role') != 'owner' or capability.get('user_id') != auth['id']:
            raise RuntimeError('Actual company owner authority failed')
        record('company-owner-authority')
        phase('unauthenticated_denial')
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), m.NoRedirect())
            with opener.open(dashboard + '/api/v1/starli/platform/admin', timeout=15):
                raise RuntimeError('Unauthenticated administrator access was allowed')
        except urllib.error.HTTPError as error:
            if error.code not in (401, 403):
                raise RuntimeError('Unauthenticated administrator denial returned the wrong status') from None
        record('unauthenticated-administrator-denied')
        phase('installed_provider_catalog')
        providers = m.request(dashboard, '/api/v1/starli/providers', token=token)
        items = providers.get('items')
        if not isinstance(items, list) or not items or providers.get('credentialsVisible') is not False:
            raise RuntimeError('Actual credential-free provider catalog is unavailable')
        record('actual-installed-provider-catalog', providers=len(items))
        phase('scoped_tool_catalog')
        tools = m.request(dashboard, '/api/v1/starli/tools/catalog', token=token).get('tools')
        if not isinstance(tools, list) or not tools:
            raise RuntimeError('Actual scoped platform tool catalog is unavailable')
        record('actual-scoped-tool-catalog', tools=len(tools))
        report['status'] = 'PASS'
    except Exception as error:
        # Messages are selected generic test stages; never emit response bodies or logs.
        report['failure'] = failure_metadata(error)
    finally:
        try:
            stop_children(children)
        except (OSError, subprocess.SubprocessError) as error:
            phase('own_process_cleanup')
            report['status'] = 'FAIL'
            report['failure'] = failure_metadata(error, 'OWN_PROCESS_CLEANUP_FAILED')
        for stream in logs:
            stream.close()
        if report['status'] != 'PASS':
            report['diagnostic_metadata'] = diagnostic_metadata(local)
        artifact_written = write_report(report, args.output)
    if not artifact_written:
        return 2
    print(json.dumps({'status': report['status'], 'host': target, 'passed': len(checks),
                      'result': str(args.output), 'private_diagnostics': str(local)}))
    return 0 if report['status'] == 'PASS' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true', help='Create a dedicated Python3.11 environment from the target hash lock')
    parser.add_argument('--bootstrap', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--run', action='store_true', help='Run with the current installed dashboard Python3.11')
    parser.add_argument('--dashboard-port', type=int, default=18480)
    parser.add_argument('--platform-port', type=int, default=18481)
    parser.add_argument('--boot-timeout', type=int, default=300)
    parser.add_argument('--output', type=Path, default=ROOT / 'work/native-boot-result.json')
    args = parser.parse_args()
    args.output = args.output.expanduser().absolute()
    CONTEXT['output'] = args.output
    if not (1024 <= args.dashboard_port <= 65535 and 1024 <= args.platform_port <= 65535 and 30 <= args.boot_timeout <= 600):
        parser.error('Ports must be 1024..65535 and boot timeout 30..600 seconds')
    if args.bootstrap:
        bootstrap(args.bootstrap, f'http://127.0.0.1:{args.dashboard_port}', f'http://127.0.0.1:{args.platform_port}')
        return 0
    if args.install:
        phase('install_target_lock_validation')
        selected_target, lock = target_lock()
        CONTEXT['target'] = selected_target
        phase('uv_prerequisite_check')
        uv = shutil.which('uv')
        if not uv:
            raise ValueError('Install the pinned uv runtime before this command')
        environment = ROOT / 'installer/.runtime/native-boot-python'
        python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        if not python.exists():
            phase('python_environment_creation')
            subprocess.run([uv, 'venv', '--python', '3.11', str(environment)], cwd=ROOT, check=True, timeout=180)
        phase('python_hash_lock_installation')
        subprocess.run([uv, 'pip', 'sync', '--python', str(python), '--require-hashes',
                        '--default-index', 'https://pypi.org/simple', str(lock)], cwd=ROOT, check=True, timeout=1800)
        phase('installed_python_reexecution')
        result = subprocess.call([str(python), __file__, '--run', '--dashboard-port', str(args.dashboard_port),
                                '--platform-port', str(args.platform_port), '--boot-timeout', str(args.boot_timeout),
                                '--output', str(args.output)], cwd=ROOT,
                                 env={**os.environ, 'STARLI_NATIVE_BOOT_ATTEMPT': ATTEMPT})
        try:
            child_report = json.loads(args.output.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            child_report = {}
        if child_report.get('attempt') != ATTEMPT or child_report.get('status') not in ('PASS', 'FAIL'):
            report_unhandled(RuntimeError(), 'REEXEC_FAILED_WITHOUT_CURRENT_RESULT')
            return result or 2
        return result
    if not args.run:
        parser.error('Choose --install or --run explicitly')
    return boot(args)


if __name__ == '__main__':
    try:
        outcome = main()
    except SystemExit as error:
        if error.code:
            report_unhandled(error, 'ARGUMENT_PARSING_FAILED')
        raise
    except KeyboardInterrupt as error:
        report_unhandled(error, 'INTERRUPTED')
        outcome = 130
    except Exception as error:
        report_unhandled(error)
        outcome = 2
    raise SystemExit(outcome)
