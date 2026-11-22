from contextlib import contextmanager
from fastapi import APIRouter,Depends,HTTPException,Request
from pydantic import BaseModel,ConfigDict
from .pilot_onboarding import Pilot,Conflict
from . import Forbidden,Authority
class Strict(BaseModel):model_config=ConfigDict(extra='forbid')
class Company(Strict):
 company_id:str|None=None
 name:str|None=None
class Admit(Strict):bot_id:str
class Choice(Strict):
 model:str
 expected_revision:int
def build_router(verified_user,capture_fence,mutation_guard,path):
 router=APIRouter()
 def invoke(fn):
  try:return fn()
  except Forbidden as e:raise HTTPException(403,str(e))
  except Conflict as e:raise HTTPException(409,str(e))
  except ValueError as e:raise HTTPException(400,str(e))
 def fence(request,user,mutation=True):
  if mutation:mutation_guard(request)
  value=capture_fence(request,user);value.check();return value
 @router.post('/company')
 def company(body:Company,request:Request,user=Depends(verified_user)):
  f=fence(request,user)
  result=invoke(lambda:Pilot(path).company(f.check().id,request.headers.get('idempotency-key'),body.company_id,body.name));f.check();return result
 @router.post('/{company}/admit-bot')
 def admit(company:str,body:Admit,request:Request,user=Depends(verified_user)):
  f=fence(request,user)
  result=invoke(lambda:Pilot(path).admit_bot(f.check().id,company,body.bot_id,request.headers.get('idempotency-key')));f.check();return result
 def provider_call(fn):
  try:return fn()
  except Exception as e:
   if type(e).__name__=='Denied':raise HTTPException(409 if str(e)=='SELECTION_CONFLICT' else 403,str(e)) from None
   raise
 @contextmanager
 def providers(request):
  runtime=getattr(request.app.state,'company_bot_runtime',None)
  service=getattr(runtime,'providers',None)
  if service is None:raise HTTPException(503,'company provider runtime not installed')
  authority=Authority(path)
  def require_bot(company,bot):
   row=authority.db.execute("SELECT id,kind,owner,revision,active FROM bots WHERE id=?",(bot,)).fetchone()
   if not row:raise Forbidden('bot unavailable')
   return dict(zip(['id','kind','owner','revision','active'],row))
  try:yield type(service)(service.path,service.cipher,authority,require_bot,service.catalog,service.authenticate)
  finally:authority.db.close()
 @router.get('/{company}/bots/{bot}/provider-options')
 def options(company:str,bot:str,request:Request,user=Depends(verified_user)):
  f=fence(request,user,False)
  with providers(request) as service:
   result=provider_call(lambda:service.options(f.check().id,company,bot));f.check();return result
 @router.put('/{company}/bots/{bot}/self-hosted')
 def hosted(company:str,bot:str,body:Choice,request:Request,user=Depends(verified_user)):
  f=fence(request,user);actor=f.check().id
  with providers(request) as service:
   # No client URLs/credentials/provider fallback. Server catalog validates model.
   # A retry of the already committed exact selection reuses the revision.
   try:current=provider_call(lambda:service.public_selection(actor,company,bot))
   except HTTPException as e:
    if e.detail!='COMPANY_SELECTION_REQUIRED':raise
    current=None
   if not (current and current['provider']=='hosted' and current['model']==body.model and current['configurationRevision']==body.expected_revision+1 and current['updatedBy']==actor):
    provider_call(lambda:service.choose(actor,company,bot,None,body.model,body.expected_revision))
   f.check();return provider_call(lambda:service.public_selection(actor,company,bot))
 return router
