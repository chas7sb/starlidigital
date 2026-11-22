import asyncio,json,sqlite3
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_runtime_adapter as rt, starli_platform as p

@pytest.fixture
def runtime(tmp_path,monkeypatch):
 monkeypatch.setattr(rt,'ROOT',tmp_path)
 monkeypatch.setattr(rt,'verified',lambda uid:{'id':uid})
 rt._ACTIVE.clear()
 async def idle(task,user):await asyncio.sleep(100)
 monkeypatch.setattr(rt,'run',idle)
 yield
 rt._ACTIVE.clear()

def test_idempotency_conflict_and_no_duplicate(runtime):
 async def check():
  payload={'prompt':'Research test','idempotencyKey':'once'}
  first=await rt.adapter('a','tasks.create',payload)
  again=await rt.adapter('a','tasks.create',payload)
  assert first['taskId']==again['taskId'] and len(rt._ACTIVE)==1
  with pytest.raises(HTTPException) as e:await rt.adapter('a','tasks.create',{**payload,'prompt':'different'})
  assert e.value.status_code==409
 asyncio.run(check())

def test_global_capacity_and_owner(runtime):
 async def check():
  first=await rt.adapter('a','tasks.create',{'prompt':'one','idempotencyKey':'1'})
  await rt.adapter('a','tasks.create',{'prompt':'two','idempotencyKey':'2'})
  with pytest.raises(HTTPException) as e:await rt.adapter('a','tasks.create',{'prompt':'three','idempotencyKey':'3'})
  assert e.value.status_code==429
  with pytest.raises(HTTPException) as e:await rt.adapter('b','tasks.get',{'taskId':first['taskId']})
  assert e.value.status_code==404
  cancelled=await rt.adapter('a','tasks.cancel',{'taskId':first['taskId']})
  assert cancelled['status']=='CANCELLED'
 asyncio.run(check())

def test_interrupted_task_never_replayed(runtime):
 async def check():
  first=await rt.adapter('a','tasks.create',{'prompt':'one','idempotencyKey':'1'})
  job=rt._ACTIVE.pop(first['taskId']);job['task'].cancel()
  with rt.db() as c:
   row=c.execute('SELECT payload FROM tasks WHERE id=?',(first['taskId'],)).fetchone();payload=json.loads(row[0]);payload['leaseUntil']=0;c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(payload),first['taskId']))
  task=await rt.adapter('a','tasks.get',{'taskId':first['taskId']})
  assert task['status']=='INTERRUPTED' and not rt._ACTIVE
 asyncio.run(check())

@pytest.fixture
def platform(tmp_path,monkeypatch):
 path=tmp_path/'source.sqlite'
 with sqlite3.connect(path) as d:
  d.execute('CREATE TABLE users(id TEXT,payload TEXT)')
  d.execute('CREATE TABLE records(id TEXT,collection TEXT,payload TEXT)')
  d.execute('INSERT INTO users VALUES(?,?)',('source-admin',json.dumps({'role':'ADMIN','disabled':False,'passwordHash':'secret'})))
  for i in range(3):d.execute('INSERT INTO records VALUES(?,?,?)',(str(i),'crm_companies',json.dumps({'id':str(i),'name':'Company '+str(i),'email':'public@example.com','secretToken':'hidden'})))
 binding=tmp_path/'binding.json';binding.write_text(json.dumps({'memberships':{'a':{'v2UserId':'source-admin'}}}))
 monkeypatch.setattr(p,'DATABASE',str(path));monkeypatch.setattr(p,'BINDINGS',str(binding))
 return {'id':'a','role':'admin'}

def test_crm_auth_search_pagination_and_projection(platform):
 result=p.crm(q='Company',limit=2,offset=1,user=platform)
 assert result['total']==3 and len(result['items'])==2 and result['items'][0]['name']=='Company 1'
 assert 'secretToken' not in json.dumps(result)
 with pytest.raises(HTTPException):p.crm(q='',limit=2,offset=0,user={'id':'a','role':'user'})
 with pytest.raises(HTTPException):p.crm(q='',limit=2,offset=0,user={'id':'other','role':'admin'})

def test_source_role_revoked_denies(platform):
 with sqlite3.connect(p.DATABASE) as d:d.execute('UPDATE users SET payload=?',(json.dumps({'role':'USER'}),))
 with pytest.raises(HTTPException):p.principal(platform)

def test_capacity_is_durable_across_process_state(runtime):
 async def check():
  for n in range(2):await rt.adapter('a','tasks.create',{'prompt':str(n),'idempotencyKey':str(n)})
  jobs=list(rt._ACTIVE.values());rt._ACTIVE.clear()
  with pytest.raises(HTTPException) as e:await rt.adapter('a','tasks.create',{'prompt':'third','idempotencyKey':'3'})
  assert e.value.status_code==429
  for j in jobs:j['task'].cancel()
 asyncio.run(check())
