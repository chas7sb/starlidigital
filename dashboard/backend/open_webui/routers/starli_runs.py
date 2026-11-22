import os
"""Owner-scoped durable run observation. Reconnecting never executes a task."""
import asyncio
import json
import re
import time
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from open_webui.utils.auth import get_verified_user
from open_webui.models.users import Users
from open_webui.routers import starli_chat_turns
from open_webui.routers import starli_public_activity as activity
from open_webui.routers.starli_session_fence import capture_request_fence

router = APIRouter()
router.include_router(starli_chat_turns.router)
_TERMINAL = frozenset(activity.TERMINAL)
_QUIESCENT = _TERMINAL | frozenset(activity.PAUSED_STATES)
_STREAMS = {}
_MAX_CURSOR = 9223372036854775807

def _ident(value):
    if not isinstance(value,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}",value):
        raise HTTPException(404,"RUN_NOT_FOUND")
    return value

def _owner(user):
    value=user.get("id") if isinstance(user,dict) else getattr(user,"id",None)
    if not isinstance(value,str) or not value:raise HTTPException(401,"AUTHENTICATION_REQUIRED")
    return value

def _read(user,run_id,after=0,limit=100):
    result=activity.read_run(user,_ident(run_id),after=after,limit=limit)
    if not isinstance(result,dict) or not isinstance(result.get("run"),dict):
        raise HTTPException(503,"RUN_STATUS_UNAVAILABLE")
    return result

def _fenced(request,user,run_id,after=0,limit=100):
    fence=capture_request_fence(request,user)
    page=_read(user,run_id,after,limit)
    fence.check(page["run"]["conversationId"])
    return fence,page

@router.get("/capabilities")
async def capabilities(user=Depends(get_verified_user),chatId:str|None=Query(None,max_length=128)):
    owner=_owner(user)
    fresh=Users.get_user_by_id(owner)
    preview=os.environ.get("STARLI_RUNTIME_PREVIEW_READONLY")=="1" and getattr(fresh,"role",None)=="admin"
    project=os.environ.get("STARLI_RUNTIME_OWNED_PROJECTS")=="1" and getattr(fresh,"role",None) in ("user","admin")
    enabled=preview or project
    if chatId:
        from open_webui.routers import starli_v3_native as native
        native._ready(fresh)
        native.owned_live_chat(fresh,chatId)
    admin_descriptor=None
    if chatId and project and getattr(fresh,"role",None)=="admin":
        from open_webui.routers.starli_chat_stream import _admin_identity_if_enabled
        identity=_admin_identity_if_enabled(fresh,chatId)
        if identity is not None:
            from open_webui.routers.starli_admin_policy import AdminScope,capability_scope,capture_identity
            from open_webui.routers.starli_admin_dispatch import schemas
            def authorize_catalog():
                current=Users.get_user_by_id(owner)
                if capture_identity(current,chatId)!=identity:raise HTTPException(403,"ADMIN_SCOPE_CHANGED")
                return current
            available=await schemas(fresh,AdminScope(**identity,run_id="discovery"),authorize_catalog)
            admin_descriptor=capability_scope([item["name"] for item in available])
    descriptor=admin_descriptor or (__import__("open_webui.routers.starli_project_policy",fromlist=["capability_scope"]).capability_scope() if project else None)
    web_tools=[]
    if project and chatId and descriptor is not None:
        from open_webui.routers.starli_chat_stream import _project_identity
        try:
            _project_identity(fresh,chatId)
        except HTTPException as error:
            if error.status_code not in (404,409):raise
            # GET never provisions an agent or converts a selected account provider.
        else:
            from open_webui.routers import starli_search
            available=[item["name"] for item in starli_search.schemas()]
            if available:
                descriptor=starli_search.with_capability(descriptor,available)
                web_tools=list(descriptor["webTools"])
    selector=os.environ.get("STARLI_CHAT_MODEL_ID","starli_pi")
    return {"version":"starli.run.v1","toolEventsVersion":"starli.tool.v1",
            "activityReplay":True,"activitySnapshot":True,"resumeMode":"watch","executionResume":False,
            "cancelMode":"request_then_confirm",
            "runtimePolicy":{"mode":"admin" if admin_descriptor else "owned-projects" if project else "readonly-preview" if preview else "unavailable","platformGrantOverridesOperatorPolicy":False},
            "readOnlyPreview":preview and not project,"previewAvailable":enabled,
            "prepareTurn":enabled,"prepareTurnVersion":"starli.chat.turn.v1" if enabled else None,
            "previewTools":["capabilities","starlis.list"] if preview else [],
            "capabilityScope":descriptor,"webTools":web_tools,
            "availableScopeIds":(["owned-projects.v1"] if project else [])+(["starli-admin.v1"] if project and getattr(fresh,"role",None)=="admin" else []),
            "chatModelId":selector if enabled else None,
            "nativeChatModelIds":[selector] if enabled else []}

@router.get("/{run_id}")
async def status(run_id:str,request:Request,after:int=Query(0,ge=0,le=_MAX_CURSOR),
                 limit:int=Query(100,ge=1,le=200),user=Depends(get_verified_user)):
    _,page=_fenced(request,user,run_id,after,limit)
    return {"version":"starli.run.v1",**page}

@router.post("/{run_id}/resume")
async def resume_watch(run_id:str,request:Request,after:int=Query(0,ge=0,le=_MAX_CURSOR),
                       user=Depends(get_verified_user)):
    # This is an authenticated viewer attachment, not a task create/replay API.
    _,page=_fenced(request,user,run_id,after,100)
    return {"version":"starli.run.v1","resumeMode":"watch","executionResumed":False,
            "run":page["run"],"cursor":page["cursor"],
            "eventsUrl":f"/api/v1/starli/runs/{_ident(run_id)}/events?after={after}"}

@router.post("/{run_id}/cancel")
async def cancel(run_id:str,request:Request,user=Depends(get_verified_user)):
    fence,page=_fenced(request,user,run_id)
    return await cancel_authorized(user,fence,page)

async def cancel_authorized(user,fence,page):
    """Shared physical cancellation after caller-specific authorization."""
    run=page["run"]
    run_id=run["runId"]
    fence.check(run["conversationId"])
    if run.get("status") in _TERMINAL:
        return {"version":"starli.run.v1","run":run,"cancelRequested":False,
                "confirmedTerminal":True}
    owner=_owner(user)
    from open_webui.routers.starli_runtime_adapter import request_run_cancel, aggregate_cancel_status
    from open_webui.routers.starli_chat_stream import get_foreground_status, foreground_cancel
    aggregate=aggregate_cancel_status(owner,run_id)
    if not aggregate.get("cancelRequested"):
        request_run_cancel(owner,run_id)
    foreground=get_foreground_status(owner,run_id)
    if foreground and foreground.get("active"):
        await foreground_cancel(owner,run_id)
    fence.check(run["conversationId"])
    # This helper reads durable executor acknowledgements itself; no caller-supplied status.
    activity.apply_run_cancellation(owner,run_id)
    aggregate=aggregate_cancel_status(owner,run_id)
    current=_read(user,run_id)["run"]
    return {"version":"starli.run.v1","run":current,"cancelRequested":True,
            "confirmedTerminal":bool(aggregate.get("allStopped")) and current.get("status") in _TERMINAL,
            "executionStopped":bool(aggregate.get("allStopped")),
            "needsReview":bool(aggregate.get("uncertain"))}

def _run_event(run,cursor):
    # Public fixed-state metadata only; answer text lives in the native message.
    keys=("runId","requestId","conversationId","assistantMessageId","status",
          "objectiveComplete","needsInput","version")
    return {"version":"starli.run.v1","type":"run.state",
            **{k:run[k] for k in keys if k in run and k!="version"},"cursor":cursor}

@router.get("/{run_id}/events")
async def events(run_id:str,request:Request,after:int=Query(0,ge=0,le=_MAX_CURSOR),
                 user=Depends(get_verified_user)):
    fence,initial=_fenced(request,user,run_id,after,100)
    owner=_owner(user)
    if _STREAMS.get(owner,0)>=8:raise HTTPException(429,"TOO_MANY_RUN_OBSERVERS")
    async def stream():
        if _STREAMS.get(owner,0)>=8:return
        _STREAMS[owner]=_STREAMS.get(owner,0)+1
        cursor=after
        page=initial
        deadline=time.monotonic()+40
        last_heartbeat=time.monotonic()
        last_state=None
        emitted=0
        try:
            while time.monotonic()<deadline and emitted<2000:
                if await request.is_disconnected():return
                fence.check(page["run"]["conversationId"])
                if page.get("replayTruncated"):
                    snapshot=activity.read_snapshot(user,run_id)
                    fence.check(snapshot["run"]["conversationId"])
                    next_cursor=snapshot.get("cursor")
                    if not isinstance(next_cursor,int) or next_cursor<cursor:
                        raise HTTPException(503,"RUN_SNAPSHOT_INVALID")
                    resync={"version":"starli.run.v1","type":"run.resync",
                            "reason":"retention","snapshot":snapshot}
                    yield f"id: {next_cursor}\ndata: {json.dumps(resync,separators=(',',':'))}\n\n"
                    cursor=next_cursor
                    page=_read(user,run_id,cursor,100)
                    last_state=None
                    continue
                for row in page.get("events",[]):
                    # Stored events are already safe exact v1 DTOs; cursor is SSE metadata.
                    next_cursor=row.get("cursor")
                    event=row.get("event")
                    if not isinstance(next_cursor,int) or next_cursor<=cursor or not isinstance(event,dict):
                        raise HTTPException(503,"RUN_ACTIVITY_INVALID")
                    fence.check(page["run"]["conversationId"])
                    yield f"id: {next_cursor}\ndata: {json.dumps(event,separators=(',',':'))}\n\n"
                    cursor=next_cursor
                    emitted+=1
                run=page["run"]
                state=(run.get("status"),run.get("version"))
                if state!=last_state:
                    fence.check(run["conversationId"])
                    yield "data: "+json.dumps(_run_event(run,cursor),separators=(",",":"))+"\n\n"
                    last_state=state
                if run.get("status") in _QUIESCENT and not page.get("hasMore"):return
                if page.get("hasMore"):
                    page=_read(user,run_id,cursor,100)
                    continue
                if time.monotonic()-last_heartbeat>=5:
                    fence.check(run["conversationId"])
                    yield ": heartbeat\n\n"
                    last_heartbeat=time.monotonic()
                await asyncio.sleep(0.5)
                page=_read(user,run_id,cursor,100)
        except HTTPException:
            # A stale/revoked observer receives no further data or private error payload.
            return
        finally:
            _STREAMS[owner]=max(0,_STREAMS.get(owner,1)-1)
            if not _STREAMS[owner]:_STREAMS.pop(owner,None)
    return StreamingResponse(stream(),media_type="text/event-stream",
        headers={"Cache-Control":"no-store","X-Accel-Buffering":"no",
                 "X-Starli-Tool-Events":"v1"})
