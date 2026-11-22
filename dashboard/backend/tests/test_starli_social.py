"""Social transport boundaries: tenant isolation, review and idempotency without provider calls."""
import asyncio,json
from types import SimpleNamespace
import pytest
from fastapi import HTTPException,Response
from open_webui.routers import starli_social as social

@pytest.fixture
def setup(monkeypatch,tmp_path):
 monkeypatch.setattr(social,"state_dir",lambda:tmp_path)
 monkeypatch.setattr(social,"customer_principal",lambda u:(u["id"],{"v2UserId":u["id"]}))
 monkeypatch.setenv("WEBUI_SECRET_KEY","unit-test-secret-not-production")
 monkeypatch.setenv("STARLI_SOCIAL_CLIENT_ID","starli-openwebui")
 monkeypatch.setenv("STARLI_SOCIAL_REDIRECT_URI","https://starlidigital.ro/starli/social")
 async def catalog(user):return {"tools":[{"name":"facebook_pages_publish_now","inputSchema":{}}]}
 monkeypatch.setattr(social,"catalog",catalog)
 async def scopes():return social.SCOPES.split()
 monkeypatch.setattr(social,"available_scopes",scopes)
 async def cookie(*args):return "starli_native_customer_consent=starli_native_consent_unit-test; Domain=.starlidigital.ro; Path=/customer; HttpOnly; Secure; SameSite=Lax; Max-Age=1800"
 monkeypatch.setattr(social,"native_consent_cookie",cookie)
 return {"id":"alice","role":"user"},SimpleNamespace(headers={"authorization":"Bearer unit-test"})
def test_credentials_are_encrypted_and_owner_scoped(setup):
 alice,_=setup
 social.save_tokens("alice",{"access_token":"private-access","refresh_token":"private-refresh","expires_in":3600,"token_type":"Bearer","scope":"facebook.pages.read"})
 with social.db() as db:
  row=db.execute("SELECT sealed FROM connections WHERE owner='alice'").fetchone()
  assert "private-access" not in row["sealed"] and "private-refresh" not in row["sealed"]
 assert social.status(alice)["connected"] is True
 assert social.status({"id":"bob"})["connected"] is False
 assert "access_token" not in json.dumps(social.status(alice))
def test_pkce_state_is_bound_to_account(setup):
 alice,request=setup
 link=asyncio.run(social.connect(request,Response(),alice))
 assert "code_challenge_method=S256" in link["url"]
 from urllib.parse import urlparse,parse_qs
 state=parse_qs(urlparse(link["url"]).query)["state"][0]
 with pytest.raises(HTTPException) as error:
  asyncio.run(social.callback(social.Callback(code="authorization-code",state=state),request,{"id":"bob"}))
 assert error.value.status_code==403
def test_prepare_is_idempotent_and_cannot_reuse_key(setup):
 alice,_=setup
 a=asyncio.run(social.prepare(alice,"facebook_pages_publish_now",{"caption":"A"},"key-1"))
 b=asyncio.run(social.prepare(alice,"facebook_pages_publish_now",{"caption":"A"},"key-1"))
 assert a["id"]==b["id"] and a["status"]=="PENDING"
 with pytest.raises(HTTPException) as error:asyncio.run(social.prepare(alice,"facebook_pages_publish_now",{"caption":"B"},"key-1"))
 assert error.value.status_code==409
def test_foreign_action_cannot_be_approved(setup):
 alice,request=setup
 action=asyncio.run(social.prepare(alice,"facebook_pages_publish_now",{"caption":"A"},"key-1"))
 with pytest.raises(HTTPException) as error:asyncio.run(social.decide(action["id"],social.Decision(digest=action["digest"],decision="approve"),request,{"id":"bob"}))
 assert error.value.status_code==404
def test_exact_action_executes_once(setup,monkeypatch):
 alice,request=setup;calls=[]
 async def rpc(user,method,params):calls.append(params);return {"content":[{"type":"text","text":"receipt"}]}
 monkeypatch.setattr(social,"rpc",rpc)
 action=asyncio.run(social.prepare(alice,"facebook_pages_publish_now",{"caption":"A"},"key-1"))
 decision=social.Decision(digest=action["digest"],decision="approve")
 assert asyncio.run(social.decide(action["id"],decision,request,alice))["status"]=="COMPLETED"
 assert asyncio.run(social.decide(action["id"],decision,request,alice))["status"]=="COMPLETED"
 assert len(calls)==1 and calls[0]["arguments"]=={"caption":"A"}
def test_uncertain_action_is_never_replayed(setup,monkeypatch):
 alice,request=setup;calls=[]
 async def rpc(*args):calls.append(1);raise TimeoutError()
 monkeypatch.setattr(social,"rpc",rpc)
 action=asyncio.run(social.prepare(alice,"facebook_pages_publish_now",{"caption":"A"},"key-1"))
 decision=social.Decision(digest=action["digest"],decision="approve")
 assert asyncio.run(social.decide(action["id"],decision,request,alice))["status"]=="UNCERTAIN"
 assert asyncio.run(social.decide(action["id"],decision,request,alice))["status"]=="UNCERTAIN"
 assert len(calls)==1
def test_mutation_cannot_use_read_transport(setup):
 alice,_=setup
 with pytest.raises(HTTPException) as error:asyncio.run(social.invoke_read(alice,"facebook_pages_publish_now",{}))
 assert error.value.status_code==403

def test_native_cookie_proxy_keeps_bearer_out_of_urls_and_checks_cookie_security(monkeypatch):
 calls=[];cookie="starli_native_customer_consent=starli_native_consent_"+("a"*43)+"; Domain=.starlidigital.ro; Path=/customer; HttpOnly; Secure; SameSite=Lax; Max-Age=1800"
 class Content:
  async def read(self,limit):return b'{"connected":true}'
 class Response:
  status=200;content=Content();headers={"Set-Cookie":cookie}
  async def __aenter__(self):return self
  async def __aexit__(self,*args):pass
 class Session:
  def __init__(self,*args,**kwargs):pass
  async def __aenter__(self):return self
  async def __aexit__(self,*args):pass
  def post(self,url,**kwargs):calls.append((url,kwargs));return Response()
 monkeypatch.setattr(social.aiohttp,"ClientSession",Session)
 request=SimpleNamespace(headers={"authorization":"Bearer native-unit-test-credential"})
 value=asyncio.run(social.native_consent_cookie(request,("starli-openwebui","https://starlidigital.ro/starli/social"),"s"*43,"c"*43))
 assert value==cookie and calls[0][0]=="https://api.starlidigital.ro/customer/native-session"
 assert calls[0][1]["headers"]["Authorization"]=="Bearer native-unit-test-credential"
 assert "native-unit-test" not in calls[0][0] and "native-unit-test" not in json.dumps(calls[0][1]["json"])
 Response.headers={"Set-Cookie":cookie.replace("Domain=.starlidigital.ro","Domain=.attacker.invalid")}
 with pytest.raises(HTTPException) as error:asyncio.run(social.native_consent_cookie(request,("starli-openwebui","https://starlidigital.ro/starli/social"),"s"*43,"c"*43))
 assert error.value.status_code==502
