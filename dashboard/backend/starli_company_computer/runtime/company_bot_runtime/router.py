import asyncio,json,time
from fastapi import APIRouter,Depends,Header,HTTPException,Request
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel,ConfigDict,Field
from company_messaging.authority import Denied
from .company_providers import Denied as ProviderDenied
from starli_memory.store import MemoryFault


class PrivateRoute(APIRoute):
    def get_route_handler(self):
        handler=super().get_route_handler()
        async def private(request):
            response=await handler(request);response.headers['Cache-Control']='no-store';return response
        return private


class Turn(BaseModel):
    model_config=ConfigDict(extra='forbid')
    prompt:str=Field(min_length=1,max_length=16000)


def make_router(runtime,native_session,*,stream_seconds=30,poll_interval=.05):
    router=APIRouter(prefix='/api/v1/starli/companies/{company}/rooms/{room}/bots/{bot}/runtime',route_class=PrivateRoute)
    def call(fn):
        try:return fn()
        except Denied as e:raise HTTPException(e.status,e.code)from None
        except (ProviderDenied,MemoryFault):raise HTTPException(403,'COMPANY_PROVIDER_OR_MEMORY_UNAVAILABLE')from None
    @router.post('/turns')
    async def start(company:str,room:str,bot:str,form:Turn,idempotency_key:str=Header(alias='Idempotency-Key'),session=Depends(native_session)):
        try:return await runtime.start(session,company,room,bot,idempotency_key,form.prompt)
        except Denied as e:raise HTTPException(e.status,e.code)from None
        except (ProviderDenied,MemoryFault):raise HTTPException(403,'COMPANY_PROVIDER_OR_MEMORY_UNAVAILABLE')from None
    @router.get('/turns/{turn}')
    def snapshot(company:str,room:str,bot:str,turn:str,session=Depends(native_session)):
        result=call(lambda:runtime.turn(session,company,room,turn))
        if result['botId']!=bot:raise HTTPException(404,'TURN_NOT_FOUND')
        return result
    @router.post('/messages/{message}/turns')
    async def from_message(company:str,room:str,bot:str,message:str,idempotency_key:str=Header(alias='Idempotency-Key'),session=Depends(native_session)):
        try:return await runtime.start_from_message(session,company,room,bot,idempotency_key,message)
        except Denied as e:raise HTTPException(e.status,e.code)from None
        except (ProviderDenied,MemoryFault):raise HTTPException(403,'COMPANY_PROVIDER_OR_MEMORY_UNAVAILABLE')from None
    @router.post('/turns/{turn}/cancel')
    async def cancel(company:str,room:str,bot:str,turn:str,session=Depends(native_session)):
        current=call(lambda:runtime.turn(session,company,room,turn))
        if current['botId']!=bot:raise HTTPException(404,'TURN_NOT_FOUND')
        try:return await runtime.cancel(session,company,room,turn)
        except Denied as e:raise HTTPException(e.status,e.code)from None
    @router.get('/turns/{turn}/events')
    async def events(company:str,room:str,bot:str,turn:str,request:Request,after:int=0,last_event_id:str|None=Header(default=None),session=Depends(native_session)):
        result=call(lambda:runtime.turn(session,company,room,turn))
        if result['botId']!=bot:raise HTTPException(404,'TURN_NOT_FOUND')
        if last_event_id is not None:
            try:after=max(after,int(last_event_id))
            except ValueError:raise HTTPException(422,'INVALID_CURSOR')from None
        call(lambda:runtime.events(session,company,room,turn,after))
        async def stream():
            cursor=after;deadline=time.monotonic()+stream_seconds
            while time.monotonic()<deadline and not await request.is_disconnected():
                try:batch=runtime.events(session,company,room,turn,cursor)
                except Exception:return # fresh session/member/room denial closes stream
                for event in batch:
                    cursor=event['cursor']
                    yield 'id: '+str(cursor)+'\nevent: '+event['type']+'\ndata: '+json.dumps(event)+'\n\n'
                try:state=runtime.turn(session,company,room,turn)['status']
                except Exception:return
                if state not in ('QUEUED','RUNNING') and not batch:return
                await asyncio.sleep(poll_interval)
        return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'})
    return router


def mount(app,runtime,native_session,**options):
    if getattr(app.state,'company_bot_runtime',None)is not None:raise RuntimeError('COMPANY_RUNTIME_ALREADY_MOUNTED')
    app.state.company_bot_runtime=runtime
    app.include_router(make_router(runtime,native_session,**options))
    app.add_event_handler('shutdown',runtime.close)
    return runtime.close
