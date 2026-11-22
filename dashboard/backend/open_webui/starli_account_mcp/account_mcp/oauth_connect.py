"""Restricted first-party Starli Control Plane OAuth for account MCP.

Only the configured first-party control plane and the read scope are accepted. Unlike
company sign-in, this provider requires a separate CONTROL PLANE ADMIN login.
Encrypted token remains in the existing account MCP registry. Per-bot tool
consent is unchanged.
"""
from __future__ import annotations
import starli_portable as _portable
from .private_storage import ensure_private_database

import base64, hashlib, hmac, html, json, os, re, secrets, sqlite3, time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlencode

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

ISSUER=_portable.platform_public_url('')
ENDPOINT=_portable.control_plane_public_url("/mcp")
CLIENT="starliapp-native-mcp-readonly"
PREFIX="/api/v1/starli/mcp/oauth"
COOKIE="starli_mcp_oauth_proof"
ORIGINS = _portable.oauth_origins()
PRIVATE={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}
TTL=600

def refuse(status,code):
    raise HTTPException(status,code,headers=PRIVATE)

def digest(s):
    return hashlib.sha256(s.encode()).hexdigest()

def site(request):
    result=ORIGINS.get(request.headers.get("host","").lower())
    if result is None:refuse(403,"MCP_OAUTH_HOST_DENIED")
    return result

class Start(BaseModel):
    model_config=ConfigDict(extra="forbid",strict=True)
    serverId:str=Field(pattern=r"^mcp_[a-f0-9]{32}$")
    expectedRevision:int=Field(ge=1,le=2**53-1)

class Store:
    def __init__(self,path):
        self.path=Path(path)
        try:
            ensure_private_database(self.path)
        except OSError:
            refuse(503,"MCP_OAUTH_STORAGE_DENIED")
        with self.db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS flows(
              state_hash TEXT PRIMARY KEY, owner TEXT NOT NULL,
              server_id TEXT NOT NULL, revision INTEGER NOT NULL,
              session_hash TEXT NOT NULL, family_hash TEXT NOT NULL,
              session_expiry REAL, origin TEXT NOT NULL, proof_hash TEXT NOT NULL,
              verifier BLOB NOT NULL, expires REAL NOT NULL, status TEXT NOT NULL)""")
    @contextmanager
    def db(self):
        db=sqlite3.connect(self.path,timeout=5)
        db.row_factory=sqlite3.Row
        try:
            with db:yield db
        finally:db.close()

def finish(ok,origin):
    if origin not in ORIGINS.values():refuse(403,"MCP_OAUTH_ORIGIN_DENIED")
    title="MCP sign-in completed" if ok else "MCP sign-in did not complete"
    body=("Your read-only credential is stored in your account. Return to StarliApp, refresh Connections, then Test and Discover tools before enabling the server."
          if ok else
          "The connection was not changed. Return to StarliApp and start a new sign-in attempt.")
    page=("<!doctype html><html><head><meta charset='utf-8'><meta name='referrer' content='no-referrer'>"
          "<meta name='viewport' content='width=device-width,initial-scale=1'><title>"+html.escape(title)+"</title>"
          "</head><body><main><h1>"+html.escape(title)+"</h1><p>"+html.escape(body)+
          "</p><a href='"+html.escape(origin+"/app")+"'>Return to StarliApp</a></main></body></html>")
    return HTMLResponse(page,headers={**PRIVATE,
        "Content-Security-Policy":"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        "X-Frame-Options":"DENY"})

async def remote_token(code,verifier,redirect):
    body={"grant_type":"authorization_code","code":code,"code_verifier":verifier,
          "client_id":CLIENT,"redirect_uri":redirect}
    async with aiohttp.ClientSession(trust_env=False,timeout=aiohttp.ClientTimeout(total=15)) as session:
        async with session.post(_portable.platform_url("/oauth/token"),data=body,allow_redirects=False,
          headers={"Accept":"application/json"}) as response:
            raw=await response.content.read(4097)
            if response.status!=200 or len(raw)>4096 or not response.headers.get("content-type","").startswith("application/json"):
                refuse(502,"MCP_OAUTH_EXCHANGE_FAILED")
    try:payload=json.loads(raw)
    except ValueError:refuse(502,"MCP_OAUTH_EXCHANGE_INVALID")
    token=payload.get("access_token")
    expiry=payload.get("expires_in")
    if (type(token)is not str or re.fullmatch(r"starli_mcp_[a-f0-9]{64}",token)is None
      or payload.get("token_type","").lower()!="bearer"
      or set(str(payload.get("scope","")).split())!={"read"}
      or type(expiry)is not int or not 1<=expiry<=30*86400):
        refuse(502,"MCP_OAUTH_SCOPE_DENIED")
    return token

def create_router(service,authenticate,capture_fence,*,exchange=remote_token,resume_fence=None,store=None):
    from open_webui.routers.starli_session_fence import SessionFence
    from open_webui.starli_account_mcp.account_mcp.registry import Fault
    if resume_fence is None:
        resume_fence=lambda row:SessionFence(row["owner"],row["session_hash"],row["session_expiry"],
                                             "jwt",row["family_hash"])
    database=store or Store(service.root/"oauth-connect.sqlite")
    router=APIRouter()

    def authorize(request,user):
        fence=capture_fence(request,user)
        if fence.kind!="jwt":refuse(403,"MCP_OAUTH_NATIVE_JWT_REQUIRED")
        fresh=fence.check()
        if getattr(fresh,"id",None)!=getattr(user,"id",None):refuse(403,"MCP_OAUTH_ACCOUNT_DENIED")
        return service.registry_for(user,fence),fence

    @router.get("/options")
    def options(request:Request,user=Depends(authenticate)):
        site(request);authorize(request,user)
        return JSONResponse({"version":"starli.mcp-oauth.v1","supported":True,"endpoint":ENDPOINT,
          "provider":"Starli Control Plane","requiresControlPlaneAdministrator":True,
          "scopes":["read"]},headers=PRIVATE)

    @router.post("/start")
    def begin(body:Start,request:Request,response:Response,user=Depends(authenticate)):
        origin=site(request);registry,fence=authorize(request,user)
        try:target=registry.get(user.id,body.serverId)
        except Fault as error:refuse(error.status,error.code)
        if target["url"]!=ENDPOINT or target["transport"]!="streamable-http" or target["revision"]!=body.expectedRevision:
            refuse(409,"MCP_OAUTH_SERVER_CHANGED")
        if fence.expires_at is not None and fence.expires_at<time.time()+TTL:
            refuse(401,"MCP_OAUTH_SESSION_EXPIRING")
        state=secrets.token_urlsafe(32)
        proof=secrets.token_urlsafe(32)
        verifier=secrets.token_urlsafe(48)
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        encrypted=service.cipher_loader().encrypt(verifier.encode())
        with database.db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM flows WHERE expires<?",(time.time()-TTL,))
            db.execute("INSERT INTO flows VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",(
              digest(state),user.id,body.serverId,body.expectedRevision,
              fence.token_hash,fence.family_hash or fence.token_hash,fence.expires_at,origin,
              digest(proof),encrypted,time.time()+TTL,"PENDING"))
        redirect=origin+PREFIX+"/callback"
        query=urlencode({"response_type":"code","client_id":CLIENT,"redirect_uri":redirect,
             "scope":"read","state":state,"code_challenge":challenge,"code_challenge_method":"S256"})
        response.set_cookie(COOKIE,proof,secure=True,httponly=True,max_age=TTL,
                             samesite="lax",path=PREFIX+"/callback")
        response.headers.update(PRIVATE)
        return {"version":"starli.mcp-oauth.v1","authorizationUrl":ISSUER+"/oauth/authorize?"+query,
                "issuer":ISSUER,"scope":"read","expiresIn":TTL}

    @router.get("/callback")
    async def callback(request:Request):
        origin=site(request)
        def reply(ok):
            response=finish(ok,origin)
            response.delete_cookie(COOKIE,path=PREFIX+"/callback",httponly=True,
                                   secure=True,samesite="lax")
            return response
        state=request.query_params.get("state","")
        code=request.query_params.get("code","")
        proof=request.cookies.get(COOKIE,"")
        if (not re.fullmatch(r"[A-Za-z0-9_-]{30,100}",state)
          or not re.fullmatch(r"[A-Za-z0-9_-]{25,100}",proof)
          or not re.fullmatch(r"[A-Za-z0-9_-]{15,512}",code)):
            return reply(False)
        with database.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT * FROM flows WHERE state_hash=?",(digest(state),)).fetchone()
            if (row is None or row["status"]!="PENDING" or row["expires"]<time.time()
              or row["origin"]!=origin or not hmac.compare_digest(row["proof_hash"],digest(proof))):
                return reply(False)
            db.execute("UPDATE flows SET status='CONSUMED' WHERE state_hash=? AND status='PENDING'",(digest(state),))
        try:
            fence=resume_fence(row)
            user=fence.check()
            if user is None or getattr(user,"id",None)!=row["owner"]:refuse(403,"MCP_OAUTH_SESSION_REVOKED")
            registry=service.registry_for(user,fence)
            current=registry.get(row["owner"],row["server_id"])
            if current["url"]!=ENDPOINT or current["transport"]!="streamable-http" or current["revision"]!=row["revision"]:
                refuse(409,"MCP_OAUTH_SERVER_CHANGED")
            verifier=service.cipher_loader().decrypt(row["verifier"]).decode()
            token=await exchange(code,verifier,origin+PREFIX+"/callback")
            if getattr(fence.check(),"id",None)!=row["owner"]:refuse(403,"MCP_OAUTH_SESSION_REVOKED")
            saved=registry.mutate(row["owner"],row["server_id"],row["revision"],{"credential":token},enabled=False)
            if saved["enabled"] or not saved["credentialConfigured"]:refuse(503,"MCP_OAUTH_SAVE_UNVERIFIED")
            return reply(True)
        except Exception:
            # No secret/provider message in browser or logs. No automatic retry
            # of a token exchange with an uncertain external outcome.
            return reply(False)
    return router

def install(app):
    if getattr(app.state,"starli_account_mcp_oauth_installed",False):return
    from open_webui.utils.auth import get_verified_user
    from open_webui.routers.starli_session_fence import capture_request_fence
    service=app.state.starli_account_mcp_service
    app.include_router(create_router(service,get_verified_user,capture_request_fence),
                       prefix=PREFIX,tags=["starli-account-mcp-oauth"])
    app.state.starli_account_mcp_oauth_installed=True
