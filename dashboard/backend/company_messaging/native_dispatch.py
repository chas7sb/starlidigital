"""Per-bot parallel native admission with real sessions and durable receipts."""
import asyncio,hashlib,inspect,json,secrets,types
from company_messaging.context import capture,revalidate
from company_messaging.authority import require,Denied

class NativeDispatchQueue:
 def __init__(self,app,runtime):
  self.app=app;self.runtime=runtime;self.store=runtime.store;self.ingress=app.state.company_messaging_start_turn;self.sessions={};self.workers={};self.closing=False
  with self.store.db() as db:
   db.executescript('''CREATE TABLE IF NOT EXISTS cm_native_dispatch(id TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,actor TEXT NOT NULL,binding TEXT NOT NULL,bot TEXT NOT NULL,source TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,run TEXT,receipt TEXT,error TEXT,UNIQUE(company,room,actor,binding,key));''')
   db.execute("UPDATE cm_native_dispatch SET state='INTERRUPTED',error='RUNTIME_RESTARTED' WHERE state IN ('QUEUED','SUBMITTED')")
 def fingerprint(self,source):return hashlib.sha256(json.dumps([source['id'],source['revision'],source['content'],source['mentions']],sort_keys=True).encode()).hexdigest()
 def dto(self,row):
  receipt=json.loads(row['receipt'])if row['receipt']else None
  started=None if row['state']=='UNKNOWN'else bool(receipt and receipt.get('status')not in ('QUEUED',))
  value=dict(agentId=row['bot'],status=row['state'],started=started,dispatchId=row['id'])
  if receipt:value['receipt']=receipt
  if row['error']:value['errorCode']=row['error']
  return value
 async def enqueue(self,session,audience,source,key):
  require(not self.closing,503,'NATIVE_RUNTIME_NOT_STARTED');require(session.kind=='jwt',403,'NATIVE_JWT_REQUIRED');revalidate(self.store,session,audience)
  require(source['speaker']=={'kind':'human','id':session.user_id} and not source['deleted']and {'kind':'agent','id':audience.bot_id}in source['mentions'],403,'SOURCE_MESSAGE_DENIED')
  with self.store.access(session,audience.company_id,audience.room_id) as (db,member,_):
   require(member.binding==audience.actor_binding,403,'MEMBERSHIP_CHANGED')
   row=db.execute('SELECT * FROM cm_native_dispatch WHERE company=? AND room=? AND actor=? AND binding=? AND key=?',(audience.company_id,audience.room_id,member.user_id,member.binding,key)).fetchone()
   if row:require((row['source'],row['bot'],row['fingerprint'])==(source['id'],audience.bot_id,self.fingerprint(source)),409,'DISPATCH_KEY_CONFLICT')
   else:
    ident=secrets.token_hex(16)
    db.execute("INSERT INTO cm_native_dispatch VALUES(?,?,?,?,?,?,?,?,?, 'QUEUED',NULL,NULL,NULL)",(ident,audience.company_id,audience.room_id,member.user_id,member.binding,audience.bot_id,source['id'],key,self.fingerprint(source)))
    row=db.execute('SELECT * FROM cm_native_dispatch WHERE id=?',(ident,)).fetchone()
   ident=row['id'];dto=self.dto(row)
  if dto['status']=='QUEUED':
   self.sessions[ident]=(session,audience)
   worker=(audience.room_id,audience.bot_id)
   if worker not in self.workers or self.workers[worker].done():self.workers[worker]=asyncio.create_task(self.drain(*worker))
  return dict(dispatchId=ident,sourceMessageId=source['id'],agentId=audience.bot_id,dispatchStatus=dto['status'],started=dto['started'],**({'receipt':dto['receipt']}if dto.get('receipt')else{}))
 def update(self,ident,state,receipt=None,error=None):
  with self.store.db() as db:db.execute('UPDATE cm_native_dispatch SET state=?,run=COALESCE(?,run),receipt=COALESCE(?,receipt),error=? WHERE id=?',(state,receipt.get('runId')if receipt else None,json.dumps(receipt)if receipt else None,error,ident))
 async def drain(self,room,bot):
  try:
   while not self.closing:
    with self.store.db() as db:
     row=db.execute("SELECT * FROM cm_native_dispatch WHERE room=? AND bot=? AND state='QUEUED' ORDER BY rowid LIMIT 1",(room,bot)).fetchone()
     row=dict(row)if row else None
    if row is None:return
    ident=row['id'];saved=self.sessions.get(ident)
    if saved is None:self.update(ident,'INTERRUPTED',error='NATIVE_SESSION_UNAVAILABLE');continue
    session,original=saved
    try:
     while True:
      revalidate(self.store,session,original)
      with self.store.access(session,row['company'],room) as (db,member,_):
       require(member.binding==row['binding'],403,'MEMBERSHIP_CHANGED')
       current=db.execute('SELECT state FROM cm_native_dispatch WHERE id=?',(ident,)).fetchone()[0]
       if current!='QUEUED':break
       busy=db.execute("SELECT 1 FROM cr_turns WHERE room=? AND bot=? AND state IN ('QUEUED','RUNNING')",(room,bot)).fetchone()is not None
      if not busy:break
      await asyncio.sleep(.25)
     if current!='QUEUED':continue
     audience=capture(self.store,session,row['company'],room,row['bot'])
     revalidate(self.store,session,original)
     with self.store.access(session,row['company'],room) as (db,_,_):source=self.store.message_dto(db,room,row['source'])
     require(self.fingerprint(source)==row['fingerprint'],409,'SOURCE_MESSAGE_CHANGED')
     receipt=self.ingress(session,audience,source,row['key']);receipt=await receipt if inspect.isawaitable(receipt)else receipt
     require(type(receipt)is dict and type(receipt.get('runId'))is str,503,'NATIVE_ADMISSION_INVALID')
     self.update(ident,'SUBMITTED',receipt)
     while True:
      result=self.runtime.turn(session,row['company'],room,receipt['runId'])
      self.update(ident,'SUBMITTED'if result['status']in ('QUEUED','RUNNING')else result['status'],result)
      if result['status']not in ('QUEUED','RUNNING'):
       if result['status']in ('CANCELLED','CANCELED'):self.cancel_pending(row['company'],room,row['source'],row['actor'],row['binding'],row['bot'])
       break
      await asyncio.sleep(.25)
    except asyncio.CancelledError:raise
    except Exception as error:
     # Never retry an ambiguous admission. Durable core identity can prove that
     # a run exists, but missing/uncertain results are held for explicit review.
     code=getattr(error,'code',None)
     if type(code)is not str or not code.replace('_','').isalnum()or len(code)>96:code='NATIVE_DISPATCH_UNCONFIRMED'
     self.update(ident,'DENIED'if isinstance(error,Denied)and error.status<500 else'UNKNOWN',error=code)
    finally:self.sessions.pop(ident,None)
  finally:self.workers.pop((room,bot),None)
 def cancel_pending(self,company,room,source,actor,binding,bot):
  with self.store.db() as db:db.execute("UPDATE cm_native_dispatch SET state='CANCELLED',error='BATCH_STOPPED' WHERE company=? AND room=? AND source=? AND actor=? AND binding=? AND bot=? AND state='QUEUED'",(company,room,source,actor,binding,bot))
 def status(self,session,company,room,source):
  with self.store.access(session,company,room) as (db,member,_):
   message=self.store.message_dto(db,room,source);require(message['speaker']=={'kind':'human','id':member.user_id},403,'DISPATCH_SOURCE_OWNER_REQUIRED')
   rows=db.execute('SELECT * FROM cm_native_dispatch WHERE company=? AND room=? AND source=? AND actor=? AND binding=? ORDER BY rowid',(company,room,source,member.user_id,member.binding)).fetchall()
   items=[self.dto(row)for row in rows]
  return dict(companyId=company,conversationId=room,sourceMessageId=source,items=items,settled=all(item['status']not in ('QUEUED','SUBMITTED')for item in items))
 async def close(self):
  self.closing=True
  tasks=list(self.workers.values())
  for task in tasks:task.cancel()
  if tasks:await asyncio.gather(*tasks,return_exceptions=True)
  with self.store.db() as db:db.execute("UPDATE cm_native_dispatch SET state='INTERRUPTED',error='RUNTIME_SHUTDOWN' WHERE state IN ('QUEUED','SUBMITTED')")
  self.sessions.clear()

def install(app,runtime):
 from fastapi import APIRouter,Depends,HTTPException
 queue=NativeDispatchQueue(app,runtime);app.state.company_messaging_start_turn=queue.enqueue;app.state.company_native_dispatch=queue
 original_cancel=runtime.cancel;original_close=runtime.close
 async def cancel(self,session,company,room,turn):
  self.turn(session,company,room,turn)
  with self.store.access(session,company,room) as (db,member,_):row=db.execute('SELECT source,actor,binding,bot FROM cm_native_dispatch WHERE run=? AND company=? AND room=?',(turn,company,room)).fetchone()
  if row:queue.cancel_pending(company,room,row['source'],row['actor'],row['binding'],row['bot'])
  return await original_cancel(session,company,room,turn)
 async def close(self):await queue.close();return await original_close()
 runtime.cancel=types.MethodType(cancel,runtime);runtime.close=types.MethodType(close,runtime)
 # Queue admission stops before the existing native runtime shutdown callback.
 # This callback closes only our queue; it never closes the runtime twice.
 app.router.on_shutdown.insert(0,queue.close)
 router=APIRouter(prefix='/api/v1/starli/companies/{company}/messaging')
 @router.get('/rooms/{room}/dispatches/{source}')
 def status(company:str,room:str,source:str,session=Depends(app.state.company_messaging_session)):
  try:return queue.status(session,company,room,source)
  except Denied as error:raise HTTPException(error.status,error.code)from None
 index=next((i for i,route in enumerate(app.router.routes)if getattr(route,'path',None)==''),len(app.router.routes));app.router.routes[index:index]=router.routes
 return queue
