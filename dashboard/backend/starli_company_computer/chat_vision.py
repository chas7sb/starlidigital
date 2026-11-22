"""Current-source native Drive images to private Pi IPC; no remote image URLs."""
import starli_portable as _portable
import asyncio,base64,contextvars,io,json,types
from pathlib import Path

LIMITS=dict(maxImages=4,maxBytesPerImage=8388608,maxTotalBytes=16777216,mimeTypes=['image/png','image/jpeg','image/webp'])
_turn=contextvars.ContextVar('native_image_turn',default=None)

def image_content(data,mime):
 from PIL import Image
 from company_messaging.authority import require
 require(mime in LIMITS['mimeTypes'] and 0<len(data)<=LIMITS['maxBytesPerImage'],422,'IMAGE_ATTACHMENT_UNSUPPORTED')
 try:
  with Image.open(io.BytesIO(data)) as image:
   require(image.width*image.height<=25000000 and image.format in ('PNG','JPEG','WEBP') and Image.MIME.get(image.format)==mime,422,'IMAGE_ATTACHMENT_INVALID')
   image.verify()
 except Exception as error:
  if getattr(error,'code',None):raise
  require(False,422,'IMAGE_ATTACHMENT_INVALID')
 return dict(type='image',data=base64.b64encode(data).decode(),mimeType=mime)

class Vision:
 def __init__(self,app,runtime):self.app=app;self.runtime=runtime
 def load(self,session,ctx,selection,turn,supports):
  from company_messaging.authority import require
  rt=self.runtime
  require(rt.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,turn),403,'NATIVE_RUN_DENIED')
  with rt.store.access(session,ctx.company_id,ctx.room_id,readonly=True)as(db,_,_):
   row=db.execute('SELECT user_message FROM cr_turns WHERE id=? AND company=? AND room=? AND bot=?',(turn,ctx.company_id,ctx.room_id,ctx.bot_id)).fetchone()
   require(row is not None,403,'VISION_SOURCE_DENIED')
   # Scheduled native wakes have no human message to fetch. Accept ONLY a
   # server-issued standing grant linked to this exact admitted run, and never
   # load attachments from a synthetic source. Normal chat/delegation image
   # restrictions below remain unchanged.
   if row['user_message']=='wake-event:'+turn:
    import time
    from starli_agent_wake.principal import is_verified_principal
    require(is_verified_principal(session,rt.store.authority,ctx.company_id),403,'VISION_SOURCE_DENIED')
    grant=getattr(session,'token_hash','')
    require(isinstance(grant,str) and grant.startswith('standing:') and len(grant)>len('standing:'),403,'VISION_SOURCE_DENIED')
    proof=db.execute('''SELECT g.company,g.room,g.bot,g.actor,g.binding,g.state,g.expires
      FROM aw_events e JOIN aw_grants g ON g.id=e.grant_id
      WHERE e.turn=? AND e.grant_id=? AND e.state='ADMITTED' ''',(turn,grant[len('standing:'):])).fetchone()
    require(proof is not None and
      (proof['company'],proof['room'],proof['bot'],proof['actor'],proof['binding'])==
      (ctx.company_id,ctx.room_id,ctx.bot_id,ctx.actor_id,ctx.actor_binding) and
      proof['state']=='ACTIVE' and proof['expires']>time.time(),403,'VISION_SOURCE_DENIED')
    require(rt.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,turn),403,'NATIVE_RUN_DENIED')
    return dict(images=[])
   source=rt.store.message_dto(db,ctx.room_id,row['user_message'])
   has_delegations=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cr_delegations'").fetchone()is not None
   delegation=db.execute('SELECT parent FROM cr_delegations WHERE child=?',(turn,)).fetchone()if has_delegations else None
   if delegation is not None:
    parent=db.execute('SELECT company,bot,actor,binding,state FROM cr_turns WHERE id=?',(delegation['parent'],)).fetchone()
    require(parent is not None and (parent['company'],parent['actor'],parent['binding'],parent['state'])==(ctx.company_id,session.user_id,ctx.actor_binding,'RUNNING'),403,'VISION_SOURCE_DENIED')
    require(not source['deleted'] and source['speaker']==dict(kind='agent',id=parent['bot']) and source.get('runId')==delegation['parent'] and source.get('attribution')==dict(requestedBy=session.user_id) and not source['attachments'],403,'VISION_SOURCE_DENIED')
    attachments=[]
   else:
    require(not source['deleted'] and source['speaker']==dict(kind='human',id=session.user_id),403,'VISION_SOURCE_DENIED')
    attachments=source['attachments']
  if not attachments:
   require(rt.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,turn),403,'NATIVE_RUN_DENIED')
   return dict(images=[])
  images=[];total=0
  drive=self.app.state.company_tools_drive_factory()
  try:
   for item in attachments:
    aid=item.get('id')if isinstance(item,dict)else None
    require(isinstance(aid,str)and aid.startswith('drive.'),422,'VISION_ATTACHMENT_UNSUPPORTED')
    meta=drive.channel_metadata(session.user_id,ctx.company_id,aid,ctx.room_id)
    if not meta['mime'].startswith('image/'):continue
    require(supports is True,422,'MODEL_DOES_NOT_SUPPORT_IMAGES')
    require(meta['mime']in LIMITS['mimeTypes']and meta['size']<=LIMITS['maxBytesPerImage']and len(images)<LIMITS['maxImages'],422,'IMAGE_ATTACHMENT_LIMIT')
    data,mime=drive.channel_content(session.user_id,ctx.company_id,aid,ctx.room_id)
    total+=len(data);require(total<=LIMITS['maxTotalBytes'],422,'IMAGE_ATTACHMENT_LIMIT')
    images.append(image_content(data,mime))
  finally:drive.db.close()
  require(rt.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,turn),403,'NATIVE_RUN_DENIED')
  return dict(images=images)
 async def capability(self,session,company,room,bot):
  from company_messaging.context import capture
  ctx=capture(self.runtime.store,session,company,room,bot)
  selected=self.runtime.providers.capture(session.user_id,company,bot)
  self.runtime.fence(session,ctx,selected)
  row=dict(botId=bot,agentId=bot,model=selected['model'],input=[],supportsImages=False,reason='MODEL_CAPABILITY_UNAVAILABLE')
  runner=self.runtime.runner
  if hasattr(runner,'external')and hasattr(runner,'hosted'):runner=runner.hosted if selected['provider']=='hosted'else runner.external
  # Unwrap only our runner facade; retain the production worker environment.
  environment=getattr(runner,'child_environment',None)
  if not environment:return row
  process=await asyncio.create_subprocess_exec(runner.node,str(Path(__file__).with_name('vision-capability.mts')),env=_portable.child_environment(environment),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
  try:
   stdout,_=await asyncio.wait_for(process.communicate((json.dumps(selected)+'\n').encode()),12)
   if process.returncode==0 and len(stdout)<4096:
    result=json.loads(stdout);row.update(input=result['input'],supportsImages=result['supportsImages']);row.pop('reason')
    if not row['supportsImages']:row['reason']='MODEL_DOES_NOT_SUPPORT_IMAGES'
  except Exception:pass
  finally:
   if process.returncode is None:process.kill();await process.wait()
  self.runtime.fence(session,ctx,selected)
  return row

def install(app,runtime):
 from fastapi import APIRouter,Depends,HTTPException
 from company_messaging.authority import Denied,require
 # Bind Drive validation inside the existing message transaction. The historical
 # generic Drive installer has a three-argument callback; NativeAuthority passes
 # its actual transaction DB as a fourth argument, so install this exact adapter.
 from open_webui.company_drive.channel_attachments import validate as validate_attachment
 from open_webui.company_drive.resources import Denied as DriveDenied
 authority=runtime.store.authority
 drive=app.state.company_tools_drive_factory()
 try:
  drive_path=Path(next(row[2]for row in drive.db.execute('PRAGMA database_list')if row[1]=='main')).resolve()
 finally:drive.db.close()
 native_path=Path(runtime.store.path).resolve();schema=authority.schema;previous_attachment=authority._attachment
 def attachment(db,member,room,aid):
  if not isinstance(aid,str)or not aid.startswith('drive.'):return previous_attachment(db,member,room,aid)
  require(db is authority.connection(),403,'COMPANY_ATTACHMENT_TRANSACTION_REQUIRED')
  mapping={row[1]:Path(row[2]).resolve()for row in db.execute('PRAGMA database_list')if row[2]}
  require(mapping.get('main')==native_path and mapping.get(schema)==drive_path,403,'COMPANY_ATTACHMENT_DATABASE_MISMATCH')
  try:return validate_attachment(db,member,room,aid,company_schema=schema,native_schema='main')
  except DriveDenied:raise Denied(403,'COMPANY_ATTACHMENT_DENIED')from None
 authority._attachment=attachment
 service=Vision(app,runtime);original_run=runtime._run;runner=runtime.runner;original_runner=runner.run
 async def run(self,session,ctx,selection,turn,prompt,history):
  token=_turn.set((session,ctx,selection,turn))
  try:return await original_run(session,ctx,selection,turn,prompt,history)
  finally:_turn.reset(token)
 runtime._run=types.MethodType(run,runtime)
 async def run_worker(self,selection,prompt,history,rpc,event):
  binding=_turn.get()
  async def scoped_rpc(operation,value):
   if operation=='vision.load':
    require(binding is not None,403,'VISION_RUN_REQUIRED')
    return service.load(*binding,value.get('supportsImage')is True)
   return await rpc(operation,value)
  return await original_runner(selection,prompt,history,scoped_rpc,event)
 runner.run=types.MethodType(run_worker,runner)
 router=APIRouter();session_dependency=app.state.company_messaging_session
 async def result(company,room,ids,session):
  try:
   require(1<=len(ids)<=16 and len(set(ids))==len(ids),422,'VISION_BOTS_REQUIRED')
   items=[await service.capability(session,company,room,bot)for bot in ids]
  except Denied as error:raise HTTPException(error.status,error.code)from None
  except Exception:raise HTTPException(403,'VISION_ACCESS_DENIED')from None
  return dict(companyId=company,roomId=room,conversationId=room,items=items,limits=LIMITS)
 @router.get('/api/v1/starli/companies/{company}/chat-vision')
 async def capabilities(company:str,roomId:str,botIds:str,session=Depends(session_dependency)):
  return await result(company,roomId,botIds.split(','),session)
 @router.get('/api/v1/companies/{company}/messaging/rooms/{room}/vision-capabilities')
 async def alias(company:str,room:str,agentIds:str,session=Depends(session_dependency)):
  return await result(company,room,agentIds.split(','),session)
 index=next((i for i,route in enumerate(app.router.routes)if getattr(route,'path',None)==''),len(app.router.routes));app.router.routes[index:index]=router.routes
 app.state.company_chat_vision=service
 return service
