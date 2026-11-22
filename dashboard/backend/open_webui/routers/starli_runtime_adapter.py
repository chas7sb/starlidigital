"""Private-preview Pi task coordinator: durable ownership/idempotency, bounded execution."""
import starli_portable as _portable
import asyncio, hashlib, json, os, sqlite3, time, uuid
from pathlib import Path
from contextlib import contextmanager
from fastapi import HTTPException
from open_webui.routers import starli_platform as platform

from open_webui.routers.starli_state import state_dir, runtime_code_dir
ROOT=state_dir()
RUNNER=runtime_code_dir()/'pi-worker.mts'
_ACTIVE={}
_LOCK=asyncio.Lock()
TERMINAL={'ANSWERED','COMPLETED','WAITING_INPUT','BUDGET_EXHAUSTED','FAILED','CANCELLED','INTERRUPTED'}
MAX_TASK_SECONDS=3600
MAX_TOOL_STEPS=120
EXTERNAL_WORKER=os.getenv('STARLI_EXTERNAL_WORKER','0')=='1'
@contextmanager
def db():
    ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
    c=sqlite3.connect(str(ROOT/'tasks.sqlite'),timeout=5)
    try:
        c.execute('CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,owner TEXT NOT NULL,idem TEXT NOT NULL,request_hash TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(owner,idem))')
        c.execute('CREATE TABLE IF NOT EXISTS run_budgets(owner TEXT NOT NULL,run_id TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,deadline REAL NOT NULL,cancel_requested INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,run_id))')
        if 'cancel_requested' not in {r[1] for r in c.execute('PRAGMA table_info(run_budgets)')}:
            c.execute('ALTER TABLE run_budgets ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0')
        c.execute('CREATE TABLE IF NOT EXISTS run_executors(owner TEXT NOT NULL,run_id TEXT NOT NULL,executor_id TEXT NOT NULL,acknowledged INTEGER NOT NULL DEFAULT 0,uncertain INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,run_id,executor_id))')
        c.execute('CREATE TABLE IF NOT EXISTS run_tool_attempts(owner TEXT NOT NULL,run_id TEXT NOT NULL,call_id TEXT NOT NULL,status TEXT NOT NULL,read_only INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,run_id,call_id))')
        with c:
            yield c
    finally:
        c.close()

class RunBudgetExhausted(RuntimeError):pass
class ToolAttemptAlreadyRecorded(RuntimeError):pass
class RunCancelled(RunBudgetExhausted):pass

def _budget_value(row):
    remaining=max(0,int(row[0]));deadline=float(row[1])
    return {'attempts':remaining,'remainingSteps':max(0,MAX_TOOL_STEPS-remaining),'deadlineAt':deadline,'remainingSeconds':max(0,deadline-time.time()),'cancelRequested':bool(row[2]) if len(row)>2 else False}

def ensure_run_budget(owner,run_id,deadline=None):
    now=time.time();requested=min(now+MAX_TASK_SECONDS,float(deadline)) if deadline is not None else now+MAX_TASK_SECONDS
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        c.execute('INSERT OR IGNORE INTO run_budgets(owner,run_id,attempts,deadline) VALUES(?,?,0,?)',(owner,run_id,requested))
        row=c.execute('SELECT attempts,deadline,cancel_requested FROM run_budgets WHERE owner=? AND run_id=?',(owner,run_id)).fetchone()
    return _budget_value(row)

def reserve_run_attempt(owner,run_id,tool_call_id,*,read_only=False):
    ensure_run_budget(owner,run_id)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        if c.execute('SELECT 1 FROM run_tool_attempts WHERE owner=? AND run_id=? AND call_id=?',(owner,run_id,tool_call_id)).fetchone():
            raise ToolAttemptAlreadyRecorded('TOOL_ATTEMPT_ALREADY_RECORDED')
        row=c.execute('SELECT attempts,deadline,cancel_requested FROM run_budgets WHERE owner=? AND run_id=?',(owner,run_id)).fetchone()
        if row[2]:raise RunCancelled('RUN_CANCEL_REQUESTED')
        if row[0]>=MAX_TOOL_STEPS or row[1]<=time.time():raise RunBudgetExhausted('RUN_BUDGET_EXHAUSTED')
        c.execute('UPDATE run_budgets SET attempts=attempts+1 WHERE owner=? AND run_id=?',(owner,run_id))
        c.execute("INSERT INTO run_tool_attempts VALUES(?,?,?,'STARTED',?)",(owner,run_id,tool_call_id,int(read_only)))
        row=c.execute('SELECT attempts,deadline,cancel_requested FROM run_budgets WHERE owner=? AND run_id=?',(owner,run_id)).fetchone()
    return _budget_value(row)

def finish_run_attempt(owner,run_id,tool_call_id,status,*,read_only=False,error_code=None):
    if status not in {'COMPLETED','PENDING','QUEUED','DENIED','FAILED','CANCELLED','UNCERTAIN'}:status='UNCERTAIN'
    with db() as c:
        c.execute("UPDATE run_tool_attempts SET status=?,read_only=? WHERE owner=? AND run_id=? AND call_id=? AND status='STARTED'",(status,int(read_only),owner,run_id,tool_call_id))
    return ensure_run_budget(owner,run_id)

def read_only_tool(op,args=None):
    args=args or {}
    if op in {'project.status','delegate.status','starlis.list','browser.read','browser.observe','crm.search','capabilities','platform.schema'}:return True
    return op=='platform.call' and args.get('tool') in {'task_agent_status','task_agent_logs','task_agent_result','video_render_status','project_get','projects_list','project_preview_status','social_notifications','intelligence_context','project_files','project_file_read','project_preview','starli_source_read','crm_search_prospects','crm_get_prospect','inbox_read','inbox_search','agent_get','assets_list','client_workspace_get'}

def checkpoint_can_continue(task,call_id):
    budget=ensure_run_budget(task['owner'],task.get('budgetRootRunId') or task['runId'],task.get('deadlineAt'))
    with db() as c:
        row=c.execute('SELECT status,read_only FROM run_tool_attempts WHERE owner=? AND run_id=? AND call_id=?',(task['owner'],task.get('budgetRootRunId') or task['runId'],call_id)).fetchone()
        uncertain=c.execute("SELECT 1 FROM run_tool_attempts WHERE owner=? AND run_id=? AND read_only=0 AND status IN ('STARTED','UNCERTAIN','PENDING','QUEUED') LIMIT 1",(task['owner'],task.get('budgetRootRunId') or task['runId'])).fetchone()
    return bool((row and (row[1] or row[0] in {'COMPLETED','DENIED','FAILED','CANCELLED'}) or call_id is None and task.get('stepsCompleted',0)==0) and not uncertain and budget['remainingSteps']>0 and budget['remainingSeconds']>0 and not budget.get('cancelRequested') and not task.get('cancelRequested'))

@contextmanager
def completion_guard(owner,public_run_id):
    # Global lock order: runtime budget -> activity transaction; never hold across projection/await.
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        root=public_run_id
        row=c.execute('SELECT cancel_requested FROM run_budgets WHERE owner=? AND run_id=?',(owner,root)).fetchone()
        if row is None:
            roots=c.execute("SELECT DISTINCT COALESCE(json_extract(payload,'$.budgetRootRunId'),json_extract(payload,'$.runId')) FROM tasks WHERE owner=? AND json_extract(payload,'$.runId')=?",(owner,public_run_id)).fetchall()
            if len(roots)>1:raise HTTPException(409,'Ambiguous owned run budget')
            if roots:
                root=roots[0][0]
                row=c.execute('SELECT cancel_requested FROM run_budgets WHERE owner=? AND run_id=?',(owner,root)).fetchone()
        if row is not None and row[0]:raise HTTPException(409,'RUN_CANCEL_REQUESTED')
        # Pure no-budget native answers still serialize against budget changes, without provisioning.
        yield

def _apply_aggregate_cancellation(owner,run_id):
    # Call only after committing executor/budget state. This API derives its own truth.
    try:
        if not aggregate_cancel_status(owner,run_id).get('cancelRequested'):return
        from open_webui.routers import starli_public_activity as activity
        activity.apply_run_cancellation(owner,run_id)
    except Exception:
        import logging
        logging.getLogger(__name__).warning('Aggregate cancellation projection deferred')

def register_primary_executor(owner,run_id):
    ensure_run_budget(owner,run_id)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT attempts,deadline,cancel_requested FROM run_budgets WHERE owner=? AND run_id=?',(owner,run_id)).fetchone()
        if row[2]:raise RunCancelled('RUN_CANCEL_REQUESTED')
        c.execute("INSERT OR IGNORE INTO run_executors(owner,run_id,executor_id) VALUES(?,?,'primary')",(owner,run_id))
    return _budget_value(row)

def _run_tasks(connection,owner,run_id):
    return [(ident,json.loads(payload)) for ident,payload in connection.execute("SELECT id,payload FROM tasks WHERE owner=? AND COALESCE(json_extract(payload,'$.budgetRootRunId'),json_extract(payload,'$.runId'))=?",(owner,run_id)).fetchall()]

def aggregate_cancel_status(owner,run_id):
    with db() as c:
        row=c.execute('SELECT cancel_requested FROM run_budgets WHERE owner=? AND run_id=?',(owner,run_id)).fetchone()
        if not row:raise HTTPException(404,'Owned run budget not found')
        executors=c.execute('SELECT acknowledged,uncertain FROM run_executors WHERE owner=? AND run_id=?',(owner,run_id)).fetchall()
        tasks=_run_tasks(c,owner,run_id)
        uncertain_write=c.execute("SELECT 1 FROM run_tool_attempts WHERE owner=? AND run_id=? AND read_only=0 AND status IN ('STARTED','UNCERTAIN','PENDING','QUEUED') LIMIT 1",(owner,run_id)).fetchone()
    pending=sum(not bool(r[0]) for r in executors)
    uncertain=bool(uncertain_write or any(r[1] for r in executors))
    for _,task in tasks:
        acknowledged=task.get('workerStopConfirmed') is True or (not task.get('executionStartedAt') and task.get('status')=='CANCELLED')
        if not acknowledged:pending+=1
        uncertain=uncertain or bool(task.get('uncertainTool')) or task.get('status')=='INTERRUPTED'
    total=len(executors)+len(tasks)
    if row[0] and not total:pending=1
    all_stopped=bool(total and pending==0)
    status='RUNNING' if not row[0] else 'CANCEL_REQUESTED' if not all_stopped else 'INTERRUPTED' if uncertain else 'CANCELLED'
    return {'runId':run_id,'cancelRequested':bool(row[0]),'status':status,'confirmedStopped':all_stopped,'allStopped':all_stopped,'uncertain':bool(uncertain),'pendingExecutors':int(pending),'totalExecutors':total}

def request_run_cancel(owner,run_id):
    local=[]
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT 1 FROM run_budgets WHERE owner=? AND run_id=?',(owner,run_id)).fetchone()
        if not row:raise HTTPException(404,'Owned run budget not found')
        c.execute('UPDATE run_budgets SET cancel_requested=1 WHERE owner=? AND run_id=?',(owner,run_id))
        for ident,task in _run_tasks(c,owner,run_id):
            if task.get('status') in {'ANSWERED','COMPLETED','FAILED','CANCELLED','INTERRUPTED'}:continue
            # QUEUED without an execution-start record cannot spawn after this transaction.
            if not task.get('executionStartedAt'):
                task.update(status='CANCELLED',progress='Cancelled before execution',cancelRequested=True,workerStopConfirmed=True)
            else:
                task.update(status='CANCEL_REQUESTED',progress='Cancellation requested',cancelRequested=True)
                local.append(ident)
            c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(task),ident))
    for ident in local:
        job=_ACTIVE.get(ident)
        if job and job.get('task'):job['task'].cancel()
    _apply_aggregate_cancellation(owner,run_id)
    return aggregate_cancel_status(owner,run_id)

def record_primary_stop_ack(owner,run_id,acknowledged,uncertain_effects=False):
    if type(acknowledged) is not bool or type(uncertain_effects) is not bool:raise ValueError('Executor acknowledgment must be a server boolean')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        exists=c.execute("SELECT 1 FROM run_executors WHERE owner=? AND run_id=? AND executor_id='primary'",(owner,run_id)).fetchone()
        if not exists:raise HTTPException(409,'Primary executor is not registered')
        c.execute("UPDATE run_executors SET acknowledged=MAX(acknowledged,?),uncertain=MAX(uncertain,?) WHERE owner=? AND run_id=? AND executor_id='primary'",(int(acknowledged),int(uncertain_effects),owner,run_id))
    _apply_aggregate_cancellation(owner,run_id)
    return aggregate_cancel_status(owner,run_id)

def has_active_subtasks(owner,run_id):
    with db() as c:
        rows=c.execute('SELECT payload FROM tasks WHERE owner=?',(owner,)).fetchall()
    return any((task.get('runId')==run_id and task.get('task_role')=='subtask' and task.get('status') not in {'ANSWERED','COMPLETED','FAILED','CANCELLED','INTERRUPTED'}) for task in (json.loads(row[0]) for row in rows))

def request_cancel(task):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT payload FROM tasks WHERE id=? AND owner=?',(task['taskId'],task['owner'])).fetchone()
        if not row:return False
        current=json.loads(row[0])
        if current.get('status') in {'ANSWERED','COMPLETED','FAILED','CANCELLED','INTERRUPTED'}:task.update(current);return False
        current.update(status='CANCEL_REQUESTED',progress='Cancellation requested',cancelRequested=True)
        c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(current),task['taskId']))
    task.update(current);return True

def record_worker_stop(task,confirmed):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT payload FROM tasks WHERE id=? AND owner=?',(task['taskId'],task['owner'])).fetchone()
        if not row:return
        current=json.loads(row[0])
        if task.get('leaseToken') and current.get('leaseToken')!=task['leaseToken']:return
        current.update(workerStopConfirmed=bool(confirmed),workerStoppedAt=time.time() if confirmed else None)
        c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(current),task['taskId']))
    task.update(current)
    root=task.get('budgetRootRunId') or task.get('runId')
    if root:_apply_aggregate_cancellation(task['owner'],root)

def _history_without_execution(history):
    return [item for item in history if not isinstance(item,dict) or item.get('starliExecution') is not True][-32:] if isinstance(history,list) else []

def save(task):
    """Atomic status update; stale workers cannot overwrite a cancellation or interruption."""
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT payload FROM tasks WHERE id=?',(task['taskId'],)).fetchone()
        if not row:
            raise RuntimeError('Task record missing')
        current=json.loads(row[0])
        if task.get('leaseToken') and current.get('leaseToken') != task['leaseToken']:
            task.clear();task.update(current)
            return False
        if current.get('status') in TERMINAL:
            # Once terminal, only the authoritative persisted record may be returned.
            task.clear()
            task.update(current)
            return False
        if current.get('cancelRequested'):
            task['cancelRequested']=True
            if task.get('status') not in ('CANCELLED','INTERRUPTED'):
                task['status']='CANCEL_REQUESTED'
                task['progress']='Cancellation requested'
        c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(task),task['taskId']))
    return True

def task_has_live_lease(connection,ident,now):
    from open_webui.routers.starli_worker_leases import initialize
    initialize(connection)
    row=connection.execute('SELECT expires_at FROM starli_worker_leases WHERE task_id=?',(ident,)).fetchone()
    return bool(row and row[0]>now)

def recover_orphaned_tasks(now=None):
    """Fence jobs from a previous process; never replay uncertain tool side effects."""
    now=time.time() if now is None else now
    recovered=[]
    projections=[]
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        for ident,payload in c.execute('SELECT id,payload FROM tasks').fetchall():
            if ident in _ACTIVE:continue
            if EXTERNAL_WORKER and task_has_live_lease(c,ident,now):continue
            task=json.loads(payload)
            if task.get('status') not in ('QUEUED','RUNNING','CANCEL_REQUESTED'):continue
            if EXTERNAL_WORKER and task.get('status')=='QUEUED':continue
            if task.get('checkpoint',{}).get('phase')=='before_tool' and task.get('activeToolCallId') and not task.get('activeToolReadOnly'):
                task['uncertainTool']=True
                c.execute("UPDATE run_tool_attempts SET status='UNCERTAIN' WHERE owner=? AND run_id=? AND call_id=? AND status='STARTED'",(task['owner'],task.get('budgetRootRunId') or task.get('runId'),task['activeToolCallId']))
            if task.get('cancelRequested'):
                task.update(status='CANCELLED' if not task.get('uncertainTool') and (not task.get('executionStartedAt') or task.get('workerStopConfirmed')) else 'INTERRUPTED',progress='Cancelled before execution' if not task.get('executionStartedAt') else 'Worker interrupted; cancellation outcome requires review',needsInput=bool(task.get('uncertainTool') or task.get('executionStartedAt') and not task.get('workerStopConfirmed')))
            else:
                task.update(status='INTERRUPTED',progress='Worker interrupted; side effects will not be replayed automatically',needsInput=True)
            task['connected']=False
            task['interruptedAt']=now
            task['recoveryPolicy']='manual_review_required'
            c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(task),ident))
            recovered.append(ident)
            projections.append(task)
    for task in projections:
        if not task.get('chatId'):continue
        try:
            from open_webui.routers import starli_public_activity as activity
            root=task.get('budgetRootRunId') or task.get('runId')
            if root and aggregate_cancel_status(task['owner'],root).get('cancelRequested'):
                activity.apply_run_cancellation(task['owner'],root)
            else:
                activity.set_task_state(task['owner'],task['taskId'],task['status'],needs_input=task.get('needsInput',task['status']=='INTERRUPTED'))
        except Exception:
            import logging
            logging.getLogger(__name__).warning('Recovered task activity projection deferred')
    return recovered


def cancellation_fence(task):
    fresh_user=verified(task['owner'])
    if task.get('nativePreview') and (os.getenv('STARLI_RUNTIME_PREVIEW_READONLY')!='1' or fresh_user.role!='admin'):raise HTTPException(403,'Native preview eligibility revoked')
    # Refresh the durable cancellation flag immediately before any tool side effect.
    with db() as c:
        row=c.execute('SELECT payload FROM tasks WHERE id=?',(task['taskId'],)).fetchone()
    if not row:
        raise asyncio.CancelledError()
    persisted=json.loads(row[0])
    if task.get('runId'):
        budget=ensure_run_budget(task['owner'],task.get('budgetRootRunId') or task['runId'],task.get('deadlineAt'))
        if budget.get('cancelRequested'):task['cancelRequested']=True;raise asyncio.CancelledError()

    if task.get('leaseToken'):
        from open_webui.routers.starli_worker_leases import owns
        with db() as c:
            valid=owns(c,task['taskId'],task.get('workerId'),task['leaseToken'])
        if not valid:
            raise asyncio.CancelledError()
    if task.get("agentId"):
        from open_webui.routers.starli_v3_native import _db as registry_db
        with registry_db() as registry:
            agent=registry.execute("SELECT status FROM agents WHERE owner=? AND id=? AND archived_at IS NULL",(task["owner"],task["agentId"])).fetchone()
        if not agent or agent["status"]!="IDLE":raise asyncio.CancelledError()
    if persisted.get('cancelRequested') or persisted.get('status') in ('CANCELLED','INTERRUPTED'):
        task['cancelRequested']=True
        raise asyncio.CancelledError()



def receipt(task):
    keys=('taskId','status','progress','receipts','connected','runId','requestId','assistantMessageId','agentId','budgetRootRunId')
    result={k:task[k] for k in keys if k in task}
    result.update(conversationId=task.get('chatId'),objectiveComplete=bool(task.get('objectiveComplete')),needsInput=bool(task.get('needsInput')),stepsCompleted=task.get('stepsCompleted',0),maxSteps=MAX_TOOL_STEPS,maxDurationSeconds=MAX_TASK_SECONDS,cancelRequested=bool(task.get('cancelRequested')),checkpoint=task.get('checkpoint'),resumeAvailable=False,automaticSafeChunks=True)
    if task.get('runId'):
        with db() as c:budget_row=c.execute('SELECT attempts,deadline,cancel_requested FROM run_budgets WHERE owner=? AND run_id=?',(task['owner'],task.get('budgetRootRunId') or task['runId'])).fetchone()
        if budget_row:result['budget']=_budget_value(budget_row)
    return result

def owned(uid,ident):
    with db() as c:r=c.execute('SELECT owner,payload FROM tasks WHERE id=?',(ident,)).fetchone()
    if not r or r[0]!=uid:raise HTTPException(404,'Task not found')
    task=json.loads(r[1])
    if task['status'] not in TERMINAL and ident not in _ACTIVE and not EXTERNAL_WORKER:
        task.update(status='INTERRUPTED',progress='Worker unavailable; task not replayed',connected=False,recoveryPolicy='manual_review_required')
        save(task)
        with db() as c:
            task=json.loads(c.execute('SELECT payload FROM tasks WHERE id=?',(ident,)).fetchone()[0])
    return task

def verified(uid):
    from open_webui.models.users import Users
    user=Users.get_user_by_id(uid)
    if not user or getattr(user,'role',None) not in ('user','admin'):raise HTTPException(403,'User unavailable')
    platform.customer_principal(user)
    return user


def _bind_task_activity(task):
    from open_webui.routers import starli_public_activity as activity
    existing=activity.get_task_run(task['owner'],task['taskId'])
    if existing:
        task.update({k:v for k,v in existing.items() if k not in ('taskId','agentId')});task['chatId']=existing['conversationId']
        return existing
    if not task.get('chatId'):return None
    parent_run=activity.get_run(task['owner'],task['runId']) if task.get('runId') else None
    binding=activity.bind_task_run(task['owner'],task['chatId'],task['taskId'],agent_id=task.get('publicAgentId') or ('' if parent_run else task.get('agentId') or ''),assistant_message_id=task.get('assistantMessageId'),run_id=task.get('runId') if parent_run else None,request_id=task.get('requestId'),task_role=task.get('task_role','owner'),completion_owner=task.get('completion_owner',True))
    task.update({k:v for k,v in binding.items() if k not in ('taskId','agentId')})
    return binding

async def _emit_agent_activity(task,phase,tool='',detail='',args=None,tool_status=None,trace_id=None):
    # One persisted binding and assistant projection for the entire canonical run.
    from open_webui.routers import starli_public_activity as activity
    from open_webui.routers.starli_session_fence import emit_owner
    binding=activity.get_task_run(task['owner'],task['taskId'])
    if not binding:return
    if phase=='tool_started':
        event=activity.tool_started(task['owner'],binding['runId'],tool,tool_call_id=task.get('activeToolCallId'))
    elif phase=='tool_finished':
        event=activity.tool_finished(task['owner'],binding['runId'],task['activeToolCallId'],result_status=tool_status or 'UNCERTAIN',duration_ms=task.get('lastToolDurationMs'),error_code=task.get('lastToolErrorCode') or None)
    else:
        budget_root=task.get('budgetRootRunId') or task.get('runId')
        if budget_root==binding['runId'] and aggregate_cancel_status(task['owner'],budget_root).get('cancelRequested'):
            activity.apply_run_cancellation(task['owner'],budget_root)
            return
        status={'task_started':'RUNNING','task_completed':task.get('status'),'task_failed':'FAILED','task_cancelled':'CANCELLED','cancel_requested':'CANCEL_REQUESTED','task_paused':task.get('status')}.get(phase)
        if not status:return
        if status in ('ANSWERED','COMPLETED'):cancellation_fence(task)
        try:
            activity.set_task_state(task['owner'],task['taskId'],status,answer=task.get('progress') if status in {'ANSWERED','COMPLETED','WAITING_INPUT'} else None,objective_complete=task.get('objectiveComplete') is True,needs_input=task.get('needsInput') is True)
        except HTTPException as exc:
            if exc.status_code==409 and task.get('completion_owner') is False:return
            raise
        if task.get('completion_owner') is False:return
        event={'version':'starli.run.v1','type':'run.state',**binding,'status':status,'stepsCompleted':task.get('stepsCompleted',0),'objectiveComplete':task.get('objectiveComplete') is True,'needsInput':task.get('needsInput') is True}
    try:await emit_owner('starli-execution',event,task['owner'])
    except Exception:
        import logging
        logging.getLogger(__name__).warning('Public activity socket delivery deferred')

async def _stop_worker(process):
    if process is None or process.returncode is not None:return True
    try:
        process.terminate()
        try:await asyncio.wait_for(process.wait(),3)
        except asyncio.TimeoutError:
            process.kill();await asyncio.wait_for(process.wait(),3)
        return process.returncode is not None
    except (OSError,RuntimeError,asyncio.TimeoutError):return False

async def run(task,user,worker_id=None,lease_token=None):
    import logging
    from open_webui.routers.starli_preview_events import project_activity
    from open_webui.routers import starli_worker_diagnostics as worker_diagnostics
    stderr_capture=None
    process=None
    heartbeat_task=None
    if lease_token:
        task['leaseToken']=lease_token
        task['workerId']=worker_id
    try:
        if not task.get('runId'):_bind_task_activity(task)
        task.setdefault('runId',str(uuid.uuid4()))
        task.setdefault('budgetRootRunId',task['runId'])
        budget=ensure_run_budget(task['owner'],task['budgetRootRunId'],task.get('deadlineAt'))
        task['deadlineAt']=budget['deadlineAt']
        if budget.get('cancelRequested'):
            task['cancelRequested']=True
            raise asyncio.CancelledError()
        if budget['remainingSteps']<=0 or budget['remainingSeconds']<=0:
            task.update(status='BUDGET_EXHAUSTED',progress='Run budget exhausted; review required',needsInput=True)
            save(task);await _emit_agent_activity(task,'task_paused');return
        task.update(status='RUNNING',progress='Starting isolated Pi session',connected=False,executionStartedAt=task.get('executionStartedAt') or time.time())
        if not save(task):return
        await _emit_agent_activity(task,'task_started')
        cancellation_fence(task)
        if lease_token:
            heartbeat_task=asyncio.create_task(lease_loop(task,worker_id,lease_token))
        env={k:os.environ[k] for k in ('PATH','HOME','LANG','STARLI_PI_MODULE_PATH','OPENROUTER_API_KEY','STARLI_OPENROUTER_API_KEY','STARLI_INFERENCE_BASE_URL','STARLI_INFERENCE_ALLOWED_HOSTS','STARLI_INFERENCE_API_KEY','STARLI_AGENT_PROVIDER','STARLI_AGENT_MODEL','STARLI_BOSS_PROVIDER','STARLI_BOSS_MODEL','STARLI_MODEL_CONTEXT_TOKENS','STARLI_INFERENCE_TIMEOUT_MS') if k in os.environ}
        # Use the existing protected production credential for the isolated
        # inference worker. Never persist it in task records or chat events.
        native_preview=os.getenv('STARLI_RUNTIME_PREVIEW_READONLY')=='1' and verified(task['owner']).role=='admin'
        if not native_preview and not env.get('OPENROUTER_API_KEY') and not env.get('STARLI_OPENROUTER_API_KEY'):
            try:
                from dotenv import dotenv_values
                private_config=dotenv_values(_portable.config_file('production.env'))
                existing_key=private_config.get('OPENROUTER_API_KEY')
                if existing_key:
                    env['OPENROUTER_API_KEY']=existing_key
            except (OSError, ImportError):
                pass
        # Task-specific model selection; existing in-flight jobs retain their model.
        if task.get('model') in ('glm-4.7','qwen3-coder-480b','starli-coder'):
            env['STARLI_AGENT_MODEL']=task['model']
            env['STARLI_BOSS_MODEL']=task['model']
        env.update(STARLI_PROVIDER_OWNER=user.id,STARLI_STATE_DIR=str(state_dir()),PI_CODING_AGENT_DIR=_portable.data_file('.pi/agent'),STARLI_XAI_THINKING='low')
        env = _hosted_inference_environment(env, task.get('model'))
        task['nativePreview']=native_preview
        save(task)
        process=await asyncio.create_subprocess_exec(_portable.node_binary(),'--import',str(runtime_code_dir()/'node_modules/tsx/dist/loader.mjs'),str(RUNNER),
            cwd=str(ROOT),env=env,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,limit=4*1024*1024)
        stderr_capture=asyncio.create_task(worker_diagnostics.drain(getattr(process,'stderr',None)))
        _ACTIVE[task['taskId']]['process']=process
        from open_webui.routers.starli_execution_context import agent_scope,platform_enabled
        with agent_scope(task.get("agentId"),task.get('chatId')):elevated=platform_enabled(user)
        account_context=("Account identity: ADMIN. " if user.role=="admin" else "Account identity: customer. ")+("STARLI PLATFORM enabled for this agent. " if elevated else "Customer workspace scope only; administrator identity does not grant platform access. ")
        process.stdin.write((json.dumps({'prompt':account_context+task['prompt'],'conversation':task.get('conversation') or _history_without_execution(task.get('chatHistory',[])),'continuation':task.get('continuation'),'runId':task['runId'],'taskId':task['taskId'],'sequenceBase':task.get('stepsCompleted',0),'remainingSteps':budget['remainingSteps'],'decisionBudget':24,'deadlineAt':task['deadlineAt']*1000,'nativeSnapshot':task.get('nativeSnapshot'),'readOnlyPreview':task['nativePreview'],'runtimeMode':'native_pi' if task['nativePreview'] else 'legacy_json'})+'\n').encode());await process.stdin.drain()
        async with asyncio.timeout(budget['remainingSeconds']):
            steps=task.get('stepsCompleted',0)
            while True:
                line=await process.stdout.readline()
                if not line:break
                event=json.loads(line)
                provider_receipt=event.get('receipt') or {}
                if provider_receipt.get('fallback') and not task.get('fallbackReported'):
                    task['fallbackReported']=True
                    task['inferenceProvider']={k:provider_receipt.get(k) for k in ('provider','model','fallback','fallbackReason')}
                    save(task)
                    await _emit_agent_activity(task,'provider_fallback',detail='Self-hosted inference unavailable; using configured '+str(provider_receipt.get('model','platform fallback'))[:120])

                with db() as c:
                    current=c.execute('SELECT payload FROM tasks WHERE id=?',(task['taskId'],)).fetchone()
                if current and json.loads(current[0]).get('cancelRequested'):raise asyncio.CancelledError()
                if event.get('type')=='authorize':
                    cancellation_fence(task)
                    if event.get('phase') not in ('model','tool'):raise RuntimeError('Invalid authorization phase')
                    process.stdin.write((json.dumps({'authorized':True})+'\n').encode());await process.stdin.drain()
                    continue
                if event.get('type')=='native_checkpoint':
                    cancellation_fence(task)
                    snapshot=event.get('snapshot')
                    if not isinstance(snapshot,dict) or snapshot.get('version')!=1 or len(json.dumps(snapshot))>3*1024*1024:raise RuntimeError('Invalid native checkpoint')
                    task['nativeSnapshot']=snapshot
                    save(task)
                    process.stdin.write((json.dumps({'checkpointSaved':True})+'\n').encode());await process.stdin.drain()
                    continue
                if event.get('type')=='text_delta':
                    cancellation_fence(task)
                    text=event.get('text')
                    if not isinstance(text,str) or len(text)>20000:raise RuntimeError('Invalid text delta')
                    # Text belongs to the persisted originating assistant, never a phase message.
                    task['streamedAnswer']=(task.get('streamedAnswer','')+text)[-12000:]
                    binding=_bind_task_activity(task)
                    if binding:
                        from open_webui.routers.starli_session_fence import emit_owner
                        await emit_owner('starli-execution',{'version':'starli.run.v1','type':'run.text.delta',**{key:binding.get(key) for key in ('runId','requestId','conversationId','assistantMessageId','taskId','agentId')},'text':text},task['owner'])
                    continue
                if event.get('type')=='checkpoint':
                    cancellation_fence(task)
                    call_id=event.get('checkpoint',{}).get('toolCallId')
                    checkpoint_data=event.get('checkpoint',{})
                    phase=checkpoint_data.get('phase')
                    same_receipt=(call_id==task.get('activeToolCallId') and (call_id is not None or phase=='decision' and steps==0))
                    if phase=='decision':
                        previous=task.get('milestoneReceiptSequence')
                        task['milestoneWithoutProgress']=task.get('milestoneWithoutProgress',0)+1 if previous==steps else 1
                        task['milestoneReceiptSequence']=steps
                    forced_pause=checkpoint_data.get('reason') in ('NO_PROGRESS','MODEL_DECISION_BUDGET','TOTAL_STEP_BUDGET','UNCERTAIN_OR_PENDING_WRITE') or task.get('milestoneWithoutProgress',0)>=3
                    safe=bool(same_receipt and not forced_pause and checkpoint_can_continue(task,call_id))
                    task['checkpoint']={'version':1,'phase':'decision' if phase=='decision' else 'after_tool','toolCallId':call_id,'step':steps,'safeToResume':safe,'reason':checkpoint_data.get('reason') if checkpoint_data.get('reason') in ('MILESTONE','NO_PROGRESS','MODEL_DECISION_BUDGET','TOTAL_STEP_BUDGET','UNCERTAIN_OR_PENDING_WRITE','SEGMENT_BOUNDARY') else 'CHECKPOINT','updatedAt':time.time()}
                    if isinstance(event.get('conversation'),list):task['conversation']=event['conversation'][-32:]
                    continuation=event.get('continuation')
                    if isinstance(continuation,dict):task['continuation']={'version':1,'transcript':[v[:18000] for v in continuation.get('transcript',[]) if isinstance(v,str)][-7:]}
                    current_budget=ensure_run_budget(task['owner'],task['budgetRootRunId'],task['deadlineAt'])
                    task['aggregateAttempts']=current_budget['attempts']
                    if safe:
                        task['progress']='Continuing from verified checkpoint'
                        save(task)
                        process.stdin.write((json.dumps({'continue':True,'toolCallId':call_id})+'\n').encode());await process.stdin.drain()
                        continue
                    task.update(status='BUDGET_EXHAUSTED',progress='Run paused at checkpoint; review required',needsInput=True,objectiveComplete=False)
                    save(task);await _emit_agent_activity(task,'task_paused');break
                if event.get('type')=='done':
                    needs_input=event.get('needsInput') is True
                    complete=event.get('objectiveComplete') is True and not needs_input
                    cancellation_fence(task)
                    task.update(status='COMPLETED' if complete else 'WAITING_INPUT' if needs_input else 'ANSWERED',progress=str(event.get('result',''))[:12000],connected=True,objectiveComplete=complete,needsInput=needs_input)
                    if isinstance(event.get('conversation'),list):task['conversation']=event['conversation'][-32:]
                    task['receipts'].append(json.dumps(event.get('receipt',{}))[:2500]);save(task)
                    await _emit_agent_activity(task,'task_completed',detail=task['progress'])
                    break
                if event.get('type')=='error':
                    task['failureDiagnostic']=worker_diagnostics.from_event(event)
                    code=str(event.get('code','PI_EXECUTION_FAILED'))
                    task['errorCode']=code if code.startswith('STARLI_INFERENCE_') and len(code)<48 else code if code in {'PROVIDER_SUBSCRIPTION_MODEL_UNSUPPORTED','INVALID_MODEL_DECISION','STEP_LIMIT','PI_XAI_REQUEST_LIMIT','PI_XAI_INFERENCE_FAILED','PI_EXECUTION_FAILED','PI_XAI_MODEL_UNAVAILABLE','PI_XAI_EMPTY_OUTPUT','PI_XAI_AUTH_REQUIRED','STARLI_QWEN_NOT_CONFIGURED','STARLI_INFERENCE_HTTP_400','STARLI_INFERENCE_HTTP_401','STARLI_INFERENCE_HTTP_402','STARLI_INFERENCE_HTTP_403','STARLI_INFERENCE_HTTP_404','STARLI_INFERENCE_HTTP_408','STARLI_INFERENCE_HTTP_409','STARLI_INFERENCE_HTTP_422','STARLI_INFERENCE_HTTP_429','STARLI_INFERENCE_HTTP_500','STARLI_INFERENCE_HTTP_502','STARLI_INFERENCE_HTTP_503','STARLI_INFERENCE_HTTP_504'} else 'PI_EXECUTION_FAILED'
                    raise RuntimeError('Execution failed')
                if event.get('type')!='tool':raise RuntimeError('Invalid runtime event')
                expected_sequence=steps+1
                expected_call=task['runId']+':'+task['taskId']+':tool:'+str(expected_sequence)
                if event.get('sequence')!=expected_sequence or event.get('toolCallId')!=expected_call:raise RuntimeError('Invalid worker tool sequence')
                steps=expected_sequence
                if steps>MAX_TOOL_STEPS:raise RunBudgetExhausted('RUN_BUDGET_EXHAUSTED')
                if not lease_token:task['leaseUntil']=task['deadlineAt']
                task['stepsCompleted']=steps
                task['checkpoint']={'step':steps,'phase':'before_tool','tool':str(event.get('tool',''))[:100],'updatedAt':time.time()}
                save(task)
                user=verified(task['owner'])
                cancellation_fence(task)
                op=event.get('tool');args=event.get('args',{})
                if task.get('nativePreview') and op not in ('capabilities','starlis.list'):raise HTTPException(403,'Read-only native preview tool denied')
                if op=='starlis.message' and task.get('agentId'):args={**args,'fromAgentId':task['agentId']}
                task['activeToolCallId']=expected_call
                task['activeToolReadOnly']=read_only_tool(op,args)
                reserved=reserve_run_attempt(task['owner'],task['budgetRootRunId'],expected_call,read_only=task['activeToolReadOnly'])
                task['aggregateAttempts']=reserved['attempts']
                task['toolStartedAt']=time.monotonic()
                task['progress']='Using '+str(op);save(task)
                from open_webui.routers.starli_tool_trace import record
                trace_id=record(task['owner'],op if op!='platform.call' else 'platform.call:'+str(args.get('tool','')),'STARTED',task_id=task['taskId'],chat_id=task.get('chatId',''),args=args.get('args',{}) if op=='platform.call' else args)
                await _emit_agent_activity(task,'tool_started',tool=(str(args.get('tool','')) if op=='platform.call' else op),detail='Invoking '+(str(args.get('tool','')) if op=='platform.call' else str(op)),args=args.get('args',{}) if op=='platform.call' else args,trace_id=trace_id)
                cancellation_fence(task)
                await project_activity(user,task.get('chatId'),task.get('agentId'),str(args.get('tool')) if op=='platform.call' else op,args.get('args',{}) if op=='platform.call' else args,phase='building',run_id=task['taskId'])
                try:
                    from open_webui.routers.starli_execution_context import agent_scope
                    with agent_scope(task.get("agentId"),task.get("chatId")):
                        if op=='project.start':
                            result={'error':'Nested task start denied; continue the current owned objective','status':'DENIED'}
                        elif op=='crm.search':
                            from open_webui.routers.starli_tools import bridge
                            result=await bridge(user,'invoke','crm_search_prospects',{'search':str(args.get('q',''))[:200],'limit':20})
                        elif op=='platform.schema':
                            from open_webui.routers.starli_pi_master import _tool
                            result=await _tool(user,'platform.schema',args,task['taskId']+':schema:'+str(steps))
                        elif op=='platform.call':
                            from open_webui.routers.starli_pi_master import _tool
                            tool_name=args.get('tool')
                            operation_key=task['taskId']+':'+str(steps)+':'+hashlib.sha256(json.dumps(args,sort_keys=True).encode()).hexdigest()
                            if tool_name=='task_agent_spawn':
                                result={'error':'Nested spawning disabled by capacity policy'}
                            else:
                                # Use the SAME authenticated dispatcher as interactive STARLI.
                                # The previous bridge fallback rejected native source tools.
                                result=await _tool(user,'platform.call',{'tool':tool_name,'args':args.get('args',{})},operation_key)
                        elif op=='capabilities':
                            from open_webui.routers.starli_tools import catalog
                            data=await catalog(user=user)
                            from open_webui.routers.starli_pi_master import _tool
                            native=[]
                            for name in ('project.start','project.status','project.stop','starlis.list','starlis.message'):
                                schema=await _tool(user,'platform.schema',{'tool':name},task['taskId']+':discover:'+name)
                                if isinstance(schema,dict) and 'error' not in schema:native.append(schema)
                            result={'tools':['starlis.list','starlis.message','crm.search','browser.navigate','browser.read','browser.observe','browser.click','browser.type','browser.key','browser.scroll','capabilities','platform.schema','platform.call'],'platformTools':native+data.get('tools',[]),'mode':'User execution mode is enforced on every tool call'}
                        elif op in ('project.start','project.status','project.stop','starlis.list','starlis.message','browser.navigate','browser.read','browser.observe','browser.click','browser.type','browser.key','browser.scroll','delegate.task','delegate.status','delegate.cancel'):
                            # Route every tool advertised to the model through the
                            # same authenticated, policy-enforcing dispatcher.
                            from open_webui.routers.starli_pi_master import _tool
                            result=await _tool(user,op,args,task['taskId']+':'+str(steps)+':'+op)
                        else:raise RuntimeError('Tool not allowed')
                except Exception as exc:
                    import logging
                    logging.getLogger(__name__).exception('Delegated Starli tool failed: %s',op)
                    result={'error':'Tool execution failed','errorType':type(exc).__name__,'status':'FAILED' if task['activeToolReadOnly'] or isinstance(exc,HTTPException) and exc.status_code in (401,403,404,422) else 'UNCERTAIN'}

                cancellation_fence(task)
                from open_webui.routers.starli_result_status import classify_result
                classification=classify_result(result)
                outcome=classification['outcome']
                status=classification['status']
                task['lastToolDurationMs']=max(0,int((time.monotonic()-task['toolStartedAt'])*1000))
                task['lastToolErrorCode']=classification['errorCode']
                finish_run_attempt(task['owner'],task['budgetRootRunId'],task['activeToolCallId'],status,read_only=task['activeToolReadOnly'])
                task['uncertainTool']=not task['activeToolReadOnly'] and status in ('PENDING','QUEUED','UNCERTAIN')

                trace_id=record(task['owner'],op if op!='platform.call' else 'platform.call:'+str(args.get('tool','')),status,task_id=task['taskId'],chat_id=task.get('chatId',''),args=args.get('args',{}) if op=='platform.call' else args)
                task['receipts'].append(str(op)+': '+outcome+(' ('+classification['errorCode']+')' if classification['errorCode'] else ''))
                task['receipts']=task['receipts'][-24:]
                task['checkpoint']={'step':steps,'phase':'after_tool','tool':str(op)[:100],'updatedAt':time.time()}
                save(task)
                await _emit_agent_activity(task,'tool_finished',tool=(str(args.get('tool','')) if op=='platform.call' else op),detail=outcome,tool_status=status,args=args.get('args',{}) if op=='platform.call' else args,trace_id=trace_id)
                await project_activity(user,task.get('chatId'),task.get('agentId'),str(args.get('tool')) if op=='platform.call' else op,args.get('args',{}) if op=='platform.call' else args,result,phase='ready',run_id=task['taskId'])
                # In-flight steering is delivered at the next tool boundary, not mid-inference.
                try:
                    from open_webui.routers.starli_v3_native import _db, _utc
                    with _db() as connection:
                        binding=connection.execute("SELECT agent_id FROM autonomous_sessions WHERE owner=? AND task_id=? AND enabled=1",(task['owner'],task['taskId'])).fetchone()
                        steering=[]
                        if binding:
                            rows=connection.execute("SELECT id,message FROM autonomous_steering WHERE owner=? AND agent_id=? AND consumed_at IS NULL ORDER BY id LIMIT 10",(task['owner'],binding['agent_id'])).fetchall()
                            steering=[r['message'] for r in rows]
                            if rows:
                                connection.executemany("UPDATE autonomous_steering SET consumed_at=? WHERE id=? AND consumed_at IS NULL",[(_utc(),r['id']) for r in rows])
                                connection.commit()
                    if steering:
                        result={'toolResult':result,'userSteering':steering,'steeringPriority':'Apply latest user instructions on next decision; retain authorization and safety boundaries'}
                        await _emit_agent_activity(task,'steering_received',detail='New user steering applied at tool boundary')
                except Exception:
                    logging.getLogger(__name__).exception('Steering delivery failed; queue retained where possible')
                if not isinstance(result,dict):result={'toolResult':result}
                result={**result,'_runtime':{'toolCallId':task['activeToolCallId'],'sequence':steps,'resultStatus':status,'durationMs':task['lastToolDurationMs'],'errorCode':task.get('lastToolErrorCode') or None}}
                process.stdin.write((json.dumps(result)+'\n').encode());await process.stdin.drain()
        if task['status'] not in ('ANSWERED','COMPLETED','WAITING_INPUT','BUDGET_EXHAUSTED'):raise RuntimeError('No final receipt')
    except asyncio.CancelledError:
        task.update(status='CANCEL_REQUESTED',progress='Stopping worker',cancelRequested=True);save(task)
        await _emit_agent_activity(task,'cancel_requested')
    except RunCancelled:
        task.update(status='CANCEL_REQUESTED',progress='Stopping worker',cancelRequested=True);save(task)
        await _emit_agent_activity(task,'cancel_requested')
    except RunBudgetExhausted:
        task.update(status='BUDGET_EXHAUSTED',progress='Run budget exhausted; review required',needsInput=True,objectiveComplete=False)
        save(task);await _emit_agent_activity(task,'task_paused')
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception('Starli autonomous worker failed task=%s: %s',task.get('taskId'),type(exc).__name__)
        if not task.get('errorCode'):
            task['errorCode']='WORKER_'+type(exc).__name__.upper()[:45]
        # Keep only the error class; provider text may contain private request data.
        task['failureDetail']=worker_diagnostics.clean({'errorType':type(exc).__name__})['errorType']
        progress=('The selected subscription model is unavailable. Choose a current subscription model in Settings → Providers.' if task['errorCode']=='PROVIDER_SUBSCRIPTION_MODEL_UNSUPPORTED' else 'Starli delegated execution stopped ('+task['errorCode']+'); no automatic retry')
        task.update(status='FAILED',progress=progress);save(task)
        await _emit_agent_activity(task,'task_failed',detail=task['progress'])
    finally:
        if heartbeat_task:
            heartbeat_task.cancel()
            try:await heartbeat_task
            except asyncio.CancelledError:pass
        stop_confirmed=await _stop_worker(process)
        record_worker_stop(task,stop_confirmed)
        if task.get('cancelRequested'):
            confirmed=stop_confirmed
            uncertain=bool(task.get('uncertainTool') or task.get('checkpoint',{}).get('phase')=='before_tool' and task.get('activeToolCallId') and not task.get('activeToolReadOnly'))
            task['workerStopConfirmed']=confirmed
            task.update(status='CANCELLED' if confirmed and not uncertain else 'INTERRUPTED',progress='Worker stopped' if confirmed and not uncertain else 'Worker stop requires review',needsInput=not confirmed or uncertain,connected=False)
            save(task)
            await _emit_agent_activity(task,'task_cancelled' if task['status']=='CANCELLED' else 'task_paused')
        captured=None
        if stderr_capture:
            try:captured=await asyncio.wait_for(stderr_capture,2)
            except (asyncio.TimeoutError,asyncio.CancelledError):stderr_capture.cancel()
            except Exception:pass
        if task.get('status')=='FAILED':
            try:
                diagnostic=worker_diagnostics.merge(task.get('failureDiagnostic'),captured)
                worker_diagnostics.persist_task(db,task['taskId'],task['owner'],diagnostic)
                import logging
                logging.getLogger(__name__).error('Starli worker diagnostic task=%s %s',task['taskId'],json.dumps(diagnostic,sort_keys=True))
            except Exception:
                import logging
                logging.getLogger(__name__).warning('Worker diagnostic unavailable')
        if lease_token:
            from open_webui.routers.starli_worker_leases import release
            with db() as connection:release(connection,task['taskId'],worker_id,lease_token)
        _ACTIVE.pop(task['taskId'],None)

async def lease_loop(task,worker_id,token):
    from open_webui.routers.starli_worker_leases import heartbeat
    while True:
        await asyncio.sleep(8)
        try:
            with db() as connection:
                valid=heartbeat(connection,task['taskId'],worker_id,token,ttl=30)
            cancellation_fence(task)
            current=verified(task['owner'])
            if valid and task.get('chatId') and task.get('agentId'):
                from open_webui.routers.starli_session_fence import emit_owner
                await emit_owner('starli-execution',{'version':'starli.run.v1','type':'run.heartbeat','runId':task.get('runId'),'requestId':task.get('requestId'),'conversationId':task['chatId'],'assistantMessageId':task.get('assistantMessageId'),'taskId':task['taskId'],'status':'RUNNING'},task['owner'])
        except asyncio.CancelledError:
            if asyncio.current_task() and asyncio.current_task().cancelling():raise
            job=_ACTIVE.get(task['taskId'])
            if job and job.get('task'):job['task'].cancel()
            return
        except Exception:
            valid=False
        if not valid:
            job=_ACTIVE.get(task['taskId'])
            if job and job.get('task'):job['task'].cancel()
            return


async def worker_once(worker_id):
    from open_webui.routers.starli_worker_leases import claim
    with db() as connection:
        rows=connection.execute('SELECT id,payload FROM tasks').fetchall()
    for ident,payload in rows:
        task=json.loads(payload)
        if task.get('status')!='QUEUED':continue
        with db() as connection:token=claim(connection,ident,worker_id,ttl=30)
        if not token:continue
        with db() as connection:
            task=json.loads(connection.execute('SELECT payload FROM tasks WHERE id=?',(ident,)).fetchone()[0])
        try:user=verified(task['owner'])
        except Exception:
            task.update(status='FAILED',progress='Owner authorization unavailable')
            save(task)
            from open_webui.routers.starli_worker_leases import release
            with db() as connection:
                release(connection,ident,worker_id,token)
            continue
        _ACTIVE[ident]={'task':asyncio.current_task(),'process':None}
        await run(task,user,worker_id,token)
        return True
    return False


async def worker_forever(worker_id,poll_seconds=2):
    while True:
        if not await worker_once(worker_id):
            await asyncio.sleep(poll_seconds)


def _hosted_inference_environment(env, model):
    """Honor an explicitly validated hosted choice, not the account provider."""
    result = dict(env)
    if model in (None, "nvidia/nemotron-3-ultra-550b-a55b:free"):
        if result.get("STARLI_PROVIDER_OWNER"):
            from open_webui.routers.starli_providers import runtime_configuration
            if runtime_configuration(result["STARLI_PROVIDER_OWNER"]):
                result["STARLI_NATIVE_ACCOUNT_SELECTED"]="1"
        return result
    from open_webui.routers.starli_v3_native import _validate_provider
    _validate_provider("hosted", model)
    result.update(STARLI_AGENT_PROVIDER="selfhosted", STARLI_BOSS_PROVIDER="selfhosted",
                  STARLI_AGENT_MODEL=model, STARLI_BOSS_MODEL=model)
    result.pop("STARLI_PROVIDER_OWNER", None)
    return result

async def adapter(uid,operation,payload):
    user=verified(uid)
    recover_orphaned_tasks()
    if operation=='capabilities':
        return {'connected':RUNNER.is_file(),'spawn':RUNNER.is_file(),'automaticSafeChunks':True,'resume':False,'bindingRequiredForChat':True,'maxToolAttempts':MAX_TOOL_STEPS,'maxDurationSeconds':MAX_TASK_SECONDS,'detail':'Owned bounded workers; shared canonical-run budgets and fresh authorization apply to every tool attempt.'}
    if operation=='tasks.create':
        if payload.get('model') not in (None,'nvidia/nemotron-3-ultra-550b-a55b:free','glm-4.7','qwen3-coder-480b','starli-coder'):
            from open_webui.routers.starli_v3_native import _validate_provider
            try:_validate_provider('hosted',payload.get('model'))
            except HTTPException as exc:
                if exc.status_code==422:raise HTTPException(400,'Model unavailable') from None
                raise
        digest=hashlib.sha256(json.dumps({k:payload.get(k) for k in ('prompt','model','agentId','chatId','runId','requestId','assistantMessageId','budgetRootRunId')},sort_keys=True).encode()).hexdigest()
        async with _LOCK:
            with db() as c:
                c.execute('BEGIN IMMEDIATE')
                row=c.execute('SELECT id,request_hash,payload FROM tasks WHERE owner=? AND idem=?',(uid,payload['idempotencyKey'])).fetchone()
                if row:
                    if row[1]!=digest:raise HTTPException(409,'Idempotency key reused with different task')
                    prior=json.loads(row[2])
                    if prior['status'] not in TERMINAL and row[0] not in _ACTIVE and not EXTERNAL_WORKER:
                        prior.update(status='INTERRUPTED',progress='Worker unavailable; task not replayed',connected=False,recoveryPolicy='manual_review_required')
                        c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(prior),row[0]))
                    return receipt(prior)
                live=[json.loads(r[0]) for r in c.execute('SELECT payload FROM tasks').fetchall()]
                live=[t for t in live if t.get('status') not in TERMINAL and (EXTERNAL_WORKER or t['taskId'] in _ACTIVE)]
                if len(live)>=12 or sum(t.get('owner')==uid for t in live)>=4:raise HTTPException(429,'Project worker capacity reached; task remains queued')
                ident='starli-task-'+uuid.uuid4().hex
                task={'taskId':ident,'owner':uid,'prompt':payload['prompt'],'status':'QUEUED','progress':'Queued','receipts':[],'chatHistory':_history_without_execution(payload.get('chatHistory',[])),'model':payload.get('model'),'agentId':payload.get('agentId'),'deliveryId':payload.get('deliveryId'),'steeringIds':payload.get('steeringIds',[]),'connected':False,'leaseUntil':time.time()+MAX_TASK_SECONDS}
                if task.get("agentId"):
                    from open_webui.routers.starli_v3_native import _db as registry_db
                    with registry_db() as registry:
                        binding=registry.execute("SELECT chat_id FROM agent_conversations WHERE owner=? AND agent_id=?",(uid,task["agentId"])).fetchone()
                    if binding:task["chatId"]=binding["chat_id"]
                trusted_run=payload.get('runId')
                task.update(task_role=payload.get('task_role','owner'),completion_owner=payload.get('completion_owner',True),runId=trusted_run or str(uuid.uuid4()),requestId=payload.get('requestId') or str(uuid.uuid4()),assistantMessageId=payload.get('assistantMessageId'),budgetRootRunId=payload.get('budgetRootRunId') or trusted_run or None,publicAgentId=payload.get('publicAgentId'),parentRunId=payload.get('parentRunId'))
                early_root=task.get('budgetRootRunId') or task['runId']
                early_budget=c.execute('SELECT cancel_requested FROM run_budgets WHERE owner=? AND run_id=?',(uid,early_root)).fetchone()
                if early_budget and early_budget[0]:raise HTTPException(409,'Run cancellation requested; no task was created')
                if payload.get('chatId'):
                    if task.get('chatId') and task['chatId']!=payload['chatId']:raise HTTPException(409,'Task conversation binding mismatch')
                    task['chatId']=payload['chatId']
                if task.get('chatId'):
                    from open_webui.models.chats import Chats
                    owned_chat=Chats.get_chat_by_id(task['chatId'])
                    if not owned_chat or owned_chat.user_id!=uid:raise HTTPException(403,'Task conversation unavailable')
                    _bind_task_activity(task)
                task['budgetRootRunId']=task.get('budgetRootRunId') or task['runId']
                c.execute('INSERT OR IGNORE INTO run_budgets(owner,run_id,attempts,deadline) VALUES(?,?,0,?)',(uid,task['budgetRootRunId'],time.time()+MAX_TASK_SECONDS))
                launch_budget=_budget_value(c.execute('SELECT attempts,deadline,cancel_requested FROM run_budgets WHERE owner=? AND run_id=?',(uid,task['budgetRootRunId'])).fetchone())
                if launch_budget.get('cancelRequested'):raise HTTPException(409,'Run cancellation requested; no task was created')
                task['deadlineAt']=launch_budget['deadlineAt'];task['leaseUntil']=launch_budget['deadlineAt']
                c.execute('INSERT INTO tasks VALUES(?,?,?,?,?)',(ident,uid,payload['idempotencyKey'],digest,json.dumps(task)))
            if not EXTERNAL_WORKER:
                _ACTIVE[ident]={'task':None,'process':None}
                _ACTIVE[ident]['task']=asyncio.create_task(run(task,user))
                _ACTIVE[ident]['task'].add_done_callback(lambda done: _ACTIVE.pop(ident,None))
        return receipt(task)
    task=owned(uid,payload['taskId'])
    if task.get('status')=='CANCELLED' and task.get('chatId'):
        from open_webui.routers import starli_public_activity as activity
        activity.set_task_state(uid,task['taskId'],'CANCELLED')
    if operation=='tasks.resume':raise HTTPException(409,'Live checkpoints continue automatically; interrupted or paused runs require review and a new authorized task')
    if operation=='tasks.cancel' and task['status'] not in {'ANSWERED','COMPLETED','FAILED','CANCELLED','INTERRUPTED'}:
        job=_ACTIVE.get(task['taskId'])
        request_cancel(task)
        await _emit_agent_activity(task,'cancel_requested')
        if job and job.get('task'):job['task'].cancel()
    return receipt(task)
