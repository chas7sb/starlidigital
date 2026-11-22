"""Real dispatcher classification and customer activity history boundaries."""
import asyncio,json,sqlite3
from pathlib import Path
import pytest
from fastapi import HTTPException
from test_starli_customer_runtime import customer_runtime,specialist
from open_webui.routers import starli_result_status as result_status
from open_webui.routers import starli_runtime_adapter as runtime
from open_webui.routers import starli_pi_master as primary
from open_webui.routers import starli_delivery as delivery
from open_webui.routers import starli_tool_trace as trace
from open_webui.routers import starli_workspace as workspace

@pytest.mark.parametrize("value,status",[
    ({"content":[{"type":"text","text":"Tool rejected"}],"isError":True},"FAILED"),
    ({"content":[{"type":"text","text":"Access denied: requires read scope"}],"isError":True},"DENIED"),
    ({"content":[{"type":"text","text":json.dumps({"ok":False,"status":"FAILED","error":"Provider rejected"})}]},"FAILED"),
    ({"structuredContent":{"ok":False,"error":{"code":"ACCESS_DENIED","message":"No access"}}},"DENIED"),
    ({"ok":False,"status":"FAILED"},"FAILED"),
    ({"success":False},"FAILED"),
    ({"status":"UNCERTAIN","isError":True},"UNCERTAIN"),
    ({"status":"QUEUED","taskId":"safe-task"},"PENDING"),
    ({"status":"CANCELLED"},"CANCELLED"),
    ({"error":"Tool request rejected","status":403},"DENIED"),
    ({"status":"403"},"DENIED"),
    ({"status":"404"},"FAILED"),
    ({"ok":True,"data":{"error":"Customer data is not a tool failure"}},"COMPLETED"),
    ({"content":[{"type":"text","text":"ordinary successful content"}]},"COMPLETED"),
    (None,"FAILED"),
])
def test_result_envelopes_do_not_report_false_completion(value,status):
    assert result_status.classify_result(value)["status"]==status

def test_classification_never_returns_raw_error_secret():
    value={"isError":True,"error":{"message":"invalid secret sk-example-not-a-real-key","code":"sk-example-not-a-real-key"}}
    classified=result_status.classify_result(value)
    assert classified["status"]=="FAILED"
    assert "sk-example" not in json.dumps(classified)

def test_customer_paths_are_allowlisted_and_omit_contents():
    assert result_status.public_paths({"path":"src/app.ts","content":"private source","paths":["index.html","/etc/passwd",".env","../escape.py","src/secrets.json","node_modules/pkg/a.js"]})==["src/app.ts","index.html"]

class Input:
    def __init__(self):self.lines=[]
    def write(self,data):self.lines.append(data)
    async def drain(self):pass
class Output:
    def __init__(self,events):self.lines=[(json.dumps(event)+"\n").encode() for event in events]
    async def readline(self):return self.lines.pop(0) if self.lines else b""
class Process:
    def __init__(self,events):self.stdin=Input();self.stdout=Output(events);self.returncode=0
    async def wait(self):return self.returncode
    def terminate(self):self.returncode=0
    def kill(self):self.returncode=0

def fake_events():
    return [{"type":"tool","tool":"platform.call","args":{"tool":"project_file_read","args":{"projectId":"prj-isolated","path":"src/app.ts"}}},
            {"type":"done","result":"The tool returned a failure that was reported accurately.","receipt":{}}]

@pytest.mark.parametrize("envelope,expected",[
 ({"isError":True,"content":[{"type":"text","text":"Rejected"}]},"FAILED"),
 ({"ok":False,"status":"FAILED","error":"No completion"},"FAILED"),
 ({"isError":True,"status":"UNCERTAIN","content":[]},"UNCERTAIN"),
])
def test_primary_dispatcher_records_actual_tool_failure(customer_runtime,monkeypatch,envelope,expected):
    user=customer_runtime.alice;agent=specialist(user);chat_id=delivery.conversation(user.id,agent)
    monkeypatch.setattr(trace,"state_dir",lambda:customer_runtime.path/"traces")
    monkeypatch.setattr(primary,"RECEIPTS",customer_runtime.path/"primary.sqlite")
    process=Process(fake_events())
    async def spawn(*args,**kwargs):return process
    async def invoke(*args,**kwargs):return envelope
    monkeypatch.setattr(primary.asyncio,"create_subprocess_exec",spawn)
    monkeypatch.setattr(primary,"_tool",invoke)
    text=asyncio.run(primary._admin_pi_chat(user.id,[{"role":"user","content":"Read a project file"}],chat_id=chat_id))
    assert "reported accurately" in text
    records=trace.recent(user.id,chat_id=chat_id)
    statuses=[r["status"] for r in records if r["tool"]=="platform.call:project_file_read"]
    assert sorted(statuses)==sorted(["STARTED",expected])
    assert any(r["tool"]=="runtime.primary" and r["status"]=="COMPLETED" for r in records)

def test_autonomous_dispatcher_records_mcp_failure_and_terminal_state(customer_runtime,monkeypatch):
    user=customer_runtime.alice;agent=specialist(user);chat_id=delivery.conversation(user.id,agent)
    monkeypatch.setattr(trace,"state_dir",lambda:customer_runtime.path/"traces")
    created=asyncio.run(runtime.adapter(user.id,"tasks.create",{"prompt":"Inspect project","idempotencyKey":"classification-worker","agentId":agent["id"]}))
    task=runtime.owned(user.id,created["taskId"])
    process=Process(fake_events())
    async def spawn(*args,**kwargs):return process
    async def invoke(*args,**kwargs):return {"isError":True,"content":[{"type":"text","text":json.dumps({"ok":False,"status":"FAILED"})}]}
    monkeypatch.setattr(runtime.asyncio,"create_subprocess_exec",spawn)
    monkeypatch.setattr(primary,"_tool",invoke)
    runtime._ACTIVE[task["taskId"]]={"task":None,"process":None}
    asyncio.run(runtime.run(task,user))
    records=trace.recent(user.id,chat_id=chat_id)
    statuses=[r["status"] for r in records if r["tool"]=="platform.call:project_file_read"]
    assert sorted(statuses)==["FAILED","STARTED"]
    assert any(r["tool"]=="runtime.task" and r["status"]=="COMPLETED" for r in records)
    saved=runtime.owned(user.id,task["taskId"])
    assert any("failed" in receipt for receipt in saved["receipts"])
    assert not any("completed" in receipt.lower() for receipt in saved["receipts"] if receipt.startswith("platform.call:"))

def test_history_pagination_has_stable_tie_cursor_and_private_paths(customer_runtime,monkeypatch):
    user=customer_runtime.alice;agent=specialist(user);chat_id=delivery.conversation(user.id,agent)
    monkeypatch.setattr(trace,"state_dir",lambda:customer_runtime.path/"traces")
    with trace._db() as db:
        for n in range(205):
            db.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",(f"{n:032x}",user.id,chat_id,"isolated-task",1000.0,"project_file_write","FAILED",json.dumps({"path":"src/app.ts","content":"MUST_NOT_LEAK","token":"MUST_NOT_LEAK"})))
        db.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",(f"{205:032x}",user.id,chat_id,"isolated-task",1000.0,"runtime.task","COMPLETED","{}"))
    first=workspace.chat_activity(chat_id,user=user)
    assert first["hasMore"] is True and len(first["events"])==200
    assert first["events"][-1]["phase"]=="task_completed"
    assert "MUST_NOT_LEAK" not in json.dumps(first)
    assert next(v for v in first["events"] if v["tool"]=="project_file_write")["paths"]==["src/app.ts"]
    second=workspace.chat_activity(chat_id,before=first["before"],before_id=first["beforeId"],user=user)
    assert second["hasMore"] is False and len(second["events"])==6
    assert not ({v["id"] for v in first["events"]}&{v["id"] for v in second["events"]})
    with pytest.raises(HTTPException) as denied:workspace.chat_activity(chat_id,user=customer_runtime.bob)
    assert denied.value.status_code==404
