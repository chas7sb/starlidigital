"""Exact-argument, single-use human confirmations for native platform writes."""
import asyncio,hashlib,json,sqlite3,time,uuid
from pathlib import Path
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from open_webui.utils.auth import get_verified_user
from open_webui.routers.starli_platform import principal
router=APIRouter()
from open_webui.routers.starli_state import state_dir
HOME=state_dir()
APPROVABLE=frozenset('crm_upsert_prospect crm_add_activity company_enrich company_signal_record pipeline_move client_workspace_create outreach_create_draft agent_create agent_update agent_configure agent_add_knowledge agent_create_demo agent_create_proposal agent_disable agent_publish agent_assign_owner project_manage project_build project_deploy website_generate proposal_manage templates_manage video_project_create video_project_apply_spec video_project_patch_spec video_render_start video_voiceover_create video_asset_upload video_asset_import brand_profile_create outreach_send_email unsubscribe inbox_sync operation_manage task_agent_cancel'.split())
def db():
 HOME.mkdir(parents=True,exist_ok=True)
 c=sqlite3.connect(str(HOME/'approvals.sqlite'),timeout=5)
 c.execute('CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,owner TEXT,payload TEXT,status TEXT,created REAL,result TEXT)')
 return c
class Prepare(BaseModel):
 tool:str=Field(min_length=1,max_length=100)
 args:dict=Field(default_factory=dict)
 class Config:extra='forbid'
class Confirm(BaseModel):
 digest:str=Field(min_length=64,max_length=64)
 class Config:extra='forbid'
def read(row):
 payload=json.loads(row[2])
 return {'id':row[0],'tool':payload['tool'],'args':payload['args'],'digest':hashlib.sha256(row[2].encode()).hexdigest(),'status':row[3],'createdAt':row[4],'result':json.loads(row[5]) if row[5] else None}
@router.post('')
def prepare(body:Prepare,user=Depends(get_verified_user)):
 uid,_=principal(user)
 if body.tool not in APPROVABLE:raise HTTPException(403,'This tool is not enabled for preview actions')
 payload=json.dumps(body.model_dump(),sort_keys=True,separators=(',',':'))
 if len(payload)>100000:raise HTTPException(413,'Action is too large')
 ident='approval-'+uuid.uuid4().hex
 with db() as c:c.execute('INSERT INTO approvals VALUES(?,?,?,?,?,NULL)',(ident,uid,payload,'PENDING',time.time()))
 return {'id':ident,'digest':hashlib.sha256(payload.encode()).hexdigest(),'status':'PENDING','reviewUrl':'/starli/approvals'}
@router.get('')
def listing(user=Depends(get_verified_user)):
 uid,_=principal(user)
 with db() as c:rows=c.execute('SELECT * FROM approvals WHERE owner=? ORDER BY created DESC LIMIT 100',(uid,)).fetchall()
 return {'items':[read(r) for r in rows]}
@router.post('/{ident}/reject')
def reject(ident:str,user=Depends(get_verified_user)):
 uid,_=principal(user)
 with db() as c:c.execute("UPDATE approvals SET status='REJECTED' WHERE id=? AND owner=? AND status='PENDING'",(ident,uid))
 return {'status':'REJECTED'}
@router.post('/{ident}/confirm')
async def confirm(ident:str,body:Confirm,user=Depends(get_verified_user)):
 uid,_=principal(user)
 with db() as c:
  c.execute('BEGIN IMMEDIATE')
  row=c.execute('SELECT * FROM approvals WHERE id=? AND owner=?',(ident,uid)).fetchone()
  if not row:raise HTTPException(404,'Approval not found')
  item=read(row)
  if body.digest!=item['digest']:raise HTTPException(409,'Approval arguments changed')
  if item['status']!='PENDING':return item
  if time.time()-item['createdAt']>900:raise HTTPException(409,'Approval expired; prepare a new action')
  c.execute("UPDATE approvals SET status='EXECUTING' WHERE id=?",(ident,))
 try:
  from open_webui.routers.starli_tools import bridge
  result=await bridge(user,'invoke',item['tool'],item['args'],approved=True)
  status='REJECTED_BY_TOOL' if result.get('isError') else 'COMPLETED'
 except asyncio.CancelledError:
  result={'error':'Execution was interrupted. Inspect platform receipts before any new request.'}
  with db() as c:c.execute('UPDATE approvals SET status=?,result=? WHERE id=?',('UNCERTAIN',json.dumps(result),ident))
  raise
 except Exception:
  result={'error':'Execution outcome uncertain. Inspect platform receipts before any new request.'};status='UNCERTAIN'
 with db() as c:c.execute('UPDATE approvals SET status=?,result=? WHERE id=?',(status,json.dumps(result),ident))
 return {**item,'status':status,'result':result}
