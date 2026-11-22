"""Company admin settings over canonical messaging rooms, never global channels."""
from fastapi import APIRouter,Depends,Request
from pydantic import Field
from .http import BoundedRoute,Strict
from .authority import require,Denied
from .store import ident,text,unique
class Draft(Strict):
 name:str
 description:str=''
 visibility:str
 memberIds:list[str]=Field(default_factory=list)
 agentIds:list[str]=Field(default_factory=list)
class Update(Draft):
 expectedRevision:int
class Archive(Strict):
 expectedRevision:int

def install(app,store,native_session):
 router=APIRouter(prefix='/api/v1/companies/{company}/channels',route_class=BoundedRoute)
 def admin(db,m):
  row=db.execute('SELECT role,kind FROM '+store.authority.schema+'.members WHERE company_id=? AND user_id=? AND active=1',(m.company_id,m.user_id)).fetchone()
  require(row is not None and row['kind']=='person' and row['role'] in ('owner','admin'),403,'CHANNEL_MANAGEMENT_DENIED')
 def row(db,company,room):
  r=db.execute("SELECT * FROM cm_rooms WHERE company=? AND id=? AND kind='channel' AND NOT EXISTS(SELECT 1 FROM cm_channel_archives a WHERE a.room=cm_rooms.id)",(company,ident(room))).fetchone()
  require(r is not None,404,'ROOM_NOT_FOUND');return r
 def dto(db,m,r):
  c=db.execute('SELECT name,description FROM channel WHERE id=?',(r['id'],)).fetchone();require(c is not None,503,'CANONICAL_CHANNEL_MISSING')
  members=[]
  for x in db.execute('SELECT user,binding FROM cm_members WHERE room=? AND active=1 ORDER BY user',(r['id'],)):
   try:t=store.authority.require_member(x['user'],r['company'])
   except Denied:continue
   if t.binding==x['binding']:members.append(t.user_id)
  try:store.room(db,m,r['id']);can=True
  except Denied:can=False
  return dict(version='starli.company-channel-settings.v1',id=r['id'],companyId=r['company'],name=c['name'],description=c['description'] or '',visibility=r['visibility'],revision=r['revision'],createdBy=r['creator'],membershipPolicy='company' if r['visibility']=='public' else 'participants',memberIds=members if r['visibility']=='private' else [],agentIds=[x[0]for x in db.execute('SELECT agent FROM cm_agents WHERE room=? ORDER BY agent',(r['id'],))],canOpen=can,cancelledRunIds=[])
 def validate(db,m,f):
  text(f.name,100);require(f.name.strip()==f.name and isinstance(f.description,str) and len(f.description)<=2000,422,'INVALID_CHANNEL_DETAILS')
  require(f.visibility in ('public','private'),422,'INVALID_VISIBILITY')
  humans=unique(f.memberIds);agents=unique(f.agentIds,16)
  require(not humans if f.visibility=='public' else bool(humans),422,'INVALID_MEMBERS')
  targets=[store.authority.require_member(u,m.company_id)for u in humans]
  for agent in agents:store.authority.require_agent(m,agent)
  return targets,agents
 def idle(db,room):
  if db.execute("SELECT 1 FROM sqlite_master WHERE name='cr_turns'").fetchone():require(db.execute("SELECT 1 FROM cr_turns WHERE room=? AND state IN ('QUEUED','RUNNING')",(room,)).fetchone() is None,409,'CHANNEL_HAS_ACTIVE_RUN')
 @router.get('')
 def listing(company:str,after:str='',limit:int=100,session=Depends(native_session)):
  require(1<=limit<=100,422,'INVALID_LIMIT')
  with store.access(session,company,readonly=True)as(db,m,_):
   admin(db,m);rows=db.execute("SELECT * FROM cm_rooms WHERE company=? AND kind='channel' AND id>? AND NOT EXISTS(SELECT 1 FROM cm_channel_archives a WHERE a.room=cm_rooms.id) ORDER BY id LIMIT ?",(company,after,limit+1)).fetchall();page=rows[:limit]
   return dict(version='starli.company-channels.v1',companyId=company,canManage=True,channels=[dto(db,m,r)for r in page],hasMore=len(rows)>limit,next=page[-1]['id'] if page else after)
 @router.get('/{room}')
 def reading(company:str,room:str,session=Depends(native_session)):
  with store.access(session,company,readonly=True)as(db,m,_):admin(db,m);return dto(db,m,row(db,company,room))
 @router.post('',status_code=201)
 def create(company:str,f:Draft,request:Request,session=Depends(native_session)):
  with store.access(session,company)as(db,m,_):
   admin(db,m);targets,agents=validate(db,m,f)
   require(f.visibility=='public' or any(t.user_id==m.user_id for t in targets),422,'CREATOR_MEMBERSHIP_REQUIRED')
   args,digest,previous=store.replay_key(db,m,'',request.headers.get('idempotency-key'),['channel-settings-v1',f.model_dump()])
   if previous:return dto(db,m,row(db,company,previous['id']))
   import uuid
   # Existing transactional creator has its own key; never collide with settings receipt.
   created=store.create_in_transaction(db,m,company,str(uuid.uuid4()),'channel',f.visibility,f.name,[],agents);room=created['id']
   db.execute('UPDATE channel SET description=? WHERE id=?',(f.description,room))
   if f.visibility=='private':
    db.execute('UPDATE cm_members SET active=0 WHERE room=?',(room,))
    for t in targets:db.execute('INSERT OR REPLACE INTO cm_members VALUES(?,?,?,1)',(room,t.user_id,t.binding))
   store.save_key(db,args,digest,{'id':room});return dto(db,m,row(db,company,room))
 @router.put('/{room}')
 def update(company:str,room:str,f:Update,session=Depends(native_session)):
  with store.access(session,company)as(db,m,_):
   admin(db,m);r=row(db,company,room);require(r['revision']==f.expectedRevision,409,'CHANNEL_REVISION_CHANGED');idle(db,room);targets,agents=validate(db,m,f)
   require(db.execute('SELECT 1 FROM cm_channel_archives WHERE room=?',(room,)).fetchone() is None,409,'CHANNEL_ARCHIVED')
   db.execute('UPDATE channel SET name=?,description=? WHERE id=?',(f.name,f.description,room));db.execute('UPDATE cm_rooms SET visibility=?,revision=revision+1 WHERE id=?',(f.visibility,room))
   db.execute('DELETE FROM cm_invites WHERE room=?',(room,));db.execute('UPDATE cm_members SET active=0 WHERE room=?',(room,))
   for t in targets:db.execute('INSERT OR REPLACE INTO cm_members VALUES(?,?,?,1)',(room,t.user_id,t.binding))
   db.execute('DELETE FROM cm_agents WHERE room=?',(room,))
   for agent in agents:db.execute('INSERT INTO cm_agents VALUES(?,?)',(room,agent))
   store.event(db,room,'room.settings.changed');return dto(db,m,row(db,company,room))
 @router.post('/{room}/archive')
 def archive(company:str,room:str,f:Archive,session=Depends(native_session)):
  with store.access(session,company)as(db,m,_):
   admin(db,m);r=row(db,company,room);require(r['revision']==f.expectedRevision,409,'CHANNEL_REVISION_CHANGED');idle(db,room)
   db.execute('INSERT OR IGNORE INTO cm_channel_archives VALUES(?)',(room,));db.execute('UPDATE cm_rooms SET revision=revision+1 WHERE id=?',(room,));store.event(db,room,'room.archived')
   return dict(companyId=company,id=room,archived=True,revision=f.expectedRevision+1)
 app.include_router(router)
