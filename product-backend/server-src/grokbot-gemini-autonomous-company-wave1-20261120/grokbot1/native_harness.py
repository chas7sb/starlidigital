"""grokbot1 W1 native harness: load ACTUAL native WebUI v33 modules READ-ONLY against a
DISPOSABLE data root (never production data, never production secrets).

Execution class of anything built on this: NATIVE_NONPRODUCTION.
- Native source is imported from the pinned, immutable v33 release directory and every
  imported file is SHA256-verified first (fail closed on drift).
- DATA_DIR / STARLI_STATE_DIR / DATABASE_URL / STARLI_SOURCE_DATABASE all point inside the
  disposable root (must live under /tmp/grokbot1-w1-*).
- WEBUI_SECRET_KEY is an ephemeral random test key generated per disposable root and stored
  0600 inside that root so independent test processes share it; deleted with the root.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

NATIVE_RELEASE = '/srv/starlidigital/webui-releases/native-company-mcp-always-v33-20261119'
NATIVE_BACKEND = NATIVE_RELEASE + '/backend'
# Exact native files whose behaviour this candidate depends on (computed 2026-11-20 from v33).
NATIVE_PINS = {
    'open_webui/utils/auth.py': 'abf358d42f52867915fdc85b3ffebe6ad8bae0149dce0357549921d46d0ebc6d',
    'open_webui/routers/starli_session_revocation.py': '294504028cd6b5e986047c01a77587e28da403a5d948be015ae4767f6d64fcbf',
    'open_webui/utils/native_authorization.py': '8a4936495233c5ddea4cee4f5563b15237624259a8af20b9464b0202ce74f5fc',
    'open_webui/routers/starli_public.py': 'c04d7285d2821191e8d7e16748bd5f27bfbe5dd4dc1d58d7940107f2da408940',
    'open_webui/company_authority/company_authority_base.py': '7189624e5718c8ed3dd11a8038153e0b25183ed7daebe5240552cf9a755a559d',
    'open_webui/company_authority/company_rbac.py': '73ed78401572531ac136bf488515004deefc181023870dc303a1e0ecb9d52f22',
    'company_messaging/native_mount.py': '215a09a0d4c3504f9ebb2fa5869f3a8a8aec09e17ddf7a3090900b79f7b48cd1',
    'company_messaging/store.py': '668dadfa8d15cb377dbc458e2184013f8c96df500b2149519b51588477bdd878',
    'company_messaging/authority.py': '7da7bd8d50de99aff6533f8aa69673b14f2ec7c83921219936a5438e31973a33',
    'company_messaging/native_authority.py': '5788ea677439d3f90b63d5cc3ba4e55fc0ef6f7ad19733a0ff3f17d6fe437b76',
    'company_messaging/http.py': '25c54ef95adbdf10974baad6322610981686e1732d02c0bd3d30551aa7ea1796',
    'open_webui/company_drive/resources.py': 'ede54f6147120f1389741b3c8c6019ea42b5bf2f8a19a1b8a87aa053fcb96399',
    'starli_memory/registry.py': 'f7896ea0566280c89e861df39cdcea4976b18bfdf59ee20da05398ff580cd1c5',
    'open_webui/models/users.py': '7ad105dc80a0cfb9088a7f0ca685897f04ed0fcc8f9879ebc5550ca65380ddb9',
    'open_webui/models/auths.py': '0279abd52e6ad07314c913700e8756479e5b13dd9f6f2b53e260ef05dfa11303',
}
STAGE = Path(__file__).resolve().parent
VENDOR_PINS = {
    # byte-exact copies, verified against producer SHA256SUMS.txt at copy time
    'vendor/guest_intents.py': '630cd708486ecbb3a58d66a17fc1a792646b36b50b0fecc78127697c15e211b1',  # mini-chatgpt2 W4
    'vendor/provisional.py': 'e87117b33cfe39577be1510c78ce887408c4d68d585a6749bddb1e18ebbfcd0e',     # mini-chatgpt3 W4
}
DISPOSABLE_PREFIX = '/tmp/grokbot1-w1-'


class SourceDrift(RuntimeError):
    pass


def sha256_file(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_pins() -> dict:
    result = {}
    for rel, want in NATIVE_PINS.items():
        got = sha256_file(Path(NATIVE_BACKEND) / rel)
        if got != want:
            raise SourceDrift(f'NATIVE_SOURCE_DRIFT {rel} {got}')
        result['native:' + rel] = got
    for rel, want in VENDOR_PINS.items():
        got = sha256_file(STAGE / rel)
        if got != want:
            raise SourceDrift(f'VENDOR_SOURCE_DRIFT {rel} {got}')
        result[rel] = got
    return result


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def data(self): return self.root / 'data'
    @property
    def state(self): return self.root / 'state'
    @property
    def main(self): return self.data / 'webui.db'                      # native messaging + channel/message
    @property
    def authority(self): return self.data / 'company-authority.sqlite3'  # native companies/members/audit + bots registry
    @property
    def drive(self): return self.data / 'company-drive.sqlite3'        # native Drive resources (project)
    @property
    def intake(self): return self.root / 'intake' / 'grokbot1-intake.sqlite3'  # mini2 issuer + mini3 provisional + journal


def prepare_env(root: str | Path) -> Paths:
    root = Path(root).resolve()
    if not str(root).startswith(DISPOSABLE_PREFIX):
        raise PermissionError('disposable root must be under ' + DISPOSABLE_PREFIX)
    paths = Paths(root)
    for d in (paths.data, paths.state, paths.intake.parent):
        d.mkdir(parents=True, exist_ok=True, mode=0o700)
    keyfile = root / '.ephemeral-test-key'
    if not keyfile.exists():
        fd = os.open(str(keyfile), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_urlsafe(48))
    key = keyfile.read_text().strip()
    # Remove anything that could point native code at real data before import.
    for name in list(os.environ):
        if name.startswith(('STARLI_', 'DATABASE_', 'WEBUI_', 'DATA_DIR', 'REDIS', 'OPENAI', 'OPENROUTER')):
            os.environ.pop(name, None)
    os.environ.update({
        'DATA_DIR': str(paths.data),
        'STARLI_STATE_DIR': str(paths.state),
        'STARLI_SOURCE_DATABASE': str(root / 'source-unused.sqlite'),
        'DATABASE_URL': 'sqlite:///' + str(paths.main),
        'WEBUI_SECRET_KEY': key,
        'OFFLINE_MODE': 'true',
        'PYTHONDONTWRITEBYTECODE': '1',
        'ENABLE_SIGNUP': 'false',
        'STATIC_DIR': str(root / 'static'),
    })
    sys.dont_write_bytecode = True
    return paths


_NS = None


def load_native(paths: Paths) -> SimpleNamespace:
    """Import the actual native modules (after prepare_env). Cached per process."""
    global _NS
    if _NS is not None:
        return _NS
    pins = verify_pins()
    if NATIVE_BACKEND not in sys.path:
        sys.path.insert(0, NATIVE_BACKEND)
    if str(STAGE / 'vendor') not in sys.path:
        sys.path.insert(0, str(STAGE / 'vendor'))
    import logging
    logging.disable(logging.WARNING)
    from open_webui.utils import auth as native_auth
    from open_webui.routers import starli_session_revocation as native_revocation
    from open_webui.utils import native_authorization
    from open_webui.routers import starli_public
    from open_webui.models.users import Users
    from open_webui.models.auths import Auths
    from open_webui.company_authority.company_rbac import Authority as RbacAuthority
    from company_messaging import native_mount
    from company_messaging.authority import Denied as NativeDenied
    from open_webui.company_drive.resources import Resources, Denied as DriveDenied
    from starli_memory.registry import BotRegistry
    import guest_intents as mini2_guest_intents
    import provisional as mini3_provisional
    # The import side effects must have stayed inside the disposable root.
    if not str(starli_public.STATE_DIR).startswith(str(paths.root)):
        raise PermissionError('native guest STATE_DIR escaped disposable root')
    if not str(native_revocation._path()).startswith(str(paths.root)):
        raise PermissionError('native revocation store escaped disposable root')
    _NS = SimpleNamespace(
        auth=native_auth, revocation=native_revocation, authz=native_authorization,
        public=starli_public, Users=Users, Auths=Auths, RbacAuthority=RbacAuthority,
        native_mount=native_mount, NativeDenied=NativeDenied, Resources=Resources,
        DriveDenied=DriveDenied, BotRegistry=BotRegistry, mini2=mini2_guest_intents,
        mini3=mini3_provisional, pins=pins, paths=paths,
    )
    return _NS


def ensure_native_databases(ns) -> None:
    """Create disposable native schemas using native constructors only."""
    p = ns.paths
    a = ns.RbacAuthority(str(p.authority)); a.db.close()
    reg = ns.BotRegistry(str(p.authority), lambda *a, **k: True); reg.db.close()
    # webui.db is migrated by the native import (channel/message tables).
    import sqlite3
    with sqlite3.connect(str(p.main)) as db:
        names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {'channel', 'message', 'user'} <= names:
        raise RuntimeError('native webui.db schema missing: ' + ','.join(sorted({'channel', 'message', 'user'} - names)))


def create_disposable_native_user(ns, user_id: str, name: str) -> None:
    """Synthetic disposable test account in the DISPOSABLE webui.db via native Users API.
    Not a real registered human; evidence labels it SYNTHETIC_DISPOSABLE_NATIVE_USER."""
    if ns.Users.get_user_by_id(user_id) is None:
        ns.Users.insert_new_user(user_id, name, f'{user_id}@grokbot1.invalid', role='user')
        # native Auth row (same id) so native Auths.authenticate_user can verify a re-auth password
        from open_webui.internal.db import get_db
        from open_webui.models.auths import Auth
        with get_db() as db:
            db.add(Auth(id=user_id, email=f'{user_id}@grokbot1.invalid',
                        password=ns.auth.get_password_hash(test_password(user_id)), active=True))
            db.commit()


def test_password(user_id: str) -> str:
    """Synthetic disposable password for SYNTHETIC_DISPOSABLE_NATIVE_USER rows only (temp DB)."""
    return 'gb1-disposable-' + hashlib.sha256(('grokbot1-test-pw:' + user_id).encode()).hexdigest()[:20]


def mint_native_jwt(ns, user_id: str, minutes: int = 30) -> str:
    import datetime
    return ns.auth.create_token({'id': user_id}, datetime.timedelta(minutes=minutes))
