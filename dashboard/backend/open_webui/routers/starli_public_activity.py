"""Durable public activity and stable native assistant projections. No private tool inputs."""
from __future__ import annotations
import copy,json,re,sqlite3,time,uuid
from contextlib import contextmanager
from fastapi import HTTPException
from open_webui.routers.starli_state import state_dir

PAUSED_STATES=frozenset({"NEEDS_INPUT","WAITING_INPUT","BUDGET_EXHAUSTED"})
TERMINAL=frozenset({"ANSWERED","COMPLETED","FAILED","DENIED","CANCELLED","INTERRUPTED"})
RUN_STATES=frozenset({"RUNNING","QUEUED","PENDING","NEEDS_INPUT","WAITING_INPUT","BUDGET_EXHAUSTED","CANCEL_REQUESTED",*TERMINAL})
RESULT_CODES=frozenset({"COMPLETED","QUEUED","PENDING","NEEDS_INPUT","DENIED","FAILED","CANCELLED","INTERRUPTED"})
ERROR_CODES=frozenset({"TOOL_FAILED","TOOL_DENIED","TOOL_CANCELLED","TOOL_INTERRUPTED","LOCATION_UNAVAILABLE","AUTHORIZATION_DENIED","TIMEOUT","UNAVAILABLE"})
PUBLIC_TOOL_NAMES=frozenset("""tool web_search web_fetch starli_source_read starli_source_list starli_status platform_capabilities platform_overview api_overview crm_upsert_prospect crm_add_activity outreach_create_draft project_create project_list project_check project_build project_files project_file_read project_file_write project_preview browser.navigate browser.read browser.observe browser.click browser.type browser.key browser.scroll delegate.task delegate.status delegate.cancel starlis.list starlis.message capabilities platform.schema platform.call project.start project.status project.stop crm.search projects_list project_get project_manage website_get_structure website_generate assets_list asset_get asset_ingest_image video_project_create video_project_get video_project_list video_preview video_render crm_companies crm_company_get crm_company_upsert crm_opportunities crm_opportunity_create crm_opportunity_update crm_tasks crm_task_create crm_task_update crm_pipeline_get crm_pipeline_update inbox_search inbox_get_thread inbox_mark_read outreach_create_draft outreach_get_draft outreach_list_drafts outreach_update_draft social_live_location_context social_nearby_moments geo_location_quality geo_distance_to_place geo_direction_to_place geo_nearest_places geo_check_area geo_check_radius geo_travel_estimate geo_reachability social_watchlists social_watchlist_save social_notifications social_notification_mark_read intelligence_context intelligence_sources intelligence_source_create intelligence_watchlists intelligence_watchlist_save intelligence_consent intelligence_observation_add intelligence_insight_add""".split())
SUMMARIES={"COMPLETED":"Tool finished.","QUEUED":"Work was queued.","PENDING":"Work is pending.","NEEDS_INPUT":"More information is needed.","DENIED":"Tool access was denied.","FAILED":"Tool did not finish.","CANCELLED":"Tool was cancelled.","INTERRUPTED":"Tool was interrupted."}
PUBLIC_SEARCH_OUTCOMES={"EMPTY":"No search results.","RATE_LIMITED":"Search is temporarily rate limited."}

def _id(value):
    if not isinstance(value,str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,180}",value):raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_ID")
    return value
def _owner(value):
    uid=value if isinstance(value,str) else value.get("id") if isinstance(value,dict) else getattr(value,"id",None)
    uid=_id(uid)
    from open_webui.models.users import Users
    user=Users.get_user_by_id(uid)
    role=user.get("role") if isinstance(user,dict) else getattr(user,"role",None)
    if not user or role not in ("user","admin"):raise HTTPException(403,"PUBLIC_ACTIVITY_ACCOUNT_UNAVAILABLE")
    return uid
def _chat(owner,chat_id):
    from open_webui.models.chats import Chats
    chat=Chats.get_chat_by_id_and_user_id(chat_id,owner)
    if not chat:raise HTTPException(404,"PUBLIC_ACTIVITY_CHAT_UNAVAILABLE")
    return chat
def _payload(chat):
    value=chat.get("chat") if isinstance(chat,dict) else getattr(chat,"chat",None)
    if not isinstance(value,dict):raise HTTPException(409,"PUBLIC_ACTIVITY_CHAT_INVALID")
    return copy.deepcopy(value)
@contextmanager
def _db():
    root=state_dir();root.mkdir(parents=True,exist_ok=True,mode=0o700)
    db=sqlite3.connect(str(root/"public-activity.sqlite"),timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
    try:
        db.execute("PRAGMA busy_timeout=10000");db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""CREATE TABLE IF NOT EXISTS public_runs(owner TEXT NOT NULL,run_id TEXT NOT NULL,request_id TEXT NOT NULL,chat_id TEXT NOT NULL,message_id TEXT NOT NULL,task_id TEXT,agent_id TEXT NOT NULL,parent_id TEXT,create_allowed INTEGER NOT NULL,status TEXT NOT NULL,answer TEXT,objective_complete INTEGER NOT NULL DEFAULT 0,needs_input INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,last_seq INTEGER NOT NULL DEFAULT 0,projected_version INTEGER NOT NULL DEFAULT 0,created REAL NOT NULL,updated REAL NOT NULL,PRIMARY KEY(owner,run_id),UNIQUE(owner,request_id),UNIQUE(owner,message_id),UNIQUE(owner,task_id));
CREATE TABLE IF NOT EXISTS public_task_runs(owner TEXT NOT NULL,task_id TEXT NOT NULL,run_id TEXT NOT NULL,task_role TEXT NOT NULL DEFAULT 'owner',completion_owner INTEGER NOT NULL DEFAULT 1,task_state TEXT NOT NULL DEFAULT 'RUNNING',PRIMARY KEY(owner,task_id));
CREATE TABLE IF NOT EXISTS public_events(owner TEXT NOT NULL,run_id TEXT NOT NULL,seq INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,run_id,seq));
CREATE TABLE IF NOT EXISTS public_tool_calls(owner TEXT NOT NULL,run_id TEXT NOT NULL,call_id TEXT NOT NULL,tool_name TEXT NOT NULL,started TEXT NOT NULL,finished TEXT,result_code TEXT,PRIMARY KEY(owner,run_id,call_id));""")
        columns={row["name"] for row in db.execute("PRAGMA table_info(public_task_runs)")}
        for name,definition in (("task_role","TEXT NOT NULL DEFAULT 'owner'"),("completion_owner","INTEGER NOT NULL DEFAULT 1"),("task_state","TEXT NOT NULL DEFAULT 'RUNNING'")):
            if name not in columns:db.execute("ALTER TABLE public_task_runs ADD COLUMN "+name+" "+definition)
        yield db
    finally:db.close()
@contextmanager
def _transaction(db):
    db.execute("BEGIN IMMEDIATE")
    try:yield;db.execute("COMMIT")
    except sqlite3.IntegrityError:
        db.execute("ROLLBACK");raise HTTPException(409,"PUBLIC_ACTIVITY_BINDING_IMMUTABLE") from None
    except BaseException:db.execute("ROLLBACK");raise
def _row(db,owner,run_id):
    row=db.execute("SELECT * FROM public_runs WHERE owner=? AND run_id=?",(owner,run_id)).fetchone()
    if not row:raise HTTPException(404,"PUBLIC_ACTIVITY_RUN_UNAVAILABLE")
    return row
def _dto(r):
    return {"runId":r["run_id"],"requestId":r["request_id"],"conversationId":r["chat_id"],"assistantMessageId":r["message_id"],"taskId":r["task_id"],"agentId":r["agent_id"],"status":r["status"],"objectiveComplete":bool(r["objective_complete"]),"needsInput":bool(r["needs_input"]),"version":r["version"],"lastSeq":r["last_seq"],"createdAt":r["created"],"updatedAt":r["updated"]}
def _binding(r):return {k:v for k,v in _dto(r).items() if k in ("runId","requestId","conversationId","assistantMessageId","taskId","agentId")}
def _event(db,r,event):
    seq=r["last_seq"]+1
    event={**_binding(r),**event,"seq":seq,"timestamp":time.time()}
    db.execute("INSERT INTO public_events VALUES(?,?,?,?)",(r["owner"],r["run_id"],seq,json.dumps(event,separators=(",",":"))))
    db.execute("UPDATE public_runs SET last_seq=?,version=version+1,updated=? WHERE owner=? AND run_id=?",(seq,time.time(),r["owner"],r["run_id"]))
    db.execute("DELETE FROM public_events WHERE owner=? AND run_id=? AND seq<=?",(r["owner"],r["run_id"],seq-200))
    return event
def _message(data,message_id):
    history=data.get("history") or {};mapping=history.get("messages") or {}
    values=[]
    if isinstance(mapping,dict) and message_id in mapping:values.append(mapping[message_id])
    values.extend(m for m in data.get("messages",[]) if isinstance(m,dict) and m.get("id")==message_id)
    if any(not isinstance(m,dict) or m.get("role")!="assistant" for m in values):raise HTTPException(409,"PUBLIC_ACTIVITY_ASSISTANT_REQUIRED")
    return values[0] if values else None

def _atomic_chat(owner,chat_id,mutate):
    """Fresh native JSON merge and canonical ordered event share the Native Chat transaction."""
    from open_webui.routers.starli_chat_sync import mutate_native_chat
    return mutate_native_chat(owner,chat_id,mutate)

def _project(owner,run_id):
    owner=_owner(owner)
    with _db() as db:first=_row(db,owner,run_id);chat_id=first["chat_id"]
    applied=[0]
    def merge(data):
        with _db() as db:r=_row(db,owner,run_id);r=dict(r)
        history=dict(data.get("history") or {});mapping=dict(history.get("messages") or {})
        existing=_message(data,r["message_id"])
        if not existing and not r["create_allowed"]:raise HTTPException(409,"PUBLIC_ACTIVITY_ASSISTANT_MISSING")
        if not existing:
            existing={"id":r["message_id"],"role":"assistant","content":"","model":"starli-pi","parentId":r["parent_id"],"childrenIds":[],"timestamp":int(r["created"]),"done":False}
            parent=r["parent_id"]
            if parent in mapping:
                p=dict(mapping[parent]);p["childrenIds"]=list(dict.fromkeys([*(p.get("childrenIds") or []),r["message_id"]]));mapping[parent]=p
            if history.get("currentId")==parent:history["currentId"]=r["message_id"]
        message=dict(existing)
        # A final response updates its bound message, never whichever message is current now.
        if r["answer"] is not None:message["content"]=r["answer"]
        message["done"]=r["status"] in TERMINAL or r["status"] in PAUSED_STATES
        message["starliPublicRun"]={"version":"starli.run.v1",**_binding(r),"status":r["status"],"objectiveComplete":bool(r["objective_complete"]),"needsInput":bool(r["needs_input"]),"lastSeq":r["last_seq"]}
        mapping[r["message_id"]]=message;history["messages"]=mapping;data["history"]=history
        items=[];seen=set();found=False
        for old in data.get("messages",[]):
            if not isinstance(old,dict):items.append(old);continue
            mid=old.get("id")
            if mid and mid in seen:continue
            if mid:seen.add(mid)
            if mid==r["message_id"]:items.append({**old,**message});found=True
            else:items.append(old)
        if not found:
            parent=r["parent_id"];position=next((i+1 for i,m in enumerate(items) if isinstance(m,dict) and m.get("id")==parent),len(items))
            items.insert(position,message)
        data["messages"]=items;applied[0]=r["version"];return data
    _atomic_chat(owner,chat_id,merge)
    with _db() as db:
        db.execute("UPDATE public_runs SET projected_version=? WHERE owner=? AND run_id=? AND version=?",(applied[0],owner,run_id,applied[0]))
def _new_binding(owner,chat_id,message_id,request_id,run_id,task_id,agent_id,create_allowed,task_role="owner",completion_owner=True):
    owner=_owner(owner);chat_id=_id(chat_id);message_id=_id(message_id);request_id=_id(request_id);run_id=_id(run_id)
    task_id=_id(task_id) if task_id is not None else None;agent_id=_id(agent_id) if agent_id else ""
    data=_payload(_chat(owner,chat_id));existing_message=_message(data,message_id)
    if not existing_message and not create_allowed:raise HTTPException(409,"PUBLIC_ACTIVITY_ASSISTANT_REQUIRED")
    parent=existing_message.get("parentId") if existing_message else (data.get("history") or {}).get("currentId")
    if parent is not None:parent=_id(parent)
    with _db() as db:
        with _transaction(db):
            existing=db.execute("SELECT * FROM public_runs WHERE owner=? AND (run_id=? OR request_id=? OR message_id=? OR (task_id IS NOT NULL AND task_id=?))",(owner,run_id,request_id,message_id,task_id)).fetchall()
            created=not existing
            if existing:
                r=existing[0]
                if len(existing)!=1 or any(r[k]!=v for k,v in {"chat_id":chat_id,"message_id":message_id,"request_id":request_id,"run_id":run_id,"task_id":task_id,"agent_id":agent_id}.items()):raise HTTPException(409,"PUBLIC_ACTIVITY_BINDING_IMMUTABLE")
                if not create_allowed and r["status"] in TERMINAL:raise HTTPException(409,"PUBLIC_ACTIVITY_RUN_TERMINAL")
            else:
                at=time.time()
                db.execute("INSERT INTO public_runs(owner,run_id,request_id,chat_id,message_id,task_id,agent_id,parent_id,create_allowed,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,'RUNNING',?,?)",(owner,run_id,request_id,chat_id,message_id,task_id,agent_id,parent,int(create_allowed),at,at))
                r=_row(db,owner,run_id)
            if task_id is not None:
                prior=db.execute("SELECT * FROM public_task_runs WHERE owner=? AND task_id=?",(owner,task_id)).fetchone()
                if prior and (prior["run_id"]!=run_id or prior["task_role"]!=task_role or bool(prior["completion_owner"])!=completion_owner):raise HTTPException(409,"PUBLIC_ACTIVITY_BINDING_IMMUTABLE")
                db.execute("INSERT OR IGNORE INTO public_task_runs(owner,task_id,run_id,task_role,completion_owner,task_state) VALUES(?,?,?,?,?,'RUNNING')",(owner,task_id,run_id,task_role,int(completion_owner)))
            result={**_binding(r),"bindingCreated":created,**({"taskRole":task_role,"completionOwner":completion_owner,"taskState":prior["task_state"] if prior else "RUNNING"} if task_id is not None else {})}
    _project(owner,run_id);return result
def bind_run(user,chat_id,assistant_message_id,*,request_id,run_id,task_id=None,agent_id=""):
    return _new_binding(_owner(user),chat_id,assistant_message_id,request_id,run_id,task_id,agent_id,False)
def bind_task_run(owner_id,chat_id,task_id,*,agent_id="",assistant_message_id=None,run_id=None,request_id=None,task_role="owner",completion_owner=True):
    owner=_owner(owner_id);chat_id=_id(chat_id);task_id=_id(task_id)
    if task_role not in ("owner","handoff","checkpoint","subtask") or not isinstance(completion_owner,bool) or completion_owner!=(task_role!="subtask"):raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_TASK_ROLE")
    old=get_task_run(owner,task_id)
    if old:
        if old["conversationId"]!=chat_id or assistant_message_id and old["assistantMessageId"]!=assistant_message_id or agent_id and old["agentId"]!=agent_id or run_id and old["runId"]!=run_id or request_id and old["requestId"]!=request_id or old["taskRole"]!=task_role or old["completionOwner"]!=completion_owner:raise HTTPException(409,"PUBLIC_ACTIVITY_BINDING_IMMUTABLE")
        return {**old,"bindingCreated":False}
    if run_id is not None:
        run_id=_id(run_id);_chat(owner,chat_id)
        with _db() as db:
            with _transaction(db):
                r=_row(db,owner,run_id)
                if r["chat_id"]!=chat_id or assistant_message_id and r["message_id"]!=assistant_message_id or request_id and r["request_id"]!=request_id or agent_id and r["agent_id"]!=agent_id:raise HTTPException(409,"PUBLIC_ACTIVITY_BINDING_IMMUTABLE")
                if r["status"] in TERMINAL:raise HTTPException(409,"PUBLIC_ACTIVITY_RUN_TERMINAL")
                prior=db.execute("SELECT * FROM public_task_runs WHERE owner=? AND task_id=?",(owner,task_id)).fetchone()
                if prior and (prior["run_id"]!=run_id or prior["task_role"]!=task_role or bool(prior["completion_owner"])!=completion_owner):raise HTTPException(409,"PUBLIC_ACTIVITY_BINDING_IMMUTABLE")
                db.execute("INSERT OR IGNORE INTO public_task_runs(owner,task_id,run_id,task_role,completion_owner,task_state) VALUES(?,?,?,?,?,'RUNNING')",(owner,task_id,run_id,task_role,int(completion_owner)))
                if completion_owner and r["task_id"]!=task_id:db.execute("UPDATE public_runs SET task_id=?,version=version+1,updated=? WHERE owner=? AND run_id=?",(task_id,time.time(),owner,run_id))
                result={**_binding(_row(db,owner,run_id)),"bindingCreated":False,"taskRole":task_role,"completionOwner":completion_owner,"taskState":prior["task_state"] if prior else "RUNNING"}
        _project(owner,run_id);return result
    if not completion_owner:raise HTTPException(422,"PUBLIC_ACTIVITY_SUBTASK_PARENT_REQUIRED")
    suffix=str(uuid.uuid5(uuid.NAMESPACE_URL,"starli-public-task:"+owner+":"+task_id))
    return _new_binding(owner,chat_id,assistant_message_id or suffix,request_id or "task-request:"+suffix,"task-run:"+suffix,task_id,agent_id,True,task_role,completion_owner)
def get_task_run(owner_id,task_id):
    owner=_owner(owner_id);task_id=_id(task_id)
    with _db() as db:
        r=db.execute("SELECT r.*,t.task_role alias_role,t.completion_owner alias_completion,t.task_state alias_state FROM public_runs r JOIN public_task_runs t ON t.owner=r.owner AND t.run_id=r.run_id WHERE t.owner=? AND t.task_id=?",(owner,task_id)).fetchone()
        result={**_binding(r),"taskRole":r["alias_role"],"completionOwner":bool(r["alias_completion"]),"taskState":r["alias_state"]} if r else None
    if result:_chat(owner,result["conversationId"]);_project(owner,result["runId"])
    return result
def _active_subtasks(db,owner,run_id):
    placeholders=",".join("?" for _ in TERMINAL)
    return bool(db.execute("SELECT 1 FROM public_task_runs WHERE owner=? AND run_id=? AND completion_owner=0 AND task_state NOT IN ("+placeholders+") LIMIT 1",(owner,run_id,*TERMINAL)).fetchone())
def has_active_subtasks(owner_id,run_id):
    owner=_owner(owner_id);run_id=_id(run_id)
    with _db() as db:
        r=_row(db,owner,run_id);_chat(owner,r["chat_id"])
        return _active_subtasks(db,owner,run_id)
def get_run(owner_id,run_id):
    owner=_owner(owner_id);run_id=_id(run_id)
    with _db() as db:r=db.execute("SELECT * FROM public_runs WHERE owner=? AND run_id=?",(owner,run_id)).fetchone()
    if not r:return None
    _chat(owner,r["chat_id"]);_project(owner,run_id)
    with _db() as db:return _dto(_row(db,owner,run_id))
def _mcp_public_label(snapshot,tool_name):
    from open_webui.starli_account_mcp.account_mcp.runtime import RuntimeSnapshot
    if not isinstance(snapshot,RuntimeSnapshot) or not isinstance(tool_name,str) or not re.fullmatch(r"mcp_[a-f0-9]{32}__[a-f0-9]{20}",tool_name):raise HTTPException(403,"PUBLIC_ACTIVITY_MCP_SCOPE_INVALID")
    snapshot.check();captured=snapshot.tools.get(tool_name)
    if captured is None:raise HTTPException(403,"PUBLIC_ACTIVITY_MCP_TOOL_UNAVAILABLE")
    label=captured.private_name
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,60}",label) or re.search(r"secret|password|credential|token|bearer|api.?key|sk_",label,re.I) or any(len(word)>24 for word in re.split(r"[_.-]",label)):return "Connected MCP tool"
    return "MCP: "+re.sub(r"[_.-]+"," ",label).strip()

def tool_started(owner_id,run_id,tool_name,*,tool_call_id=None,mcp_snapshot=None):
    owner=_owner(owner_id);run_id=_id(run_id);call_id=_id(tool_call_id) if tool_call_id else str(uuid.uuid4())
    name=tool_name if isinstance(tool_name,str) and tool_name in PUBLIC_TOOL_NAMES else "tool"
    label=None
    if mcp_snapshot is not None and isinstance(tool_name,str) and re.fullmatch(r"mcp_[a-f0-9]{32}__[a-f0-9]{20}",tool_name):
        label=_mcp_public_label(mcp_snapshot,tool_name);name=tool_name
    with _db() as db:
        with _transaction(db):
            r=_row(db,owner,run_id);_chat(owner,r["chat_id"])
            if label is not None and (mcp_snapshot.owner,mcp_snapshot.run,mcp_snapshot.agent,mcp_snapshot.chat)!=(owner,run_id,r["agent_id"],r["chat_id"]):raise HTTPException(403,"PUBLIC_ACTIVITY_MCP_BINDING_CHANGED")
            old=db.execute("SELECT * FROM public_tool_calls WHERE owner=? AND run_id=? AND call_id=?",(owner,run_id,call_id)).fetchone()
            if old:
                if old["tool_name"]!=name:raise HTTPException(409,"PUBLIC_ACTIVITY_CALL_IMMUTABLE")
                return json.loads(old["started"])
            if r["status"] in TERMINAL:raise HTTPException(409,"PUBLIC_ACTIVITY_RUN_TERMINAL")
            if db.execute("SELECT count(*) n FROM public_tool_calls WHERE owner=? AND run_id=?",(owner,run_id)).fetchone()["n"]>=200:raise HTTPException(409,"PUBLIC_ACTIVITY_TOOL_CALL_LIMIT")
            event=_event(db,r,{"version":"starli.tool.v1","type":"tool.lifecycle","toolCallId":call_id,"publicToolName":name,"status":"running","summary":"Using a tool.",**({"publicToolLabel":label} if label is not None else {})})
            db.execute("INSERT INTO public_tool_calls(owner,run_id,call_id,tool_name,started) VALUES(?,?,?,?,?)",(owner,run_id,call_id,name,json.dumps(event)))
    _project(owner,run_id);return event
def tool_finished(owner_id,run_id,tool_call_id,*,result_status="COMPLETED",duration_ms=None,error_code=None,public_outcome=None):
    owner=_owner(owner_id);run_id=_id(run_id);call_id=_id(tool_call_id)
    if not isinstance(result_status,str) or result_status not in RESULT_CODES:raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_RESULT_CODE")
    if duration_ms is not None and (isinstance(duration_ms,bool) or not isinstance(duration_ms,int) or not 0<=duration_ms<=86400000):raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_DURATION")
    if public_outcome is not None and (not isinstance(public_outcome,str) or public_outcome not in PUBLIC_SEARCH_OUTCOMES):raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_OUTCOME")
    error=error_code if isinstance(error_code,str) and error_code in ERROR_CODES else "TOOL_FAILED" if error_code is not None else None
    with _db() as db:
        with _transaction(db):
            r=_row(db,owner,run_id);_chat(owner,r["chat_id"])
            call=db.execute("SELECT * FROM public_tool_calls WHERE owner=? AND run_id=? AND call_id=?",(owner,run_id,call_id)).fetchone()
            if not call:raise HTTPException(409,"PUBLIC_ACTIVITY_CALL_NOT_STARTED")
            if public_outcome is not None and (call["tool_name"]!="web_search" or result_status!="COMPLETED"):raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_OUTCOME")
            if call["finished"]:
                prior=json.loads(call["finished"])
                if call["result_code"]!=result_status or (public_outcome is not None and prior.get("publicOutcome")!=public_outcome):raise HTTPException(409,"PUBLIC_ACTIVITY_CALL_IMMUTABLE")
                return prior
            if r["status"] in TERMINAL:raise HTTPException(409,"PUBLIC_ACTIVITY_RUN_TERMINAL")
            status="failed" if result_status in ("DENIED","FAILED") else "cancelled" if result_status in ("CANCELLED","INTERRUPTED") else "succeeded"
            event={"version":"starli.tool.v1","type":"tool.lifecycle","toolCallId":call_id,"publicToolName":call["tool_name"],"status":status,"resultCode":result_status,"summary":SUMMARIES[result_status]}
            if public_outcome is not None:
                event["publicOutcome"]=public_outcome
                event["summary"]=PUBLIC_SEARCH_OUTCOMES[public_outcome]
            label=json.loads(call["started"]).get("publicToolLabel")
            if isinstance(label,str):event["publicToolLabel"]=label
            if duration_ms is not None:event["durationMs"]=duration_ms
            if error is not None:event["errorCode"]=error
            event=_event(db,r,event)
            db.execute("UPDATE public_tool_calls SET finished=?,result_code=? WHERE owner=? AND run_id=? AND call_id=?",(json.dumps(event),result_status,owner,run_id,call_id))
    _project(owner,run_id);return event

@contextmanager
def _completion_guard(owner,run_id,status):
    if status not in ("COMPLETED","ANSWERED"):
        yield
        return
    from importlib import import_module
    runtime=import_module("open_webui.routers.starli_runtime_adapter")
    guard=getattr(runtime,"completion_guard",None)
    if guard is None:raise HTTPException(503,"PUBLIC_ACTIVITY_COMPLETION_GUARD_UNAVAILABLE")
    # Budget writer lock precedes all Activity DB writes and outlives Activity COMMIT.
    with guard(owner,run_id):
        yield

def set_run_state(owner_id,run_id,status,*,answer=None,objective_complete=False,needs_input=False,resume=False,task_id=None):
    owner=_owner(owner_id);run_id=_id(run_id)
    if not isinstance(status,str) or status not in RUN_STATES or not isinstance(objective_complete,bool) or not isinstance(needs_input,bool) or not isinstance(resume,bool):raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_STATE")
    if answer is not None and (not isinstance(answer,str) or len(answer)>32768 or chr(0) in answer):raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_ANSWER")
    if status=="COMPLETED" and not objective_complete:raise HTTPException(409,"PUBLIC_ACTIVITY_OBJECTIVE_NOT_COMPLETE")
    if status=="ANSWERED" and (not answer or not answer.strip()):raise HTTPException(409,"PUBLIC_ACTIVITY_ANSWER_REQUIRED")
    if objective_complete and status!="COMPLETED":raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_OBJECTIVE_STATE")
    task_id=_id(task_id) if task_id is not None else None
    effective_needs_input=needs_input or status in PAUSED_STATES
    with _completion_guard(owner,run_id,status):
        with _db() as db:
            with _transaction(db):
                r=_row(db,owner,run_id);_chat(owner,r["chat_id"])
                if task_id is not None:
                    actor=db.execute("SELECT completion_owner FROM public_task_runs WHERE owner=? AND run_id=? AND task_id=?",(owner,run_id,task_id)).fetchone()
                    if not actor or not actor["completion_owner"] or r["task_id"]!=task_id:raise HTTPException(409,"PUBLIC_ACTIVITY_COMPLETION_OWNER_REQUIRED")
                elif status in TERMINAL and r["task_id"] is not None:raise HTTPException(409,"PUBLIC_ACTIVITY_COMPLETION_OWNER_REQUIRED")
                if status in TERMINAL and _active_subtasks(db,owner,run_id):raise HTTPException(409,"PUBLIC_ACTIVITY_SUBTASKS_ACTIVE")
                if r["status"] in PAUSED_STATES and status=="RUNNING" and not resume:raise HTTPException(409,"PUBLIC_ACTIVITY_EXPLICIT_RESUME_REQUIRED")
                if r["status"] in TERMINAL:
                    if r["status"]!=status or answer is not None and r["answer"]!=answer or bool(r["objective_complete"])!=objective_complete or bool(r["needs_input"])!=effective_needs_input:raise HTTPException(409,"PUBLIC_ACTIVITY_RUN_TERMINAL")
                elif r["status"]==status and r["answer"]==answer and bool(r["objective_complete"])==objective_complete and bool(r["needs_input"])==effective_needs_input:pass
                else:
                    if r["status"]=="CANCEL_REQUESTED" and status not in ("CANCEL_REQUESTED","CANCELLED","INTERRUPTED","FAILED","DENIED"):raise HTTPException(409,"PUBLIC_ACTIVITY_CANCEL_PENDING")
                    db.execute("UPDATE public_runs SET status=?,answer=COALESCE(?,answer),objective_complete=?,needs_input=? WHERE owner=? AND run_id=?",(status,answer,int(objective_complete),int(effective_needs_input),owner,run_id))
                    r=_row(db,owner,run_id)
                    _event(db,r,{"version":"starli.run.v1","type":"run.state","status":status,"summary":{"ANSWERED":"Answer ready.","COMPLETED":"Task completed.","CANCEL_REQUESTED":"Cancellation requested.","CANCELLED":"Run cancelled.","FAILED":"Run did not finish.","DENIED":"Run access was denied.","INTERRUPTED":"Run interrupted.","QUEUED":"Work was queued.","PENDING":"Work is pending.","NEEDS_INPUT":"More information is needed.","WAITING_INPUT":"Waiting for your input.","BUDGET_EXHAUSTED":"Execution budget reached.","RUNNING":"Working."}[status]})
    _project(owner,run_id)
    with _db() as db:return _dto(_row(db,owner,run_id))
def read_run(user,run_id,*,after=0,limit=100):
    owner=_owner(user);run_id=_id(run_id)
    if isinstance(after,bool) or not isinstance(after,int) or after<0 or isinstance(limit,bool) or not isinstance(limit,int) or not 1<=limit<=200:raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_CURSOR")
    run=get_run(owner,run_id)
    if run is None:raise HTTPException(404,"PUBLIC_ACTIVITY_RUN_UNAVAILABLE")
    with _db() as db:
        rows=db.execute("SELECT seq,payload FROM public_events WHERE owner=? AND run_id=? AND seq>? ORDER BY seq LIMIT ?",(owner,run_id,after,limit+1)).fetchall()
        first=db.execute("SELECT min(seq) n FROM public_events WHERE owner=? AND run_id=?",(owner,run_id)).fetchone()["n"]
    page=rows[:limit];events=[{"cursor":row["seq"],"event":json.loads(row["payload"])} for row in page]
    return {"run":run,"events":events,"cursor":page[-1]["seq"] if page else after,"hasMore":len(rows)>limit,"replayTruncated":bool(first and after<first-1)}

def read_snapshot(user,run_id):
    """Authoritative per-call state for retention resync; never silently truncate."""
    owner=_owner(user);run_id=_id(run_id)
    if get_run(owner,run_id) is None:raise HTTPException(404,"PUBLIC_ACTIVITY_RUN_UNAVAILABLE")
    with _db() as db:
        db.execute("BEGIN")
        try:
            r=_row(db,owner,run_id)
            _chat(owner,r["chat_id"])
            calls=db.execute("SELECT started,finished FROM public_tool_calls WHERE owner=? AND run_id=? LIMIT 201",(owner,run_id)).fetchall()
            if len(calls)>200:raise HTTPException(409,"PUBLIC_ACTIVITY_SNAPSHOT_LIMIT")
            events=[json.loads(call["finished"] or call["started"]) for call in calls]
            if any(not isinstance(event,dict) or event.get("version")!="starli.tool.v1" or event.get("type")!="tool.lifecycle" or not isinstance(event.get("seq"),int) or event["seq"]>r["last_seq"] for event in events):raise HTTPException(409,"PUBLIC_ACTIVITY_SNAPSHOT_INVALID")
            result={"run":_dto(r),"toolCalls":sorted(events,key=lambda event:event["seq"]),"cursor":r["last_seq"]}
            _owner(owner)
            db.execute("COMMIT")
            return result
        except BaseException:
            db.execute("ROLLBACK")
            raise

def set_task_state(owner_id,task_id,status,*,answer=None,objective_complete=False,needs_input=False,resume=False):
    """A child acknowledges its own state without acquiring parent completion authority."""
    owner=_owner(owner_id);task_id=_id(task_id)
    if not isinstance(status,str) or status not in RUN_STATES:raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_STATE")
    if not isinstance(objective_complete,bool) or not isinstance(needs_input,bool) or not isinstance(resume,bool):raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_STATE")
    if answer is not None and (not isinstance(answer,str) or len(answer)>32768 or chr(0) in answer):raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_ANSWER")
    if status=="COMPLETED" and objective_complete is not True:raise HTTPException(409,"PUBLIC_ACTIVITY_OBJECTIVE_NOT_COMPLETE")
    if objective_complete and status!="COMPLETED":raise HTTPException(422,"PUBLIC_ACTIVITY_INVALID_OBJECTIVE_STATE")
    with _db() as db:
        with _transaction(db):
            alias=db.execute("SELECT * FROM public_task_runs WHERE owner=? AND task_id=?",(owner,task_id)).fetchone()
            if not alias:raise HTTPException(404,"PUBLIC_ACTIVITY_TASK_UNAVAILABLE")
            r=_row(db,owner,alias["run_id"]);_chat(owner,r["chat_id"])
            if alias["task_state"] in TERMINAL and alias["task_state"]!=status:raise HTTPException(409,"PUBLIC_ACTIVITY_TASK_TERMINAL")
            if alias["task_state"] in PAUSED_STATES and status=="RUNNING" and not resume:raise HTTPException(409,"PUBLIC_ACTIVITY_EXPLICIT_RESUME_REQUIRED")
            if alias["task_state"]=="CANCEL_REQUESTED" and status not in ("CANCEL_REQUESTED","CANCELLED","INTERRUPTED","FAILED","DENIED"):raise HTTPException(409,"PUBLIC_ACTIVITY_CANCEL_PENDING")
            if alias["completion_owner"] and r["task_id"]!=task_id:raise HTTPException(409,"PUBLIC_ACTIVITY_COMPLETION_OWNER_CHANGED")
            db.execute("UPDATE public_task_runs SET task_state=? WHERE owner=? AND task_id=?",(status,owner,task_id))
            run_id=alias["run_id"];completion_owner=bool(alias["completion_owner"])
    if not completion_owner:
        # Actual child acknowledgement persists privately; parent run/answer remain unchanged.
        return get_run(owner,run_id)
    return set_run_state(owner,run_id,status,answer=answer,objective_complete=objective_complete,needs_input=needs_input,resume=resume,task_id=task_id)

def apply_run_cancellation(owner_id,run_id):
    """Server-only aggregate stop bridge; never accepts an HTTP/model receipt or force flag."""
    owner=_owner(owner_id);run_id=_id(run_id)
    with _db() as db:
        existing=_row(db,owner,run_id)
        _chat(owner,existing["chat_id"])
        if existing["status"] in TERMINAL:return _dto(existing)
    from importlib import import_module
    runtime=import_module("open_webui.routers.starli_runtime_adapter")
    aggregate=runtime.aggregate_cancel_status(owner,run_id)
    required=("cancelRequested","confirmedStopped","allStopped","uncertain")
    if not isinstance(aggregate,dict) or aggregate.get("runId")!=run_id or any(not isinstance(aggregate.get(key),bool) for key in required) or aggregate.get("status") not in ("RUNNING","CANCEL_REQUESTED","CANCELLED","INTERRUPTED"):
        raise HTTPException(503,"PUBLIC_ACTIVITY_CANCEL_AGGREGATE_INVALID")
    for key in ("pendingExecutors","totalExecutors"):
        if isinstance(aggregate.get(key),bool) or not isinstance(aggregate.get(key),int) or not 0<=aggregate[key]<=10000:raise HTTPException(503,"PUBLIC_ACTIVITY_CANCEL_AGGREGATE_INVALID")
    unknown_pending=aggregate["totalExecutors"]==0 and aggregate["pendingExecutors"]==1 and aggregate["cancelRequested"] and not aggregate["allStopped"] and not aggregate["confirmedStopped"]
    if aggregate["pendingExecutors"]>aggregate["totalExecutors"] and not unknown_pending or aggregate["allStopped"] and (aggregate["pendingExecutors"] or aggregate["totalExecutors"]==0) or aggregate["confirmedStopped"] and not aggregate["allStopped"]:raise HTTPException(503,"PUBLIC_ACTIVITY_CANCEL_AGGREGATE_INVALID")
    if not aggregate["cancelRequested"]:raise HTTPException(409,"PUBLIC_ACTIVITY_CANCELLATION_NOT_REQUESTED")
    status="CANCEL_REQUESTED"
    if aggregate["allStopped"] and aggregate["pendingExecutors"]==0:
        if aggregate["uncertain"]:status="INTERRUPTED"
        elif aggregate["confirmedStopped"]:status="CANCELLED"
    with _db() as db:
        with _transaction(db):
            r=_row(db,owner,run_id)
            _owner(owner);_chat(owner,r["chat_id"])
            # Completion may have committed while the authoritative aggregate was being read.
            if r["status"] in TERMINAL:return _dto(r)
            if status in ("CANCELLED","INTERRUPTED"):
                code=status
                for call in db.execute("SELECT call_id,tool_name FROM public_tool_calls WHERE owner=? AND run_id=? AND finished IS NULL",(owner,run_id)).fetchall():
                    r=_row(db,owner,run_id)
                    event=_event(db,r,{"version":"starli.tool.v1","type":"tool.lifecycle","toolCallId":call["call_id"],"publicToolName":call["tool_name"],"status":"cancelled","resultCode":code,"summary":SUMMARIES[code]})
                    db.execute("UPDATE public_tool_calls SET finished=?,result_code=? WHERE owner=? AND run_id=? AND call_id=?",(json.dumps(event),code,owner,run_id,call["call_id"]))
            r=_row(db,owner,run_id);needs_input=status=="INTERRUPTED"
            if r["status"]!=status or bool(r["needs_input"])!=needs_input or bool(r["objective_complete"]):
                db.execute("UPDATE public_runs SET status=?,needs_input=?,objective_complete=0 WHERE owner=? AND run_id=?",(status,int(needs_input),owner,run_id))
                r=_row(db,owner,run_id)
                _event(db,r,{"version":"starli.run.v1","type":"run.state","status":status,"summary":{"CANCEL_REQUESTED":"Cancellation requested.","CANCELLED":"Run cancelled.","INTERRUPTED":"Run interrupted."}[status]})
    _project(owner,run_id)
    with _db() as db:return _dto(_row(db,owner,run_id))
