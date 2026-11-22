"""Unmounted native adapter. Imports application dependencies only at registration."""
from fastapi import HTTPException
from .api import create_router
from .store import MemoryScope

def _value(obj,key):
    return obj.get(key) if isinstance(obj,dict) else getattr(obj,key,None)

def _native_agent(user,agent_id):
    from open_webui.routers.starli_v3_native import _db
    # Registry owners are canonical native IDs. Do not translate through Node accounts,
    # create a default boss, bind a chat, or grant platform/admin cross-owner access.
    with _db() as db:
        row=db.execute("SELECT id,owner,status,archived_at FROM agents WHERE id=? AND owner=? AND archived_at IS NULL",
                       (agent_id,_value(user,"id"))).fetchone()
        return dict(row) if row is not None else None

def create_native_router(factory,*,authenticate=None,capture_fence=None,resolve_agent=None):
    """Return a router only; caller separately reviews mount/storage/lifecycle wiring."""
    if authenticate is None:
        from open_webui.utils.auth import get_verified_user
        authenticate=get_verified_user
    if capture_fence is None:
        from open_webui.routers.starli_session_fence import capture_request_fence
        capture_fence=capture_request_fence
    resolver=resolve_agent or _native_agent
    def authorize(user,agent_id,action):
        uid=_value(user,"id")
        if not isinstance(uid,str) or not uid or _value(user,"role") not in ("user","admin"):
            raise HTTPException(403,"MEMORY_ACCOUNT_UNAVAILABLE")
        if action not in ("read","write","history","read_revision"):
            raise HTTPException(403,"MEMORY_ACTION_DENIED")
        try:
            agent=resolver(user,agent_id)
        except HTTPException:raise
        except Exception:
            raise HTTPException(503,"MEMORY_SCOPE_UNAVAILABLE") from None
        if (agent is None or _value(agent,"id")!=agent_id or _value(agent,"owner")!=uid
            or _value(agent,"archived_at") is not None
            or _value(agent,"status") not in ("IDLE","RUNNING","PAUSED","WAITING_INPUT","FAILED","COMPLETED")):
            raise HTTPException(404,"MEMORY_AGENT_UNAVAILABLE")
        return MemoryScope(uid,agent_id)
    return create_router(factory,authenticate,authorize,capture_fence)
