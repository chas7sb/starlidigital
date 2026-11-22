"""grokbot3 -> grokbot1 native identity bridge (W1, NATIVE_NONPRODUCTION).

Imports grokbot1's PUBLISHED adapter READ-ONLY (native_harness + Grokbot1Service.native_session,
both SHA256-pinned below) and through it the ACTUAL pinned native WebUI v33 modules, then answers
one question for the DogLove launcher: "is this native JWT a live, allowed native session, and is
its user an active PERSON member of company C?"  Output is a JSON verdict on stdout; the JWT itself
is read from env GB3_NATIVE_JWT only (never argv, never logged).

Disposable native root MUST live under this stage's .test-tmp/ (Boss: all temp under stage), so
grokbot1's /tmp-only prepare_env is NOT called; prepare_stage_env below replicates its env isolation
exactly (same scrubbed prefixes, same DATA_DIR/STATE/DATABASE_URL/ephemeral key layout).
Commands:
  verify        --root R --company C                 (uses GB3_NATIVE_JWT)
  setup-fixture --root R --member uid,role,kind,company [--member ...] [--minutes N]
                -> SYNTHETIC_DISPOSABLE_NATIVE_USER + native-shaped company/member rows; prints jwt (test-only)
  revoke-session --root R                            (native revoke_and_enqueue on GB3_NATIVE_JWT)
  set-member    --root R --company C --user U --active 0|1   (native-shaped revision bump)
"""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, os, secrets, sqlite3, sys
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

STAGE = Path(__file__).resolve().parent.parent
GROKBOT1 = STAGE.parent / 'grokbot1'
GROKBOT1_PINS = {  # read-only dependency on grokbot1's published adapter (full sha256, recorded 2026-11-20; fail closed on drift)
    'native_harness.py': '3752a984fd132a24d6dc242e1f299822ba3031802479bed1893ab1906bc8d2db',  # v1.2 (adds Auths pin + disposable Auth row; prepare_env/load_native contract unchanged)
    'grokbot1_claim.py': 'db62b76088944289e2cd6b580e0cc5468aa365d8e3132162a03ff820767b4462',  # v1.2 (native_session unchanged)
    'CONTRACT.md': '6de40455a8c619b2c8b005ad3701d3a406d807018a1439936ca7bf0ee6b93dd5',  # grokbot1 CONTRACT v1.2
}
DISPOSABLE_PARENT = STAGE / '.test-tmp'
WRITE_ROLES = {'owner', 'admin', 'member'}


def fail(status, code, detail=''):
    print(json.dumps({'ok': False, 'status': status, 'error': code, 'detail': detail}))
    sys.exit(3)


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def verify_grokbot1_pins():
    got = {}
    for rel, prefix in GROKBOT1_PINS.items():
        h = sha(GROKBOT1 / rel)
        if h != prefix:
            fail(500, 'GROKBOT1_SOURCE_DRIFT', rel)
        got['grokbot1:' + rel] = h
    return got


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def prepare_stage_env(root, harness):
    root = Path(root).resolve()
    if DISPOSABLE_PARENT.resolve() not in root.parents:
        fail(400, 'DISPOSABLE_ROOT_OUTSIDE_STAGE', str(root))
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
    sys.dont_write_bytecode = True  # never write __pycache__ into grokbot1's stage or the native release
    token = os.environ.pop('GB3_NATIVE_JWT', None)
    pins = verify_grokbot1_pins()
    harness = load_module('grokbot1_native_harness', GROKBOT1 / 'native_harness.py')
    paths = prepare_stage_env(root, harness)
    ns = harness.load_native(paths)          # grokbot1: pins + imports actual native v33, checks paths stay in root
    harness.ensure_native_databases(ns)
    if str(GROKBOT1) not in sys.path:
        sys.path.insert(0, str(GROKBOT1))
    claim = load_module('grokbot1_claim', GROKBOT1 / 'grokbot1_claim.py')
    pins.update({k: v for k, v in ns.pins.items()})
    return SimpleNamespace(token=token, harness=harness, paths=paths, ns=ns, claim=claim, pins=pins)


def native_session(b):
    """grokbot1's published adapter: Grokbot1Service.native_session (mirror of native_mount)."""
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
    except Exception as e:  # native Denied / missing membership
        fail(403, 'NATIVE_NOT_COMPANY_MEMBER', type(e).__name__)
    finally:
        try: rb.db.close()
        except Exception: pass
    with closing(sqlite3.connect(str(b.paths.authority))) as db:
        row = db.execute('SELECT active FROM members WHERE company_id=? AND user_id=?', (a.company, uid)).fetchone()
    if not row or int(row[0]) != 1:
        fail(403, 'NATIVE_MEMBERSHIP_INACTIVE')
    if eff['kind'] != 'person':
        fail(403, 'NATIVE_PRINCIPAL_NOT_PERSON', eff['kind'])
    exp = payload.get('exp')
    scope = ['dog:read'] + (['dog:write'] if eff['role'] in WRITE_ROLES else [])
    print(json.dumps({
        'ok': True, 'schema': 'GB3_NATIVE_IDENTITY_VERDICT_V1', 'executionClass': 'NATIVE_NONPRODUCTION',
        'adapter': 'grokbot1.Grokbot1Service.native_session + native v33 Authority.effective',
        'nativeUserId': uid, 'companyId': a.company, 'role': eff['role'], 'kind': eff['kind'],
        'membershipRevision': int(eff['membership_revision']), 'scope': scope,
        'nativeTokenHash': session.token_hash if hasattr(session, 'token_hash') else hashlib.sha256(b.token.encode()).hexdigest(),
        'nativeFamilyHash': b.ns.revocation.session_family(b.token, payload),
        'nativeExp': int(float(exp)) if exp is not None else None,
        'nativeAuthorityDb': str(b.paths.authority), 'nativeRevocationDb': str(b.ns.revocation._path()),
        'pins': b.pins,
    }))


def cmd_setup(a):
    """--member uid,role,kind,company (repeatable). Test-only: prints disposable JWTs on stdout."""
    b = boot(a.root)
    out = {}
    for spec in a.member:
        uid, role, kind, company = spec.split(',')
        b.harness.create_disposable_native_user(b.ns, uid, 'GB3 synthetic ' + uid)
        with closing(sqlite3.connect(str(b.paths.authority))) as db, db:
            db.execute('INSERT OR IGNORE INTO companies VALUES(?,?)', (company, 'DogLove W1 disposable'))
            # same native-shaped row grokbot1 writes in its claim decision (role, active=1, revision=1, name, kind)
            db.execute("INSERT OR REPLACE INTO members VALUES(?,?,?,1,1,?,?)", (company, uid, role, uid, kind))
        out[uid] = b.harness.mint_native_jwt(b.ns, uid, a.minutes)
    print(json.dumps({'ok': True, 'label': 'SYNTHETIC_DISPOSABLE_NATIVE_USER', 'executionClass': 'NATIVE_NONPRODUCTION', 'jwts': out,
                      'nativeAuthorityDb': str(b.paths.authority), 'nativeRevocationDb': str(b.ns.revocation._path())}))


def cmd_revoke_session(a):
    b = boot(a.root)
    payload = b.ns.auth.decode_token(b.token)
    r = b.ns.revocation.revoke_and_enqueue(b.token, payload)
    print(json.dumps({'ok': True, 'nativeTokenHash': r['tokenHash'], 'newlyRevoked': r['newlyRevoked']}))


def cmd_set_member(a):
    b = boot(a.root)
    with closing(sqlite3.connect(str(b.paths.authority))) as db, db:
        n = db.execute('UPDATE members SET active=?, revision=revision+1 WHERE company_id=? AND user_id=?', (int(a.active), a.company, a.user)).rowcount
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
