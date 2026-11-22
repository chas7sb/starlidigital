"""Preview notifications are scoped real project activity, never generic tool chatter."""
import asyncio
import pytest
from test_starli_customer_runtime import customer_runtime,specialist
from open_webui.routers import starli_preview_events as events
from open_webui.routers import starli_workspace as workspace
from open_webui.routers import starli_v3_native as native
from open_webui.routers import starli_delivery as delivery

@pytest.fixture
def preview_context(customer_runtime,monkeypatch):
    import open_webui.socket.main as socket_main
    user=customer_runtime.alice;agent=specialist(user);chat=delivery.conversation(user.id,agent)
    owner=workspace.owner(user);project=workspace.create(owner,"Real website")
    workspace.write(owner,project["id"],"index.html","<!doctype html><html><body>Actual website</body></html>")
    sent=[]
    async def emit(name,payload,**kwargs):sent.append((name,payload,kwargs.get("to")))
    monkeypatch.setattr(socket_main,"USER_POOL",{user.id:["own-tab-1","own-tab-2"],customer_runtime.bob.id:["other-customer-tab"]})
    monkeypatch.setattr(socket_main.sio,"emit",emit)
    return customer_runtime,user,agent,chat,project,sent

def test_real_ui_file_activity_only_emits_to_authenticated_owner_rooms(preview_context):
    setup,user,agent,chat,project,sent=preview_context
    asyncio.run(events.project_activity(user,chat,agent["id"],"project_file_write",{"projectId":project["id"],"path":"index.html"},phase="building",run_id="real-run"))
    assert len(sent)==2
    assert {room for _,_,room in sent}=={"own-tab-1","own-tab-2"}
    assert all(name=="starli-project" for name,_,_ in sent)
    payload=sent[0][1]
    assert payload["chatId"]==chat and payload["agentId"]==agent["id"]
    assert payload["projectId"]==project["id"] and payload["showPreview"] is True
    assert payload["phase"]=="building" and payload["explicitShow"] is False
    assert len(payload["buildKey"])==64
    assert "html" not in payload and "content" not in payload

def test_foreign_project_and_foreign_chat_cannot_emit_preview(preview_context):
    setup,user,agent,chat,project,sent=preview_context
    foreign=workspace.create("qa-bob","Private other project")
    foreign_agent=specialist(setup.bob,"Other agent");foreign_chat=delivery.conversation(setup.bob.id,foreign_agent)
    asyncio.run(events.project_activity(user,chat,agent["id"],"project_preview",{"projectId":foreign["id"]},phase="ready"))
    asyncio.run(events.project_activity(user,foreign_chat,agent["id"],"project_preview",{"projectId":project["id"]},phase="ready"))
    assert sent==[]

def test_crm_read_and_non_ui_project_file_never_open_preview(preview_context):
    setup,user,agent,chat,project,sent=preview_context
    plain=workspace.create("qa-alice","Notes project")
    workspace.write("qa-alice",plain["id"],"README.md","Customer notes")
    asyncio.run(events.project_activity(user,chat,agent["id"],"crm_upsert_prospect",{"name":"Client"}))
    asyncio.run(events.project_activity(user,chat,agent["id"],"project_file_read",{"projectId":project["id"],"path":"index.html"}))
    asyncio.run(events.project_activity(user,chat,agent["id"],"project_file_write",{"projectId":plain["id"],"path":"README.md"}))
    assert sent==[]

def test_failed_tool_does_not_claim_ready_preview(preview_context):
    setup,user,agent,chat,project,sent=preview_context
    asyncio.run(events.project_activity(user,chat,agent["id"],"website_generate",{"projectId":project["id"]},{"isError":True,"content":[{"type":"text","text":"Build failed"}]},phase="ready"))
    assert sent==[]

def test_explicit_show_event_can_reopen_actual_completed_app(preview_context):
    setup,user,agent,chat,project,sent=preview_context
    asyncio.run(events.project_activity(user,chat,agent["id"],"project_preview",{"projectId":project["id"]},{"available":True},phase="ready",run_id="show-this-app"))
    assert sent[0][1]["explicitShow"] is True
    assert sent[0][1]["version"]==workspace.read("qa-alice",project["id"])["version"]

def test_autonomous_goal_build_key_is_stable_across_file_steps(preview_context):
    setup,user,agent,chat,project,sent=preview_context
    with native._db() as db:
        db.execute("INSERT INTO autonomous_sessions(owner,agent_id,enabled,task_id,updated_at,cycles,objective) VALUES(?,?,1,?,?,0,?)",(user.id,agent["id"],"actual-task",native._utc(),"Build the customer website"))
        db.commit()
    asyncio.run(events.project_activity(user,chat,agent["id"],"project_file_write",{"projectId":project["id"],"path":"index.html"},run_id="first-bounded-step"))
    first=sent[-1][1]["buildKey"]
    asyncio.run(events.project_activity(user,chat,agent["id"],"project_file_write",{"projectId":project["id"],"path":"style.css"},run_id="second-bounded-step"))
    assert sent[-1][1]["buildKey"]==first

def test_platform_preview_requires_persisted_agent_toggle_on_every_event(preview_context):
    setup,user,agent,chat,project,sent=preview_context
    foreign=workspace.create("qa-bob","Authorized platform review")
    args={"projectId":foreign["id"]}
    asyncio.run(events.project_activity(user,chat,agent["id"],"project_preview",args,phase="ready"))
    assert sent==[]
    native.set_platform_access(agent["id"],native.PlatformAccessBody(enabled=True),user=user)
    asyncio.run(events.project_activity(user,chat,agent["id"],"project_preview",args,phase="ready"))
    assert sent[-1][1]["projectId"]==foreign["id"]
    sent.clear()
    native.set_platform_access(agent["id"],native.PlatformAccessBody(enabled=False),user=user)
    asyncio.run(events.project_activity(user,chat,agent["id"],"project_preview",args,phase="ready"))
    assert sent==[]
