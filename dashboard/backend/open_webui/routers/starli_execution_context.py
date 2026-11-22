"""Server-owned tool execution scope. Model arguments cannot elevate privileges."""
from contextvars import ContextVar
from contextlib import contextmanager
_agent=ContextVar("starli_execution_agent",default=None)
_chat=ContextVar("starli_execution_chat",default=None)
@contextmanager
def agent_scope(agent_id,chat_id=None):
    token=_agent.set(agent_id);chat_token=_chat.set(chat_id)
    try:yield
    finally:_agent.reset(token);_chat.reset(chat_token)
def current_agent():return _agent.get()
def current_chat():return _chat.get()
def platform_enabled(user):
    from open_webui.routers.starli_customer_context import assert_customer_authority
    if assert_customer_authority() is not None:return False
    uid=user.get("id") if isinstance(user,dict) else getattr(user,"id",None)
    try:
        from open_webui.models.users import Users
        user=Users.get_user_by_id(uid)
    except Exception:return False
    if user is None or getattr(user,"role",None)!="admin" or not current_agent():return False
    from open_webui.routers import starli_v3_native as native
    with native._db() as db:
        row=db.execute("SELECT platform_access FROM agents WHERE id=? AND owner=? AND archived_at IS NULL AND status='IDLE'",(current_agent(),native._owner(user))).fetchone()
    return bool(row and row["platform_access"])

async def emit_activity(user,chat_id,agent_id,phase,tool="",step=0,tool_status=None,args=None,trace_id=None,run_id=None):
    if not chat_id or not agent_id:return
    from open_webui.routers.starli_chat_stream import current_binding
    if current_binding() and phase!="working":return  # Public per-call events replace legacy trace messages.
    import time
    from open_webui.socket.main import sio,USER_POOL
    from open_webui.routers.starli_result_status import public_paths
    event={"id":trace_id,"runId":run_id,"toolStatus":tool_status,"chatId":chat_id,"agentId":agent_id,"phase":phase,"tool":tool,"stepsCompleted":step,"timestamp":time.time()}
    from open_webui.routers.starli_session_fence import emit_owner
    await emit_owner("starli-execution",event,user.id)
