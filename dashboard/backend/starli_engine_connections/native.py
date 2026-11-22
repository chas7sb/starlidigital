"""Admin-only bounded secret forms; bot tool accepts only installed type name."""
import starli_portable as _portable
import asyncio,json
from starli_automations.common import need,Fault
from .schema import VERSION

def install(app,runtime,service,*,allowed_origins=None):
 from fastapi import APIRouter,Depends,Request
 from fastapi.routing import APIRoute
 from fastapi.responses import JSONResponse
 from starli_company_tools.core import ToolSpec,obj
 need(not hasattr(app.state,'starli_engine_connections'),'ENGINE_CONNECTIONS_ALREADY_INSTALLED',409)
 origins=frozenset(allowed_origins or _portable.allowed_origins())
 need(bool(origins) and origins <= _portable.allowed_origins(),'CONNECTION_ORIGIN_CONFIG_INVALID',503)
 service.install_projection();gateway=service.gateway
 def request_connection(bound,args):
  bound.check();ctx=gateway.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope)
  return service.request(ctx,args['credentialType'])
 runtime.company_tools.register(ToolSpec('company_connection_request','Ask the authorized company administrator to connect an INSTALLED official credential type using a private native form on this exact assistant. You own this construction request. Never ask for secrets in chat. OAuth requires a configured platform application and cannot be invented. Credential storage does not prove provider identity or permission to run a node.',obj({'credentialType':{'type':'string','minLength':1,'maxLength':128}}),'write','starli-engine-connections',request_connection,'integrations.run'))
 class SafeRoute(APIRoute):
  def get_route_handler(self):
   handler=super().get_route_handler()
   async def safe(request):
    try:
     if request.method not in('GET','HEAD'):
      need(request.headers.get('authorization','').startswith('Bearer '),'NATIVE_BEARER_REQUIRED',401)
      need(request.headers.get('sec-fetch-site')!='cross-site','SAME_ORIGIN_REQUIRED')
      origin=request.headers.get('origin');need(origin is None or origin in origins,'SAME_ORIGIN_REQUIRED')
     async def read():
      body=bytearray()
      async for chunk in request.stream():body.extend(chunk);need(len(body)<=49152,'INPUT_LIMIT',413)
      return bytes(body)
     request._body=await asyncio.wait_for(read(),5)
     response=await handler(request)
    except Fault as error:response=JSONResponse(status_code=error.status,content={'detail':{'code':error.code}})
    except (ValueError,TypeError,TimeoutError):response=JSONResponse(status_code=422,content={'detail':{'code':'INVALID_CONNECTION_FORM'}})
    response.headers.update({'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});return response
   return safe
 router=APIRouter(prefix='/api/v1/starli/companies/{company}/engine-connections',route_class=SafeRoute)
 dep=app.state.company_messaging_session
 def context(principal,company,room):return gateway.context(principal,company,room)
 def parsed(raw):
  def unique(pairs):
   out={}
   for k,v in pairs:need(k not in out,'DUPLICATE_CONNECTION_FIELD',422);out[k]=v
   return out
  return json.loads(raw,object_pairs_hook=unique)
 @router.get('/types')
 def types(company:str,principal=Depends(dep)):return service.types(context(principal,company,None))
 @router.get('/schema/{credential_type}')
 async def schema(company:str,credential_type:str,conversationId:str,principal=Depends(dep)):
  return await service.schema(context(principal,company,conversationId),credential_type)
 @router.get('/requests/{ident}')
 def request(company:str,ident:str,conversationId:str,principal=Depends(dep)):return service.get(context(principal,company,conversationId),ident)
 @router.post('/requests/{ident}/submit')
 async def submit(company:str,ident:str,conversationId:str,request:Request,principal=Depends(dep)):
  return await service.submit(context(principal,company,conversationId),ident,parsed(await request.body()))
 @router.delete('/requests/{ident}')
 async def revoke(company:str,ident:str,conversationId:str,request:Request,principal=Depends(dep)):
  data=parsed(await request.body());need(type(data)is dict and set(data)=={'expectedRevision'},'CONNECTION_FORM_INVALID',422)
  return service.revoke(context(principal,company,conversationId),ident,data['expectedRevision'])
 index=next((i for i,r in enumerate(app.router.routes)if getattr(r,'path',None)==''),len(app.router.routes));app.router.routes[index:index]=router.routes
 app.state.starli_engine_connections=service;return service
