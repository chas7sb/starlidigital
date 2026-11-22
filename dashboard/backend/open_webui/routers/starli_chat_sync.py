"""Canonical native-chat/draft sync. SQLite Chat, revisions, send receipt and outbox share ONE transaction."""
from __future__ import annotations
import asyncio,copy,hashlib,json,sqlite3,time,uuid
from contextlib import contextmanager
from contextvars import ContextVar
_SESSION_WRITE_FENCE=ContextVar("starli_sync_write_fence",default=None)
@contextmanager
def session_write_fence(fence,chat_id=None):
    token=_SESSION_WRITE_FENCE.set((fence,chat_id))
    try:yield
    finally:_SESSION_WRITE_FENCE.reset(token)
from fastapi import APIRouter,Depends,HTTPException,Request,BackgroundTasks
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel,ConfigDict
class BoundedSyncRoute(APIRoute):
    def get_route_handler(self):
        handler=super().get_route_handler()
        async def bounded(request):
            if request.method in ("POST","PATCH"):
                try:declared=int(request.headers.get("content-length","0"))
                except ValueError:raise HTTPException(413,"SYNC_BODY_LIMIT") from None
                if declared>262144:raise HTTPException(413,"SYNC_BODY_LIMIT")
                body=bytearray()
                async for chunk in request.stream():
                    if len(body)+len(chunk)>262144:raise HTTPException(413,"SYNC_BODY_LIMIT")
                    body.extend(chunk)
                request._body=bytes(body)
            return await handler(request)
        return bounded
router=APIRouter(route_class=BoundedSyncRoute)
VERSION="starli.chat.sync.v1"
MAX_TEXT_BYTES=32768
EVENT_LIMIT=500
_DISPATCHER=None

def _id(value):
    if not isinstance(value,str) or not 1<=len(value)<=180 or any(ord(c)<32 for c in value) or "/" in value:raise HTTPException(422,"SYNC_INVALID_ID")
    return value
def _uuid(value):
    try:
        parsed=uuid.UUID(value)
        if parsed.version!=4:raise ValueError()
        return str(parsed)
    except (ValueError,TypeError,AttributeError):raise HTTPException(422,"SYNC_DEVICE_OR_SEND_ID_INVALID") from None
def _text(value,empty=True):
    if not isinstance(value,str) or len(value.encode("utf-8"))>MAX_TEXT_BYTES or chr(0) in value or not empty and not value.strip():raise HTTPException(422,"SYNC_TEXT_INVALID")
    return value
def _hash(text):return hashlib.sha256(text.encode("utf-8")).hexdigest()
def _owner(user):
    uid=user if isinstance(user,str) else user.get("id") if isinstance(user,dict) else getattr(user,"id",None)
    uid=_id(uid)
    from open_webui.models.users import Users
    current=Users.get_user_by_id(uid)
    if not current or getattr(current,"role",None) not in ("user","admin"):raise HTTPException(403,"SYNC_ACCOUNT_UNAVAILABLE")
    return uid,current
def _native_path():
    from open_webui.internal.db import engine
    if engine.dialect.name!="sqlite" or not engine.url.database or engine.url.database==":memory:":raise HTTPException(503,"SYNC_REQUIRES_NATIVE_SQLITE")
    from pathlib import Path
    path=Path(engine.url.database).resolve()
    if not path.is_file():raise HTTPException(503,"SYNC_NATIVE_DATABASE_UNAVAILABLE")
    return path
@contextmanager
def _db(write=False):
    db=sqlite3.connect(str(_native_path()),timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
    try:
        db.execute("PRAGMA busy_timeout=10000");db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""CREATE TABLE IF NOT EXISTS starli_sync_chats(owner TEXT NOT NULL,chat_id TEXT NOT NULL,agent_id TEXT NOT NULL,canonical INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,next_seq INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,chat_id));
CREATE UNIQUE INDEX IF NOT EXISTS starli_sync_one_canonical ON starli_sync_chats(owner,agent_id) WHERE canonical=1;
CREATE TABLE IF NOT EXISTS starli_sync_events(owner TEXT NOT NULL,chat_id TEXT NOT NULL,seq INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,chat_id,seq));
CREATE TABLE IF NOT EXISTS starli_sync_drafts(owner TEXT NOT NULL,chat_id TEXT NOT NULL,revision INTEGER NOT NULL,text TEXT NOT NULL,content_hash TEXT NOT NULL,device_id TEXT,updated REAL NOT NULL,PRIMARY KEY(owner,chat_id));
CREATE TABLE IF NOT EXISTS starli_sync_draft_versions(owner TEXT NOT NULL,chat_id TEXT NOT NULL,revision INTEGER NOT NULL,content_hash TEXT NOT NULL,PRIMARY KEY(owner,chat_id,revision));
CREATE TABLE IF NOT EXISTS starli_sync_presence(owner TEXT NOT NULL,chat_id TEXT NOT NULL,device_id TEXT NOT NULL,session_hash TEXT NOT NULL,session_expiry REAL,expires REAL NOT NULL,PRIMARY KEY(owner,chat_id,device_id));
CREATE TABLE IF NOT EXISTS starli_sync_sends(owner TEXT NOT NULL,chat_id TEXT NOT NULL,send_id TEXT NOT NULL,request_hash TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(owner,chat_id,send_id));
CREATE TABLE IF NOT EXISTS starli_sync_consumptions(owner TEXT NOT NULL,chat_id TEXT NOT NULL,draft_revision INTEGER NOT NULL,content_hash TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(owner,chat_id,draft_revision,content_hash));
CREATE TABLE IF NOT EXISTS starli_sync_run_outbox(owner TEXT NOT NULL,chat_id TEXT NOT NULL,run_id TEXT NOT NULL,request_id TEXT NOT NULL,message_id TEXT NOT NULL,user_message_id TEXT NOT NULL,agent_id TEXT NOT NULL,status TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(owner,run_id));""")
        db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        try:
            yield db
            captured=_SESSION_WRITE_FENCE.get()
            if write and captured:captured[0].check(captured[1])
            db.execute("COMMIT")
        except BaseException:db.execute("ROLLBACK");raise
    finally:db.close()
def _native_agent(user,agent_id):
    from open_webui.routers import starli_v3_native as native
    owner=native._owner(user)
    with native._db() as db:
        row=native._get(db,owner,_id(agent_id))
        return dict(row)
@contextmanager
def _registry(user):
    from open_webui.routers import starli_v3_native as native
    owner=native._owner(user)
    with native._db() as db:
        db.execute("BEGIN IMMEDIATE")
        yield native,db,owner
        db.commit()
def _chat(db,owner,chat_id):
    row=db.execute("SELECT * FROM chat WHERE id=? AND user_id=?",(chat_id,owner)).fetchone()
    if not row or row["archived"]:raise HTTPException(404,"SYNC_CHAT_UNAVAILABLE")
    return row
def _data(row):
    try:value=json.loads(row["chat"])
    except (ValueError,TypeError):raise HTTPException(409,"SYNC_CHAT_INVALID") from None
    if not isinstance(value,dict):raise HTTPException(409,"SYNC_CHAT_INVALID")
    return value
def _meta(db,owner,chat_id):
    row=db.execute("SELECT * FROM starli_sync_chats WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()
    if not row:raise HTTPException(409,"SYNC_CHAT_NOT_RESOLVED")
    return row
def _scope(user,chat_id):
    owner,current=_owner(user);chat_id=_id(chat_id)
    with _db() as db:row=_chat(db,owner,chat_id);meta=dict(_meta(db,owner,chat_id))
    _native_agent(current,meta["agent_id"])
    return owner,current,meta
def _reference(value):
    if not isinstance(value,dict):return {}
    result={}
    for key in ("id","title","name","label","url"):
        item=value.get(key)
        if isinstance(item,str) and len(item)<=2048 and not any(ord(c)<32 for c in item):
            if key=="url":
                from urllib.parse import urlsplit
                parsed=urlsplit(item)
                if parsed.scheme not in ("https","http") or not parsed.hostname or parsed.username or parsed.password:continue
            result[key]=item
    return result
def _message(message):
    fields=("id","role","content","parentId","childrenIds","done","model","timestamp","starliExecution","starliInterAgent","starliAgentId","starliAgentName")
    result={key:copy.deepcopy(message[key]) for key in fields if key in message}
    run=message.get("starliPublicRun")
    if isinstance(run,dict):
        safe=("version","runId","requestId","conversationId","assistantMessageId","taskId","agentId","status","objectiveComplete","needsInput","lastSeq")
        result["starliPublicRun"]={k:copy.deepcopy(run[k]) for k in safe if k in run and isinstance(run[k],(str,bool,int,type(None)))}
    for key in ("citations","sources"):
        values=message.get(key)
        if isinstance(values,list):
            refs=[]
            for value in values[:100]:
                ref=_reference(value)
                if isinstance(value,dict) and isinstance(value.get("source"),dict):
                    source=_reference(value["source"])
                    if source:ref["source"]=source
                if ref:refs.append(ref)
            result[key]=refs
    # Only canonical already-public activity status rows are replayable; legacy arbitrary descriptions/results are private.
    statuses=message.get("statusHistory")
    if isinstance(statuses,list):
        allowed=("version","type","runId","requestId","conversationId","assistantMessageId","taskId","agentId","toolCallId","seq","status","resultCode","publicToolName","summary","durationMs")
        result["statusHistory"]=[{k:v[k] for k in allowed if k in v and isinstance(v[k],(str,bool,int,float,type(None)))} for v in statuses[:200] if isinstance(v,dict) and v.get("version")=="starli.tool.v1" and v.get("type")=="tool.lifecycle"]
    return result
def _public_chat(row):
    data=_data(row);history=data.get("history") or {};mapping=history.get("messages") or {}
    return {"id":row["id"],"title":row["title"],"messages":[_message(m) for m in data.get("messages",[]) if isinstance(m,dict)],"history":{"currentId":history.get("currentId"),"messages":{key:_message(m) for key,m in mapping.items() if isinstance(m,dict)}}}
def _append(db,owner,chat_id,event_type,payload,channel="conversation",revision=False):
    if event_type not in ("conversation.created","conversation.updated","message.created","message.updated","run.queued","draft.changed","presence.changed"):raise HTTPException(422,"SYNC_EVENT_TYPE_INVALID")
    if revision:db.execute("UPDATE starli_sync_chats SET revision=revision+1 WHERE owner=? AND chat_id=?",(owner,chat_id))
    db.execute("UPDATE starli_sync_chats SET next_seq=next_seq+1 WHERE owner=? AND chat_id=?",(owner,chat_id))
    meta=_meta(db,owner,chat_id)
    event={"version":VERSION,"type":event_type,"channel":channel,"conversationId":chat_id,"revision":meta["revision"],"cursor":meta["next_seq"],"timestamp":time.time(),**payload}
    raw=json.dumps(event,separators=(",",":"),ensure_ascii=False)
    if len(raw.encode())>262144:raise HTTPException(413,"SYNC_EVENT_LIMIT")
    db.execute("INSERT INTO starli_sync_events VALUES(?,?,?,?)",(owner,chat_id,meta["next_seq"],raw))
    db.execute("DELETE FROM starli_sync_events WHERE owner=? AND chat_id=? AND seq<=?",(owner,chat_id,meta["next_seq"]-EVENT_LIMIT))
    return event
def _draft(db,owner,chat_id):
    row=db.execute("SELECT * FROM starli_sync_drafts WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()
    if row:return row
    db.execute("INSERT INTO starli_sync_drafts VALUES(?,?,0,'',?,NULL,?)",(owner,chat_id,_hash(""),time.time()))
    db.execute("INSERT OR IGNORE INTO starli_sync_draft_versions VALUES(?,?,0,?)",(owner,chat_id,_hash("")))
    return _draft(db,owner,chat_id)
def _draft_dto(row):return {"revision":row["revision"],"text":row["text"],"contentHash":row["content_hash"],"deviceId":row["device_id"],"updatedAt":row["updated"]}
def resolve_conversation(user,agent_id,*,historical_chat_id=None):
    owner,current=_owner(user);agent_id=_id(agent_id)
    with _registry(current) as (native,registry,registry_owner):
        agent=native._get(registry,registry_owner,agent_id)
        binding=registry.execute("SELECT chat_id FROM agent_conversations WHERE owner=? AND agent_id=?",(registry_owner,agent_id)).fetchone()
        canonical=historical_chat_id is None
        chat_id=_id(historical_chat_id) if historical_chat_id is not None else binding["chat_id"] if binding else str(uuid.uuid5(uuid.NAMESPACE_URL,"starli-sync:"+owner+":"+agent_id))
        other=registry.execute("SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",(registry_owner,chat_id)).fetchone()
        if other and other["agent_id"]!=agent_id:raise HTTPException(409,"SYNC_CHAT_AGENT_CONFLICT")
        with _db(True) as db:
            row=db.execute("SELECT * FROM chat WHERE id=?",(chat_id,)).fetchone()
            if row:
                row=_chat(db,owner,chat_id)
                meta=db.execute("SELECT * FROM starli_sync_chats WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()
                if meta and meta["agent_id"]!=agent_id:raise HTTPException(409,"SYNC_CHAT_AGENT_CONFLICT")
                if historical_chat_id and not (other and other["agent_id"]==agent_id or meta and meta["agent_id"]==agent_id):raise HTTPException(409,"SYNC_HISTORICAL_AGENT_LINK_UNPROVEN")
                if not binding and canonical and not meta:
                    raw_meta=json.loads(row["meta"] or "{}")
                    if raw_meta.get("starliSyncAgentId")!=agent_id:raise HTTPException(409,"SYNC_ORPHAN_COLLISION")
            else:
                if historical_chat_id or binding:raise HTTPException(409,"SYNC_BOUND_CHAT_MISSING")
                stamp=int(time.time());data={"title":agent["name"],"messages":[],"history":{"messages":{},"currentId":None},"models":["starli-pi"]}
                db.execute("INSERT INTO chat(id,user_id,title,chat,created_at,updated_at,archived,pinned,meta) VALUES(?,?,?,?,?,?,0,0,?)",(chat_id,owner,agent["name"],json.dumps(data),stamp,stamp,json.dumps({"starliSyncAgentId":agent_id})))
            prior=db.execute("SELECT 1 FROM starli_sync_chats WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()
            db.execute("INSERT OR IGNORE INTO starli_sync_chats(owner,chat_id,agent_id,canonical) VALUES(?,?,?,?)",(owner,chat_id,agent_id,int(canonical)))
            if not prior:_append(db,owner,chat_id,"conversation.created",{"agentId":agent_id})
            _draft(db,owner,chat_id);meta=dict(_meta(db,owner,chat_id))
        if canonical and not binding:
            registry.execute("INSERT INTO agent_conversations VALUES(?,?,?,?,?)",(registry_owner,agent_id,chat_id,native._utc(),native._utc()))
    return {"version":VERSION,"conversationId":chat_id,"agentId":agent_id,"canonical":canonical,"revision":meta["revision"],"cursor":meta["next_seq"]}
def read_draft(user,chat_id):
    owner,_,_= _scope(user,chat_id)
    with _db(True) as db:_chat(db,owner,chat_id);return _draft_dto(_draft(db,owner,chat_id))
def update_draft(user,chat_id,*,device_id,expected_revision,text):
    owner,_,_=_scope(user,chat_id);device_id=_uuid(device_id);text=_text(text)
    if isinstance(expected_revision,bool) or not isinstance(expected_revision,int) or expected_revision<0:raise HTTPException(422,"SYNC_DRAFT_REVISION_INVALID")
    with _db(True) as db:
        _chat(db,owner,chat_id);draft=_draft(db,owner,chat_id)
        if draft["revision"]!=expected_revision:raise HTTPException(409,{"code":"SYNC_DRAFT_CONFLICT","revision":draft["revision"],"contentHash":draft["content_hash"]})
        digest=_hash(text)
        if digest==draft["content_hash"] and text==draft["text"]:return _draft_dto(draft)
        revision=draft["revision"]+1
        db.execute("UPDATE starli_sync_drafts SET revision=?,text=?,content_hash=?,device_id=?,updated=? WHERE owner=? AND chat_id=?",(revision,text,digest,device_id,time.time(),owner,chat_id))
        db.execute("INSERT INTO starli_sync_draft_versions VALUES(?,?,?,?)",(owner,chat_id,revision,digest))
        db.execute("DELETE FROM starli_sync_draft_versions WHERE owner=? AND chat_id=? AND revision<?",(owner,chat_id,revision-200))
        _append(db,owner,chat_id,"draft.changed",{"draftRevision":revision,"contentHash":digest,"deviceId":device_id},"draft")
        return _draft_dto(_draft(db,owner,chat_id))
def _presence_valid(owner,row):
    from open_webui.routers.starli_session_fence import SessionFence
    try:SessionFence(owner,row["session_hash"],row["session_expiry"],"jwt").check();return True
    except HTTPException:return False
def _presence(db,owner,chat_id):
    active=[]
    for row in db.execute("SELECT * FROM starli_sync_presence WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchall():
        if row["expires"]<=time.time() or not _presence_valid(owner,row):
            db.execute("DELETE FROM starli_sync_presence WHERE owner=? AND chat_id=? AND device_id=?",(owner,chat_id,row["device_id"]))
            _append(db,owner,chat_id,"presence.changed",{"deviceId":row["device_id"],"typing":False},"presence")
        else:active.append({"deviceId":row["device_id"],"typing":True,"expiresAt":row["expires"]})
    return active
def update_presence(user,chat_id,*,device_id,typing,fence):
    owner,_,_=_scope(user,chat_id);device_id=_uuid(device_id)
    if not isinstance(typing,bool) or fence.kind!="jwt" or fence.user_id!=owner:raise HTTPException(403,"SYNC_SESSION_REQUIRED")
    fence.check(chat_id)
    with _db(True) as db:
        _chat(db,owner,chat_id);_presence(db,owner,chat_id)
        old=db.execute("SELECT * FROM starli_sync_presence WHERE owner=? AND chat_id=? AND device_id=?",(owner,chat_id,device_id)).fetchone()
        if old and old["session_hash"]!=fence.token_hash:raise HTTPException(409,"SYNC_DEVICE_SESSION_CONFLICT")
        if typing:
            count=db.execute("SELECT count(*) FROM starli_sync_presence WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()[0]
            if count>=16 and not old:raise HTTPException(429,"SYNC_PRESENCE_LIMIT")
            db.execute("INSERT INTO starli_sync_presence VALUES(?,?,?,?,?,?) ON CONFLICT(owner,chat_id,device_id) DO UPDATE SET expires=excluded.expires,session_expiry=excluded.session_expiry",(owner,chat_id,device_id,fence.token_hash,fence.expires_at,time.time()+30))
        else:db.execute("DELETE FROM starli_sync_presence WHERE owner=? AND chat_id=? AND device_id=?",(owner,chat_id,device_id))
        if bool(old)!=typing:
            expires=db.execute("SELECT expires FROM starli_sync_presence WHERE owner=? AND chat_id=? AND device_id=?",(owner,chat_id,device_id)).fetchone()
            _append(db,owner,chat_id,"presence.changed",{"deviceId":device_id,"typing":typing,"expiresAt":expires["expires"] if expires else None},"presence")
        return {"version":VERSION,"presence":_presence(db,owner,chat_id)}
def send_message(user,chat_id,*,device_id,client_send_id,draft_revision,content_hash,text):
    owner,_,scope=_scope(user,chat_id);device_id=_uuid(device_id);client_send_id=_uuid(client_send_id);text=_text(text,False)
    if isinstance(draft_revision,bool) or not isinstance(draft_revision,int) or draft_revision<0 or content_hash!=_hash(text):raise HTTPException(422,"SYNC_DRAFT_HASH_INVALID")
    fingerprint=_hash(json.dumps({"draftRevision":draft_revision,"contentHash":content_hash,"text":text},sort_keys=True))
    with _db(True) as db:
        row=_chat(db,owner,chat_id)
        prior=db.execute("SELECT request_hash,receipt FROM starli_sync_sends WHERE owner=? AND chat_id=? AND send_id=?",(owner,chat_id,client_send_id)).fetchone()
        if prior:
            if prior["request_hash"]!=fingerprint:raise HTTPException(409,"SYNC_SEND_ID_CONFLICT")
            return {**json.loads(prior["receipt"]),"deduplicated":True}
        consumed=db.execute("SELECT receipt FROM starli_sync_consumptions WHERE owner=? AND chat_id=? AND draft_revision=? AND content_hash=?",(owner,chat_id,draft_revision,content_hash)).fetchone()
        if consumed:
            receipt=json.loads(consumed["receipt"]);db.execute("INSERT INTO starli_sync_sends VALUES(?,?,?,?,?)",(owner,chat_id,client_send_id,fingerprint,json.dumps(receipt)))
            return {**receipt,"deduplicated":True}
        known=db.execute("SELECT content_hash FROM starli_sync_draft_versions WHERE owner=? AND chat_id=? AND revision=?",(owner,chat_id,draft_revision)).fetchone()
        if not known or known["content_hash"]!=content_hash:raise HTTPException(409,"SYNC_DRAFT_VERSION_UNAVAILABLE")
        data=_data(row);history=dict(data.get("history") or {});messages=dict(history.get("messages") or {});parent=history.get("currentId")
        user_id=str(uuid.uuid5(uuid.NAMESPACE_URL,"starli-send-user:"+owner+":"+chat_id+":"+client_send_id))
        assistant_id=str(uuid.uuid5(uuid.NAMESPACE_URL,"starli-send-assistant:"+owner+":"+chat_id+":"+client_send_id))
        run_id=str(uuid.uuid5(uuid.NAMESPACE_URL,"starli-send-run:"+owner+":"+chat_id+":"+client_send_id));request_id=str(uuid.uuid4());stamp=int(time.time())
        submitted={"id":user_id,"role":"user","content":text,"parentId":parent,"childrenIds":[assistant_id],"timestamp":stamp}
        assistant={"id":assistant_id,"role":"assistant","content":"","model":"starli-pi","parentId":user_id,"childrenIds":[],"timestamp":stamp,"done":False}
        if parent in messages:
            old=dict(messages[parent]);old["childrenIds"]=list(dict.fromkeys([*(old.get("childrenIds") or []),user_id]));messages[parent]=old
        messages[user_id]=submitted;messages[assistant_id]=assistant;history.update(messages=messages,currentId=assistant_id);data["history"]=history;data["messages"]=[*data.get("messages",[]),submitted,assistant]
        db.execute("UPDATE chat SET chat=?,updated_at=? WHERE id=? AND user_id=?",(json.dumps(data),stamp,chat_id,owner))
        _append(db,owner,chat_id,"message.created",{"message":submitted},revision=True)
        _append(db,owner,chat_id,"message.created",{"message":assistant},revision=True)
        draft=_draft(db,owner,chat_id);clear=draft["revision"]==draft_revision and draft["content_hash"]==content_hash
        if clear:
            next_revision=draft["revision"]+1
            db.execute("UPDATE starli_sync_drafts SET revision=?,text='',content_hash=?,device_id=?,updated=? WHERE owner=? AND chat_id=?",(next_revision,_hash(""),device_id,time.time(),owner,chat_id))
            db.execute("INSERT INTO starli_sync_draft_versions VALUES(?,?,?,?)",(owner,chat_id,next_revision,_hash("")))
            _append(db,owner,chat_id,"draft.changed",{"draftRevision":next_revision,"contentHash":_hash(""),"deviceId":device_id},"draft")
        db.execute("INSERT INTO starli_sync_run_outbox VALUES(?,?,?,?,?,?,?,'QUEUED',?)",(owner,chat_id,run_id,request_id,assistant_id,user_id,scope["agent_id"],time.time()))
        _append(db,owner,chat_id,"run.queued",{"runId":run_id,"requestId":request_id,"assistantMessageId":assistant_id,"status":"QUEUED"})
        meta=_meta(db,owner,chat_id);draft=_draft(db,owner,chat_id)
        receipt={"version":VERSION,"conversationId":chat_id,"agentId":scope["agent_id"],"clientSendId":client_send_id,"userMessageId":user_id,"assistantMessageId":assistant_id,"runId":run_id,"requestId":request_id,"revision":meta["revision"],"cursor":meta["next_seq"],"draftRevision":draft["revision"],"draftConsumed":clear,"newerDraftPreserved":not clear,"status":"QUEUED","executionReady":_DISPATCHER is not None}
        raw=json.dumps(receipt)
        db.execute("INSERT INTO starli_sync_sends VALUES(?,?,?,?,?)",(owner,chat_id,client_send_id,fingerprint,raw));db.execute("INSERT INTO starli_sync_consumptions VALUES(?,?,?,?,?)",(owner,chat_id,draft_revision,content_hash,raw))
        return {**receipt,"deduplicated":False}
def read_snapshot(user,chat_id):
    owner,_,scope=_scope(user,chat_id)
    with _db(True) as db:
        row=_chat(db,owner,chat_id);presence=_presence(db,owner,chat_id);meta=_meta(db,owner,chat_id)
        return {"version":VERSION,"conversationId":chat_id,"agentId":scope["agent_id"],"revision":meta["revision"],"cursor":meta["next_seq"],"chat":_public_chat(row),"draft":_draft_dto(_draft(db,owner,chat_id)),"presence":presence,"executionReady":_DISPATCHER is not None}
def read_events(user,chat_id,*,after=0,limit=100):
    owner,_,_=_scope(user,chat_id)
    if isinstance(after,bool) or not isinstance(after,int) or after<0 or isinstance(limit,bool) or not isinstance(limit,int) or not 1<=limit<=200:raise HTTPException(422,"SYNC_CURSOR_INVALID")
    with _db(True) as db:
        _chat(db,owner,chat_id);_presence(db,owner,chat_id);meta=_meta(db,owner,chat_id)
        first=db.execute("SELECT min(seq) FROM starli_sync_events WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()[0]
        rows=db.execute("SELECT seq,payload FROM starli_sync_events WHERE owner=? AND chat_id=? AND seq>? ORDER BY seq LIMIT ?",(owner,chat_id,after,limit+1)).fetchall()
        page=rows[:limit]
        return {"version":VERSION,"events":[{"cursor":r["seq"],"event":json.loads(r["payload"])} for r in page],"cursor":page[-1]["seq"] if page else after,"hasMore":len(rows)>limit,"replayTruncated":bool(first and after<first-1),"latestCursor":meta["next_seq"]}
def register_outbox_dispatcher(dispatcher):
    global _DISPATCHER
    if not callable(dispatcher):raise TypeError("Trusted server dispatcher required")
    _DISPATCHER=dispatcher
def pending_outbox(user,limit=50):
    owner,_=_owner(user)
    if not isinstance(limit,int) or not 1<=limit<=100:raise HTTPException(422,"SYNC_LIMIT_INVALID")
    with _db() as db:return [dict(row) for row in db.execute("SELECT * FROM starli_sync_run_outbox WHERE owner=? AND status='QUEUED' ORDER BY created LIMIT ?",(owner,limit))]

def fence_legacy_chat_write(connection,chat_id):
    """Must be first operation on a fresh SQLAlchemy connection; holds SQLite writer lock until caller commit."""
    if connection.dialect.name!="sqlite":return
    connection.exec_driver_sql("BEGIN IMMEDIATE")
    exists=connection.exec_driver_sql("SELECT 1 FROM sqlite_master WHERE type='table' AND name='starli_sync_chats'").first()
    if exists and connection.exec_driver_sql("SELECT 1 FROM starli_sync_chats WHERE chat_id=? LIMIT 1",(chat_id,)).first():
        raise HTTPException(409,"SYNC_CANONICAL_SAVE_REQUIRES_REVISION")
    # Existing server-bound runs remain authoritative even before canonical sync is adopted.
    row=connection.exec_driver_sql("SELECT chat FROM chat WHERE id=?",(chat_id,)).first()
    if row:
        try:data=json.loads(row[0]) if isinstance(row[0],str) else row[0]
        except (ValueError,TypeError):raise HTTPException(409,"SYNC_CHAT_INVALID") from None
        if not isinstance(data,dict):raise HTTPException(409,"SYNC_CHAT_INVALID")
        mapping=(data.get("history") or {}).get("messages") or {}
        items=[*(mapping.values() if isinstance(mapping,dict) else []),*(data.get("messages") if isinstance(data.get("messages"),list) else [])]
        for item in items:
            run=item.get("starliPublicRun") if isinstance(item,dict) else None
            if isinstance(run,dict) and run.get("version")=="starli.run.v1" and run.get("runId"):
                raise HTTPException(409,"STARLI_RUN_SAVE_REQUIRES_REVISION")

def mutate_native_chat(owner_id,chat_id,mutator):
    """Trusted server callback only: NativeChat JSON + message revision/outbox commit together."""
    owner,current=_owner(owner_id);chat_id=_id(chat_id)
    if not callable(mutator):raise TypeError("Trusted native chat mutator required")
    with _db() as db:
        _chat(db,owner,chat_id)
        meta=db.execute("SELECT * FROM starli_sync_chats WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()
    if meta:_native_agent(current,meta["agent_id"])
    with _db(True) as db:
        row=_chat(db,owner,chat_id);before=_data(row)
        proposed=mutator(copy.deepcopy(before))
        if not isinstance(proposed,dict):raise HTTPException(422,"SYNC_MUTATION_INVALID")
        old_messages=(before.get("history") or {}).get("messages") or {}
        new_messages=(proposed.get("history") or {}).get("messages") or {}
        if not isinstance(new_messages,dict) or any(key not in new_messages for key in old_messages):raise HTTPException(409,"SYNC_DESTRUCTIVE_PROJECTION_DENIED")
        db.execute("UPDATE chat SET chat=?,updated_at=? WHERE id=? AND user_id=?",(json.dumps(proposed),int(time.time()),chat_id,owner))
        sync=db.execute("SELECT 1 FROM starli_sync_chats WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()
        if sync and before!=proposed:
            changed=0
            for message_id,message in new_messages.items():
                if not isinstance(message,dict):raise HTTPException(422,"SYNC_MUTATION_INVALID")
                if message_id not in old_messages or _message(old_messages[message_id])!=_message(message):
                    _append(db,owner,chat_id,"message.updated",{"message":_message(message),"currentId":(proposed.get("history") or {}).get("currentId")},revision=True);changed+=1
            if not changed:_append(db,owner,chat_id,"conversation.updated",{"currentId":(proposed.get("history") or {}).get("currentId")},revision=True)
        result=_meta(db,owner,chat_id) if sync else None
        return {"conversationId":chat_id,"revision":result["revision"] if result else None,"cursor":result["next_seq"] if result else None}

def record_chat_projection(connection,owner_id,chat_id,*,message_id):
    """Parent hook: invoke INSIDE native Chat write transaction AFTER native JSON flush."""
    if not isinstance(connection,sqlite3.Connection) or not connection.in_transaction:raise RuntimeError("SYNC_NATIVE_SQLITE_TRANSACTION_REQUIRED")
    row=_chat(connection,owner_id,chat_id)
    meta=connection.execute("SELECT 1 FROM starli_sync_chats WHERE owner=? AND chat_id=?",(owner_id,chat_id)).fetchone()
    if not meta:return None
    data=_data(row);message=(data.get("history") or {}).get("messages",{}).get(message_id)
    if not isinstance(message,dict):raise HTTPException(409,"SYNC_MESSAGE_UNAVAILABLE")
    return _append(connection,owner_id,chat_id,"message.updated",{"message":_message(message)},revision=True)

class StrictBody(BaseModel):model_config=ConfigDict(extra="forbid",strict=True)
class ResolveBody(StrictBody):historicalChatId:str|None=None
class DraftBody(StrictBody):deviceId:str;expectedRevision:int;text:str
class PresenceBody(StrictBody):deviceId:str;typing:bool
class SendBody(StrictBody):deviceId:str;clientSendId:str;draftRevision:int;contentHash:str;text:str
def _auth(request:Request):
    from fastapi.security import HTTPAuthorizationCredentials
    from open_webui.utils.auth import get_current_user,get_verified_user
    header=request.headers.get("authorization","");auth=None
    if header:
        scheme,_,token=header.partition(" ")
        if scheme.lower()!="bearer" or not token:raise HTTPException(401,"SYNC_SESSION_REQUIRED")
        auth=HTTPAuthorizationCredentials(scheme="Bearer",credentials=token)
    return get_verified_user(get_current_user(request,BackgroundTasks(),auth_token=auth))
def _capture(request,user,chat_id=None):
    from open_webui.routers.starli_session_fence import capture_request_fence
    fence=capture_request_fence(request,user)
    if fence.kind!="jwt":raise HTTPException(403,"SYNC_NATIVE_SESSION_REQUIRED")
    fence.check(chat_id);return fence
@router.post("/agent/{agent_id}/conversation")
def resolve_route(agent_id:str,body:ResolveBody,request:Request,user=Depends(_auth)):
    with session_write_fence(_capture(request,user)):return resolve_conversation(user,agent_id,historical_chat_id=body.historicalChatId)
@router.get("/chat/{chat_id}/snapshot")
def snapshot_route(chat_id:str,request:Request,user=Depends(_auth)):
    with session_write_fence(_capture(request,user,chat_id),chat_id):return read_snapshot(user,chat_id)
@router.get("/chat/{chat_id}/draft")
def draft_route(chat_id:str,request:Request,user=Depends(_auth)):
    with session_write_fence(_capture(request,user,chat_id),chat_id):return read_draft(user,chat_id)
@router.patch("/chat/{chat_id}/draft")
def update_draft_route(chat_id:str,body:DraftBody,request:Request,user=Depends(_auth)):
    with session_write_fence(_capture(request,user,chat_id),chat_id):return update_draft(user,chat_id,device_id=body.deviceId,expected_revision=body.expectedRevision,text=body.text)
@router.post("/chat/{chat_id}/presence")
def presence_route(chat_id:str,body:PresenceBody,request:Request,user=Depends(_auth)):
    fence=_capture(request,user,chat_id)
    with session_write_fence(fence,chat_id):return update_presence(user,chat_id,device_id=body.deviceId,typing=body.typing,fence=fence)
@router.post("/chat/{chat_id}/send")
async def send_route(chat_id:str,body:SendBody,request:Request,user=Depends(_auth)):
    fence=_capture(request,user,chat_id)
    with session_write_fence(fence,chat_id):result=send_message(user,chat_id,device_id=body.deviceId,client_send_id=body.clientSendId,draft_revision=body.draftRevision,content_hash=body.contentHash,text=body.text)
    # No model/worker execution here. Parent registered dispatcher drains durable outbox.
    return result
@router.get("/chat/{chat_id}/events")
async def events_route(chat_id:str,request:Request,after:int=0,user=Depends(_auth)):
    fence=_capture(request,user,chat_id)
    value=request.headers.get("last-event-id")
    if value is not None:
        try:after=int(value)
        except ValueError:raise HTTPException(422,"SYNC_CURSOR_INVALID") from None
    read_events(user,chat_id,after=after)
    async def stream():
        cursor=after;until=time.monotonic()+180
        while time.monotonic()<until:
            if await request.is_disconnected():return
            current=fence.check(chat_id);_scope(current,chat_id)
            page=read_events(current,chat_id,after=cursor)
            if page["replayTruncated"]:
                snapshot=read_snapshot(current,chat_id);cursor=snapshot["cursor"]
                event={"version":VERSION,"type":"sync.resync","reason":"retention","snapshot":snapshot}
                fence.check(chat_id);yield "id: "+str(cursor)+"\ndata: "+json.dumps(event,separators=(",",":"))+"\n\n"
            else:
                for row in page["events"]:
                    fence.check(chat_id);_scope(current,chat_id);cursor=row["cursor"]
                    yield "id: "+str(cursor)+"\ndata: "+json.dumps(row["event"],separators=(",",":"))+"\n\n"
            if not page["hasMore"]:await asyncio.sleep(0.5)
    return StreamingResponse(stream(),media_type="text/event-stream",headers={"Cache-Control":"private, no-store","X-Accel-Buffering":"no"})
