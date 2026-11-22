"""Allowlisted SVG avatar selection in the existing canonical bot avatar field."""
import sqlite3,types,asyncio,json,time
from starli_memory.avatar_tokens import canonical_avatar_key
from contextlib import closing
AVATARS=('atlas','agata','nova','kiro','mira','ledger','pixel')


def company_avatar_snapshot(db,profiles,actor,company):
  """The canonical per-company avatar snapshot. Do not emit unauthorized bots."""
  from starli_memory.agent_profiles import ProfileError
  authority=profiles._authority(db)
  member=authority.require_member(actor,company)
  if member.get("kind")!="person":raise ProfileError(403,"AGENT_ACCESS_DENIED")
  rows=db.execute(
   "SELECT b.id,b.avatar,b.revision FROM bots AS b "
   "JOIN members AS m ON m.company_id=b.owner AND m.user_id=b.id AND m.kind='bot' AND m.active=1 "
   "WHERE b.owner=? AND b.kind='company' AND b.active=1 ORDER BY b.id LIMIT 201",
   (company,)
  ).fetchall()
  if len(rows)>200:raise ProfileError(503,"AVATAR_STREAM_LIMIT")
  result=[]
  for bot,avatar,revision in rows:
    try:key=canonical_avatar_key(avatar) if avatar else ""
    except ValueError:key=""
    result.append(dict(botId=bot,avatarKey=key,revision=int(revision)))
  authority.require_member(actor,company,expected_revision=member["membership_revision"])
  return dict(version="starli.company-avatar-snapshot.v1",companyId=company,items=result)

def install(app,runtime):
 from fastapi import APIRouter,Depends,HTTPException,Request
 from fastapi.responses import JSONResponse,StreamingResponse
 from pydantic import BaseModel,Field,field_validator
 from open_webui.utils.auth import get_verified_user
 from open_webui.routers.starli_session_fence import capture_request_fence
 from open_webui.routers.starli_v3_native import _mutation_guard
 from open_webui.company_authority.company_rbac import Forbidden
 from starli_memory.agent_profiles import ProfileError
 profiles=runtime.agent_profiles
 if getattr(profiles,'_preset_avatars_installed',False):raise RuntimeError('AVATAR_ALREADY_INSTALLED')
 original=profiles._read
 def read(self,db,actor,company,bot):
  result=original(db,actor,company,bot)
  row=db.execute("SELECT avatar FROM bots WHERE id=? AND owner=? AND kind='company' AND active=1",(bot,company)).fetchone()
  marker=row[0] if row else None
  try: validated=canonical_avatar_key(marker)
  except ValueError: validated=None
  key=validated[7:] if validated and validated.startswith('preset:') else validated
  return dict(result,avatarKey=key,avatar=validated,avatarKeys=list(AVATARS))
 profiles._read=types.MethodType(read,profiles);profiles._preset_avatars_installed=True
 router=APIRouter(prefix='/api/v1/companies')
 class Form(BaseModel):
  expectedRevision:int=Field(ge=1)
  avatarKey:str=Field(min_length=2,max_length=175)
  model_config={'extra':'forbid','strict':True}
  @field_validator('avatarKey')
  @classmethod
  def check_key(cls,key):
   canonical_avatar_key(key)
   return key
 @router.put('/{company}/bots/{bot}/profile/avatar')
 def avatar(company:str,bot:str,form:Form,request:Request,user=Depends(get_verified_user)):
  _mutation_guard(request);fence=capture_request_fence(request,user);fence.check()
  try:
   with closing(sqlite3.connect(profiles.path,isolation_level=None)) as db:
    db.execute('BEGIN IMMEDIATE')
    try:
     current=profiles._read(db,user.id,company,bot)
     if not current['canManage']:raise ProfileError(403,'AGENT_MANAGEMENT_DENIED')
     if current['revision']!=form.expectedRevision:raise ProfileError(409,'AGENT_REVISION_CONFLICT')
     changed=db.execute("UPDATE bots SET avatar=?,revision=revision+1 WHERE id=? AND owner=? AND kind='company' AND active=1 AND revision=?",(canonical_avatar_key(form.avatarKey),bot,company,form.expectedRevision)).rowcount
     if changed!=1:raise ProfileError(409,'AGENT_REVISION_CONFLICT')
     result=profiles._read(db,user.id,company,bot)
     profiles._authority(db).log(company,user.id,'bot.avatar.update',bot)
     fence.check();db.execute('COMMIT')
    except BaseException:db.execute('ROLLBACK');raise
  except ProfileError as error:raise HTTPException(error.status,error.code)from None
  except Forbidden:raise HTTPException(403,'AGENT_ACCESS_DENIED')from None
  fence.check();return JSONResponse(result,headers={'Cache-Control':'no-store'})

 active_avatar_streams={}
 def read_snapshot(actor,company):
  with closing(sqlite3.connect(profiles.path,timeout=3)) as db:
   db.execute('BEGIN')
   try:
    return company_avatar_snapshot(db,profiles,actor,company)
   finally:
    db.rollback()

 @router.get('/{company}/avatars/snapshot')
 def get_avatars(company:str,request:Request,user=Depends(get_verified_user)):
  fence=capture_request_fence(request,user)
  fence.check()
  try:result=read_snapshot(user.id,company)
  except ProfileError as error:raise HTTPException(error.status,error.code)from None
  except Forbidden:raise HTTPException(403,'AGENT_ACCESS_DENIED')from None
  fence.check()
  return JSONResponse(result,headers={'Cache-Control':'no-store'})

 @router.get('/{company}/avatars/events')
 async def avatar_events(company:str,request:Request,user=Depends(get_verified_user)):
  fence=capture_request_fence(request,user)
  fence.check()
  try:first=read_snapshot(user.id,company)
  except ProfileError as error:raise HTTPException(error.status,error.code)from None
  except Forbidden:raise HTTPException(403,'AGENT_ACCESS_DENIED')from None
  if active_avatar_streams.get(user.id,0)>=3:
   raise HTTPException(429,'AVATAR_STREAM_CAP')
  active_avatar_streams[user.id]=active_avatar_streams.get(user.id,0)+1
  async def stream():
   previous=None
   last_ping=time.monotonic()
   deadline=time.monotonic()+90
   try:
    while time.monotonic()<deadline:
     if await request.is_disconnected():break
     fence.check()
     try:
      data=read_snapshot(user.id,company)
     except (ProfileError,Forbidden):
      break
     serialized=json.dumps(data,separators=(',',':'),allow_nan=False)
     if serialized!=previous:
      previous=serialized
      yield 'event: avatar.snapshot\ndata: '+serialized+'\n\n'
      last_ping=time.monotonic()
     elif time.monotonic()-last_ping>18:
      yield ': heartbeat\n\n'
      last_ping=time.monotonic()
     await asyncio.sleep(1.35)
   except (asyncio.CancelledError,Exception):
    return
   finally:
    active_avatar_streams[user.id]=max(0,active_avatar_streams.get(user.id,1)-1)
    if not active_avatar_streams[user.id]:active_avatar_streams.pop(user.id,None)
  return StreamingResponse(stream(),media_type='text/event-stream',
      headers={'Cache-Control':'no-store','X-Accel-Buffering':'no','Connection':'keep-alive'})

 index=next((i for i,route in enumerate(app.router.routes) if getattr(route,'path',None)==''),len(app.router.routes));app.router.routes[index:index]=router.routes
 return profiles
