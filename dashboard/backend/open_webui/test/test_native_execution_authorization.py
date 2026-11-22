"""Native execution authorization regressions. No provider/network/production writes."""
import asyncio,json
from types import SimpleNamespace as Obj
from unittest.mock import AsyncMock
import pytest
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from open_webui import tasks
from open_webui.socket import main as sockets
from open_webui.utils import native_authorization as authz
from open_webui.utils import tools
from open_webui.models.users import Users
from open_webui.routers import memories
from open_webui.utils.auth import get_current_user

@pytest.fixture
def identities(monkeypatch):
 owner=Obj(id="owner",role="user",email="owner@example.test",name="Owner")
 other=Obj(id="other",role="user",email="other@example.test",name="Other")
 records={"owner":owner,"other":other}
 monkeypatch.setattr(Users,"get_user_by_id",lambda uid:records.get(uid))
 monkeypatch.setattr(sockets,"SESSION_POOL",{"mine":{"id":"owner","role":"admin"},"victim":{"id":"other","role":"admin"}})
 monkeypatch.setattr(sockets,"USER_POOL",{"owner":["mine"],"other":["victim"]})
 monkeypatch.setattr(sockets.Chats,"get_chat_by_id",lambda ident:Obj(user_id="owner") if ident=="own-chat" else Obj(user_id="other"))
 return owner,other,records

def test_socket_caller_cannot_target_foreign_session(identities,monkeypatch):
 call=AsyncMock(return_value={"ok":True})
 monkeypatch.setattr(sockets.sio,"call",call)
 async def check():
  bad=await sockets.get_event_call({"user_id":"owner","session_id":"victim","chat_id":"own-chat"})({"type":"execute:python"})
  assert "error" in bad
  assert await sockets.get_event_call({"user_id":"owner","session_id":"mine","chat_id":"own-chat"})({"type":"execute:python"})=={"ok":True}
 asyncio.run(check())
 assert call.await_count==1 and call.call_args.kwargs["to"]=="mine"

def test_socket_caller_rechecks_current_role_and_chat(identities,monkeypatch):
 owner,other,records=identities
 call=AsyncMock()
 monkeypatch.setattr(sockets.sio,"call",call)
 async def check():
  assert "error" in await sockets.get_event_call({"user_id":"owner","session_id":"mine","chat_id":"foreign-chat"})({})
  records["owner"]=Obj(id="owner",role="pending")
  assert "error" in await sockets.get_event_call({"user_id":"owner","session_id":"mine","chat_id":"own-chat"})({})
 asyncio.run(check())
 call.assert_not_awaited()

def test_event_emitter_filters_forged_sid_even_in_user_pool(identities,monkeypatch):
 emit=AsyncMock()
 monkeypatch.setattr(sockets.sio,"emit",emit)
 sockets.USER_POOL["owner"]=["mine","victim"]
 asyncio.run(sockets.get_event_emitter({"user_id":"owner","session_id":"victim","chat_id":"own-chat"},False)({"type":"test"}))
 assert emit.await_count==1 and emit.call_args.kwargs["to"]=="mine"

def test_tasks_are_owner_scoped_and_foreign_stop_has_no_effect():
 async def idle():await asyncio.Event().wait()
 async def check():
  first,a=tasks.create_task(idle(),id="chat-a",user_id="a")
  second,b=tasks.create_task(idle(),id="chat-b",user_id="b")
  assert tasks.list_tasks(user_id="a")==[first]
  assert tasks.list_tasks(user_id="b")==[second]
  assert tasks.list_tasks()==[]
  with pytest.raises(ValueError):await tasks.stop_task(first,user_id="b")
  assert not a.cancelled()
  await tasks.stop_task(first,user_id="a")
  await tasks.stop_task(second,user_id="admin",admin=True)
 asyncio.run(check())

def test_private_tool_rejected_before_loading_module(identities,monkeypatch):
 owner,_,_=identities
 private=Obj(user_id="other",access_control={},specs=[])
 monkeypatch.setattr(tools.Tools,"get_tool_by_id",lambda ident:private)
 monkeypatch.setattr(authz,"has_access",lambda *a:False)
 loads=[]
 monkeypatch.setattr(tools,"load_tool_module_by_id",lambda ident:loads.append(ident))
 request=Obj(app=Obj(state=Obj(TOOLS={})))
 with pytest.raises(HTTPException):tools.get_tools(request,["private-tool"],owner,{})
 assert not loads

def test_owned_tool_still_loads(identities,monkeypatch):
 owner,_,_=identities
 own=Obj(user_id="owner",access_control={},specs=[])
 monkeypatch.setattr(tools.Tools,"get_tool_by_id",lambda ident:own)
 loads=[]
 monkeypatch.setattr(tools,"load_tool_module_by_id",lambda ident:(loads.append(ident) or Obj(),{}))
 assert tools.get_tools(Obj(app=Obj(state=Obj(TOOLS={}))),["own"],owner,{})=={}
 assert loads==["own"]

def test_private_server_connection_denied_before_credentials_used(identities,monkeypatch):
 owner,_,_=identities
 monkeypatch.setattr(tools.Tools,"get_tool_by_id",lambda ident:None)
 monkeypatch.setattr(authz,"has_access",lambda *a:False)
 config=Obj(TOOL_SERVER_CONNECTIONS=[{"access_control":{},"key":"must-not-be-used"}])
 request=Obj(app=Obj(state=Obj(config=config,TOOL_SERVERS=[])))
 with pytest.raises(HTTPException):tools.get_tools(request,["server:0"],owner,{})

def test_deleted_or_downgraded_user_is_not_trusted_from_request(identities):
 owner,_,records=identities
 records["owner"]=Obj(id="owner",role="pending")
 with pytest.raises(HTTPException):authz.current_user(owner)

def test_embedding_diagnostic_requires_admin_before_invocation(monkeypatch):
 monkeypatch.setattr(memories,"current_user",lambda user:user)
 app=FastAPI();app.include_router(memories.router)
 calls=[]
 app.state.EMBEDDING_FUNCTION=lambda text:calls.append(text) or [0.0]
 client=TestClient(app)
 assert client.get("/ef").status_code in (401,403)
 app.dependency_overrides[get_current_user]=lambda:Obj(id="normal",role="user")
 assert client.get("/ef").status_code in (401,403)
 assert not calls
 app.dependency_overrides[get_current_user]=lambda:Obj(id="admin",role="admin")
 assert client.get("/ef").status_code==200 and calls==["hello world"]

def test_foreign_chat_rejected_before_chat_payload_processing(identities,monkeypatch):
 from open_webui.utils import middleware
 owner,_,_=identities
 async def check():
  with pytest.raises(HTTPException) as exc:await middleware.process_chat_payload(Obj(),{},owner,{"user_id":"owner","chat_id":"foreign-chat"}, {})
  assert exc.value.status_code==403
 asyncio.run(check())

@pytest.fixture
def documents(identities,monkeypatch,tmp_path):
 owner,other,_=identities
 class Record(Obj):
  def model_dump(self):return self.__dict__
 files={"owned":Record(id="owned",user_id="owner",data={"content":"own"}),"private":Record(id="private",user_id="other",data={"content":"private"})}
 knowledge=Record(id="shared",user_id="other",name="Shared",data={"file_ids":["private"]},access_control={"read":{"user_ids":["owner"]}})
 monkeypatch.setattr(authz.Files,"get_file_by_id",lambda ident:files.get(ident))
 monkeypatch.setattr(authz.Knowledges,"get_knowledge_by_id",lambda ident:knowledge if ident=="shared" else None)
 monkeypatch.setattr(authz.Knowledges,"get_knowledge_bases_by_user_id",lambda uid,access:[knowledge] if uid=="owner" and access=="read" else [])
 monkeypatch.setattr(authz,"has_access",lambda uid,access,acl:uid in (acl or {}).get(access,{}).get("user_ids",[]))
 monkeypatch.setattr(authz,"state_dir",lambda:tmp_path)
 return owner,files,knowledge

def test_file_references_use_persisted_acl_and_content(documents):
 owner,files,knowledge=documents
 out=authz.authorize_files(owner,[{"id":"owned","file":{"data":{"content":"forged"}},"collection_name":"victim"}])
 assert out[0]["file"]["data"]["content"]=="own"
 assert out[0]["collection_name"]=="file-owned"
 # Sharing read access does not grant mutation of the source file.
 assert authz.require_file(owner,"private").id=="private"
 with pytest.raises(HTTPException):authz.require_file(owner,"private","write")

def test_foreign_file_blocked_when_not_shared(documents,monkeypatch):
 owner,_,_=documents
 monkeypatch.setattr(authz.Knowledges,"get_knowledge_bases_by_user_id",lambda *a:[])
 with pytest.raises(HTTPException):authz.authorize_files(owner,[{"id":"private"}])

def test_collection_payload_cannot_inject_foreign_file_ids(documents):
 owner,_,knowledge=documents
 out=authz.authorize_files(owner,[{"id":"shared","type":"collection","data":{"file_ids":["secret"]}}])
 assert out[0]["data"]["file_ids"]==["private"]
 with pytest.raises(HTTPException):authz.require_collection(owner,"shared","write")

def test_generated_collection_grants_are_scoped_and_durable(documents):
 owner,_,_=documents
 authz.require_collection(owner,"generated","write",creating=True)
 authz.require_collection(owner,"generated")
 with pytest.raises(HTTPException):authz.require_collection(Obj(id="other",role="user"),"generated")
 with pytest.raises(HTTPException):authz.require_collection(Obj(id="other",role="user"),"generated","write",creating=True)

def test_foreign_retrieval_file_mutation_denied_before_provider(documents,monkeypatch):
 from open_webui.routers import retrieval
 owner,_,_=documents
 with pytest.raises(HTTPException):retrieval.process_file(Obj(),retrieval.ProcessFileForm(file_id="private"),user=owner)

def test_forged_admin_role_cannot_unlock_private_tool(identities,monkeypatch):
 owner,_,_=identities
 monkeypatch.setattr(tools.Tools,"get_tool_by_id",lambda ident:Obj(user_id="other",access_control={},specs=[]))
 monkeypatch.setattr(authz,"has_access",lambda *a:False)
 request=Obj(app=Obj(state=Obj(TOOLS={})))
 with pytest.raises(HTTPException):tools.get_tools(request,["private"],Obj(id="owner",role="admin"),{})

def test_retrieval_authorizes_before_embeddings_and_keeps_owned_query(documents,monkeypatch):
 from open_webui.routers import retrieval
 owner,_,_=documents
 monkeypatch.setattr(authz.Knowledges,"get_knowledge_bases_by_user_id",lambda *a:[])
 calls=[]
 request=Obj(app=Obj(state=Obj(config=Obj(ENABLE_RAG_HYBRID_SEARCH=False,TOP_K=3),EMBEDDING_FUNCTION=lambda *a,**k:calls.append(a) or [0.0])))
 monkeypatch.setattr(retrieval,"query_doc",lambda **kwargs:{"documents":[["owned content"]]})
 with pytest.raises(HTTPException):retrieval.query_doc_handler(request,retrieval.QueryDocForm(collection_name="file-private",query="secret"),user=owner)
 assert not calls
 result=retrieval.query_doc_handler(request,retrieval.QueryDocForm(collection_name="file-owned",query="mine"),user=owner)
 assert result["documents"]==[["owned content"]] and len(calls)==1

def test_retrieval_status_config_is_not_anonymous():
 from open_webui.routers import retrieval
 app=FastAPI();app.include_router(retrieval.router)
 assert TestClient(app).get("/").status_code in (401,403)

@pytest.fixture
def upload_app(tmp_path,monkeypatch):
 from open_webui.routers import files as file_routes
 path=tmp_path/"uploaded.html";path.write_text("<!doctype html><script>window.__uploaded=1</script><p>owned preview</p>")
 file=Obj(id="html-owned",user_id="owner",path=str(path),filename="uploaded.html",meta={"name":"uploaded.html","content_type":"text/html"},data={"content":"owned preview"})
 monkeypatch.setattr(file_routes.Files,"get_file_by_id",lambda ident:file if ident=="html-owned" else None)
 monkeypatch.setattr(file_routes.Storage,"get_file",lambda path:path)
 app=FastAPI();app.include_router(file_routes.router)
 app.dependency_overrides[get_current_user]=lambda:Obj(id="owner",role="user")
 return app

def test_owned_uploaded_html_is_readable_but_never_application_origin(upload_app):
 client=TestClient(upload_app)
 response=client.get("/html-owned/content/html")
 assert response.status_code==200 and "owned preview" in response.text
 csp=response.headers["content-security-policy"]
 assert "sandbox allow-scripts;" in csp and "allow-same-origin" not in csp
 assert "connect-src 'none'" in csp and "form-action 'none'" in csp
 assert response.headers["x-content-type-options"]=="nosniff"
 assert response.headers["referrer-policy"]=="no-referrer"

def test_download_and_named_content_keep_upload_sandbox(upload_app):
 client=TestClient(upload_app)
 for path in ["/html-owned/content","/html-owned/content/uploaded.html"]:
  response=client.get(path)
  assert response.status_code==200
  assert response.headers["content-security-policy"].startswith("sandbox ")
  assert response.headers["x-content-type-options"]=="nosniff"

def test_foreign_uploaded_html_is_not_disclosed(upload_app):
 upload_app.dependency_overrides[get_current_user]=lambda:Obj(id="foreign",role="user")
 response=TestClient(upload_app).get("/html-owned/content/html")
 assert response.status_code==404 and "owned preview" not in response.text

def test_completed_callback_rejects_foreign_chat_before_filters(identities):
 from open_webui.utils import chat
 owner,_,_=identities
 async def check():
  with pytest.raises(HTTPException):await chat.chat_completed(Obj(),{"chat_id":"foreign-chat","session_id":"mine"},owner)
 asyncio.run(check())

def test_native_action_requires_enabled_model_action_and_own_context(identities,monkeypatch):
 from open_webui.utils import chat
 owner,_,_=identities
 action=Obj(id="a",type="action",is_active=True)
 monkeypatch.setattr(chat.Functions,"get_function_by_id",lambda ident:action)
 monkeypatch.setattr(chat.Functions,"get_global_action_functions",lambda:[])
 monkeypatch.setattr(chat,"check_model_access",lambda *a:None)
 calls=[]
 async def execute(body,__user__):calls.append(__user__["id"]);return {"ok":True}
 request=Obj(state=Obj(),app=Obj(state=Obj(MODELS={"model":{"id":"model","info":{"meta":{"actionIds":["a"]}}}},FUNCTIONS={"a":Obj(action=execute)})))
 data={"chat_id":"own-chat","id":"message","session_id":"mine","model":"model"}
 async def check():
  assert await chat.chat_action(request,"a",data,owner)=={"ok":True}
  request.app.state.MODELS["model"]["info"]["meta"]["actionIds"]=[]
  with pytest.raises(HTTPException):await chat.chat_action(request,"a",data,owner)
  with pytest.raises(HTTPException):await chat.chat_action(request,"a",{**data,"session_id":"victim"},owner)
 asyncio.run(check())
 assert calls==["owner"]

def test_workspace_socket_rejects_anonymous_but_accepts_current_user(identities,monkeypatch):
 owner,_,records=identities
 records["owner"]=Obj(id="owner",role="user",model_dump=lambda:{"id":"owner","role":"user"})
 monkeypatch.setattr(sockets,"decode_token",lambda token:{"id":"owner"})
 monkeypatch.setattr(sockets.sio,"emit",AsyncMock())
 async def check():
  assert await sockets.connect("anonymous",{},None) is False
  assert "anonymous" not in sockets.SESSION_POOL
  await sockets.connect("new-owned",{},{"token":"owner-token"})
  assert sockets.SESSION_POOL["new-owned"]["id"]=="owner"
 asyncio.run(check())

def test_unauthenticated_usage_event_cannot_mutate_usage_pool(identities,monkeypatch):
 monkeypatch.setattr(sockets,"USAGE_POOL",{})
 emit=AsyncMock();monkeypatch.setattr(sockets.sio,"emit",emit)
 asyncio.run(sockets.usage("anonymous",{"model":"private-model"}))
 assert sockets.USAGE_POOL=={}
 emit.assert_not_awaited()

def test_batch_uses_stored_content_and_owner_not_forged_file_model(documents,monkeypatch):
 from open_webui.routers import retrieval
 owner,files,_=documents
 files["owned"].meta={"name":"owned.txt"}
 files["owned"].filename="owned.txt"
 authz.require_collection(owner,"batch","write",creating=True)
 writes=[];saved=[]
 monkeypatch.setattr(retrieval.Files,"update_file_hash_by_id",lambda *a:None)
 monkeypatch.setattr(retrieval.Files,"update_file_data_by_id",lambda ident,data:writes.append((ident,data)))
 monkeypatch.setattr(retrieval.Files,"update_file_metadata_by_id",lambda *a:None)
 monkeypatch.setattr(retrieval,"save_docs_to_vector_db",lambda **kw:saved.extend(kw["docs"]))
 form=Obj(files=[Obj(id="owned",user_id="victim",data={"content":"forged"})],collection_name="batch")
 result=retrieval.process_files_batch(Obj(),form,user=owner)
 assert not result.errors and result.results[0].status=="completed"
 assert writes==[("owned",{"content":"own"})]
 assert saved[0].metadata["created_by"]=="owner" and saved[0].page_content=="own"
