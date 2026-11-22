"""Native, account-scoped STARLI V3 agent directory for Open WebUI.

First production-adapter slice, intentionally behind STARLI_V3_NATIVE_ENABLED=1.
Never claims that creating an agent starts a paid autonomous process.
Durable local state uses a dedicated SQLite database, to be migrated to the
GB02 agent registry after the authenticated V3 service bridge is approved.
"""
from __future__ import annotations
import starli_portable as _portable

import asyncio
import json
import os
import stat
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, StrictBool

from open_webui.models.users import Users
from open_webui.utils.auth import get_verified_user

router = APIRouter()
_MAX_AGENTS = 100  # Configured safety cap for first release; not a product pricing decision.
_PILOT_FILE = Path(_portable.data_file('webui-v3/admin-beta.json'))

def _pilot_ids() -> set[str]:
    """Optional secure local admin-only pilot when root-managed service env is immutable.

    Disabled by default. Requires a small non-symlink 0600 JSON file in
    operator-owned private persistent state. Never enables customer users.
    """
    try:
        info = _PILOT_FILE.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 4096:
            return set()
        data = json.loads(_PILOT_FILE.read_text(encoding="utf-8"))
        values = data.get("admin_user_ids")
        if data.get("enabled") is not True or not isinstance(values, list) or len(values) > 10:
            return set()
        return {value for value in values if isinstance(value, str) and 1 <= len(value) <= 150}
    except (OSError, ValueError, TypeError):
        return set()

def _enabled() -> bool:
    return bool(_pilot_ids()) or os.getenv("STARLI_V3_NATIVE_ENABLED", "false").lower() in ("true", "1", "yes")

def _allowed(user) -> bool:
    role=user.get("role") if isinstance(user,dict) else getattr(user,"role",None)
    if role not in ("admin","user"):return False
    _owner(user)  # Validate linked identities and disabled source accounts.
    return True


def _ready(user):
    if not _allowed(user):
        raise HTTPException(status_code=503, detail="STARLI V3 is not enabled for this account")

def _mutation_guard(request: Request) -> None:
    """Cookie-based authentication alone is insufficient to authorize V3 state changes.

    The JWT/API credential must be supplied explicitly as a Bearer header.
    get_verified_user subsequently validates it against the actual Open WebUI account.
    """
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer ") or not auth[7:].strip():
        raise HTTPException(status_code=403, detail="Bearer authentication required for mutations")


def _owner(user) -> str:
    ident = user.get("id") if isinstance(user, dict) else getattr(user, "id", None)
    if not isinstance(ident, str) or not ident or len(ident) > 150:
        raise HTTPException(status_code=401, detail="Authenticated user required")
    subject = user.get("oauth_sub") if isinstance(user,dict) else getattr(user,"oauth_sub",None)
    if isinstance(subject,str) and subject.startswith("starli-node:"):
        node_id=subject[len("starli-node:"):]
        if not node_id or len(node_id)>150:
            raise HTTPException(403,"Customer identity unavailable")
        node=_node_user(node_id)
        email=user.get("email") if isinstance(user,dict) else getattr(user,"email",None)
        if node is None or node.get("disabled") is not False or node.get("role")!="USER" or node.get("email","").lower()!=str(email).lower():
            raise HTTPException(403,"Linked customer account is no longer valid")
        return ident
    return ident

def _node_database()->str:
    return os.getenv("STARLI_V3_NODE_DB",str(Path(_portable.platform_root()) / "server/data/starli.sqlite"))

def _node_user(node_id:str)->dict|None:
    try:
        with sqlite3.connect("file:"+_node_database()+"?mode=ro",uri=True,timeout=2) as db:
            row=db.execute("SELECT payload FROM users WHERE id=?",(node_id,)).fetchone()
            return json.loads(row[0]) if row else None
    except (sqlite3.Error,ValueError,TypeError,OSError):
        raise HTTPException(503,"Customer account authority unavailable") from None

def _path() -> Path:
    override = os.getenv("STARLI_V3_NATIVE_DB")
    # Persist outside versioned frontend/backend release directories.
    return Path(override) if override else Path(_portable.data_file('webui-v3/agents.sqlite'))

@contextmanager
def _db():
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    db = sqlite3.connect(str(path), timeout=5)
    path.chmod(0o600)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("""CREATE TABLE IF NOT EXISTS agents(
            id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('boss','persistent')),
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            instructions TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('IDLE','PAUSED')),
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            archived_at TEXT
        )""")
        columns={r[1] for r in db.execute("PRAGMA table_info(agents)")}
        for column in ("provider","model","avatar_color","avatar_shape"):
            if column not in columns:
                db.execute(f"ALTER TABLE agents ADD COLUMN {column} TEXT")
        if "platform_access" not in {r[1] for r in db.execute("PRAGMA table_info(agents)")}:
            db.execute("ALTER TABLE agents ADD COLUMN platform_access INTEGER NOT NULL DEFAULT 0")
        db.execute("CREATE INDEX IF NOT EXISTS agents_by_owner ON agents(owner, archived_at)")
        db.execute("""CREATE TABLE IF NOT EXISTS autonomous_steering(
            id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, agent_id TEXT NOT NULL,
            message TEXT NOT NULL, created_at TEXT NOT NULL, consumed_at TEXT
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS steering_pending ON autonomous_steering(owner,agent_id,consumed_at,id)")

        db.execute("""CREATE TABLE IF NOT EXISTS autonomous_sessions(
            owner TEXT NOT NULL, agent_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
            task_id TEXT, updated_at TEXT NOT NULL,
            cycles INTEGER NOT NULL DEFAULT 0, objective TEXT NOT NULL DEFAULT '',
            PRIMARY KEY(owner,agent_id)
        )""")
        session_columns={r[1] for r in db.execute("PRAGMA table_info(autonomous_sessions)")}
        if "cycles" not in session_columns:
            db.execute("ALTER TABLE autonomous_sessions ADD COLUMN cycles INTEGER NOT NULL DEFAULT 0")
        if "objective" not in session_columns:
            db.execute("ALTER TABLE autonomous_sessions ADD COLUMN objective TEXT NOT NULL DEFAULT ''")
        db.execute("""CREATE TABLE IF NOT EXISTS events(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS events_by_owner ON events(owner,id)")
        db.execute("""CREATE TABLE IF NOT EXISTS agent_conversations(
            owner TEXT NOT NULL, agent_id TEXT NOT NULL, chat_id TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            PRIMARY KEY(owner,agent_id), UNIQUE(owner,chat_id)
        )""")
        db.commit()
        yield db
    finally:
        db.close()

def _utc() -> str:
    return datetime.now(timezone.utc).isoformat()

def _public(row) -> dict:
    return {
        "id": row["id"], "kind": row["kind"], "name": row["name"],
        "role": row["role"], "instructions": row["instructions"],
        "status": row["status"], "version": row["version"],
        "provider": row["provider"] or ("openrouter" if row["kind"]=="boss" else "hosted"),
        "model": row["model"] or _provider_default_model(row["provider"] or ("openrouter" if row["kind"]=="boss" else "hosted")),
        "platformAccess":bool(row["platform_access"]),"avatarColor": row["avatar_color"], "avatarShape": row["avatar_shape"],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"]
    }

def _emit(db, owner: str, ident: str, event_type: str, data: dict):
    db.execute(
        "INSERT INTO events(owner,entity_id,type,payload,created_at) VALUES(?,?,?,?,?)",
        (owner,ident,event_type,json.dumps(data,ensure_ascii=False),_utc())
    )

def _boss(db, owner: str):
    ident = "boss:" + owner
    row = db.execute("SELECT * FROM agents WHERE id=? AND owner=?", (ident,owner)).fetchone()
    if row:
        return row
    now = _utc()
    db.execute(
        "INSERT OR IGNORE INTO agents(id,owner,kind,name,role,instructions,status,version,created_at,updated_at) "
        "VALUES(?,?,'boss','STARLI BOSS','Coordinator','','IDLE',1,?,?)",
        (ident,owner,now,now)
    )
    row = db.execute("SELECT * FROM agents WHERE id=? AND owner=?", (ident,owner)).fetchone()
    if db.execute("SELECT COUNT(*) FROM events WHERE owner=? AND entity_id=? AND type='agent.created'",(owner,ident)).fetchone()[0] == 0:
        _emit(db, owner, ident, "agent.created", {"id":ident,"kind":"boss"})
    return row

def _get(db, owner, agent_id):
    row = db.execute(
        "SELECT * FROM agents WHERE id=? AND owner=? AND archived_at IS NULL",
        (agent_id,owner)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Starli not found")
    return row

def owned_live_chat(user,chat_id):
    """Only a persisted, unarchived native conversation belonging to this account."""
    from open_webui.models.chats import Chats
    owner=_owner(user)
    ident=user.get("id") if isinstance(user,dict) else getattr(user,"id",None)
    if not isinstance(chat_id,str) or not 1<=len(chat_id)<=150:
        raise HTTPException(404,"Conversation not found")
    chat=Chats.get_chat_by_id_and_user_id(chat_id,ident)
    value=(lambda key:chat.get(key)) if isinstance(chat,dict) else (lambda key:getattr(chat,key,None))
    if chat is None or value("id")!=chat_id or value("user_id")!=ident or value("archived"):
        raise HTTPException(404,"Conversation not found")
    return chat


def ensure_chat_agent(user,chat_id):
    """Bind metadata once for an owned live chat. Never starts work or revives agents."""
    _ready(user)
    owned_live_chat(user,chat_id)
    owner=_owner(user)
    with _db() as registry:
        registry.execute("BEGIN IMMEDIATE")
        # Recheck after acquiring the registry lock, including a deletion/archive race.
        owned_live_chat(user,chat_id)
        binding=registry.execute(
            "SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",
            (owner,chat_id)).fetchone()
        if binding:
            # An archived/missing/foreign bound agent is an error, never a reason to replace it.
            _get(registry,owner,binding["agent_id"])
            return binding["agent_id"]
        agent_id="chat:"+chat_id
        existing=registry.execute("SELECT owner,archived_at FROM agents WHERE id=?",(agent_id,)).fetchone()
        if existing:
            if existing["owner"]!=owner:raise HTTPException(404,"Starli not found")
            raise HTTPException(409,"This conversation's project agent already exists without an active binding; restore it or start a new conversation")
        count=registry.execute(
            "SELECT count(*) FROM agents WHERE owner=? AND archived_at IS NULL",(owner,)).fetchone()[0]
        if count>=_MAX_AGENTS:
            raise HTTPException(429,"Archive an unused project agent before starting another")
        stamp=_utc()
        registry.execute(
            "INSERT INTO agents(id,owner,kind,name,role,instructions,status,version,created_at,updated_at,provider,model) "
            "VALUES(?,?,'persistent','STARLI','Customer project agent',?,'IDLE',1,?,?,'account','account-default')",
            (agent_id,owner,"Work only on the current customer objective using real tools.",stamp,stamp))
        registry.execute("INSERT INTO agent_conversations VALUES(?,?,?,?,?)",(owner,agent_id,chat_id,stamp,stamp))
        _emit(registry,owner,agent_id,"agent.created",{"id":agent_id,"chatId":chat_id,"name":"STARLI"})
        registry.commit()
        return agent_id

def _version(row, expected):
    if expected is not None and row["version"] != expected:
        raise HTTPException(status_code=409, detail="Agent changed in another tab. Refresh and retry.")

def _configured_hosted_models():
    """Exact operator-owned model IDs only; no caller paths or remote catalog trust."""
    import os
    result = []
    for scope in ("BOSS", "AGENT"):
        if os.environ.get(f"STARLI_{scope}_PROVIDER", "").strip().lower() != "selfhosted":
            continue
        model = os.environ.get(f"STARLI_{scope}_MODEL", "")
        if (model and len(model) <= 160 and "://" not in model
                and not any(ord(char) < 32 or ord(char) == 127 for char in model)
                and model not in result):
            result.append(model)
    return result

def _hosted_default_model():
    configured = _configured_hosted_models()
    return configured[0] if configured else "starli-coder"

def _provider_default_model(provider):
    return _hosted_default_model() if provider == "hosted" else "account-default" if provider == "account" else "anthropic/claude-haiku-5.5"

def _agent_provider_model(provider, requested_model=None, *, prior_provider=None, prior_model=None):
    missing = (None, "", "account-default") if provider == "hosted" else (None, "")
    if requested_model not in missing:
        return requested_model
    if prior_provider == provider and prior_model not in missing:
        return prior_model
    return _provider_default_model(provider)

def _hosted_provider_info():
    import os
    labels = {"starli-coder":"Legacy hosted coder", "glm-4.7":"GLM-4.7", "qwen3-coder-480b":"Qwen3-Coder-480B-A35B-Instruct"}
    models = list(dict.fromkeys([*_configured_hosted_models(), *labels]))
    return {"id":"hosted", "name":"Self-hosted inference",
            "authenticated":bool(os.getenv("STARLI_INFERENCE_API_KEY")),
            "configured":bool(os.getenv("STARLI_INFERENCE_BASE_URL")),
            "defaultModel":_hosted_default_model(),
            "models":[{"id":model,"name":labels.get(model,"Configured hosted model")} for model in models]}

def _validate_provider(provider, model):
    if provider == "hosted" and (not isinstance(model, str) or model not in {"starli-coder", "glm-4.7", "qwen3-coder-480b", *_configured_hosted_models()}):
        raise HTTPException(422, "Unsupported self-hosted model")

class CreateAgent(BaseModel):
    avatarColor: Optional[str] = Field(default=None,pattern=r"^#[0-9a-fA-F]{6}$")
    avatarShape: Optional[str] = Field(default=None,max_length=4)
    name: str = Field(min_length=2,max_length=80)
    role: str = Field(default="Generalist",min_length=2,max_length=120)
    instructions: str = Field(default="",max_length=5000)
    provider: Literal["account","hosted","openrouter"] = "account"
    model: str = Field(default="account-default",min_length=2,max_length=160)

class UpdateAgent(BaseModel):
    avatarColor: Optional[str] = Field(default=None,pattern=r"^#[0-9a-fA-F]{6}$")
    avatarShape: Optional[str] = Field(default=None,max_length=4)
    name: Optional[str] = Field(default=None,min_length=2,max_length=80)
    role: Optional[str] = Field(default=None,min_length=2,max_length=120)
    instructions: Optional[str] = Field(default=None,max_length=5000)
    provider: Optional[Literal["account","hosted","openrouter"]] = None
    model: Optional[str] = Field(default=None,min_length=2,max_length=160)
    status: Optional[Literal["IDLE","PAUSED"]] = None
    expectedVersion: int = Field(ge=1)

class CloneAgent(BaseModel):
    name: str = Field(min_length=2,max_length=80)
    expectedVersion: int = Field(ge=1)

@router.get("/config")
def config(user=Depends(get_verified_user)):
    _owner(user)
    return {"enabled":_allowed(user),"persistence":"account-scoped","execution":"AVAILABLE","providerVerification":"Check account provider connection before running paid tasks"}

@router.get("/providers")
def list_providers(user=Depends(get_verified_user)):
    _ready(user)
    return {"items":[
        _hosted_provider_info(),
        {"id":"openrouter","name":"OpenRouter","authenticated":bool(os.getenv("OPENROUTER_API_KEY") or os.getenv("STARLI_OPENROUTER_API_KEY")),"models":[{"id":"anthropic/claude-haiku-5.5","name":"Claude Haiku 5.5"}]}
    ]}

@router.get("/agents")
def list_agents(user=Depends(get_verified_user)):
    _ready(user)
    owner = _owner(user)
    with _db() as db:
        db.execute("BEGIN IMMEDIATE")
        _boss(db, owner)
        db.commit()
        rows = db.execute(
            "SELECT * FROM agents WHERE owner=? AND archived_at IS NULL ORDER BY CASE kind WHEN 'boss' THEN 0 ELSE 1 END,created_at,id",
            (owner,)
        ).fetchall()
        last = db.execute("SELECT COALESCE(MAX(id),0) AS cursor FROM events WHERE owner=?",(owner,)).fetchone()["cursor"]
        mappings={r["agent_id"]:r["chat_id"] for r in db.execute("SELECT agent_id,chat_id FROM agent_conversations WHERE owner=?",(owner,)).fetchall()}
        sessions={r["agent_id"]:dict(r) for r in db.execute("SELECT agent_id,enabled,task_id,cycles FROM autonomous_sessions WHERE owner=?",(owner,)).fetchall()}
        from open_webui.models.chats import Chats
        items=[]
        for row in rows:
            item={**_public(row),"chatId":mappings.get(row["id"]),"lastActivity":None,"lastMessageAt":None}
            session=sessions.get(row["id"],{})
            item["autonomousEnabled"]=bool(session.get("enabled"))
            item["autonomousTaskId"]=session.get("task_id")
            item["autonomousCycles"]=session.get("cycles",0)
            if item["chatId"]:
                chat=Chats.get_chat_by_id_and_user_id(item["chatId"],user.id)
                if chat:
                    item["lastMessageAt"]=chat.updated_at
                    messages=chat.chat.get("messages",[]) if isinstance(chat.chat,dict) else []
                    for message in reversed(messages[-20:]):
                        content=message.get("content") if isinstance(message,dict) else None
                        if isinstance(content,str) and content.strip():
                            item["lastActivity"]=content.strip().replace("\n"," ")[:120]
                            break
                else:
                    item["chatId"]=None
            items.append(item)
        return {"items":items,"cursor":last}

@router.get("/agents/{agent_id}")
def get_agent(agent_id:str,user=Depends(get_verified_user)):
    _ready(user)
    owner = _owner(user)
    with _db() as db:
        return _public(_get(db,owner,agent_id))

@router.post("/agents",status_code=201)
def create_agent(body:CreateAgent,user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    _ready(user)
    owner = _owner(user)
    model = _agent_provider_model(body.provider, body.model)
    _validate_provider(body.provider,model)
    with _db() as db:
        db.execute("BEGIN IMMEDIATE")
        count = db.execute(
            "SELECT COUNT(*) AS count FROM agents WHERE owner=? AND archived_at IS NULL AND kind='persistent'",
            (owner,)
        ).fetchone()["count"]
        if count >= _MAX_AGENTS:
            raise HTTPException(status_code=429,detail="Temporary workspace capacity reached")
        ident = str(uuid.uuid4())
        now = _utc()
        db.execute(
            "INSERT INTO agents(id,owner,kind,name,role,instructions,status,version,created_at,updated_at,provider,model,avatar_color,avatar_shape) "
            "VALUES(?,?,'persistent',?,?,?,'IDLE',1,?,?,?,?,?,?)",
            (ident,owner,body.name.strip(),body.role.strip(),body.instructions,now,now,body.provider,model,body.avatarColor,body.avatarShape)
        )
        _emit(db,owner,ident,"agent.created",{"id":ident,"name":body.name.strip()})
        db.commit()
        return _public(_get(db,owner,ident))

@router.post("/agents/{agent_id}/clone",status_code=201)
def clone_agent(agent_id:str,body:CloneAgent,user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    _ready(user)
    owner = _owner(user)
    with _db() as db:
        db.execute("BEGIN IMMEDIATE")
        source = _get(db,owner,agent_id)
        if source["kind"] == "boss":
            raise HTTPException(status_code=409, detail="STARLI BOSS cannot be cloned")
        _version(source,body.expectedVersion)
        count = db.execute(
            "SELECT COUNT(*) AS count FROM agents WHERE owner=? AND archived_at IS NULL AND kind='persistent'",(owner,)
        ).fetchone()["count"]
        if count >= _MAX_AGENTS:
            raise HTTPException(status_code=429,detail="Temporary workspace capacity reached")
        ident = str(uuid.uuid4())
        now = _utc()
        db.execute(
            "INSERT INTO agents(id,owner,kind,name,role,instructions,status,version,created_at,updated_at) "
            "VALUES(?,?,'persistent',?,?,?,'IDLE',1,?,?)",
            (ident,owner,body.name.strip(),source["role"],source["instructions"],now,now)
        )
        db.execute("UPDATE agents SET provider=?,model=?,avatar_color=?,avatar_shape=? WHERE id=? AND owner=?",
            (source["provider"],source["model"],source["avatar_color"],source["avatar_shape"],ident,owner))
        _emit(db,owner,ident,"agent.cloned",{"id":ident,"name":body.name.strip()})
        db.commit()
        return _public(_get(db,owner,ident))

@router.patch("/agents/{agent_id}")
def update_agent(agent_id:str,body:UpdateAgent,user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    _ready(user)
    owner = _owner(user)
    with _db() as db:
        db.execute("BEGIN IMMEDIATE")
        row = _get(db,owner,agent_id)
        _version(row,body.expectedVersion)
        if row["kind"] == "boss" and body.status == "PAUSED":
            raise HTTPException(status_code=409,detail="STARLI BOSS cannot be paused")
        name = body.name.strip() if body.name is not None else row["name"]
        role = body.role.strip() if body.role is not None else row["role"]
        instructions = body.instructions if body.instructions is not None else row["instructions"]
        status = body.status if body.status is not None else row["status"]
        provider = body.provider or row["provider"] or ("openrouter" if row["kind"]=="boss" else "hosted")
        model = _agent_provider_model(provider, body.model, prior_provider=row["provider"] or ("openrouter" if row["kind"]=="boss" else "hosted"), prior_model=row["model"])
        _validate_provider(provider,model)
        db.execute(
            "UPDATE agents SET name=?,role=?,instructions=?,status=?,provider=?,model=?,avatar_color=?,avatar_shape=?,version=version+1,updated_at=? "
            "WHERE id=? AND owner=? AND version=?",
            (name,role,instructions,status,provider,model,body.avatarColor if body.avatarColor is not None else row["avatar_color"],body.avatarShape if body.avatarShape is not None else row["avatar_shape"],_utc(),agent_id,owner,body.expectedVersion)
        )
        _emit(db,owner,agent_id,"agent.updated",{"id":agent_id,"status":status,"name":name})
        db.commit()
        return _public(_get(db,owner,agent_id))

@router.delete("/agents/{agent_id}")
def archive_agent(agent_id:str,expectedVersion:int=Query(ge=1),user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    _ready(user)
    owner = _owner(user)
    with _db() as db:
        db.execute("BEGIN IMMEDIATE")
        row = _get(db,owner,agent_id)
        _version(row,expectedVersion)
        if row["kind"] == "boss":
            raise HTTPException(status_code=409,detail="STARLI BOSS cannot be archived")
        db.execute(
            "UPDATE agents SET archived_at=?,updated_at=?,version=version+1 WHERE id=? AND owner=? AND version=?",
            (_utc(),_utc(),agent_id,owner,expectedVersion)
        )
        _emit(db,owner,agent_id,"agent.archived",{"id":agent_id})
        db.commit()
        return {"ok":True,"id":agent_id}

def _events(owner:str,after:int,limit:int=100)->list:
    with _db() as db:
        rows=db.execute(
            "SELECT id,entity_id,type,payload,created_at FROM events WHERE owner=? AND id>? ORDER BY id LIMIT ?",
            (owner,after,limit)
        ).fetchall()
        return [{"id":r["id"],"entityId":r["entity_id"],"type":r["type"],
                 "payload":json.loads(r["payload"]),"createdAt":r["created_at"]} for r in rows]

@router.get("/events")
def list_events(after:int=Query(default=0,ge=0),user=Depends(get_verified_user)):
    _ready(user)
    owner = _owner(user)
    return {"items":_events(owner,after)}

@router.get("/events/stream")
async def event_stream(request:Request,after:int=Query(default=0,ge=0),user=Depends(get_verified_user)):
    _ready(user)
    owner = _owner(user)
    from open_webui.routers.starli_session_fence import capture_request_fence
    session_fence=capture_request_fence(request,user)
    webui_id = user.get("id") if isinstance(user,dict) else getattr(user,"id",None)
    async def generate():
        cursor = after
        end = time.monotonic()+40
        while time.monotonic()<end:
            try:session_fence.check()
            except HTTPException:break
            # Check both authenticated Open WebUI account and external Node link.
            account = await asyncio.to_thread(Users.get_user_by_id, webui_id)
            if account is None or account.role not in ("user", "admin"):
                break
            try:
                valid = await asyncio.to_thread(_owner, account)
            except HTTPException:
                break
            if valid != owner:
                break
            events = await asyncio.to_thread(_events,owner,cursor)
            for event in events:
                try:session_fence.check()
                except HTTPException:return
                cursor = max(cursor,event["id"])
                yield "id: "+str(event["id"])+"\ndata: "+json.dumps(event,ensure_ascii=False)+"\n\n"
            if not events:
                yield ": heartbeat\n\n"
            await asyncio.sleep(1)
    return StreamingResponse(generate(),media_type="text/event-stream",
                             headers={"Cache-Control":"no-store","X-Accel-Buffering":"no"})

@router.get("/customer/projects")
def linked_customer_projects(user=Depends(get_verified_user)):
    """Read only. Show projects strictly owned by a verified Node customer link."""
    _ready(user)
    subject=user.get("oauth_sub") if isinstance(user,dict) else getattr(user,"oauth_sub",None)
    if not isinstance(subject,str) or not subject.startswith("starli-node:"):
        raise HTTPException(403,"Linked customer account required")
    owner=_owner(user)
    allowed=("id","name","status","lifecycle","buildState","publishState","previewState",
             "deploymentStatus","updatedAt","deploymentUrl","previewUrl","publicVerified")
    with sqlite3.connect("file:"+_node_database()+"?mode=ro",uri=True,timeout=3) as db:
        rows=db.execute("SELECT payload FROM records WHERE collection='projects' AND owner=? LIMIT 100",(owner,)).fetchall()
    projects=[]
    for (payload,) in rows:
        try:row=json.loads(payload)
        except (TypeError,ValueError):continue
        if row.get("ownerId")!=owner:continue
        data={key:row.get(key) for key in allowed}
        for field in ("deploymentUrl","previewUrl"):
            url=data.get(field)
            if not isinstance(url,str) or not url.startswith("https://") or any(c in url for c in ("@", "\\", "\n", "\r")):
                data[field]=None
        projects.append(data)
    projects.sort(key=lambda p:p.get("updatedAt") or "",reverse=True)
    return {"items":projects,"readOnly":True,"customerId":owner}


class BindConversation(BaseModel):
    chatId: str = Field(min_length=8,max_length=150)

@router.get("/agents/{agent_id}/conversation")
def agent_conversation(agent_id:str,user=Depends(get_verified_user)):
    _ready(user)
    owner=_owner(user)
    with _db() as db:
        _get(db,owner,agent_id)
        row=db.execute("SELECT chat_id FROM agent_conversations WHERE owner=? AND agent_id=?",(owner,agent_id)).fetchone()
        return {"agentId":agent_id,"chatId":row["chat_id"] if row else None}

@router.put("/agents/{agent_id}/conversation")
def bind_agent_conversation(agent_id:str,body:BindConversation,user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    _ready(user)
    owner=_owner(user)
    # The chat must exist and belong to this authenticated Open WebUI account.
    from open_webui.models.chats import Chats
    chat=Chats.get_chat_by_id_and_user_id(body.chatId,user.id)
    if chat is None:
        raise HTTPException(404,"Conversation not found for this account")
    with _db() as db:
        db.execute("BEGIN IMMEDIATE")
        _get(db,owner,agent_id)
        existing=db.execute("SELECT chat_id FROM agent_conversations WHERE owner=? AND agent_id=?",(owner,agent_id)).fetchone()
        if existing and existing["chat_id"]!=body.chatId:
            raise HTTPException(409,"This Starli already has a conversation")
        try:
            db.execute("INSERT INTO agent_conversations(owner,agent_id,chat_id,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner,agent_id) DO NOTHING",(owner,agent_id,body.chatId,_utc(),_utc()))
        except sqlite3.IntegrityError:
            raise HTTPException(409,"Conversation already assigned to another Starli")
        db.commit()
        return {"agentId":agent_id,"chatId":body.chatId}


@router.get("/agent-messages")
def agent_message_feed(limit:int=Query(default=100,ge=1,le=200),user=Depends(get_verified_user)):
    """Account-scoped, read-only inter-Starli transcript feed."""
    _ready(user)
    owner=_owner(user)
    with _db() as db:
        exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_message_routes'").fetchone()
        if not exists:return {"items":[],"total":0}
        rows=db.execute("SELECT id,source_agent_id,target_agent_id,request,response,created_at FROM agent_message_routes WHERE owner=? ORDER BY created_at DESC,id DESC LIMIT ?",(owner,limit)).fetchall()
        ids={r["source_agent_id"] for r in rows}|{r["target_agent_id"] for r in rows}
        names={}
        for ident in ids:
            row=db.execute("SELECT name FROM agents WHERE owner=? AND id=?",(owner,ident)).fetchone()
            names[ident]=row["name"] if row else "Archived Starli"
    return {"items":[{"id":r["id"],"fromAgentId":r["source_agent_id"],"fromName":names[r["source_agent_id"]],"toAgentId":r["target_agent_id"],"toName":names[r["target_agent_id"]],"message":r["request"],"reply":r["response"],"createdAt":r["created_at"]} for r in rows]}


class SendAgentMessage(BaseModel):
    message:str=Field(min_length=1,max_length=4000)
    fromAgentId:Optional[str]=None
    # Resolve the sender from an owner-scoped conversation instead of trusting
    # a stale browser selection when the operator addresses another Starli.
    fromChatId:Optional[str]=Field(default=None,min_length=8,max_length=150)
    idempotencyKey:Optional[str]=Field(default=None,min_length=8,max_length=160)

@router.get("/agents/{agent_id}/messages")
def agent_thread(agent_id:str,limit:int=Query(default=100,ge=1,le=200),user=Depends(get_verified_user)):
    _ready(user)
    owner=_owner(user)
    with _db() as db:
        _get(db,owner,agent_id)
        exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_message_routes'").fetchone()
        if not exists:return {"items":[]}
        rows=db.execute("SELECT id,source_agent_id,target_agent_id,request,response,created_at FROM agent_message_routes WHERE owner=? AND (source_agent_id=? OR target_agent_id=?) ORDER BY created_at DESC,id DESC LIMIT ?",(owner,agent_id,agent_id,limit)).fetchall()
        ids={r['source_agent_id'] for r in rows}|{r['target_agent_id'] for r in rows}
        names={}
        for ident in ids:
            a=db.execute("SELECT name FROM agents WHERE owner=? AND id=?",(owner,ident)).fetchone()
            names[ident]=a['name'] if a else 'Archived Starli'
    messages=[]
    for r in reversed(rows):
        messages.extend([{'id':r['id']+':request','senderId':r['source_agent_id'],'senderName':names[r['source_agent_id']],'recipientId':r['target_agent_id'],'body':r['request'],'createdAt':r['created_at']},{'id':r['id']+':reply','senderId':r['target_agent_id'],'senderName':names[r['target_agent_id']],'recipientId':r['source_agent_id'],'body':r['response'],'createdAt':r['created_at']}])
    return {'items':messages}

@router.post("/agents/{agent_id}/messages")
async def send_agent_message(agent_id:str,body:SendAgentMessage,user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    _ready(user)
    owner=_owner(user)
    sender=body.fromAgentId or 'boss:'+owner
    if body.fromChatId:
        with _db() as db:
            row=db.execute(
                "SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",
                (owner,body.fromChatId)
            ).fetchone()
            if row is None:
                raise HTTPException(404,"Sending Starli conversation not found")
            if body.fromAgentId and body.fromAgentId!=row["agent_id"]:
                raise HTTPException(409,"Sender does not match the bound conversation")
            sender=row["agent_id"]
    from open_webui.routers.starli_pi_master import _tool
    result=await _tool(user,'starlis.message',{'fromAgentId':sender,'agentId':agent_id,'message':body.message},body.idempotencyKey or uuid.uuid4().hex)
    if result.get('error'):raise HTTPException(422,result['error'])
    return result

class ChatSteerCommand(BaseModel):
    message: str = Field(min_length=1,max_length=4000)

@router.post("/chats/{chat_id}/steer")
def steer_chat(chat_id:str,body:ChatSteerCommand,user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    """Durable steering instruction, scoped to the authenticated user's bound active agent."""
    _ready(user)
    owner=_owner(user)
    with _db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        binding=connection.execute("SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()
        if not binding:raise HTTPException(404,"No Starli agent bound to this chat")
        session=connection.execute("SELECT enabled,task_id FROM autonomous_sessions WHERE owner=? AND agent_id=?",(owner,binding['agent_id'])).fetchone()
        if not session or not session['enabled']:raise HTTPException(409,"Autonomous mode is not active")
        pending=connection.execute("SELECT count(*) FROM autonomous_steering WHERE owner=? AND agent_id=? AND consumed_at IS NULL",(owner,binding['agent_id'])).fetchone()[0]
        if pending>=30:raise HTTPException(429,"Steering queue full")
        cursor=connection.execute("INSERT INTO autonomous_steering(owner,agent_id,message,created_at) VALUES(?,?,?,?)",(owner,binding['agent_id'],body.message.strip(),_utc()))
        connection.commit()
    # Display the user instruction in the existing native conversation.
    try:
        from open_webui.routers.starli_runtime_adapter import _append_native_execution_message
        _append_native_execution_message(owner,chat_id,binding['agent_id'],'steering_queued','',body.message.strip(),{})
    except Exception:
        import logging
        logging.getLogger(__name__).exception('Could not display queued steering message')
    return {"queued":True,"steeringId":cursor.lastrowid,"taskId":session['task_id'],"delivery":"next_tool_boundary_or_cycle"}

class ChatAutoCommand(BaseModel):
    enabled: bool
    objective: str = Field(default="",max_length=4000)


@router.post("/chats/{chat_id}/autonomous-mode")
async def chat_autonomous_mode(chat_id:str,body:ChatAutoCommand,user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    """Enable work in an owned live chat, lazily binding only when explicitly enabled."""
    _ready(user)
    owner=_owner(user)
    if body.enabled:
        agent_id=ensure_chat_agent(user,chat_id)
    else:
        owned_live_chat(user,chat_id)
        with _db() as connection:
            binding=connection.execute(
                "SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",
                (owner,chat_id)).fetchone()
        if not binding:
            return {"chatId":chat_id,"agentId":None,"bound":False,"enabled":False,"taskId":None}
        agent_id=binding["agent_id"]
    result=await set_autonomous_mode(agent_id,AutonomousModeRequest(enabled=body.enabled,objective=body.objective),user,guard)
    return {"chatId":chat_id,"agentId":agent_id,"bound":True,**result}


@router.get("/chats/{chat_id}/execution-feed")
def chat_execution_feed(chat_id:str,user=Depends(get_verified_user)):
    """Chat-bound execution feed. Owner scoped; safe trace metadata only."""
    _ready(user)
    owner=_owner(user)
    with _db() as connection:
        binding=connection.execute(
            "SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",
            (owner,chat_id)).fetchone()
    if not binding:return {"bound":False,"events":[]}
    agent_id=binding["agent_id"]
    with _db() as connection:
        session=connection.execute(
            "SELECT task_id,enabled,cycles,objective FROM autonomous_sessions WHERE owner=? AND agent_id=?",
            (owner,agent_id)).fetchone()
        agent=_get(connection,owner,agent_id)
    from open_webui.routers.starli_tool_trace import recent
    events=recent(owner,chat_id=chat_id,limit=50)
    task=None
    if session and session["task_id"]:
        from open_webui.routers.starli_runtime_adapter import db as task_db
        with task_db() as connection:
            record=connection.execute("SELECT payload FROM tasks WHERE id=? AND owner=?",
                (session["task_id"],owner)).fetchone()
        if record:task=json.loads(record[0])
        events+=recent(owner,task_id=session["task_id"],limit=50)
    events=sorted({e["id"]:e for e in events}.values(),key=lambda e:e["timestamp"])[-60:]
    return {"bound":True,"agentId":agent_id,"agentName":agent["name"],
            "enabled":bool(session["enabled"]) if session else False,
            "objective":session["objective"] if session else "",
            "cycles":session["cycles"] if session else 0,
            "taskId":session["task_id"] if session else None,
            "status":task.get("status") if task else "IDLE",
            "progress":str(task.get("progress",""))[:1000] if task else "",
            "events":events}

@router.get("/agents/{agent_id}/autonomous-activity")
def autonomous_activity(agent_id:str,user=Depends(get_verified_user)):
    """Owner-scoped live task state; polling does not trigger execution."""
    _ready(user)
    owner=_owner(user)
    with _db() as connection:
        _get(connection,owner,agent_id)
        session=connection.execute(
            "SELECT enabled,task_id,cycles,objective,updated_at FROM autonomous_sessions WHERE owner=? AND agent_id=?",
            (owner,agent_id)).fetchone()
    if not session:
        return {"enabled":False,"status":"NOT_STARTED","receipts":[]}
    from open_webui.routers.starli_runtime_adapter import db as task_db
    task=None
    if session["task_id"]:
        with task_db() as connection:
            row=connection.execute("SELECT payload FROM tasks WHERE id=? AND owner=?",
                (session["task_id"],owner)).fetchone()
        if row:task=json.loads(row[0])
    return {"enabled":bool(session["enabled"]),"cycles":session["cycles"],
            "objective":session["objective"],"taskId":session["task_id"],
            "status":task.get("status","UNKNOWN") if task else "NOT_STARTED",
            "progress":str(task.get("progress",""))[:4000] if task else "",
            "stepsCompleted":task.get("stepsCompleted",0) if task else 0,
            "checkpoint":task.get("checkpoint") if task else None,
            "receipts":(task.get("receipts",[]) or [])[-12:] if task else [],
            "updatedAt":session["updated_at"]}

def _agent_conversation_messages(owner: str, agent_id: str) -> list[dict]:
    """Canonical native OpenWebUI chat history, oldest to newest, owner scoped."""
    from open_webui.models.chats import Chats
    with _db() as connection:
        binding=connection.execute(
            "SELECT chat_id FROM agent_conversations WHERE owner=? AND agent_id=?",
            (owner,agent_id)).fetchone()
    if not binding:return []
    chat=Chats.get_chat_by_id_and_user_id(binding["chat_id"],owner)
    if not chat or not isinstance(chat.chat,dict):return []
    doc=chat.chat
    history=doc.get("history") if isinstance(doc.get("history"),dict) else {}
    messages=history.get("messages") if isinstance(history.get("messages"),dict) else {}
    ordered=[]
    current=history.get("currentId")
    visited=set()
    while current and current not in visited:
        visited.add(current)
        item=messages.get(current)
        if not isinstance(item,dict):break
        ordered.append(item)
        current=item.get("parentId")
    ordered.reverse()
    if not ordered:
        ordered=doc.get("messages",[]) if isinstance(doc.get("messages"),list) else []
    result=[]
    for item in ordered:
        if not isinstance(item,dict) or item.get("role") not in ("user","assistant"):continue
        content=item.get("content")
        if not isinstance(content,str) or not content.strip():continue
        speaker=str(item.get("senderName") or item.get("role"))[:80]
        result.append({"role":item["role"],"content":f"[{speaker}] "+content})
    return result


def _agent_conversation_context(owner: str, agent_id: str) -> str:
    """Compatibility preview only; execution uses canonical structured messages."""
    messages=_agent_conversation_messages(owner,agent_id)
    return "\n".join(m["content"] for m in messages[-8:])[-3000:] or "No conversation messages yet."

class AutonomousModeRequest(BaseModel):
    enabled: bool
    objective: str = Field(default="",max_length=4000)

@router.post("/agents/{agent_id}/autonomous-mode")
async def set_autonomous_mode(agent_id:str,body:AutonomousModeRequest,user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    """Persist per-agent preference; launch one auditable bounded task, not an endless unreviewed loop."""
    _ready(user)
    owner=_owner(user)
    with _db() as db:
        agent=dict(_get(db,owner,agent_id))
        existing=db.execute("SELECT enabled,task_id,cycles,objective FROM autonomous_sessions WHERE owner=? AND agent_id=?",(owner,agent_id)).fetchone()
    if body.enabled and existing and existing["enabled"]:
        return {"enabled":True,"taskId":existing["task_id"]}
    objective=body.objective.strip()
    if body.enabled and not objective:
        recent=_agent_conversation_messages(owner,agent_id)
        objective=next((m["content"] for m in reversed(recent) if m["role"]=="user" and not m["content"].lower().startswith("[user] /auto")),"")
        if not objective:raise HTTPException(409,"Send a concrete customer project goal before starting autonomous work")
    task_id=existing["task_id"] if existing else None
    if body.enabled:
        if agent["status"]=="PAUSED":raise HTTPException(409,"Agent is paused")
        from open_webui.routers.starli_runtime_adapter import adapter
        prompt=("CONTINUATION IN BACKGROUND. Preserve the current conversation's objective and unfinished work. "+
            "Objective: "+objective[:4000]+". "+ "You are "+agent["name"]+", role "+agent["role"]+". Registry ID: "+agent_id+
            ". Instructions: "+(agent["instructions"] or "")[:2000]+
            ". Perform one bounded, authorized, evidence-backed step toward your assigned work. "+
            "Do not perform production deployment, publishing or destructive changes. "+
            "Report verified results and next action. Do not pretend to be STARLI BOSS.")
        from open_webui.routers.starli_chat_stream import trusted_launch_binding
        launch=trusted_launch_binding(user,role="handoff")
        if not launch:
            with _db() as connection:
                bound=connection.execute("SELECT chat_id FROM agent_conversations WHERE owner=? AND agent_id=?",(owner,agent_id)).fetchone()
            if bound:
                from open_webui.models.chats import Chats
                if not Chats.get_chat_by_id_and_user_id(bound["chat_id"],user.id):raise HTTPException(404,"Conversation not found")
                launch={"chatId":bound["chat_id"],"task_role":"handoff","completion_owner":True}
        from open_webui.routers.starli_chat_stream import budget_root_run_id
        if budget_root_run_id():launch["budgetRootRunId"]=budget_root_run_id()
        job=await adapter(user.id,"tasks.create",{"prompt":prompt,"chatHistory":_agent_conversation_messages(owner,agent_id),"model":agent["model"] if agent["provider"]=="hosted" else None,"agentId":agent_id,"idempotencyKey":"autonomous:"+agent_id+":"+uuid.uuid4().hex,**launch})
        task_id=job["taskId"]
    else:
        if task_id:
            from open_webui.routers.starli_runtime_adapter import adapter
            try:await adapter(user.id,"tasks.cancel",{"taskId":task_id})
            except HTTPException as exc:
                if exc.status_code!=404:raise
    with _db() as db:
        _get(db,owner,agent_id)
        db.execute("""INSERT INTO autonomous_sessions(owner,agent_id,enabled,task_id,updated_at,cycles,objective)
            VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,agent_id) DO UPDATE SET
            enabled=excluded.enabled,task_id=excluded.task_id,updated_at=excluded.updated_at,
            cycles=excluded.cycles,objective=excluded.objective""",
            (owner,agent_id,int(body.enabled),task_id,_utc(),0 if body.enabled else (existing["cycles"] if existing else 0),
             objective[:4000] if body.enabled else (existing["objective"] if existing else "")))
        db.commit()
    # Execution state belongs to the run activity projection, never a new chat message.

    return {"enabled":body.enabled,"taskId":task_id,"execution":"bounded_continuation_unlimited_cycles"}

# Supervisor is started with the API process and resumes persisted sessions.
# Only the same bounded executor may continue; settled/paused runs are never auto-replayed.
_AUTONOMOUS_SUPERVISOR=None
_LAST_IDENTITY_RECONCILE=0.0
_AUTONOMOUS_CYCLE_LIMIT=None  # Unlimited mission continuations; each task retains its own safety bounds.
async def _autonomous_supervisor_loop():
    global _LAST_IDENTITY_RECONCILE
    from open_webui.routers.starli_runtime_adapter import adapter, db as task_db, TERMINAL
    while True:
        try:
            if time.monotonic()-_LAST_IDENTITY_RECONCILE>=60:
                from open_webui.routers.starli_customer_identity import reconcile_native_identities
                try:
                    await asyncio.to_thread(reconcile_native_identities)
                    _LAST_IDENTITY_RECONCILE=time.monotonic()
                except Exception:
                    import logging
                    logging.getLogger(__name__).exception("Native identity reconciliation deferred")
            from open_webui.routers.starli_delivery import tick
            await tick()
            with _db() as connection:
                sessions=[dict(r) for r in connection.execute(
                    "SELECT owner,agent_id,task_id,cycles,objective FROM autonomous_sessions WHERE enabled=1").fetchall()]
            for session in sessions:
                try:
                    if _AUTONOMOUS_CYCLE_LIMIT is not None and session["cycles"]>=_AUTONOMOUS_CYCLE_LIMIT:
                        with _db() as connection:
                            connection.execute("UPDATE autonomous_sessions SET enabled=0,updated_at=? WHERE owner=? AND agent_id=? AND task_id=?",
                                (_utc(),session["owner"],session["agent_id"],session["task_id"]))
                            connection.commit()
                        continue
                    with task_db() as connection:
                        record=connection.execute("SELECT payload FROM tasks WHERE id=? AND owner=?",
                            (session["task_id"],session["owner"])).fetchone()
                    if not record:continue
                    outcome=json.loads(record[0])
                    status=outcome.get("status")
                    if status in {"ANSWERED","COMPLETED","NEEDS_INPUT","WAITING_INPUT","BUDGET_EXHAUSTED","FAILED","CANCELLED","INTERRUPTED"}:
                        # Continuations happen inside the SAME executor budget/checkpoint.
                        # Paused, answered or uncertain runs never spawn a fresh unbudgeted task.
                        with _db() as connection:
                            connection.execute("UPDATE autonomous_sessions SET enabled=0,updated_at=? WHERE owner=? AND agent_id=? AND task_id=?",(_utc(),session["owner"],session["agent_id"],session["task_id"]))
                            connection.commit()
                    continue
                except HTTPException as error:
                    if error.status_code in (401,403,404):
                        with _db() as connection:
                            connection.execute("UPDATE autonomous_sessions SET enabled=0,updated_at=? WHERE owner=? AND agent_id=? AND task_id=?",(_utc(),session["owner"],session["agent_id"],session["task_id"]))
                            _emit(connection,session["owner"],session["agent_id"],"execution.blocked",{"reason":"Account or agent authorization is no longer available"})
                            connection.commit()
                    else:
                        import logging
                        logging.getLogger(__name__).exception("Autonomous session deferred")
                except Exception:
                    import logging
                    logging.getLogger(__name__).exception("Autonomous session failed; other accounts continue")
        except asyncio.CancelledError:
            raise
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Autonomous supervisor iteration failed")
        await asyncio.sleep(2)

@router.on_event("startup")
async def _start_autonomous_supervisor():
    global _AUTONOMOUS_SUPERVISOR
    if _AUTONOMOUS_SUPERVISOR is None or _AUTONOMOUS_SUPERVISOR.done():
        _AUTONOMOUS_SUPERVISOR=asyncio.create_task(_autonomous_supervisor_loop())

@router.on_event("shutdown")
async def _stop_autonomous_supervisor():
    global _AUTONOMOUS_SUPERVISOR
    if _AUTONOMOUS_SUPERVISOR is not None:
        _AUTONOMOUS_SUPERVISOR.cancel()
        try:await _AUTONOMOUS_SUPERVISOR
        except asyncio.CancelledError:pass
        _AUTONOMOUS_SUPERVISOR=None

class PlatformAccessBody(BaseModel):
    enabled: bool
    class Config:extra="forbid"

@router.patch("/agents/{agent_id}/platform-access")
def set_platform_access(agent_id:str,body:PlatformAccessBody,user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    _ready(user)
    role=user.get("role") if isinstance(user,dict) else getattr(user,"role",None)
    if role!="admin":raise HTTPException(403,"Only the account administrator can grant platform access")
    owner=_owner(user)
    with _db() as db:
        _get(db,owner,agent_id)
        db.execute("UPDATE agents SET platform_access=?,version=version+1,updated_at=? WHERE owner=? AND id=?",(int(body.enabled),_utc(),owner,agent_id))
        _emit(db,owner,agent_id,"agent.platform_access",{"enabled":body.enabled})
        db.commit()
        return _public(_get(db,owner,agent_id))

class ChatPlatformAccessBody(BaseModel):
    enabled: StrictBool
    expectedAgentId: Optional[str] = Field(default=None,min_length=1,max_length=150)
    class Config:extra="forbid"

def _platform_chat_admin(user):
    ident=user.get("id") if isinstance(user,dict) else getattr(user,"id",None)
    fresh=Users.get_user_by_id(ident) if isinstance(ident,str) else None
    if not fresh:raise HTTPException(403,"Only the account administrator can grant platform access")
    _ready(fresh)
    role=fresh.get("role") if isinstance(fresh,dict) else getattr(fresh,"role",None)
    if role!="admin":raise HTTPException(403,"Only the account administrator can grant platform access")

def _chat_platform_state(chat_id,user):
    _platform_chat_admin(user)
    owned_live_chat(user,chat_id)
    owner=_owner(user)
    with _db() as connection:
        binding=connection.execute(
            "SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()
        if not binding:return {"chatId":chat_id,"agentId":None,"bound":False,"enabled":False,"platformAccess":False,"effectiveEnabled":False,"status":None}
        agent=_get(connection,owner,binding["agent_id"])
    granted=bool(agent["platform_access"])
    return {"chatId":chat_id,"agentId":agent["id"],"bound":True,"enabled":granted,"platformAccess":granted,
            "effectiveEnabled":granted and agent["status"]=="IDLE","status":agent["status"]}

@router.get("/chats/{chat_id}/platform-access")
def chat_platform_access(chat_id:str,user=Depends(get_verified_user)):
    """Read this owned conversation's actual agent grant; never reads the old global mode."""
    return _chat_platform_state(chat_id,user)

@router.patch("/chats/{chat_id}/platform-access")
def set_chat_platform_access(chat_id:str,body:ChatPlatformAccessBody,user=Depends(get_verified_user),guard=Depends(_mutation_guard)):
    """Only explicit administrator action may change this conversation's agent grant."""
    state=_chat_platform_state(chat_id,user)
    if body.expectedAgentId and state["agentId"]!=body.expectedAgentId:
        raise HTTPException(409,"Conversation agent changed; refresh before changing access")
    if not body.enabled and not state["bound"]:return state
    agent_id=ensure_chat_agent(user,chat_id) if body.enabled else state["agentId"]
    owner=_owner(user)
    with _db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        _platform_chat_admin(user)
        owned_live_chat(user,chat_id)
        binding=connection.execute("SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()
        if not binding or binding["agent_id"]!=agent_id:
            raise HTTPException(409,"Conversation agent changed; refresh before changing access")
        if body.expectedAgentId and binding["agent_id"]!=body.expectedAgentId:
            raise HTTPException(409,"Conversation agent changed; refresh before changing access")
        _get(connection,owner,agent_id)
        connection.execute("UPDATE agents SET platform_access=?,version=version+1,updated_at=? WHERE owner=? AND id=?",
                           (int(body.enabled),_utc(),owner,agent_id))
        _emit(connection,owner,agent_id,"agent.platform_access",{"enabled":body.enabled,"chatId":chat_id})
        connection.commit()
    return _chat_platform_state(chat_id,user)

@router.get("/deliveries/{delivery_id}")
def delivery_status(delivery_id:str,user=Depends(get_verified_user)):
    _ready(user)
    from open_webui.routers.starli_delivery import initialize
    with _db() as db:
        initialize(db)
        row=db.execute("SELECT id,source,target,status,task_id,response,error,created_at,updated_at FROM agent_delivery WHERE owner=? AND id=?",(_owner(user),delivery_id)).fetchone()
    if not row:raise HTTPException(404,"Delivery not found")
    return dict(row)
