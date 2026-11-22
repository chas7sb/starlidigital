"""Public read-only research browser. Coordinator mounts router at /api/v1/starli/browser."""
from __future__ import annotations
import starli_portable as _portable
from open_webui.utils.safe_http import safe_address

import asyncio, base64, ipaddress, os, socket, time
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import aiohttp
from aiohttp.resolver import AbstractResolver
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StrictStr
from open_webui.utils.auth import get_verified_user

router = APIRouter()
TTL, MAX_SESSIONS, MAX_BYTES = 600, 4, 5 * 1024 * 1024
_DROP = {"cookie", "authorization", "proxy-authorization", "set-cookie"}
_lock, _sessions, _http, _pw, _browser = asyncio.Lock(), {}, None, None, None


class _Body(BaseModel):
    class Config:
        extra = "forbid"


class NavigateBody(_Body):
    url: StrictStr = Field(..., min_length=1, max_length=2048)


class ScrollBody(_Body):
    direction: StrictStr


class ClickBody(_Body):
    x: int = Field(..., ge=0, le=5000)
    y: int = Field(..., ge=0, le=5000)


class TypeBody(_Body):
    text: StrictStr = Field(..., min_length=1, max_length=2000)


class KeyBody(_Body):
    key: StrictStr = Field(..., min_length=1, max_length=30)


def _principal(user: Any) -> Dict[str, Any]:
    from open_webui.routers import starli_platform
    uid, binding = starli_platform.customer_principal(user)
    principal = {"id": uid}
    if not isinstance(principal, dict) or not isinstance(principal.get("id"), str) or not principal["id"]:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return principal


async def _auth(user: Any = Depends(get_verified_user)) -> Dict[str, Any]:
    _principal(user)
    return user


def _http_error(status: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail=detail)


def validate_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        host, port = parts.hostname, parts.port
    except Exception:
        raise _http_error(400, "Blocked URL")
    ok_port = (None, 80) if parts.scheme == "http" else (None, 443) if parts.scheme == "https" else None
    if not ok_port or parts.username or parts.password or not host or port not in ok_port:
        raise _http_error(400, "Blocked URL")
    try:
        if not safe_address(ipaddress.ip_address(host)):
            raise _http_error(400, "Blocked URL")
    except ValueError:
        pass
    return url


class PublicResolver(AbstractResolver):
    async def resolve(self, host: str, port: int = 0, family: int = socket.AF_INET):
        try:
            infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            raise aiohttp.ClientError("blocked") from exc
        rows = []
        for fam, _, proto, _, sockaddr in infos:
            ip = ipaddress.ip_address(sockaddr[0])
            if not safe_address(ip):
                raise aiohttp.ClientError("blocked")
            rows.append({"hostname": host, "host": str(ip), "port": sockaddr[1] or port,
                         "family": fam, "proto": proto, "flags": socket.AI_NUMERICHOST})
        if not rows:
            raise aiohttp.ClientError("blocked")
        return rows

    async def close(self) -> None:
        return None


async def _client() -> aiohttp.ClientSession:
    global _http
    if _http is None or _http.closed:
        _http = aiohttp.ClientSession(connector=aiohttp.TCPConnector(resolver=PublicResolver()),
                                      cookie_jar=aiohttp.DummyCookieJar(), trust_env=False, timeout=aiohttp.ClientTimeout(total=15))
    return _http


def _clean_headers(headers: Any, response: bool = False) -> Dict[str, str]:
    skip = _DROP | ({"content-encoding", "transfer-encoding"} if response else set())
    return {k: v for k, v in headers.items() if k.lower() not in skip}


async def _fulfill(route: Any, session: aiohttp.ClientSession) -> None:
    request = route.request
    if request.method not in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE") or request.resource_type == "websocket":
        await route.abort()
        return
    try:
        validate_url(request.url)
        body = request.post_data_buffer if request.method not in ("GET", "HEAD") else None
        if body is not None and len(body) > 1024 * 1024:
            await route.abort()
            return
        outbound = _clean_headers(request.headers)
        cookies = await request.frame.page.context.cookies(request.url)
        if cookies:
            outbound["Cookie"] = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
        async with session.request(request.method, request.url, data=body, headers=outbound,
                                   allow_redirects=False, max_redirects=0) as resp:
            chunks = []
            size = 0
            async for chunk in resp.content.iter_chunked(65536):
                size += len(chunk)
                if size > MAX_BYTES: raise ValueError("Response too large")
                chunks.append(chunk)
            body = b"".join(chunks)
            if len(body) > MAX_BYTES or "attachment" in resp.headers.get("content-disposition", "").lower():
                await route.abort()
                return
            # Mirror upstream cookies into the real Chromium context. Do not expose
            # authentication cookies in API responses or browser screenshots metadata.
            from http.cookies import SimpleCookie
            from urllib.parse import urlsplit
            for raw_cookie in resp.headers.getall("Set-Cookie", []):
                try:
                    parsed = SimpleCookie(); parsed.load(raw_cookie)
                    host = urlsplit(str(resp.url)).hostname
                    for morsel in parsed.values():
                        cookie = {"name": morsel.key, "value": morsel.value, "domain": morsel["domain"] or host, "path": morsel["path"] or "/", "secure": bool(morsel["secure"]), "httpOnly": bool(morsel["httponly"])}
                        await request.frame.page.context.add_cookies([cookie])
                except Exception:
                    continue
            headers = _clean_headers(resp.headers, True)
            headers["content-length"] = str(len(body))
            await route.fulfill(status=resp.status, headers=headers, body=body)
    except Exception:
        await route.abort()


async def _close(user_id: str) -> None:
    sess = _sessions.pop(user_id, None)
    if sess:
        try:
            await sess["context"].close()
            if sess.get("http"):
                await sess["http"].close()
        except Exception:
            pass


async def _browser_app():
    global _pw, _browser
    exe = os.environ.get("STARLI_BROWSER_EXECUTABLE_PATH", _portable.browser_binary())
    if not os.path.isfile(exe) or not os.access(exe, os.X_OK):
        raise _http_error(503, "Browser unavailable")
    if _browser:
        return _browser
    from playwright.async_api import async_playwright
    _pw = await async_playwright().start()
    try:
        _browser = await _pw.chromium.launch(executable_path=exe, headless=True)
    except Exception:
        await _pw.stop()
        _pw = _browser = None
        raise _http_error(503, "Browser unavailable")
    return _browser


async def _touch(user_id: str, create: bool):
    async with _lock:
        now = time.monotonic()
        for key, sess in list(_sessions.items()):
            if now - sess["seen"] > TTL:
                await _close(key)
        sess = _sessions.get(user_id)
        if sess:
            if sess.get("owner") != user_id:
                raise _http_error(403, "Forbidden")
            sess["seen"] = now
            return sess
        if not create:
            return None
        if len(_sessions) >= MAX_SESSIONS:
            raise _http_error(503, "Browser busy")
        browser = await _browser_app()
        try:
            context = await browser.new_context(accept_downloads=False, service_workers="block", ignore_https_errors=False)
            page = await context.new_page()
            http_session = aiohttp.ClientSession(connector=aiohttp.TCPConnector(resolver=PublicResolver()), cookie_jar=aiohttp.CookieJar(), trust_env=False, timeout=aiohttp.ClientTimeout(total=20))
            await context.route("**/*", lambda route: _fulfill(route, http_session))
            async def block_websocket(route):
                await route.close()
            await context.route_web_socket("**/*", block_websocket)
            page.on("download", lambda download: download.cancel())
        except HTTPException:
            raise
        except Exception:
            raise _http_error(503, "Browser unavailable")
        _sessions[user_id] = {"context": context, "page": page, "seen": now, "owner": user_id, "operation_lock": asyncio.Lock(), "http": http_session}
        return _sessions[user_id]


async def _frame_unlocked(user_id: str) -> Dict[str, Any]:
    sess = await _touch(user_id, False)
    if not sess:
        return {"available": False, "url": "", "title": "", "image": "", "text": ""}
    try:
        page = sess["page"]
        shot = await page.screenshot(type="jpeg", quality=40)
        return {"available": True, "url": page.url, "title": await page.title(),
                "image": "data:image/jpeg;base64," + base64.b64encode(shot).decode(),
                "text": (await page.inner_text("body"))[:8000]}
    except Exception:
        await _close(user_id)
        raise _http_error(502, "Browser error")


async def _navigate(user_id: str, url: str) -> Dict[str, Any]:
    validate_url(url)
    sess = await _touch(user_id, True)
    try:
        await sess["page"].goto(url, wait_until="domcontentloaded", timeout=20000)
    except Exception:
        async with _lock:
            await _close(user_id)
        raise _http_error(502, "Navigation failed")
    return await _frame_unlocked(user_id)


async def _scroll(user_id: str, direction: str) -> Dict[str, Any]:
    if direction not in ("up", "down"):
        raise _http_error(400, "Unsupported direction")
    sess = await _touch(user_id, False)
    if not sess:
        raise _http_error(404, "No session")
    try:
        await sess["page"].mouse.wheel(0, -500 if direction == "up" else 500)
    except Exception:
        async with _lock:
            await _close(user_id)
        raise _http_error(502, "Browser error")
    return await _frame_unlocked(user_id)


async def _browser_action_unlocked(user: Any, operation: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    principal = _principal(user)
    payload = payload or {}
    forged = payload.get("userId") or payload.get("user_id")
    if forged and forged != principal["id"]:
        raise _http_error(403, "Forbidden")
    uid = principal["id"]
    if operation == "frame":
        return await _frame_unlocked(uid)
    if operation == "navigate":
        return await _navigate(uid, payload.get("url", ""))
    if operation in ("click", "type", "key"):
        from open_webui.routers.starli_access import full_access
        if str(getattr(user, "role", "")).lower() != "admin" or not full_access(user):
            raise _http_error(403, "Admin Full Access required")
        sess = await _touch(uid, False)
        if not sess:
            raise _http_error(404, "No browser session")
        page = sess["page"]
        if operation == "click":
            await page.mouse.click(int(payload["x"]), int(payload["y"]))
        elif operation == "type":
            await page.keyboard.insert_text(payload["text"])
        else:
            if payload["key"] not in ("Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown"):
                raise _http_error(400, "Unsupported key")
            await page.keyboard.press(payload["key"])
        return await _frame_unlocked(uid)
    if operation == "scroll":
        return await _scroll(uid, payload.get("direction", ""))
    if operation == "close":
        async with _lock:
            await _close(uid)
        return {"closed": True}
    raise _http_error(400, "Unsupported operation")


_action_locks = {}
async def browser_action(user, operation, payload=None):
    uid = _principal(user)["id"]
    lock = _action_locks.setdefault(uid, asyncio.Lock())
    async with lock:
        return await _browser_action_unlocked(user, operation, payload)


@router.get("/frame")
async def frame(user: Dict[str, Any] = Depends(_auth)):
    return await browser_action(user,"frame",{})


@router.post("/navigate")
async def navigate(body: NavigateBody, user: Dict[str, Any] = Depends(_auth)):
    return await browser_action(user,"navigate",{"url":body.url})


@router.post("/click")
async def click(body: ClickBody, user: Dict[str, Any] = Depends(_auth)):
    return await browser_action(user, "click", body.model_dump())


@router.post("/type")
async def type_text(body: TypeBody, user: Dict[str, Any] = Depends(_auth)):
    return await browser_action(user, "type", body.model_dump())


@router.post("/key")
async def key(body: KeyBody, user: Dict[str, Any] = Depends(_auth)):
    return await browser_action(user, "key", body.model_dump())


@router.post("/scroll")
async def scroll(body: ScrollBody, user: Dict[str, Any] = Depends(_auth)):
    return await browser_action(user,"scroll",{"direction":body.direction})


@router.delete("/session")
async def close_session(user: Dict[str, Any] = Depends(_auth)):
    async with _lock:
        await _close(_principal(user)["id"])
    return {"closed": True}


@router.get("/status")
async def status(user=Depends(_auth)):
    sess=await _touch(_principal(user)["id"], False)
    return {"available": sess is not None, "url": sess["page"].url if sess else ""}
