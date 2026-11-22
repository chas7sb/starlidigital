"""Provider transport regressions; no network, paid calls or real credentials."""
import asyncio,json,logging
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_public as provider

DUMMY_KEY="dummy-provider-key-do-not-log"
PRIVATE_BODY="private-provider-error-body-do-not-log"
MESSAGES=[{"role":"user","content":"Hello"}]

def encoded(text="Salut, România 👋"):
    return json.dumps({"id":"response-test","status":"completed","usage":{"output_tokens":8},"output":[{"content":[{"type":"output_text","text":text}]}]},ensure_ascii=False).encode("utf-8")

@pytest.fixture
def transport(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY",DUMMY_KEY)
    monkeypatch.setenv("OPENAI_PUBLIC_CHAT_MODEL","private-test-model")
    state=SimpleNamespace(chunks=[],status=200,consumed=[],calls=[],sessions=[],error=None)
    class Content:
        async def read(self,*args):pytest.fail("read(n) is not a complete-response guarantee")
        async def iter_chunked(self,size):
            assert size==16384
            for chunk in state.chunks:
                if isinstance(chunk,BaseException):raise chunk
                state.consumed.append(chunk);yield chunk
    class Response:
        content=Content()
        @property
        def status(self):return state.status
        async def __aenter__(self):
            if state.error:raise state.error
            return self
        async def __aexit__(self,*args):pass
    class Session:
        def __init__(self,**kwargs):
            assert kwargs["trust_env"] is False
            assert kwargs["timeout"].total==25
            state.sessions.append(kwargs)
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def post(self,url,**kwargs):
            assert url=="https://api.openai.com/v1/responses"
            assert kwargs["allow_redirects"] is False
            assert kwargs["headers"]["Authorization"]=="Bearer "+DUMMY_KEY
            state.calls.append((url,kwargs));return Response()
    monkeypatch.setattr(provider.aiohttp,"ClientSession",Session)
    return state

def expect_safe_unavailable(caplog):
    with pytest.raises(HTTPException) as error:asyncio.run(provider.call_provider(MESSAGES))
    assert error.value.status_code==503
    exposed=str(error.value.detail)+caplog.text
    assert DUMMY_KEY not in exposed and PRIVATE_BODY not in exposed
    assert "Authorization" not in exposed
    assert error.value.__suppress_context__ is True

@pytest.mark.parametrize("audience",["guest","customer"])
def test_fragmented_utf8_json_completes_before_decode(transport,audience):
    data=encoded();transport.chunks=[data[i:i+1] for i in range(len(data))]
    result=asyncio.run(provider.call_provider(MESSAGES,audience=audience))
    assert str(result)=="Salut, România 👋"
    assert b"".join(transport.consumed)==data
    assert result.receipt["responseId"]=="response-test" and result.receipt["usage"]["output_tokens"]==8
    sent=transport.calls[0][1]["json"]
    assert sent["input"]==MESSAGES and sent["max_output_tokens"]==512 and sent["store"] is False
    assert "tools" not in sent and "tool_choice" not in sent
    assert ("signed-in customer" in sent["instructions"])==(audience=="customer")

def test_exact_byte_limit_accepts_complete_valid_json(transport):
    data=encoded("at limit");transport.chunks=[data,b" "*(262144-len(data))]
    assert asyncio.run(provider.call_provider(MESSAGES))=="at limit"
    assert sum(map(len,transport.consumed))==262144

def test_oversize_stops_before_consuming_remaining_body(transport,caplog):
    transport.chunks=[b" "*262145,PRIVATE_BODY.encode()]
    expect_safe_unavailable(caplog)
    assert len(transport.consumed)==1

@pytest.mark.parametrize("chunks",[[b'{"output":',b'not-json}'],[b'{"output":[{"content":[{"type":"output_text","text":"',b'\xff',b'"}]}]}']])
def test_malformed_or_invalid_utf8_json_fails_safely(transport,caplog,chunks):
    transport.chunks=chunks
    expect_safe_unavailable(caplog)
    assert transport.consumed==chunks

@pytest.mark.parametrize("status",[302,401,429,500])
def test_non_200_never_reads_or_exposes_raw_provider_body(transport,caplog,status):
    transport.status=status;transport.chunks=[(PRIVATE_BODY+DUMMY_KEY).encode()]
    with caplog.at_level(logging.WARNING):expect_safe_unavailable(caplog)
    assert transport.consumed==[]
    assert str(status) in caplog.text

@pytest.mark.parametrize("failure_point",["headers","body"])
def test_timeout_is_bounded_and_reported_without_secret(transport,caplog,failure_point):
    error=asyncio.TimeoutError(PRIVATE_BODY+" Authorization "+DUMMY_KEY)
    if failure_point=="headers":transport.error=error
    else:transport.chunks=[b'{"output":',error]
    expect_safe_unavailable(caplog)
    assert len(transport.calls)==1 and len(transport.sessions)==1

def test_missing_key_never_opens_http_session(transport,monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY")
    with pytest.raises(HTTPException) as error:asyncio.run(provider.call_provider(MESSAGES))
    assert error.value.status_code==503 and transport.sessions==[]

def test_client_cancellation_is_not_converted_to_provider_failure(transport):
    transport.chunks=[asyncio.CancelledError()]
    with pytest.raises(asyncio.CancelledError):asyncio.run(provider.call_provider(MESSAGES))
