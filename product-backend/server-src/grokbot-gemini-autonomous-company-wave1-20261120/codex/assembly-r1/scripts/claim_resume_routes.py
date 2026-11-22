# Read-only exact native claim execution projection. Never dispatches work.
import contextlib,json,sqlite3
from pathlib import Path
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
def install_claim_resume_routes(app,svc):
 from grokbot1_routes import _token
 from grokbot1_claim import ClaimError,connect
 router=APIRouter()
 @router.get('/api/v1/starli/grokbot1/claims/{intent_id}/execution')
 async def execution(intent_id:str,request:Request):
  token=_token(request);session,uid=svc.native_session(token)
  try:nav=svc.owner_navigation(token,intent_id)
  except ClaimError as error:
   if error.status==404:raise ClaimError(403,'CLAIM_EXECUTION_ACCESS_DENIED') from error
   raise
  if nav.get('stage')!='ROOM_READY' or nav.get('verifiedBy')!='native-store-readback':raise ClaimError(409,'NATIVE_CLAIM_NOT_READY')
  with contextlib.closing(connect(svc.p.intake)) as db:
   journal=db.execute("SELECT * FROM grokbot1_claim_journal WHERE intent_id=? AND owner_user_id=? AND state='COMMITTED'",(intent_id,uid)).fetchone()
  if journal is None:raise ClaimError(404,'CLAIM_UNAVAILABLE')
  authority=svc.ns.RbacAuthority(str(svc.p.authority))
  try:
   scope=authority.require_member(uid,journal['company_id'],permission='bots.run')
   if scope['kind']!='person' or scope['role']!='owner':raise ClaimError(403,'CURRENT_NATIVE_OWNER_REQUIRED')
  finally:authority.db.close()
  if session.revalidate() is not True:raise ClaimError(401,'NATIVE_SESSION_REVOKED')
  database=Path(svc.p.root)/'native-worker-admission.sqlite'
  if not database.exists():raise ClaimError(404,'CLAIM_EXECUTION_NOT_FOUND')
  with sqlite3.connect('file:'+str(database)+'?mode=ro',uri=True) as db:
   rows=db.execute("SELECT id,admission,result FROM builds WHERE json_extract(admission,'$.intentId')=? AND json_extract(admission,'$.claimId')=? AND result IS NOT NULL",(intent_id,journal['txn'])).fetchall()
  graph_id=request.query_params.get('graphId')
  if graph_id:rows=[row for row in rows if json.loads(row[2]).get('graphId')==graph_id]
  if not rows:raise ClaimError(404,'CLAIM_EXECUTION_NOT_FOUND')
  if len(rows)!=1:raise ClaimError(409,'EXACT_CLAIM_EXECUTION_REQUIRED')
  job_id,raw,receipt=rows[0];admission=json.loads(raw);result=json.loads(receipt);original=json.loads(journal['receipts'])
  expected={'companyId':nav['companyId'],'projectId':nav['projectId'],'parentRoomId':nav['channelRoomId'],'originalPromptMessageId':original['originalPromptMessageId']}
  if admission['actor']['userId']!=uid or any(admission.get(k)!=v for k,v in expected.items()) or admission['authorizationRevision']!=scope['membership_revision']:raise ClaimError(403,'CLAIM_EXECUTION_AUTHORITY_CHANGED')
  for key in ('intentId','companyId','projectId','requestId','sourceMessageId','originalPromptMessageId'):
   if result.get(key)!=admission.get(key):raise ClaimError(503,'PERSISTED_EXECUTION_BINDING_MISMATCH')
  if result.get('roomId')!=admission['parentRoomId'] or result['sourceMessageId']==result['originalPromptMessageId']:raise ClaimError(503,'EXECUTION_SOURCE_BINDING_MISMATCH')
  messages=svc.store.messages(session,nav['companyId'],nav['channelRoomId']);messages=messages.get('messages',messages) if isinstance(messages,dict) else messages
  command=next((m for m in messages if m['id']==admission['sourceMessageId']),None)
  if not command or command['speaker']!={'kind':'human','id':uid}:raise ClaimError(503,'NATIVE_HUMAN_COMMAND_REQUIRED')
  state=app.state.native_build_queue.state(job_id)
  if session.revalidate() is not True:raise ClaimError(401,'NATIVE_SESSION_REVOKED')
  return JSONResponse({**result,'nativeQueue':state,'resumedFrom':'EXACT_PERSISTED_CLAIM_EXECUTION','generation':admission['generation'],'authorizationRevision':admission['authorizationRevision']},headers={'Cache-Control':'no-store'})
 app.include_router(router)
