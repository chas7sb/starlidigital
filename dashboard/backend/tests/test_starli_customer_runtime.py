"""Execution tests for tenant project files, per-agent authority, and durable messaging."""
import asyncio
import hashlib
import importlib
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from open_webui.routers import starli_v3_native as native
from open_webui.routers import starli_workspace as workspace
from open_webui.routers import starli_delivery as delivery
from open_webui.routers import starli_execution_context as authority
from open_webui.routers import starli_runtime_adapter as runtime
from open_webui.routers import starli_pi_master as master
from open_webui.models.users import Users
from open_webui.models.chats import Chats


@pytest.fixture
def customer_runtime(tmp_path, monkeypatch):
    import open_webui.config  # Initialize native Alembic schema in the isolated test DB.
    import dotenv
    monkeypatch.setattr(dotenv,"dotenv_values",lambda *args,**kwargs:{})
    node_db=tmp_path/"node.sqlite"
    c=sqlite3.connect(node_db)
    c.execute("CREATE TABLE records(collection TEXT,id TEXT,owner TEXT,payload TEXT,PRIMARY KEY(collection,id))")
    c.execute("CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,payload TEXT)")
    c.commit();c.close()
    monkeypatch.setattr(workspace,"source_database",lambda:str(node_db))
    from open_webui.routers import starli_customer_identity
    monkeypatch.setattr(starli_customer_identity,"source_database",lambda:str(node_db))
    monkeypatch.setattr(workspace,"state_dir",lambda:tmp_path/"state")
    monkeypatch.setattr(native,"_path",lambda:tmp_path/"registry.sqlite")
    monkeypatch.setattr(runtime,"ROOT",tmp_path/"runtime")
    monkeypatch.setattr(runtime,"EXTERNAL_WORKER",True)
    users={
        "qa-alice":SimpleNamespace(id="qa-alice",role="admin",email="qa-alice@example.invalid",oauth_sub=None),
        "qa-bob":SimpleNamespace(id="qa-bob",role="user",email="qa-bob@example.invalid",oauth_sub=None),
        "qa-linked":SimpleNamespace(id="qa-linked",role="user",email="qa-linked@example.invalid",oauth_sub="starli-node:node-linked"),
    }
    node={"id":"node-linked","role":"USER","disabled":False,"email":"qa-linked@example.invalid"}
    monkeypatch.setattr(native,"_node_user",lambda uid:node if uid==node["id"] else None)
    monkeypatch.setattr(Users,"get_user_by_id",lambda uid:users.get(uid))
    monkeypatch.setattr(runtime,"verified",lambda uid:users[uid])
    monkeypatch.setattr(master,"verified",lambda uid:users[uid])
    with native._db() as db:
        for uid in users:
            native._boss(db,uid)
        db.commit()
    return SimpleNamespace(path=tmp_path,node_db=node_db,alice=users["qa-alice"],bob=users["qa-bob"],linked=users["qa-linked"],users=users)


def specialist(user,name="AGENT1"):
    return native.create_agent(native.CreateAgent(name=name,role="Project engineer"),user=user)


def test_platform_toggle_defaults_off_persists_and_rechecks_each_tool(customer_runtime):
    user=customer_runtime.alice
    agent=specialist(user)
    assert agent["platformAccess"] is False
    assert authority.platform_enabled(user) is False
    with authority.agent_scope(agent["id"]):
        assert authority.platform_enabled(user) is False
        denied=asyncio.run(master._tool(user,"platform.schema",{"tool":"starli_source_list"},"qa-schema-1"))
        assert denied.get("error")
        saved=native.set_platform_access(agent["id"],native.PlatformAccessBody(enabled=True),user=user)
        assert saved["platformAccess"] is True
        assert native.get_agent(agent["id"],user=user)["platformAccess"] is True
        assert authority.platform_enabled(user) is True
        allowed=asyncio.run(master._tool(user,"platform.schema",{"tool":"starli_source_list"},"qa-schema-2"))
        assert allowed.get("executable") is True
        native.set_platform_access(agent["id"],native.PlatformAccessBody(enabled=False),user=user)
        assert authority.platform_enabled(user) is False
        revoked=asyncio.run(master._tool(user,"platform.schema",{"tool":"starli_source_list"},"qa-schema-3"))
        assert revoked.get("error")
    assert authority.current_agent() is None


def test_platform_toggle_cannot_elevate_customer_or_other_owner(customer_runtime):
    bob=customer_runtime.bob
    own=specialist(bob)
    with pytest.raises(HTTPException) as denied:
        native.set_platform_access(own["id"],native.PlatformAccessBody(enabled=True),user=bob)
    assert denied.value.status_code==403
    with authority.agent_scope(own["id"]):
        assert authority.platform_enabled(bob) is False
    with pytest.raises(HTTPException) as hidden:
        native.set_platform_access(own["id"],native.PlatformAccessBody(enabled=True),user=customer_runtime.alice)
    assert hidden.value.status_code==404


def test_project_files_hash_versions_preview_and_other_owner(customer_runtime):
    p=workspace.create("qa-alice","Website","Customer brief")
    first=workspace.write("qa-alice",p["id"],"index.html","<!doctype html><html><head><link rel='stylesheet' href='style.css'></head><body>First<script src='main.js'></script></body></html>")
    workspace.write("qa-alice",p["id"],"style.css","body {color:navy}")
    workspace.write("qa-alice",p["id"],"main.js","document.title='Actual project';")
    read=workspace.tool(customer_runtime.alice,"project_file_read",{"projectId":p["id"],"path":"index.html"})
    assert read["sha256"]==first["sha256"]
    before=workspace.read("qa-alice",p["id"])
    with pytest.raises(HTTPException) as conflict:
        workspace.write("qa-alice",p["id"],"index.html","Stale update","bad-hash")
    assert conflict.value.status_code==409
    assert workspace.read("qa-alice",p["id"])["version"]==before["version"]
    second=workspace.write("qa-alice",p["id"],"index.html",read["content"].replace("First","Second"),read["sha256"])
    assert second["version"]==before["version"]+1
    saved=workspace.read("qa-alice",p["id"])
    assert any(f.get("path")=="index.html" and f.get("content")==read["content"] for v in saved["versions"] for f in v["files"])
    preview=workspace.preview(saved)
    assert preview["available"] is True and "Second" in preview["html"]
    assert "<style>body {color:navy}</style>" in preview["html"]
    assert "<script>document.title='Actual project';</script>" in preview["html"]
    for name in ("project_files","project_file_read","project_file_write","project_preview"):
        with pytest.raises(HTTPException) as hidden:
            workspace.tool(customer_runtime.bob,name,{"projectId":p["id"],"path":"index.html","content":"Bad"})
        assert hidden.value.status_code==404


@pytest.mark.parametrize("path",[".","../outside","/absolute","a/../../outside","a\\outside",".env",".env.production",".git/config","node_modules/pkg/index.js","a//b","a/./b","a/"])
def test_invalid_project_paths_leave_project_unchanged(customer_runtime,path):
    p=workspace.create("qa-alice","Website")
    with pytest.raises(HTTPException) as denied:
        workspace.write("qa-alice",p["id"],path,"no change")
    assert denied.value.status_code==422
    stored=workspace.read("qa-alice",p["id"])
    assert stored["version"]==1
    assert stored["files"]==[]


def test_symlink_escape_cannot_mutate_database_or_outside_files(customer_runtime):
    p=workspace.create("qa-alice","Website")
    root=customer_runtime.path/"state"/"projects"/hashlib.sha256(b"qa-alice").hexdigest()/p["id"]
    root.mkdir(parents=True)
    outside=customer_runtime.path/"outside";outside.mkdir()
    (root/"escape").symlink_to(outside,target_is_directory=True)
    with pytest.raises(HTTPException) as denied:
        workspace.write("qa-alice",p["id"],"escape/payload.txt","must not write")
    assert denied.value.status_code==422
    assert not (outside/"payload.txt").exists()
    stored=workspace.read("qa-alice",p["id"])
    assert stored["version"]==1 and stored["files"]==[]


def test_linked_customer_registry_keeps_webui_identity_but_projects_use_node_owner(customer_runtime):
    user=customer_runtime.linked
    assert native._owner(user)==user.id
    assert workspace.owner(user)=="node-linked"
    p=workspace.create("node-linked","Linked customer project")
    assert workspace.tool(user,"project_files",{"projectId":p["id"]})["id"]==p["id"]
    with pytest.raises(HTTPException):
        workspace.tool(customer_runtime.bob,"project_files",{"projectId":p["id"]})


def test_durable_delivery_is_idempotent_restartable_and_runs_recipient(customer_runtime):
    user=customer_runtime.alice
    agent=specialist(user)
    args={"agentId":agent["id"],"message":"Inspect our customer project and report verified results."}
    first=asyncio.run(delivery.deliver(user,args,"qa-delivery-1"))
    again=asyncio.run(delivery.deliver(user,args,"qa-delivery-1"))
    assert first["deliveryId"]==again["deliveryId"]
    assert first["status"]=="QUEUED"
    with native._db() as db:
        assert db.execute("SELECT count(*) FROM agent_delivery").fetchone()[0]==1
        bindings=list(db.execute("SELECT chat_id FROM agent_conversations WHERE owner=?",(user.id,)))
    assert len(bindings)==2
    for binding in bindings:
        chat=Chats.get_chat_by_id_and_user_id(binding["chat_id"],user.id)
        assert len(chat.chat["history"]["messages"])==1
    with pytest.raises(HTTPException) as conflict:
        asyncio.run(delivery.deliver(user,{**args,"message":"Different request"},"qa-delivery-1"))
    assert conflict.value.status_code==409
    importlib.reload(delivery)  # Lose all process-local module state; durable queue remains.
    asyncio.run(delivery.tick())
    with native._db() as db:
        row=dict(db.execute("SELECT * FROM agent_delivery WHERE id=?",(first["deliveryId"],)).fetchone())
        session=dict(db.execute("SELECT * FROM autonomous_sessions WHERE owner=? AND agent_id=?",(user.id,agent["id"])).fetchone())
    assert row["status"]=="RUNNING" and row["task_id"]
    assert session["enabled"]==1 and session["task_id"]==row["task_id"]
    task=runtime.owned(user.id,row["task_id"])
    assert task["agentId"]==agent["id"]
    assert task["deliveryId"]==first["deliveryId"]
    assert args["message"] in task["prompt"]
    assert task["status"]=="QUEUED"
    with runtime.db() as db:
        task.update(status="COMPLETED",objectiveComplete=True,progress="Verified project inspection completed.")
        db.execute("UPDATE tasks SET payload=? WHERE id=?",(json.dumps(task),task["taskId"]))
    asyncio.run(delivery.tick())
    asyncio.run(delivery.tick())
    with native._db() as db:
        result=dict(db.execute("SELECT * FROM agent_delivery WHERE id=?",(first["deliveryId"],)).fetchone())
        assert db.execute("SELECT count(*) FROM agent_message_routes WHERE id=?",(first["deliveryId"],)).fetchone()[0]==1
    assert result["status"]=="COMPLETED"
    for binding in bindings:
        chat=Chats.get_chat_by_id_and_user_id(binding["chat_id"],user.id)
        assert len(chat.chat["history"]["messages"])==2


def test_foreign_agent_delivery_is_denied_without_queued_work(customer_runtime):
    foreign=specialist(customer_runtime.bob)
    with pytest.raises(HTTPException) as hidden:
        asyncio.run(delivery.deliver(customer_runtime.alice,{"agentId":foreign["id"],"message":"Cannot reach another tenant"},"qa-denied-delivery"))
    assert hidden.value.status_code==404
    with native._db() as db:
        delivery.initialize(db)
        assert db.execute("SELECT count(*) FROM agent_delivery").fetchone()[0]==0


def test_linked_customer_delivery_dispatches_under_webui_user(customer_runtime):
    user=customer_runtime.linked
    agent=specialist(user)
    queued=asyncio.run(delivery.deliver(user,{"agentId":agent["id"],"message":"Work on the linked customer project"},"qa-linked-delivery"))
    asyncio.run(delivery.tick())
    with native._db() as db:
        row=dict(db.execute("SELECT * FROM agent_delivery WHERE id=?",(queued["deliveryId"],)).fetchone())
    assert row["owner"]==user.id and row["status"]=="RUNNING"
    assert runtime.owned(user.id,row["task_id"])["owner"]==user.id


def test_revoked_platform_tool_call_cannot_reach_privileged_transport(customer_runtime,monkeypatch):
    from open_webui.routers import starli_tools, starli_platform
    user=customer_runtime.alice
    agent=specialist(user)
    calls=[]
    class Process:
        returncode=0
        async def communicate(self,payload):
            calls.append(json.loads(payload))
            return (b'{"content":[{"type":"text","text":"verified isolated transport"}]}\n',b'')
    async def spawn(*args,**kwargs):
        return Process()
    monkeypatch.setattr(starli_tools.asyncio,"create_subprocess_exec",spawn)
    monkeypatch.setattr(starli_platform,"principal",lambda actor:(actor.id,{"v2UserId":actor.id}))
    with authority.agent_scope(agent["id"]):
        native.set_platform_access(agent["id"],native.PlatformAccessBody(enabled=True),user=user)
        asyncio.run(starli_tools._bridge(user,"invoke","server_info",{}))
        assert calls[-1]["customer"] is False
        native.set_platform_access(agent["id"],native.PlatformAccessBody(enabled=False),user=user)
        before=len(calls)
        with pytest.raises(HTTPException) as denied:
            asyncio.run(starli_tools._bridge(user,"invoke","server_exec",{"command":"never-executed"}))
        assert denied.value.status_code==403
        assert len(calls)==before
        actual=asyncio.run(master._tool(user,"platform.call",{"tool":"starli_source_list","args":{"path":"src"}},"revoked-call"))
        assert actual.get("error")


def test_paused_recipient_does_not_start_queued_task(customer_runtime):
    user=customer_runtime.alice
    agent=specialist(user)
    queued=asyncio.run(delivery.deliver(user,{"agentId":agent["id"],"message":"Start after authorized"},"qa-paused-delivery"))
    native.update_agent(agent["id"],native.UpdateAgent(status="PAUSED",expectedVersion=agent["version"]),user=user)
    asyncio.run(delivery.tick())
    with native._db() as db:
        row=dict(db.execute("SELECT * FROM agent_delivery WHERE id=?",(queued["deliveryId"],)).fetchone())
    assert row["status"]!="RUNNING"
    assert not row["task_id"]


def test_delivery_recovers_dispatch_crash_even_if_agent_instructions_change(customer_runtime,monkeypatch):
    user=customer_runtime.alice
    agent=specialist(user)
    queued=asyncio.run(delivery.deliver(user,{"agentId":agent["id"],"message":"Inspect our project once"},"qa-dispatch-crash"))
    actual=runtime.adapter
    interrupted=False
    async def crash_after_persist(uid,operation,payload):
        nonlocal interrupted
        result=await actual(uid,operation,payload)
        if operation=="tasks.create" and not interrupted:
            interrupted=True
            raise HTTPException(503,"Simulated API process loss after durable task creation")
        return result
    monkeypatch.setattr(runtime,"adapter",crash_after_persist)
    asyncio.run(delivery.tick())
    with runtime.db() as db:
        assert db.execute("SELECT count(*) FROM tasks").fetchone()[0]==1
    native.update_agent(agent["id"],native.UpdateAgent(instructions="Updated customer role instructions",expectedVersion=agent["version"]),user=user)
    asyncio.run(delivery.tick())
    with native._db() as db:
        row=dict(db.execute("SELECT * FROM agent_delivery WHERE id=?",(queued["deliveryId"],)).fetchone())
    assert row["status"]=="RUNNING",row
    with runtime.db() as db:
        assert db.execute("SELECT count(*) FROM tasks").fetchone()[0]==1


def test_supervisor_capacity_failure_retains_user_steering(customer_runtime,monkeypatch):
    user=customer_runtime.alice
    agent=specialist(user)
    task={"taskId":"qa-completed-before-steering","owner":user.id,"prompt":"Original goal","status":"COMPLETED","progress":"One verified step completed","receipts":[],"connected":True}
    with runtime.db() as db:
        db.execute("INSERT INTO tasks VALUES(?,?,?,?,?)",(task["taskId"],user.id,"qa-original-goal","hash",json.dumps(task)))
    with native._db() as db:
        db.execute("INSERT INTO autonomous_sessions(owner,agent_id,enabled,task_id,updated_at,cycles,objective) VALUES(?,?,1,?,?,0,?)",(user.id,agent["id"],task["taskId"],native._utc(),"Complete customer project"))
        db.execute("INSERT INTO autonomous_steering(owner,agent_id,message,created_at) VALUES(?,?,?,?)",(user.id,agent["id"],"Use the newly approved blue brand colors",native._utc()))
        db.commit()
    async def no_deliveries():pass
    async def full_capacity(*args,**kwargs):raise HTTPException(429,"Temporary worker capacity")
    async def stop_after_iteration(seconds):raise asyncio.CancelledError()
    monkeypatch.setattr(delivery,"tick",no_deliveries)
    monkeypatch.setattr(runtime,"adapter",full_capacity)
    monkeypatch.setattr(native.asyncio,"sleep",stop_after_iteration)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(native._autonomous_supervisor_loop())
    with native._db() as db:
        steering=db.execute("SELECT consumed_at FROM autonomous_steering WHERE owner=? AND agent_id=?",(user.id,agent["id"])).fetchone()
    assert steering["consumed_at"] is None


def test_supervisor_invalid_account_does_not_starve_other_customer(customer_runtime,monkeypatch):
    first=specialist(customer_runtime.alice,"First agent")
    second=specialist(customer_runtime.bob,"Second agent")
    for user,agent in ((customer_runtime.alice,first),(customer_runtime.bob,second)):
        task={"taskId":"qa-completed-"+user.id,"owner":user.id,"prompt":"Customer goal","status":"COMPLETED","progress":"Continue after one verified step","receipts":[],"connected":True}
        with runtime.db() as db:
            db.execute("INSERT INTO tasks VALUES(?,?,?,?,?)",(task["taskId"],user.id,"original-"+user.id,"hash",json.dumps(task)))
        with native._db() as db:
            db.execute("INSERT INTO autonomous_sessions(owner,agent_id,enabled,task_id,updated_at,cycles,objective) VALUES(?,?,1,?,?,0,?)",(user.id,agent["id"],task["taskId"],native._utc(),"Complete customer project"))
            db.commit()
    actual=runtime.adapter
    calls=[]
    async def isolated_adapter(uid,operation,payload):
        calls.append(uid)
        if uid==customer_runtime.alice.id:raise HTTPException(403,"Account no longer authorized")
        return await actual(uid,operation,payload)
    async def no_deliveries():pass
    async def stop_after_iteration(seconds):raise asyncio.CancelledError()
    monkeypatch.setattr(delivery,"tick",no_deliveries)
    monkeypatch.setattr(runtime,"adapter",isolated_adapter)
    monkeypatch.setattr(native.asyncio,"sleep",stop_after_iteration)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(native._autonomous_supervisor_loop())
    assert customer_runtime.bob.id in calls
    with native._db() as db:
        session=db.execute("SELECT task_id FROM autonomous_sessions WHERE owner=? AND agent_id=?",(customer_runtime.bob.id,second["id"])).fetchone()
    assert session["task_id"]!="qa-completed-"+customer_runtime.bob.id


def test_supervisor_late_user_instruction_continues_completed_objective(customer_runtime,monkeypatch):
    user=customer_runtime.alice
    agent=specialist(user)
    task={"taskId":"qa-finished-before-new-request","owner":user.id,"prompt":"Customer goal","status":"COMPLETED","objectiveComplete":True,"progress":"OBJECTIVE_COMPLETE","receipts":[],"connected":True}
    with runtime.db() as db:
        db.execute("INSERT INTO tasks VALUES(?,?,?,?,?)",(task["taskId"],user.id,"completed-goal","hash",json.dumps(task)))
    with native._db() as db:
        db.execute("INSERT INTO autonomous_sessions(owner,agent_id,enabled,task_id,updated_at,cycles,objective) VALUES(?,?,1,?,?,0,?)",(user.id,agent["id"],task["taskId"],native._utc(),"Complete customer project"))
        db.execute("INSERT INTO autonomous_steering(owner,agent_id,message,created_at) VALUES(?,?,?,?)",(user.id,agent["id"],"Also add the approved contact form",native._utc()))
        db.commit()
    async def no_deliveries():pass
    async def stop_after_iteration(seconds):raise asyncio.CancelledError()
    monkeypatch.setattr(delivery,"tick",no_deliveries)
    monkeypatch.setattr(native.asyncio,"sleep",stop_after_iteration)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(native._autonomous_supervisor_loop())
    with native._db() as db:
        session=db.execute("SELECT enabled,task_id FROM autonomous_sessions WHERE owner=? AND agent_id=?",(user.id,agent["id"])).fetchone()
        steering=db.execute("SELECT consumed_at FROM autonomous_steering WHERE owner=? AND agent_id=?",(user.id,agent["id"])).fetchone()
    assert session["enabled"]==1 and session["task_id"]!=task["taskId"]
    assert steering["consumed_at"] is not None
    next_task=runtime.owned(user.id,session["task_id"])
    assert "Also add the approved contact form" in next_task["prompt"]
    assert len(next_task["steeringIds"])==1
