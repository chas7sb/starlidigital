import asyncio, socket, types
import aiohttp, pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from open_webui.routers import starli_browser as sb, starli_platform as platform
from open_webui.utils.auth import get_verified_user

@pytest.fixture(autouse=True)
def isolated(monkeypatch):
 sb._sessions.clear()
 def principal(user):
  if not isinstance(user,dict) or not user.get('id') or user.get('forged'):raise HTTPException(403,'Denied')
  return user['id'],{}
 monkeypatch.setattr(platform,'principal',principal)
 yield
 sb._sessions.clear()

def client(uid='a'):
 app=FastAPI();app.include_router(sb.router);app.dependency_overrides[get_verified_user]=lambda:{'id':uid}
 return TestClient(app)

@pytest.mark.parametrize('url',['file:///etc/passwd','http://user:pass@example.com','http://example.com:8080','http://127.0.0.1','http://[::1]','http://169.254.169.254','https://10.0.0.1'])
def test_blocked_url(url):
 with pytest.raises(HTTPException):sb.validate_url(url)

def test_public_url():
 assert sb.validate_url('https://example.com/path')=='https://example.com/path'

@pytest.mark.parametrize('ips',[['127.0.0.1'],['8.8.8.8','10.0.0.1'],['169.254.169.254']])
def test_resolver_denies_private_and_mixed(monkeypatch,ips):
 async def check():
  async def resolve(*args,**kwargs):return [(socket.AF_INET,socket.SOCK_STREAM,6,'',(ip,443)) for ip in ips]
  monkeypatch.setattr(asyncio.get_running_loop(),'getaddrinfo',resolve)
  with pytest.raises(aiohttp.ClientError):await sb.PublicResolver().resolve('example.com',443)
 asyncio.run(check())

def test_pinned_public_resolution(monkeypatch):
 async def check():
  async def resolve(*args,**kwargs):return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('8.8.8.8',443))]
  monkeypatch.setattr(asyncio.get_running_loop(),'getaddrinfo',resolve)
  rows=await sb.PublicResolver().resolve('example.com',443)
  assert rows[0]['host']=='8.8.8.8' and rows[0]['flags']==socket.AI_NUMERICHOST
 asyncio.run(check())

def test_forged_user():
 with pytest.raises(HTTPException):asyncio.run(sb.browser_action({'id':'a','forged':True},'frame',{}))
 with pytest.raises(HTTPException):asyncio.run(sb.browser_action({'id':'a'},'frame',{'userId':'b'}))

def test_foreign_frame_not_visible():
 sb._sessions['a']={'owner':'a','seen':10**12,'page':types.SimpleNamespace(url='secret')}
 r=client('b').get('/frame');assert r.status_code==200 and not r.json()['available'] and 'secret' not in r.text

def test_read_does_not_create():
 assert client().get('/frame').json()['available'] is False
 assert not sb._sessions

def test_unsupported_action():
 with pytest.raises(HTTPException):asyncio.run(sb.browser_action({'id':'a'},'execute',{}))

def test_missing_browser(monkeypatch):
 monkeypatch.delenv('STARLI_BROWSER_EXECUTABLE_PATH',raising=False)
 assert client().post('/navigate',json={'url':'https://example.com'}).status_code==503

def test_no_credentials():
 h=sb._clean_headers({'Cookie':'secret','Authorization':'secret','Accept':'text/html'})
 assert h=={'Accept':'text/html'}
 assert not sb._clean_headers({'Set-Cookie':'secret'},True)
