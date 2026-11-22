import json,os,stat
from fastapi import APIRouter,Depends,Request,HTTPException
from fastapi.responses import JSONResponse
from email_socket_client import EmailStudioSocketRPC,UnixHTTPConnection

class ProductRPC(EmailStudioSocketRPC):
 def call(self,operation,actor,company,rid,payload):
  if operation not in ('list','read','edit','generate','preview','review','approve'):raise HTTPException(404,'Unavailable')
  params=dict(actorId=actor,companyId=company,resourceId=rid,**payload);raw=json.dumps(dict(method='email.'+operation,params=params)).encode()
  if len(raw)>256*1024:raise HTTPException(413,'Request too large')
  connection=None
  try:
   info=os.lstat(self.socket_path)
   if not stat.S_ISSOCK(info.st_mode) or info.st_mode&0o077:raise OSError('private socket required')
   connection=UnixHTTPConnection(self.socket_path,self.timeout);connection.request('POST','/rpc',raw,{'Authorization':'Bearer '+self._secret(),'Content-Type':'application/json'})
   response=connection.getresponse();body=response.read(1024*1024+1)
   if len(body)>1024*1024:raise OSError('response limit')
   value=json.loads(body)
   if response.status!=200:raise HTTPException(response.status if response.status in (400,403,409,413) else 503,value.get('error',{}).get('message','Email unavailable'))
   if value.get('ok') is not True:raise OSError('invalid response')
   return value['result']
  except HTTPException:raise
  except Exception:raise HTTPException(503,'Email service unavailable')
  finally:
   if connection:connection.close()

def create_router(rpc,verified_user,mutation_guard,capture_fence):
 router=APIRouter()
 @router.get('/api/v1/companies/{company}/email-studio')
 async def discovery(request:Request,company:str,user=Depends(verified_user)):
  fence=capture_fence(request,user)
  from starlette.concurrency import run_in_threadpool
  value=await run_in_threadpool(rpc.call,'list',user.id,company,'',{});fence.check()
  return JSONResponse(value,headers={'Cache-Control':'no-store'})
 @router.get('/api/v1/companies/{company}/email-studio/{rid}')
 async def read(request:Request,company:str,rid:str,user=Depends(verified_user)):
  fence=capture_fence(request,user)
  from starlette.concurrency import run_in_threadpool
  value=await run_in_threadpool(rpc.call,'read',user.id,company,rid,{});fence.check()
  return JSONResponse(value,headers={'Cache-Control':'no-store'})
 @router.post('/api/v1/companies/{company}/email-studio/{rid}/{operation}')
 async def operation(request:Request,company:str,rid:str,operation:str,user=Depends(verified_user)):
  mutation_guard(request);fence=capture_fence(request,user)
  raw=await request.body()
  if len(raw)>256*1024:raise HTTPException(413,'Request too large')
  try:payload=json.loads(raw or b'{}')
  except Exception:raise HTTPException(400,'Invalid request')
  expected={'read':set(),'generate':set(),'edit':{'expectedRevision','document'},'preview':{'expectedRevision'},'review':{'expectedRevision'},'approve':{'expectedRevision','review'}}.get(operation)
  if expected is None:raise HTTPException(404,'Unavailable')
  if not isinstance(payload,dict) or set(payload)!=expected:raise HTTPException(400,'Invalid request')
  if 'expectedRevision' in payload and (type(payload['expectedRevision']) is not int or payload['expectedRevision']<1):raise HTTPException(400,'Invalid revision')
  # Blocking local service call is bounded and runs off the ASGI event loop.
  from starlette.concurrency import run_in_threadpool
  value=await run_in_threadpool(rpc.call,operation,user.id,company,rid,payload);fence.check()
  return JSONResponse(value,headers={'Cache-Control':'no-store'})
 return router
