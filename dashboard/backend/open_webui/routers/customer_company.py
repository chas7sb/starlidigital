"""Customer facade over the mounted shared-bot runtime and its native event store.

No chat creation, provider runner, memory factory, or tool dispatcher exists here.
"""
import asyncio
import time
from fastapi import HTTPException
from open_webui.routers.customer_store import reject,CustomerError
from open_webui.routers.customer_session import issue

TERMINAL={'ANSWERED','FAILED','CANCELLED','INTERRUPTED'}
def shared(bot):return isinstance(bot,str) and bot.startswith('company:')
def parts(bot):
    value=bot.split(':')
    if len(value)!=3 or value[0]!='company' or not all(value[1:]):reject(404,'bot_not_found','Bot not found.')
    return value[1],value[2]

class CompanyAdapter:
    def __init__(self,store,runtime,active):self.store,self.runtime,self.active=store,runtime,active
    def session(self,owner,principal=None,scope=None,bot=None):
        def check():
            if principal is not None:self.store.check(principal,scope,bot)
            elif not self.active(owner):reject(401,'invalid_api_key','Account is unavailable.')
            return True
        expires=self.store.check(principal,scope,bot)['expires'] if principal is not None else time.time()+30
        return issue(owner,principal.token_id if principal else 'directory-only',expires,check)
    def catalogue(self,owner):
        runtime=self.runtime
        if runtime is None:return []
        session=self.session(owner);result={};scanned=0
        with runtime.store.db(readonly=True) as db:
            schema=runtime.store.authority.schema
            companies=[r[0]for r in db.execute('SELECT company_id FROM '+schema+'.members WHERE user_id=? AND active=1 AND kind=\'person\' LIMIT 1001',(owner,))]
            if len(companies)>1000:reject(503,'directory_capacity','Bot directory is too large for this API version.')
        for company in companies:
            try:
                with runtime.store.access(session,company,readonly=True) as (db,member,_):
                    # Directory access is independent of conversation presence.
                    # Missing links then get the explicit initialize-in-Starli409.
                    for row in db.execute('SELECT user_id AS agent,name FROM '+schema+'.members WHERE company_id=? AND active=1 AND kind=\'bot\' LIMIT 1001',(company,)):
                        scanned+=1
                        if scanned>1000:reject(503,'directory_capacity','Bot directory is too large for this API version.')
                        try:
                            runtime.store.authority.require_agent(member,row['agent'])
                            selector='company:'+company+':'+row['agent']
                            result[selector]={'id':selector,'nativeBotId':row['agent'],'companyId':company,'kind':'company','name':row['name']or'Shared bot','provider':'configured company provider'}
                        except Exception as error:
                            if getattr(error,'status',None) not in (401,403,404):raise
            except Exception as error:
                if getattr(error,'status',None) not in (401,403,404):raise
        return list(result.values())
    def _binding(self,p,selector,scope):
        self.store.check(p,scope,selector)
        if self.runtime is None:reject(503,'native_runtime_unavailable','Shared runtime is unavailable.')
        company,bot=parts(selector);session=self.session(p.owner_id,p,scope,selector)
        with self.runtime.store.access(session,company,readonly=True) as (db,member,_):
            candidates=[]
            for row in db.execute('SELECT r.* FROM cm_rooms r JOIN cm_agents a ON a.room=r.id WHERE r.company=? AND a.agent=? AND r.kind!=\'work_session\' LIMIT 1001',(company,bot)):
                try:self.runtime.store.room(db,member,row['id']);self.runtime.store.agent(db,member,row['id'],bot)
                except Exception as error:
                    if getattr(error,'status',None) in (403,404):continue
                    raise
                candidates.append(row)
                if len(candidates)>1:break
            if not candidates:reject(409,'conversation_not_initialized','Initialize the shared bot conversation in Starli first.')
            if len(candidates)!=1:reject(409,'canonical_binding_ambiguous','This shared bot has multiple visible rooms; a canonical mapping must be configured in Starli.')
            room=candidates[0]['id'];last=db.execute('SELECT id FROM cm_messages WHERE room=? ORDER BY seq DESC LIMIT 1',(room,)).fetchone()
            return session,company,bot,room,last[0]if last else None
    def resolve(self,p,selector):
        session,company,bot,room,parent=self._binding(p,selector,'messages:send')
        # Same fresh provider/member/run checks used by the normal native ingress.
        from company_messaging.context import capture
        ctx=capture(self.runtime.store,session,company,room,bot)
        selection=self.runtime.providers.capture(p.owner_id,company,bot)
        self.runtime.fence(session,ctx,selection)
        return {'agentId':selector,'conversationId':room,'currentId':parent}
    async def submit(self,request,p,op,content):
        # Re-authenticate actual secret before issuing long-lived native authority.
        fresh=self.store.authenticate(request.headers['authorization'][7:])
        if fresh!=p:reject(401,'invalid_api_key','Credential changed.')
        session,company,bot,room,_=self._binding(p,op['bot'],'messages:send')
        if room!=op['conversation']:reject(409,'binding_changed','Canonical room changed.')
        try:value=await self.runtime.start_customer(session,company,room,bot,op['id'],content,op['parent'])
        except Exception as error:
            # Native Denied before launch is transactionally rolled back. Other
            # failures remain uncertain and are only reconciled, never replayed.
            from company_messaging.authority import Denied
            if isinstance(error,Denied):error.no_effects=True
            raise
        return {**value,'source':self._text(p,op['bot'],value['runId'])}
    def reconcile(self,p,op):
        session,company,bot,room,_=self._binding(p,op['bot'],'runs:read')
        if room!=op['conversation']:reject(409,'binding_changed','Canonical room changed.')
        with self.runtime.store.access(session,company,room,readonly=True) as (db,member,_):
            row=db.execute('SELECT * FROM cr_turns WHERE company=? AND room=? AND bot=? AND actor=? AND binding=? AND key=?',(company,room,bot,p.owner_id,member.binding,op['id'])).fetchone()
            return self.runtime._dto(row) if row else None
    def _run(self,p,selector,run_id,scope):
        session,company,bot,room,_=self._binding(p,selector,scope)
        value=self.runtime.turn(session,company,room,run_id)
        if value['botId']!=bot:reject(404,'run_not_found','Run not found.')
        return session,company,bot,room,value
    def status(self,p,selector,run_id,scope='runs:read'):
        *_,value=self._run(p,selector,run_id,scope)
        return {'run':value,'terminal':value['status'] in TERMINAL}
    def result(self,p,selector,run_id,scope='messages:send'):
        session,company,bot,room,value=self._run(p,selector,run_id,scope)
        with self.runtime.store.access(session,company,room,readonly=True) as (db,_,__):
            message=self.runtime.store.message_dto(db,room,value['assistantMessageId'])
        return {'terminal':value['status']in TERMINAL,'text':message['content'],'error':value['status']in TERMINAL-{'ANSWERED'},'finishReason':'stop'}
    def final(self,p,selector,run_id):
        self.store.check(p,'conversations:read',selector)
        return {**self.status(p,selector,run_id),**self.result(p,selector,run_id,'runs:read')}
    def messages(self,p,selector,after,limit):
        session,company,bot,room,_=self._binding(p,selector,'conversations:read')
        cursor=0
        with self.runtime.store.access(session,company,room,readonly=True) as (db,_,__):
            if after:
                row=db.execute('SELECT seq FROM cm_messages WHERE room=? AND id=?',(room,after)).fetchone()
                if row is None:reject(409,'message_cursor_stale','Message cursor is not in this conversation.')
                cursor=row[0]
        page=self.runtime.store.messages(session,company,room,cursor,limit)
        return {'conversationId':room,'data':page['messages'],'hasMore':page['hasMore'],'nextCursor':page['messages'][-1]['id']if page['messages']else after}
    def events(self,p,selector,run_id,after):
        session,company,bot,room,value=self._run(p,selector,run_id,'runs:read')
        events=self.runtime.events(session,company,room,run_id,after)
        return {'run':value,'events':[{'cursor':e['cursor'],'event':e}for e in events],'nextCursor':events[-1]['cursor']if events else after,'hasMore':len(events)==200,'terminal':value['status']in TERMINAL}
    async def _text(self,p,selector,run_id):
        cursor=0
        while True:
            # Completion observation needs send scope; it cannot grant the separate
            # execution-event scope or expose native tool payloads.
            session,company,bot,room,value=self._run(p,selector,run_id,'messages:send')
            events=self.runtime.events(session,company,room,run_id,cursor)
            for event in events:
                cursor=event['cursor']
                if event['type']=='text.delta':yield event['text']
            if value['status']in TERMINAL and not events:return
            # Observation polling must leave the native SDK/task loop time to
            # advance; every read performs fresh account/member/token fences.
            await asyncio.sleep(.25)
    async def cancel(self,p,selector,run_id):
        session,company,bot,room,_=self._run(p,selector,run_id,'runs:cancel')
        return await self.runtime.cancel(session,company,room,run_id)

class JoinedAdapter:
    def __init__(self,store,personal,company):self.store,self.personal,self.company=store,personal,company
    def _for(self,bot):return self.company if shared(bot)else self.personal
    def _shared_run(self,p,run_id):
        with self.store.db()as db:
            row=db.execute('SELECT bot FROM customer_operations WHERE owner=? AND run_id=?',(p.owner_id,run_id)).fetchone()
        if row:return row['bot']if shared(row['bot'])else None
        runtime=self.company.runtime
        if runtime is not None:
            with runtime.store.db(readonly=True)as db:
                row=db.execute('SELECT company,bot FROM cr_turns WHERE id=?',(run_id,)).fetchone()
            if row:
                selector='company:'+row['company']+':'+row['bot']
                self.store.check(p,None,selector)
                # The chosen action still rechecks native room and its own scope.
                return selector
        return None
    def catalogue(self,owner):
        from open_webui.routers import starli_v3_native as native
        with native._db()as db:
            items=[dict(r)for r in db.execute('SELECT id,name,kind,provider FROM agents WHERE owner=? AND archived_at IS NULL',(owner,))]
        return items+self.company.catalogue(owner)
    def resolve(self,p,bot):return self._for(bot).resolve(p,bot)
    async def submit(self,request,p,op,content):return await self._for(op['bot']).submit(request,p,op,content)
    def reconcile(self,p,op):return self._for(op['bot']).reconcile(p,op)
    def detach(self,p,op):
        if not shared(op['bot']):self.personal.detach(p,op)
    def result(self,p,op):return self.company.result(p,op['bot'],op['run_id'])if shared(op['bot'])else self.personal.result(p,op)
    def messages(self,p,bot,after,limit):return self._for(bot).messages(p,bot,after,limit)
    def status(self,p,run_id):
        bot=self._shared_run(p,run_id)
        return self.company.status(p,bot,run_id)if bot else self.personal.status(p,run_id)
    def final(self,p,run_id):
        bot=self._shared_run(p,run_id)
        return self.company.final(p,bot,run_id)if bot else self.personal.final(p,run_id)
    def events(self,p,run_id,after):
        bot=self._shared_run(p,run_id)
        return self.company.events(p,bot,run_id,after)if bot else self.personal.events(p,run_id,after)
    def snapshot(self,p,run_id):
        bot=self._shared_run(p,run_id)
        return self.company.final(p,bot,run_id)if bot else self.personal.snapshot(p,run_id)
    async def cancel(self,p,run_id):
        bot=self._shared_run(p,run_id)
        return await self.company.cancel(p,bot,run_id)if bot else await self.personal.cancel(p,run_id)
