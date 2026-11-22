import ast,asyncio,logging,os
from pathlib import Path
from types import SimpleNamespace as NS
import pytest
from fastapi import FastAPI,Request,Depends,HTTPException,status
from fastapi.testclient import TestClient
from open_webui.utils import customer_boundary as boundary

@pytest.mark.parametrize("field",["features","model_item","params","metadata","background_tasks"])
@pytest.mark.parametrize("value",[False,42,"malicious",[]])
def test_options_primitives_are_controlled_errors(field,value):
    with pytest.raises(HTTPException) as error:boundary.validate_customer_options({"model":"starli_pi",field:value})
    assert error.value.status_code==400

@pytest.mark.parametrize("field",boundary.RESTRICTED_LISTS)
def test_customer_tool_and_rag_authority_blocked(field):
    for container in [{field:["tool"]},{"metadata":{field:["tool"]}}]:
        with pytest.raises(HTTPException) as error:boundary.validate_customer_options({"model":"starli_pi",**container})
        assert error.value.status_code==403

def test_minimal_payload_removes_untrusted_context_and_model_params():
    data={"model":"starli_pi","messages":[{"role":"user","content":"hello"}],"params":{"system":"admin"},"variables":{"key":"private"},"stream":True}
    safe,metadata,events=boundary.customer_payload(data,{"user_id":"u","chat_id":"owned","message_id":"m","session_id":"s","tools":{"shell":"bad"},"model":{"toolIds":["bad"]}})
    assert set(safe)=={"model","messages","stream","metadata"}
    assert metadata=={"user_id":"u","chat_id":"owned","message_id":"m","session_id":"s","tool_ids":[],"tool_servers":[],"files":[],"features":{},"direct":False}
    assert events==[]

def test_filter_registry_never_selected_for_customer():
    def selected(model):return ["global-admin-filter"]
    assert boundary.customer_filter_ids(NS(role="user"),{},selected)==[]
    assert boundary.customer_filter_ids(NS(role="admin"),{},selected)==["global-admin-filter"]

def test_errorwrite_only_owned_chat():
    lookup=lambda ident,uid:NS(user_id=uid) if ident=="owned" else None
    assert boundary.may_record_chat_error(NS(id="u"),{"chat_id":"owned","message_id":"m"},lookup)
    for chat_id in ["foreign",None,[],0]:assert not boundary.may_record_chat_error(NS(id="u"),{"chat_id":chat_id,"message_id":"m"},lookup)

def test_actual_middleware_customer_skips_inlet_filters_and_tools(monkeypatch):
    from open_webui.utils import middleware as module
    user=NS(id="u",role="user")
    monkeypatch.setattr(module,"current_user",lambda supplied:user)
    monkeypatch.setattr(module,"require_chat_owner",lambda *args:None)
    monkeypatch.setattr(module,"apply_params_to_form_data",lambda *args:pytest.fail("Customer reached model params/filter prelude"))
    async def pipeline(*args,**kwargs):pytest.fail("Customer reached native pipeline")
    monkeypatch.setattr(module,"process_pipeline_inlet_filter",pipeline)
    monkeypatch.setattr(module,"process_filter_functions",pipeline)
    result=asyncio.run(module.process_chat_payload(NS(),{"model":"starli_pi","messages":[]},user,{"user_id":"u"},{"info":{"meta":{"knowledge":[{"id":"private"}],"filterIds":["admin-filter"]}}}))
    assert result[0]["metadata"]["tool_ids"]==[]

def test_actual_completed_customer_skips_outlet_filters(monkeypatch):
    from open_webui.utils import chat as module
    user=NS(id="u",role="user")
    monkeypatch.setattr(module,"validate_native_chat_context",lambda *args:user)
    monkeypatch.setattr(module,"check_model_access",lambda *args:None)
    async def pipeline(*args,**kwargs):pytest.fail("Customer reached native outlet filter")
    monkeypatch.setattr(module,"process_pipeline_outlet_filter",pipeline)
    monkeypatch.setattr(module,"process_filter_functions",pipeline)
    request=NS(app=NS(state=NS(MODELS={"starli_pi":{"id":"starli_pi"}})),state=NS())
    body={"model":"starli_pi","chat_id":"owned","id":"m","session_id":"s"}
    assert asyncio.run(module.chat_completed(request,body,user))==body

# Execute the actual current main route functions without importing application
# startup, global migrations, provider configuration, or production app state.
def native_main_app(monkeypatch):
    source=Path(os.environ.get("STARLI_ROUTE_TEST_SOURCE",Path(__file__).resolve().parents[1]/"main.py")).read_text()
    tree=ast.parse(source);selected=[]
    for node in tree.body:
        if isinstance(node,ast.AsyncFunctionDef) and node.name in ("chat_completion","chat_action"):
            node.decorator_list=[];selected.append(node)
    user=NS(id="u",role="user");writes=[];calls=[]
    def verified():return user
    async def payload(request,data,principal,metadata,model):
        calls.append("payload")
        if metadata.get("chat_id")=="foreign":raise HTTPException(403,"Chat unavailable")
        return boundary.customer_payload(data,metadata)
    async def completion(*args):calls.append("completion");return {"reply":"ok"}
    async def response(request,result,*args):return result
    async def action(*args):calls.append("action");return {"action":"ran"}
    def owned(ident,uid):return NS(user_id=uid) if ident=="owned" else None
    namespace={"Request":Request,"Depends":Depends,"get_verified_user":verified,"HTTPException":HTTPException,"status":status,"os":os,"log":logging.getLogger("isolated-native-main"),"Models":NS(get_model_by_id=lambda ident:None),"Chats":NS(get_chat_by_id_and_user_id=owned,upsert_message_to_chat_by_id_and_message_id=lambda *args:writes.append(args)),"BYPASS_MODEL_ACCESS_CONTROL":False,"check_model_access":lambda *args:None,"process_chat_payload":payload,"chat_completion_handler":completion,"process_chat_response":response,"chat_action_handler":action,"validate_customer_options":boundary.validate_customer_options,"may_record_chat_error":boundary.may_record_chat_error}
    exec(compile(ast.fix_missing_locations(ast.Module(body=selected,type_ignores=[])),"actual_main_routes","exec"),namespace)
    app=FastAPI();app.state.MODELS={"starli_pi":{"id":"starli_pi"}};app.post("/chat")(namespace["chat_completion"]);app.post("/actions/{action_id}")(namespace["chat_action"])
    return TestClient(app,raise_server_exceptions=False),writes,calls

@pytest.mark.parametrize("field,value",[("features",42),("features",[]),("features",False),("model_item",42),("model_item",[]),("model_item",False),("params",42)])
def test_actual_main_primitive_options_never_500(monkeypatch,field,value):
    client,writes,calls=native_main_app(monkeypatch)
    result=client.post("/chat",json={"model":"starli_pi","messages":[],field:value})
    assert result.status_code==400,(field,value,result.text)
    assert writes==[] and "completion" not in calls

@pytest.mark.parametrize("field",["tool_ids","tool_servers","files","filter_ids","functions"])
def test_actual_main_customer_tool_context_denied(monkeypatch,field):
    client,writes,calls=native_main_app(monkeypatch)
    result=client.post("/chat",json={"model":"starli_pi","messages":[],field:["admin-tool"]})
    assert result.status_code==403 and calls==[] and writes==[]

def test_actual_main_foreign_chat_failure_never_writes_error(monkeypatch):
    client,writes,calls=native_main_app(monkeypatch)
    result=client.post("/chat",json={"model":"starli_pi","messages":[],"chat_id":"foreign","id":"victim-message"})
    assert result.status_code in (400,403) and writes==[] and "completion" not in calls

def test_actual_main_customer_action_denied(monkeypatch):
    client,writes,calls=native_main_app(monkeypatch)
    assert client.post("/actions/admin-action",json={"model":"starli_pi"}).status_code==403
    assert calls==[] and writes==[]

def test_actual_main_owned_chat_positive(monkeypatch):
    client,writes,calls=native_main_app(monkeypatch)
    result=client.post("/chat",json={"model":"starli_pi","messages":[],"chat_id":"owned","id":"m"})
    assert result.status_code==200 and result.json()=={"reply":"ok"}
    assert calls==["payload","completion"] and writes==[]


def test_actual_customer_stream_never_loads_global_filters(monkeypatch):
    from starlette.responses import StreamingResponse
    from open_webui.utils import middleware as module
    user=NS(id="u",role="user",email="u@example.com",name="Customer")
    monkeypatch.setattr(module,"current_user",lambda supplied:user)
    monkeypatch.setattr(module,"require_chat_owner",lambda *args:None)
    monkeypatch.setattr(module,"get_sorted_filter_ids",lambda *args:pytest.fail("Customer selected global stream filters"))
    async def chunks():yield b'data: {"reply":"ok"}\n\n'
    async def run():
        response=await module.process_chat_response(NS(),StreamingResponse(chunks(),media_type="text/event-stream"),{"model":"starli_pi"},user,{}, {},[],None)
        return [chunk async for chunk in response.body_iterator]
    assert asyncio.run(run())==[b'data: {"reply":"ok"}\n\n']
