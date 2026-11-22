"""Staged guest intent intake, using Starli's existing signed cookie verifier.

Not a live mount. Never grants company authority. Database and secrets injected by ULTRA.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, NamedTuple
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictStr

COOKIE = "starli_guest"
SCHEMA_VERSION = 1
REQUEST_WINDOW = 300

class IntentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: StrictStr = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    originalPrompt: StrictStr = Field(min_length=1, max_length=4000)

def _utc(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")

def _reply(row: sqlite3.Row) -> dict:
    return json.loads(row["receipt"])


def _guest_binding(token: str, verify_cookie: Callable[[str], str], signing_key: bytes) -> str:
    """Authenticate only with Starli's native signed-cookie verification."""
    if not isinstance(signing_key, bytes) or len(signing_key) < 32:
        raise ValueError("A stable server-owned 32+ byte intent signing key is required")
    try:
        sid = verify_cookie(token)
    except Exception:
        raise HTTPException(403, "Valid native guest session required") from None
    if not isinstance(sid, str) or not sid:
        raise HTTPException(403, "Invalid guest session")
    return hmac.new(signing_key, b"guest-intent-binding-v1:" + sid.encode(), hashlib.sha256).hexdigest()


class VerifiedGuestIntent(NamedTuple):
    """Authority is the server-side lookup, not a client-submitted receipt."""
    receipt: dict
    verified_binding: str


def resolve_issued_guest_intent(
    *,
    request: Request,
    intent_id: str,
    verify_cookie: Callable[[str], str],
    signing_key: bytes,
    db_path: Path,
    now: Callable[[], float] = time.time,
) -> VerifiedGuestIntent:
    """Read-only mini2 -> mini3 issuer bridge, not an HTTP endpoint.

    The caller MUST pass the actual FastAPI Request and the native verifier.
    It never accepts receipt JSON, company ID, owner identity or guest binding
    supplied by a visitor. Only the database row originally issued by mini2
    may proceed, while the native signed guest session remains valid.
    """
    binding = _guest_binding(request.cookies.get(COOKIE, ""), verify_cookie, signing_key)
    if not isinstance(intent_id, str) or len(intent_id) != 40 or any(c not in "0123456789abcdef" for c in intent_id):
        raise HTTPException(404, "Intent unavailable")
    db_path = Path(db_path)
    # Fail closed without creating an empty DB or altering an existing record.
    try:
        connection = sqlite3.connect(db_path.absolute().as_uri() + "?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        raise HTTPException(503, "Guest intent issuer unavailable") from None
    try:
        connection.row_factory = sqlite3.Row
        revoked = connection.execute(
            "SELECT 1 FROM revoked_guest_bindings WHERE binding=?", (binding,)
        ).fetchone()
        if revoked:
            raise HTTPException(403, "Guest session rotated; open a new guest session")
        row = connection.execute(
            "SELECT * FROM guest_intents WHERE intent_id=? AND binding=? AND expires>?",
            (intent_id, binding, now()),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Intent unavailable")
        receipt = _reply(row)
        prompt = receipt.get("originalPrompt")
        valid = (
            receipt.get("schemaVersion") == SCHEMA_VERSION
            and receipt.get("status") == "PROPOSED"
            and receipt.get("intentId") == row["intent_id"]
            and receipt.get("guestSessionBinding") == binding
            and receipt.get("requestId") == row["request_id"]
            and receipt.get("idempotencyKey") == row["request_id"]
            and receipt.get("proposedCompanyName") is None
            and receipt.get("expectedRevision") == 0
            and isinstance(prompt, str)
            and bool(prompt.strip())
            and hmac.compare_digest(
                hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                row["digest"],
            )
            and receipt.get("expiresAt") == _utc(row["expires"])
        )
        if not valid:
            raise HTTPException(503, "Guest intent issuer integrity check failed")
        return VerifiedGuestIntent(receipt, binding)
    except (sqlite3.Error, ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(503, "Guest intent issuer unavailable") from None
    finally:
        connection.close()


def create_guest_intent_router(
    *,
    verify_cookie: Callable[[str], str],
    new_cookie: Callable[[], str],
    signing_key: bytes,
    db_path: Path,
    allowed_origins: set[str],
    ttl_seconds: int = 86400,
    session_limit: int = 12,
    ip_limit: int = 60,
    global_hour_limit: int = 500,
    now: Callable[[], float] = time.time,
) -> APIRouter:
    if not isinstance(signing_key, bytes) or len(signing_key) < 32:
        raise ValueError("Stable signing_key must contain at least 32 bytes")
    if not allowed_origins:
        raise ValueError("Explicit trusted web origins are required")
    if not (60 <= ttl_seconds <= 86400):
        raise ValueError("TTL must be between 60 and 86400 seconds")
    if min(session_limit, ip_limit, global_hour_limit) < 1:
        raise ValueError("Quota limits must be positive")
    allowed = set()
    for origin in allowed_origins:
        parsed = urlsplit(origin)
        if not parsed.scheme in ("https", "http") or not parsed.netloc or parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError("Origin must be a plain trusted origin")
        allowed.add(parsed.scheme + "://" + parsed.netloc)
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    router = APIRouter(prefix="/intents", tags=["staged-guest-intents"])

    @contextmanager
    def connect():
        connection = sqlite3.connect(str(db_path), timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=5000")
        connection.execute("CREATE TABLE IF NOT EXISTS guest_intents (intent_id TEXT PRIMARY KEY, binding TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, receipt TEXT NOT NULL, expires REAL NOT NULL, UNIQUE(binding,request_id))")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_guest_intents_binding ON guest_intents(binding,intent_id)")
        connection.execute("CREATE TABLE IF NOT EXISTS revoked_guest_bindings (binding TEXT PRIMARY KEY, revoked REAL NOT NULL)")
        connection.execute("CREATE TABLE IF NOT EXISTS guest_intent_limits (subject TEXT NOT NULL, bucket INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(subject,bucket))")
        # Wave3: issuer-bound audience is NOT a client-submitted or model field.
        connection.execute("CREATE TABLE IF NOT EXISTS guest_intent_audiences (intent_id TEXT PRIMARY KEY, audience TEXT NOT NULL CHECK (audience='provisional.bootstrap'))")
        # Server-only retirement state: original guest receipt is retained for policy/audit
        # until the coordinator's expiry/deletion policy, never converted to owner authority.
        connection.execute("CREATE TABLE IF NOT EXISTS guest_intent_retirements (intent_id TEXT PRIMARY KEY, binding TEXT NOT NULL, retired_at REAL NOT NULL, state TEXT NOT NULL CHECK(state IN ('CLAIMED','REVOKED')))")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def binding_for(request: Request) -> str:
        return _guest_binding(request.cookies.get(COOKIE, ""), verify_cookie, signing_key)

    def guard(request: Request) -> None:
        origins = request.headers.getlist("origin")
        csrf_values = request.headers.getlist("x-starli-guest-intent")
        if len(origins) != 1 or len(csrf_values) != 1 or len(request.headers.getlist("sec-fetch-site")) > 1:
            raise HTTPException(403, "Guest intent origin/CSRF/fetch-site header ambiguity")
        origin = origins[0]
        if origin not in allowed:
            raise HTTPException(403, "Disallowed or absent Origin")
        parsed = urlsplit(origin)
        if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise HTTPException(403, "Insecure origin")
        if request.headers.get("x-starli-guest-intent") != "1":
            raise HTTPException(403, "Missing guest intent CSRF header")
        site = request.headers.get("sec-fetch-site")
        if site and site not in ("same-origin", "same-site", "none"):
            raise HTTPException(403, "Cross-site request blocked")

    def limit(conn, subject: str, bucket: int, cap: int):
        found = conn.execute("SELECT used FROM guest_intent_limits WHERE subject=? AND bucket=?", (subject,bucket)).fetchone()
        if found and found["used"] >= cap:
            raise HTTPException(429, "Guest intent quota exceeded", headers={"Retry-After": "300"})
        conn.execute("INSERT INTO guest_intent_limits VALUES(?,?,1) ON CONFLICT(subject,bucket) DO UPDATE SET used=used+1", (subject,bucket))

    def not_revoked(conn, binding: str):
        if conn.execute("SELECT 1 FROM revoked_guest_bindings WHERE binding=?", (binding,)).fetchone():
            raise HTTPException(403, "Guest session rotated; open a new guest session")

    @router.post("", status_code=201)
    def submit(body: IntentInput, request: Request, response: Response):
        guard(request)
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            raise HTTPException(415, "JSON required")
        binding = binding_for(request)
        timestamp = now()
        digest = hashlib.sha256(body.originalPrompt.encode("utf-8")).hexdigest()
        with connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            not_revoked(conn,binding)
            existing = conn.execute("SELECT * FROM guest_intents WHERE binding=? AND request_id=?", (binding,body.requestId)).fetchone()
            if existing:
                if existing["digest"] != digest:
                    raise HTTPException(409, "Request ID already used for different content")
                if existing["expires"] <= timestamp:
                    raise HTTPException(404, "Intent expired")
                response.status_code = 200
                response.headers["Cache-Control"] = "no-store"
                return _reply(existing)
            bucket = int(timestamp) // REQUEST_WINDOW
            ip = request.client.host if request.client else "unknown"
            ip_binding = hmac.new(signing_key, b"ip:" + ip.encode(), hashlib.sha256).hexdigest()
            limit(conn, "guest:"+binding,bucket,session_limit)
            limit(conn, "ip:"+ip_binding,bucket,ip_limit)
            limit(conn, "global",int(timestamp)//3600,global_hour_limit)
            intent_id = secrets.token_hex(20)
            receipt = {
                "schemaVersion": SCHEMA_VERSION, "intentId": intent_id,
                "requestId": body.requestId, "guestSessionBinding":binding,
                "idempotencyKey":body.requestId, "originalPrompt":body.originalPrompt,
                "proposedCompanyName":None, "status":"PROPOSED",
                "createdAt":_utc(timestamp), "expiresAt":_utc(timestamp+ttl_seconds),
                "observedAt":_utc(timestamp), "producer":"mini-chatgpt2.stage",
                "traceId":secrets.token_hex(16), "expectedRevision":0,
            }
            conn.execute("INSERT INTO guest_intents VALUES(?,?,?,?,?,?)", (intent_id,binding,body.requestId,digest,json.dumps(receipt,separators=(",",":")),timestamp+ttl_seconds))
            conn.execute("INSERT INTO guest_intent_audiences VALUES(?,?)", (intent_id,"provisional.bootstrap"))
            conn.execute("DELETE FROM guest_intent_limits WHERE (subject='global' AND bucket<?) OR (subject!='global' AND bucket<?)", (int(timestamp)//3600-24,bucket-288))
            conn.commit()
        response.headers["Cache-Control"] = "no-store"
        return receipt

    @router.get("/{intent_id}")
    def get_intent(intent_id: str, request: Request, response: Response):
        issued = resolve_issued_guest_intent(
            request=request, intent_id=intent_id,
            verify_cookie=verify_cookie, signing_key=signing_key,
            db_path=db_path, now=now,
        )
        response.headers["Cache-Control"] = "no-store"
        return issued.receipt

    @router.post("/rotate")
    def rotate(request: Request,response: Response):
        guard(request)
        old_binding=binding_for(request)
        with connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            not_revoked(conn,old_binding)
            conn.execute("INSERT INTO revoked_guest_bindings VALUES(?,?)", (old_binding,now()))
            conn.commit()
        fresh=new_cookie()
        response.set_cookie(COOKIE,fresh,max_age=86400,httponly=True,samesite="lax",secure=request.headers["origin"].startswith("https://"),path="/api/v1/starli/public")
        response.headers["Cache-Control"]="no-store"
        return {"rotated":True,"schemaVersion":SCHEMA_VERSION}

    return router
