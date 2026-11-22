"""Native identity provisioning never adopts another account or enables password login."""
import json,sqlite3
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_customer_identity as identity

@pytest.fixture
def fixture(tmp_path,monkeypatch):
    path=tmp_path/"source.sqlite";users={"alice":{"id":"alice","name":"Alice","email":"same@example.test","role":"user"}}
    monkeypatch.setattr(identity,"source_database",lambda:str(path))
    monkeypatch.setattr(identity.Users,"get_user_by_id",lambda uid:users.get(uid))
    with sqlite3.connect(path) as db:
        db.executescript("CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE,payload TEXT);CREATE TABLE records(collection TEXT,id TEXT,owner TEXT,payload TEXT,PRIMARY KEY(collection,id));CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER);CREATE TABLE resets(token_hash TEXT,user_id TEXT,expires_at INTEGER);")
    return path,users

def row(path,uid):
    with sqlite3.connect(path) as db:
        value=db.execute("SELECT payload FROM users WHERE id=?",(uid,)).fetchone()
    return json.loads(value[0]) if value else None

def test_stable_service_identity_has_no_password_or_real_email(fixture):
    path,users=fixture
    a=identity.ensure_native_customer({"id":"alice","role":"admin"});b=identity.ensure_native_customer({"id":"alice"})
    assert a["v2UserId"]==b["v2UserId"]=="alice"
    source=row(path,"alice")
    assert source["role"]=="USER" and source["disabled"] is False
    assert source["passwordLoginEnabled"] is False and ":" not in source["passwordHash"]
    assert source["email"].endswith(".invalid") and source["recoveryEmail"]==""
    with sqlite3.connect(path) as db:assert db.execute("SELECT count(*) FROM webui_customer_identities").fetchone()[0]==1

def test_matching_email_does_not_link_or_modify_existing_user(fixture):
    path,users=fixture
    existing={"id":"independent","username":"existing","email":"same@example.test","role":"ADMIN","disabled":False}
    with sqlite3.connect(path) as db:db.execute("INSERT INTO users VALUES(?,?,?)",("independent","existing",json.dumps(existing)))
    identity.ensure_native_customer({"id":"alice"})
    assert row(path,"independent")==existing
    assert row(path,"alice")["email"]!="same@example.test"

def test_existing_id_collision_is_never_adopted(fixture):
    path,users=fixture
    existing={"id":"alice","username":"real-account","role":"ADMIN","disabled":False}
    with sqlite3.connect(path) as db:db.execute("INSERT INTO users VALUES(?,?,?)",("alice","real-account",json.dumps(existing)))
    with pytest.raises(HTTPException) as error:identity.ensure_native_customer({"id":"alice"})
    assert error.value.status_code==409 and row(path,"alice")==existing

def test_disabled_service_identity_is_not_reenabled(fixture):
    path,users=fixture;identity.ensure_native_customer({"id":"alice"})
    source=row(path,"alice");source["disabled"]=True
    with sqlite3.connect(path) as db:db.execute("UPDATE users SET payload=? WHERE id='alice'",(json.dumps(source),))
    with pytest.raises(HTTPException) as error:identity.ensure_native_customer({"id":"alice"})
    assert error.value.status_code==403 and row(path,"alice")["disabled"] is True

def test_canonical_native_account_and_existing_link_are_verified(fixture):
    path,users=fixture
    users["alice"]["role"]="pending"
    with pytest.raises(HTTPException):identity.ensure_native_customer({"id":"alice","role":"admin"})
    users["alice"].update(role="user",oauth_sub="starli-node:independent")
    with pytest.raises(HTTPException) as error:identity.ensure_native_customer({"id":"alice"})
    assert error.value.status_code==409

def test_inactive_native_account_revokes_only_its_service_identity_and_public_agents(fixture):
    path,users=fixture;identity.ensure_native_customer({"id":"alice"})
    independent={"id":"admin","role":"ADMIN","disabled":False}
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO users VALUES(?,?,?)",("admin","admin-existing",json.dumps(independent)))
        db.execute("INSERT INTO sessions VALUES('alice-session','alice',100)")
        db.execute("INSERT INTO sessions VALUES('admin-session','admin',100)")
        for owner in ("alice","admin"):
            db.execute("INSERT INTO records VALUES('hosted-agent-agents',?,?,?)",("agent-"+owner,owner,json.dumps({"id":"agent-"+owner,"ownerId":owner,"status":"ACTIVE","version":1})))
    users["alice"]["role"]="pending"
    assert identity.reconcile_native_identities()["revoked"]==["alice"]
    assert row(path,"alice")["disabled"] is True and row(path,"admin")==independent
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT count(*) FROM sessions WHERE user_id='alice'").fetchone()[0]==0
        assert db.execute("SELECT count(*) FROM sessions WHERE user_id='admin'").fetchone()[0]==1
        assert json.loads(db.execute("SELECT payload FROM records WHERE id='agent-alice'").fetchone()[0])["status"]=="DISABLED"
        assert json.loads(db.execute("SELECT payload FROM records WHERE id='agent-admin'").fetchone()[0])["status"]=="ACTIVE"

def test_customer_introspection_is_bearer_only_and_never_exposes_identity_secrets(fixture,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from open_webui.routers import starli_platform
    path,users=fixture
    monkeypatch.setattr(starli_platform,"customer_principal",lambda user:("alice",{"v2UserId":"node-alice","identitySource":"verified-test"}))
    app=FastAPI();app.include_router(identity.router,prefix="/identity")
    app.dependency_overrides[identity.get_verified_user]=lambda:{"id":"alice","role":"admin","binding_nonce":"must-not-appear"}
    with TestClient(app) as client:
        assert client.get("/identity").status_code==403
        response=client.get("/identity?nodeUserId=forged",headers={"Authorization":"Bearer synthetic"})
        assert response.status_code==200
        data=response.json()
        assert data["nativeUserId"]=="alice" and data["nodeUserId"]=="node-alice"
        assert data["accessRole"]=="CUSTOMER" and data["administratorSession"] is False
        assert not any(word in response.text for word in ("password","nonce","email","must-not-appear"))
        assert response.headers["cache-control"]=="no-store"
        users["alice"]["role"]="pending"
        assert client.get("/identity",headers={"Authorization":"Bearer synthetic"}).status_code==403
