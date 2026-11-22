import asyncio,types
from starli_automations.common import need,Fault,exact
from starli_n8n_mcp.client import BridgeError

def install(app,triggers):
    from starli_company_tools.core import ToolSpec,obj
    from fastapi import APIRouter,Depends,Request
    from fastapi.routing import APIRoute
    from fastapi.responses import JSONResponse
    native=triggers.native;runtime=app.state.company_bot_runtime;store=native.store
    original=store.message_dto
    def dto(self,db,room,message):
        result=original(db,room,message)
        row=db.execute('SELECT * FROM sat_triggers WHERE room=? AND message=? ORDER BY created DESC LIMIT 1',(room,message)).fetchone()
        if row and not result.get('deleted'):
            origin=db.execute('SELECT * FROM cm_messages WHERE room=? AND id=?',(room,message)).fetchone()
            if origin and origin['speaker']==row['bot'] and origin['kind']=='agent' and not origin['deleted']:
                result['data']={**result.get('data',{}),'starliAgentTrigger':dict(version='starli.agent-trigger.v1',companyId=row['company'],conversationId=room,triggerId=row['id'],requestingBotId=row['bot'],assistantMessageId=message)}
        return result
    store.message_dto=types.MethodType(dto,store)
    def plan(bound,args):
        bound.check()
        ctx=native.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope)
        return triggers.propose(ctx,args)
    runtime.company_tools.register(ToolSpec('company_agent_schedule_plan','Propose a daily wake-up for YOU in THIS existing company conversation. At the approved local time you resume autonomous work on the saved objective using your current permitted tools, company context and provider. Ask for missing time/time zone/objective. Native card requires human standing activation; a proposal is NOT active. No fake user message, no new chat, no secrets. Thirty-day standing duration is shown for review.',obj({'name':{'type':'string','minLength':1,'maxLength':160},'prompt':{'type':'string','minLength':1,'maxLength':4000},'dailyTime':{'type':'string','minLength':5,'maxLength':5},'timeZone':{'type':'string','minLength':1,'maxLength':80}}),'write','starli-agent-triggers',plan,'integrations.run'))
    class SafeRoute(APIRoute):
        def get_route_handler(self):
            handler=super().get_route_handler()
            async def safe(request):
                try:
                    body=bytearray()
                    async for chunk in request.stream():
                        body.extend(chunk);need(len(body)<=16384,'INPUT_LIMIT',413)
                    request._body=bytes(body)
                    return await handler(request)
                except Fault as error:return JSONResponse(status_code=error.status,content={'detail':{'code':error.code}})
                except BridgeError:return JSONResponse(status_code=503,content={'detail':{'code':'AUTOMATION_ENGINE_UNAVAILABLE'}})
                except ValueError:return JSONResponse(status_code=422,content={'detail':{'code':'INVALID_JSON'}})
            return safe
    router=APIRouter(prefix='/api/v1/starli/companies/{company}/automations/agent-triggers',route_class=SafeRoute)
    dependency=app.state.company_messaging_session
    @router.get('/{ident}')
    def get(company:str,ident:str,conversationId:str,principal=Depends(dependency)):
        return triggers.get(native.context(principal,company,conversationId),ident)
    @router.post('/{ident}/{action}')
    async def action(company:str,ident:str,action:str,request:Request,principal=Depends(dependency)):
        need(action in ('activate','pause','resume','test'),'ACTION_NOT_FOUND',404)
        value=await request.json();exact(value,['conversationId','expectedRevision','reviewedHash'])
        need(type(value['expectedRevision'])is int and value['expectedRevision']>0,'INVALID_REVISION',422)
        ctx=native.context(principal,company,value['conversationId'])
        args=(ctx,ident,value['expectedRevision'],value['reviewedHash'])
        if action=='resume':return await asyncio.to_thread(triggers.activate,*args,True)
        return await asyncio.to_thread(getattr(triggers,action),*args)
    public=APIRouter(route_class=SafeRoute)
    @public.post('/api/v1/starli/automations/agent-events',status_code=202)
    async def callback(request:Request):
        authorization=request.headers.get('authorization','')
        need(authorization.startswith('Bearer '),'TRIGGER_EVENT_DENIED')
        return triggers.callback(authorization[7:],await request.json())
    app.include_router(router);app.include_router(public);app.state.starli_agent_triggers=triggers
    return triggers
