"""Explicit company-owned OpenRouter credentials and canonical persisted bot turns."""
import asyncio,base64,hashlib,hmac,json,re,time
from pathlib import Path
from fastapi import HTTPException
MODEL='nvidia/nemotron-3-ultra-550b-a55b:free'

class ProviderFailure(Exception):pass

def validate_credential(provider,credential):
 if provider!='openrouter' or not isinstance(credential,dict) or set(credential)!={'apiKey'}:raise ProviderFailure('OPENROUTER_KEY_REQUIRED')
 key=credential['apiKey']
 if not isinstance(key,str) or not key.startswith('sk-or-v1-') or not 20<=len(key)<=1024 or any(c.isspace() for c in key):raise ProviderFailure('OPENROUTER_KEY_INVALID')
 return True

async def provider_complete(selection,messages,instructions):
 import aiohttp
 credential=selection.get('credential');validate_credential(selection.get('provider'),credential)
 if selection.get('model')!=MODEL:raise ProviderFailure('FREE_MODEL_REQUIRED')
 if len(messages)>32 or sum(len(m.get('content','')) for m in messages)>48000:raise ProviderFailure('PROVIDER_CONTEXT_LIMIT')
 if any(m.get('role') not in ('user','assistant') or not isinstance(m.get('content'),str) for m in messages):raise ProviderFailure('PROVIDER_HISTORY_INVALID')
 body={'model':MODEL,'messages':[{'role':'system','content':instructions[:16000]}]+messages,'max_tokens':2048,'stream':False,'reasoning':{'enabled':False,'exclude':True},'provider':{'allow_fallbacks':False,'max_price':{'prompt':0,'completion':0}}}
 try:
  async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=90),trust_env=False) as client:
   async with client.post('https://openrouter.ai/api/v1/chat/completions',headers={'Authorization':'Bearer '+credential['apiKey'],'Content-Type':'application/json','X-Title':'Starli local company'},json=body,allow_redirects=False) as response:
    if response.status!=200:raise ProviderFailure('OPENROUTER_HTTP_'+str(response.status))
    raw=bytearray()
    async for chunk in response.content.iter_chunked(16384):
     raw.extend(chunk)
     if len(raw)>262144:raise ProviderFailure('PROVIDER_OUTPUT_LIMIT')
    data=json.loads(raw)
 except (aiohttp.ClientError,asyncio.TimeoutError):raise ProviderFailure('PROVIDER_RESULT_UNCERTAIN_NO_RETRY')from None
 except (ValueError,TypeError):raise ProviderFailure('PROVIDER_RESPONSE_INVALID')from None
 if not isinstance(data,dict) or not isinstance(data.get('choices'),list) or not data['choices'] or not isinstance(data['choices'][0],dict):raise ProviderFailure('PROVIDER_RESPONSE_INVALID')
 choice=data['choices'][0];message=choice.get('message');usage=data.get('usage')or{}
 if not isinstance(message,dict) or not isinstance(usage,dict) or not isinstance(usage.get('cost',0),(int,float)):raise ProviderFailure('PROVIDER_RESPONSE_INVALID')
 answer=message.get('content')
 if data.get('error') or not isinstance(answer,str) or not answer.strip():raise ProviderFailure('PROVIDER_EMPTY_RESPONSE')
 if not isinstance(data.get('id'),str) or not data['id'].strip() or len(data['id'])>180:raise ProviderFailure('PROVIDER_RECEIPT_REQUIRED')
 if choice.get('finish_reason')=='length':raise ProviderFailure('PROVIDER_OUTPUT_LIMIT')
 if str(data.get('model','')).removesuffix(':free')!=MODEL.removesuffix(':free'):raise ProviderFailure('PROVIDER_MODEL_MISMATCH')
 if usage.get('cost',0)>0:raise ProviderFailure('PROVIDER_FREE_BILLING_MISMATCH')
 receipt={'executionClass':'ACTUAL_PROVIDER','provider':'openrouter','model':MODEL,'status':'completed','responseId':str(data.get('id',''))[:180],
  'usage':{k:v for k,v in usage.items() if k in ('prompt_tokens','completion_tokens','total_tokens','cost') and isinstance(v,(int,float))},'paidFallback':False,'completedAt':time.time()}
 return {'answer':answer.strip()[:16000],'receipt':receipt,'provider':'openrouter','model':MODEL}

def install(app,ns,state,store,origin):
 import sys
 sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'dashboard/backend/starli_company_computer/runtime'))
 from company_bot_runtime.company_providers import CompanyProviders
 from company_bot_runtime.company_provider_api import create_router
 from company_bot_runtime.core import Runtime
 from company_bot_runtime.router import mount
 from company_messaging.authority import require
 from open_webui.utils.auth import get_verified_user
 from open_webui.routers.starli_session_fence import capture_request_fence
 from open_webui.routers.starli_v3_native import _mutation_guard
 from starli_memory.install_agent_profiles import install_profiles
 from open_webui.company_authority import Forbidden
 from cryptography.fernet import Fernet
 import starli_private_fs as private
 class Authority(ns.RbacAuthority):
  def __init__(self,path):self.path=str(path)
  def require_member(self,*args,**kwargs):
   if hasattr(self,'db'):return super().require_member(*args,**kwargs)
   a=ns.RbacAuthority(self.path)
   try:return a.require_member(*args,**kwargs)
   finally:a.db.close()
 authority=Authority(ns.paths.authority)
 def require_bot(company,bot):
  a=ns.RbacAuthority(str(ns.paths.authority))
  try:
   row=a.db.execute("SELECT id,kind,owner,revision,active FROM bots WHERE id=?",(bot,)).fetchone()
   if not row:return False
   return dict(zip(('id','kind','owner','revision','active'),row))
  finally:a.db.close()
 vault=state/'data/company-providers.sqlite';private.ensure_private_database(vault)
 key=base64.urlsafe_b64encode(hmac.new((state/'session.key').read_bytes(),b'local-company-provider-vault-v1',hashlib.sha256).digest())
 providers=CompanyProviders(str(vault),Fernet(key),authority,require_bot,lambda p:[MODEL] if p=='openrouter' else [],validate_credential,hosted_available=lambda company:False)
 providers.initialize()
 class LocalRuntime(Runtime):
  async def complete_for_bot(self,session,company,bot,messages,*,instructions=None,context=None,run_id=None):
   from company_messaging.context import revalidate
   require(callable(getattr(session,'revalidate',None)) and session.revalidate() is True,403,'NATIVE_SESSION_REQUIRED')
   if context is not None:revalidate(self.store,session,context)
   authority.require_member(session.user_id,company,permission='bots.run');authority.require_member(bot,company,permission='bots.run')
   selection=providers.capture(session.user_id,company,bot)
   profile=self.agent_profiles.read(session.user_id,company,bot)
   text='You are '+profile['name']+', an AI teammate in this company. '+profile['instructions']+'\nOnly claim actions supported by supplied platform receipts. Do not invent execution, browsing, messages or files. Keep text replies concise, under 600 words; return only exact JSON when the task explicitly requires JSON.'
   if instructions:text+='\n'+instructions[:8000]
   result=await provider_complete(selection,messages,text)
   require(session.revalidate() is True,403,'NATIVE_SESSION_REQUIRED');providers.check(selection)
   if context is not None:revalidate(self.store,session,context)
   if context is not None:
    with self.store.access(session,company,context.room_id) as(db,_,_):
     db.execute('INSERT OR IGNORE INTO local_provider_invocations VALUES(?,?,?,?,?,?,?)',(result['receipt']['responseId'],company,context.room_id,bot,session.user_id,run_id,json.dumps(result['receipt'])))
   result['configurationRevision']=selection['configurationRevision'];return result
  async def _run(self,session,ctx,selection,turn,prompt,history):
   try:
    self._state(session,ctx,selection,turn,'RUNNING')
    result=await self.complete_for_bot(session,ctx.company_id,ctx.bot_id,history+[{'role':'user','content':prompt}],context=ctx,run_id=turn)
    self.fence(session,ctx,selection);self._delta(session,ctx,selection,turn,result['answer'])
    with self.store.access(session,ctx.company_id,ctx.room_id) as(db,_,_):
     self.local_fence(db,ctx)
     db.execute('INSERT INTO local_provider_receipts VALUES(?,?,?,?,?)',(turn,ctx.company_id,ctx.room_id,ctx.bot_id,json.dumps(result['receipt'])))
    self._state(session,ctx,selection,turn,'ANSWERED')
   except BaseException as e:
    state='CANCELLED' if isinstance(e,asyncio.CancelledError) else 'FAILED'
    code='TURN_CANCELLED' if state=='CANCELLED' else str(e) if re.fullmatch(r'[A-Z][A-Z0-9_]{1,99}',str(e)) else 'LOCAL_MODEL_TURN_FAILED'
    with self.store.db() as db:self._set_state(db,turn,state,code)
 runtime=LocalRuntime(store,providers,None,authority,None,None)
 with store.db() as db:
  db.execute('CREATE TABLE IF NOT EXISTS local_provider_receipts(turn TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,bot TEXT NOT NULL,receipt TEXT NOT NULL)')
  db.execute('CREATE TABLE IF NOT EXISTS local_provider_invocations(response TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,bot TEXT NOT NULL,actor TEXT NOT NULL,run TEXT,receipt TEXT NOT NULL)')
 install_profiles(app,runtime,str(ns.paths.authority),get_verified_user,capture_request_fence,_mutation_guard,ns.RbacAuthority,Forbidden)
 runtime.recover();mount(app,runtime,app.state.company_messaging_session)
 app.include_router(create_router(providers,get_verified_user))
 app.state.local_model_runtime=runtime;app.state.local_company_providers=providers;app.state.local_complete_for_bot=runtime.complete_for_bot
 async def start_turn(session,audience,source,key):return await runtime.start_from_message(session,audience.company_id,audience.room_id,audience.bot_id,key,source['id'])
 app.state.company_messaging_start_turn=start_turn
 app.state.company_messaging_authorize_run=lambda db,value:runtime.authorize_run({'id':value.actor_id},value.company_id,value.bot_id,value.room_id,value.run_id)
 from fastapi import Depends,Request
 @app.get('/api/v1/companies/{company}/rooms/{room}/bots/{bot}/runs/{turn}/receipt')
 def receipt(company:str,room:str,bot:str,turn:str,session=Depends(app.state.company_messaging_session)):
  value=runtime.turn(session,company,room,turn)
  if value['botId']!=bot:raise HTTPException(404,'TURN_NOT_FOUND')
  with store.access(session,company,room,readonly=True) as(db,_,_):row=db.execute('SELECT receipt FROM local_provider_receipts WHERE turn=? AND company=? AND room=? AND bot=?',(turn,company,room,bot)).fetchone()
  return {'run':value,'receipt':json.loads(row[0]) if row else None}
 @app.get('/api/v1/companies/{company}/rooms/{room}/model-receipts')
 def model_receipts(company:str,room:str,runId:str,session=Depends(app.state.company_messaging_session)):
  with store.access(session,company,room,readonly=True) as(db,_,_):
   rows=db.execute('SELECT bot,receipt FROM local_provider_invocations WHERE company=? AND room=? AND run=? ORDER BY rowid LIMIT 32',(company,room,runId)).fetchall()
  return {'runId':runId,'receipts':[{'botId':r['bot'],**json.loads(r['receipt'])} for r in rows]}
 return runtime,providers
