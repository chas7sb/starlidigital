"""Append-only native turn preparation. No completion, task, model or budget execution."""
from __future__ import annotations
import copy,hashlib,json,os,time,uuid
from fastapi import APIRouter,Depends,HTTPException,Request
from pydantic import BaseModel,ConfigDict,Field
from open_webui.routers import starli_chat_sync as sync
router=APIRouter(route_class=sync.BoundedSyncRoute)
VERSION="starli.chat.turn.v1"
TERMINAL={"ANSWERED","COMPLETED","CANCELLED","INTERRUPTED","FAILED","DENIED","BUDGET_EXHAUSTED","WAITING_INPUT","NEEDS_INPUT"}
class Strict(BaseModel):model_config=ConfigDict(extra="forbid",strict=True)
class UserMessage(Strict):
    content:str|list[dict]
    files:list[dict]=Field(default_factory=list,max_length=8)
class PrepareTurn(Strict):
    turnId:str
    expectedCurrentId:str|None
    userMessageId:str
    assistantMessageId:str
    model:str
    userMessage:UserMessage

def _gate(user):
    owner,fresh=sync._owner(user)
    if not (os.environ.get("STARLI_RUNTIME_OWNED_PROJECTS")=="1" and fresh.role in ("user","admin")) and (os.environ.get("STARLI_RUNTIME_PREVIEW_READONLY")!="1" or fresh.role!="admin"):
        raise HTTPException(403,"TURN_PREVIEW_ADMIN_REQUIRED")
    return owner

def _content(message):
    # This first text-only prepare contract fails closed for attachments/image URLs.
    if message.files:raise HTTPException(422,"TURN_ATTACHMENTS_NOT_AVAILABLE")
    value=message.content
    if isinstance(value,str):return sync._text(value,False)
    if not isinstance(value,list) or not 1<=len(value)<=32:raise HTTPException(422,"TURN_CONTENT_INVALID")
    texts=[]
    for part in value:
        if set(part)!={"type","text"} or part.get("type")!="text" or not isinstance(part.get("text"),str):
            raise HTTPException(422,"TURN_TEXT_PARTS_ONLY")
        texts.append(part["text"])
    sync._text("".join(texts),False)
    return copy.deepcopy(value)

def prepare_turn(user,chat_id,body:PrepareTurn,*,fence):
    customer=getattr(fence,"kind",None)=="customer-token"
    if customer:
        from open_webui.routers.starli_customer_context import require_context
        require_context(fence).check(chat_id)
        owner=fence.user_id
        if getattr(user,"id",None)!=owner:raise HTTPException(403,"TURN_CUSTOMER_IDENTITY_MISMATCH")
    else:owner=_gate(user)
    chat_id=sync._id(chat_id)
    if not customer and (fence.kind!="jwt" or fence.user_id!=owner):raise HTTPException(403,"TURN_NATIVE_SESSION_REQUIRED")
    selector=os.environ.get("STARLI_CHAT_MODEL_ID","starli_pi")
    if body.model!=selector:raise HTTPException(422,"TURN_MODEL_SELECTOR_INVALID")
    fresh=fence.check(chat_id)
    from open_webui.routers.starli_chat_stream import _capture_mode,_authorize_mode
    if customer:mode,identity="customer",dict(fence.identity)
    else:mode,identity=_capture_mode(fresh,chat_id)
    from open_webui.routers.starli_personal_provider import account_scope_stamp
    class TurnFence:
        def check(self,checked_chat=None):
            current=fence.check(checked_chat or chat_id)
            if customer:return current
            return _authorize_mode(current,chat_id,mode,identity)
    captured_fence=TurnFence()
    turn_id=sync._uuid(body.turnId);user_id=sync._uuid(body.userMessageId);assistant_id=sync._uuid(body.assistantMessageId)
    if len({turn_id,user_id,assistant_id})!=3:raise HTTPException(422,"TURN_IDS_MUST_DIFFER")
    expected=sync._id(body.expectedCurrentId) if body.expectedCurrentId is not None else None
    content=_content(body.userMessage)
    fingerprint=hashlib.sha256(json.dumps({"userId":user_id,"assistantId":assistant_id,"parent":expected,"model":selector,"content":content},sort_keys=True,separators=(",",":")).encode()).hexdigest()
    receipt={}
    def merge(data):
        if not customer:_gate(user)
        captured_fence.check(chat_id)
        history=copy.deepcopy(data.get("history") or {});mapping=history.get("messages") or {}
        if not isinstance(mapping,dict):raise HTTPException(409,"TURN_HISTORY_INVALID")
        turns=dict(data.get("starliPreparedTurns") or {})
        previous=turns.get(turn_id)
        if previous:
            if previous.get("hash")!=fingerprint:raise HTTPException(409,"TURN_ID_REUSED")
            if "accountScope" in previous and previous["accountScope"]!=account_scope_stamp(mode,identity):
                raise HTTPException(409,"ACCOUNT_PROVIDER_SELECTION_CHANGED")
            receipt.update(previous["receipt"],deduplicated=True);return data
        existing=list(mapping.values())+[m for m in data.get("messages",[]) if isinstance(m,dict)]
        if any(m.get("id") in {user_id,assistant_id} for m in existing if isinstance(m,dict)):
            raise HTTPException(409,"TURN_MESSAGE_ID_EXISTS")
        for message in existing:
            run=message.get("starliPublicRun") if isinstance(message,dict) else None
            if isinstance(run,dict) and run.get("version")=="starli.run.v1" and run.get("status") not in TERMINAL:
                raise HTTPException(409,"TURN_ACTIVE_RUN_EXISTS")
        if history.get("currentId")!=expected:raise HTTPException(409,"TURN_CURRENT_ID_CONFLICT")
        current=mapping.get(expected)
        if isinstance(current,dict) and current.get("role")=="assistant" and current.get("done") is False:raise HTTPException(409,"TURN_ACTIVE_ASSISTANT_EXISTS")
        if expected is not None and expected not in mapping:raise HTTPException(409,"TURN_PARENT_MISSING")
        stamp=int(time.time())
        submitted={"id":user_id,"role":"user","content":content,"parentId":expected,"childrenIds":[assistant_id],"timestamp":stamp}
        assistant={"id":assistant_id,"role":"assistant","content":"","parentId":user_id,"childrenIds":[],"timestamp":stamp,"model":selector,"done":False}
        if expected:
            parent=dict(mapping[expected]);parent["childrenIds"]=list(dict.fromkeys([*(parent.get("childrenIds") or []),user_id]));mapping[expected]=parent
        mapping[user_id]=submitted;mapping[assistant_id]=assistant
        history.update(messages=mapping,currentId=assistant_id);data["history"]=history
        data["messages"]=[*data.get("messages",[]),submitted,assistant]
        receipt.update(version=VERSION,conversationId=chat_id,turnId=turn_id,userMessageId=user_id,assistantMessageId=assistant_id,currentId=assistant_id,model=selector,deduplicated=False)
        turns[turn_id]={"hash":fingerprint,"receipt":dict(receipt)}
        if identity and identity.get("provider")=="account":
            turns[turn_id]["accountScope"]=account_scope_stamp(mode,identity)
        # Hash receipts only, no duplicate draft/content storage; retain recent256 turn IDs.
        data["starliPreparedTurns"]=dict(list(turns.items())[-256:])
        return data
    with sync.session_write_fence(captured_fence,chat_id):sync.mutate_native_chat(owner,chat_id,merge)
    return receipt

@router.post("/chats/{chat_id}/prepare-turn")
def prepare_route(chat_id:str,body:PrepareTurn,request:Request,user=Depends(sync._auth)):
    fence=sync._capture(request,user,chat_id)
    return prepare_turn(user,chat_id,body,fence=fence)
