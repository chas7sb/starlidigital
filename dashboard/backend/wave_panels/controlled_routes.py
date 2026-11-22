"""Optional controlled-test routes only. Caller constructs with startup flag, not request data."""
from fastapi import APIRouter,Depends,Request,HTTPException
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
import json
def create_controlled_router(rpc,verified_user,mutation_guard,capture_fence,*,enabled=False):
 router=APIRouter()
 if enabled is not True:return router
 @router.post('/api/v1/companies/{company}/email-studio/{rid}/controlled-send')
 async def send(request:Request,company:str,rid:str,user=Depends(verified_user)):
  mutation_guard(request);fence=capture_fence(request,user);raw=await request.body()
  if len(raw)>4096:raise HTTPException(413,'Request too large')
  try:body=json.loads(raw)
  except Exception:raise HTTPException(400,'Invalid controlled request')
  if not isinstance(body,dict) or set(body)!={'expectedRevision','approvalId'} or type(body['expectedRevision']) is not int or body['expectedRevision']<1 or not isinstance(body['approvalId'],str) or not 0<len(body['approvalId'])<=100:raise HTTPException(400,'Invalid controlled request')
  result=await run_in_threadpool(rpc.call,'controlled-send',user.id,company,rid,body);fence.check();return JSONResponse(result,headers={'Cache-Control':'no-store'})
 @router.post('/api/v1/companies/{company}/email-studio/{rid}/controlled-state')
 async def state(request:Request,company:str,rid:str,user=Depends(verified_user)):
  mutation_guard(request);fence=capture_fence(request,user)
  if (await request.body()).strip() not in (b'',b'{}'):raise HTTPException(400,'Invalid state request')
  result=await run_in_threadpool(rpc.call,'controlled-state',user.id,company,rid,{});fence.check();return JSONResponse(result,headers={'Cache-Control':'no-store'})
 return router
