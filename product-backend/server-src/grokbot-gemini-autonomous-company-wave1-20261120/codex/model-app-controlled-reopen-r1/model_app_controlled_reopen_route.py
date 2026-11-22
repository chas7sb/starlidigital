"""Explicit private reopen of the one repaired actual app. No compile/model/worker dispatch."""
import asyncio,hashlib,hmac,json,os,sqlite3,time
from pathlib import Path
from contextlib import contextmanager
from fastapi import Request,HTTPException
from pydantic import BaseModel,ConfigDict,StrictStr
INTENT='5818035e3cb2ab4ce8a3536961278e629c952aa3'
BUILD='build-39c34ac2e224c60aa2e5ca3d018f0cab68eed3bc'
ARTIFACT='fffd714263b18337d71256455bf93afb249d8846778fcb016906c30bdf322ffb'
VERSION='CONTROLLED_EXISTING_APP_REOPEN_V1'
def sha(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
class ReopenIn(BaseModel):
 model_config=ConfigDict(extra='forbid',strict=True)
 intentId:StrictStr
 buildId:StrictStr
 approvedReopenVersion:StrictStr

def install_model_app_controlled_reopen(app,svc,authority,builds,lifecycle,reopen_existing):
 from guest_model_build import BuildContext
 key_path=Path(svc.p.root)/'.model-app-control.key'
 if not key_path.is_file() or key_path.stat().st_uid!=997 or key_path.stat().st_mode&0o077:raise ValueError('PRIVATE_REOPEN_KEY_REQUIRED')
 key=key_path.read_text();lock=asyncio.Lock()
 original_instance=next(r.endpoint for r in app.routes if getattr(r,'path','')=='/internal/v1/model-app-control/instance')
 @contextmanager
 def db():
  c=sqlite3.connect(str(svc.p.intake),timeout=5);c.row_factory=sqlite3.Row
  try:
   with c:yield c
  finally:c.close()
 with db() as c:c.execute('CREATE TABLE IF NOT EXISTS model_app_controlled_reopens(build TEXT NOT NULL,instance_nonce TEXT NOT NULL,intent TEXT NOT NULL,version TEXT NOT NULL,state TEXT NOT NULL,source_hash TEXT NOT NULL,created REAL NOT NULL,result TEXT,error TEXT,PRIMARY KEY(build,instance_nonce))')
 @app.post('/internal/v1/model-app-control/{build}/reopen')
 async def reopen(build:str,body:ReopenIn,request:Request):
  if request.client is None or request.client.host not in ('127.0.0.1','::1') or not hmac.compare_digest(request.headers.get('x-starli-model-control',''),key):raise HTTPException(403,'PRIVATE_REOPEN_DENIED')
  instance=original_instance(request);nonce=instance['instanceNonce']
  if instance['pid']!=os.getpid() or not hmac.compare_digest(request.headers.get('x-starli-control-instance',''),nonce):raise HTTPException(409,'REOPEN_INSTANCE_CHANGED')
  if build!=BUILD or body.buildId!=BUILD or body.intentId!=INTENT or body.approvedReopenVersion!=VERSION:raise HTTPException(403,'EXACT_APPROVED_REOPEN_REQUIRED')
  async with lock:
   context=authority.resolve_guest_request(request,INTENT);snapshot=context.revalidate()
   with db() as c:
    row=c.execute('SELECT * FROM guest_model_app_jobs WHERE id=? AND intent=? AND binding=?',(BUILD,INTENT,snapshot['guestBinding'])).fetchone()
    repair=c.execute("SELECT * FROM model_app_compile_repairs WHERE build=? AND intent=? AND state='COMPLETE'",(BUILD,INTENT)).fetchone()
    prior=c.execute('SELECT * FROM model_app_controlled_reopens WHERE build=? AND instance_nonce=?',(BUILD,nonce)).fetchone()
   if not row or row['state']!='READY' or not repair:raise HTTPException(409,'EXACT_REPAIRED_READY_BUILD_REQUIRED')
   result=json.loads(row['result']);repair_result=json.loads(repair['result'])
   if result.get('artifactDigest')!=ARTIFACT or repair_result.get('artifactDigest')!=ARTIFACT or repair_result.get('newModelCalls')!=0:raise HTTPException(403,'REOPEN_DERIVED_ARTIFACT_MISMATCH')
   if prior:
    if prior['state']=='COMPLETE' and BUILD in lifecycle.apps:return json.loads(prior['result'])
    raise HTTPException(409,'REOPEN_ALREADY_ATTEMPTED_FOR_INSTANCE')
   if BUILD in lifecycle.apps:raise HTTPException(409,'REOPEN_APP_ALREADY_REGISTERED')
   positions=[i for i,m in enumerate(snapshot['messages']) if m['id']==row['source'] and m['role']=='user']
   if len(positions)!=1:raise HTTPException(403,'REOPEN_CANONICAL_USER_REQUIRED')
   prefix=snapshot['messages'][:positions[0]+1]
   if sha(prefix)!=row['conversation_hash'] or repair['source_hash']!=row['conversation_hash']:raise HTTPException(403,'REOPEN_CANONICAL_PREFIX_MISMATCH')
   frozen={**snapshot,'messages':prefix,'conversationHash':row['conversation_hash'],'userMessageId':row['source']};context.initial=frozen;build_context=BuildContext(context,frozen)
   with db() as c:c.execute('INSERT INTO model_app_controlled_reopens VALUES(?,?,?,?,?,?,?,NULL,NULL)',(BUILD,nonce,INTENT,VERSION,'STARTED',row['conversation_hash'],time.time()))
   try:
    outcome=await reopen_existing(lifecycle,svc,authority,builds,BUILD,build_context)
    current=build_context.revalidate()
    if current['intentId']!=INTENT or current['guestBinding']!=snapshot['guestBinding'] or current['messages'][:len(prefix)]!=prefix:raise ValueError('REOPEN_AUTHORITY_CHANGED')
    summary={**outcome,'reopenStatus':'COMPLETE','buildId':BUILD,'intentId':INTENT,'approvedReopenVersion':VERSION,'newModelCalls':0,'newWorkerDispatches':0,'newCompiles':0,'newRepairAttempts':0}
    with db() as c:c.execute("UPDATE model_app_controlled_reopens SET state='COMPLETE',result=? WHERE build=? AND instance_nonce=? AND state='STARTED'",(json.dumps(summary),BUILD,nonce))
    return summary
   except BaseException as error:
    if BUILD in lifecycle.apps:
     item=lifecycle.apps.pop(BUILD);await lifecycle.stop_instance(item)
    with db() as c:c.execute("UPDATE model_app_controlled_reopens SET state='FAILED',error=? WHERE build=? AND instance_nonce=? AND state='STARTED'",(type(error).__name__,BUILD,nonce))
    raise HTTPException(503,'CONTROLLED_REOPEN_FAILED') from None
 return {'route':'/internal/v1/model-app-control/{build}/reopen','intentId':INTENT,'buildId':BUILD,'approvedReopenVersion':VERSION,'privateInstanceGuard':True,'newModelCalls':0,'newCompiles':0}
