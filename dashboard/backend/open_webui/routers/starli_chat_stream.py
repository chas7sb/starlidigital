"""Opt-in public native tool lifecycle SSE; answer text stays in one assistant message."""
import asyncio,contextvars,json,time,uuid,os
from fastapi import HTTPException
from starlette.responses import StreamingResponse
from open_webui.routers.starli_session_fence import capture_request_fence,emit_owner

_CURRENT=contextvars.ContextVar("starli_public_chat_stream",default=None)
_PREVIEW=contextvars.ContextVar("starli_native_readonly_preview",default=False)
def readonly_preview_active():return _PREVIEW.get()
def install_preview(value):return _PREVIEW.set(value is True)
def reset_preview(token):_PREVIEW.reset(token)
_BUDGET_ROOT=contextvars.ContextVar("starli_budget_root",default=None)
_RUNS={}
_TERMINAL={"ANSWERED","COMPLETED","NEEDS_INPUT","FAILED","CANCELLED","INTERRUPTED"}
def _ensure_project_agent(user,chat_id):
    """Provision only a new owned chat; never reinterpret an existing account/provider choice."""
    from open_webui.routers import starli_v3_native as native
    native._ready(user);native.owned_live_chat(user,chat_id)
    owner=native._owner(user)
    with native._db() as registry:
        registry.execute("BEGIN IMMEDIATE");native.owned_live_chat(user,chat_id)
        existing=registry.execute("SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",(owner,chat_id)).fetchone()
        if existing:
            native._get(registry,owner,existing["agent_id"])
            return existing["agent_id"]
        model=native._provider_default_model("hosted")
        native._validate_provider("hosted",model)
        if model not in native._configured_hosted_models() or not os.getenv("STARLI_INFERENCE_BASE_URL"):raise HTTPException(409,"PROJECT_HOSTED_MODEL_NOT_CONFIGURED")
        agent_id="chat:"+chat_id
        collision=registry.execute("SELECT owner FROM agents WHERE id=?",(agent_id,)).fetchone()
        if collision:raise HTTPException(404 if collision["owner"]!=owner else 409,"PROJECT_AGENT_UNAVAILABLE")
        count=registry.execute("SELECT count(*) FROM agents WHERE owner=? AND archived_at IS NULL",(owner,)).fetchone()[0]
        if count>=native._MAX_AGENTS:raise HTTPException(429,"PROJECT_AGENT_LIMIT")
        stamp=native._utc()
        registry.execute("INSERT INTO agents(id,owner,kind,name,role,instructions,status,version,created_at,updated_at,provider,model) VALUES(?,?,'persistent','STARLI','Customer project agent',?,'IDLE',1,?,?,'hosted',?)",(agent_id,owner,"Work on the current owned customer project using authorized tools and real receipts.",stamp,stamp,model))
        registry.execute("INSERT INTO agent_conversations VALUES(?,?,?,?,?)",(owner,agent_id,chat_id,stamp,stamp))
        native._emit(registry,owner,agent_id,"agent.created",{"id":agent_id,"chatId":chat_id,"name":"STARLI"})
        registry.commit()
        return agent_id

def _project_identity(user,chat_id,expected=None):
    from open_webui.routers import starli_v3_native as native
    from open_webui.routers.starli_pi_master import _native_chat_identity
    if getattr(user,"role",None) not in ("user","admin"):raise HTTPException(403,"PROJECT_ACCOUNT_UNAVAILABLE")
    agent=_native_chat_identity(user,chat_id)
    if not agent or agent.get("owner")!=user.id or agent.get("archived_at") is not None:raise HTTPException(404,"PROJECT_AGENT_UNAVAILABLE")
    if agent.get("status")!="IDLE":raise HTTPException(409,"PROJECT_AGENT_NOT_ACTIVE")
    from open_webui.routers.starli_personal_provider import capture_provider
    identity={"agentId":agent["id"],**capture_provider(user,agent,"PROJECT")}
    if expected is not None and identity!=expected:raise HTTPException(409,"PROJECT_AGENT_BINDING_CHANGED")
    return identity

def _admin_identity_if_enabled(user,chat_id):
    if getattr(user,"role",None)!="admin":return None
    from open_webui.routers.starli_pi_master import _native_chat_identity
    agent=_native_chat_identity(user,chat_id)
    if not agent:return None
    from open_webui.routers.starli_execution_context import agent_scope,platform_enabled
    with agent_scope(agent["id"],chat_id):
        enabled=platform_enabled(user)
    if not enabled:return None
    from open_webui.routers.starli_admin_policy import capture_identity
    return capture_identity(user,chat_id)

def _capture_mode(user,chat_id):
    if os.getenv("STARLI_RUNTIME_OWNED_PROJECTS")=="1":
        _ensure_project_agent(user,chat_id)
        admin=_admin_identity_if_enabled(user,chat_id)
        if admin is not None:return "admin",admin
        return "projects",_project_identity(user,chat_id)
    if os.getenv("STARLI_RUNTIME_PREVIEW_READONLY")=="1":
        if user.role!="admin":raise HTTPException(403,"This runtime preview requires the current administrator role")
        return "readonly",None
    return "legacy",None

def _authorize_mode(user,chat_id,mode,identity):
    if mode=="customer":
        from open_webui.routers.starli_customer_context import assert_customer_authority
        context=assert_customer_authority()
        if context is None or context.user_id!=user.id or dict(context.identity)!=identity or context.identity["conversationId"]!=chat_id:
            raise HTTPException(403,"CUSTOMER_PRINCIPAL_REQUIRED")
    elif mode=="admin":
        if os.getenv("STARLI_RUNTIME_OWNED_PROJECTS")!="1":raise HTTPException(403,"ADMIN_SCOPE_REVOKED")
        from open_webui.routers.starli_admin_policy import capture_identity
        if capture_identity(user,chat_id)!=identity:raise HTTPException(403,"ADMIN_SCOPE_CHANGED")
    elif mode=="projects":
        if os.getenv("STARLI_RUNTIME_OWNED_PROJECTS")!="1":raise HTTPException(403,"PROJECT_SCOPE_REVOKED")
        _project_identity(user,chat_id,identity)
    elif mode=="readonly":
        if user.role!="admin" or os.getenv("STARLI_RUNTIME_PREVIEW_READONLY")!="1":raise HTTPException(403,"The runtime preview requires the current administrator role")
    return user

def current_capability_scope():
    scope=_CURRENT.get()
    if scope is None or scope.mode not in {"projects","admin","customer"}:return None
    return json.loads(json.dumps(scope.capability_scope))

def current_project_scope():
    scope=_CURRENT.get()
    return scope.project_scope if scope and scope.mode in ("projects","customer") else None

def current_admin_scope():
    scope=_CURRENT.get()
    return scope.admin_scope if scope and scope.mode=="admin" else None

def current_account_binding(user_id,chat_id):
    scope=_CURRENT.get()
    if scope is None or scope.mode not in {"admin","projects","customer"}:
        return None
    if scope.fence.user_id!=user_id or scope.binding["conversationId"]!=chat_id:
        raise HTTPException(403,"ACCOUNT_SCOPE_MISMATCH")
    scope.authorize()
    return scope.identity.get("account_binding")

def current_admin_schemas():
    scope=_CURRENT.get()
    return json.loads(json.dumps(scope.admin_schemas)) if scope and scope.mode=="admin" else []

def current_search_schemas():
    scope=_CURRENT.get()
    return json.loads(json.dumps(scope.search_schemas)) if scope and scope.mode in {"projects","admin","customer"} else []

async def dispatch_search(user,name,args,call_id):
    scope=_CURRENT.get()
    if scope is None or scope.mode not in {"projects","admin","customer"}:raise HTTPException(403,"SEARCH_SCOPE_REQUIRED")
    scope.authorize()
    from open_webui.routers import starli_search
    identity=scope.admin_scope if scope.mode=="admin" else scope.project_scope
    return await starli_search.dispatch(user,identity,name,args,call_id,scope.authorize,schemas_snapshot=scope.search_schemas)


def current_memory_schemas():
    scope=_CURRENT.get()
    return json.loads(json.dumps(getattr(scope,"memory_schemas",[]))) if scope and scope.mode in {"projects","admin"} else []

def personal_memory_context(phase="model"):
    scope=_CURRENT.get()
    if scope is None or not getattr(scope,"memory_schemas",[]):return None
    from starli_memory.personal_runtime import model_context
    return model_context(phase)

async def dispatch_memory(user,name,args,call_id):
    scope=_CURRENT.get()
    if scope is None or scope.mode not in {"projects","admin"} or name not in (scope.capability_scope or {}).get("memoryTools",[]):raise HTTPException(403,"MEMORY_NATIVE_SCOPE_REQUIRED")
    if getattr(user,"id",None)!=scope.fence.user_id:raise HTTPException(403,"MEMORY_ACCOUNT_UNAVAILABLE")
    from starli_memory.personal_runtime import dispatch
    return dispatch(name,args,call_id)

def current_account_mcp_schemas():
    scope=_CURRENT.get()
    return json.loads(json.dumps(scope.account_mcp_schemas)) if scope and scope.mode in {"projects","admin","customer"} else []

def _capture_account_mcp(request,user,scope):
    service=getattr(request.app.state,"starli_account_mcp_service",None)
    adapter=getattr(request.app.state,"starli_account_mcp_adapter",None)
    if service is None or adapter is None or getattr(adapter,"available",False) is not True:return
    from open_webui.starli_account_mcp.account_mcp.runtime import snapshot
    def authorize_binding(owner,agent,chat,run):
        fresh=scope.fence.check(scope.binding["conversationId"])
        if scope.mode=="customer":
            from open_webui.routers.starli_customer_context import require_context
            require_context(scope.fence)
        else:_authorize_mode(fresh,scope.binding["conversationId"],scope.mode,scope.identity)
        return owner==fresh.id and agent==scope.binding["agentId"] and chat==scope.binding["conversationId"] and run==scope.binding["runId"]
    scope.account_mcp_snapshot=snapshot(user,chat_id=scope.binding["conversationId"],agent_id=scope.binding["agentId"],run_id=scope.binding["runId"],fence=scope.fence,service=service,adapter=adapter,authorize_binding=authorize_binding)
    scope.account_mcp_schemas=scope.account_mcp_snapshot.schemas()
    if scope.account_mcp_schemas:
        scope.capability_scope={**scope.capability_scope,"accountMcpTools":[item["name"] for item in scope.account_mcp_schemas]}

async def dispatch_account_mcp(user,name,args,call_id):
    scope=_CURRENT.get()
    if scope is None or scope.mode not in {"projects","admin","customer"} or scope.account_mcp_snapshot is None:raise HTTPException(403,"MCP_SCOPE_REQUIRED")
    scope.authorize()
    if getattr(user,"id",None)!=scope.fence.user_id:raise HTTPException(403,"MCP_ACCOUNT_DENIED")
    try:
        result=await scope.account_mcp_snapshot.dispatch(name,args,call_id)
    except Exception as error:
        if getattr(error,"unknownEffect",False) or getattr(error,"requiresReview",False):
            return {"ok":False,"errorCode":"MCP_EFFECT_UNKNOWN","requiresReview":True,"automaticRetryAllowed":False,"_mcpRuntime":{"uncertain":True}}
        raise
    if result.get("unknownEffect") or result.get("requiresReview"):
        return {"ok":False,"errorCode":"MCP_EFFECT_REVIEW_REQUIRED","requiresReview":True,"automaticRetryAllowed":False,"_mcpRuntime":{"uncertain":True}}
    return result

def authorize_admin_scope():
    scope=_CURRENT.get()
    if scope is None or scope.mode!="admin":raise HTTPException(403,"ADMIN_SCOPE_REQUIRED")
    return scope.authorize()

def authorize_project_scope():
    scope=_CURRENT.get()
    if scope is None or scope.mode not in ("projects","customer"):raise HTTPException(403,"PROJECT_SCOPE_REQUIRED")
    return scope.authorize()

def current_binding():
    scope=_CURRENT.get()
    return scope.binding if scope else None
def trusted_launch_binding(user,role="subtask"):
    scope=_CURRENT.get()
    if scope is None:return {}
    if scope.mode=="customer":raise HTTPException(403,"CUSTOMER_BACKGROUND_NOT_AVAILABLE")
    if scope.fence.user_id!=user.id:raise HTTPException(403,"Run identity mismatch")
    scope.authorize()
    if role not in {"subtask","handoff"}:raise HTTPException(403,"Invalid internal task role")
    return {"chatId":scope.binding["conversationId"],"assistantMessageId":scope.binding["assistantMessageId"],"runId":scope.binding["runId"],"requestId":scope.binding["requestId"],"budgetRootRunId":scope.binding.get("budgetRootRunId") or scope.binding["runId"],"task_role":role,"completion_owner":role=="handoff"}

def current_run_id():
    binding=current_binding()
    return binding["runId"] if binding else None

class _Scope:
    def __init__(self,binding,fence):
        self.binding=binding;self.fence=fence;self.queue=asyncio.Queue(maxsize=64)
        self.require_admin=False;self.mode="legacy";self.identity=None;self.capability_scope=None;self.project_scope=None;self.admin_scope=None;self.admin_schemas=[];self.search_schemas=[];self.account_mcp_schemas=[];self.account_mcp_snapshot=None
        self.attached=True;self.task=None;self.state="RUNNING";self.finished_at=None;self.calls={};self.handoff_task=None
    def authorize(self,*,allow_mcp_review=False):
        user=self.fence.check(self.binding["conversationId"])
        if self.mode=="customer":
            from open_webui.routers.starli_customer_context import require_context
            context=require_context(self.fence)
            if dict(context.identity)!=self.identity:raise HTTPException(409,"CUSTOMER_BOT_BINDING_CHANGED")
        else:_authorize_mode(user,self.binding["conversationId"],self.mode,self.identity)
        if self.require_admin and (user.role!="admin" or os.getenv("STARLI_RUNTIME_PREVIEW_READONLY")!="1"):raise HTTPException(403,"The runtime preview requires the current administrator role")
        if self.account_mcp_snapshot is not None:
            if not (allow_mcp_review and self.account_mcp_snapshot.needs_review):
                try:self.account_mcp_snapshot.check()
                except HTTPException:raise
                except Exception:raise HTTPException(403,"MCP_SCOPE_REVOKED") from None
        return user
    async def publish(self,event):
        if not self.attached:return
        try:await asyncio.wait_for(self.queue.put(event),1)
        except asyncio.TimeoutError:
            self.detach()
    def detach(self):
        self.attached=False
        while not self.queue.empty():
            try:self.queue.get_nowait()
            except asyncio.QueueEmpty:break

async def start_tool(tool_name,tool_call_id=None):
    scope=_CURRENT.get()
    if scope is None:return None
    scope.authorize()
    from open_webui.routers import starli_public_activity as activity
    call_id=tool_call_id or uuid.uuid4().hex
    event=activity.tool_started(scope.fence.user_id,scope.binding["runId"],tool_name,tool_call_id=call_id,mcp_snapshot=scope.account_mcp_snapshot)
    scope.calls[call_id]=time.monotonic()
    await emit_owner("starli-execution",event,scope.fence.user_id)
    await scope.publish(event)
    return call_id

async def end_tool(call_id,result_status="COMPLETED",error_code=None,*,public_outcome=None):
    scope=_CURRENT.get()
    if scope is None or call_id is None:return
    started=scope.calls.get(call_id)
    if started is None:return
    from open_webui.routers import starli_public_activity as activity
    result_status="INTERRUPTED" if result_status=="UNCERTAIN" else result_status
    if result_status not in {"COMPLETED","QUEUED","PENDING","NEEDS_INPUT","DENIED","FAILED","CANCELLED","INTERRUPTED"}:result_status="FAILED"
    event=activity.tool_finished(scope.fence.user_id,scope.binding["runId"],call_id,result_status=result_status,duration_ms=max(0,int((time.monotonic()-started)*1000)),error_code=error_code,public_outcome=public_outcome)
    scope.calls.pop(call_id,None)
    await emit_owner("starli-execution",event,scope.fence.user_id)
    await scope.publish(event)

def budget_root_run_id():
    binding=current_binding()
    return (binding.get("budgetRootRunId") or binding["runId"]) if binding else _BUDGET_ROOT.get()
def install_budget_root(run_id):return _BUDGET_ROOT.set(run_id)
def reset_budget_root(token):_BUDGET_ROOT.reset(token)

def accept_background(receipt):
    from open_webui.routers.starli_customer_context import assert_customer_authority
    if assert_customer_authority() is not None:raise HTTPException(403,"CUSTOMER_BACKGROUND_NOT_AVAILABLE")
    """Only an actual owned task attached to this canonical run is a full handoff."""
    scope=_CURRENT.get()
    if scope is None or not isinstance(receipt,dict) or not isinstance(receipt.get("taskId"),str):return False
    from open_webui.routers import starli_public_activity as activity
    from open_webui.routers.starli_runtime_adapter import owned
    binding=activity.get_task_run(scope.fence.user_id,receipt["taskId"])
    if not binding or binding["runId"]!=scope.binding["runId"] or binding.get("completionOwner") is not True:return False
    task=owned(scope.fence.user_id,receipt["taskId"])
    if task.get("taskId")!=receipt["taskId"]:return False
    scope.handoff_task=receipt["taskId"]
    return True

def primary_done(answer,objective_complete=False,needs_input=False):
    scope=_CURRENT.get()
    if scope and scope.handoff_task:
        from open_webui.routers import starli_public_activity as activity
        current=activity.get_run(scope.fence.user_id,scope.binding["runId"])
        if current and current.get("status") in (_TERMINAL|{"WAITING_INPUT","BUDGET_EXHAUSTED","CANCEL_REQUESTED"}):
            scope.state=current["status"]
            return scope.state
        state="RUNNING" if current and current.get("status")=="RUNNING" else "QUEUED"
        finish_run(state,answer=answer)
        return state
    if scope:
        from open_webui.routers.starli_runtime_adapter import has_active_subtasks
        if has_active_subtasks(scope.fence.user_id,scope.binding["runId"]):
            finish_run("PENDING",answer=answer)
            return "PENDING"
    # A model's done/status boolean does not prove the entire customer objective.
    # Executor-owned handoffs above supply their own verified terminal state.
    state="NEEDS_INPUT" if needs_input else "ANSWERED"
    finish_run(state,answer=answer,objective_complete=False,needs_input=needs_input)
    return state

def finish_run(status,answer=None,objective_complete=False,needs_input=False):
    scope=_CURRENT.get()
    if scope is None:return
    from open_webui.routers import starli_public_activity as activity
    if scope.state in _TERMINAL:return
    activity.set_run_state(scope.fence.user_id,scope.binding["runId"],status,answer=answer,objective_complete=objective_complete,needs_input=needs_input)
    scope.state=status;scope.finished_at=time.time()

async def finalize_cancelled_worker(process,stop_worker):
    """Record this executor's observed ACK; aggregate authority owns run terminality."""
    terminated=await stop_worker(process)
    scope=_CURRENT.get()
    if scope:
        # Delivery to a viewer must never gate the durable physical-stop ACK.
        async def settle_calls():
            for call_id in list(scope.calls):await end_tool(call_id,"INTERRUPTED")
        try:await asyncio.wait_for(settle_calls(),2)
        except Exception:pass
        from open_webui.routers.starli_runtime_adapter import record_primary_stop_ack
        state=record_primary_stop_ack(scope.fence.user_id,budget_root_run_id() or scope.binding["runId"],terminated)
        if state.get("cancelRequested"):
            scope.state=state["status"]  # apply_run_cancellation is called by the executor authority.
        elif not scope.handoff_task:
            finish_run("INTERRUPTED")
    return terminated

async def text_delta(text):
    scope=_CURRENT.get()
    if scope is None:return
    if not isinstance(text,str) or len(text)>20000:raise ValueError("INVALID_TEXT_DELTA")
    scope.authorize()
    text=text[:max(0,12000-len(getattr(scope,"streamed_text","")))]
    if not text:return
    offset=len(getattr(scope,"streamed_text",""))
    scope.streamed_text=getattr(scope,"streamed_text","")+text
    await emit_owner("starli-execution",{"version":"starli.run.v1","type":"run.text.delta",**scope.binding,"text":text,"textOffset":offset,"textEnd":offset+len(text)},scope.fence.user_id)
    await scope.publish(_chunk(getattr(scope,"model","starli_pi"),text,ident="chatcmpl-"+scope.binding["runId"]))


def get_foreground_status(owner_id,run_id):
    scope=_RUNS.get(run_id)
    if scope is None or scope.fence.user_id!=owner_id:return None
    return {"runId":run_id,"status":scope.state,"connected":bool(scope.attached),"active":scope.task is not None and not scope.task.done(),"requestLocal":True}

async def foreground_cancel(owner_id,run_id):
    scope=_RUNS.get(run_id)
    if scope is None or scope.fence.user_id!=owner_id:return None
    if scope.task is not None and not scope.task.done():
        from open_webui.routers import starli_public_activity as activity
        activity.set_run_state(owner_id,run_id,"CANCEL_REQUESTED")
        scope.state="CANCEL_REQUESTED"
        # Repeated Stop requests must not inject cancellation into worker cleanup.
        if not getattr(scope,"stop_requested",False):
            scope.stop_requested=True
            scope.task.cancel()
        return {"runId":run_id,"status":"CANCEL_REQUESTED"}
    return get_foreground_status(owner_id,run_id)

def _chunk(model,content="",finish=False,ident="chatcmpl-starli"):
    return {"id":ident,"object":"chat.completion.chunk","created":int(time.time()),"model":model,"choices":[{"index":0,"delta":{} if finish else {"content":content},"finish_reason":"stop" if finish else None}]}

def _stream_agent_id(user,chat_id):
    """Native v1 requires a fresh server-owned, active chat/agent/model binding."""
    from open_webui.routers import starli_v3_native as native
    agent_id=native.ensure_chat_agent(user,chat_id)
    if not isinstance(agent_id,str) or not agent_id.strip():raise HTTPException(409,"A native agent binding is required")
    from open_webui.routers.starli_pi_master import _native_chat_identity
    agent=_native_chat_identity(user,chat_id)
    if not agent or agent.get("id")!=agent_id:raise HTTPException(404,"Native agent binding not found")
    if agent.get("status")!="IDLE":raise HTTPException(409,"The native agent is not available")
    provider=agent.get("provider") or ("openrouter" if agent.get("kind")=="boss" else "hosted")
    if provider not in {"account","hosted","openrouter"}:raise HTTPException(409,"The native agent provider is invalid")
    model=agent.get("model") or native._provider_default_model(provider)
    if not isinstance(model,str) or not model.strip() or len(model)>160:raise HTTPException(409,"The native agent model is invalid")
    native._validate_provider(provider,model)
    return agent_id

async def stream_response(request,user,body,chat_id,assistant_message_id,account_request_id=None,*,customer_context=None):
    """All identity/message checks finish before response headers or inference starts."""
    if customer_context is not None:
        from open_webui.routers.starli_customer_context import require_context
        fence=require_context(customer_context)
        if fence.user_id!=user.id:raise HTTPException(403,"CUSTOMER_IDENTITY_MISMATCH")
    else:fence=capture_request_fence(request,user)
    canonical=fence.check(chat_id)
    selector=os.getenv("STARLI_CHAT_MODEL_ID","starli_pi")
    if not isinstance(body,dict) or body.get("model")!=selector:raise HTTPException(422,"PROJECT_MODEL_SELECTOR_INVALID")
    if not isinstance(assistant_message_id,str) or not assistant_message_id or len(assistant_message_id)>128:raise HTTPException(422,"An assistant message identifier is required")
    from open_webui.models.chats import Chats
    chat=Chats.get_chat_by_id_and_user_id(chat_id,canonical.id)
    document=getattr(chat,"chat",None)
    message=((document or {}).get("history",{}).get("messages",{}) or {}).get(assistant_message_id)
    if not isinstance(message,dict) or message.get("role")!="assistant":raise HTTPException(422,"A bound assistant placeholder is required")
    if customer_context is not None:mode,identity="customer",dict(fence.identity)
    else:mode,identity=_capture_mode(canonical,chat_id)
    from open_webui.routers.starli_personal_provider import check_prepared_binding
    check_prepared_binding(document,assistant_message_id,mode,identity)
    from open_webui.routers import starli_public_activity as activity
    for run_id,previous in list(_RUNS.items()):
        if previous.task is not None and previous.task.done() and previous.finished_at and previous.finished_at<time.time()-3600:_RUNS.pop(run_id,None)
    if len(_RUNS)>=256:raise HTTPException(503,"Chat stream capacity is temporarily unavailable")
    request_id=uuid.uuid4().hex;run_id=uuid.uuid4().hex
    admin_schemas=[]
    if mode=="admin":
        from open_webui.routers.starli_admin_policy import AdminScope
        from open_webui.routers.starli_admin_dispatch import schemas as admin_catalog
        discovery=AdminScope(**identity,run_id="discovery")
        def authorize_discovery():
            return _authorize_mode(fence.check(chat_id),chat_id,mode,identity)
        admin_schemas=await admin_catalog(canonical,discovery,authorize_discovery)
    agent_id=identity["agent_id"] if mode=="admin" else identity["agentId"] if mode in ("projects","customer") else _stream_agent_id(canonical,chat_id)
    canonical=fence.check(chat_id)
    if mode!="customer":_authorize_mode(canonical,chat_id,mode,identity)
    binding=activity.bind_run(canonical,chat_id,assistant_message_id,request_id=request_id,run_id=run_id,agent_id=agent_id)
    if binding["runId"] in _RUNS:raise HTTPException(409,"This response already has an active run")
    binding={key:binding[key] for key in ("runId","requestId","conversationId","assistantMessageId","taskId","agentId") if key in binding}
    from open_webui.routers.starli_runtime_adapter import register_primary_executor
    register_primary_executor(canonical.id,binding["runId"])
    scope=_Scope(binding,fence);scope.mode=mode;scope.identity=identity;scope.require_admin=mode=="readonly";scope.started=False;scope.streamed_text=""
    if mode in ("projects","customer"):
        from open_webui.routers.starli_project_policy import ProjectScope,capability_scope
        scope.capability_scope=capability_scope()
        if mode=="customer":
            from open_webui.routers.starli_customer_context import capability_scope as customer_capability_scope
            scope.capability_scope=customer_capability_scope()
        scope.project_scope=ProjectScope(canonical.id,identity["agentId"],binding["runId"],chat_id)
    if mode=="admin":
        from open_webui.routers.starli_admin_policy import AdminScope,capability_scope
        scope.admin_scope=AdminScope(**identity,run_id=binding["runId"])
        scope.admin_schemas=admin_schemas
        scope.capability_scope=capability_scope([item["name"] for item in admin_schemas])
    if mode in {"projects","admin","customer"}:
        from open_webui.routers import starli_search
        scope.search_schemas=starli_search.schemas()
        if scope.search_schemas:
            scope.capability_scope=starli_search.with_capability(scope.capability_scope,[item["name"] for item in scope.search_schemas])
    if mode in {"projects","admin"}:
        from starli_memory.personal_runtime import available_schemas
        scope.memory_factory=(getattr(request.app.state,"workspace_memory_installed",None) or {}).get("factory")
        scope.memory_schemas=available_schemas(scope.memory_factory) if scope.memory_factory is not None else []
        if scope.memory_schemas:scope.capability_scope={**scope.capability_scope,"memoryTools":[item["name"] for item in scope.memory_schemas]}
    if mode in {"projects","admin","customer"}:_capture_account_mcp(request,canonical,scope)
    scope.authorize()
    _RUNS[binding["runId"]]=scope
    model=body.get("model","starli_pi");scope.model=model
    async def producer():
        scope.started=True
        token=_CURRENT.set(scope)
        try:
            from open_webui.routers.starli_pi_master import pi_chat
            if customer_context is not None:
                from open_webui.routers.starli_customer_context import activate
                with activate(customer_context):
                    answer=await pi_chat(canonical.id,body.get("messages",[]),None,account_request_id,chat_id)
            else:answer=await pi_chat(canonical.id,body.get("messages",[]),None,account_request_id,chat_id)
            if scope.state=="RUNNING" and not scope.handoff_task:finish_run("ANSWERED",answer=answer)
            suffix=answer[len(scope.streamed_text):] if scope.streamed_text and answer.startswith(scope.streamed_text) else answer if not scope.streamed_text else ""
            if suffix:await scope.publish(_chunk(model,suffix,ident="chatcmpl-"+binding["runId"]))
            await scope.publish(_chunk(model,finish=True,ident="chatcmpl-"+binding["runId"]))
            await scope.publish("[DONE]")
        except asyncio.CancelledError:
            for call_id in list(scope.calls):await end_tool(call_id,"CANCELLED")
            if scope.state not in _TERMINAL and scope.state!="CANCEL_REQUESTED":
                finish_run("INTERRUPTED")
            await scope.publish("[DONE]")
            raise
        except Exception:
            for call_id in list(scope.calls):await end_tool(call_id,"FAILED",error_code="TOOL_EXECUTION_FAILED")
            finish_run("FAILED")
            await scope.publish({"error":{"code":"STARLI_RUN_FAILED","message":"The run stopped. Check its status before continuing."}})
            await scope.publish("[DONE]")
        finally:
            scope.finished_at=time.time()
            _CURRENT.reset(token)
    scope.task=asyncio.create_task(producer())
    def stopped_before_launch(task):
        if not scope.started and task.cancelled():
            from open_webui.routers.starli_runtime_adapter import record_primary_stop_ack
            try:
                state=record_primary_stop_ack(canonical.id,binding["runId"],True)
                scope.state=state["status"]
            except Exception:scope.state="CANCEL_REQUESTED"
            scope.finished_at=time.time()
    scope.task.add_done_callback(stopped_before_launch)
    async def generate():
        try:
            while True:
                if await request.is_disconnected():return
                try:scope.authorize(allow_mcp_review=True)
                except HTTPException:return
                if not scope.attached:return
                try:event=await asyncio.wait_for(scope.queue.get(),5)
                except asyncio.TimeoutError:
                    if scope.task.done() and scope.queue.empty():return
                    scope.authorize(allow_mcp_review=True)
                    yield ": heartbeat\n\n"
                    continue
                scope.authorize(allow_mcp_review=True)
                if await request.is_disconnected():return
                if event=="[DONE]":
                    yield "data: [DONE]\n\n";return
                yield "data: "+json.dumps(event,separators=(",",":"))+"\n\n"
        finally:
            # Closing a viewer never implicitly cancels the accepted run.
            scope.detach()
    return StreamingResponse(generate(),media_type="text/event-stream",headers={"Cache-Control":"no-store","X-Accel-Buffering":"no","X-Starli-Request-ID":binding["requestId"],"X-Starli-Run-ID":binding["runId"],"Access-Control-Expose-Headers":"X-Starli-Request-ID, X-Starli-Run-ID"})
