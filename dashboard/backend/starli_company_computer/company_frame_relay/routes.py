import asyncio
import hashlib
import inspect
import re
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse, Response

from .relay import Relay, RelayError

HEADERS = {"Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache",
           "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
           "Vary": "Authorization, Cookie"}


def install(app, issuer, native_session, *, publisher_authenticate=None, publisher_authorize=None,
            binding_authorize=None, allowed_origins=(), replace_compatibility=False, relay=None):
    """Mount before the SPA. Explicit enrollment callbacks are mandatory to pair.

    native_session is app.state.company_messaging_session, not a fixture fallback.
    publisher_authenticate(request, body_sha256) verifies infra's first-party
    device auth, service role/purpose/nonce/method/path/body digest.
    issuer is the SAME existing ViewerIssuer used by local signed-grant fallback.
    No keys, credentials, network clients, device enrollment or processes created.
    """
    if getattr(app.state, "company_frame_relay_installed", False):
        raise ValueError("Relay already installed")
    origins = frozenset(allowed_origins)
    if not origins or any(not o.startswith("https://") or o.endswith("/") for o in origins):
        raise ValueError("Exact first-party HTTPS origins required")
    paired = all(callable(x) for x in (publisher_authenticate, publisher_authorize, binding_authorize))
    if relay is not None and not paired:
        raise ValueError("Cannot inject a relay without enrolled device authorities")
    if paired and relay is None:
        relay = Relay(issuer, publisher_authorize, binding_authorize)
    router = APIRouter()
    upload_slots = asyncio.Semaphore(4)

    def check_origin(request):
        # Normal header-auth clients may omit Origin; browser cross-site requests
        # must never use ambient cookies, and mutations demand exact Origin.
        origin = request.headers.get("origin")
        if origin is not None and origin not in origins:
            raise RelayError()
        if request.headers.get("sec-fetch-site") == "cross-site":
            raise RelayError()
        if request.method not in ("GET", "HEAD") and origin not in origins:
            raise RelayError()

    def ready():
        if not paired:
            raise RelayError(503, "PUBLISHER_UNPAIRED")

    def headers_match(request, binding):
        for header, field in (("x-company-id", "companyId"), ("x-viewer-id", "viewerId")):
            supplied = request.headers.get(header)
            if supplied is not None and supplied != binding[field]:
                raise RelayError()

    async def invoke(fn, *args):
        try:
            value = await run_in_threadpool(fn, *args)
            return value
        except RelayError as error:
            raise HTTPException(error.status, error.code, headers=HEADERS) from None
        except Exception:
            raise HTTPException(403, "VIEW_UNAVAILABLE", headers=HEADERS) from None

    async def browser(request, session, operation, company=None, rid=None):
        def call():
            check_origin(request)
            ready()
            headers_match(request, relay._snapshot(session))
            if company is not None and company != issuer.company:
                raise RelayError()
            if operation == "open":
                return relay.open(session, issuer.company, compatibility=rid is None)
            actual = rid or relay.resolve_compat(session)
            if operation == "close":
                if not request.headers.get("x-company-id") or not request.headers.get("x-viewer-id"):
                    raise RelayError(400, "VIEWER_HEADERS_REQUIRED")
                relay.close(session, issuer.company, actual)
                return {"closed": True}
            try:
                after = int(request.query_params.get("after", "0"))
            except ValueError:
                raise RelayError(400, "INVALID_CURSOR") from None
            return relay.frame(session, issuer.company, actual, after)
        return await invoke(call)

    @router.get("/api/v1/company-computer/status")
    async def status(request: Request, session=Depends(native_session)):
        def current():
            check_origin(request)
            if paired:
                binding = relay._snapshot(session)
            else:
                if session.revalidate() is not True:
                    raise RelayError()
                binding = issuer.snapshot(session)
            headers_match(request, binding)
            live = paired and relay.publisher_live()
            return {"companyId": binding["companyId"], "computerId": binding["computerId"],
                    "company": binding["companyId"], "computer": binding["computerId"],
                    "viewerAvailable": live, "available": live, "paired": live, "configured": paired,
                    "mode": "native-latest-frame-relay", "viewOnly": True, "controlAvailable": False}
        return JSONResponse(await invoke(current), headers=HEADERS)

    @router.post("/api/v1/company-computer/viewer")
    async def open_compat(request: Request, session=Depends(native_session)):
        return JSONResponse(await browser(request, session, "open"), headers=HEADERS)

    @router.delete("/api/v1/company-computer/viewer")
    async def close_compat(request: Request, session=Depends(native_session)):
        return JSONResponse(await browser(request, session, "close"), headers=HEADERS)

    async def image(request, session, company=None, rid=None):
        jpeg, cursor = await browser(request, session, "frame", company, rid)
        headers = {**HEADERS, "X-Starli-Frame-Cursor": str(cursor), "X-Starli-Frame-Freshness-Ms": "2000"}
        return Response(jpeg, status_code=200 if jpeg else 204, media_type="image/jpeg" if jpeg else None,
                        headers=headers)

    @router.get("/api/v1/company-computer/frame")
    async def frame_compat(request: Request, session=Depends(native_session)):
        return await image(request, session)

    @router.post("/api/v1/companies/{company}/computer/relay/viewers")
    async def open_view(request: Request, company: str, session=Depends(native_session)):
        # Explicit viewer API gives each tab an independent close handle.
        def call():
            check_origin(request)
            ready()
            headers_match(request, relay._snapshot(session))
            return relay.open(session, company)
        return JSONResponse(await invoke(call), headers=HEADERS)

    @router.get("/api/v1/companies/{company}/computer/relay/viewers/{rid}/frame")
    async def frame(request: Request, company: str, rid: str, session=Depends(native_session)):
        return await image(request, session, company, rid)

    @router.delete("/api/v1/companies/{company}/computer/relay/viewers/{rid}")
    async def close(request: Request, company: str, rid: str, session=Depends(native_session)):
        return JSONResponse(await browser(request, session, "close", company, rid), headers=HEADERS)

    if paired:
        async def device(request, digest):
            token = request.headers.get("x-company-publisher-token", "")
            if not 1 <= len(token) <= 4096:
                raise HTTPException(403, "PUBLISHER_REQUIRED", headers=HEADERS)
            try:
                async with asyncio.timeout(5):
                    if inspect.iscoroutinefunction(publisher_authenticate):
                        identity = await publisher_authenticate(request, digest)
                    else:
                        identity = await run_in_threadpool(publisher_authenticate, request, digest)
                    if inspect.isawaitable(identity):
                        identity = await identity
                await invoke(relay._publisher, identity)
                return identity
            except (HTTPException, RelayError):
                raise HTTPException(403, "PUBLISHER_DENIED", headers=HEADERS) from None
            except Exception:
                raise HTTPException(403, "PUBLISHER_DENIED", headers=HEADERS) from None

        @router.get("/api/v1/company-computer/relay/publisher/work")
        async def work(request: Request):
            identity = await device(request, hashlib.sha256(b"").hexdigest())
            value = await invoke(relay.signed_work, identity, request.headers.get("x-starli-publisher-request-id", ""))
            return JSONResponse(value, headers=HEADERS)

        @router.post("/api/v1/company-computer/relay/publisher/frames/{rid}")
        @router.post("/api/v1/company-computer/relay/publisher/frames")
        async def upload(request: Request, rid: str = ""):
            header_rid = request.headers.get("x-starli-relay-id", "")
            rid = rid or header_rid
            if not re.fullmatch(r"[A-Za-z0-9_-]{32}", rid) or (header_rid and header_rid != rid):
                raise HTTPException(400, "INVALID_RELAY", headers=HEADERS)
            if not 1 <= len(request.headers.get("x-company-publisher-token", "")) <= 4096:
                raise HTTPException(403, "PUBLISHER_REQUIRED", headers=HEADERS)
            if request.headers.get("content-type", "").split(";", 1)[0].strip() != "image/jpeg":
                raise HTTPException(415, "JPEG_REQUIRED", headers=HEADERS)
            length = request.headers.get("content-length", "")
            if length and (not length.isdigit() or int(length) > 512 * 1024):
                raise HTTPException(413, "FRAME_TOO_LARGE", headers=HEADERS)
            try:
                await asyncio.wait_for(upload_slots.acquire(), 0.05)
            except TimeoutError:
                raise HTTPException(429, "UPLOAD_CAPACITY", headers=HEADERS) from None
            try:
                body = bytearray()
                try:
                    async with asyncio.timeout(5):
                        async for chunk in request.stream():
                            if len(body) + len(chunk) > 512 * 1024:
                                raise HTTPException(413, "FRAME_TOO_LARGE", headers=HEADERS)
                            body.extend(chunk)
                except TimeoutError:
                    raise HTTPException(408, "FRAME_TIMEOUT", headers=HEADERS) from None
                try:
                    sequence = int(request.headers.get("x-starli-frame-sequence", ""))
                except ValueError:
                    raise HTTPException(400, "INVALID_CURSOR", headers=HEADERS) from None
                identity = await device(request, hashlib.sha256(body).hexdigest())
                value = await invoke(relay.upload, identity, rid, request.headers.get("x-starli-grant-nonce", ""),
                                     sequence, bytes(body))
                return JSONResponse(value, headers=HEADERS)
            finally:
                upload_slots.release()

    exact = {"/api/v1/company-computer/status", "/api/v1/company-computer/viewer", "/api/v1/company-computer/frame"}
    existing = [r for r in app.router.routes if getattr(r, "path", None) in exact]
    if existing and not replace_compatibility:
        raise ValueError("Existing compatibility routes require explicit replacement")
    if replace_compatibility:
        app.router.routes[:] = [r for r in app.router.routes if r not in existing]
    # Insert real native API routes before SPA catch-all, never append behind it.
    index = next((i for i, r in enumerate(app.router.routes) if getattr(r, "path", None) == ""), len(app.router.routes))
    app.router.routes[index:index] = router.routes
    if relay:
        previous = app.router.lifespan_context
        @asynccontextmanager
        async def lifespan(application):
            async with previous(application) as state:
                async def sweep():
                    while True:
                        await asyncio.sleep(0.5)
                        await run_in_threadpool(relay.sweep)
                task = asyncio.create_task(sweep())
                try:
                    yield state
                finally:
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                    relay.revoke()
        app.router.lifespan_context = lifespan
    app.state.company_frame_relay_installed = True
    app.state.company_frame_relay = relay
    @app.middleware("http")
    async def private_frames(request, call_next):
        response = await call_next(request)
        if (request.url.path.startswith("/api/v1/company-computer/")
                or "/computer/relay/" in request.url.path):
            for key, value in HEADERS.items():
                response.headers[key] = value
        return response
    return {"installed": True, "paired": paired, "viewOnly": True, "fallbackGrantsUnchanged": True}
