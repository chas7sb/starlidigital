"""Tests for Starli overview authentication, schema, and adapter fail-closed behavior."""

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from open_webui.routers import starli


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(starli.router, prefix="/api/v1/starli")
    starli.register_company_overview_adapter(None)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        starli.register_company_overview_adapter(None)


def authenticate_as(client, user_id="verified-user"):
    client.app.dependency_overrides[starli.get_verified_user] = lambda: {"id": user_id}


def valid_overview():
    return {
        "company": {"id": "company-1", "name": "Example Co"},
        "agents": [{"id": "agent-1", "name": "Support", "status": "active"}],
        "tools": [{"id": "tool-1", "name": "Lookup", "description": "Read lookup"}],
        "browser": {"available": False, "reason": "Not configured"},
        "credits": {"available": True, "balance": 2.5, "unit": "credits"},
        "readOnly": True,
    }


def test_overview_denies_unauthenticated_request(client):
    def unauthenticated():
        raise HTTPException(status_code=401, detail="Not authenticated")

    client.app.dependency_overrides[starli.get_verified_user] = unauthenticated
    assert client.get("/api/v1/starli/overview").status_code == 401


def test_overview_returns_503_without_adapter_and_ignores_identity_headers(client):
    authenticate_as(client)
    response = client.get(
        "/api/v1/starli/overview",
        headers={"X-Company-Id": "attacker-company", "X-User-Id": "attacker-user"},
    )
    assert response.status_code == 503
    assert response.json() == {"detail": "Starli overview source unavailable"}


def test_adapter_receives_only_authenticated_identity(client):
    authenticate_as(client)
    received = []

    def source(user_id):
        received.append(user_id)
        return valid_overview()

    starli.register_company_overview_adapter(source)
    response = client.get(
        "/api/v1/starli/overview",
        headers={"X-Company-Id": "attacker-company", "X-User-Id": "attacker-user"},
    )
    assert response.status_code == 200
    assert response.json() == valid_overview()
    assert received == ["verified-user"]


def test_response_rejects_fields_outside_contract_without_echoing_them(client):
    authenticate_as(client)
    payload = valid_overview()
    payload["adminToken"] = "must-not-leak"
    starli.register_company_overview_adapter(lambda _user_id: payload)

    response = client.get("/api/v1/starli/overview")
    assert response.status_code == 502
    assert "adminToken" not in response.text
    assert "must-not-leak" not in response.text


def test_response_rejects_wrong_field_types(client):
    authenticate_as(client)
    payload = valid_overview()
    payload["readOnly"] = "true"
    starli.register_company_overview_adapter(lambda _user_id: payload)

    response = client.get("/api/v1/starli/overview")
    assert response.status_code == 502
