"""Actual-runtime liveness without invented tool calls or status-induced failures."""
import asyncio,json,sqlite3,time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from test_starli_customer_runtime import customer_runtime,specialist
from test_starli_result_status import Process,Input
from open_webui.routers import starli_pi_master as primary
from open_webui.routers import starli_runtime_adapter as runtime
from open_webui.routers import starli_worker_leases as leases
from open_webui.routers import starli_execution_context as execution
from open_webui.routers import starli_delivery as delivery
from open_webui.routers import starli_v3_native as native
from open_webui.routers import starli_tool_trace as trace
from open_webui.models.chats import Chats


class WaitingOutput:
    def __init__(self,events,ready):
        self.events=[(json.dumps(v)+"\n").encode() for v in events]
        self.ready=ready
        self.first=True
    async def readline(self):
        if self.first:
            self.first=False
            await self.ready.wait()
        return self.events.pop(0) if self.events else b""

def bound_agent(setup):
    user=setup.alice
    agent=specialist(user)
    chat_id=delivery.conversation(user.id,agent)
    return user,agent,chat_id

def test_primary_heartbeat_reports_real_work_without_tool_or_history_spam(customer_runtime,monkeypatch):
    user,agent,chat_id=bound_agent(customer_runtime)
    monkeypatch.setattr(trace,"state_dir",lambda:customer_runtime.path/"traces")
    monkeypatch.setattr(primary,"RECEIPTS",customer_runtime.path/"primary.sqlite")
    activity=[];tool_calls=[]
    async def scenario():
        ready=asyncio.Event()
        process=Process([])
        process.stdout=WaitingOutput([{"type":"done","result":"Verified direct answer","receipt":{}}],ready)
        async def spawn(*args,**kwargs):return process
        async def capture(user_id,conversation,actor,phase,*args,**kwargs):
            activity.append((phase,kwargs))
            if phase=="working":ready.set()
        async def no_tool(*args,**kwargs):tool_calls.append(1);raise AssertionError("Heartbeat must not invent a tool call")
        monkeypatch.setattr(primary.asyncio,"create_subprocess_exec",spawn)
        monkeypatch.setattr(execution,"emit_activity",capture)
        monkeypatch.setattr(primary,"_tool",no_tool)
        return await primary._admin_pi_chat(user.id,[{"role":"user","content":"Answer directly"}],chat_id=chat_id)
    result=asyncio.run(scenario())
    assert result=="Verified direct answer"
    assert tool_calls==[]
    assert [phase for phase,_ in activity]==["working","task_completed"]
    assert activity[0][1]["run_id"]==activity[-1][1]["run_id"]
    assert activity[0][1]["run_id"].startswith("primary-")
    records=trace.recent(user.id,chat_id=chat_id)
    assert len(records)==1 and records[0]["tool"]=="runtime.primary" and records[0]["status"]=="COMPLETED"
    assert Chats.get_chat_by_id_and_user_id(chat_id,user.id).chat["messages"]==[]


def test_native_status_and_socket_failures_do_not_fail_successful_primary_tool(customer_runtime,monkeypatch):
    import open_webui.socket.main as socket_main
    user,agent,chat_id=bound_agent(customer_runtime)
    monkeypatch.setattr(trace,"state_dir",lambda:customer_runtime.path/"traces")
    monkeypatch.setattr(primary,"RECEIPTS",customer_runtime.path/"primary.sqlite")
    calls=[];sockets=[]
    async def scenario():
        ready=asyncio.Event()
        events=[{"type":"tool","tool":"platform.call","args":{"tool":"project_files","args":{"projectId":"isolated-project"}}},
                {"type":"done","result":"Tool succeeded despite disconnected UI","receipt":{}}]
        process=Process([]);process.stdout=WaitingOutput(events,ready)
        async def spawn(*args,**kwargs):return process
        async def status(payload):
            ready.set()
            raise RuntimeError("Disconnected native status receiver")
        async def tool(*args,**kwargs):calls.append(1);return {"ok":True,"status":"SAVED"}
        async def emit(name,event,**kwargs):
            sockets.append(kwargs.get("to"))
            if kwargs.get("to")=="unavailable-tab":raise RuntimeError("Disconnected socket")
        monkeypatch.setattr(primary.asyncio,"create_subprocess_exec",spawn)
        monkeypatch.setattr(primary,"_tool",tool)
        monkeypatch.setattr(socket_main,"USER_POOL",{user.id:["unavailable-tab","other-tab"]})
        monkeypatch.setattr(socket_main.sio,"emit",emit)
        return await primary._admin_pi_chat(user.id,[{"role":"user","content":"Inspect project"}],event_emitter=status,chat_id=chat_id)
    result=asyncio.run(scenario())
    assert result=="Tool succeeded despite disconnected UI"
    assert calls==[1] and "other-tab" in sockets
    records=trace.recent(user.id,chat_id=chat_id)
    assert any(r["tool"]=="platform.call:project_files" and r["status"]=="COMPLETED" for r in records)
    assert any(r["tool"]=="runtime.primary" and r["status"]=="COMPLETED" for r in records)


def lease_task(setup):
    user,agent,chat_id=bound_agent(setup)
    created=asyncio.run(runtime.adapter(user.id,"tasks.create",{"prompt":"Work on customer project","idempotencyKey":"live-worker","agentId":agent["id"]}))
    with runtime.db() as db:token=leases.claim(db,created["taskId"],"isolated-worker",ttl=30)
    assert token
    task=runtime.owned(user.id,created["taskId"])
    return user,agent,chat_id,task,token


def test_worker_valid_lease_heartbeat_does_not_create_messages_or_tool_calls(customer_runtime,monkeypatch):
    user,agent,chat_id,task,token=lease_task(customer_runtime)
    activity=[];sleeps=[]
    async def sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps)>1:raise asyncio.CancelledError()
    async def capture(user_id,conversation,actor,phase,*args,**kwargs):
        activity.append((phase,kwargs))
    monkeypatch.setattr(runtime.asyncio,"sleep",sleep)
    monkeypatch.setattr(execution,"emit_activity",capture)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(runtime.lease_loop(task,"isolated-worker",token))
    assert activity==[("working",{"run_id":task["taskId"]})]
    assert Chats.get_chat_by_id_and_user_id(chat_id,user.id).chat["messages"]==[]
    assert runtime.owned(user.id,task["taskId"]).get("stepsCompleted",0)==0


@pytest.mark.parametrize("reason",["paused","cancelled","account_revoked","expired_lease","completed"])
def test_worker_lease_heartbeat_cancels_job_when_authority_is_lost(customer_runtime,monkeypatch,reason):
    user,agent,chat_id,task,token=lease_task(customer_runtime)
    class Job:
        cancelled=0
        def cancel(self):self.cancelled+=1
    job=Job();activity=[]
    monkeypatch.setitem(runtime._ACTIVE,task["taskId"],{"task":job,"process":None})
    if reason=="paused":
        native.update_agent(agent["id"],native.UpdateAgent(status="PAUSED",expectedVersion=agent["version"]),user=user)
    if reason in ("cancelled","completed"):
        saved=dict(task)
        saved.update(cancelRequested=True,status="CANCEL_REQUESTED") if reason=="cancelled" else saved.update(status="COMPLETED")
        with runtime.db() as db:db.execute("UPDATE tasks SET payload=? WHERE id=?",(json.dumps(saved),task["taskId"]))
    if reason=="account_revoked":
        def unavailable(uid):raise HTTPException(403,"Account revoked")
        monkeypatch.setattr(runtime,"verified",unavailable)
    if reason=="expired_lease":
        with runtime.db() as db:db.execute("UPDATE starli_worker_leases SET expires_at=? WHERE task_id=?",(time.time()-1,task["taskId"]))
    async def no_wait(seconds):pass
    async def capture(*args,**kwargs):activity.append(1)
    monkeypatch.setattr(runtime.asyncio,"sleep",no_wait)
    monkeypatch.setattr(execution,"emit_activity",capture)
    asyncio.run(runtime.lease_loop(task,"isolated-worker",token))
    assert job.cancelled==1 and activity==[]


def test_worker_heartbeat_storage_failure_fences_active_job(customer_runtime,monkeypatch):
    user,agent,chat_id,task,token=lease_task(customer_runtime)
    class Job:
        cancelled=0
        def cancel(self):self.cancelled+=1
    job=Job()
    monkeypatch.setitem(runtime._ACTIVE,task["taskId"],{"task":job,"process":None})
    async def no_wait(seconds):pass
    def unavailable(*args,**kwargs):raise sqlite3.OperationalError("Isolated lease storage unavailable")
    monkeypatch.setattr(runtime.asyncio,"sleep",no_wait)
    monkeypatch.setattr(leases,"heartbeat",unavailable)
    asyncio.run(runtime.lease_loop(task,"isolated-worker",token))
    assert job.cancelled==1


def test_primary_reports_actual_fallback_receipt_only_once(customer_runtime,monkeypatch):
    user,agent,chat_id=bound_agent(customer_runtime)
    monkeypatch.setattr(trace,"state_dir",lambda:customer_runtime.path/"traces")
    monkeypatch.setattr(primary,"RECEIPTS",customer_runtime.path/"primary.sqlite")
    receipt={"provider":"openrouter","model":"isolated-fallback-model","fallback":True,"fallbackReason":"HOSTED_UNAVAILABLE"}
    events=[{"type":"tool","tool":"platform.call","args":{"tool":"project_files","args":{"projectId":"isolated"}},"receipt":receipt},
            {"type":"tool","tool":"platform.call","args":{"tool":"project_preview","args":{"projectId":"isolated"}},"receipt":receipt},
            {"type":"done","result":"Verified with configured fallback","receipt":receipt}]
    process=Process(events);statuses=[]
    async def spawn(*args,**kwargs):return process
    async def invoke(*args,**kwargs):return {"ok":True}
    async def emitter(value):statuses.append(value)
    monkeypatch.setattr(primary.asyncio,"create_subprocess_exec",spawn)
    monkeypatch.setattr(primary,"_tool",invoke)
    assert asyncio.run(primary._admin_pi_chat(user.id,[{"role":"user","content":"Inspect project"}],event_emitter=emitter,chat_id=chat_id))=="Verified with configured fallback"
    notices=[v for v in statuses if "Self-hosted inference unavailable" in v["data"]["description"]]
    assert len(notices)==1
    assert len([r for r in trace.recent(user.id,chat_id=chat_id) if r["tool"]=="runtime.provider" and r["status"]=="FALLBACK"])==1


def test_worker_reports_actual_fallback_receipt_only_once(customer_runtime,monkeypatch):
    user,agent,chat_id=bound_agent(customer_runtime)
    created=asyncio.run(runtime.adapter(user.id,"tasks.create",{"prompt":"Inspect project","idempotencyKey":"worker-fallback","agentId":agent["id"]}))
    task=runtime.owned(user.id,created["taskId"]);activity=[]
    receipt={"provider":"openrouter","model":"isolated-fallback-model","fallback":True,"fallbackReason":"HOSTED_UNAVAILABLE"}
    process=Process([{"type":"tool","tool":"platform.call","args":{"tool":"project_files","args":{"projectId":"isolated"}},"receipt":receipt},
                     {"type":"done","result":"Verified outcome","receipt":receipt}])
    async def spawn(*args,**kwargs):return process
    async def invoke(*args,**kwargs):return {"ok":True}
    async def capture(task,phase,**kwargs):activity.append(phase)
    monkeypatch.setattr(runtime.asyncio,"create_subprocess_exec",spawn)
    monkeypatch.setattr(primary,"_tool",invoke)
    monkeypatch.setattr(runtime,"_emit_agent_activity",capture)
    monkeypatch.setitem(runtime._ACTIVE,task["taskId"],{"task":None,"process":None})
    asyncio.run(runtime.run(task,user))
    assert activity.count("provider_fallback")==1
    saved=runtime.owned(user.id,task["taskId"])
    assert saved["fallbackReported"] is True and saved["inferenceProvider"]["model"]=="isolated-fallback-model"


def test_worker_emits_preview_only_around_actual_authorized_file_write(customer_runtime,monkeypatch):
    import open_webui.socket.main as socket_main
    from open_webui.routers import starli_workspace as workspace
    user,agent,chat_id=bound_agent(customer_runtime)
    owner=workspace.owner(user)
    project=workspace.create(owner,"Actual worker site")
    first=workspace.write(owner,project["id"],"index.html","<!doctype html><html><body>Original site</body></html>")
    args={"projectId":project["id"],"path":"index.html","content":"<!doctype html><html><body>Updated real site</body></html>","expectedSha256":first["sha256"]}
    process=Process([{"type":"tool","tool":"platform.call","args":{"tool":"project_file_write","args":args}},
                     {"type":"done","result":"Saved and verified actual customer file","objectiveComplete":True,"receipt":{}}])
    created=asyncio.run(runtime.adapter(user.id,"tasks.create",{"prompt":"Update customer site","idempotencyKey":"worker-preview-integration","agentId":agent["id"]}))
    task=runtime.owned(user.id,created["taskId"])
    sent=[]
    async def spawn(*values,**kwargs):return process
    async def actual_tool(actor,op,payload,key):return workspace.tool(actor,payload["tool"],payload["args"])
    async def emit(name,event,**kwargs):
        if name=="starli-project":sent.append(event)
    monkeypatch.setattr(runtime.asyncio,"create_subprocess_exec",spawn)
    monkeypatch.setattr(primary,"_tool",actual_tool)
    monkeypatch.setattr(socket_main,"USER_POOL",{user.id:["own-tab"]})
    monkeypatch.setattr(socket_main.sio,"emit",emit)
    monkeypatch.setitem(runtime._ACTIVE,task["taskId"],{"task":None,"process":None})
    asyncio.run(runtime.run(task,user))
    assert [event["phase"] for event in sent]==["building","ready"]
    assert all(event["chatId"]==chat_id and event["projectId"]==project["id"] for event in sent)
    assert sent[1]["version"]==sent[0]["version"]+1
    assert runtime.owned(user.id,task["taskId"])["status"]=="COMPLETED"
    assert "Updated real site" in workspace.read(owner,project["id"])["files"][0]["content"]
