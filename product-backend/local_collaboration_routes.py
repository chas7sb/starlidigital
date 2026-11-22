"""Trusted native adapters for the bounded collaboration engine. No model-owned authority."""
import hashlib,json,time,uuid
from fastapi import APIRouter,Depends,Header,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from local_collaboration import CollaborationService,CollaborationError,Limits

def install(app,state,store,runtime):
 from company_messaging.authority import require
 from company_messaging.context import capture
 session_dependency=app.state.company_messaging_session
 with store.db() as db:db.execute('CREATE TABLE IF NOT EXISTS local_collaboration_sinks(operation TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,actor TEXT NOT NULL,bot TEXT NOT NULL,digest TEXT NOT NULL,message TEXT NOT NULL)')
 def session_for(scope):
  session=scope.get('authority_context')
  require(session is not None and session.user_id==scope['actor_id'] and callable(session.revalidate) and session.revalidate() is True,403,'NATIVE_SESSION_REQUIRED')
  return session
 def permissions(scope,ids,db,member,row):
  require(row['kind']!='work_session',403,'COLLABORATION_REQUIRES_CONVERSATION_ROOM')
  a=object.__new__(type(runtime.authority));a.db=db
  a.require_member(member.user_id,scope['company_id'],permission='read')
  for bot in ids:
   store.agent(db,member,scope['room_id'],bot)
   if scope['action']=='run':
    a.require_member(member.user_id,scope['company_id'],permission='bots.run');a.require_member(member.user_id,scope['company_id'],permission='messages.send')
    a.require_member(bot,scope['company_id'],permission='bots.run');a.require_member(bot,scope['company_id'],permission='messages.send')
    runtime.providers.capture(member.user_id,scope['company_id'],bot)
 async def authorize(scope,ids):
  try:
   session=session_for(scope)
   with store.access(session,scope['company_id'],scope['room_id'],readonly=True) as(db,member,row):permissions(scope,ids,db,member,row)
   return True
  except Exception:return False
 async def context(scope):
  session=session_for(scope);ids=[scope['boss_id'],*scope['teammate_ids']]
  with store.access(session,scope['company_id'],scope['room_id'],readonly=True) as(db,member,row):
   permissions(scope,ids,db,member,row)
   source=store.message_dto(db,scope['room_id'],scope['source_message_id'])
   require(source['speaker']=={'kind':'human','id':session.user_id} and not source['deleted'],403,'COLLABORATION_SOURCE_DENIED')
   roster=[];revisions={}
   for bot in ids:
    profile=runtime.agent_profiles.read(session.user_id,scope['company_id'],bot)
    selected=runtime.providers.capture(session.user_id,scope['company_id'],bot)
    roster.append({'id':bot,'name':profile['name']});revisions[bot]={'profile':profile['revision'],'selection':selected['selectionRevision']}
   messages=[];size=0
   rows=db.execute("SELECT n.content,m.kind FROM cm_messages m JOIN message n ON n.id=m.id WHERE m.room=? AND m.deleted=0 AND m.kind IN ('human','agent') ORDER BY m.seq DESC LIMIT 24",(scope['room_id'],)).fetchall()
   for r in rows:
    if not r['content'].strip():continue
    text=r['content'][-8000:];size+=len(text.encode())
    if size>24000:break
    messages.append({'role':'user' if r['kind']=='human' else 'assistant','content':text})
   return {'source':source,'roster':roster,'messages':list(reversed(messages)),'authorityRevision':{'actorBinding':member.binding,'roomRevision':row['revision'],'bots':revisions}}
 async def append(scope,bot,text,metadata,key):
  session=session_for(scope);ids=[scope['boss_id'],*scope['teammate_ids']]
  require(bot in ids and scope['action']=='run',403,'COLLABORATION_BOT_DENIED')
  digest=hashlib.sha256(json.dumps([scope['company_id'],scope['room_id'],session.user_id,bot,text,metadata],sort_keys=True).encode()).hexdigest()
  with store.access(session,scope['company_id'],scope['room_id']) as(db,member,row):
   permissions(scope,ids,db,member,row)
   source=store.message_dto(db,scope['room_id'],scope['source_message_id'])
   require(not source['deleted'] and source['speaker']=={'kind':'human','id':session.user_id},403,'COLLABORATION_SOURCE_DENIED')
   old=db.execute('SELECT digest,message FROM local_collaboration_sinks WHERE operation=?',(key,)).fetchone()
   if old:
    require(old['digest']==digest,409,'COLLABORATION_SINK_KEY_CONFLICT');return old['message']
   message=str(uuid.uuid4());now=time.time_ns();seq=row['seq']+1
   meta={'version':'starli.local-collaboration.native.v1','done':True,'attribution':{'requestedBy':session.user_id},'collaboration':metadata}
   mentions=[{'kind':'agent','id':metadata['targetAgentId']}]if metadata.get('targetAgentId')else[]
   db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,NULL,?,?,?,?,?)',(message,session.user_id,scope['room_id'],text,'{}',json.dumps(meta),now,now))
   # cm_messages.run is exclusively a canonical cr_turns ID. Collaboration
   # attribution stays in native metadata and the collaboration receipt API.
   db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,?)',(message,scope['room_id'],seq,'agent',bot,1,json.dumps(mentions),'[]',None))
   db.execute('UPDATE cm_rooms SET seq=? WHERE id=?',(seq,scope['room_id']));store.event(db,scope['room_id'],'message.created',message)
   db.execute('INSERT INTO local_collaboration_sinks VALUES(?,?,?,?,?,?,?)',(key,scope['company_id'],scope['room_id'],session.user_id,bot,digest,message))
   session_for(scope);return message
 async def model(scope,bot,messages,*,instructions,structured=False):
  require(scope is not None and bot in [scope['boss_id'],*scope['teammate_ids']],403,'COLLABORATION_MODEL_SCOPE_REQUIRED')
  session=session_for(scope);ctx=capture(store,session,scope['company_id'],scope['room_id'],bot)
  result=await runtime.complete_for_bot(session,scope['company_id'],bot,messages,instructions=instructions,context=ctx,run_id=scope['run_id'])
  return result['answer'],result['receipt']
 service=CollaborationService((state/'data/collaborations.sqlite').resolve(),authorize=authorize,read_context=context,append_message=append,model=model,limits=Limits(model_seconds=90,wall_seconds=360))
 app.state.local_collaboration=service;app.add_event_handler('shutdown',service.close)
 class Start(BaseModel):
  model_config=ConfigDict(extra='forbid',strict=True)
  bossId:str=Field(min_length=1,max_length=180)
  teammateIds:list[str]=Field(min_length=1,max_length=4)
  sourceMessageId:str=Field(min_length=1,max_length=180)
 router=APIRouter(prefix='/api/v1/starli/companies/{company}/messaging/rooms/{room}/collaborations')
 async def call(operation):
  try:return await operation
  except CollaborationError as e:raise HTTPException(e.status,e.code)from None
 @router.post('',status_code=202)
 async def start(company:str,room:str,body:Start,session=Depends(session_dependency),idempotency_key:str=Header(alias='Idempotency-Key')):
  return await call(service.start(actor_id=session.user_id,company_id=company,room_id=room,boss_id=body.bossId,teammate_ids=body.teammateIds,source_message_id=body.sourceMessageId,idempotency_key=idempotency_key,authority_context=session))
 @router.get('/{run}')
 async def status(company:str,room:str,run:str,session=Depends(session_dependency)):
  return await call(service.status(actor_id=session.user_id,company_id=company,room_id=room,run_id=run,authority_context=session))
 @router.post('/{run}/stop')
 async def stop(company:str,room:str,run:str,session=Depends(session_dependency)):
  return await call(service.stop(actor_id=session.user_id,company_id=company,room_id=room,run_id=run,authority_context=session))
 app.include_router(router);return service
