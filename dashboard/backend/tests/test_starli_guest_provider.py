"""Guest provider is server-owned, exact-model, bounded, and never silently paid-fallback."""
import asyncio,json
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_guest_provider as provider

class Content:
    def __init__(self,value):self.value=value
    async def iter_chunked(self,size):
        data=json.dumps(self.value).encode()
        for start in range(0,len(data),size):yield data[start:start+size]
class Response:
    def __init__(self,value,status=200,headers=None):self.status=status;self.headers=headers or {};self.content=Content(value)
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
class Session:
    response=None;calls=[]
    def __init__(self,**options):assert options["trust_env"] is False
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    def post(self,url,**options):
        self.calls.append((url,options));assert options["allow_redirects"] is False
        return self.response
@pytest.fixture
def fake(monkeypatch):
    Session.calls=[]
    Session.response=Response({"id":"synthetic","model":provider.MODEL,"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}],"usage":{"total_tokens":3,"cost":0}})
    monkeypatch.setattr(provider,"server_key",lambda:"synthetic-platform-key")
    monkeypatch.setattr(provider.aiohttp,"ClientSession",Session)
    return Session

def invoke(audience="guest"):
    return asyncio.run(provider.generate([{"role":"user","content":"Hello"}],"System instructions",audience=audience))

def test_exact_free_guest_model_and_fixed_tls_endpoint(fake):
    result=invoke()
    assert result.text=="OK" and result.receipt["model"]==provider.MODEL
    url,options=fake.calls[0]
    assert url=="https://openrouter.ai/api/v1/chat/completions"
    assert options["json"]["model"]=="nvidia/nemotron-3-ultra-550b-a55b:free"
    assert options["json"]["max_tokens"]==512 and options["json"]["provider"]["max_price"]=={"prompt":0,"completion":0}
    assert result.receipt["paidFallback"] is False

def test_builder_uses_same_free_model_with_real_json_mode_and_8192_budget(fake):
    invoke("builder");body=fake.calls[0][1]["json"]
    assert body["model"]==provider.MODEL and body["max_tokens"]==8192 and body["response_format"]=={"type":"json_object"}

def test_missing_platform_key_does_not_use_openai_or_personal_credentials(fake,monkeypatch):
    monkeypatch.setattr(provider,"server_key",lambda:None)
    monkeypatch.setenv("OPENAI_API_KEY","synthetic-paid-key")
    with pytest.raises(HTTPException) as error:invoke()
    assert error.value.status_code==503 and fake.calls==[]

def test_rate_limit_is_returned_without_paid_fallback(fake):
    fake.response=Response({},429,{"Retry-After":"999999"})
    with pytest.raises(HTTPException) as error:invoke()
    assert error.value.status_code==429 and error.value.headers["Retry-After"]=="300"
    assert len(fake.calls)==1

def test_upstream_failure_makes_no_other_provider_request(fake):
    fake.response=Response({},503)
    with pytest.raises(HTTPException) as error:invoke()
    assert error.value.status_code==503 and len(fake.calls)==1

def test_unexpected_model_and_positive_cost_are_rejected(fake):
    fake.response=Response({"model":"unrequested-model","choices":[{"message":{"content":"wrong"}}]})
    with pytest.raises(HTTPException) as error:invoke()
    assert error.value.status_code==502
    fake.response=Response({"model":provider.MODEL,"choices":[{"message":{"content":"wrong"}}],"usage":{"cost":0.01}})
    with pytest.raises(HTTPException) as error:invoke()
    assert error.value.status_code==502

def test_truncated_and_oversized_replies_are_not_accepted(fake):
    fake.response=Response({"model":provider.MODEL,"choices":[{"message":{"content":"partial"},"finish_reason":"length"}]})
    with pytest.raises(HTTPException) as error:invoke("builder")
    assert error.value.status_code==503
    fake.response=Response({"padding":"x"*524289})
    with pytest.raises(HTTPException) as error:invoke()
    assert error.value.status_code==502

def test_key_source_is_only_the_fixed_protected_platform_config(monkeypatch):
    import dotenv
    calls=[]
    monkeypatch.setattr(dotenv,"dotenv_values",lambda path:(calls.append(path) or {"OPENROUTER_API_KEY":"synthetic-protected-platform-key"}))
    monkeypatch.setenv("OPENROUTER_API_KEY","different-personal-or-process-key")
    assert provider.server_key()=="synthetic-protected-platform-key" and calls==[provider.CONFIG]

def test_public_guest_and_builder_dispatch_never_call_legacy_customer_provider(monkeypatch):
    from open_webui.routers import starli_public
    called=[]
    async def free(messages,instructions,*,audience):
        called.append(audience);return provider.GuestReply("saved",{"provider":"openrouter","model":provider.MODEL})
    async def forbidden(*args,**kwargs):raise AssertionError("Paid/private fallback must not run for guests")
    monkeypatch.setattr(provider,"generate",free)
    monkeypatch.setattr(starli_public,"_call_legacy_customer_provider",forbidden)
    for audience in ("guest","builder"):
        reply=asyncio.run(starli_public.call_provider([{"role":"user","content":"Hi"}],audience=audience))
        assert str(reply)=="saved" and reply.receipt["model"]==provider.MODEL
    assert called==["guest","builder"]
