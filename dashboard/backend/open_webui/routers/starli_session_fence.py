"""Fresh native session authorization for long-lived delivery; never retains raw credentials."""
import asyncio,hashlib,hmac,time
from dataclasses import dataclass
from fastapi import HTTPException

def _hash(value):return hashlib.sha256(value.encode()).hexdigest()
def _active(uid):
    from open_webui.models.users import Users
    user=Users.get_user_by_id(uid)
    if user is None or user.role not in ("user","admin"):raise HTTPException(401,"Session is no longer authorized")
    return user

@dataclass(frozen=True)
class SessionFence:
    user_id:str
    token_hash:str
    expires_at:float|None=None
    kind:str="jwt"
    family_hash:str|None=None
    def check(self,chat_id=None):
        try:
            user=_active(self.user_id)
            if self.kind=="jwt":
                if self.expires_at is not None and self.expires_at<=time.time():raise HTTPException(401,"Session is no longer authorized")
                from open_webui.routers.starli_session_revocation import assert_session_hash_allowed
                assert_session_hash_allowed(self.token_hash,self.family_hash or self.token_hash,self.user_id)
            elif self.kind=="apikey":
                from open_webui.models.users import Users
                key=Users.get_user_api_key_by_id(self.user_id)
                if not isinstance(key,str) or not hmac.compare_digest(_hash(key),self.token_hash):raise HTTPException(401,"Session is no longer authorized")
            else:raise HTTPException(401,"Session is no longer authorized")
            if chat_id is not None:
                from open_webui.models.chats import Chats
                if not isinstance(chat_id,str) or not Chats.get_chat_by_id_and_user_id(chat_id,self.user_id):raise HTTPException(404,"Conversation not found")
            return user
        except HTTPException:raise
        except Exception:raise HTTPException(503,"Session authorization is unavailable") from None

def _jwt_fence(token):
    from open_webui.utils.auth import decode_token
    from open_webui.routers.starli_session_revocation import assert_session_allowed,session_family
    if not isinstance(token,str) or not token or len(token)>16384 or token.startswith("sk-"):raise HTTPException(401,"A native session is required")
    payload=decode_token(token)
    if not isinstance(payload,dict) or not isinstance(payload.get("id"),str):raise HTTPException(401,"A native session is required")
    assert_session_allowed(token,payload)
    expiry=float(payload["exp"]) if payload.get("exp") is not None else None
    fence=SessionFence(payload["id"],_hash(token),expiry,family_hash=session_family(token,payload))
    return fence.check(),fence

def capture_request_fence(request,user):
    from open_webui.routers.starli_session_revocation import selected_session_token
    token=selected_session_token(request)
    if token:
        canonical,fence=_jwt_fence(token)
        if canonical.id!=user.id:raise HTTPException(403,"Session identity mismatch")
        return fence
    # API keys remain independent credentials; initial route auth applies endpoint restrictions.
    header=request.headers.get("authorization","")
    if header.startswith("Bearer sk-"):
        key=header[7:]
        fence=SessionFence(user.id,_hash(key),kind="apikey");fence.check();return fence
    raise HTTPException(401,"A native session is required")

def authenticate_socket(token):
    user,fence=_jwt_fence(token)
    return user,{"_starliTokenHash":fence.token_hash,"_starliTokenExpiry":fence.expires_at,"_starliTokenKind":"jwt","_starliFamilyHash":fence.family_hash}

def check_socket_session(session,user_id=None):
    try:
        if not isinstance(session,dict) or (user_id is not None and session.get("id")!=user_id):return False
        digest=session.get("_starliTokenHash")
        if not isinstance(digest,str) or len(digest)!=64:return False
        SessionFence(session["id"],digest,session.get("_starliTokenExpiry"),session.get("_starliTokenKind",""),session.get("_starliFamilyHash")).check()
        return True
    except Exception:return False

async def emit_owner(event,payload,user_id):
    from open_webui.socket.main import sio,USER_POOL,SESSION_POOL
    try:sessions=list(USER_POOL.get(user_id,[]) or [])
    except Exception:return
    for sid in sessions:
        try:session=SESSION_POOL.get(sid)
        except Exception:continue
        if not check_socket_session(session,user_id):
            try:await sio.disconnect(sid)
            except Exception:pass
            continue
        try:await sio.emit(event,payload,to=sid)
        except Exception:pass

async def disconnect_token_hash(digest,family=None):
    from open_webui.socket.main import sio,SESSION_POOL
    for sid in list(SESSION_POOL.keys()):
        session=SESSION_POOL.get(sid)
        if isinstance(session,dict) and (session.get("_starliTokenHash")==digest or (family is not None and (session.get("_starliFamilyHash") or session.get("_starliTokenHash"))==family)):
            try:await sio.disconnect(sid)
            except Exception:pass

_idle_task=None
def ensure_socket_fence_loop():
    global _idle_task
    if _idle_task is None or _idle_task.done():_idle_task=asyncio.create_task(idle_session_fence())
async def idle_session_fence():
    from open_webui.socket.main import sio,SESSION_POOL
    while True:
        await asyncio.sleep(5)
        try:sessions=list(SESSION_POOL.keys())
        except Exception:continue
        for sid in sessions:
            try:session=SESSION_POOL.get(sid)
            except Exception:continue
            if not check_socket_session(session):
                try:await sio.disconnect(sid)
                except Exception:pass


async def stop_socket_fence_loop():
    global _idle_task
    task=_idle_task
    if task is not None and not task.done():
        task.cancel()
        try:await task
        except asyncio.CancelledError:pass
    _idle_task=None
