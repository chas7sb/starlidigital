"""Native provider settings boundaries; no real provider credential or billable inference."""
import asyncio,importlib.util,os,sys,time,types
from pathlib import Path
import pytest
from fastapi import FastAPI,Request
from fastapi.testclient import TestClient

# This test module intentionally imports only the provider router, not production app startup.
@pytest.fixture
def api(tmp_path,monkeypatch):
    from open_webui.routers import starli_providers as module
    monkeypatch.setattr(module,"root",lambda:tmp_path)
    monkeypatch.setattr(module,"_SESSIONS",{})
    monkeypatch.setattr(module,"_LOCKS",{})
    monkeypatch.setattr(module,"_CATALOG",{"providers":[{"id":"openai","name":"OpenAI","modelCount":1,"dynamicModels":True,"authMethods":[{"type":"api_key","label":"API key","interactive":True,"subscription":False}]}],"models":[{"id":"model-a","name":"Model A","provider":"openai","type":"chat"}]})
    app=FastAPI();app.include_router(module.router,prefix="/providers")
    async def identity(request:Request):return {"id":request.headers.get("x-test-owner","alice"),"role":request.headers.get("x-test-role","user")}
    app.dependency_overrides[module.get_verified_user]=identity
    with TestClient(app) as client:
        client.headers.update({"Authorization":"Bearer synthetic-test"})
        yield module,client,tmp_path

def test_credentials_are_encrypted_and_owner_scoped(api):
    module,client,path=api
    value={"credentials":{"openai":{"type":"api_key","key":"synthetic-secret-never-real"}},"selection":None,"catalogs":{}}
    module.persist("alice",value)
    assert module.account("alice")["credentials"]["openai"]["key"]=="synthetic-secret-never-real"
    assert module.account("bob")["credentials"]=={}
    assert b"synthetic-secret-never-real" not in (path/"accounts.sqlite").read_bytes()
    assert (path/"master.key").stat().st_mode&0o077==0
    response=client.get("/providers")
    assert response.status_code==200
    assert response.json()["items"][0]["connected"] is True
    assert "synthetic-secret" not in response.text
    response=client.get("/providers",headers={"x-test-owner":"bob"})
    assert response.json()["items"][0]["connected"] is False

def test_selection_is_validated_and_bearer_only(api):
    module,client,path=api
    module.persist("alice",{"credentials":{"openai":{"type":"api_key","key":"synthetic-key"}},"selection":None,"catalogs":{}})
    body={"provider":"openai","model":"model-a"}
    assert client.put("/providers/selection/default",json=body).status_code==200
    assert client.put("/providers/selection/default",json={**body,"model":"invented"}).status_code==422
    assert client.put("/providers/selection/default",headers={"x-test-owner":"bob"},json=body).status_code==409
    client.headers.pop("Authorization")
    assert client.put("/providers/selection/default",json=body).status_code==403

def test_pending_users_denied_and_session_isolation(api):
    module,client,path=api
    assert client.get("/providers",headers={"x-test-role":"pending"}).status_code==403
    module._SESSIONS["private-session"]={"id":"private-session","owner":"alice","status":"INPUT_REQUIRED","provider":"openai","events":[],"prompt":{"id":"step-12345","message":"Enter key"}}
    assert client.get("/providers/sessions/private-session/status").status_code==200
    assert client.get("/providers/sessions/private-session/status",headers={"x-test-owner":"bob"}).status_code==404
    assert client.post("/providers/sessions/private-session/answer",json={"promptId":"stale-step-123","value":"synthetic"}).status_code==409

def test_disconnect_revokes_selection_and_keeps_other_tenants(api):
    module,client,path=api
    for who in ("alice","bob"):
        module.persist(who,{"credentials":{"openai":{"type":"api_key","key":"synthetic-"+who}},"selection":{"provider":"openai","model":"model-a"},"catalogs":{}})
    assert client.delete("/providers/openai").status_code==200
    assert module.account("alice")["credentials"]=={}
    assert module.account("alice")["selection"] is None
    assert module.account("bob")["credentials"]["openai"]["key"]=="synthetic-bob"

def test_provider_child_does_not_inherit_operator_secrets(api,monkeypatch):
    module,client,path=api
    monkeypatch.setenv("OPENAI_API_KEY","operator-secret")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY","operator-cloud-secret")
    environment=module.environment("alice")
    assert "OPENAI_API_KEY" not in environment and "AWS_SECRET_ACCESS_KEY" not in environment
    assert environment["HOME"]!=os.environ.get("HOME")
