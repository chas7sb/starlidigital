"""Additive native company messaging. Keeps the existing Store/runtime/rooms."""
import asyncio
import hashlib
import re
import time
from contextvars import ContextVar
from company_messaging.authority import Member,Denied,require
from company_messaging.store import ident,encode


class EnterpriseMessagingMixin:
    def _schema(self):
        schema=self.authority.schema
        require(isinstance(schema,str) and re.fullmatch(r'[a-z][a-z_]{0,40}',schema),503,'AUTHORITY_MAPPING_REQUIRED')
        return schema

    def _person(self,db,company,user,kind='person'):
        row=db.execute('SELECT user_id,name,kind FROM '+self._schema()+'.members WHERE company_id=? AND user_id=? AND active=1 AND kind=?',(company,ident(user),kind)).fetchone()
        require(row is not None,404,'COMPANY_MEMBER_NOT_FOUND')
        return row

    def send(self,session,company,room,key,content,parent=None,mentions=None,dispatch=None,attachments=None):
        # Customer/API-token ingress retains its existing room/bot policy.
        if session.kind!='jwt':return super().send(session,company,room,key,content,parent,mentions,dispatch,attachments)
        allowed={(m.get('kind'),m.get('id')) for m in (mentions or []) if isinstance(m,dict) and isinstance(m.get('kind'),str) and isinstance(m.get('id'),str)} if isinstance(mentions,(list,type(None))) else set()
        token=self._mention_context.set((company,room,session.user_id,allowed))
        try:return super().send(session,company,room,key,content,parent,mentions,dispatch,attachments)
        finally:self._mention_context.reset(token)

    def human(self,db,room,company,user):
        ctx=self._mention_context.get()
        if ctx and ctx[:2]==(company,room) and ('human',user) in ctx[3]:
            # A mention is a reference, not private membership or history access.
            self._person(db,company,user)
            target=self.authority.require_member(user,company)
            require(isinstance(target,Member) and target.company_id==company and target.user_id==user)
            return target
        return super().human(db,room,company,user)

    def _join_agent(self,db,member,room,bot):
        row=self.room(db,member,room);require(row['kind']!='work_session',403,'USE_SESSION_COMMANDS')
        self._person(db,member.company_id,bot,'bot')
        self.authority.require_agent(member,ident(bot))
        exists=db.execute('SELECT 1 FROM cm_agents WHERE room=? AND agent=?',(room,bot)).fetchone()
        if not exists:
            db.execute('INSERT INTO cm_agents VALUES(?,?)',(room,bot))
            db.execute('UPDATE cm_rooms SET revision=revision+1 WHERE id=?',(room,))
            self.event(db,room,'room.membership')
        return not bool(exists)

    def agent(self,db,member,room,bot):
        ctx=self._mention_context.get()
        if ctx and ctx[:3]==(member.company_id,room,member.user_id) and ('agent',bot) in ctx[3]:
            self._join_agent(db,member,room,bot)
        return super().agent(db,member,room,bot)

    def add_agent(self,session,company,room,bot):
        require(session.kind=='jwt',401,'NATIVE_JWT_REQUIRED')
        with self.access(session,company,room) as (db,member,_):
            joined=self._join_agent(db,member,room,bot)
            return dict(companyId=company,roomId=room,agentId=bot,joined=joined,room=self.room_dto(db,member,self.room(db,member,room)))

    def remove_agent(self,session,company,room,bot):
        require(session.kind=='jwt',401,'NATIVE_JWT_REQUIRED')
        with self.access(session,company,room) as (db,member,row):
            require(row['kind']!='work_session',403,'USE_SESSION_COMMANDS')
            self._person(db,company,bot,'bot');self.authority.require_agent(member,ident(bot))
            removed=db.execute('DELETE FROM cm_agents WHERE room=? AND agent=?',(room,bot)).rowcount>0
            if removed:
                db.execute('UPDATE cm_rooms SET revision=revision+1 WHERE id=?',(room,))
                self.event(db,room,'room.membership')
            return dict(companyId=company,roomId=room,agentId=bot,removed=removed,room=self.room_dto(db,member,self.room(db,member,room)))

    def human_dm(self,session,company,target,key):
        require(session.kind=='jwt',401,'NATIVE_JWT_REQUIRED')
        with self.access(session,company) as (db,member,_):
            self._person(db,company,target)
            other=self.authority.require_member(ident(target),company)
            require(isinstance(other,Member) and other.company_id==company and other.user_id==target and target!=member.user_id,422,'DM_REQUIRES_OTHER_HUMAN')
            pair=sorted([(member.user_id,member.binding),(other.user_id,other.binding)])
            dm_key=hashlib.sha256(encode([company,pair,[]]).encode()).hexdigest()
            existing=db.execute("SELECT id FROM cm_rooms WHERE company=? AND dm_key=? AND kind='dm' AND visibility='private'",(company,dm_key)).fetchone()
            changed=False
            if existing:
                # Reopen this exact current-incarnation human pair, never old history.
                for person in (member,other):
                    old=db.execute('SELECT binding,active FROM cm_members WHERE room=? AND user=?',(existing['id'],person.user_id)).fetchone()
                    if not old or old['binding']!=person.binding or not old['active']:
                        db.execute('INSERT INTO cm_members VALUES(?,?,?,1) ON CONFLICT(room,user) DO UPDATE SET binding=excluded.binding,active=1',(existing['id'],person.user_id,person.binding));changed=True
            result=self.create_in_transaction(db,member,company,key,'dm','private','Direct conversation',[target],[])
            room=result['id']
            for person in (member,other):
                old=db.execute('SELECT binding,active FROM cm_members WHERE room=? AND user=?',(room,person.user_id)).fetchone()
                if not old or old['binding']!=person.binding or not old['active']:
                    db.execute('INSERT INTO cm_members VALUES(?,?,?,1) ON CONFLICT(room,user) DO UPDATE SET binding=excluded.binding,active=1',(room,person.user_id,person.binding));changed=True
            db.execute('UPDATE cm_invites SET accepted=1 WHERE room=? AND user=? AND binding=?',(room,target,other.binding))
            if changed:
                db.execute('UPDATE cm_rooms SET revision=revision+1 WHERE id=?',(room,));self.event(db,room,'room.membership')
            return self.room_dto(db,member,self.room(db,member,room))

    def heartbeat(self,session,company):
        require(session.kind=='jwt',401,'NATIVE_JWT_REQUIRED')
        now=self.clock()
        with self.access(session,company) as (db,member,_):
            expires=min(now+45,session.expires_at)
            db.execute('DELETE FROM enterprise_presence WHERE expires<=?',(now,))
            db.execute('INSERT INTO enterprise_presence VALUES(?,?,?,?,?,?) ON CONFLICT(company,user,binding,session) DO UPDATE SET seen=excluded.seen,expires=excluded.expires',(company,member.user_id,member.binding,session.token_hash,now,expires))
            key=(company,member.user_id,member.binding,session.token_hash)
        self._presence_sessions[key]=(session,expires)
        for old,(proof,until) in list(self._presence_sessions.items()):
            if until<=now or proof.expires_at<=time.time():self._presence_sessions.pop(old,None)
        return dict(companyId=company,userId=member.user_id,state='connected',source='heartbeat',ttlSeconds=45,expiresAt=int(expires*1000))

    def _human_presence(self,db,member):
        now=self.clock();valid=[]
        for row in db.execute('SELECT session,seen,expires FROM enterprise_presence WHERE company=? AND user=? AND binding=? AND expires>?',(member.company_id,member.user_id,member.binding,now)):
            lease=self._presence_sessions.get((member.company_id,member.user_id,member.binding,row['session']))
            if lease is None:continue
            proof,until=lease
            if until<=now or proof.expires_at<=time.time():continue
            try:
                if self.authority.authenticate(proof) is True:valid.append(row)
            except Exception:pass
        return dict(state='connected' if valid else 'offline',source='heartbeat',expiresAt=int(max(r['expires'] for r in valid)*1000) if valid else None)

    def people_presence(self,session,company):
        require(session.kind=='jwt',401,'NATIVE_JWT_REQUIRED')
        with self.access(session,company) as (db,member,_):
            rows=db.execute('SELECT user_id,name FROM '+self._schema()+".members WHERE company_id=? AND active=1 AND kind='person' ORDER BY user_id LIMIT 1001",(company,)).fetchall()
            require(len(rows)<=1000,503,'ROSTER_PAGINATION_REQUIRED');people=[]
            for row in rows:
                try:
                    current=self.authority.require_member(row['user_id'],company)
                    people.append(dict(id=row['user_id'],name=row['name'],kind='human',canKick=False,presence=self._human_presence(db,current)))
                except Denied:continue
            return dict(companyId=company,humans=people,ttlSeconds=45)

    def participants(self,session,company,room,runtime):
        require(session.kind=='jwt',401,'NATIVE_JWT_REQUIRED')
        with self.access(session,company,room) as (db,member,row):
            require(row['kind']!='work_session',403,'USE_SESSION_ROSTER')
            people=db.execute('SELECT user_id,name FROM '+self._schema()+".members WHERE company_id=? AND active=1 AND kind='person' ORDER BY user_id LIMIT 1001",(company,)).fetchall()
            require(len(people)<=1000,503,'ROSTER_PAGINATION_REQUIRED');humans=[]
            for person in people:
                try:
                    current=self.human(db,room,company,person['user_id'])
                    can_kick=row['visibility']=='private' and row['creator']==member.user_id and row['creator_binding']==member.binding and person['user_id']!=row['creator']
                    humans.append(dict(id=person['user_id'],name=person['name'],kind='human',canKick=can_kick,presence=self._human_presence(db,current)))
                except Denied:continue
            bots=[]
            for joined in db.execute('SELECT agent FROM cm_agents WHERE room=? ORDER BY agent',(room,)):
                bot=joined['agent']
                try:
                    self.authority.require_agent(member,bot);identity=self._person(db,company,bot,'bot')
                    active=[]
                    for run,scope in list(getattr(runtime,'scopes',{}).items()):
                        ctx=scope[1];task=getattr(runtime,'tasks',{}).get(run)
                        if (ctx.company_id,ctx.room_id,ctx.bot_id)==(company,room,bot) and ctx.room_revision==row['revision'] and task and not task.done():
                            native=db.execute('SELECT state FROM cr_turns WHERE id=? AND company=? AND room=? AND bot=?',(run,company,room,bot)).fetchone()
                            if native and native['state'] in ('QUEUED','RUNNING'):active.append(run)
                    try:allowed=self.authority.can_dispatch_agent(member,bot) is True
                    except Denied:allowed=False
                    bots.append(dict(id=bot,name=identity['name'],kind='agent',canKick=True,canDispatch=allowed,presence=dict(state='working' if active else 'idle',source='native-runtime',activeRunCount=len(active))))
                except Denied:continue
            return dict(companyId=company,roomId=room,roomRevision=row['revision'],membershipPolicy='company' if row['visibility']=='public' else 'participants',humans=humans,bots=bots)


def install_enterprise_messaging(app):
    from fastapi import APIRouter,Depends,Request
    from company_messaging.http import BoundedRoute,PREFIX
    from starlette.concurrency import run_in_threadpool
    from starlette.routing import Mount
    store=app.state.company_messaging;session=app.state.company_messaging_session
    require(not getattr(store,'_enterprise_installed',False),503,'ENTERPRISE_MESSAGING_ALREADY_INSTALLED')
    store.__class__=type('EnterpriseNativeStore',(EnterpriseMessagingMixin,type(store)),{})
    store._mention_context=ContextVar('enterprise_mentions_'+str(id(store)),default=None)
    store._presence_sessions={}
    with store.db() as db:
        db.execute('CREATE TABLE IF NOT EXISTS enterprise_presence(company TEXT,user TEXT,binding TEXT,session TEXT,seen REAL,expires REAL,PRIMARY KEY(company,user,binding,session))')
    store._enterprise_installed=True
    router=APIRouter(prefix=PREFIX,route_class=BoundedRoute)
    @router.post('/direct-messages/{human}')
    def direct(company:str,human:str,request:Request,principal=Depends(session)):
        return store.human_dm(principal,company,human,request.headers.get('idempotency-key'))
    @router.put('/rooms/{room}/agents/{bot}')
    def join(company:str,room:str,bot:str,principal=Depends(session)):
        return store.add_agent(principal,company,room,bot)
    @router.delete('/rooms/{room}/agents/{bot}')
    async def kick(company:str,room:str,bot:str,principal=Depends(session)):
        result=await run_in_threadpool(store.remove_agent,principal,company,room,bot)
        runtime=getattr(app.state,'company_bot_runtime',None);cancelled=[];tasks=[]
        for run,scope in list(getattr(runtime,'scopes',{}).items()):
            ctx=scope[1];task=getattr(runtime,'tasks',{}).get(run)
            if (ctx.company_id,ctx.room_id,ctx.bot_id)==(company,room,bot) and task and not task.done():
                cancelled.append(run);tasks.append(task);task.cancel()
        if tasks:await asyncio.gather(*tasks,return_exceptions=True)
        return {**result,'cancelledRunIds':cancelled}
    @router.get('/rooms/{room}/participants')
    def roster(company:str,room:str,principal=Depends(session)):
        return store.participants(principal,company,room,getattr(app.state,'company_bot_runtime',None))
    @router.post('/presence')
    def heartbeat(company:str,principal=Depends(session)):
        return store.heartbeat(principal,company)
    @router.get('/presence')
    def presence(company:str,principal=Depends(session)):
        return store.people_presence(principal,company)
    start=len(app.router.routes);app.include_router(router);added=app.router.routes[start:];del app.router.routes[start:]
    index=next((i for i,r in enumerate(app.router.routes) if isinstance(r,Mount) and r.path==''),len(app.router.routes))
    app.router.routes[index:index]=added
    return store
