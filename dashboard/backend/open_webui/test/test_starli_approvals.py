import asyncio
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_approvals as a,starli_tools as t

@pytest.fixture
def approval(tmp_path,monkeypatch):
 monkeypatch.setattr(a,'HOME',tmp_path)
 monkeypatch.setattr(a,'principal',lambda user:(user['id'],{}))
 return {'id':'a'}

def test_prepare_has_no_effect_and_owner_isolation(approval,monkeypatch):
 calls=[]
 async def run(*args,**kwargs):calls.append(args);return {}
 monkeypatch.setattr(t,'bridge',run)
 item=a.prepare(a.Prepare(tool='crm_upsert_prospect',args={'name':'test'}),user=approval)
 assert not calls and a.listing(user={'id':'b'})['items']==[]
 with pytest.raises(HTTPException):asyncio.run(a.confirm(item['id'],a.Confirm(digest=item['digest']),user={'id':'b'}))
 assert not calls

def test_exact_digest_and_single_use(approval,monkeypatch):
 calls=[]
 async def run(*args,**kwargs):calls.append(args);return {'content':[{'type':'text','text':'ok'}]}
 monkeypatch.setattr(t,'bridge',run)
 item=a.prepare(a.Prepare(tool='crm_upsert_prospect',args={'name':'test'}),user=approval)
 with pytest.raises(HTTPException):asyncio.run(a.confirm(item['id'],a.Confirm(digest='0'*64),user=approval))
 async def check():
  first=await a.confirm(item['id'],a.Confirm(digest=item['digest']),user=approval)
  second=await a.confirm(item['id'],a.Confirm(digest=item['digest']),user=approval)
  assert first['status']==second['status']=='COMPLETED'
 asyncio.run(check())
 assert len(calls)==1

def test_uncertain_never_replays(approval,monkeypatch):
 calls=[]
 async def run(*args,**kwargs):calls.append(args);raise TimeoutError()
 monkeypatch.setattr(t,'bridge',run)
 item=a.prepare(a.Prepare(tool='outreach_send_email',args={}),user=approval)
 async def check():
  for _ in range(2):assert (await a.confirm(item['id'],a.Confirm(digest=item['digest']),user=approval))['status']=='UNCERTAIN'
 asyncio.run(check())
 assert len(calls)==1

def test_reject_and_block_privileged_tools(approval):
 item=a.prepare(a.Prepare(tool='crm_upsert_prospect',args={'name':'test'}),user=approval)
 a.reject(item['id'],user=approval)
 result=asyncio.run(a.confirm(item['id'],a.Confirm(digest=item['digest']),user=approval))
 assert result['status']=='REJECTED'
 for tool in ['server_exec','secret_manage','database_query']:
  with pytest.raises(HTTPException):a.prepare(a.Prepare(tool=tool,args={}),user=approval)

def test_concurrent_confirm_claims_once(approval,monkeypatch):
 calls=[]
 async def run(*args,**kwargs):calls.append(args);await asyncio.sleep(.01);return {}
 monkeypatch.setattr(t,'bridge',run)
 item=a.prepare(a.Prepare(tool='crm_upsert_prospect',args={'name':'test'}),user=approval)
 async def check():
  await asyncio.gather(*[a.confirm(item['id'],a.Confirm(digest=item['digest']),user=approval) for _ in range(2)])
 asyncio.run(check())
 assert len(calls)==1
