import starli_portable as _portable
import asyncio,json,logging,re
from .core import SocialFault,need,exact
from .legacy import OAuth

def make_router(service,native_session,fence_key):
    from fastapi import APIRouter,Depends,Request,Response
    from fastapi.routing import APIRoute
    from fastapi.responses import JSONResponse,RedirectResponse
    class PrivateRoute(APIRoute):
        def get_route_handler(self):
            handler=super().get_route_handler()
            async def safe(request):
                try:
                    if request.method in('POST','PATCH','DELETE')and request.url.path!='/api/v1/starli/social/internal/effect-fence':
                        need(request.headers.get('authorization','').startswith('Bearer '),'NATIVE_BEARER_REQUIRED',401)
                        origin=request.headers.get('origin');development=service.legacy.config.get('allowDevelopmentFrontend')is True
                        need(origin is None or origin in _portable.allowed_origins(),'ORIGIN_DENIED')
                        need(request.headers.get('sec-fetch-site')!='cross-site','ORIGIN_DENIED')
                    size=request.headers.get('content-length');need(size is None or size.isdigit()and int(size)<=65536,'INPUT_LIMIT',413)
                    body=bytearray()
                    async with asyncio.timeout(5):
                        async for chunk in request.stream():
                            need(len(body)+len(chunk)<=65536,'INPUT_LIMIT',413);body.extend(chunk)
                    request._body=bytes(body)
                    response=await handler(request)
                except SocialFault as error:response=JSONResponse({'detail':{'code':error.code}},status_code=error.status)
                except (ValueError,TypeError):response=JSONResponse({'detail':{'code':'INVALID_INPUT'}},status_code=422)
                except TimeoutError:response=JSONResponse({'detail':{'code':'INPUT_TIMEOUT'}},status_code=408)
                response.headers['Cache-Control']='private, no-store';response.headers['Referrer-Policy']='no-referrer';return response
            return safe
    router=APIRouter(route_class=PrivateRoute);base='/api/v1/starli/companies/{company}/social';oauth=OAuth(service)
    @router.get(base+'/connections')
    async def connections(company:str,session=Depends(native_session)):return await service.connections(service.context(session,company))
    @router.get(base+'/account-assets')
    async def assets(company:str,session=Depends(native_session)):return await service.assets(service.context(session,company))
    @router.post(base+'/connect')
    async def connect(company:str,request:Request,response:Response,session=Depends(native_session)):
        form=await request.json();exact(form,('sourceConversationId',));need(request.headers.get('authorization','').startswith('Bearer '),'NATIVE_BEARER_REQUIRED',401)
        return await oauth.begin(service.context(session,company,form['sourceConversationId']),request,response)
    @router.post(base+'/delegations')
    async def delegate(company:str,request:Request,session=Depends(native_session)):
        form=await request.json();exact(form,('sourceConversationId','pages'),('expectedRevision',))
        return await service.delegate(service.context(session,company,form['sourceConversationId']),form)
    @router.delete(base+'/delegations/{ident}')
    async def revoke(company:str,ident:str,request:Request,session=Depends(native_session)):
        form=await request.json();exact(form,('expectedRevision',));return service.revoke(service.context(session,company),ident,form['expectedRevision'])
    @router.get(base+'/loops')
    def loops(company:str,session=Depends(native_session)):return service.snapshot(service.context(session,company))
    @router.get(base+'/loops/{ident}/history')
    async def history(company:str,ident:str,session=Depends(native_session)):return await service.history(service.context(session,company),ident)
    @router.patch(base+'/loops/{ident}')
    async def update(company:str,ident:str,request:Request,session=Depends(native_session)):return service.update(service.context(session,company),ident,await request.json())
    @router.post(base+'/loops/{ident}/{action}')
    async def transition(company:str,ident:str,action:str,request:Request,session=Depends(native_session)):
        ctx=service.context(session,company);form=await request.json()
        if action=='activate':return await service.activate(ctx,ident,form)
        need(action in('pause','resume'),'ACTION_NOT_FOUND',404);exact(form,('expectedRevision',))
        return await service.transition(ctx,ident,form['expectedRevision'],action)
    @router.delete(base+'/loops/{ident}')
    async def remove(company:str,ident:str,request:Request,session=Depends(native_session)):
        form=await request.json();exact(form,('expectedRevision',));return await service.transition(service.context(session,company),ident,form['expectedRevision'],'remove')
    @router.get('/api/v1/starli/social/oauth/return')
    def returned(request:Request):
        items=list(request.query_params.multi_items());need(len(items)==len({k for k,v in items})and len(request.url.query)<=8192,'OAUTH_RETURN_INVALID',422)
        return RedirectResponse(oauth.receive(dict(items)),status_code=303,headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})
    @router.post('/api/v1/starli/social/oauth/complete')
    async def complete(request:Request,session=Depends(native_session)):
        form=await request.json();exact(form,('handoff',));return await oauth.complete(session,form['handoff'])
    @router.post('/api/v1/starli/social/internal/effect-fence')
    async def fence(request:Request):return service.verify_effect(await request.body(),request.headers,fence_key)
    return router

class OAuthLogFilter(logging.Filter):
    def filter(self,record):
        args=record.args
        if isinstance(args,tuple)and len(args)>=3 and isinstance(args[2],str)and args[2].split('?',1)[0]=='/api/v1/starli/social/oauth/return':
            values=list(args);values[2]=values[2].split('?',1)[0];record.args=tuple(values)
        return True
