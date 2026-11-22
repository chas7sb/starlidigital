"""Capture the installed provider route for an owned native chat."""
import hashlib
import json
import os

from fastapi import HTTPException
from open_webui.routers import starli_v3_native as native


def capture_provider(user, agent, scope):
    provider=agent["provider"]
    if provider=="account":
        from open_webui.routers.starli_providers import native_account_binding
        binding=native_account_binding(user.id,agent["model"])
        return {"provider":"account","model":binding[1],"account_binding":binding}
    if provider!="hosted":
        raise HTTPException(409,f"{scope}_PROVIDER_UNSUPPORTED")
    model=agent["model"] or native._provider_default_model("hosted")
    native._validate_provider("hosted",model)
    if model not in native._configured_hosted_models() or (scope=="PROJECT" and not os.getenv("STARLI_INFERENCE_BASE_URL")):
        raise HTTPException(409,f"{scope}_HOSTED_MODEL_NOT_CONFIGURED")
    return {"provider":"hosted","model":model}


def account_scope_stamp(mode,identity):
    if not identity or identity.get("provider")!="account":
        return None
    encoded=json.dumps([mode,identity],sort_keys=True,separators=(",",":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def check_prepared_binding(document,assistant_id,mode,identity):
    for record in (document.get("starliPreparedTurns") or {}).values():
        if not isinstance(record,dict) or (record.get("receipt") or {}).get("assistantMessageId")!=assistant_id:
            continue
        if "accountScope" in record and record["accountScope"]!=account_scope_stamp(mode,identity):
            raise HTTPException(409,"ACCOUNT_PROVIDER_SELECTION_CHANGED")
        return
