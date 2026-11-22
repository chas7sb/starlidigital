"""Durable verified-event admission into the existing native agent loop."""
import asyncio,hashlib,hmac,json,re,time,uuid
from types import SimpleNamespace
from company_messaging.authority import require
from company_messaging.context import capture
from company_messaging.store import encode
from .principal import StandingSession,register,authentic,forget

class AgentWake:
 def __init__(self,runtime,permission,key,clock=time.time):
  require(type(key)is bytes and len(key)==32,503,'WAKE_RECEIPT_KEY_REQUIRED')
  self.runtime=runtime;self.store=runtime.store;self.permission=permission;self.key=key;self.clock=clock
  with self.store.db() as db:db.executescript('''
   CREATE TABLE IF NOT EXISTS aw_grants(id TEXT PRIMARY KEY,company TEXT,room TEXT,bot TEXT,actor TEXT,binding TEXT,context TEXT,prompt TEXT,version INTEGER,source TEXT,expires REAL,state TEXT);
   CREATE TABLE IF NOT EXISTS aw_events(grant_id TEXT,event_id TEXT,hash TEXT,receipt TEXT,state TEXT,turn TEXT UNIQUE,error TEXT,PRIMARY KEY(grant_id,event_id));
  ''')
 def _fence(self,db,g,company=None):
  require(g is not None and g['state']=='ACTIVE' and g['expires']>self.clock(),403,'WAKE_GRANT_REVOKED')
  require(company is None or g['company']==company,403,'WAKE_COMPANY_CHANGED')
  member=self.store.authority.require_member(g['actor'],g['company']);require(member.binding==g['binding'],403,'WAKE_ACTOR_CHANGED')
  row=self.store.room(db,member,g['room']);self.store.agent(db,member,g['room'],g['bot'])
  ctx=SimpleNamespace(company=g['company'],actor=g['actor'],bot=g['bot'],native_scope=None)
  for cap in ('integrations.run','bots.run','tools.dispatch','messages.send'):self.permission(ctx,db,cap)
  saved=json.loads(g['context']);audience=[]
  if row['visibility']=='private':
   for target in db.execute('SELECT user,binding FROM cm_members WHERE room=? AND active=1 ORDER BY user',(g['room'],)):
    current=self.store.authority.require_member(target['user'],g['company'])
    require(current.binding==target['binding'],403,'WAKE_AUDIENCE_CHANGED');audience.append([current.user_id,current.binding])
  require(saved==[row['revision'],row['visibility'],audience],403,'WAKE_AUDIENCE_CHANGED')
  return member
 def validate_session(self,session,grant,company=None):
  try:
   try:db=self.store.authority.connection()
   except Exception:db=None
   if db is not None:
    g=db.execute('SELECT * FROM aw_grants WHERE id=?',(grant,)).fetchone();self._fence(db,g,company)
   else:
    with self.store.db(readonly=True) as db:
     g=db.execute('SELECT * FROM aw_grants WHERE id=?',(grant,)).fetchone();self._fence(db,g,company)
   return g['actor']==session.user_id and session.expires_at==g['expires']
  except Exception:return False
 def activate(self,session,company,room,bot,prompt,version,*,source_id,expires_at):
  require(session.kind=='jwt',403,'HUMAN_STANDING_ACTIVATION_REQUIRED')
  require(type(prompt)is str and 0<len(prompt.encode())<=12000 and type(version)is int and version>0,422,'WAKE_RULES_INVALID')
  require(type(source_id)is str and re.fullmatch('[A-Za-z0-9._:-]{1,180}',source_id) and self.clock()<expires_at<=self.clock()+366*86400,422,'WAKE_SOURCE_INVALID')
  context=capture(self.store,session,company,room,bot)
  with self.store.access(session,company,room) as (db,member,row):
   require(row['kind']!='work_session',403,'WAKE_ROOM_DENIED')
   human=SimpleNamespace(company=company,actor=member.user_id,bot=None,native_scope=None)
   self.permission(human,db,'integrations.install')
   ident=str(uuid.uuid4());g=dict(id=ident,company=company,room=room,bot=bot,actor=member.user_id,binding=member.binding,context=encode([context.room_revision,context.visibility,context.audience]),prompt=prompt,version=version,source=source_id,expires=expires_at,state='ACTIVE')
   self._fence(db,g);db.execute('INSERT INTO aw_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',tuple(g.values()))
   return ident
 def revoke(self,session,grant):
  with self.store.db() as db:
   g=db.execute('SELECT * FROM aw_grants WHERE id=?',(grant,)).fetchone();require(g is not None,404,'WAKE_GRANT_NOT_FOUND')
  with self.store.access(session,g['company'],g['room']) as(db,member,_):
   require(session.kind=='jwt',403,'HUMAN_REQUIRED');self.permission(SimpleNamespace(company=g['company'],actor=member.user_id,bot=None,native_scope=None),db,'integrations.install')
   db.execute("UPDATE aw_grants SET state='REVOKED' WHERE id=?",(grant,))
 def status(self,session,grant):
  with self.store.db(readonly=True) as db:g=db.execute('SELECT * FROM aw_grants WHERE id=?',(grant,)).fetchone();require(g is not None,404,'WAKE_GRANT_NOT_FOUND')
  with self.store.access(session,g['company'],g['room']) as(db,member,_):
   self.permission(SimpleNamespace(company=g['company'],actor=member.user_id,bot=None,native_scope=None),db,'integrations.install')
   events=[dict(row) for row in db.execute('SELECT event_id,state,turn,error FROM aw_events WHERE grant_id=? ORDER BY rowid DESC LIMIT 100',(grant,))]
   return dict(grantId=grant,companyId=g['company'],conversationId=g['room'],botId=g['bot'],sourceId=g['source'],version=g['version'],state=g['state'],events=events)
 async def stop(self,session,grant):
  self.revoke(session,grant)
  with self.store.db(readonly=True) as db:turns=[r[0] for r in db.execute('SELECT turn FROM aw_events WHERE grant_id=? AND turn IS NOT NULL',(grant,))]
  tasks=[self.runtime.tasks[t] for t in turns if t in self.runtime.tasks]
  for task in tasks:
   if not task.cancelling():task.cancel()
  if tasks:await asyncio.wait(tasks,timeout=5)
  result=self.status(session,grant);result['confirmedStopped']=not any(not t.done() for t in tasks)
  return result
 def wake(self,grant,event_id,receipt):
  require(type(receipt)is dict and set(receipt)=={'claims','signature'} and type(receipt['claims'])is dict,422,'WAKE_RECEIPT_INVALID')
  c=receipt['claims'];require(set(c)=={'version','grantId','eventId','sourceId','workflowVersion','issuedAt','expiresAt'},422,'WAKE_RECEIPT_INVALID')
  require(c['version']=='starli.agent-wake-receipt.v1' and c['grantId']==grant and c['eventId']==event_id and type(event_id)is str and re.fullmatch('[A-Za-z0-9._:-]{1,180}',event_id),403,'WAKE_RECEIPT_BINDING')
  require(type(c['issuedAt'])in(int,float) and type(c['expiresAt'])in(int,float) and self.clock()-30<=c['issuedAt']<=self.clock()+5 and c['issuedAt']<c['expiresAt']<=c['issuedAt']+60 and self.clock()<c['expiresAt'],403,'WAKE_RECEIPT_EXPIRED')
  raw=encode(c).encode();sig=receipt['signature'];require(type(sig)is str and hmac.compare_digest(hmac.new(self.key,raw,hashlib.sha256).hexdigest(),sig),403,'WAKE_RECEIPT_SIGNATURE')
  with self.store.db() as db:
   g=db.execute('SELECT * FROM aw_grants WHERE id=?',(grant,)).fetchone();self._fence(db,g)
   require(c['sourceId']==g['source'] and c['workflowVersion']==g['version'],403,'WAKE_VERSION_CHANGED')
   fingerprint=hashlib.sha256(encode([grant,event_id,c['sourceId'],c['workflowVersion']]).encode()).hexdigest()
   old=db.execute('SELECT * FROM aw_events WHERE grant_id=? AND event_id=?',(grant,event_id)).fetchone()
   if old:require(old['hash']==fingerprint,409,'WAKE_EVENT_CONFLICT');return dict(state=old['state'],runId=old['turn'],reused=True)
   db.execute("INSERT INTO aw_events VALUES(?,?,?,?,'QUEUED',NULL,NULL)",(grant,event_id,fingerprint,encode(receipt)))
   return dict(state='QUEUED',runId=None,reused=False)
 async def drain_once(self):
  require(getattr(self.runtime,'accepting',False),503,'NATIVE_RUNTIME_NOT_STARTED')
  with self.store.db(readonly=True) as db:pending=db.execute("SELECT grant_id,event_id FROM aw_events WHERE state='QUEUED' ORDER BY rowid LIMIT 16").fetchall()
  admitted=[]
  for e in pending:
   try:
    result=await self._admit(e['grant_id'],e['event_id'])
    if result:admitted.append(result)
   except Exception as error:
    if str(error)=='ROOM_TURN_ACTIVE':continue
    with self.store.db() as db:db.execute("UPDATE aw_events SET state='DENIED',error='WAKE_ADMISSION_DENIED' WHERE grant_id=? AND event_id=? AND state='QUEUED'",tuple(e))
  return admitted
 async def _admit(self,grant,event):
  with self.store.db(readonly=True) as db:g=db.execute('SELECT * FROM aw_grants WHERE id=?',(grant,)).fetchone();self._fence(db,g)
  session=StandingSession(g['actor'],'standing:'+grant,g['expires'],'automation-grant',None)
  object.__setattr__(session,'revalidate',lambda:authentic(session));register(session,self,grant)
  try:
   ctx=capture(self.store,session,g['company'],g['room'],g['bot']);selection=self.runtime.providers.capture(g['actor'],g['company'],g['bot']);self.runtime.fence(session,ctx,selection)
   with self.store.access(session,g['company'],g['room']) as(db,member,row):
    self._fence(db,g);self.runtime.local_fence(db,ctx)
    e=db.execute('SELECT * FROM aw_events WHERE grant_id=? AND event_id=?',(grant,event)).fetchone()
    if e['state']!='QUEUED':forget(session);return None
    require(db.execute("SELECT 1 FROM cr_turns WHERE room=? AND state IN ('QUEUED','RUNNING')",(g['room'],)).fetchone()is None,409,'ROOM_TURN_ACTIVE')
    turn=str(uuid.uuid4());assistant=self.runtime._append(db,g['room'],member,'agent',g['bot'],'',turn,False)
    key='wake:'+hashlib.sha256(encode([grant,event]).encode()).hexdigest();fp=hashlib.sha256(encode([g['prompt'],grant,event]).encode()).hexdigest()
    db.execute('INSERT INTO cr_turns VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)',(turn,g['company'],g['room'],g['bot'],g['actor'],g['binding'],key,fp,assistant,'wake-event:'+turn,'QUEUED',selection['provider'],selection['model'],selection['configurationRevision']))
    db.execute("INSERT INTO cr_events(turn,type,state) VALUES(?,'turn.state','QUEUED')",(turn,));db.execute("UPDATE aw_events SET state='ADMITTED',turn=? WHERE grant_id=? AND event_id=?",(turn,grant,event))
    history=[{'role':'user' if r['kind']=='human' else 'assistant','content':r['content']} for r in db.execute("SELECT m.kind,n.content,n.meta FROM cm_messages m JOIN message n ON n.id=m.id WHERE m.room=? AND m.deleted=0 AND m.id<>? ORDER BY m.seq DESC LIMIT 24",(g['room'],assistant)).fetchall()[::-1] if r['kind']=='human' or r['kind']=='agent' and json.loads(r['meta']or'{}').get('done',True)]
   self.runtime.scopes[turn]=(session,ctx,selection)
   async def run():
    try:await self.runtime._run(session,ctx,selection,turn,g['prompt'],history)
    finally:
     self.runtime.tasks.pop(turn,None);self.runtime.scopes.pop(turn,None);forget(session)
     with self.store.db() as db:
      state=db.execute('SELECT state FROM cr_turns WHERE id=?',(turn,)).fetchone()[0];db.execute('UPDATE aw_events SET state=? WHERE turn=?',(state,turn))
   task=asyncio.create_task(run(),name='native-background-wake');self.runtime.tasks[turn]=task
   def settled(task):
    self.runtime.tasks.pop(turn,None);self.runtime.scopes.pop(turn,None);forget(session)
    with self.store.db() as db:
     row=db.execute('SELECT state FROM cr_turns WHERE id=?',(turn,)).fetchone()
     if task.cancelled() and row[0] in ('QUEUED','RUNNING'):
      self.runtime._set_state(db,turn,'CANCELLED','TURN_CANCELLED');row=('CANCELLED',)
     db.execute('UPDATE aw_events SET state=? WHERE turn=?',(row[0],turn))
   task.add_done_callback(settled)
   return dict(runId=turn,assistantMessageId=assistant,userMessageId=None,companyId=g['company'],conversationId=g['room'],botId=g['bot'],status='QUEUED')
  except BaseException:forget(session);raise
 def recover(self):
  with self.store.db() as db:
   # Every committed admission is uncertain after restart. Never recreate or replay its model/tool run.
   db.execute("UPDATE aw_events SET state='INTERRUPTED',error='PROCESS_RESTARTED_NO_REPLAY' WHERE state='ADMITTED'")
