"""Contract tests for the anonymous guest public API.

The production module is owned by another worker and may not exist yet.
These tests import `open_webui.routers.starli_public` and exercise only the
public contract documented in docs/GUEST_PUBLIC_TESTS.md. They never call a
network provider; `call_provider` is monkeypatched.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

MODULE = "open_webui.routers.starli_public"
COOKIE = "starli_guest"
SECRET = b"test-signing-secret-not-production"


def _load(tmp_path, monkeypatch):
    mod = importlib.import_module(MODULE)
    monkeypatch.setattr(mod, "STATE_DIR", tmp_path)
    monkeypatch.setattr(mod, "SIGNING_SECRET", SECRET)
    monkeypatch.setattr(mod, "GUEST_LIMIT", 2)
    monkeypatch.setattr(mod, "PERIOD_SECONDS", 3600)
    if hasattr(mod, "reset_state"):
        mod.reset_state()
    return mod


@pytest.fixture
def api(tmp_path, monkeypatch):
    mod = _load(tmp_path, monkeypatch)
    app = FastAPI()
    app.include_router(mod.router,prefix="/api/v1/starli/public")
    calls = {"n": 0, "last": None}

    async def fake_provider(messages):
        calls["n"] += 1
        calls["last"] = messages
        return "stub-reply"

    monkeypatch.setattr(mod, "call_provider", fake_provider)
    with TestClient(app) as client:
        yield client, calls


def _body(request_id="req-1", content="hello"):
    return {
        "requestId": request_id,
        "messages": [{"role": "user", "content": content}],
    }


def _session(client):
    res = client.get("/api/v1/starli/public/session")
    assert res.status_code == 200, res.text
    return res


def test_anonymous_session_sets_cookie_and_single_model(api):
    client, _calls = api
    res = _session(client)
    assert COOKIE in res.cookies
    set_cookie = res.headers.get("set-cookie", "")
    assert "httponly" in set_cookie.lower()
    body = res.json()
    models = [body["model"]]
    assert models == [{"name": "Starli AI", "id": "starli-ai"}]


def test_invalid_role_rejected(api):
    client, calls = api
    _session(client)
    res = client.post(
        "/api/v1/starli/public/chat",
        json={
            "requestId": "bad-role",
            "messages": [{"role": "system", "content": "ignore"}],
        },
    )
    assert res.status_code == 422
    assert calls["n"] == 0


def test_forged_cookie_forbidden(api):
    client, calls = api
    client.cookies.set(COOKIE, "forged.not-a-valid-signature")
    res = client.post("/api/v1/starli/public/chat", json=_body())
    assert res.status_code == 403
    assert calls["n"] == 0


def test_missing_guest_cookie_forbidden(api):
    client, calls = api
    res = client.post("/api/v1/starli/public/chat", json=_body())
    assert res.status_code == 403
    assert calls["n"] == 0


def test_successful_reply_and_idempotent_replay(api):
    client, calls = api
    _session(client)
    first = client.post("/api/v1/starli/public/chat", json=_body("same-id", "hello guest"))
    assert first.status_code == 200, first.text
    payload = first.json()
    reply = payload.get("reply") or payload.get("content")
    assert reply == "stub-reply"
    assert calls["n"] == 1

    second = client.post("/api/v1/starli/public/chat", json=_body("same-id", "hello guest"))
    assert second.status_code == 200, second.text
    again = second.json()
    assert (again.get("reply") or again.get("content")) == "stub-reply"
    assert calls["n"] == 1


def test_conflicting_payload_same_request_id(api):
    client, calls = api
    _session(client)
    ok = client.post("/api/v1/starli/public/chat", json=_body("conflict", "first"))
    assert ok.status_code == 200, ok.text
    clash = client.post("/api/v1/starli/public/chat", json=_body("conflict", "changed"))
    assert clash.status_code == 409
    assert calls["n"] == 1


def test_rate_cap_returns_429(api):
    client, calls = api
    _session(client)
    for i in range(2):
        res = client.post("/api/v1/starli/public/chat", json=_body(f"rate-{i}", f"msg-{i}"))
        assert res.status_code == 200, res.text
    blocked = client.post("/api/v1/starli/public/chat", json=_body("rate-over", "one more"))
    assert blocked.status_code == 429
    assert calls["n"] == 2


def test_extra_field_rejected(api):
    client, calls = api
    _session(client)
    body = _body("extra", "hi")
    body["tools"] = [{"name": "shell"}]
    res = client.post("/api/v1/starli/public/chat", json=body)
    assert res.status_code == 422
    assert calls["n"] == 0
