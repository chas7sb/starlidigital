"""Thin adapter to native canonical chat, public activity and physical cancellation.

No conversation creation, provider SDK, private activity store or execution loop.
Install ONLY with the reviewed matching shared overlay.
"""
import json
import os
from fastapi import HTTPException, Request
from open_webui.routers import starli_v3_native as registry
from open_webui.routers import starli_chat_stream as stream
from open_webui.routers import starli_chat_turns as turns
from open_webui.routers import starli_chat_sync as sync
from open_webui.routers import starli_public_activity as activity
from open_webui.routers import starli_runs as runs
from open_webui.routers.starli_customer_context import issue_context, _existing
from open_webui.routers.customer_store import CustomerError, reject
from open_webui.models.users import Users

TERMINAL=frozenset(activity.TERMINAL)|frozenset(activity.PAUSED_STATES)

def active_account(owner):
    user=Users.get_user_by_id(owner)
    if user is None or user.role not in ('user','admin'):return False
    try:return registry._owner(user)==owner
    except HTTPException:return False

def owned_bots(owner):
    if not active_account(owner):return set()
    with registry._db() as db:
        return {r['id'] for r in db.execute('SELECT id FROM agents WHERE owner=? AND archived_at IS NULL',(owner,))}

def session_owner(request:Request):
    from open_webui.routers.starli_session_fence import _jwt_fence
    if request.url.scheme!='https':reject(400,'https_required','HTTPS is required.')
    # Explicit Bearer JWT only: customer/legacy keys and ambient cookies cannot mint.
    value=request.headers.get('authorization','')
    if not value.startswith('Bearer ') or value[7:].startswith(('stli_','sk-')):
        reject(401,'native_session_required','Sign in to Starli to manage customer tokens.')
    user,fence=_jwt_fence(value[7:])
    registry._mutation_guard(request)
    if not active_account(user.id):reject(401,'native_session_required','Account is unavailable.')
    fence.check()
    return user.id

def branch(document):
    history=document.get('history') or {};mapping=history.get('messages') or {}
    current=history.get('currentId');result=[];seen=set()
    while current is not None:
        if current in seen or current not in mapping:reject(409,'canonical_history_invalid','Canonical history needs repair in Starli.')
        seen.add(current);row=mapping[current]
        if not isinstance(row,dict):reject(409,'canonical_history_invalid','Canonical history needs repair in Starli.')
        result.append(row);current=row.get('parentId')
    return list(reversed(result))

def canonical_messages(document,exclude_id=None):
    # Native _prompt consumes the last twelve rows/12k chars; the native account
    # transport accepts at most 100 rows. Retain metadata and the same latest-100
    # boundary rather than applying the unused legacy account_messages validator.
    rows=[dict(row) for row in branch(document) if row.get('id')!=exclude_id
          and row.get('role') in ('user','assistant') and not row.get('starliExecution')]
    return rows[-100:]

class NativeAdapter:
    def __init__(self,store):self.store=store
    def resolve(self,p,bot):
        self.store.check(p,'messages:send',bot)
        user,identity=_existing(p.owner_id,bot)
        chat=registry.owned_live_chat(user,identity['conversationId'])
        return {**identity,'currentId':(chat.chat.get('history') or {}).get('currentId')}

    async def submit(self,request,p,op,content):
        user,context=issue_context(self.store,request.headers['authorization'][7:],op['bot'])
        if context.user_id!=p.owner_id or context.token_id!=p.token_id or context.identity['conversationId']!=op['conversation']:
            reject(409,'binding_changed','Bot binding changed before admission.')
        body=turns.PrepareTurn(turnId=op['turn_id'],expectedCurrentId=op['parent'],
            userMessageId=op['user_message_id'],assistantMessageId=op['assistant_message_id'],
            model=os.getenv('STARLI_CHAT_MODEL_ID','starli_pi'),userMessage=turns.UserMessage(content=content))
        # Adopt only native synchronization metadata for this already-linked,
        # already-owned chat. This path cannot create a conversation or binding.
        with sync.session_write_fence(context,op['conversation']):
            with sync._db(True) as db:
                sync._chat(db,p.owner_id,op['conversation'])
                previous=db.execute('SELECT agent_id FROM starli_sync_chats WHERE owner=? AND chat_id=?',(p.owner_id,op['conversation'])).fetchone()
                other=db.execute('SELECT chat_id FROM starli_sync_chats WHERE owner=? AND agent_id=? AND canonical=1',(p.owner_id,op['bot'])).fetchone()
                if previous is not None and previous['agent_id']!=op['bot'] or other is not None and other['chat_id']!=op['conversation']:
                    reject(409,'canonical_binding_conflict','The existing canonical synchronization binding needs repair in Starli.')
                if previous is None:
                    db.execute('INSERT INTO starli_sync_chats(owner,chat_id,agent_id,canonical) VALUES(?,?,?,1)',(p.owner_id,op['conversation'],op['bot']))
                    sync._append(db,p.owner_id,op['conversation'],'conversation.updated',{'currentId':op['parent']},revision=True)
        try:turns.prepare_turn(user,op['conversation'],body,fence=context)
        except HTTPException as error:
            # Native prepare's transaction rolls back on HTTP rejection, including
            # stale parent/busy/fence checks. No launch has been attempted here.
            error.no_effects=True
            raise
        # History comes only from native persistence AFTER CAS append, never client history.
        chat=registry.owned_live_chat(context.check(op['conversation']),op['conversation'])
        rows=branch(chat.chat)
        if not rows or rows[-1].get('id')!=op['assistant_message_id']:reject(409,'canonical_parent_conflict','Canonical turn changed before execution.')
        messages=canonical_messages(chat.chat,exclude_id=op['assistant_message_id'])
        response=await stream.stream_response(request,user,{'model':body.model,'messages':messages},op['conversation'],op['assistant_message_id'],account_request_id=op['id'],customer_context=context)
        run_id=response.headers.get('X-Starli-Run-ID')
        if not run_id:reject(503,'run_receipt_missing','Native acceptance must be reconciled.')
        return {'runId':run_id,'source':self._text(response.body_iterator)}

    async def _text(self,source):
        buffer=''
        try:
            async for data in source:
                buffer+=data.decode() if isinstance(data,bytes) else data
                if len(buffer.encode())>262144:reject(503,'native_stream_invalid','Native stream frame exceeded limits.')
                while '\n\n' in buffer:
                    frame,buffer=buffer.split('\n\n',1)
                    for line in frame.splitlines():
                        if not line.startswith('data: '):continue
                        payload=line[6:]
                        if payload=='[DONE]':return
                        event=json.loads(payload)
                        if 'error' in event:reject(409,'run_stopped','Native execution stopped; inspect status.')
                        if event.get('object')!='chat.completion.chunk':continue
                        for choice in event.get('choices',[]):
                            text=choice.get('delta',{}).get('content')
                            if isinstance(text,str) and text:yield text
        finally:await source.aclose()

    def detach(self,p,op):
        # Existing producer remains active. This only closes its HTTP observer queue.
        scope=stream._RUNS.get(op['run_id'])
        if scope is not None and scope.fence.user_id==p.owner_id:scope.detach()

    def reconcile(self,p,op):
        # Recovery is read/attach only. Never call prepare_turn or stream_response.
        self.store.check(p,'runs:read',op['bot'])
        user=Users.get_user_by_id(p.owner_id)
        chat=registry.owned_live_chat(user,op['conversation'])
        mapping=chat.chat.get('history',{}).get('messages',{}) or {}
        message=mapping.get(op['assistant_message_id'])
        if not isinstance(message,dict):return None
        binding=message.get('starliPublicRun')
        if not isinstance(binding,dict) or not binding.get('runId'):return None
        _,run=self._run(p,binding['runId'])
        if run.get('assistantMessageId')!=op['assistant_message_id'] or run.get('conversationId')!=op['conversation'] or run.get('agentId')!=op['bot']:
            reject(409,'operation_binding_conflict','Canonical run does not match the recorded operation.')
        return {'runId':run['runId']}

    def _run(self,p,run_id,scope='runs:read'):
        self.store.check(p,scope)
        user=Users.get_user_by_id(p.owner_id)
        run=activity.read_run(user,run_id)['run']
        bot=run.get('agentId')
        self.store.check(p,scope,bot)
        with registry._db() as db:
            registry._get(db,p.owner_id,bot)
            link=db.execute('SELECT chat_id FROM agent_conversations WHERE owner=? AND agent_id=?',(p.owner_id,bot)).fetchone()
        if not link or link['chat_id']!=run['conversationId']:reject(404,'run_not_found','Run not found.')
        registry.owned_live_chat(user,run['conversationId'])
        return user,run

    def status(self,p,run_id):
        user,run=self._run(p,run_id)
        return {'run':run,'terminal':run['status'] in TERMINAL}

    def result(self,p,op):
        user,run=self._run(p,op['run_id'],'messages:send')
        return self._result(user,run)

    def final(self,p,run_id):
        user,run=self._run(p,run_id)
        self.store.check(p,'conversations:read',run['agentId'])
        return {'run':run,**self._result(user,run)}

    def _result(self,user,run):
        chat=registry.owned_live_chat(user,run['conversationId'])
        row=(chat.chat.get('history',{}).get('messages',{}) or {}).get(run['assistantMessageId'],{})
        text=row.get('content','')
        status=run['status']
        return {'terminal':status in TERMINAL,'text':text if isinstance(text,str) else '',
                'error':status in {'FAILED','CANCELLED','INTERRUPTED','DENIED','BUDGET_EXHAUSTED'},'finishReason':'stop'}

    def messages(self,p,bot,after,limit):
        self.store.check(p,'conversations:read',bot)
        user=Users.get_user_by_id(p.owner_id)
        with registry._db() as db:
            registry._get(db,p.owner_id,bot)
            link=db.execute('SELECT chat_id FROM agent_conversations WHERE owner=? AND agent_id=?',(p.owner_id,bot)).fetchone()
        if not link:reject(409,'conversation_not_initialized','Initialize this bot conversation in Starli first.')
        chat=registry.owned_live_chat(user,link['chat_id'])
        rows=branch(chat.chat)
        start=0
        if after is not None:
            indices=[i for i,r in enumerate(rows) if r.get('id')==after]
            if not indices:reject(409,'message_cursor_stale','Cursor is not on the current canonical branch.')
            start=indices[0]+1
        selected=rows[start:start+limit]
        self.store.check(p,'conversations:read',bot)
        return {'conversationId':link['chat_id'],'data':[sync._message(r) for r in selected],
                'hasMore':len(rows)>start+limit,'nextCursor':selected[-1]['id'] if selected else after}

    def events(self,p,run_id,after):
        user,run=self._run(p,run_id)
        page=activity.read_run(user,run_id,after=after,limit=100)
        self._run(p,run_id)
        return {**page,'terminal':page['run']['status'] in TERMINAL}

    def snapshot(self,p,run_id):
        user,_=self._run(p,run_id)
        result=activity.read_snapshot(user,run_id)
        self._run(p,run_id)
        return result

    async def cancel(self,p,run_id):
        user,run=self._run(p,run_id,'runs:cancel')
        adapter=self
        class CancelFence:
            def check(self,chat_id):
                fresh,current=adapter._run(p,run_id,'runs:cancel')
                if current['conversationId']!=chat_id:reject(404,'run_not_found','Run not found.')
                return fresh
        return await runs.cancel_authorized(user,CancelFence(),{'run':run})
