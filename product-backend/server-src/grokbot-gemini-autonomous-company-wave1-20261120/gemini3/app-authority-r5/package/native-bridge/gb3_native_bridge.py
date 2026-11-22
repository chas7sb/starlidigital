"""grokbot3/gemini3 -> grokbot1 native identity bridge (W1/R5, NATIVE_NONPRODUCTION).

Imports grokbot1's PUBLISHED adapter READ-ONLY (native_harness + Grokbot1Service.native_session,
both SHA256-pinned below) and through it the ACTUAL pinned native WebUI v33 modules, then answers
one question for the trusted host: "is this native JWT a live, allowed native session, and is
its user an active PERSON member of company C?" Output is a JSON verdict on stdout; the JWT itself
is read from env GB3_NATIVE_JWT only (never argv, never logged).

Disposable native root MUST live under the configured disposable parent (default: <owned>/.test-tmp
or GB3_DISPOSABLE_PARENT), and NEVER under production /srv/starlidigital/data or /srv/starlidigital/state.
"""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, os, secrets, sqlite3, sys
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

STAGE = Path(__file__).resolve().parent.parent


def _resolve_grokbot1() -> Path:
    env_dir = os.environ.get('GB3_GROKBOT1_DIR')
    if env_dir:
        return Path(env_dir).resolve()
    # Walk up ancestors to find pinned grokbot1 directory
    for ancestor in STAGE.parents:
        cand = ancestor / 'grokbot1'
        if (cand / 'native_harness.py').is_file():
            return cand.resolve()
    return (STAGE.parent / 'grokbot1').resolve()


GROKBOT1 = _resolve_grokbot1()
GROKBOT1_PINS = {  # read-only dependency on grokbot1's published adapter (full sha256, fail closed on drift)
    'native_harness.py': '3752a984fd132a24d6dc242e1f299822ba3031802479bed1893ab1906bc8d2db',
    'grokbot1_claim.py': 'db62b76088944289e2cd6b580e0cc5468aa365d8e3132162a03ff820767b4462',
    'CONTRACT.md': '6de40455a8c619b2c8b005ad3701d3a406d807018a1439936ca7bf0ee6b93dd5',
}
FORBIDDEN_PREFIXES = (
    Path('/srv/starlidigital/data'),
    Path('/srv/starlidigital/state'),
    Path('/var/lib/starlidigital'),
)
WRITE_ROLES = {'owner', 'admin', 'member'}


def fail(status, code, detail=''):
    print(json.dumps({'ok': False, 'status': status, 'error': code, 'detail': detail}))
    sys.exit(3)


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def verify_grokbot1_pins():
    got = {}
    for rel, expected in GROKBOT1_PINS.items():
        target = GROKBOT1 / rel
        if not target.is_file():
            fail(500, 'GROKBOT1_SOURCE_MISSING', str(target))
        h = sha(target)
        if h != expected:
            fail(500, 'GROKBOT1_SOURCE_DRIFT', rel)
        got['grokbot1:' + rel] = h
    return got


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _disposable_parent() -> Path:
    env_parent = os.environ.get('GB3_DISPOSABLE_PARENT')
    if env_parent:
        return Path(env_parent).resolve()
    return (STAGE / '.test-tmp').resolve()


def prepare_stage_env(root, harness):
    root = Path(root).resolve()
    for bad in FORBIDDEN_PREFIXES:
        if root == bad or bad in root.parents:
            fail(400, 'PRODUCTION_PATH_FORBIDDEN', str(root))
    parent = _disposable_parent()
    if parent not in root.parents:
        fail(400, 'DISPOSABLE_ROOT_OUTSIDE_STAGE', f'{root} not under {parent}')
    paths = harness.Paths(root)
    for d in (paths.data, paths.state, paths.intake.parent):
        d.mkdir(parents=True, exist_ok=True, mode=0o700)
    keyfile = root / '.ephemeral-test-key'
    if not keyfile.exists():
        fd = os.open(str(keyfile), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_urlsafe(48))
    key = keyfile.read_text().strip()
    for name in list(os.environ):
        if name.startswith(('STARLI_', 'DATABASE_', 'WEBUI_', 'DATA_DIR', 'REDIS', 'OPENAI', 'OPENROUTER')):
            os.environ.pop(name, None)
    os.environ.update({
        'DATA_DIR': str(paths.data), 'STARLI_STATE_DIR': str(paths.state),
        'STARLI_SOURCE_DATABASE': str(root / 'source-unused.sqlite'),
        'DATABASE_URL': 'sqlite:///' + str(paths.main), 'WEBUI_SECRET_KEY': key,
        'OFFLINE_MODE': 'true', 'PYTHONDONTWRITEBYTECODE': '1', 'ENABLE_SIGNUP': 'false',
        'STATIC_DIR': str(root / 'static'), 'HOME': str(root / 'home'),
        'TMPDIR': str(root / 'tmp'),
    })
    (root / 'tmp').mkdir(exist_ok=True); (root / 'home').mkdir(exist_ok=True)
    return paths


def boot(root):
    sys.dont_write_bytecode = True
    token = os.environ.pop('GB3_NATIVE_JWT', None)
    pins = verify_grokbot1_pins()
    harness = load_module('grokbot1_native_harness', GROKBOT1 / 'native_harness.py')
    paths = prepare_stage_env(root, harness)
    ns = harness.load_native(paths)
    harness.ensure_native_databases(ns)
    if str(GROKBOT1) not in sys.path:
        sys.path.insert(0, str(GROKBOT1))
    claim = load_module('grokbot1_claim', GROKBOT1 / 'grokbot1_claim.py')
    pins.update({k: v for k, v in ns.pins.items()})
    return SimpleNamespace(token=token, harness=harness, paths=paths, ns=ns, claim=claim, pins=pins)


def native_session(b):
    try:
        session, uid = b.claim.Grokbot1Service.native_session(SimpleNamespace(ns=b.ns), b.token)
    except b.claim.ClaimError as e:
        fail(e.status, e.code)
    payload = b.ns.auth.decode_token(b.token)
    return session, uid, payload


def cmd_verify(a):
    b = boot(a.root)
    session, uid, payload = native_session(b)
    rb = b.ns.RbacAuthority(str(b.paths.authority))
    try:
        eff = rb.effective(uid, a.company)
    except Exception:
        fail(403, 'NOT_COMPANY_MEMBER')
    if getattr(eff, 'kind', None) != 'person' or not getattr(eff, 'active', False):
        fail(403, 'NOT_ACTIVE_PERSON_MEMBER')
    role = str(getattr(eff, 'role', ''))
    rev = int(getattr(eff, 'revision', 0))
    scope = ['dog:read'] + (['dog:write'] if role in WRITE_ROLES else [])
    print(json.dumps({
        'ok': True,
        'nativeUserId': uid,
        'companyId': a.company,
        'role': role,
        'kind': 'person',
        'membershipRevision': rev,
        'scope': scope,
        'nativeTokenHash': session.token_hash,
        'nativeFamilyHash': session.family_hash,
        'nativeExp': payload.get('exp'),
        'nativeAuthorityDb': str(b.paths.authority),
        'nativeRevocationDb': str(b.paths.revocations),
        'pins': b.pins,
    }))


def cmd_setup(a):
    b = boot(a.root)
    # Create disposable native users/memberships and mint a JWT for the first member
    first_uid = None
    for spec in a.member:
        uid, role, kind, comp = spec.split(',')
        if first_uid is None:
            first_uid = uid
        b.harness.seed_user(b.ns, uid, f'{uid}@disposable.local', role='user')
        with closing(sqlite3.connect(str(b.paths.authority))) as db, db:
            db.execute(
                'INSERT OR REPLACE INTO members (company_id, user_id, role, active, revision, kind) VALUES (?, ?, ?, 1, 1, ?)',
                (comp, uid, role, kind),
            )
    jwt = b.harness.mint_jwt(b.ns, first_uid, minutes=a.minutes)
    print(json.dumps({
        'ok': True,
        'nativeUserId': first_uid,
        'jwt': jwt,
        'nativeAuthorityDb': str(b.paths.authority),
        'nativeRevocationDb': str(b.paths.revocations),
        'pins': b.pins,
    }))


def cmd_revoke_session(a):
    b = boot(a.root)
    r = b.ns.revocation.revoke_and_enqueue(b.token, reason='gemini3_r5_test_revoke')
    print(json.dumps({'ok': True, 'newlyRevoked': r.get('newlyRevoked', True)}))


def cmd_set_member(a):
    b = boot(a.root)
    with closing(sqlite3.connect(str(b.paths.authority))) as db, db:
        n = db.execute(
            'UPDATE members SET active=?, revision=revision+1 WHERE company_id=? AND user_id=?',
            (int(a.active), a.company, a.user),
        ).rowcount
    print(json.dumps({'ok': True, 'changed': n}))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='cmd', required=True)
    v = sub.add_parser('verify'); v.add_argument('--root', required=True); v.add_argument('--company', required=True)
    s = sub.add_parser('setup-fixture'); s.add_argument('--root', required=True)
    s.add_argument('--member', action='append', required=True); s.add_argument('--minutes', type=int, default=30)
    r = sub.add_parser('revoke-session'); r.add_argument('--root', required=True)
    m = sub.add_parser('set-member'); m.add_argument('--root', required=True); m.add_argument('--company', required=True); m.add_argument('--user', required=True); m.add_argument('--active', required=True)
    a = p.parse_args()
    {'verify': cmd_verify, 'setup-fixture': cmd_setup, 'revoke-session': cmd_revoke_session, 'set-member': cmd_set_member}[a.cmd](a)


if __name__ == '__main__':
    main()
