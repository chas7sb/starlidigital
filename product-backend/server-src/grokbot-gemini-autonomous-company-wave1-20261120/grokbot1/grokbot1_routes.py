"""grokbot1 W1 candidate HTTP surface (FastAPI) + disposable candidate app factory.

Scoped integration patch for Boss's combined candidate: call `install(app, svc, allowed_origins=...)`
after native `company_messaging.native_mount.install(...)` and pass its returned Store into
`Grokbot1Service`. Disabled unless explicitly installed; no production mount.
"""
from __future__ import annotations

import hashlib
import hmac
from urllib.parse import urlsplit

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr, Field

from grokbot1_claim import ClaimError, Grokbot1Service, GUEST_COOKIE

GUEST_PREFIX = '/api/v1/starli/public/grokbot1'   # guest cookie path covers this
OWNER_PREFIX = '/api/v1/starli/grokbot1'


class ProvisionalIn(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    intentId: StrictStr = Field(min_length=40, max_length=40, pattern=r'^[0-9a-f]{40}$')


class ClaimIn(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    intentId: StrictStr = Field(min_length=40, max_length=40, pattern=r'^[0-9a-f]{40}$')
    expectedRevision: StrictInt


class ReauthIn(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    password: StrictStr = Field(min_length=1, max_length=1024)


def _guard(request: Request, allowed: set, csrf_header: str) -> None:
    """Same policy as mini2 W4 guard: one Origin in allowlist, one CSRF header == '1', no cross-site."""
    origins = request.headers.getlist('origin')
    csrf = request.headers.getlist(csrf_header)
    if len(origins) != 1 or len(csrf) != 1 or len(request.headers.getlist('sec-fetch-site')) > 1:
        raise ClaimError(403, 'ORIGIN_CSRF_AMBIGUOUS')
    if origins[0] not in allowed:
        raise ClaimError(403, 'ORIGIN_DENIED')
    parsed = urlsplit(origins[0])
    if parsed.scheme != 'https' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ClaimError(403, 'INSECURE_ORIGIN')
    if csrf[0] != '1':
        raise ClaimError(403, 'CSRF_HEADER_REQUIRED')
    site = request.headers.get('sec-fetch-site')
    if site and site not in ('same-origin', 'same-site', 'none'):
        raise ClaimError(403, 'CROSS_SITE_DENIED')
    if request.method == 'POST' and request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        raise ClaimError(415, 'JSON_REQUIRED')


def _token(request: Request):
    header = request.headers.get('authorization', '')
    return header[7:] if header.startswith('Bearer ') else request.cookies.get('token')


def install(app: FastAPI, svc: Grokbot1Service, *, allowed_origins: set) -> None:
    ns = svc.ns
    allowed = {urlsplit(o).scheme + '://' + urlsplit(o).netloc for o in allowed_origins}
    guest = APIRouter(prefix=GUEST_PREFIX, tags=['grokbot1-guest'])
    # GUEST_INTENT_V1: mini2 W4 issuer router, byte-exact, native cookie functions, shared intake DB.
    guest.include_router(ns.mini2.create_guest_intent_router(
        verify_cookie=ns.public.verify_cookie, new_cookie=ns.public.new_cookie, signing_key=svc.key,
        db_path=svc.p.intake, allowed_origins=set(allowed), now=svc.now))

    @guest.post('/provisional', status_code=201)
    def provisional(body: ProvisionalIn, request: Request):
        _guard(request, allowed, 'x-starli-guest-intent')
        return svc.bootstrap_provisional(request.cookies.get(GUEST_COOKIE, ''), body.intentId)

    @guest.get('/progress/{intent_id}')
    def progress(intent_id: str, request: Request):
        return svc.guest_progress(request.cookies.get(GUEST_COOKIE, ''), intent_id)

    @guest.post('/claims')
    def claim(body: ClaimIn, request: Request):
        # Needs BOTH the native registered JWT and the guest cookie that owns the intent.
        _guard(request, allowed, 'x-starli-claim')
        return svc.claim(_token(request), request.cookies.get(GUEST_COOKIE, ''), body.intentId,
                         request.headers.get('idempotency-key'), body.expectedRevision)

    owner = APIRouter(prefix=OWNER_PREFIX, tags=['grokbot1-owner'])

    @owner.get('/claims/{intent_id}/navigation')
    def navigation(intent_id: str, request: Request):
        return svc.owner_navigation(_token(request), intent_id)

    @owner.post('/reauth')
    def reauth(body: ReauthIn, request: Request):
        # RECENT_AUTH_V1: native JWT + native password check; evidence bound to this exact JWT.
        _guard(request, allowed, 'x-starli-claim')
        return JSONResponse(svc.reauthenticate(_token(request), body.password), headers={'Cache-Control': 'no-store'})

    @owner.post('/claims/{intent_id}/resume')
    def resume(intent_id: str, request: Request):
        # Owner-only: resumes a COMMIT-decided saga under the owner's genuine native JWT session.
        _guard(request, allowed, 'x-starli-claim')
        return svc.resume(_token(request), intent_id)

    async def claim_error(request: Request, exc: ClaimError):
        return JSONResponse({'error': {'code': exc.code, **exc.detail}}, status_code=exc.status,
                            headers={'Cache-Control': 'no-store'})
    app.add_exception_handler(ClaimError, claim_error)
    app.include_router(guest)
    app.include_router(owner)


def build_candidate_app(root: str, *, allowed_origins=frozenset({'http://localhost:8080'})):
    """Disposable NATIVE_NONPRODUCTION candidate: actual native v33 guest session route, actual native
    company messaging mount (separate webui.db / company-authority DBs) + grokbot1 routes."""
    import native_harness as h
    paths = h.prepare_env(root)
    ns = h.load_native(paths)
    h.ensure_native_databases(ns)
    app = FastAPI(title='grokbot1-w1-candidate')
    app.include_router(ns.public.router, prefix='/api/v1/starli/public')
    store = ns.native_mount.install(app, str(paths.main), authority_database=str(paths.authority),
                                    registry_database=str(paths.authority))
    key = (paths.root / '.ephemeral-test-key').read_bytes()
    svc = Grokbot1Service(ns, store,
                          signing_key=hmac.new(key, b'grokbot1-intent-binding', hashlib.sha256).digest(),
                          nav_key=hmac.new(key, b'grokbot1-navigation', hashlib.sha256).digest())
    install(app, svc, allowed_origins=set(allowed_origins))
    app.state.grokbot1 = svc
    return app, svc, ns


def install_from_environment(app: FastAPI, store):
    """Scoped integration hook (PROPOSAL for Boss's combined candidate; NOT installed in production).

    Fail-closed: returns None unless STARLI_GROKBOT1_CLAIM_ENABLED == '1'. Requires an explicit origin
    allow-list and a separate intake DB path. Keys are derived at runtime from the process's own
    WEBUI_SECRET_KEY (never logged, never written). `store` is the value returned by native
    company_messaging.native_mount.install_from_environment(app).
    """
    import os
    from pathlib import Path
    from types import SimpleNamespace
    if os.getenv('STARLI_GROKBOT1_CLAIM_ENABLED') != '1' or store is None:
        return None
    origins = {o.strip() for o in os.getenv('STARLI_GROKBOT1_ALLOWED_ORIGINS', '').split(',') if o.strip()}
    intake = os.getenv('STARLI_GROKBOT1_INTAKE_DATABASE', '')
    secret = os.getenv('WEBUI_SECRET_KEY', '')
    if not origins or not intake or len(secret) < 32:
        raise RuntimeError('GROKBOT1_CONFIG_INCOMPLETE')
    from open_webui.env import DATABASE_URL
    from open_webui.config import DATA_DIR
    from open_webui.utils import auth as native_auth, native_authorization
    from open_webui.routers import starli_session_revocation, starli_public
    from open_webui.models.users import Users
    from open_webui.models.auths import Auths
    from open_webui.company_authority.company_rbac import Authority as RbacAuthority
    from company_messaging import native_mount
    from company_messaging.authority import Denied as NativeDenied
    from open_webui.company_drive.resources import Resources, Denied as DriveDenied
    from starli_memory.registry import BotRegistry
    import guest_intents, provisional
    company = os.getenv('STARLI_COMPANY_DATABASE') or str(Path(DATA_DIR) / 'company-authority.sqlite3')
    paths = SimpleNamespace(main=Path(DATABASE_URL[len('sqlite:///'):]), authority=Path(company),
                            drive=Path(os.getenv('STARLI_COMPANY_DRIVE_DATABASE') or Path(DATA_DIR) / 'company-drive.sqlite3'),
                            intake=Path(intake), root=Path(DATA_DIR))
    ns = SimpleNamespace(auth=native_auth, revocation=starli_session_revocation, authz=native_authorization,
                         public=starli_public, Users=Users, Auths=Auths, RbacAuthority=RbacAuthority, native_mount=native_mount,
                         NativeDenied=NativeDenied, Resources=Resources, DriveDenied=DriveDenied,
                         BotRegistry=BotRegistry, mini2=guest_intents, mini3=provisional, pins={}, paths=paths)
    key = secret.encode()
    svc = Grokbot1Service(ns, store,
                          signing_key=hmac.new(key, b'grokbot1-intent-binding', hashlib.sha256).digest(),
                          nav_key=hmac.new(key, b'grokbot1-navigation', hashlib.sha256).digest())
    install(app, svc, allowed_origins=origins)
    app.state.grokbot1 = svc
    return svc
