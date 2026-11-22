"""Native JWT HTTP entry points; customer tokens cannot enter this router."""
import asyncio
import json
import time
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field
from .authority import Denied, actor, require

PREFIX='/api/v1/starli/companies/{company}/messaging'


class BoundedRoute(APIRoute):
    def get_route_handler(self):
        handler=super().get_route_handler()
        async def bounded(request):
            try:
                if request.method in ('POST','PUT','PATCH'):
                    require(request.headers.get('content-encoding','identity')=='identity',415,'UNSUPPORTED_ENCODING')
                    body=bytearray()
                    async for part in request.stream():
                        require(len(body)+len(part)<=65536,413,'BODY_LIMIT')
                        body.extend(part)
                    request._body=bytes(body)
                response=await handler(request)
            except Denied as error:
                response=JSONResponse({'error':{'code':error.code}},status_code=error.status)
            except RequestValidationError:
                response=JSONResponse({'error':{'code':'INVALID_REQUEST'}},status_code=422)
            except HTTPException as error:
                response=JSONResponse({'error':{'code':'NATIVE_AUTH_DENIED'}},status_code=error.status_code)
            except Exception:
                response=JSONResponse({'error':{'code':'MESSAGING_UNAVAILABLE'}},status_code=503)
            response.headers['Cache-Control']='no-store'
            response.headers['X-Content-Type-Options']='nosniff'
            return response
        return bounded


class Strict(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)


class Create(Strict):
    kind:str
    visibility:str
    name:str
    inviteUserIds:list[str]=Field(default_factory=list)
    agentIds:list[str]=Field(default_factory=list)


class Invite(Strict):
    userId:str


class Mention(Strict):
    kind:str
    id:str


class Send(Strict):
    content:str
    parentId:str|None=None
    mentions:list[Mention]=Field(default_factory=list)
    dispatchAgentIds:list[str]=Field(default_factory=list)
    attachmentIds:list[str]=Field(default_factory=list)


class Edit(Strict):
    content:str
    expectedRevision:int


class Read(Strict):
    throughSequence:int


class Draft(Strict):
    content:str
    expectedRevision:int
    deviceId:str


class Typing(Strict):
    active:bool


class Ack(Strict):
    kind:str


class Preferences(Strict):
    muted:bool
    quietStart:int|None=None
    quietEnd:int|None=None
    sound:bool=False


class WorkCreate(Strict):
    name:str
    administratorId:str
    botIds:list[str]
    visibility:str='private'
    observerIds:list[str]=Field(default_factory=list)
    maxTurns:int=16


class WorkCommand(Strict):
    action:str
    expectedRevision:int
    content:str|None=None


def make_router(store,native_session,*,stream_seconds=40,poll_interval=.5,native_dispatch=None):
    router=APIRouter(prefix=PREFIX,route_class=BoundedRoute)
    observers={}
    from . import notifications
    from . import work_sessions
    from . import links

    @router.post('/rooms/{room}/messages/{message}/links/{link}/open')
    def open_message_link(company:str,room:str,message:str,link:str,session=Depends(native_session)):
        return links.open_link(store,session,company,room,message,link)

    @router.get('/work-sessions')
    def recent_work(company:str,after:str='',limit:int=50,session=Depends(native_session)):
        return work_sessions.recent(store,session,company,after,limit)

    @router.post('/work-sessions',status_code=201)
    def create_work(company:str,body:WorkCreate,request:Request,session=Depends(native_session)):
        return work_sessions.create(store,session,company,request.headers.get('idempotency-key'),body.name,body.administratorId,body.botIds,body.visibility,body.observerIds,body.maxTurns)

    @router.get('/work-sessions/{room}')
    def get_work(company:str,room:str,session=Depends(native_session)):
        with store.access(session,company,room) as (db,member,_):
            return work_sessions.dto(db,room,store,member)

    @router.post('/work-sessions/{room}/commands')
    def command_work(company:str,room:str,body:WorkCommand,request:Request,session=Depends(native_session)):
        return work_sessions.command(store,session,company,room,request.headers.get('idempotency-key'),body.action,body.expectedRevision,body.content)

    @router.get('/notifications')
    def catch_up(company:str,after:str='',limit:int=50,session=Depends(native_session)):
        return notifications.catch_up(store,session,company,after,limit)

    @router.post('/notifications/{notification}/ack')
    def ack(company:str,notification:str,body:Ack,session=Depends(native_session)):
        return notifications.acknowledge(store,session,company,notification,body.kind)

    @router.get('/notification-preferences')
    def get_preferences(company:str,roomId:str='',session=Depends(native_session)):
        return notifications.preferences(store,session,company,roomId)

    @router.put('/notification-preferences')
    def put_preferences(company:str,body:Preferences,roomId:str='',session=Depends(native_session)):
        return notifications.preferences(store,session,company,roomId,body.model_dump())

    @router.get('/capabilities')
    def capabilities(company:str,session=Depends(native_session)):
        with store.access(session,company):pass
        return dict(humanMessaging=True,roomInvites=True,threads=True,mentions=True,unread=True,drafts=True,typing=True,replay=True,nativeBotDispatch=bool(native_dispatch and native_dispatch(session,company)),attachmentUpload=False)

    @router.get('/rooms')
    def rooms(company:str,after:str='',limit:int=50,session=Depends(native_session)):
        return store.rooms(session,company,after,limit)

    @router.post('/rooms',status_code=201)
    def create(company:str,body:Create,request:Request,session=Depends(native_session)):
        return store.create(session,company,request.headers.get('idempotency-key'),body.kind,body.visibility,body.name,body.inviteUserIds,body.agentIds)

    @router.get('/rooms/{room}')
    def snapshot(company:str,room:str,session=Depends(native_session)):
        return store.snapshot(session,company,room)

    @router.post('/rooms/{room}/invites',status_code=201)
    def invite(company:str,room:str,body:Invite,session=Depends(native_session)):
        return store.invite(session,company,room,body.userId)

    @router.get('/invites')
    def invites(company:str,session=Depends(native_session)):
        return store.invites(session,company)

    @router.post('/invites/{invitation}/accept')
    def accept(company:str,invitation:str,session=Depends(native_session)):
        return store.accept(session,company,invitation)

    @router.delete('/rooms/{room}/members/{user}')
    def remove(company:str,room:str,user:str,session=Depends(native_session)):
        return store.remove(session,company,room,user)

    @router.post('/rooms/{room}/messages',status_code=201)
    async def send(company:str,room:str,body:Send,request:Request,session=Depends(native_session)):
        result=store.send(session,company,room,request.headers.get('idempotency-key'),body.content,body.parentId,[m.model_dump() for m in body.mentions],body.dispatchAgentIds,body.attachmentIds)
        ingress=getattr(request.app.state,'company_messaging_start_turn',None)
        if body.dispatchAgentIds and callable(ingress):
            import hashlib,inspect
            from .context import capture
            dispatch=[]
            for bot in body.dispatchAgentIds:
                if result['message']['deleted']:
                    dispatch.append({'agentId':bot,'status':'DENIED','started':False});continue
                # The human transaction has committed. Native admission owns its
                # durable get-or-reuse receipt, provider/memory and actual start.
                key=hashlib.sha256(json.dumps([company,room,session.user_id,result['message']['id'],bot]).encode()).hexdigest()
                try:
                    audience=capture(store,session,company,room,bot)
                    receipt=ingress(session,audience,result['message'],key)
                    if inspect.isawaitable(receipt):receipt=await receipt
                    require(isinstance(receipt,dict),503,'NATIVE_ADMISSION_INVALID')
                    dispatch.append({'agentId':bot,'status':receipt.get('dispatchStatus','SUBMITTED'),'started':receipt.get('started',False),'receipt':receipt})
                except Exception:
                    # Human send remains successful. An uncertain admission is
                    # never reported as not started or automatically rerun here.
                    dispatch.append({'agentId':bot,'status':'UNKNOWN','started':None,'idempotencyKey':key})
            result['botDispatch']=dispatch
        return result

    @router.get('/rooms/{room}/messages')
    def messages(company:str,room:str,after:int=0,limit:int=50,threadRootId:str|None=None,session=Depends(native_session)):
        return store.messages(session,company,room,after,limit,threadRootId)

    @router.patch('/rooms/{room}/messages/{message}')
    def edit(company:str,room:str,message:str,body:Edit,session=Depends(native_session)):
        return store.edit(session,company,room,message,body.content,body.expectedRevision)

    @router.delete('/rooms/{room}/messages/{message}')
    def delete(company:str,room:str,message:str,session=Depends(native_session)):
        return store.edit(session,company,room,message,delete=True)

    @router.post('/rooms/{room}/read')
    def read(company:str,room:str,body:Read,session=Depends(native_session)):
        return store.read(session,company,room,body.throughSequence)

    @router.get('/rooms/{room}/draft')
    def get_draft(company:str,room:str,session=Depends(native_session)):
        return store.draft(session,company,room)

    @router.put('/rooms/{room}/draft')
    def put_draft(company:str,room:str,body:Draft,session=Depends(native_session)):
        return store.draft(session,company,room,body.content,body.expectedRevision,body.deviceId)

    @router.post('/rooms/{room}/typing')
    def typing(company:str,room:str,body:Typing,session=Depends(native_session)):
        return store.typing(session,company,room,body.active)

    @router.get('/rooms/{room}/events')
    async def events(company:str,room:str,request:Request,after:int=0,session=Depends(native_session)):
        store.events(session,company,room,after,1)
        identity=session.user_id
        require(observers.get(identity,0)<8,429,'OBSERVER_LIMIT')
        observers[identity]=observers.get(identity,0)+1
        async def stream():
            cursor=after;deadline=time.monotonic()+stream_seconds
            try:
                while time.monotonic()<deadline:
                    if await request.is_disconnected():return
                    page=store.events(session,company,room,cursor)
                    if page['resync']:
                        store.snapshot(session,company,room)
                        cursor=page['next']
                        yield 'id: '+str(cursor)+'\ndata: '+json.dumps({'type':'resync','cursor':cursor,'reloadMessages':True})+'\n\n'
                    for event in page['events']:
                        # Hydrate and authorize again immediately before delivery,
                        # including attachments and typing actor visibility.
                        fresh=store.events(session,company,room,event['cursor']-1,1)
                        if not fresh['events']:continue
                        yield 'id: '+str(event['cursor'])+'\ndata: '+json.dumps(fresh['events'][0])+'\n\n'
                    cursor=page['next']
                    if not page['hasMore']:
                        yield ': heartbeat\n\n'
                        await asyncio.sleep(poll_interval)
            except Denied:return
            finally:
                observers[identity]-=1
                if not observers[identity]:observers.pop(identity,None)
        return StreamingResponse(stream(),media_type='text/event-stream',headers={'X-Accel-Buffering':'no','Cache-Control':'no-store'})

    return router
