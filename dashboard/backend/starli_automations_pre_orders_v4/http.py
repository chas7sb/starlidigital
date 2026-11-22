"""Native authenticated API factory. Host chooses staging/mount lifecycle."""
from .common import Fault,need,envelope
PREFIX='/api/v1/starli/companies/{company}/automations'

def make_router(gateway,session_dependency):
    from fastapi import APIRouter,Depends,Request
    from fastapi.routing import APIRoute
    from fastapi.responses import JSONResponse
    class SafeRoute(APIRoute):
        def get_route_handler(self):
            handler=super().get_route_handler()
            async def safe(request):
                try:
                    length=request.headers.get('content-length')
                    if length is not None:need(length.isdigit() and int(length)<=65536,'INPUT_LIMIT',413)
                    # Read even chunked bodies with a hard bound before handlers.
                    content=bytearray()
                    async for chunk in request.stream():
                        content.extend(chunk);need(len(content)<=65536,'INPUT_LIMIT',413)
                    request._body=bytes(content)
                    return await handler(request)
                except Fault as error:return JSONResponse(status_code=error.status,content={'detail':{'code':error.code}})
            return safe
    router=APIRouter(prefix=PREFIX,route_class=SafeRoute)
    def ctx(company,principal,room=None):return gateway.context(principal,company,room)
    @router.get('/catalog')
    async def catalog(company:str,principal=Depends(session_dependency)):
        context=ctx(company,principal);await gateway.health();return gateway.catalog(context)
    @router.get('/feedback')
    def feedback(company:str,conversationId:str,principal=Depends(session_dependency)):
        return gateway.feedback.snapshot(ctx(company,principal,conversationId),conversationId)
    @router.get('/feedback/events')
    async def feedback_events(company:str,conversationId:str,request:Request,after:int=0,principal=Depends(session_dependency)):
        import asyncio,json,time
        from fastapi.responses import StreamingResponse
        need(type(after)is int and 0<=after<2**53,'INVALID_CURSOR',422)
        context=ctx(company,principal,conversationId)
        with gateway.access(context):pass
        async def events():
            cursor=after;started=time.monotonic()
            while time.monotonic()-started<300 and not await request.is_disconnected():
                # Every poll revalidates the actual session/member/room. Stream
                # reconnect never confers durable authority of its own.
                try:
                    with gateway.access(context) as db:
                        rows=db.execute('SELECT cursor FROM sa_feedback_events WHERE company=? AND room=? AND cursor>? ORDER BY cursor LIMIT 100',(context.company,conversationId,cursor)).fetchall()
                    if rows:
                        cursor=rows[-1]['cursor']
                        value=envelope(context.company,conversationId=conversationId,type='automation.changed',cursor=cursor)
                        yield 'id: '+str(cursor)+'\nevent: automation.changed\ndata: '+json.dumps(value)+'\n\n'
                    else:yield ': keepalive\n\n'
                except Exception:return
                await asyncio.sleep(1)
        return StreamingResponse(events(),media_type='text/event-stream',headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'})
    @router.get('/connections')
    def connections(company:str,principal=Depends(session_dependency)):
        return gateway.connections.list(ctx(company,principal))
    @router.get('/connections/setup')
    def connection_setup(company:str,principal=Depends(session_dependency)):
        context=ctx(company,principal)
        with gateway.access(context):pass
        registry=getattr(gateway.connections,'app_resolver',None)
        need(registry is not None and callable(getattr(registry,'metadata',None)),'BUSINESS_OAUTH_SETUP_UNAVAILABLE',503)
        return registry.metadata(context)
    @router.post('/connections/{provider}/authorize')
    async def authorize(company:str,provider:str,request:Request,principal=Depends(session_dependency)):
        return await gateway.connections.authorize(ctx(company,principal),provider,await request.json())
    @router.get('/connections/{provider}/callback')
    async def callback(company:str,provider:str,state:str,code:str,request:Request,principal=Depends(session_dependency)):
        return await gateway.connections.complete(ctx(company,principal),provider,state,code,proof=dict(request.query_params))
    @router.post('/connections/{provider}/complete')
    async def complete(company:str,provider:str,request:Request,principal=Depends(session_dependency)):
        from .common import exact
        form=await request.json();exact(form,('state','code'),('proof',))
        return await gateway.connections.complete(ctx(company,principal),provider,form['state'],form['code'],proof=form.get('proof'))
    @router.post('/connections/{connection}/disconnect')
    async def disconnect(company:str,connection:str,request:Request,principal=Depends(session_dependency)):
        form=await request.json();from .common import exact
        exact(form,('expectedRevision',))
        return gateway.connections.disconnect(ctx(company,principal),connection,form['expectedRevision'])
    @router.get('/drafts')
    def drafts(company:str,conversationId:str,principal=Depends(session_dependency)):
        return gateway.list_drafts(ctx(company,principal,conversationId),conversationId)
    @router.post('/drafts')
    async def create(company:str,request:Request,principal=Depends(session_dependency)):
        form=await request.json();return gateway.create_draft(ctx(company,principal),form)
    @router.patch('/drafts/{draft}')
    async def update(company:str,draft:str,request:Request,principal=Depends(session_dependency)):
        return gateway.update_draft(ctx(company,principal),draft,await request.json())
    @router.post('/drafts/{draft}/test')
    async def test(company:str,draft:str,request:Request,principal=Depends(session_dependency)):
        return await gateway.test_draft(ctx(company,principal),draft,await request.json())
    @router.post('/drafts/{draft}/activate')
    async def activate(company:str,draft:str,request:Request,principal=Depends(session_dependency)):
        return await gateway.activate(ctx(company,principal),draft,await request.json())
    @router.get('/workflows')
    def workflows(company:str,principal=Depends(session_dependency)):
        return gateway.list_workflows(ctx(company,principal))
    @router.post('/workflows/{workflow}/pause')
    async def pause(company:str,workflow:str,request:Request,principal=Depends(session_dependency)):
        return await gateway.pause(ctx(company,principal),workflow,await request.json())
    @router.get('/workflows/{workflow}/history')
    def history(company:str,workflow:str,principal=Depends(session_dependency)):
        return gateway.history(ctx(company,principal),workflow)
    @router.post('/workflows/{workflow}/events')
    async def event(company:str,workflow:str,request:Request,principal=Depends(session_dependency)):
        return await gateway.ingest(ctx(company,principal),workflow,request.headers.get('idempotency-key'),await request.json())
    @router.post('/workflows/{workflow}/internal-test')
    async def internal_test(company:str,workflow:str,request:Request,principal=Depends(session_dependency)):
        from .common import exact
        form=await request.json();exact(form,('label',))
        return await gateway.run_internal_test(ctx(company,principal),workflow,request.headers.get('idempotency-key'),form['label'])
    @router.get('/approvals')
    def approvals(company:str,conversationId:str,principal=Depends(session_dependency)):
        return gateway.list_approvals(ctx(company,principal,conversationId),conversationId)
    @router.post('/approvals/{approval}/decision')
    async def decision(company:str,approval:str,request:Request,principal=Depends(session_dependency)):
        return gateway.decide(ctx(company,principal),approval,await request.json())
    @router.post('/executions/{execution}/reconcile')
    async def reconcile(company:str,execution:str,principal=Depends(session_dependency)):
        return await gateway.reconcile(ctx(company,principal),execution)
    @router.post('/executions/{execution}/cancel')
    async def cancel(company:str,execution:str,principal=Depends(session_dependency)):
        return await gateway.cancel(ctx(company,principal),execution)
    public=APIRouter(route_class=SafeRoute)
    public.include_router(router)
    # The real native dependency validates JWT, membership and write permission
    # using path_params['company']. This shared route has no company segment.
    # Reuse its OWN verified-user dependency, resolve company from durable state,
    # then invoke that SAME native dependency with a scoped Request. No alternate
    # principal, frontend company selection, or OAuth-only authentication exists.
    import hashlib,inspect
    native_user=inspect.signature(session_dependency).parameters.get('user')
    verified_user=getattr(native_user.default,'dependency',None) if native_user else None
    if not callable(verified_user):
        async def verified_user():raise Fault('NATIVE_VERIFIED_USER_DEPENDENCY_REQUIRED',503)
    async def completion_session(request:Request,user=Depends(verified_user)):
        try:form=await request.json()
        except ValueError:raise Fault('OAUTH_COMPLETION_INVALID',422) from None
        need(type(form)is dict,'OAUTH_COMPLETION_INVALID',422)
        provider=request.path_params.get('provider')
        if set(form)=={'handoff'}:
            token=form['handoff'];need(type(token)is str and 1<=len(token)<=128,'OAUTH_HANDOFF_DENIED')
            hashed=hashlib.sha256(token.encode()).hexdigest()
            with gateway.store.db(readonly=True) as db:
                row=db.execute("SELECT company,actor,expires FROM sa_oauth_handoffs WHERE hash=? AND provider=? AND state='PENDING'",(hashed,provider)).fetchone()
        else:
            token=form.get('state');need(type(token)is str and 1<=len(token)<=128,'OAUTH_STATE_DENIED')
            hashed=hashlib.sha256(token.encode()).hexdigest()
            with gateway.store.db(readonly=True) as db:
                row=db.execute("SELECT company,actor,expires FROM sa_oauth WHERE state_hash=? AND provider=? AND state='PENDING'",(hashed,provider)).fetchone()
        need(row is not None and row['expires']>gateway.clock(),'OAUTH_COMPLETION_DENIED')
        need(getattr(user,'id',None)==row['actor'],'OAUTH_COMPLETION_OWNER_DENIED')
        scope={**request.scope,'path_params':{**request.path_params,'company':row['company']}}
        scoped=Request(scope,receive=request.receive)
        return await session_dependency(scoped,user)
    @public.get('/api/v1/starli/automations/oauth/{provider}/return')
    def public_return(provider:str,request:Request):
        from fastapi.responses import RedirectResponse
        pairs=list(request.query_params.multi_items())
        need(len(request.url.query)<=8192 and len(pairs)==len({k for k,v in pairs}),'OAUTH_CALLBACK_INVALID',422)
        location=gateway.connections.receive_handoff(provider,dict(pairs))
        return RedirectResponse(location,status_code=303,headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})
    @public.post('/api/v1/starli/automations/oauth/{provider}/complete')
    async def shared_complete(provider:str,request:Request,principal=Depends(completion_session)):
        from .common import exact
        form=await request.json()
        if type(form)is dict and set(form)=={'handoff'}:
            return await gateway.connections.complete_handoff(principal,provider,form['handoff'])
        exact(form,('state','code'),('proof',))
        context=gateway.connections.callback_context(principal,form['state'])
        return await gateway.connections.complete(context,provider,form['state'],form['code'],form.get('proof'))
    @public.get('/api/v1/starli/automations/oauth/{provider}/callback')
    async def shared_callback(provider:str,state:str,code:str,request:Request,principal=Depends(session_dependency)):
        context=gateway.connections.callback_context(principal,state)
        return await gateway.connections.complete(context,provider,state,code,proof=dict(request.query_params))
    return public
