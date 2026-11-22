import asyncio,json
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_access as a,starli_tools as t
@pytest.fixture
def mode(tmp_path,monkeypatch):
 monkeypatch.setattr(a,'HOME',tmp_path)
 from open_webui.routers import starli_tool_receipts
 monkeypatch.setattr(starli_tool_receipts,'HOME',tmp_path)
 def principal(user):
  if user.get('role')!='admin':raise HTTPException(403,'Admin required')
  return user['id'],{'v2UserId':'source-'+user['id']}
 monkeypatch.setattr(a,'principal',principal);monkeypatch.setattr(t,'principal',principal)
 return {'id':'a','role':'admin'}
def test_default_and_per_user_mode(mode):
 assert not a.status(user=mode)['fullAccess']
 a.set_mode(a.ModeBody(fullAccess=True),user=mode)
 assert a.status(user=mode)['mode']=='FULL_ACCESS'
 assert not a.status(user={'id':'b','role':'admin'})['fullAccess']
 a.set_mode(a.ModeBody(fullAccess=False),user=mode)
 assert not a.status(user=mode)['fullAccess']
 with a.db() as c:assert c.execute('SELECT count(*) FROM execution_mode_audit').fetchone()[0]==2
def test_user_cannot_enable_admin_mode(mode):
 with pytest.raises(HTTPException):a.set_mode(a.ModeBody(fullAccess=True),user={'id':'a','role':'user'})
def test_full_access_bypasses_action_approval_and_revoke_blocks(mode,monkeypatch):
 calls=[]
 class Process:
  returncode=0
  async def communicate(self,data):
   calls.append(json.loads(data));return b'{"content":[{"type":"text","text":"executed"}]}',b''
 async def spawn(*args,**kwargs):return Process()
 monkeypatch.setattr(asyncio,'create_subprocess_exec',spawn)
 async def check():
  with pytest.raises(HTTPException):await t.bridge(mode,'invoke','project_deploy',{'projectId':'demo'},operation_key='one')
  a.set_mode(a.ModeBody(fullAccess=True),user=mode)
  result=await t.bridge(mode,'invoke','project_deploy',{'projectId':'demo'},operation_key='one')
  assert result['content'][0]['text']=='executed'
  a.set_mode(a.ModeBody(fullAccess=False),user=mode)
  with pytest.raises(HTTPException):await t.bridge(mode,'invoke','project_deploy',{'projectId':'demo'},operation_key='one')
 asyncio.run(check())
 assert len(calls)==1 and calls[0]['owner']=='source-a'
