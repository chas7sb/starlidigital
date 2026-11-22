"""Single approved compile-only recovery; no model/worker/chat dispatch."""
import asyncio,hashlib,hmac,json,os,sqlite3,time
from pathlib import Path
from contextlib import contextmanager
from fastapi import Request,HTTPException
from pydantic import BaseModel,ConfigDict,StrictStr
INTENT='5818035e3cb2ab4ce8a3536961278e629c952aa3'
BUILD='build-39c34ac2e224c60aa2e5ca3d018f0cab68eed3bc'
VERSION='EXACT_UNMATCHED_JSX_MAP_PAREN_V1'
def canon(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def sha(x):return hashlib.sha256(canon(x).encode()).hexdigest()
class RepairIn(BaseModel):
 model_config=ConfigDict(extra='forbid',strict=True)
 intentId:StrictStr
 buildId:StrictStr
 approvedRepairVersion:StrictStr

def install_model_app_compile_repair(app,svc,authority,builds,lifecycle):
 from guest_model_build import BuildContext
 key_path=Path(svc.p.root)/'.model-app-control.key'
 if not key_path.is_file() or key_path.stat().st_uid!=997 or key_path.stat().st_mode&0o077:raise ValueError('PRIVATE_REPAIR_KEY_REQUIRED')
 key=key_path.read_text();lock=asyncio.Lock()
 original_instance=next(r.endpoint for r in app.routes if getattr(r,'path','')=='/internal/v1/model-app-control/instance')
 @contextmanager
 def db():
  c=sqlite3.connect(str(svc.p.intake),timeout=5);c.row_factory=sqlite3.Row
  try:
   with c:yield c
  finally:c.close()
 with db() as c:c.execute('CREATE TABLE IF NOT EXISTS model_app_compile_repairs(build TEXT PRIMARY KEY,intent TEXT NOT NULL,version TEXT NOT NULL,state TEXT NOT NULL,original_error TEXT,original_result_hash TEXT NOT NULL,source_hash TEXT NOT NULL,created REAL NOT NULL,result TEXT,error TEXT)')
 @app.post('/internal/v1/model-app-control/{build}/compile-repair')
 async def repair(build:str,body:RepairIn,request:Request):
  if request.client is None or request.client.host not in ('127.0.0.1','::1') or not hmac.compare_digest(request.headers.get('x-starli-model-control',''),key):raise HTTPException(403,'PRIVATE_REPAIR_DENIED')
  instance=original_instance(request)
  if instance['pid']!=os.getpid() or not hmac.compare_digest(request.headers.get('x-starli-control-instance',''),instance['instanceNonce']):raise HTTPException(409,'REPAIR_INSTANCE_CHANGED')
  if build!=BUILD or body.buildId!=BUILD or body.intentId!=INTENT or body.approvedRepairVersion!=VERSION:raise HTTPException(403,'EXACT_APPROVED_REPAIR_REQUIRED')
  async with lock:
   context=authority.resolve_guest_request(request,INTENT);snapshot=context.revalidate()
   with db() as c:
    row=c.execute('SELECT * FROM guest_model_app_jobs WHERE id=? AND intent=? AND binding=?',(BUILD,INTENT,snapshot['guestBinding'])).fetchone()
    prior=c.execute('SELECT * FROM model_app_compile_repairs WHERE build=?',(BUILD,)).fetchone()
   if not row:raise HTTPException(404,'EXACT_REPAIR_JOB_NOT_FOUND')
   if prior:
    if prior['state']=='COMPLETE' and row['state']=='READY':return json.loads(prior['result'])
    raise HTTPException(409,'REPAIR_ALREADY_ATTEMPTED_NO_AUTOMATIC_RETRY')
   if row['state']!='INTERRUPTED' or row['error']!='MODEL_APP_COMPILE_FAILED' or BUILD in lifecycle.apps:raise HTTPException(409,'EXACT_COMPILE_FAILURE_REQUIRED')
   messages=snapshot['messages'];positions=[i for i,m in enumerate(messages) if m['id']==row['source'] and m['role']=='user']
   if len(positions)!=1:raise HTTPException(403,'REPAIR_CANONICAL_SOURCE_REQUIRED')
   prefix=messages[:positions[0]+1]
   if sha(prefix)!=row['conversation_hash']:raise HTTPException(403,'REPAIR_CONVERSATION_HASH_MISMATCH')
   source_file=Path(svc.p.root)/'model-app-state'/BUILD/'compile-input.json'
   raw=source_file.read_bytes();config=json.loads(raw);result=config['execution']
   expected={'buildId':BUILD,'intentId':INTENT,'sourceMessageId':row['source'],'companyId':snapshot['companyId'],'projectId':snapshot['projectId'],'requestId':snapshot['requestId']}
   if any(result.get(k)!=v for k,v in expected.items()) or result.get('provider')!='OPENROUTER_MODEL' or result.get('modelCalls')!=2 or len(result.get('outputs',[]))!=2:raise HTTPException(403,'REPAIR_REAL_NATIVE_OUTPUT_BINDING_REQUIRED')
   # R2 compiler revalidates source HMAC/Agency receipts and exact original-source hash before transform.
   frozen={**snapshot,'messages':prefix,'conversationHash':row['conversation_hash'],'userMessageId':row['source']}
   context.initial=frozen;build_context=BuildContext(context,frozen)
   with db() as c:
    c.execute('BEGIN IMMEDIATE')
    c.execute('INSERT INTO model_app_compile_repairs VALUES(?,?,?,?,?,?,?,?,NULL,NULL)',(BUILD,INTENT,VERSION,'STARTED',row['error'],hashlib.sha256(raw).hexdigest(),row['conversation_hash'],time.time()))
   try:
    extra=await lifecycle.on_built(result,build_context)
    current=build_context.revalidate()
    if current['intentId']!=INTENT or current['guestBinding']!=snapshot['guestBinding'] or current['messages'][:len(prefix)]!=prefix:raise ValueError('REPAIR_AUTHORITY_CHANGED')
    ready={**result,**extra};summary={'repairStatus':'COMPLETE','buildId':BUILD,'intentId':INTENT,'approvedRepairVersion':VERSION,'sameBuild':True,'newModelCalls':0,'newWorkerDispatches':0,'artifactDigest':ready['artifactDigest'],'priorFailurePreserved':True}
    with db() as c:
     c.execute('BEGIN IMMEDIATE')
     updated=c.execute("UPDATE guest_model_app_jobs SET state='READY',result=?,error=NULL WHERE id=? AND intent=? AND state='INTERRUPTED'",(json.dumps(ready),BUILD,INTENT))
     if updated.rowcount!=1:raise ValueError('REPAIR_JOB_STATE_CHANGED')
     c.execute("UPDATE model_app_compile_repairs SET state='COMPLETE',result=? WHERE build=? AND state='STARTED'",(json.dumps(summary),BUILD))
    return summary
   except BaseException as error:
    if BUILD in lifecycle.apps:
     instance=lifecycle.apps.pop(BUILD)
     await lifecycle.stop_instance(instance)
    with db() as c:c.execute("UPDATE model_app_compile_repairs SET state='FAILED',error=? WHERE build=? AND state='STARTED'",(type(error).__name__,BUILD))
    raise HTTPException(503,'COMPILE_ONLY_REPAIR_FAILED') from None
 return {'route':'/internal/v1/model-app-control/{build}/compile-repair','intentId':INTENT,'buildId':BUILD,'approvedRepairVersion':VERSION,'privateInstanceGuard':True,'oneAttempt':True,'modelDispatch':False}
