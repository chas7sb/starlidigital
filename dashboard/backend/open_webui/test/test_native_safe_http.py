import asyncio,base64,io,socket
from types import SimpleNamespace
import pytest
from PIL import Image
from open_webui.utils import safe_http as h
from open_webui.utils import safe_avatar as a

@pytest.mark.parametrize("url",["file:///etc/passwd","gopher://example.com","https://u:p@example.com","https://example.com\\@127.0.0.1","http://127.0.0.1","http://169.254.169.254","http://168.63.129.16","http://[::1]","http://[::ffff:168.63.129.16]","http://[64:ff9b::a9fe:a9fe]","https://example.com/%0a"[:20]+"\n"])
def test_reject_destination(url):
    with pytest.raises(h.SafeHTTPError):h.validate_target(url)

@pytest.mark.parametrize("ip",["168.63.129.16","::ffff:168.63.129.16","169.254.169.254","64:ff9b::a9fe:a9fe"])
def test_metadata_denied_even_trusted(ip):assert not h.safe_address(ip,True)

def test_public_ipv6_and_private_trusted():
    assert h.safe_address("2606:4700:4700::1111")
    assert h.safe_address("127.0.0.1",True)
    assert not h.safe_address("127.0.0.1")

def test_resolver_pins_all_results(monkeypatch):
    async def run():
        calls=[]
        async def dns(*args,**kwargs):
            calls.append(args);return [(socket.AF_INET,socket.SOCK_STREAM,6,"",("93.184.216.34",443))]
        monkeypatch.setattr(asyncio.get_running_loop(),"getaddrinfo",dns)
        rows=await h.PinnedResolver().resolve("example.com",443)
        assert len(calls)==1 and rows[0]["host"]=="93.184.216.34"
        assert rows[0]["flags"]==socket.AI_NUMERICHOST
        async def poisoned(*args,**kwargs):return [(2,1,6,"",("93.184.216.34",443)),(2,1,6,"",("168.63.129.16",443))]
        monkeypatch.setattr(asyncio.get_running_loop(),"getaddrinfo",poisoned)
        with pytest.raises(h.SafeHTTPError):await h.PinnedResolver().resolve("example.com",443)
    asyncio.run(run())

class Response:
    def __init__(self,status=200,headers=None,body=b"ok"):
        self.status=status;self.headers=headers or {};self.body=body;self.content=self
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def iter_chunked(self,n):yield self.body

def fake_sessions(monkeypatch,responses):
    calls=[]
    class Session:
        def __init__(self,**kwargs):
            assert kwargs["trust_env"] is False
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def request(self,method,url,**kwargs):
            calls.append((url,kwargs));assert kwargs["allow_redirects"] is False
            return responses.pop(0)
    monkeypatch.setattr(h.aiohttp,"TCPConnector",lambda **kwargs:None)
    monkeypatch.setattr(h.aiohttp,"ClientSession",Session)
    return calls

def test_redirect_metadata_blocked(monkeypatch):
    calls=fake_sessions(monkeypatch,[Response(302,{"Location":"http://168.63.129.16/secret"})])
    with pytest.raises(h.SafeHTTPError):asyncio.run(h.safe_fetch("https://example.com"))
    assert len(calls)==1

def test_redirect_credentials_bound_and_size(monkeypatch):
    calls=fake_sessions(monkeypatch,[Response(302,{"Location":"https://cdn.example/image"}),Response(body=b"png")])
    response=asyncio.run(h.safe_fetch("https://provider.example/image",trusted_origin="https://provider.example",headers={"Authorization":"secret","Cookie":"secret","X-Api-Key":"key"}))
    assert response.body==b"png"
    assert calls[0][1]["headers"]=={"Authorization":"secret","X-Api-Key":"key"}
    assert calls[1][1]["headers"]=={}
    fake_sessions(monkeypatch,[Response(body=b"large")])
    with pytest.raises(h.SafeHTTPError):asyncio.run(h.safe_fetch("https://example.com",max_bytes=2))

def png():
    out=io.BytesIO();Image.new("RGB",(2,2)).save(out,format="PNG");return out.getvalue()

@pytest.mark.parametrize("value",["javascript:alert(1)","data:image/svg+xml;base64,PHN2Zy8+","data:text/html;base64,PHNjcmlwdD4=","//evil.example/x","/\\evil.example","file:///tmp/avatar"])
def test_avatar_schemes(value):assert a.avatar_url(value)=="/user.png"

def test_avatar_raster_and_public():
    value="data:image/png;base64,"+base64.b64encode(png()).decode()
    assert a.avatar_url(value).startswith("data:image/png;base64,")
    assert a.avatar_url("https://example.com/avatar.png")=="https://example.com/avatar.png"

def test_oauth_no_credentials_and_svg_rejected(monkeypatch):
    calls=[]
    async def fetch(url,**kwargs):
        calls.append(kwargs);return h.SafeResponse(url,200,{},png())
    monkeypatch.setattr(a,"safe_fetch",fetch)
    assert asyncio.run(a.oauth_avatar("https://example.com/avatar")).startswith("data:image/png;")
    assert calls==[{"max_bytes":a.MAX_AVATAR}]
    async def svg(url,**kwargs):return h.SafeResponse(url,200,{},b"<svg/>")
    monkeypatch.setattr(a,"safe_fetch",svg)
    assert asyncio.run(a.oauth_avatar("https://example.com/avatar"))=="/user.png"

def test_schema_legacy_unsafe_avatar_normalized():
    from open_webui.models.models import ModelMeta
    from open_webui.models.auths import SignupForm
    assert ModelMeta(profile_image_url="javascript:alert(1)").profile_image_url=="/user.png"
    assert SignupForm(name="Test",email="test@example.com",password="password123",profile_image_url="data:image/svg+xml;base64,PHN2Zy8+").profile_image_url=="/user.png"


def test_web_loader_sync_and_async_transport(monkeypatch):
    from open_webui.retrieval.web import utils as web
    calls=[]
    def fetch(url,**kwargs):
        calls.append((url,kwargs));return h.SafeResponse(url,200,{},b"<html><title>Public</title><p>content</p></html>")
    async def afetch(url,**kwargs):return fetch(url,**kwargs)
    monkeypatch.setattr(web,"safe_fetch_sync",fetch)
    monkeypatch.setattr(web,"safe_fetch",afetch)
    loader=web.SafeWebBaseLoader(web_paths=["https://example.com"],trust_env=True)
    assert "content" in list(loader.lazy_load())[0].page_content
    assert "content" in asyncio.run(loader._fetch("https://example.com"))
    assert len(calls)==2

def test_actual_connector_uses_numeric_result_once(monkeypatch):
    async def run():
        dns_calls=[];destinations=[]
        async def dns(*args,**kwargs):
            dns_calls.append(args)
            return [(socket.AF_INET,socket.SOCK_STREAM,6,"",("93.184.216.34",443))]
        monkeypatch.setattr(asyncio.get_running_loop(),"getaddrinfo",dns)
        async def connect(self,*args,**kwargs):
            destinations.extend(kwargs.get("addr_infos",[]))
            raise OSError("test intercepted actual socket creation")
        monkeypatch.setattr(h.aiohttp.TCPConnector,"_wrap_create_connection",connect)
        with pytest.raises(h.SafeHTTPError):await h.safe_fetch("https://example.com")
        assert len(dns_calls)==1
        assert destinations and all(row[4][0]=="93.184.216.34" for row in destinations)
    asyncio.run(run())


def test_playwright_routes_all_http_and_blocks_websockets(monkeypatch):
    import sys
    from open_webui.retrieval.web import utils as web
    events=[]
    class Context:
        def route(self,pattern,callback):events.append(("route",pattern));self.callback=callback
        def route_web_socket(self,pattern,callback):events.append(("websocket",pattern))
        def new_page(self):return self
        def goto(self,url,**kwargs):
            route=SimpleNamespace(request=SimpleNamespace(method="GET",url=url,headers={}),fulfill=lambda **kw:events.append(("fulfilled",kw["body"])),abort=lambda:events.append(("abort",)))
            self.callback(route)
            route.request.method="POST";self.callback(route)
            return object()
        def close(self):pass
    class Browser:
        def new_context(self,**kwargs):
            assert kwargs=={"service_workers":"block","accept_downloads":False}
            return Context()
        def close(self):pass
    class Playwright:
        chromium=SimpleNamespace(launch=lambda **kw:Browser())
        def __enter__(self):return self
        def __exit__(self,*args):pass
    monkeypatch.setitem(sys.modules,"playwright.sync_api",SimpleNamespace(sync_playwright=Playwright))
    monkeypatch.setattr(web,"safe_fetch_sync",lambda url,**kw:h.SafeResponse(url,200,{},b"public"))
    loader=web.SafePlaywrightURLLoader(web_paths=["https://example.com"],verify_ssl=False)
    loader.evaluator=SimpleNamespace(evaluate=lambda *args:"public content")
    assert list(loader.lazy_load())[0].page_content=="public content"
    assert ("route","**/*") in events and ("websocket","**/*") in events
    assert ("fulfilled",b"public") in events and ("abort",) in events
