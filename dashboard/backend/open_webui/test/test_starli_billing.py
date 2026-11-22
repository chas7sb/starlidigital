"""Temp-DB tests for the read-only billing preview. No production data."""
import json
import sqlite3

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from open_webui.routers import starli_billing as billing
from open_webui.routers import starli_platform as platform
from open_webui.utils.auth import get_verified_user

ADMIN = {"id": "webui-admin", "role": "admin"}


@pytest.fixture()
def temp_source(tmp_path, monkeypatch):
    db_path = tmp_path / "starli.sqlite"
    bindings = tmp_path / "bindings.json"
    bindings.write_text(json.dumps({"memberships": {"webui-admin": {"v2UserId": "v2-admin"}}}))
    con = sqlite3.connect(db_path)
    con.execute("CREATE TABLE users (id TEXT PRIMARY KEY, payload TEXT)")
    con.execute(
        "INSERT INTO users VALUES (?,?)",
        ("v2-admin", json.dumps({"id": "v2-admin", "role": "ADMIN", "disabled": False})),
    )
    con.execute(
        "CREATE TABLE credit_wallets (owner_id TEXT, available INTEGER, reserved INTEGER, debt INTEGER, total_granted INTEGER, total_spent INTEGER, updated_at TEXT)"
    )
    con.execute(
        "CREATE TABLE credit_ledger (id TEXT, owner_id TEXT, operation_key TEXT, kind TEXT, amount INTEGER, available_delta INTEGER, reserved_delta INTEGER, debt_delta INTEGER, reason TEXT, metadata TEXT, created_at TEXT, fingerprint TEXT, rawpayload TEXT)"
    )
    con.execute(
        "CREATE TABLE credit_reservations (operation_key TEXT, owner_id TEXT, amount INTEGER, action TEXT, project_id TEXT, status TEXT, created_at TEXT, updated_at TEXT, fingerprint TEXT)"
    )
    con.commit()
    con.close()
    monkeypatch.setattr(platform, "DATABASE", str(db_path))
    monkeypatch.setattr(platform, "BINDINGS", str(bindings))
    return db_path


def _write(db_path, sql, params):
    con = sqlite3.connect(db_path)
    con.execute(sql, params)
    con.commit()
    con.close()


def _client(user):
    app = FastAPI()
    app.include_router(billing.router, prefix="/api/v1/starli/billing")
    app.dependency_overrides[get_verified_user] = lambda: user
    return TestClient(app)


def test_owner_isolation_no_leakage(temp_source):
    _write(
        temp_source,
        "INSERT INTO credit_wallets VALUES (?,?,?,?,?,?,?)",
        ("v2-admin", 10, 1, 0, 20, 9, "2026-01-02"),
    )
    _write(
        temp_source,
        "INSERT INTO credit_wallets VALUES (?,?,?,?,?,?,?)",
        ("other-owner", 999, 8, 7, 1000, 1, "2099-01-01"),
    )
    _write(
        temp_source,
        "INSERT INTO credit_ledger VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("mine", "v2-admin", "op-mine-secret", "grant", 10, 10, 0, 0, "own grant", "{}", "2026-01-02T00:00:00", "fp-mine", "raw-mine"),
    )
    _write(
        temp_source,
        "INSERT INTO credit_ledger VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("theirs", "other-owner", "op-other-secret", "spend", 999, -999, 0, 0, "other spend", "{\"token\":\"other-token\"}", "2099-01-01", "fp-other", "raw-other-payload"),
    )
    _write(
        temp_source,
        "INSERT INTO credit_reservations VALUES (?,?,?,?,?,?,?,?,?)",
        ("res-mine", "v2-admin", 3, "hold", "proj-mine", "open", "2026-01-02", "2026-01-02", "fp-res-mine"),
    )
    _write(
        temp_source,
        "INSERT INTO credit_reservations VALUES (?,?,?,?,?,?,?,?,?)",
        ("res-other-secret", "other-owner", 77, "capture", "proj-other", "held", "2099-01-01", "2099-01-01", "fp-res-other"),
    )
    body = _client(ADMIN).get("/api/v1/starli/billing", params={"owner": "other-owner", "owner_id": "other-owner"}).json()
    text = json.dumps(body)
    assert body["available"] is True
    assert body["wallet"]["available"] == 10
    assert body["wallet"]["totalGranted"] == 20
    assert [row["id"] for row in body["ledger"]] == ["mine"]
    assert body["reservations"] == [{"amount": 3, "action": "hold", "status": "open", "createdAt": "2026-01-02"}]
    for banned in ("other-owner", "999", "op-other-secret", "other-token", "raw-other-payload", "res-other-secret", "proj-other", "fp-other", "fp-res-other"):
        assert banned not in text


def test_absent_wallet_explicit_null(temp_source):
    body = _client(ADMIN).get("/api/v1/starli/billing").json()
    assert body["available"] is False
    assert body["wallet"] is None
    assert body["ledger"] == []
    assert body["reservations"] == []
    assert body["unit"] == "credits"
    assert body["paymentsEnabled"] is False


def test_source_auth_denied(temp_source):
    _write(
        temp_source,
        "UPDATE users SET payload=? WHERE id=?",
        (json.dumps({"id": "v2-admin", "role": "USER", "disabled": False}), "v2-admin"),
    )
    app = FastAPI()
    app.include_router(billing.router, prefix="/api/v1/starli/billing")
    denied = TestClient(app).get("/api/v1/starli/billing")
    assert denied.status_code in (401, 403)
    with pytest.raises(HTTPException) as exc:
        billing.billing(user=ADMIN)
    assert exc.value.status_code == 403


def test_no_ledger_metadata_exposure(temp_source):
    _write(
        temp_source,
        "INSERT INTO credit_wallets VALUES (?,?,?,?,?,?,?)",
        ("v2-admin", 1, 0, 0, 1, 0, "2026-01-01"),
    )
    for i in range(51):
        _write(
            temp_source,
            "INSERT INTO credit_ledger VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                f"led-{i:02d}",
                "v2-admin",
                f"operation-key-{i}",
                "grant",
                i,
                i,
                0,
                0,
                "reason",
                json.dumps({"secret": f"meta-secret-{i}", "fingerprint": f"fp-{i}"}),
                f"2026-01-01T00:{i:02d}:00",
                f"fingerprint-{i}",
                f"rawpayload-{i}",
            ),
        )
    for i in range(31):
        _write(
            temp_source,
            "INSERT INTO credit_reservations VALUES (?,?,?,?,?,?,?,?,?)",
            (f"op-res-{i}", "v2-admin", i, "hold", f"project-{i}", "open", f"2026-02-01T00:{i:02d}:00", "2026-02-01", f"res-fp-{i}"),
        )
    body = _client(ADMIN).get("/api/v1/starli/billing").json()
    text = json.dumps(body)
    assert len(body["ledger"]) == 50
    assert body["ledger"][0]["id"] == "led-50"
    assert "led-00" not in text
    assert len(body["reservations"]) == 30
    assert body["reservations"][0]["createdAt"] == "2026-02-01T00:30:00"
    assert set(body["ledger"][0]) == {"id", "kind", "amount", "availableDelta", "reservedDelta", "debtDelta", "reason", "createdAt"}
    assert set(body["reservations"][0]) == {"amount", "action", "status", "createdAt"}
    for banned in ("operation-key", "meta-secret", "fingerprint", "rawpayload", "op-res-", "project-"):
        assert banned not in text
