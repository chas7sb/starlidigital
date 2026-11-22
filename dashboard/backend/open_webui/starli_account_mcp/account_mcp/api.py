"""Unmounted native-injected account MCP HTTP API."""
from fastapi import APIRouter,Depends,HTTPException,Request,Query
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel,ConfigDict,Field
from .registry import Fault
PRIVATE={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
class Strict(BaseModel):model_config=ConfigDict(extra="forbid",strict=True)
class Create(Strict):
 name:str=Field(min_length=1,max_length=100)
 url:str=Field(max_length=2048)
 transport:str
 credential:str|None=Field(default=None,max_length=8192,repr=False)
class Revision(Strict):expectedRevision:int=Field(ge=1,le=2**53-1)
class Update(Revision):
 name:str|None=Field(default=None,min_length=1,max_length=100)
 url:str|None=Field(default=None,max_length=2048)
 transport:str|None=None
 credential:str|None=Field(default=None,max_length=8192,repr=False)
def create_router(registry_factory,authenticate,capture_fence,remote_adapter=None):
 class PrivateRoute(APIRoute):
  def get_route_handler(self):
   original=super().get_route_handler()
   async def handle(request):
    try:
     if request.method in ("POST","PATCH","DELETE"):
      body=bytearray()
      async for chunk in request.stream():
       if len(body)+len(chunk)>32768:raise HTTPException(413,"MCP_REQUEST_LIMIT")
       body.extend(chunk)
      request._body=bytes(body)
     result=await original(request);result.headers.update(PRIVATE);return result
    except RequestValidationError:
     return JSONResponse({"detail":"MCP_ARGUMENTS_INVALID"},status_code=422,headers=PRIVATE)
    except HTTPException as error:
     error.headers={**(error.headers or {}),**PRIVATE};raise
   return handle
 router=APIRouter(route_class=PrivateRoute)
 def context(request,user):
  fence=capture_fence(request,user);fresh=fence.check()
  owner=fresh.get("id")if isinstance(fresh,dict)else getattr(fresh,"id",None)
  if not isinstance(owner,str)or not owner:raise HTTPException(403,"MCP_ACCOUNT_DENIED",headers=PRIVATE)
  try:return owner,fence,registry_factory(fresh,fence)
  except Fault as error:raise HTTPException(error.status,error.code,headers=PRIVATE)from None
 def response(fn):
  try:return JSONResponse(fn(),headers=PRIVATE)
  except Fault as error:raise HTTPException(error.status,error.code,headers=PRIVATE)from None
 @router.get("/capabilities")
 def capabilities(request:Request,user=Depends(authenticate)):
  context(request,user)
  remote_ready = remote_adapter is not None and getattr(remote_adapter,"available",False) is True
  return JSONResponse({"version":"starli.account-mcp.v1","accountWide":True,"maxServerCount":None,"pageLimit":50,"transports":{"streamable-http":remote_ready,"sse":remote_ready,"stdio":False},"remoteConnected":remote_ready},headers=PRIVATE)
 @router.get("/servers")
 def listing(request:Request,after:str=Query(default="",max_length=180),limit:int=Query(default=50,ge=1,le=50),user=Depends(authenticate)):
  owner,fence,r=context(request,user);return response(lambda:r.list(owner,after=after,limit=limit))
 @router.post("/servers")
 def create(body:Create,request:Request,user=Depends(authenticate)):
  owner,fence,r=context(request,user);return response(lambda:r.create(owner,body.model_dump()))
 @router.get("/servers/{ident}")
 def get(ident:str,request:Request,user=Depends(authenticate)):
  owner,fence,r=context(request,user);return response(lambda:r.get(owner,ident))
 @router.patch("/servers/{ident}")
 def update(ident:str,body:Update,request:Request,user=Depends(authenticate)):
  owner,fence,r=context(request,user)
  return response(lambda:r.mutate(owner,ident,body.expectedRevision,body.model_dump(exclude_unset=True,exclude={"expectedRevision"})))
 @router.delete("/servers/{ident}")
 def delete(ident:str,body:Revision,request:Request,user=Depends(authenticate)):
  owner,fence,r=context(request,user)
  def remove():
   r.mutate(owner,ident,body.expectedRevision,delete=True);return {"deleted":True,"id":ident}
  return response(remove)
 @router.post("/servers/{ident}/enable")
 def enable(ident:str,body:Revision,request:Request,user=Depends(authenticate)):
  owner,fence,r=context(request,user);return response(lambda:r.mutate(owner,ident,body.expectedRevision,enabled=True))
 @router.post("/servers/{ident}/disable")
 def disable(ident:str,body:Revision,request:Request,user=Depends(authenticate)):
  owner,fence,r=context(request,user);return response(lambda:r.mutate(owner,ident,body.expectedRevision,enabled=False))
 async def probe(ident,body,request,user,persist):
  owner,fence,r=context(request,user)
  if remote_adapter is None or getattr(remote_adapter,"available",True)is not True:raise HTTPException(503,"MCP_TRANSPORT_UNAVAILABLE",headers=PRIVATE)
  try:
   configuration=r.connection(owner,ident,body.expectedRevision)
   def recheck():
    fence.check();r.connection(owner,ident,body.expectedRevision)
   tools=await remote_adapter.discover(configuration,recheck)
   recheck()
   if persist:return JSONResponse({"server":r.record_discovery(owner,ident,body.expectedRevision,tools),"tested":True},headers=PRIVATE)
   return JSONResponse({"tested":True,"id":ident,"revision":body.expectedRevision,"toolCount":len(tools)},headers=PRIVATE)
  except Fault as error:raise HTTPException(error.status,error.code,headers=PRIVATE)from None
 @router.post("/servers/{ident}/test")
 async def test(ident:str,body:Revision,request:Request,user=Depends(authenticate)):
  return await probe(ident,body,request,user,False)
 @router.post("/servers/{ident}/discover")
 async def discover(ident:str,body:Revision,request:Request,user=Depends(authenticate)):
  return await probe(ident,body,request,user,True)
 return router
