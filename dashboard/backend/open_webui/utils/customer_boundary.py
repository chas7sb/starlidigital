"""Pure policy for the verified-account inference-only chat surface."""
from fastapi import HTTPException

RESTRICTED_LISTS=("tool_ids","tool_servers","files","filter_ids","functions")

def validate_customer_options(data,model_id="starli_pi"):
    if not isinstance(data,dict):raise HTTPException(400,"Invalid chat options")
    if data.get("model")!=model_id:raise HTTPException(403,"Choose Starli AI to start your chat")
    for key in ("features","model_item","params","metadata","background_tasks"):
        value=data.get(key)
        if value is not None and not isinstance(value,dict):raise HTTPException(400,"Invalid chat options")
    for container in (data,data.get("metadata") or {}):
        for key in RESTRICTED_LISTS:
            value=container.get(key)
            if value is not None and not isinstance(value,list):raise HTTPException(400,"Invalid chat options")
            if value:raise HTTPException(403,"These actions are not available in this chat")
        features=container.get("features")
        if features is not None and not isinstance(features,dict):raise HTTPException(400,"Invalid chat options")
        if features and any(features.values()):raise HTTPException(403,"These actions are not available in this chat")
        if container.get("direct"):raise HTTPException(403,"Direct connections are unavailable")
    if (data.get("model_item") or {}).get("direct"):raise HTTPException(403,"Direct connections are unavailable")
    return data

def customer_payload(data,metadata,model_id="starli_pi"):
    validate_customer_options(data,model_id)
    if "stream" in data and not isinstance(data["stream"],bool):raise HTTPException(400,"Invalid streaming option")
    safe_metadata={key:metadata.get(key) for key in ("user_id","chat_id","message_id","session_id","task","task_body") if key in metadata}
    safe_metadata.update(tool_ids=[],tool_servers=[],files=[],features={},direct=False)
    safe={"model":model_id,"messages":data.get("messages",[]),"stream":data.get("stream",False),"metadata":safe_metadata}
    return safe,safe_metadata,[]

def customer_filter_ids(user,model,selector):
    return [] if user.role=="user" else selector(model)

def may_record_chat_error(user,metadata,owned_chat_lookup):
    if not isinstance(metadata,dict):return False
    chat_id=metadata.get("chat_id");message_id=metadata.get("message_id")
    if not isinstance(chat_id,str) or not chat_id or not isinstance(message_id,str) or not message_id:return False
    try:
        chat=owned_chat_lookup(chat_id,user.id)
        return chat is not None and chat.user_id==user.id
    except Exception:return False
