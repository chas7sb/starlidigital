"""Regression tests for production cancellation and deployment boundaries."""
import asyncio,json,sqlite3
from pathlib import Path
import pytest
from open_webui.routers import starli_runtime_adapter as rt, starli_tool_receipts as receipts, starli_approvals as approvals, starli_tools, starli_state as paths

def task():
 return {'taskId':'t-1','owner':'owner','prompt':'test','status':'RUNNING','progress':'before','receipts':[],'connected':False,'leaseUntil':9999999999}

def insert(tmp_path,monkeypatch):
 monkeypatch.setattr(rt,'ROOT',tmp_path)
 value=task()
 with rt.db() as c:c.execute('INSERT INTO tasks VALUES(?,?,?,?,?)',('t-1','owner','once','fp',json.dumps(value)))
 return value

def test_stale_progress_cannot_overwrite_remote_cancellation(tmp_path,monkeypatch):
 stale=insert(tmp_path,monkeypatch)
 cancelled={**stale,'status':'CANCEL_REQUESTED','cancelRequested':True}
 with rt.db() as c:c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(cancelled),'t-1'))
 stale['progress']='Starting next effect'
 rt.save(stale)
 stored=rt.owned('owner','t-1')
 assert stored['cancelRequested'] is True and stored['status']=='CANCELLED'
 with pytest.raises(asyncio.CancelledError):rt.cancellation_fence(stale)

def test_cancellation_before_runner_starts_spawns_no_process(tmp_path,monkeypatch):
 value=insert(tmp_path,monkeypatch)
 with rt.db() as c:
  cancelled={**value,'cancelRequested':True,'status':'CANCEL_REQUESTED'}
  c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(cancelled),'t-1'))
 calls=[]
 async def spawn(*a,**kw):calls.append(a);raise AssertionError('must not start')
 monkeypatch.setattr(asyncio,'create_subprocess_exec',spawn)
 asyncio.run(rt.run(value,object()))
 assert not calls and rt.owned('owner','t-1')['status']=='CANCELLED'

def test_cancelled_direct_action_is_uncertain_and_not_replayed(tmp_path,monkeypatch):
 monkeypatch.setattr(receipts,'HOME',tmp_path)
 started=asyncio.Event();calls=[]
 async def effect():
  calls.append('effect');started.set();await asyncio.Event().wait()
 async def check():
  work=asyncio.create_task(receipts.execute('owner','once','publish',{},effect))
  await started.wait();work.cancel()
  with pytest.raises(asyncio.CancelledError):await work
  result=await receipts.execute('owner','once','publish',{},effect)
  assert result['status']=='UNCERTAIN'
 asyncio.run(check())
 assert len(calls)==1
 with receipts.db() as c:assert c.execute('SELECT status FROM operations').fetchone()[0]=='UNCERTAIN'

def test_cancelled_approved_action_is_uncertain_and_not_replayed(tmp_path,monkeypatch):
 monkeypatch.setattr(approvals,'HOME',tmp_path)
 monkeypatch.setattr(approvals,'principal',lambda user:('owner',{}))
 started=asyncio.Event();calls=[]
 async def effect(*a,**kw):
  calls.append('effect');started.set();await asyncio.Event().wait()
 monkeypatch.setattr(starli_tools,'bridge',effect)
 user={'id':'owner'}
 item=approvals.prepare(approvals.Prepare(tool='project_deploy',args={'projectId':'owned'}),user=user)
 async def check():
  work=asyncio.create_task(approvals.confirm(item['id'],approvals.Confirm(digest=item['digest']),user=user))
  await started.wait();work.cancel()
  with pytest.raises(asyncio.CancelledError):await work
  retry=await approvals.confirm(item['id'],approvals.Confirm(digest=item['digest']),user=user)
  assert retry['status']=='UNCERTAIN'
 asyncio.run(check())
 assert len(calls)==1

def test_production_code_and_state_paths_are_separate(tmp_path,monkeypatch):
 monkeypatch.setenv('STARLI_RUNTIME_CODE_DIR',str(tmp_path/'immutable/scripts'))
 monkeypatch.setenv('STARLI_STATE_DIR',str(tmp_path/'durable'))
 monkeypatch.setenv('STARLI_TASK_HOME',str(tmp_path/'legacy'))
 monkeypatch.setenv('STARLI_SOURCE_DATABASE',str(tmp_path/'source.sqlite'))
 monkeypatch.setenv('STARLI_BINDINGS_PATH',str(tmp_path/'memberships.json'))
 assert paths.runtime_code_dir()==tmp_path/'immutable/scripts'
 assert paths.state_dir()==tmp_path/'durable'
 assert paths.source_database()==str(tmp_path/'source.sqlite')
 assert paths.bindings_path()==str(tmp_path/'memberships.json')

def test_state_legacy_compatibility_and_package_defaults(tmp_path,monkeypatch):
 for key in ['STARLI_RUNTIME_CODE_DIR','STARLI_STATE_DIR','STARLI_TASK_HOME']:monkeypatch.delenv(key,raising=False)
 monkeypatch.setenv('DATA_DIR',str(tmp_path/'data'))
 assert paths.state_dir()==tmp_path/'data/starli'
 assert paths.runtime_code_dir()==paths.PACKAGE_ROOT/'scripts/starli-runtime'
 monkeypatch.setenv('STARLI_TASK_HOME',str(tmp_path/'legacy'))
 assert paths.state_dir()==tmp_path/'legacy'
