"""Concurrency and cookie isolation for the public guest API.

Uses a temporary SQLite directory via monkeypatched STATE_DIR. call_provider
is stubbed; no network and no production database.
"""

from __future__ import annotations

import importlib
import asyncio
import threading
import time

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

MODULE = "open_webui.routers.starli_public"
PREFIX = "/api/v1/starli/public"
SECRET = b"concurrency-test-signing-secret"


def _load(tmp_path, monkeypatch):
    mod = importlib.import_module(MODULE)
    monkeypatch.setattr(mod, "STATE_DIR", tmp_path)
    monkeypatch.setattr(mod, "SIGNING_SECRET", SECRET)
    monkeypatch.setattr(mod, "GUEST_LIMIT", 50)
    monkeypatch.setattr(mod, "IP_LIMIT", 50)
    monkeypatch.setattr(mod, "GLOBAL_LIMIT", 500)
    monkeypatch.setattr(mod, "PERIOD_SECONDS", 300)
    return mod


def _client(mod):
    app = FastAPI()
    app.include_router(mod.router, prefix=PREFIX)
    return TestClient(app)


def _session_cookie(client, mod):
    res = client.get(f"{PREFIX}/session")
    assert res.status_code == 200, res.text
    assert res.json()["guest"] is True
    assert res.json()["model"] == {"id": "starli-ai", "name": "Starli AI"}
    assert res.json()["allowance"]["remaining"] >= 0
    token = res.cookies.get(mod.COOKIE)
    assert token
    assert mod.COOKIE == "starli_guest"
    return token


def _body(request_id, content="hello"):
    return {"requestId": request_id, "messages": [{"role": "user", "content": content}]}


def _chat(client, cookie, mod, body):
    return client.post(f"{PREFIX}/chat", json=body, cookies={mod.COOKIE: cookie})


def _status(mod, guest_sid, request_id):
    with mod.db() as conn:
        row = conn.execute(
            "SELECT status FROM requests WHERE guest=? AND id=?",
            (guest_sid, request_id),
        ).fetchone()
    assert row is not None
    return row[0]


@pytest.fixture
def env(tmp_path, monkeypatch):
    mod = _load(tmp_path, monkeypatch)
    calls = {"n": 0}

    async def fake_provider(messages):
        calls["n"] += 1
        return f"reply-{calls['n']}-{messages[-1]['content']}"

    monkeypatch.setattr(mod, "call_provider", fake_provider)
    with _client(mod) as client:
        yield mod, client, calls


def test_independent_guests_do_not_share_same_request_id(env):
    mod, client, calls = env
    a = _session_cookie(client, mod)
    client.cookies.clear()
    b = _session_cookie(client, mod)
    assert a != b
    left = _chat(client, a, mod, _body("shared-id", "alpha"))
    right = _chat(client, b, mod, _body("shared-id", "beta"))
    assert left.status_code == 200, left.text
    assert right.status_code == 200, right.text
    assert left.json()["reply"] != right.json()["reply"]
    assert "alpha" in left.json()["reply"]
    assert "beta" in right.json()["reply"]
    assert calls["n"] == 2
    again = _chat(client, a, mod, _body("shared-id", "alpha"))
    assert again.status_code == 200
    assert again.json()["reply"] == left.json()["reply"]
    assert calls["n"] == 2


def test_tampered_and_expired_signed_cookie_forbidden(env):
    mod, client, calls = env
    token = _session_cookie(client, mod)
    sid, issued, sig = token.split(":")
    tampered = f"{sid}:{issued}:{'0' * len(sig)}"
    res = _chat(client, tampered, mod, _body("tamper"))
    assert res.status_code == 403
    expired_value = f"{sid}:{int(time.time()) - 90000}"
    expired = expired_value + ":" + mod.signature(expired_value)
    res = _chat(client, expired, mod, _body("expired"))
    assert res.status_code == 403
    assert calls["n"] == 0


def test_concurrent_same_guest_one_provider_then_cached(tmp_path, monkeypatch):
    mod = _load(tmp_path, monkeypatch)
    entered = threading.Event()
    release = threading.Event()
    calls = {"n": 0}

    async def blocking_provider(messages):
        calls["n"] += 1
        entered.set()
        assert await asyncio.to_thread(release.wait,5)
        return "cached-body"

    monkeypatch.setattr(mod, "call_provider", blocking_provider)
    with _client(mod) as client:
        cookie = _session_cookie(client, mod)
        body = _body("same-guest", "once")
        holder = {}

        def first():
            holder["first"] = _chat(client, cookie, mod, body)

        thread = threading.Thread(target=first)
        thread.start()
        assert entered.wait(5)
        pending = _chat(client, cookie, mod, body)
        assert pending.status_code == 409, pending.text
        assert "pending" in pending.text.lower() or "not been sent again" in pending.text.lower()
        release.set()
        thread.join(5)
        assert not thread.is_alive()
        assert holder["first"].status_code == 200, holder["first"].text
        cached = _chat(client, cookie, mod, body)
        assert cached.status_code == 200, cached.text
        assert cached.json()["reply"] == holder["first"].json()["reply"] == "cached-body"
        assert calls["n"] == 1


def test_provider_failure_marks_uncertain_and_replay_skips_provider(env):
    mod, client, calls = env

    async def failing(_messages):
        calls["n"] += 1
        raise RuntimeError("provider down")

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(mod, "call_provider", failing)
    try:
        cookie = _session_cookie(client, mod)
        sid = cookie.split(":")[0]
        res = _chat(client, cookie, mod, _body("fail-1", "boom"))
        assert res.status_code == 503, res.text
        assert _status(mod, sid, "fail-1") == "UNCERTAIN"
        replay = _chat(client, cookie, mod, _body("fail-1", "boom"))
        assert replay.status_code == 409, replay.text
        assert calls["n"] == 1
        assert _status(mod, sid, "fail-1") == "UNCERTAIN"
    finally:
        monkeypatch.undo()


def test_http_exception_from_provider_is_uncertain_not_retried(env):
    mod, client, calls = env

    async def unavailable(_messages):
        calls["n"] += 1
        raise HTTPException(503, "Starli AI is temporarily unavailable")

    patch = pytest.MonkeyPatch()
    patch.setattr(mod, "call_provider", unavailable)
    try:
        cookie = _session_cookie(client, mod)
        sid = cookie.split(":")[0]
        res = _chat(client, cookie, mod, _body("fail-http"))
        assert res.status_code == 503
        assert _status(mod, sid, "fail-http") == "UNCERTAIN"
        replay = _chat(client, cookie, mod, _body("fail-http"))
        assert replay.status_code == 409
        assert calls["n"] == 1
    finally:
        patch.undo()
