"""Inactive additive native company outreach; install after company tools.

No alternate session, private chat store, HTTP inference, or history forwarding.
Delegation supports bounded all-company-bot fanout with private room isolation.
"""
import asyncio
import hashlib
import re
import types
import uuid
from contextvars import ContextVar
from company_messaging.context import capture
from company_messaging.internal_send import tool_send
from company_messaging.store import encode
from starli_company_tools.core import ToolSpec, require, obj, ID

CONTENT = {'type': 'string', 'minLength': 1, 'maxLength': 16000}
MAX_DELEGATION_FANOUT = 16


def install(runtime, registry):
    require(not getattr(runtime, '_outreach_installed', False), 'OUTREACH_ALREADY_INSTALLED', 409)
    store = runtime.store
    grant = ContextVar('explicit_company_outreach_' + str(id(runtime)), default=None)
    original_policy = store.authority._internal_policy

    def policy(db, member, target, bot, source):
        decision = original_policy(db, member, target, bot, source)
        current = grant.get()
        if current is None:
            return decision
        bound, recipient, content = current
        scope = bound.native_scope
        require((member.user_id, target.user_id, bot, source) ==
                (scope.actor_id, recipient, scope.bot_id, scope.room_id), 'OUTREACH_SCOPE_CHANGED')
        require(decision is True or isinstance(decision, dict) and decision.get('allowed') is True,
                'OUTREACH_POLICY_DENIED')
        require(runtime.authorize_native(db, scope), 'OUTREACH_RUN_REVOKED')
        return {'allowed': True, 'sourceShare': {
            'recipientId': target.user_id, 'recipientBinding': target.binding,
            'sourceRoomId': source, 'runId': scope.run_id,
            'toolCallId': scope.tool_call_id,
            'contentSha256': hashlib.sha256(content.encode()).hexdigest(),
            'recipientAudienceFiltered': True}}

    def native(bound):
        bound.check()
        # Customer-token calls retain the existing narrower API tool surface.
        require(bound.session.kind == 'jwt', 'OUTREACH_NATIVE_JWT_REQUIRED')
        for who in (bound.context.actor_id, bound.context.bot_id):
            runtime.authority.require_member(who, bound.context.company_id, permission='messages.send')

    def human_send(bound, args):
        native(bound)
        token = grant.set((bound, args['recipientId'], args['content']))
        try:
            # The native service validates human membership, canonical DM key,
            # exact durable call, source/run fences and atomic notification.
            return tool_send(store, bound.session, bound.native_scope,
                             args['recipientId'], args['content'])
        finally:
            grant.reset(token)

    with store.db() as db:
        require(not db.execute("SELECT 1 FROM cr_turns WHERE state IN ('QUEUED','RUNNING')").fetchone(),
                'OUTREACH_INSTALL_REQUIRES_IDLE_RUNTIME', 409)
        db.execute('CREATE TABLE IF NOT EXISTS cr_delegations(child TEXT PRIMARY KEY,parent TEXT NOT NULL,call TEXT NOT NULL,UNIQUE(parent,call))')
        # Root start() still checks every active turn under BEGIN IMMEDIATE.
        # This permits only our explicit, bounded child admission below.
        db.execute('DROP INDEX IF EXISTS cr_active_room')
        db.execute("CREATE UNIQUE INDEX cr_active_room ON cr_turns(room,bot) WHERE state IN ('QUEUED','RUNNING')")

    original_local = runtime.local_fence
    original_authorize = runtime.authorize_native

    def parent_fence(db, child):
        link = db.execute('SELECT parent FROM cr_delegations WHERE child=?', (child,)).fetchone()
        if link:
            row = db.execute('SELECT state FROM cr_turns WHERE id=?', (link['parent'],)).fetchone()
            require(row is not None and row['state'] == 'RUNNING', 'DELEGATION_PARENT_STOPPED')

    def local(self, db, ctx):
        original_local(db, ctx)
        for row in db.execute("SELECT id FROM cr_turns WHERE room=? AND bot=? AND state IN ('QUEUED','RUNNING')", (ctx.room_id, ctx.bot_id)):
            parent_fence(db, row['id'])

    def authorize(self, db, scope):
        parent_fence(db, scope.run_id)
        return original_authorize(db, scope)

    def delegation_permissions(db,company,people):
        authority=object.__new__(type(runtime.authority));authority.db=db
        try:
            for who in people:
                for capability in ('bots.run','tools.dispatch','messages.send'):
                    authority.require_member(who,company,permission=capability)
        except Exception as error:
            if error.__class__.__name__=='Forbidden':require(False,'COMPANY_PERMISSION_DENIED',403)
            raise

    def max_children(db, ctx):
        schema = getattr(store.authority, 'schema', 'main')
        if not isinstance(schema, str) or re.fullmatch(r'[a-z][a-z_]{0,40}', schema) is None:
            return 3
        attached = getattr(store, 'attached_databases', None) or {}
        registry_schema = 'company_bots' if 'company_bots' in attached else schema
        try:
            peers = db.execute(
                'SELECT count(*) FROM ' + registry_schema + '.bots b JOIN ' + schema +
                ".members m ON m.company_id=b.owner AND m.user_id=b.id "
                "WHERE b.owner=? AND b.kind='company' AND b.active=1 AND m.kind='bot' AND m.active=1 AND b.id!=?",
                (ctx.company_id, ctx.bot_id),
            ).fetchone()[0]
        except Exception:
            peers = 3
        return min(MAX_DELEGATION_FANOUT, max(3, int(peers)))

    async def delegate(bound, args):
        native(bound)
        ctx=bound.context;bot=args['botId']
        require(bot!=ctx.bot_id,'DELEGATION_SELF_DENIED')
        def parent(db):
            require(runtime.authorize_native(db,bound.native_scope),'DELEGATION_RUN_REVOKED')
            require(not db.execute('SELECT 1 FROM cr_delegations WHERE child=?',(bound.run_id,)).fetchone(),'DELEGATION_DEPTH_LIMIT')
            require(db.execute('SELECT count(*) FROM cr_delegations WHERE parent=?',(bound.run_id,)).fetchone()[0]<max_children(db,ctx),'DELEGATION_TURN_LIMIT')
            require(not db.execute('SELECT 1 FROM cr_delegations WHERE parent=? AND call=?',(bound.run_id,bound.call_id)).fetchone(),'DELEGATION_NO_REPLAY')
        with store.access(bound.session,ctx.company_id,ctx.room_id) as (db,member,room):
            parent(db)
            delegation_permissions(db,ctx.company_id,(ctx.actor_id,bot))
            store.authority.require_agent(member,bot)
            require(store.authority.can_dispatch_agent(member,bot) is True,'DELEGATION_DISPATCH_DENIED')
            admitted=db.execute('SELECT 1 FROM cm_agents WHERE room=? AND agent=?',(ctx.room_id,bot)).fetchone() is not None
            child_room=ctx.room_id
            if not admitted:
                key='delegate-room-'+hashlib.sha256(encode([bound.run_id,bound.call_id]).encode()).hexdigest()
                schema=store.authority.schema
                names={r['user_id']:r['name'] for r in db.execute('SELECT user_id,name FROM '+schema+".members WHERE company_id=? AND active=1 AND kind='bot' AND user_id IN (?,?)",(ctx.company_id,ctx.bot_id,bot))}
                require(set(names)=={ctx.bot_id,bot},'DELEGATION_BOT_IDENTITY_CHANGED')
                label=' → '.join(str(names[b]).encode('utf-8')[:44].decode('utf-8','ignore') for b in (ctx.bot_id,bot))
                created=store.create_in_transaction(db,member,ctx.company_id,key,'group','private',label,[],[ctx.bot_id,bot])
                child_room=created['id']
        # The new room is committed before capture; source context/revision is untouched.
        bound.check()
        child_ctx=capture(store,bound.session,ctx.company_id,child_room,bot)
        if admitted:require(child_ctx.room_revision==ctx.room_revision,'DELEGATION_ROOM_CHANGED')
        selection=runtime.providers.capture(bound.session.user_id,ctx.company_id,bot)
        runtime.fence(bound.session,child_ctx,selection)
        child=str(uuid.uuid4())
        with store.access(bound.session,ctx.company_id,child_room) as (db,member,room):
            parent(db)
            delegation_permissions(db,ctx.company_id,(ctx.actor_id,bot))
            store.authority.require_agent(member,bot)
            require(store.authority.can_dispatch_agent(member,bot) is True,'DELEGATION_DISPATCH_DENIED')
            require(not db.execute("SELECT 1 FROM cr_turns WHERE room=? AND bot=? AND state IN ('RUNNING','QUEUED')",(child_room,bot)).fetchone(),'DELEGATION_BOT_BUSY')
            store.agent(db,member,child_room,bot);runtime.local_fence(db,child_ctx)
            request=runtime._append(db,child_room,member,'agent',ctx.bot_id,args['content'],bound.run_id)
            assistant=runtime._append(db,child_room,member,'agent',bot,'',child,False)
            fingerprint=hashlib.sha256(encode([bot,args['content'],request]).encode()).hexdigest()
            db.execute('INSERT INTO cr_turns VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)',(child,ctx.company_id,child_room,bot,ctx.actor_id,ctx.actor_binding,'delegate:'+child,fingerprint,assistant,request,'QUEUED',selection['provider'],selection['model'],selection['configurationRevision']))
            db.execute('INSERT INTO cr_delegations VALUES(?,?,?)',(child,bound.run_id,bound.call_id))
            db.execute("INSERT INTO cr_events(turn,type,state) VALUES(?,'turn.state','QUEUED')",(child,))
            db.execute("INSERT INTO cr_events(turn,type,state) VALUES(?,'delegation.link',?)",(bound.run_id,encode({'childRunId':child,'conversationId':child_room,'botId':bot,'requestMessageId':request,'assistantMessageId':assistant})))
        runtime.scopes[child]=(bound.session,child_ctx,selection)
        task=asyncio.create_task(runtime._run(bound.session,child_ctx,selection,child,args['content'],[]));runtime.tasks[child]=task
        try:
            await asyncio.wait_for(task,timeout=120)
            if asyncio.current_task().cancelling():raise asyncio.CancelledError()
            bound.check();result=runtime.turn(bound.session,ctx.company_id,child_room,child)
            receipt={'status':result['status'],'runId':child,'conversationId':child_room,'botId':bot,'assistantMessageId':assistant}
            if result.get('errorCode'):
                receipt['errorCode']=result['errorCode']
            if admitted:
                with store.access(bound.session,ctx.company_id,child_room) as (db,_,_):receipt['content']=store.message_dto(db,child_room,assistant)['content']
            return receipt
        finally:
            if not task.done():
                task.cancel();await asyncio.gather(task,return_exceptions=True)
            runtime.tasks.pop(child,None);runtime.scopes.pop(child,None)

    registry.register(ToolSpec('company_human_message_send',
        'Send only the explicitly supplied text as this bot to an exact current company human. Reuse/create the native bot-human DM and notification. Never copies source history.',
        obj({'recipientId': ID, 'content': CONTENT}), 'write', 'company-native-outreach', human_send, 'messages.send'))
    registry.register(ToolSpec('company_bot_delegate',
        'Ask an exact active company bot by botId. If not admitted here, create a private native collaboration group containing only the requesting human and both bots. Only explicit content is sent; no source history. Cross-room receipt excludes child answer text to protect private memory. Waits up to 120 seconds; bounded all-company-bot fanout (up to 16 active peer bots), no nested delegation.',
        obj({'botId': ID, 'content': CONTENT}), 'write', 'company-native-outreach', delegate, 'messages.send'))
    store.authority._internal_policy = policy
    runtime.local_fence = types.MethodType(local, runtime)
    runtime.authorize_native = types.MethodType(authorize, runtime)
    runtime._outreach_installed = True
    return runtime


def install_admission(app, runtime):
    """Explicit native human admission; never tool-initiated or a guessed DB write."""
    from fastapi import APIRouter, Depends, Request
    from company_messaging.http import BoundedRoute, Strict
    from company_messaging.authority import require as native_require
    from company_messaging.store import ident
    class Admit(Strict):
        agentId: str
        expectedRevision: int
    store=runtime.store
    with store.db() as db:
        db.execute("CREATE TABLE IF NOT EXISTS cr_room_agent_admissions(company TEXT NOT NULL,room TEXT NOT NULL,agent TEXT NOT NULL,actor TEXT NOT NULL,binding TEXT NOT NULL,revision INTEGER NOT NULL,created REAL NOT NULL,PRIMARY KEY(room,revision))")
    router=APIRouter(prefix='/api/v1/starli/companies/{company}/messaging',route_class=BoundedRoute)
    @router.post('/rooms/{room}/agents')
    def admit(company:str,room:str,body:Admit,session=Depends(app.state.company_messaging_session)):
        native_require(session.kind=='jwt',403,'NATIVE_HUMAN_ADMISSION_REQUIRED')
        ident(body.agentId)
        native_require(body.expectedRevision>=1,422,'INVALID_REVISION')
        with store.access(session,company,room) as (db,member,row):
            native_require(row['kind']!='work_session',422,'EXPLICIT_WORK_SESSION_REQUIRED')
            # Native session additionally checks current write capability.
            try:
                for capability in ('bots.run','tools.dispatch','messages.send'):
                    runtime.authority.require_member(member.user_id,company,permission=capability)
                    runtime.authority.require_member(body.agentId,company,permission=capability)
            except Exception as error:
                # Same real AuthorityPort error translation as native_mount.permission.
                if error.__class__.__name__=='Forbidden':
                    from company_messaging.authority import Denied
                    raise Denied(403,'COMPANY_PERMISSION_DENIED') from None
                raise
            store.authority.require_agent(member,body.agentId)
            native_require(store.authority.can_dispatch_agent(member,body.agentId) is True,403,'AGENT_DISPATCH_DENIED')
            native_require(db.execute("SELECT 1 FROM cr_turns WHERE room=? AND state IN ('QUEUED','RUNNING')",(room,)).fetchone() is None,409,'ROOM_TURN_ACTIVE')
            exists=db.execute('SELECT 1 FROM cm_agents WHERE room=? AND agent=?',(room,body.agentId)).fetchone()
            if exists:
                return dict(companyId=company,roomId=room,agentId=body.agentId,joined=False,revision=row['revision'])
            native_require(row['revision']==body.expectedRevision,409,'ROOM_REVISION_CHANGED')
            db.execute('INSERT INTO cm_agents VALUES(?,?)',(room,body.agentId))
            db.execute('UPDATE cm_rooms SET revision=revision+1 WHERE id=?',(room,))
            revision=row['revision']+1
            db.execute('INSERT INTO cr_room_agent_admissions VALUES(?,?,?,?,?,?,?)',(company,room,body.agentId,member.user_id,member.binding,revision,store.clock()))
            store.event(db,room,'room.agent.added')
            return dict(companyId=company,roomId=room,agentId=body.agentId,joined=True,revision=revision)
    app.include_router(router)
