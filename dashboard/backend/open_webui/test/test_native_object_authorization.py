import asyncio,uuid
from types import SimpleNamespace as NS
import pytest
from fastapi import HTTPException,BackgroundTasks
from pydantic import ValidationError
from open_webui.utils import native_object_authorization as acl

def user(uid="alice",role="user"):return NS(id=uid,role=role)
def channel():return NS(id="channel",user_id="owner",access_control={})
def message(uid="alice",cid="channel",parent=None):
    return NS(id="message",user_id=uid,channel_id=cid,parent_id=parent)

@pytest.mark.parametrize("access",["read","write"])
def test_channel_owner_and_admin(access,monkeypatch):
    monkeypatch.setattr(acl,"has_access",lambda *args:False)
    assert acl.channel_access(user("owner"),channel(),access)
    assert acl.channel_access(user(role="admin"),channel(),access)

@pytest.mark.parametrize("access",["read","write"])
def test_explicit_shared_grant(access,monkeypatch):
    calls=[]
    monkeypatch.setattr(acl,"has_access",lambda uid,kind,control:calls.append(kind) or kind==access)
    assert acl.channel_access(user(),channel(),access)
    assert calls==[access]

def test_reader_is_not_writer(monkeypatch):
    monkeypatch.setattr(acl,"has_access",lambda uid,kind,control:kind=="read")
    assert acl.channel_access(user(),channel(),"read")
    with pytest.raises(HTTPException):acl.channel_access(user(),channel(),"write")

@pytest.mark.parametrize("uid,role",[("alice","user"),("owner","user"),("other","admin")])
def test_author_or_moderator(uid,role):acl.message_author(user(uid,role),channel(),message())

def test_channel_writer_cannot_edit_other_author():
    with pytest.raises(HTTPException) as error:acl.message_author(user("other"),channel(),message())
    assert error.value.status_code==403

@pytest.mark.parametrize("record",[None,message(cid="private-channel")])
def test_message_container_required(record):
    with pytest.raises(HTTPException):acl.channel_message(channel(),record)

def test_folder_parent_owner_and_cycles():
    rows={"parent":NS(parent_id=None),"child":NS(parent_id="target")}
    folders=NS(get_folder_by_id_and_user_id=lambda ident,uid:rows.get(ident) if uid=="alice" else None)
    acl.folder_parent(user(),"target","parent",folders)
    acl.folder_parent(user(),"target",None,folders)
    for parent in ["target","child","foreign"]:
        with pytest.raises(HTTPException):acl.folder_parent(user(),"target",parent,folders)

def test_memory_update_zero_rows_does_not_disclose_foreign_record():
    from open_webui.models.memories import Memories
    marker=uuid.uuid4().hex
    record=Memories.insert_new_memory("owner-"+marker,"private memory")
    try:
        assert Memories.update_memory_by_id_and_user_id(record.id,"other-"+marker,"hacked") is None
        assert Memories.get_memory_by_id(record.id).content=="private memory"
        assert Memories.update_memory_by_id_and_user_id(record.id,"owner-"+marker,"owned update").content=="owned update"
        assert Memories.delete_memory_by_id_and_user_id(record.id,"other-"+marker) is False
    finally:Memories.delete_memory_by_id_and_user_id(record.id,"owner-"+marker)

@pytest.mark.parametrize("field,value",[("user_id","victim"),("id","chosen"),("version",100),("created_at",0),("updated_at",0)])
def test_feedback_rejects_mass_assignment(field,value):
    from open_webui.models.feedbacks import FeedbackForm
    with pytest.raises(ValidationError):FeedbackForm(type="rating",**{field:value})

def test_feedback_owner_is_server_assigned():
    from open_webui.models.feedbacks import FeedbackForm,Feedbacks
    marker=uuid.uuid4().hex
    record=Feedbacks.insert_new_feedback("owner-"+marker,FeedbackForm(type="rating",data={"rating":1},meta={"chat_id":"local"}))
    try:
        assert record.user_id=="owner-"+marker and record.version==0
        assert Feedbacks.update_feedback_by_id_and_user_id(record.id,"other-"+marker,FeedbackForm(type="rating",data={"rating":-1})) is None
        assert Feedbacks.get_feedback_by_id_and_user_id(record.id,"other-"+marker) is None
        assert Feedbacks.get_feedback_by_id_and_user_id(record.id,"owner-"+marker).data["rating"]==1
    finally:Feedbacks.delete_feedback_by_id_and_user_id(record.id,"owner-"+marker)

def test_post_rejects_cross_channel_parent_before_insert(monkeypatch):
    from open_webui.routers import channels as router
    monkeypatch.setattr(router,"current_user",lambda u:u)
    monkeypatch.setattr(router,"channel_access",lambda *args:None)
    monkeypatch.setattr(router.Channels,"get_channel_by_id",lambda ident:channel())
    monkeypatch.setattr(router.Messages,"get_message_by_id",lambda ident:message(cid="private-channel"))
    monkeypatch.setattr(router.Messages,"insert_new_message",lambda *args:pytest.fail("foreign parent inserted"))
    with pytest.raises(HTTPException):asyncio.run(router.post_new_message(NS(),"channel",router.MessageForm(content="reply",parent_id="private"),BackgroundTasks(),user()))

def test_thread_rejects_foreign_parent_before_query(monkeypatch):
    from open_webui.routers import channels as router
    monkeypatch.setattr(router,"current_user",lambda u:u)
    monkeypatch.setattr(router,"channel_access",lambda *args:None)
    monkeypatch.setattr(router.Channels,"get_channel_by_id",lambda ident:channel())
    monkeypatch.setattr(router.Messages,"get_message_by_id",lambda ident:message(cid="private-channel"))
    monkeypatch.setattr(router.Messages,"get_messages_by_parent_id",lambda *args:pytest.fail("foreign parent queried"))
    with pytest.raises(HTTPException):asyncio.run(router.get_channel_thread_messages("channel","private",user=user()))

@pytest.mark.parametrize("action",["update_message_by_id","delete_message_by_id"])
def test_message_router_rejects_other_author(monkeypatch,action):
    from open_webui.routers import channels as router
    monkeypatch.setattr(router,"current_user",lambda u:u)
    monkeypatch.setattr(router,"channel_access",lambda *args:None)
    monkeypatch.setattr(router.Channels,"get_channel_by_id",lambda ident:channel())
    monkeypatch.setattr(router.Messages,"get_message_by_id",lambda ident:message("other"))
    kwargs={"id":"channel","message_id":"message","user":user()}
    if action.startswith("update"):kwargs["form_data"]=router.MessageForm(content="hacked")
    with pytest.raises(HTTPException) as error:asyncio.run(getattr(router,action)(**kwargs))
    assert error.value.status_code==403


def test_model_thread_query_cannot_append_foreign_parent():
    from open_webui.models.messages import Messages,MessageForm
    marker=uuid.uuid4().hex
    parent=Messages.insert_new_message(MessageForm(content="private"),"private-"+marker,"owner")
    try:
        assert Messages.get_messages_by_parent_id("public-"+marker,parent.id)==[]
        assert Messages.insert_new_message(MessageForm(content="forged",parent_id=parent.id),"public-"+marker,"other") is None
        reply=Messages.insert_new_message(MessageForm(content="valid reply",parent_id=parent.id),"private-"+marker,"other")
        try:
            assert {m.id for m in Messages.get_messages_by_parent_id("private-"+marker,parent.id)}=={parent.id,reply.id}
        finally:Messages.delete_message_by_id(reply.id)
    finally:Messages.delete_message_by_id(parent.id)

def test_revoked_principal_cannot_list_memory(monkeypatch):
    from open_webui.routers import memories
    from open_webui.utils.native_authorization import Users
    monkeypatch.setattr(Users,"get_user_by_id",lambda uid:NS(id=uid,role="pending"))
    with pytest.raises(HTTPException):asyncio.run(memories.get_memories(user()))

def test_shared_prompt_write_preserves_owner_sharing(monkeypatch):
    from open_webui.routers import prompts
    from open_webui.models.prompts import PromptForm
    stored=NS(user_id="owner",access_control={"write":{"user_ids":["alice"]}})
    monkeypatch.setattr(prompts,"current_user",lambda u:u)
    monkeypatch.setattr(prompts.Prompts,"get_prompt_by_command",lambda command:stored)
    monkeypatch.setattr(prompts,"has_access",lambda *args:True)
    monkeypatch.setattr(prompts.Prompts,"update_prompt_by_command",lambda command,form:stored)
    form=PromptForm(command="/test",title="Test",content="update",access_control=stored.access_control)
    assert asyncio.run(prompts.update_prompt_by_command("test",form,user())) is stored
    form.access_control=None
    with pytest.raises(HTTPException):asyncio.run(prompts.update_prompt_by_command("test",form,user()))


def test_chat_move_rejects_foreign_destination_before_write(monkeypatch):
    from open_webui.routers import chats
    from open_webui.utils import native_authorization
    monkeypatch.setattr(native_authorization,"current_user",lambda u:u)
    monkeypatch.setattr(chats.Folders,"get_folder_by_id_and_user_id",lambda *args:None)
    monkeypatch.setattr(chats.Chats,"get_chat_by_id_and_user_id",lambda *args:pytest.fail("foreign destination accepted"))
    with pytest.raises(HTTPException):asyncio.run(chats.update_chat_folder_id_by_id("chat",chats.ChatFolderIdForm(folder_id="foreign"),user()))

@pytest.mark.parametrize("kind",["message","channel","folder","memory","prompt"])
def test_object_forms_reject_massassigned_owner(kind):
    from open_webui.models.messages import MessageForm
    from open_webui.models.channels import ChannelForm
    from open_webui.models.folders import FolderForm
    from open_webui.models.prompts import PromptForm
    from open_webui.routers.memories import AddMemoryForm
    cls,data={"message":(MessageForm,{"content":"x"}),"channel":(ChannelForm,{"name":"x"}),"folder":(FolderForm,{"name":"x"}),"memory":(AddMemoryForm,{"content":"x"}),"prompt":(PromptForm,{"command":"/x","title":"x","content":"x"})}[kind]
    with pytest.raises(ValidationError):cls(**data,user_id="victim")


def test_channel_broadcast_rechecks_current_acl_and_role(monkeypatch):
    from open_webui.socket import main as socket
    rows={"allowed":user("allowed"),"revoked":user("revoked"),"demoted":user("demoted"),"pending":user("pending","pending")}
    monkeypatch.setattr(socket,"SESSION_POOL",{sid:{"id":sid,"role":"admin"} for sid in rows})
    monkeypatch.setattr(socket.Users,"get_user_by_id",lambda uid:rows.get(uid))
    monkeypatch.setattr(socket.Channels,"get_channel_by_id",lambda ident:channel())
    monkeypatch.setattr(acl,"has_access",lambda uid,*args:uid=="allowed")
    monkeypatch.setattr(socket.sio.manager,"get_participants",lambda **kwargs:[(sid,sid) for sid in rows])
    calls=[]
    async def emit(event,data,**kwargs):calls.append(kwargs)
    monkeypatch.setattr(socket.sio,"emit",emit)
    asyncio.run(socket.emit_channel_event("channel-events",{"channel_id":"channel"},to="channel:channel"))
    assert calls==[{"to":"allowed"}]
