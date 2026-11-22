"""Temp-DB tests for the read-only resource index. No production data."""
import json
import sqlite3

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from open_webui.routers import starli_platform as platform
from open_webui.routers import starli_resources as resources
from open_webui.utils.auth import get_verified_user

ADMIN = {"id": "webui-admin", "role": "admin"}


@pytest.fixture()
def temp_source(tmp_path, monkeypatch):
    db_path = tmp_path / "starli.sqlite"
    bindings = tmp_path / "bindings.json"
    bindings.write_text(json.dumps({"memberships": {"webui-admin": {"v2UserId": "v2-admin"}}}))
    con = sqlite3.connect(db_path)
    con.execute("CREATE TABLE users (id TEXT PRIMARY KEY, payload TEXT)")
    con.execute("CREATE TABLE records (id TEXT, collection TEXT, payload TEXT)")
    con.execute(
        "INSERT INTO users VALUES (?,?)",
        ("v2-admin", json.dumps({"id": "v2-admin", "role": "ADMIN", "disabled": False})),
    )
    con.commit()
    con.close()
    monkeypatch.setattr(platform, "DATABASE", str(db_path))
    monkeypatch.setattr(platform, "BINDINGS", str(bindings))
    return db_path


def _insert(db_path, collection, row):
    con = sqlite3.connect(db_path)
    con.execute(
        "INSERT INTO records VALUES (?,?,?)",
        (row.get("id"), collection, json.dumps(row)),
    )
    con.commit()
    con.close()


def _client(user):
    app = FastAPI()
    app.include_router(resources.router, prefix="/api/v1/starli/resources")
    app.dependency_overrides[get_verified_user] = lambda: user
    return TestClient(app)


def test_auth_required(temp_source):
    app = FastAPI()
    app.include_router(resources.router, prefix="/api/v1/starli/resources")
    denied = TestClient(app).get("/api/v1/starli/resources/projects")
    assert denied.status_code in (401, 403)
    with pytest.raises(HTTPException) as exc:
        resources.list_resources("projects", q="", limit=30, offset=0, user={})
    assert exc.value.status_code == 401
    member = _client({"id": "webui-admin", "role": "user"}).get("/api/v1/starli/resources/projects")
    assert member.status_code == 403


def test_unknown_collection(temp_source):
    res = _client(ADMIN).get("/api/v1/starli/resources/records%20WHERE%201=1")
    assert res.status_code == 404
    assert res.json()["detail"] == "Unknown collection"


def test_secret_fields_excluded(temp_source):
    _insert(
        temp_source,
        "projects",
        {
            "id": "p1",
            "name": "Safe site",
            "status": "LIVE",
            "brief": "public brief",
            "updatedAt": "2026-01-02",
            "publicUrl": "https://example.com/live",
            "website": "http://user:secretpass@example.com/hidden",
            "password": "s3cret-password",
            "token": "tok-should-not-leak",
            "body": "raw-body-payload",
            "content": "full-content-blob",
            "credentials": {"apiKey": "cred-key"},
        },
    )
    body = _client(ADMIN).get("/api/v1/starli/resources/projects").json()
    text = json.dumps(body)
    for banned in ("s3cret-password", "tok-should-not-leak", "raw-body-payload", "full-content-blob", "cred-key", "secretpass"):
        assert banned not in text
    item = body["items"][0]
    assert set(item) == {"id", "name", "status", "description", "updatedAt", "url"}
    assert item["description"] == "public brief"
    assert item["url"] == "https://example.com/live"
    assert body["readOnly"] is True


def test_search_and_pagination(temp_source):
    for i, name in enumerate(("Alpha studio", "Beta studio", "Gamma other")):
        _insert(
            temp_source,
            "proposals",
            {
                "id": f"r{i}",
                "title": name,
                "status": "DRAFT",
                "description": "needle" if i < 2 else "other",
                "updatedAt": f"2026-01-0{i+1}",
                "token": "hidden-needle",
            },
        )
    client = _client(ADMIN)
    found = client.get("/api/v1/starli/resources/proposals", params={"q": "studio", "limit": 1, "offset": 0}).json()
    assert found["total"] == 2
    assert len(found["items"]) == 1
    assert found["items"][0]["id"] == "r1"
    page = client.get("/api/v1/starli/resources/proposals", params={"q": "studio", "limit": 1, "offset": 1}).json()
    assert page["items"][0]["id"] == "r0"
    assert "hidden-needle" not in json.dumps(found)
    long = "x" * 1200
    _insert(temp_source, "proposals", {"id": "long", "title": "Clip", "brief": long, "updatedAt": "2026-02-01"})
    clipped = client.get("/api/v1/starli/resources/proposals", params={"q": "Clip"}).json()["items"][0]
    assert len(clipped["description"]) == 1000


def test_stable_kind_mapping(temp_source):
    expected = {
        "projects": "projects",
        "proposals": "proposals",
        "mailbox": "mailbox-messages",
        "hosted-agents": "hosted-agent-agents",
        "videos": "video-projects",
        "activity": "crm_activities",
    }
    assert resources.COLLECTIONS == expected
    client = _client(ADMIN)
    for kind, collection in expected.items():
        _insert(
            temp_source,
            collection,
            {"id": kind + "-1", "subject": kind + " row", "summary": "", "snippet": "mapped", "status": "OK"},
        )
        body = client.get(f"/api/v1/starli/resources/{kind}").json()
        assert body["kind"] == kind
        assert body["total"] == 1
        assert body["items"][0]["id"] == kind + "-1"
        assert body["items"][0]["name"] == kind + " row"
    assert "/var/lib/starlidigital" not in str(temp_source)
