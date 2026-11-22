import asyncio,json,types
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_pi_master as m,starli_runtime_adapter as rt
@pytest.fixture
def master(tmp_path,monkeypatch):
 monkeypatch.setattr(m,'CWD',str(tmp_path))
 monkeypatch.setattr(m,'RECEIPTS',tmp_path/'primary-receipts.sqlite')
 monkeypatch.setattr(m,'verified',lambda uid:types.SimpleNamespace(id=uid))
 monkeypatch.setattr(m,'current_user',lambda user:types.SimpleNamespace(id=user['id'],role='admin'))
 writes=[]
 class Input:
  def write(self,b):writes.append(json.loads(b))
  async def drain(self):pass
 class Output:
  def __init__(self):self.lines=[{'type':'tool','tool':'capabilities','args':{}},{'type':'done','result':'PI_MASTER_OK','receipt':{'responseId':'verified-test'}}]
  async def readline(self):return (json.dumps(self.lines.pop(0))+'\n').encode() if self.lines else b''
 class Process:
  returncode=0
  stdin=Input();stdout=Output()
 async def spawn(*args,**kwargs):
  assert args[:3]==(m.NODE,'--import','tsx') and kwargs['cwd']==str(tmp_path)
  return Process()
 monkeypatch.setattr(asyncio,'create_subprocess_exec',spawn)
 return writes

def test_master_uses_scoped_tool_and_persists_receipt(master,monkeypatch):
 from open_webui.routers import starli_tools
 async def catalog(user):return {'tools':[{'name':'server_info','description':'Read server','inputSchema':{},'previewExecutable':True}]}
 monkeypatch.setattr(starli_tools,'catalog',catalog)
 events=[]
 async def emit(e):events.append(e)
 result=asyncio.run(m.pi_chat('a',[{'role':'user','content':'test'}],emit))
 assert result=='PI_MASTER_OK' and master[0]['master'] is True
 assert 'capabilities' in master[1]['tools'] and any(t['name']=='server_info' for t in master[1]['platformTools']) and events[-1]['data']['done']
 import sqlite3
 with sqlite3.connect(m.CWD+'/primary-receipts.sqlite') as d:
  row=d.execute('SELECT owner,receipt FROM receipts').fetchone()
 assert row[0]=='a' and 'verified-test' in row[1]

def test_foreign_identity_stops_before_process(master,monkeypatch):
 def deny(uid):raise HTTPException(403,'Denied')
 monkeypatch.setattr(m,'verified',deny)
 with pytest.raises(HTTPException):asyncio.run(m.pi_chat('foreign',[]))
 assert not master

def test_master_delegates_through_same_capped_adapter(master,monkeypatch):
 calls=[]
 async def adapter(uid,operation,payload):calls.append((uid,operation,payload));return {'taskId':'owned'}
 monkeypatch.setattr(rt,'adapter',adapter)
 result=asyncio.run(m._tool(types.SimpleNamespace(id='a'),'delegate.task',{'prompt':'research'},'stablekey'))
 assert result['taskId']=='owned' and calls[0][0:2]==('a','tasks.create')
 assert calls[0][2]['idempotencyKey'].startswith('pi:')

def test_prompt_is_bounded_and_ignores_system():
 value=m._prompt([{'role':'system','content':'secret-system'},{'role':'user','content':'x'*15000}])
 assert len(value)==12000 and 'secret-system' not in value
