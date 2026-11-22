"""Isolated tests for the Starli Pi runtime router. No providers or subprocesses."""

import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from open_webui.routers import starli_runtime as rt
from open_webui.utils.auth import get_verified_user


def _app(user):
    app = FastAPI()
    app.include_router(rt.router, prefix="/api/v1/starli/runtime")
    app.dependency_overrides[get_verified_user] = lambda: user
    return app


@pytest.fixture(autouse=True)
def _clear_adapter():
    rt.register_runtime_adapter(None)
    yield
    rt.register_runtime_adapter(None)


def test_absent_adapter_returns_503():
    client = TestClient(_app({"id": "user-a"}))
    response = client.get("/api/v1/starli/runtime/capabilities")
    assert response.status_code == 503
    assert response.json()["detail"] == "Starli runtime adapter unavailable"


def test_identity_comes_from_verified_user_not_body():
    seen = {}

    def adapter(user_id, operation, payload):
        seen["user_id"] = user_id
        seen["operation"] = operation
        return {"connected": False, "detail": "not-live"}

    rt.register_runtime_adapter(adapter)
    client = TestClient(_app({"id": "verified-user"}))
    response = client.get(
        "/api/v1/starli/runtime/capabilities",
        headers={"x-user-id": "spoofed", "authorization": "Bearer not-used"},
    )
    assert response.status_code == 200
    assert seen == {"user_id": "verified-user", "operation": "capabilities"}
    assert response.json()["connected"] is False


def test_task_validation_forbids_extra_and_oversize_prompt():
    rt.register_runtime_adapter(lambda user_id, operation, payload: {})
    client = TestClient(_app({"id": "user-a"}))
    extra = client.post(
        "/api/v1/starli/runtime/tasks",
        json={"prompt": "hi", "idempotencyKey": "k1", "companyId": "other"},
    )
    assert extra.status_code == 422
    long = client.post(
        "/api/v1/starli/runtime/tasks",
        json={"prompt": "x" * 8001, "idempotencyKey": "k1"},
    )
    assert long.status_code == 422


def test_cross_owner_denial_is_propagated():
    def adapter(user_id, operation, payload):
        raise HTTPException(status_code=403, detail="Task owner mismatch")

    rt.register_runtime_adapter(adapter)
    client = TestClient(_app({"id": "user-b"}))
    response = client.get("/api/v1/starli/runtime/tasks/task-owned-by-a")
    assert response.status_code == 403
    assert response.json()["detail"] == "Task owner mismatch"


def test_cancel_forwards_task_id_and_returns_receipt():
    seen = {}

    async def adapter(user_id, operation, payload):
        seen["user_id"] = user_id
        seen["operation"] = operation
        seen["payload"] = payload
        return {
            "taskId": payload["taskId"],
            "status": "cancelled",
            "progress": "cancel-requested",
            "receipts": ["cancel-accepted"],
            "connected": False,
        }

    rt.register_runtime_adapter(adapter)
    client = TestClient(_app({"id": "user-a"}))
    response = client.post("/api/v1/starli/runtime/tasks/task-9/cancel")
    assert response.status_code == 200
    body = response.json()
    assert seen == {"user_id": "user-a", "operation": "tasks.cancel", "payload": {"taskId": "task-9"}}
    assert body["status"] == "cancelled"
    assert body["progress"] == "cancel-requested"
    assert body["receipts"] == ["cancel-accepted"]


def test_idempotency_key_forwarded_by_dispatch_and_http():
    calls = []

    def adapter(user_id, operation, payload):
        calls.append((user_id, operation, dict(payload)))
        return {
            "taskId": "t-1",
            "status": "accepted",
            "progress": "queued",
            "receipts": [payload["idempotencyKey"]],
            "connected": False,
        }

    rt.register_runtime_adapter(adapter)
    result = asyncio.run(rt.dispatch_starli_task("chat-user", "build page", "idem-chat"))
    assert result["receipts"] == ["idem-chat"]
    client = TestClient(_app({"id": "http-user"}))
    response = client.post(
        "/api/v1/starli/runtime/tasks",
        json={"prompt": "build page", "idempotencyKey": "idem-http", "model": "pi-default"},
    )
    assert response.status_code == 200
    assert calls[0][2]["idempotencyKey"] == "idem-chat"
    assert calls[1] == (
        "http-user",
        "tasks.create",
        {"prompt": "build page", "model": "pi-default", "idempotencyKey": "idem-http"},
    )
