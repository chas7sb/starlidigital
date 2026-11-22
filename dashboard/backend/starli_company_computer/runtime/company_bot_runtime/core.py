"""Mounted company turns over canonical company_messaging, private SDK IPC."""
import asyncio,hashlib,json,time,uuid,re
from dataclasses import asdict
from contextvars import ContextVar
_CUSTOMER_PARENT=ContextVar("company_customer_parent",default=None)
from company_messaging.context import capture,revalidate
from company_messaging.authority import require,Denied
from company_messaging.store import encode
from starli_memory.audience import AudienceMemorySession,BotIdentity,Audience


class Runtime:
    def __init__(self,store,providers,bots,authority,memory_factory,runner):
        self.store=store;self.providers=providers;self.bots=bots;self.authority=authority
        self.memory_factory=memory_factory;self.runner=runner;self.tasks={};self.scopes={}
        with store.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS cr_turns(id TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,bot TEXT NOT NULL,
              actor TEXT NOT NULL,binding TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,message TEXT NOT NULL,
              user_message TEXT NOT NULL,state TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,configuration_revision INTEGER NOT NULL,
              error_code TEXT,UNIQUE(company,room,actor,binding,key));
            CREATE UNIQUE INDEX IF NOT EXISTS cr_active_room ON cr_turns(room) WHERE state IN ('QUEUED','RUNNING');
            CREATE UNIQUE INDEX IF NOT EXISTS cr_source_bot ON cr_turns(company,room,bot,user_message);
            CREATE TABLE IF NOT EXISTS cr_events(id INTEGER PRIMARY KEY AUTOINCREMENT,turn TEXT NOT NULL,type TEXT NOT NULL,start INTEGER,end INTEGER,state TEXT);
            ''')

    def fence(self,session,ctx,selection):
        revalidate(self.store,session,ctx)
        self.authority.require_member(session.user_id,ctx.company_id,permission='bots.run')
        self.authority.require_member(ctx.bot_id,ctx.company_id,permission='bots.run')
        self.providers.check(selection)
        return True

    def memory(self,session,ctx,selection,run_id='native-provisioning'):
        identity=BotIdentity('company',ctx.company_id,ctx.bot_id)
        def resolve(bot,conversation,action):
            require(bot==identity and conversation==ctx.room_id,403,'MEMORY_SCOPE_CHANGED')
            self.fence(session,ctx,selection)
            permitted={Audience('company',ctx.company_id)}
            if ctx.visibility=='private':
                policy=hashlib.sha256(encode([ctx.room_id,ctx.room_revision,ctx.audience]).encode()).hexdigest()
                permitted.add(Audience('restricted','room-'+policy))
            return frozenset(permitted)
        return AudienceMemorySession(self.memory_factory,identity,actor_id=session.user_id,run_id=run_id,conversation_id=ctx.room_id,resolve=resolve)

    def local_fence(self,db,ctx):
        authority=object.__new__(type(self.authority));authority.db=db
        authority.require_member(ctx.actor_id,ctx.company_id,permission='bots.run')
        authority.require_member(ctx.bot_id,ctx.company_id,permission='bots.run')
        row=db.execute('SELECT revision FROM cm_rooms WHERE id=? AND company=?',(ctx.room_id,ctx.company_id)).fetchone()
        require(row is not None and row[0]==ctx.room_revision,403,'ROOM_CONTEXT_CHANGED')

    def authorize_run(self,user,company,bot,room,run):
        scope=self.scopes.get(run)
        if scope is None:return False
        session,ctx,selection=scope
        actor=user.get('id')if isinstance(user,dict)else getattr(user,'id',getattr(user,'user_id',None))
        if (actor,company,bot,room)!=(session.user_id,ctx.company_id,ctx.bot_id,ctx.room_id):return False
        self.fence(session,ctx,selection)
        with self.store.access(session,company,room,readonly=True) as (db,_,_):
            self.local_fence(db,ctx)
            row=db.execute('SELECT state FROM cr_turns WHERE id=? AND company=? AND room=? AND bot=?',(run,company,room,bot)).fetchone()
            return row is not None and row[0]=='RUNNING'

    def _append(self,db,room,member,kind,speaker,content,run=None,done=True):
        message=str(uuid.uuid4());now=int(time.time()*1e9)
        seq=db.execute('SELECT seq FROM cm_rooms WHERE id=?',(room,)).fetchone()[0]+1
        meta={'version':'starli.company-bot-runtime.v1','done':done}
        if kind=='agent':meta['attribution']={'requestedBy':member.user_id}
        db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,NULL,?,?,?,?,?)',
                   (message,member.user_id,room,content,encode({}),encode(meta),now,now))
        db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,?)',(message,room,seq,kind,speaker,1,'[]','[]',run))
        db.execute('UPDATE cm_rooms SET seq=? WHERE id=?',(seq,room))
        self.store.event(db,room,'message.created',message)
        return message

    async def start_from_message(self,session,company,room,bot,key,source_message_id):
        with self.store.access(session,company,room) as (db,member,row):
            source=self.store.message_dto(db,room,source_message_id)
            require(source['speaker']=={'kind':'human','id':session.user_id}and not source['deleted'],403,'SOURCE_MESSAGE_DENIED')
            require({'kind':'agent','id':bot}in source['mentions'],403,'EXPLICIT_BOT_MENTION_REQUIRED')
        return await self.start(session,company,room,bot,key,source['content'],source_message_id=source_message_id)

    async def start(self,session,company,room,bot,key,prompt,*,source_message_id=None):
        require(isinstance(key,str) and 1<=len(key)<=128,422,'IDEMPOTENCY_KEY_REQUIRED')
        require(isinstance(prompt,str) and 0<len(prompt.encode())<=16000,422,'INVALID_PROMPT')
        ctx=capture(self.store,session,company,room,bot)
        selection=self.providers.capture(session.user_id,company,bot)
        self.fence(session,ctx,selection)
        fingerprint=hashlib.sha256(encode([bot,prompt,source_message_id]).encode()).hexdigest()
        with self.store.access(session,company,room) as (db,member,row):
            self.local_fence(db,ctx)
            require(row['kind']!='work_session',403,'SUPERVISED_SESSION_RUNTIME_REQUIRED')
            self.store.agent(db,member,room,bot)
            require(member.binding==ctx.actor_binding and row['revision']==ctx.room_revision,403,'ROOM_CONTEXT_CHANGED')
            old=db.execute('SELECT * FROM cr_turns WHERE company=? AND room=? AND actor=? AND binding=? AND key=?',(company,room,member.user_id,member.binding,key)).fetchone()
            if old:
                require(old['fingerprint']==fingerprint,409,'IDEMPOTENCY_CONFLICT')
                return self._dto(old)
            if source_message_id:
                prior=db.execute('SELECT * FROM cr_turns WHERE company=? AND room=? AND bot=? AND user_message=?',(company,room,bot,source_message_id)).fetchone()
                if prior:
                    require(prior['actor']==member.user_id and prior['binding']==member.binding and prior['fingerprint']==fingerprint,409,'SOURCE_TURN_CONFLICT')
                    return self._dto(prior)
            expected=_CUSTOMER_PARENT.get()
            if expected is not None:
                require(expected[:3]==(company,room,bot),403,'CUSTOMER_ROOM_BINDING_CHANGED')
                latest=db.execute('SELECT id FROM cm_messages WHERE room=? ORDER BY seq DESC LIMIT 1',(room,)).fetchone()
                require((latest[0]if latest else None)==expected[3],409,'TURN_CURRENT_ID_CONFLICT')
            require(db.execute("SELECT 1 FROM cr_turns WHERE room=? AND bot=? AND state IN ('QUEUED','RUNNING')",(room,bot)).fetchone()is None,409,'ROOM_TURN_ACTIVE')
            source=None
            if source_message_id:
                source=self.store.message_dto(db,room,source_message_id)
                require(source['speaker']=={'kind':'human','id':session.user_id}and source['content']==prompt and not source['deleted']and {'kind':'agent','id':bot}in source['mentions'],403,'SOURCE_MESSAGE_CHANGED')
            history=[]
            for item in db.execute('SELECT n.content,m.kind,n.meta FROM cm_messages m JOIN message n ON n.id=m.id WHERE m.room=? AND m.deleted=0 AND m.seq<? ORDER BY m.seq DESC LIMIT 24',(room,source['sequence']if source else 9223372036854775807)).fetchall()[::-1]:
                if item['kind']=='human':history.append({'role':'user','content':item['content']})
                elif item['kind']=='agent' and json.loads(item['meta']or'{}').get('done',True):history.append({'role':'assistant','content':item['content']})
            turn=str(uuid.uuid4())
            human=source_message_id or self._append(db,room,member,'human',member.user_id,prompt)
            assistant=self._append(db,room,member,'agent',bot,'',turn,False)
            db.execute('INSERT INTO cr_turns VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)',
                       (turn,company,room,bot,session.user_id,member.binding,key,fingerprint,assistant,human,'QUEUED',selection['provider'],selection['model'],selection['configurationRevision']))
            db.execute("INSERT INTO cr_events(turn,type,state) VALUES(?,'turn.state','QUEUED')",(turn,))
            result=self._dto(db.execute('SELECT * FROM cr_turns WHERE id=?',(turn,)).fetchone())
        self.scopes[turn]=(session,ctx,selection)
        task=asyncio.create_task(self._run(session,ctx,selection,turn,prompt,history))
        def settled(_):self.tasks.pop(turn,None);self.scopes.pop(turn,None)
        self.tasks[turn]=task;task.add_done_callback(settled)
        return result

    async def start_customer(self,session,company,room,bot,key,prompt,expected_current_id):
        from open_webui.routers.customer_session import authentic
        require(authentic(session),403,'CUSTOMER_PRINCIPAL_REQUIRED')
        token=_CUSTOMER_PARENT.set((company,room,bot,expected_current_id))
        try:return await self.start(session,company,room,bot,key,prompt)
        finally:_CUSTOMER_PARENT.reset(token)

    async def cancel(self,session,company,room,turn):
        current=self.turn(session,company,room,turn)
        with self.store.access(session,company,room,readonly=True) as (db,member,_):
            row=db.execute('SELECT actor,binding FROM cr_turns WHERE id=?',(turn,)).fetchone()
            require(row['actor']==member.user_id and row['binding']==member.binding,403,'TURN_CANCEL_DENIED')
        if current['status'] not in ('QUEUED','RUNNING'):return {**current,'confirmedStopped':True}
        task=self.tasks.get(turn)
        require(task is not None,409,'TURN_STOP_UNCERTAIN')
        if not task.cancelling():task.cancel()
        # Repeated Stop and observer disconnect never cancel worker cleanup again.
        done,_=await asyncio.wait({task},timeout=5)
        require(task in done,409,'TURN_STOP_UNCERTAIN')
        current=self.turn(session,company,room,turn)
        require(current['status'] not in ('QUEUED','RUNNING'),409,'TURN_STOP_UNCERTAIN')
        return {**current,'confirmedStopped':True}

    def _dto(self,row):
        return {'version':'starli.company-bot-turn.v1','runId':row['id'],'companyId':row['company'],'conversationId':row['room'],
                'botId':row['bot'],'assistantMessageId':row['message'],'userMessageId':row['user_message'],'status':row['state'],
                'provider':row['provider'],'model':row['model'],'configurationRevision':row['configuration_revision'],'errorCode':row['error_code']}

    def turn(self,session,company,room,turn):
        with self.store.access(session,company,room) as (db,member,row):
            value=db.execute('SELECT * FROM cr_turns WHERE id=? AND company=? AND room=?',(turn,company,room)).fetchone()
            require(value is not None,404,'TURN_NOT_FOUND');self.store.agent(db,member,room,value['bot'])
            return self._dto(value)

    def events(self,session,company,room,turn,after):
        require(type(after)is int and after>=0,422,'INVALID_CURSOR')
        with self.store.access(session,company,room) as (db,member,row):
            run=db.execute('SELECT * FROM cr_turns WHERE id=? AND company=? AND room=?',(turn,company,room)).fetchone()
            require(run is not None,404,'TURN_NOT_FOUND');self.store.agent(db,member,room,run['bot'])
            content=db.execute('SELECT content FROM message WHERE id=?',(run['message'],)).fetchone()[0]
            result=[]
            for event in db.execute('SELECT * FROM cr_events WHERE turn=? AND id>? ORDER BY id LIMIT 200',(turn,after)):
                dto={'version':'starli.company-bot-event.v1','cursor':event['id'],'type':event['type'],'runId':turn,'assistantMessageId':run['message']}
                if event['type']=='text.delta':dto['text']=content[event['start']:event['end']]
                elif event['type']=='tool.lifecycle':
                    dto.update(json.loads(event['state']))
                else:dto['status']=event['state']
                result.append(dto)
            return result

    def _state(self,session,ctx,selection,turn,state,error=None):
        self.fence(session,ctx,selection)
        with self.store.access(session,ctx.company_id,ctx.room_id) as (db,member,row):
            self.local_fence(db,ctx)
            self._set_state(db,turn,state,error)

    def _set_state(self,db,turn,state,error=None):
        db.execute('UPDATE cr_turns SET state=?,error_code=? WHERE id=?',(state,error,turn))
        db.execute("INSERT INTO cr_events(turn,type,state) VALUES(?,'turn.state',?)",(turn,state))
        if state not in ('RUNNING','QUEUED'):
            row=db.execute('SELECT message,room FROM cr_turns WHERE id=?',(turn,)).fetchone()
            current=json.loads(db.execute('SELECT meta FROM message WHERE id=?',(row['message'],)).fetchone()[0])
            db.execute('UPDATE message SET meta=? WHERE id=?',(encode({**current,'done':True,'runtimeStatus':state}),row['message']))
            self.store.event(db,row['room'],'message.updated',row['message'])

    def _delta(self,session,ctx,selection,turn,text):
        require(isinstance(text,str) and len(text.encode())<=65536,422,'MODEL_OUTPUT_INVALID')
        self.fence(session,ctx,selection)
        with self.store.access(session,ctx.company_id,ctx.room_id) as (db,member,row):
            self.local_fence(db,ctx)
            run=db.execute('SELECT message,state FROM cr_turns WHERE id=?',(turn,)).fetchone()
            require(run['state']=='RUNNING',409,'TURN_STOPPED')
            previous=db.execute('SELECT content FROM message WHERE id=?',(run['message'],)).fetchone()[0]
            require(len(previous)+len(text)<=100000,422,'MODEL_OUTPUT_LIMIT')
            db.execute('UPDATE message SET content=?,updated_at=? WHERE id=?',(previous+text,int(time.time()*1e9),run['message']))
            db.execute("INSERT INTO cr_events(turn,type,start,end) VALUES(?,'text.delta',?,?)",(turn,len(previous),len(previous)+len(text)))

    async def tool_catalogue(self,session,ctx,selection,turn):return []

    async def execute_tool(self,session,ctx,selection,turn,value):
        raise Denied(403,'COMPANY_TOOL_UNAVAILABLE')

    def tool_event(self,session,ctx,selection,turn,value):
        raise Denied(403,'COMPANY_TOOL_UNAVAILABLE')

    async def _run(self,session,ctx,selection,turn,prompt,history):
        memory=self.memory(session,ctx,selection,run_id=turn)
        async def rpc(operation,value):
            require(self.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,turn),403,'NATIVE_RUN_DENIED')
            if operation=='authorize':return True
            if operation=='provider.refresh':
                refreshed=self.providers.refresh_runtime_credential(selection,value.get('credential'))
                selection.clear();selection.update(refreshed)
                return {'credentialSaved':True}
            if operation=='tools.catalogue':return await self.tool_catalogue(session,ctx,selection,turn)
            if operation=='tool.execute':return await self.execute_tool(session,ctx,selection,turn,value)
            if operation=='memory.load':return memory.context(value.get('phase','model'))
            if operation=='memory.check':return memory.context(value['phase'])==value
            raise Denied(403,'RUNTIME_RPC_UNAVAILABLE')
        async def event(value):
            if value.get('type')=='text_delta':self._delta(session,ctx,selection,turn,value['text'])
            elif value.get('type')=='tool':self.tool_event(session,ctx,selection,turn,value)
        try:
            self._state(session,ctx,selection,turn,'RUNNING')
            result=await self.runner.run(selection,prompt,history,rpc,event)
            self.fence(session,ctx,selection)
            require(result.get('status')=='ANSWERED',503,result.get('errorCode')or'MODEL_TURN_INCOMPLETE')
            with self.store.access(session,ctx.company_id,ctx.room_id) as (db,_,_):
                current=db.execute('SELECT n.content FROM message n JOIN cr_turns t ON t.message=n.id WHERE t.id=?',(turn,)).fetchone()[0]
            answer=result.get('answer','');require(isinstance(answer,str) and answer.startswith(current),503,'STREAM_ANSWER_MISMATCH')
            if answer[len(current):]:self._delta(session,ctx,selection,turn,answer[len(current):])
            self._state(session,ctx,selection,turn,'ANSWERED')
        except BaseException as exc:
            state='CANCELLED' if isinstance(exc,asyncio.CancelledError) else 'FAILED'
            # Failure cleanup is private storage only, not new model/tool authority.
            code='TURN_CANCELLED'if state=='CANCELLED'else str(exc)if re.fullmatch(r'[A-Z][A-Z0-9_]{1,79}',str(exc))else'COMPANY_TURN_FAILED'
            with self.store.db() as db:self._set_state(db,turn,state,code)

    async def close(self):
        tasks=list(self.tasks.values())
        for task in tasks:task.cancel()
        if tasks:await asyncio.gather(*tasks,return_exceptions=True)

    def recover(self):
        # Never auto-replay a model request after process death or unknown effect.
        with self.store.db() as db:
            for row in db.execute("SELECT id FROM cr_turns WHERE state IN ('QUEUED','RUNNING')").fetchall():self._set_state(db,row['id'],'INTERRUPTED','RUNTIME_RESTARTED')
