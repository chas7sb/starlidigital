"""Read-only native company preflight. No arbitrary HTTP tool execution endpoint."""
from .core import ToolFault,require

def preflight(runtime,session,company,room,bot,request=None):
 from company_messaging.context import capture,revalidate
 ctx=capture(runtime.store,session,company,room,bot)
 for who in (ctx.actor_id,ctx.bot_id):runtime.authority.require_member(who,company,permission='tools.dispatch')
 tools=runtime.company_tools.catalogue(runtime,ctx)
 from .existing import descriptors
 tools+=descriptors(runtime,ctx)
 unavailable=list(runtime.company_tools.unavailable)
 if not any(t['origin']=='public-research'for t in tools)and not any(u['family']=='public-research'for u in unavailable):unavailable.append({'family':'public-research','reason':'RESTRICTED_RESEARCH_GATEWAY_NOT_READY'})
 # These existing mixins admit tools only inside a real RUNNING turn. Never
 # manufacture a turn or use model inference to populate a picker.
 for family,configured in [('company-memory',callable(getattr(runtime,'_memory_fence',None))),('company-email',bool(getattr(runtime,'email_draft',None)or getattr(runtime,'email_review',None))),('company-computer',bool(getattr(runtime,'computer_status',None)or getattr(runtime,'computer_display_note',None)))]:
  unavailable.append({'family':family,'reason':'EXISTING_RUNTIME_REQUIRES_RUN_ADMISSION'if configured else'EXECUTOR_NOT_CONFIGURED'})
 mcp=getattr(runtime,'company_mcp',None)
 account=mcp.preflight(runtime,session,ctx,request)if mcp else {'ownership':'account-owner','companyOwned':False,'consentRequired':True,'available':False,'reason':'COMPANY_ACCOUNT_DELEGATION_NOT_CONFIGURED'}
 tools+=account.get('tools',[])
 revalidate(runtime.store,session,ctx)
 return {'version':'starli.company-tools.v1','phase':'preflight','companyId':company,'conversationId':room,'botId':bot,'tools':tools,'unavailable':unavailable,'accountMcp':account}

def make_router(runtime,native_session):
 from fastapi import APIRouter,Depends,HTTPException,Request,Body
 from fastapi.routing import APIRoute
 class PrivateRoute(APIRoute):
  def get_route_handler(self):
   original=super().get_route_handler()
   async def private(request):
    response=await original(request);response.headers['Cache-Control']='no-store';return response
   return private
 router=APIRouter(prefix='/api/v1/companies/{companyId}/bots/{botId}',route_class=PrivateRoute)
 @router.get('/tools')
 def catalogue(companyId:str,botId:str,conversationId:str,request:Request,session=Depends(native_session)):
  try:return preflight(runtime,session,companyId,conversationId,botId,request)
  except Exception as e:
   status=getattr(e,'status',None);code=getattr(e,'code',None)
   if isinstance(status,int)and isinstance(code,str):raise HTTPException(status,code)from None
   if type(e).__name__ in ('Forbidden','Denied'):raise HTTPException(403,'COMPANY_TOOL_ACCESS_DENIED')from None
   raise
 def scoped(session,company,room,bot):
  from company_messaging.context import capture
  require(getattr(runtime,'company_mcp',None)is not None,'COMPANY_ACCOUNT_DELEGATION_NOT_CONFIGURED',503)
  ctx=capture(runtime.store,session,company,room,bot)
  for who in (ctx.actor_id,ctx.bot_id):
   runtime.authority.require_member(who,company,permission='tools.dispatch');runtime.authority.require_member(who,company,permission='integrations.run')
  return ctx
 def failure(e):
  status=getattr(e,'status',None);code=getattr(e,'code',None)
  if isinstance(status,int)and isinstance(code,str):raise HTTPException(status,code)from None
  if type(e).__name__ in ('Forbidden','Denied'):raise HTTPException(403,'COMPANY_TOOL_ACCESS_DENIED')from None
  raise e
 @router.post('/mcp-consents')
 def consent(companyId:str,botId:str,request:Request,form:dict=Body(...),session=Depends(native_session)):
  try:
   require(isinstance(form.get('conversationId'),str),'COMPANY_MCP_CONSENT_INVALID',422)
   ctx=scoped(session,companyId,form['conversationId'],botId);return runtime.company_mcp.consent(runtime,session,ctx,request,form)
  except Exception as e:failure(e)
 @router.get('/mcp-always-grants')
 def always_grants(companyId:str,botId:str,conversationId:str,session=Depends(native_session)):
  try:return runtime.company_mcp.always.list(runtime,session,scoped(session,companyId,conversationId,botId))
  except Exception as e:failure(e)
 @router.post('/mcp-always-grants')
 def always_grant(companyId:str,botId:str,request:Request,form:dict=Body(...),session=Depends(native_session)):
  try:
   require(type(form)is dict and type(form.get('conversationId'))is str,'COMPANY_MCP_ALWAYS_APPROVAL_INVALID',422)
   ctx=scoped(session,companyId,form['conversationId'],botId)
   return runtime.company_mcp.always.approve(runtime,session,ctx,request,form)
  except Exception as e:failure(e)
 @router.delete('/mcp-always-grants/{grantId}')
 def always_revoke(companyId:str,botId:str,grantId:str,conversationId:str,session=Depends(native_session)):
  try:return runtime.company_mcp.always.revoke(runtime,session,scoped(session,companyId,conversationId,botId),grantId)
  except Exception as e:failure(e)
 @router.delete('/mcp-consents/{consentId}')
 def revoke(companyId:str,botId:str,consentId:str,conversationId:str,session=Depends(native_session)):
  try:return runtime.company_mcp.revoke(runtime,session,scoped(session,companyId,conversationId,botId),consentId)
  except Exception as e:failure(e)
 return router
