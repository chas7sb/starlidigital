"""Isolated anonymous builder/persistence/claim tests. Provider calls are deterministic fakes."""
import asyncio
import json
import sqlite3
from types import SimpleNamespace

import pytest
from fastapi import HTTPException,Request,Response
from open_webui.routers import starli_public as public
from open_webui.routers import starli_workspace as workspace

@pytest.fixture
def guest_builder(tmp_path,monkeypatch):
    import open_webui.config  # Apply native Alembic migrations to the isolated test database.
    from open_webui.routers import starli_guest_provider
    monkeypatch.setattr(starli_guest_provider,"server_key",lambda:"synthetic-free-guest-key")
    database=tmp_path/"source.sqlite"
    with sqlite3.connect(database) as c:
        c.execute("CREATE TABLE records(collection TEXT,id TEXT,owner TEXT,payload TEXT,PRIMARY KEY(collection,id))")
        c.execute("CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,payload TEXT)")
    monkeypatch.setattr(workspace,"source_database",lambda:str(database))
    from open_webui.routers import starli_customer_identity
    from open_webui.models.users import Users
    accounts={uid:SimpleNamespace(id=uid,role="user",oauth_sub=None) for uid in ("qa-signed-in","qa-history-owner")}
    monkeypatch.setattr(Users,"get_user_by_id",lambda uid:accounts.get(uid))
    monkeypatch.setattr(starli_customer_identity,"source_database",lambda:str(database))
    monkeypatch.setattr(workspace,"state_dir",lambda:tmp_path/"workspace")
    monkeypatch.setattr(public,"STATE_DIR",tmp_path/"guest")
    calls=[]
    async def provider(messages,*,audience="guest"):
        calls.append({"messages":messages,"audience":audience})
        return public.PublicReply(json.dumps({"name":"Guest website","summary":"Saved actual project files","html":"<!doctype html><html><head><title>Revision "+str(len(calls))+"</title></head><body>Working guest project "+str(len(calls))+"</body></html>"}),{"status":"completed","responseId":"isolated-provider"})
    original_provider=public.call_provider
    monkeypatch.setattr(public,"call_provider",provider)
    return SimpleNamespace(original_provider=original_provider,token=public.new_cookie(),foreign_token=public.new_cookie(),calls=calls,path=tmp_path)

def request(token,*,bearer=False,ip="192.0.2.10"):
    headers=[(b"cookie",(public.COOKIE+"="+token).encode())]
    if bearer:headers.append((b"authorization",b"Bearer isolated-guest-test"))
    return Request({"type":"http","method":"POST","scheme":"https","path":"/api/v1/starli/public/projects/build","headers":headers,"client":(ip,12345),"server":("example.invalid",443)})

def body(ident="guest-build-1",prompt="Build a usable business website",project=None):
    return public.GuestProjectBuild(requestId=ident,prompt=prompt,projectId=project)

def test_guest_cookie_is_required_and_signature_is_checked(guest_builder):
    owner=public.guest_owner(request(guest_builder.token))
    assert owner.startswith("guest:")
    with pytest.raises(HTTPException) as denied:public.guest_owner(request(guest_builder.token+"tampered"))
    assert denied.value.status_code==403
    with pytest.raises(HTTPException):public.guest_owner(request(""))

def test_guest_session_cookie_is_http_only_scoped_and_secure(guest_builder):
    response=Response()
    public.session(request(guest_builder.token),response)
    cookie=response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie
    assert "Path=/api/v1/starli/public" in cookie and "SameSite=lax" in cookie
    assert response.headers["cache-control"]=="no-store"

def test_guest_build_persists_actual_files_and_iterative_preview(guest_builder):
    req=request(guest_builder.token)
    first=asyncio.run(public.guest_project_build(body(),req))
    ident=first["project"]["id"]
    assert guest_builder.calls[0]["audience"]=="builder"
    owner=public.guest_owner(req)
    saved=workspace.read(owner,ident)
    assert saved["files"][0]["path"]=="index.html"
    assert "Working guest project 1" in saved["files"][0]["content"]
    assert public.guest_projects(req)["items"][0]["id"]==ident
    assert "Working guest project 1" in public.guest_project_preview(ident,req)["html"]
    second=asyncio.run(public.guest_project_build(body("guest-build-2","Change the heading",ident),req))
    assert second["project"]["id"]==ident
    assert "Existing project files" in guest_builder.calls[1]["messages"][0]["content"]
    updated=workspace.read(owner,ident)
    assert updated["version"]==saved["version"]+1
    assert len(updated["versions"])==2
    assert "Working guest project 2" in public.guest_project_preview(ident,req)["html"]
    assert len(public.guest_projects(req)["items"])==1

def test_guest_build_idempotency_reuses_receipt_without_provider_call(guest_builder):
    req=request(guest_builder.token);payload=body()
    first=asyncio.run(public.guest_project_build(payload,req))
    again=asyncio.run(public.guest_project_build(payload,req))
    assert first==again and len(guest_builder.calls)==1
    with pytest.raises(HTTPException) as conflict:
        asyncio.run(public.guest_project_build(body(prompt="Different objective"),req))
    assert conflict.value.status_code==409 and len(guest_builder.calls)==1

def test_foreign_guest_cannot_read_or_revise_project(guest_builder):
    first=asyncio.run(public.guest_project_build(body(),request(guest_builder.token)))
    ident=first["project"]["id"];foreign=request(guest_builder.foreign_token)
    assert public.guest_projects(foreign)["items"]==[]
    with pytest.raises(HTTPException) as hidden:public.guest_project_preview(ident,foreign)
    assert hidden.value.status_code==404
    with pytest.raises(HTTPException) as denied:
        asyncio.run(public.guest_project_build(body("foreign-edit-1",project=ident),foreign))
    assert denied.value.status_code==404
    assert len(guest_builder.calls)==1

def test_guest_project_quota_bounds_provider_generation(guest_builder):
    req=request(guest_builder.token)
    for n in range(3):asyncio.run(public.guest_project_build(body("quota-build-"+str(n)),req))
    with pytest.raises(HTTPException) as limited:
        asyncio.run(public.guest_project_build(body("quota-build-3"),req))
    assert limited.value.status_code==429 and len(guest_builder.calls)==3
    assert len(public.guest_projects(req)["items"])==3

def test_invalid_generation_preserves_existing_project_and_uncertain_is_not_replayed(guest_builder,monkeypatch):
    req=request(guest_builder.token)
    built=asyncio.run(public.guest_project_build(body(),req));ident=built["project"]["id"]
    before=workspace.read(public.guest_owner(req),ident)
    calls=[]
    async def invalid_provider(*args,**kwargs):
        calls.append(1);return "not valid JSON"
    monkeypatch.setattr(public,"call_provider",invalid_provider)
    payload=body("invalid-build-1","Change the project",ident)
    with pytest.raises(HTTPException) as invalid:asyncio.run(public.guest_project_build(payload,req))
    assert invalid.value.status_code==502
    assert workspace.read(public.guest_owner(req),ident)==before
    with pytest.raises(HTTPException) as pending:asyncio.run(public.guest_project_build(payload,req))
    assert pending.value.status_code==409 and calls==[1]

def test_guest_claim_requires_bearer_and_transfers_ownership_once(guest_builder):
    req=request(guest_builder.token)
    first=asyncio.run(public.guest_project_build(body(),req));ident=first["project"]["id"]
    user=SimpleNamespace(id="qa-signed-in",role="user",oauth_sub=None)
    with pytest.raises(HTTPException) as denied:public.claim_guest_projects(req,Response(),user=user)
    assert denied.value.status_code==403
    claimed=public.claim_guest_projects(request(guest_builder.token,bearer=True),Response(),user=user)
    assert claimed["count"]==1 and claimed["claimedProjectIds"]==[ident]
    assert workspace.read(user.id,ident)["ownerId"]==user.id
    assert workspace.tool(user,"project_files",{"projectId":ident})["id"]==ident
    with pytest.raises(HTTPException):public.guest_project_preview(ident,req)
    assert public.guest_projects(req)["items"]==[]
    assert public.claim_guest_projects(request(guest_builder.token,bearer=True),Response(),user=user)["count"]==0


def test_guest_claim_migrates_native_chat_history_and_clears_cookie(guest_builder):
    from open_webui.models.chats import Chats
    req=request(guest_builder.token,bearer=True)
    built=asyncio.run(public.guest_project_build(body(),request(guest_builder.token)))
    user=SimpleNamespace(id="qa-history-owner",role="user",oauth_sub=None)
    response=Response()
    claim=public.claim_guest_projects(req,response,body=public.ClaimGuestBody(messages=[public.Message(role="user",content="Build my bakery website"),public.Message(role="assistant",content="Your project files are saved")]),user=user)
    assert claim["count"]==1 and claim["chatId"]
    record=Chats.get_chat_by_id_and_user_id(claim["chatId"],user.id)
    assert record and record.chat["messages"][0]["content"]=="Build my bakery website"
    history=record.chat["history"]
    assert history["currentId"]==record.chat["messages"][-1]["id"]
    assert record.chat["messages"][0]["childrenIds"]==[record.chat["messages"][1]["id"]]
    assert Chats.get_chat_by_id_and_user_id(claim["chatId"],"qa-other-user") is None
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert workspace.read(user.id,built["project"]["id"])["ownerId"]==user.id
    retry=public.claim_guest_projects(req,Response(),body=public.ClaimGuestBody(messages=[public.Message(role="user",content="Build my bakery website"),public.Message(role="assistant",content="Your project files are saved")]),user=user)
    assert retry["chatId"]==claim["chatId"] and retry["count"]==0
    assert len(Chats.get_chat_by_id_and_user_id(claim["chatId"],user.id).chat["messages"])==2


def test_guest_builder_uses_fixed_free_provider_without_unrelated_openai_key(guest_builder,monkeypatch):
    from open_webui.routers import starli_guest_provider as provider
    monkeypatch.delenv("OPENAI_API_KEY",raising=False)
    monkeypatch.setattr(provider,"server_key",lambda:"isolated-free-provider-key")
    generated=json.dumps({"name":"Free guest project","summary":"Saved","html":"<!doctype html><html><body>Free guest default</body></html>"})
    captured=[]
    class Content:
        async def iter_chunked(self,limit):
            yield json.dumps({"id":"isolated-free-response","model":provider.MODEL,"choices":[{"message":{"content":generated},"finish_reason":"stop"}],"usage":{"cost":0}}).encode()
    class Reply:
        status=200
        headers={}
        content=Content()
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
    class Client:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def post(self,url,**options):
            captured.append((url,options["json"]))
            return Reply()
    monkeypatch.setattr(provider.aiohttp,"ClientSession",lambda **kwargs:Client())
    reply=asyncio.run(guest_builder.original_provider([{"role":"user","content":"Build the page"}],audience="builder"))
    assert str(reply)==generated
    assert captured[0][0]==provider.ENDPOINT
    assert captured[0][1]["model"]==provider.MODEL
    assert captured[0][1]["max_tokens"]==8192
    assert captured[0][1]["provider"]["max_price"]=={"prompt":0,"completion":0}
    assert reply.receipt["paidFallback"] is False
