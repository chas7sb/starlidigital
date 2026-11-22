"""Account-scoped external OAuth 2 authorization-code + PKCE for StarliApp MCP.

Separate from the two pinned first-party OAuth flows. Explicitly preregistered client
ID / secret and authorization endpoints. No dynamic registration, auto-tool grants,
private URL egress, token in browser, or unauthenticated callback write.
"""
from __future__ import annotations
import starli_portable as _portable
from .private_storage import ensure_private_database

import asyncio
import base64
import hashlib
import hmac
import html
import ipaddress
import json
import os
import re
import secrets
import socket
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit

import aiohttp
from aiohttp.abc import AbstractResolver
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

PREFIX = "/api/v1/starli/mcp/external"
COOKIE = "starli_mcp_external_proof"
ORIGINS = _portable.oauth_origins()
PRIVATE = {"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
           "X-Content-Type-Options": "nosniff"}
TTL = 600
USER_CALLBACK = PREFIX + "/callback"
SELF_IPV4 = "135.125.159.42"
MAX_JSON = 8192

def deny(status: int, code: str):
    raise HTTPException(status, code, headers=PRIVATE)

def hash_text(value: str):
    return hashlib.sha256(value.encode()).hexdigest()

def origin_for(request: Request) -> str:
    host = request.headers.get("host", "").lower()
    if host not in ORIGINS:
        deny(403, "MCP_EXT_HOST_DENIED")
    return ORIGINS[host]

def public_https(value: str) -> str:
    """Absolute public HTTPS origin/path; no URI credentials, fragments or query."""
    if type(value) is not str or not (9 <= len(value) <= 2048) or any(ord(c) < 33 or ord(c) == 127 for c in value) or "\\" in value:
        deny(422, "MCP_EXT_URL_INVALID")
    try:
        parts = urlsplit(value)
        port = parts.port
        host = parts.hostname
    except ValueError:
        deny(422, "MCP_EXT_URL_INVALID")
    if (parts.scheme != "https" or not host or parts.username or parts.password
        or parts.fragment or parts.query or port not in (None, 443)):
        deny(422, "MCP_EXT_URL_DENIED")
    try:
        ascii_host = host.encode("idna").decode("ascii").lower()
        ipaddress.ip_address(ascii_host)
        deny(422, "MCP_EXT_ADDRESS_DENIED")
    except ValueError:
        pass  # No literal IP; DNS host must be checked again at connection.
    except UnicodeError:
        deny(422, "MCP_EXT_URL_INVALID")
    if (not re.fullmatch(r"[a-z0-9.-]{4,250}", ascii_host) or
        ascii_host.count(".") < 1 or ascii_host.endswith(".") or ".." in ascii_host or
        ascii_host.endswith((".local", ".localhost", ".internal", ".test", ".invalid")) or
        ascii_host in ("localhost", "metadata.google.internal")):
        deny(422, "MCP_EXT_ADDRESS_DENIED")
    # Preserve the path exactly, including a tenant ID; port 443 is canonicalized.
    return "https://" + ascii_host + parts.path

def scopes(value: str) -> str:
    if type(value) is not str or not 1 <= len(value) <= 512:
        deny(422, "MCP_EXT_SCOPES_INVALID")
    xs = value.split()
    if (not 1 <= len(xs) <= 12 or len(xs) != len(set(xs)) or
        any(not re.fullmatch(r"[a-zA-Z0-9._~:/-]{1,160}", s) for s in xs)):
        deny(422, "MCP_EXT_SCOPES_INVALID")
    return " ".join(xs)

def clean_client_id(value: str):
    if (type(value) is not str or not 1 <= len(value) <= 256 or
        any(ord(c) <= 32 or ord(c) == 127 for c in value)):
        deny(422, "MCP_EXT_CLIENT_INVALID")
    return value

class PublicResolver(AbstractResolver):
    """Pin all egress to DNS-vetted GLOBAL addresses, TLS verified against original host."""
    async def resolve(self, host, port=0, family=socket.AF_INET):
        public_https("https://" + host + "/")
        try:
            answers = await asyncio.wait_for(
                asyncio.get_running_loop().getaddrinfo(host, port, family=family, type=socket.SOCK_STREAM),
                timeout=3,
            )
        except (OSError, asyncio.TimeoutError, ValueError):
            deny(502, "MCP_EXT_DNS_UNAVAILABLE")
        ips = []
        for fam, _, proto, _, sockaddr in answers:
            try:
                ip = ipaddress.ip_address(sockaddr[0])
                if not ip.is_global or str(ip) == SELF_IPV4:
                    deny(403, "MCP_EXT_ADDRESS_DENIED")
            except ValueError:
                deny(403, "MCP_EXT_ADDRESS_DENIED")
            ips.append({"hostname": host, "host": str(ip), "port": port,
                        "family": fam, "proto": proto, "flags": 0})
        if not ips or len(ips) > 32:
            deny(502, "MCP_EXT_DNS_UNAVAILABLE")
        return ips
    async def close(self):
        return None

async def guarded_json(url: str, *, form: dict | None = None, basic: tuple[str, str] | None = None):
    """One no-redirect HTTPS request with public-only pinned DNS and bounded JSON."""
    url = public_https(url)
    headers = {"Accept": "application/json"}
    if basic is not None:
        value = quote(basic[0], safe="") + ":" + quote(basic[1], safe="")
        headers["Authorization"] = "Basic " + base64.b64encode(value.encode()).decode()
    conn = aiohttp.TCPConnector(resolver=PublicResolver(), use_dns_cache=False,
                                ssl=True, limit=1, ttl_dns_cache=0)
    timeout = aiohttp.ClientTimeout(total=14, connect=5, sock_read=10)
    try:
        async with aiohttp.ClientSession(connector=conn, trust_env=False, timeout=timeout,
                                         cookie_jar=aiohttp.DummyCookieJar()) as session:
            if form is None:
                response = await session.get(url, headers=headers, allow_redirects=False)
            else:
                response = await session.post(url, data=form, headers=headers,
                                              allow_redirects=False)
            async with response:
                if response.status == 404 and form is None:
                    return None
                if response.status != 200:
                    deny(502, "MCP_EXT_PROVIDER_RESPONSE_FAILED")
                if not response.headers.get("Content-Type", "").lower().startswith("application/json"):
                    deny(502, "MCP_EXT_PROVIDER_CONTENT_INVALID")
                body = await response.content.read(MAX_JSON + 1)
                if len(body) > MAX_JSON:
                    deny(502, "MCP_EXT_PROVIDER_CONTENT_INVALID")
    except HTTPException:
        raise
    except (OSError, aiohttp.ClientError, asyncio.TimeoutError):
        deny(502, "MCP_EXT_PROVIDER_NETWORK_FAILED")
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeError):
        deny(502, "MCP_EXT_PROVIDER_CONTENT_INVALID")
    if type(payload) is not dict:
        deny(502, "MCP_EXT_PROVIDER_CONTENT_INVALID")
    return payload

def metadata_candidates(issuer: str):
    parts = urlsplit(issuer)
    base = parts.scheme + "://" + parts.netloc
    path = parts.path.rstrip("/")
    return list(dict.fromkeys([
        base + "/.well-known/oauth-authorization-server" + path,
        base + path + "/.well-known/openid-configuration",
        base + "/.well-known/openid-configuration"
    ]))

async def verify_provider(configuration: dict, *, get=guarded_json):
    """OAuth/MCP metadata must prove exact issuer/endpoints and PKCE S256."""
    for url in metadata_candidates(configuration["issuer"]):
        payload = await get(url)
        if payload is None:
            continue
        if (payload.get("issuer") != configuration["issuer"] or
            payload.get("authorization_endpoint") != configuration["authorization_endpoint"] or
            payload.get("token_endpoint") != configuration["token_endpoint"]):
            continue
        if "S256" not in payload.get("code_challenge_methods_supported", []):
            deny(422, "MCP_EXT_PKCE_UNVERIFIED")
        if "authorization_code" not in payload.get("grant_types_supported", ["authorization_code"]):
            deny(422, "MCP_EXT_GRANT_DENIED")
        return True
    deny(422, "MCP_EXT_METADATA_UNVERIFIED")

class Configure(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expectedServerRevision: int = Field(ge=1, le=2**53-1)
    expectedConfigRevision: int = Field(ge=0, le=2**53-1)
    issuer: str
    authorizationEndpoint: str
    tokenEndpoint: str
    clientId: str
    clientSecret: str | None = Field(default=None, max_length=4096, repr=False)
    clearClientSecret: bool = False
    scope: str
    tokenAuthMethod: str = "none"

class Start(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expectedServerRevision: int = Field(ge=1, le=2**53-1)
    expectedConfigRevision: int = Field(ge=1, le=2**53-1)
    consent: bool

class Remove(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expectedServerRevision: int = Field(ge=1, le=2**53-1)
    expectedConfigRevision: int = Field(ge=1, le=2**53-1)

class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        try:
            ensure_private_database(self.path)
        except OSError:
            deny(503, "MCP_EXT_STORAGE_DENIED")
        with self.db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS configs(
              owner TEXT NOT NULL, server_id TEXT NOT NULL, revision INTEGER NOT NULL,
              server_revision INTEGER NOT NULL, issuer TEXT NOT NULL,
              authorization_endpoint TEXT NOT NULL, token_endpoint TEXT NOT NULL,
              client_id TEXT NOT NULL, scope TEXT NOT NULL,
              token_auth_method TEXT NOT NULL, sealed_secret BLOB,
              PRIMARY KEY(owner,server_id))""")
            db.execute("""CREATE TABLE IF NOT EXISTS flows(
              state_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, server_id TEXT NOT NULL,
              server_revision INTEGER NOT NULL, config_revision INTEGER NOT NULL,
              session_hash TEXT NOT NULL, family_hash TEXT NOT NULL,
              session_expiry REAL, origin TEXT NOT NULL, proof_hash TEXT NOT NULL,
              sealed_verifier BLOB NOT NULL, expires REAL NOT NULL, status TEXT NOT NULL)""")
    @contextmanager
    def db(self):
        c = sqlite3.connect(self.path, timeout=5)
        c.row_factory = sqlite3.Row
        try:
            with c:
                yield c
        finally:
            c.close()
    def get(self, owner, server):
        with self.db() as db:
            row = db.execute("SELECT * FROM configs WHERE owner=? AND server_id=?",
                             (owner, server)).fetchone()
        return row
    @staticmethod
    def view(row, origin):
        return {
            "version": "starli.mcp-external-oauth.v1", "serverId": row["server_id"],
            "serverRevision": row["server_revision"], "configRevision": row["revision"],
            "issuer": row["issuer"], "authorizationEndpoint": row["authorization_endpoint"],
            "tokenEndpoint": row["token_endpoint"], "clientId": row["client_id"],
            "scope": row["scope"], "tokenAuthMethod": row["token_auth_method"],
            "hasClientSecret": row["sealed_secret"] is not None,
            "redirectUri": origin + USER_CALLBACK,
            "pkce": "S256", "providerMetadataVerification": "required-at-start"
        }
    def put(self, owner, server, expected_config, server_revision, fields, secret):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM configs WHERE owner=? AND server_id=?",
                             (owner, server)).fetchone()
            revision = old["revision"] if old else 0
            if revision != expected_config:
                deny(409, "MCP_EXT_CONFIG_REVISION_CONFLICT")
            if old:
                db.execute("""UPDATE configs SET revision=?,server_revision=?,
                  issuer=?,authorization_endpoint=?,token_endpoint=?,client_id=?,
                  scope=?,token_auth_method=?,sealed_secret=? WHERE owner=? AND server_id=?""",
                  (revision+1, server_revision, *fields, secret, owner, server))
            else:
                db.execute("INSERT INTO configs VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                           (owner, server, 1, server_revision, *fields, secret))
            result = db.execute("SELECT * FROM configs WHERE owner=? AND server_id=?",
                                (owner, server)).fetchone()
        return result
    def bump(self, owner, server, config_revision, old_server_rev, new_server_rev):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute("""UPDATE configs SET server_revision=?
                WHERE owner=? AND server_id=? AND revision=? AND server_revision=?""",
                (new_server_rev, owner, server, config_revision, old_server_rev))
            if result.rowcount != 1:
                deny(409, "MCP_EXT_CONFIG_REVISION_CONFLICT")
    def remove(self, owner, server, config_revision):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute("DELETE FROM configs WHERE owner=? AND server_id=? AND revision=?",
                                (owner, server, config_revision))
            if result.rowcount != 1:
                deny(409, "MCP_EXT_CONFIG_REVISION_CONFLICT")

async def token_exchange(conf, code, verifier, redirect, cipher, *, post=guarded_json):
    form = {
        "grant_type": "authorization_code", "code": code, "redirect_uri": redirect,
        "code_verifier": verifier, "resource": conf["resource"]
    }
    method = conf["token_auth_method"]
    secret = cipher.decrypt(conf["sealed_secret"]).decode() if conf["sealed_secret"] else ""
    if method == "none":
        form["client_id"] = conf["client_id"]
        basic = None
    elif method == "client_secret_post":
        form["client_id"] = conf["client_id"]
        form["client_secret"] = secret
        basic = None
    elif method == "client_secret_basic":
        basic = (conf["client_id"], secret)
    else:
        deny(422, "MCP_EXT_CLIENT_AUTH_DENIED")
    result = await post(conf["token_endpoint"], form=form, basic=basic)
    token = result.get("access_token")
    if (type(token) is not str or not 1 <= len(token) <= 8192 or
        any(ord(c) < 33 or ord(c) == 127 for c in token) or
        str(result.get("token_type", "")).lower() != "bearer"):
        deny(502, "MCP_EXT_TOKEN_INVALID")
    granted = result.get("scope", conf["scope"])
    if (type(granted) is not str or
        not set(granted.split()).issubset(set(conf["scope"].split()))):
        deny(502, "MCP_EXT_TOKEN_SCOPE_INVALID")
    lifetime = result.get("expires_in")
    if lifetime is not None and (type(lifetime) is not int or not 1 <= lifetime <= 30*86400):
        deny(502, "MCP_EXT_TOKEN_EXPIRY_INVALID")
    return token

def completion(ok, origin):
    title = "MCP OAuth sign-in complete" if ok else "MCP OAuth sign-in not completed"
    body = ("The access credential is encrypted in your StarliApp account. Return to Connections and "
            "Test, Discover, then Enable only the verified tools. Bots still require per-task consent."
            if ok else "No new access was authorized. Return to Connections and review the provider settings.")
    page = "<!doctype html><html><head><meta charset='utf-8'><meta name='referrer' content='no-referrer'><title>" + html.escape(title) + "</title></head><body><main><h1>" + html.escape(title) + "</h1><p>" + html.escape(body) + "</p><a href='" + html.escape(origin + "/app") + "'>Return to StarliApp</a></main></body></html>"
    return HTMLResponse(page, headers={**PRIVATE,
        "Content-Security-Policy": "default-src 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Frame-Options": "DENY"})

def create_router(service, authenticate, capture_fence, *, store=None, metadata=verify_provider,
                  exchange=token_exchange, resume_fence=None):
    from open_webui.routers.starli_session_fence import SessionFence
    from open_webui.starli_account_mcp.account_mcp.registry import Fault
    if resume_fence is None:
        resume_fence = lambda row: SessionFence(row["owner"], row["session_hash"],
            row["session_expiry"], "jwt", row["family_hash"])
    storage = store or Store(service.root / "oauth-external.sqlite")
    router = APIRouter()
    def ctx(request, user):
        origin = origin_for(request)
        fence = capture_fence(request, user)
        if getattr(fence, "kind", None) != "jwt":
            deny(403, "MCP_EXT_SESSION_DENIED")
        fresh = fence.check()
        if getattr(fresh, "id", None) != getattr(user, "id", None):
            deny(403, "MCP_EXT_ACCOUNT_DENIED")
        return origin, fence, service.registry_for(user, fence)
    def server_row(registry, user, server_id, revision=None):
        if not re.fullmatch(r"mcp_[a-f0-9]{32}", server_id):
            deny(422, "MCP_EXT_SERVER_INVALID")
        try:
            row = registry.get(user.id, server_id)
        except Fault as e:
            deny(e.status, e.code)
        if revision is not None and row["revision"] != revision:
            deny(409, "MCP_EXT_SERVER_REVISION_CONFLICT")
        if row["transport"] != "streamable-http":
            deny(422, "MCP_EXT_TRANSPORT_DENIED")
        return row
    @router.get("/options")
    def options(request: Request, user=Depends(authenticate)):
        origin, _, _ = ctx(request, user)
        return JSONResponse({
            "version": "starli.mcp-external-oauth.v1", "supported": True,
            "grant": "authorization_code", "pkce": "S256",
            "tokenAuthMethods": ["none", "client_secret_basic", "client_secret_post"],
            "redirectUri": origin + USER_CALLBACK, "resourceRequired": True,
            "providerMetadataVerification": "required",
            "dynamicClientRegistration": False
        }, headers=PRIVATE)
    @router.get("/servers/{server_id}/config")
    def config(server_id: str, request: Request, user=Depends(authenticate)):
        origin, _, registry = ctx(request, user)
        server_row(registry, user, server_id)
        row = storage.get(user.id, server_id)
        return JSONResponse(storage.view(row, origin) if row else {
            "version": "starli.mcp-external-oauth.v1", "serverId": server_id,
            "configRevision": 0, "configured": False,
            "redirectUri": origin + USER_CALLBACK}, headers=PRIVATE)
    @router.put("/servers/{server_id}/config")
    def configure(server_id: str, data: Configure, request: Request, user=Depends(authenticate)):
        origin, fence, registry = ctx(request, user)
        server = server_row(registry, user, server_id, data.expectedServerRevision)
        if server["enabled"]:
            deny(409, "MCP_EXT_DISABLE_BEFORE_RECONFIGURE")
        if data.clearClientSecret and data.clientSecret is not None:
            deny(422, "MCP_EXT_SECRET_CONFLICT")
        method = data.tokenAuthMethod
        if method not in ("none", "client_secret_basic", "client_secret_post"):
            deny(422, "MCP_EXT_CLIENT_AUTH_DENIED")
        values = (
            public_https(data.issuer), public_https(data.authorizationEndpoint),
            public_https(data.tokenEndpoint), clean_client_id(data.clientId),
            scopes(data.scope), method
        )
        if type(data.clientSecret) is str and (
            len(data.clientSecret) < 1 or any(ord(c) < 33 or ord(c) == 127 for c in data.clientSecret)
        ):
            deny(422, "MCP_EXT_SECRET_INVALID")
        existing = storage.get(user.id, server_id)
        secret = (existing["sealed_secret"] if existing and not data.clearClientSecret else None)
        if data.clientSecret:
            secret = service.cipher_loader().encrypt(data.clientSecret.encode())
        if method != "none" and secret is None:
            deny(422, "MCP_EXT_CLIENT_SECRET_REQUIRED")
        if method == "none" and secret is not None:
            deny(422, "MCP_EXT_CLIENT_SECRET_NOT_USED")
        fence.check()
        server_row(registry, user, server_id, data.expectedServerRevision)
        row = storage.put(user.id, server_id, data.expectedConfigRevision,
                          data.expectedServerRevision, values, secret)
        fence.check()
        return JSONResponse(storage.view(row, origin), headers=PRIVATE)
    @router.delete("/servers/{server_id}/config")
    def delete(server_id: str, data: Remove, request: Request, user=Depends(authenticate)):
        _, fence, registry = ctx(request, user)
        server_row(registry, user, server_id, data.expectedServerRevision)
        row = storage.get(user.id, server_id)
        if not row or row["revision"] != data.expectedConfigRevision:
            deny(409, "MCP_EXT_CONFIG_REVISION_CONFLICT")
        # Explicit disconnect: revoke local credential and disable first, then clear config.
        try:
            saved = registry.mutate(user.id, server_id, data.expectedServerRevision,
                                    {"credential": None}, enabled=False)
        except Fault as e:
            deny(e.status, e.code)
        fence.check()
        storage.remove(user.id, server_id, data.expectedConfigRevision)
        return JSONResponse({"deleted": True, "serverRevision": saved["revision"]}, headers=PRIVATE)
    @router.post("/servers/{server_id}/start")
    async def start(server_id: str, data: Start, request: Request, response: Response,
                    user=Depends(authenticate)):
        if data.consent is not True:
            deny(403, "MCP_EXT_CONSENT_REQUIRED")
        origin, fence, registry = ctx(request, user)
        row = server_row(registry, user, server_id, data.expectedServerRevision)
        if row["enabled"]:
            deny(409, "MCP_EXT_DISABLE_BEFORE_RECONNECT")
        conf = storage.get(user.id, server_id)
        if (not conf or conf["revision"] != data.expectedConfigRevision or
            conf["server_revision"] != data.expectedServerRevision):
            deny(409, "MCP_EXT_CONFIG_REVISION_CONFLICT")
        if fence.expires_at is not None and fence.expires_at < time.time() + TTL:
            deny(401, "MCP_EXT_SESSION_EXPIRING")
        configuration = dict(conf)
        configuration["resource"] = row["url"]
        await metadata(configuration)
        fence.check()
        server_row(registry, user, server_id, data.expectedServerRevision)
        state = secrets.token_urlsafe(32)
        proof = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        with storage.db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM flows WHERE expires<?", (time.time()-TTL,))
            pending = db.execute("SELECT COUNT(*) FROM flows WHERE owner=? AND status='PENDING' AND expires>?",
                                 (user.id, time.time())).fetchone()[0]
            if pending >= 5:
                deny(429, "MCP_EXT_TOO_MANY_PENDING")
            db.execute("INSERT INTO flows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                hash_text(state), user.id, server_id, data.expectedServerRevision,
                data.expectedConfigRevision, fence.token_hash, fence.family_hash or fence.token_hash,
                fence.expires_at, origin, hash_text(proof),
                service.cipher_loader().encrypt(verifier.encode()),
                time.time()+TTL, "PENDING"
            ))
        params = {
            "response_type": "code", "client_id": conf["client_id"],
            "redirect_uri": origin + USER_CALLBACK, "scope": conf["scope"],
            "resource": row["url"], "state": state,
            "code_challenge": challenge, "code_challenge_method": "S256"
        }
        response.set_cookie(COOKIE, proof, secure=True, httponly=True, samesite="lax",
                            max_age=TTL, path=USER_CALLBACK)
        response.headers.update(PRIVATE)
        return {
            "version": "starli.mcp-external-oauth.v1",
            "authorizationUrl": conf["authorization_endpoint"] + "?" + urlencode(params),
            "authorizationEndpoint": conf["authorization_endpoint"], "issuer": conf["issuer"],
            "redirectUri": origin + USER_CALLBACK, "scope": conf["scope"],
            "resource": row["url"], "expiresIn": TTL
        }
    @router.get("/callback")
    async def callback(request: Request):
        origin = origin_for(request)
        def reply(ok):
            response = completion(ok, origin)
            response.delete_cookie(COOKIE, path=USER_CALLBACK, secure=True, httponly=True,
                                   samesite="lax")
            return response
        state = request.query_params.get("state", "")
        code = request.query_params.get("code", "")
        proof = request.cookies.get(COOKIE, "")
        if not (re.fullmatch(r"[A-Za-z0-9_-]{30,100}", state) and
                re.fullmatch(r"[A-Za-z0-9_-]{15,2048}", code) and
                re.fullmatch(r"[A-Za-z0-9_-]{30,100}", proof)):
            return reply(False)
        with storage.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM flows WHERE state_hash=?",
                             (hash_text(state),)).fetchone()
            if (row is None or row["status"] != "PENDING" or row["expires"] < time.time() or
                row["origin"] != origin or
                not hmac.compare_digest(row["proof_hash"], hash_text(proof))):
                return reply(False)
            db.execute("UPDATE flows SET status='CONSUMED' WHERE state_hash=? AND status='PENDING'",
                       (hash_text(state),))
        try:
            fence = resume_fence(row)
            user = fence.check()
            if user is None or getattr(user, "id", None) != row["owner"]:
                deny(403, "MCP_EXT_SESSION_REVOKED")
            registry = service.registry_for(user, fence)
            server = server_row(registry, user, row["server_id"], row["server_revision"])
            conf = storage.get(row["owner"], row["server_id"])
            if (not conf or conf["revision"] != row["config_revision"] or
                conf["server_revision"] != row["server_revision"]):
                deny(409, "MCP_EXT_CONFIG_REVISION_CONFLICT")
            configuration = dict(conf)
            configuration["resource"] = server["url"]
            verifier = service.cipher_loader().decrypt(row["sealed_verifier"]).decode()
            token = await exchange(configuration, code, verifier,
                                   origin+USER_CALLBACK, service.cipher_loader())
            if getattr(fence.check(), "id", None) != row["owner"]:
                deny(403, "MCP_EXT_SESSION_REVOKED")
            saved = registry.mutate(row["owner"], row["server_id"], row["server_revision"],
                                    {"credential": token}, enabled=False)
            if not saved["credentialConfigured"] or saved["enabled"]:
                deny(503, "MCP_EXT_SAVE_UNVERIFIED")
            storage.bump(row["owner"], row["server_id"], row["config_revision"],
                         row["server_revision"], saved["revision"])
            return reply(True)
        except Exception:
            # Never expose provider messages or tokens; don't repeat uncertain exchanges.
            return reply(False)
    return router

def install(app):
    if getattr(app.state, "starli_account_mcp_external_installed", False):
        return
    from open_webui.utils.auth import get_verified_user
    from open_webui.routers.starli_session_fence import capture_request_fence
    service = app.state.starli_account_mcp_service
    app.include_router(create_router(service, get_verified_user, capture_request_fence),
                       prefix=PREFIX, tags=["starli-account-mcp-external-oauth"])
    app.state.starli_account_mcp_external_installed = True
