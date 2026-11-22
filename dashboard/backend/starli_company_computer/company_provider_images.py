"""Company auth choices and generated-image purpose using the existing vault."""
import asyncio,base64,hashlib,io,json,re,uuid,urllib.request
from pathlib import Path
from types import SimpleNamespace

class CompanyProviderImages:
 def __init__(self,providers,native):
  self.providers=providers;self.native=native
  with providers.db() as db:db.executescript('''CREATE TABLE IF NOT EXISTS company_connection_purposes(company TEXT NOT NULL,connection TEXT NOT NULL,purpose TEXT NOT NULL,auth_type TEXT NOT NULL,PRIMARY KEY(company,connection));CREATE TABLE IF NOT EXISTS company_image_selections(company TEXT PRIMARY KEY,connection TEXT NOT NULL);''')
  with native.store.db() as db:db.executescript('''CREATE TABLE IF NOT EXISTS company_generated_images(id TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,bot TEXT NOT NULL,run TEXT NOT NULL,call TEXT NOT NULL,state TEXT NOT NULL,file TEXT,message TEXT,UNIQUE(company,run,call));''')
 def deny(self,code):
  from company_bot_runtime.company_providers import Denied
  raise Denied(code)
 def image_metadata(self,actor,company):
  self.providers.fence(actor,company)
  with self.providers.db() as db:
   row=db.execute("SELECT c.id FROM company_image_selections s JOIN company_provider_connections c ON c.company=s.company AND c.id=s.connection JOIN company_connection_purposes p ON p.company=c.company AND p.connection=c.id WHERE s.company=? AND c.active=1 AND c.provider='openai' AND p.purpose='images'",(company,)).fetchone()
  return dict(configured=row is not None,connectionId=row['id'] if row else None,provider='openai',purpose='images',status='STORED_NOT_VERIFIED' if row else 'NOT_CONFIGURED')
 def connect_key(self,actor,company,provider,key,purpose):
  self.providers.fence(actor,company,permission='connections.manage')
  if type(key)is not str or not 8<=len(key)<=2048 or any(ch in key for ch in ('\n','\r','\x00')) or purpose not in ('images','inference') or purpose=='images' and provider!='openai':self.deny('COMPANY_KEY_INVALID')
  credential={'type':'api_key','key':key};models=self.providers.catalog(provider);refreshed=None
  if purpose=='inference' and callable(self.providers.refresh_models):
   try:refreshed=self.providers.refresh_models(provider,credential)
   except Exception:
    if not models:self.deny('COMPANY_MODEL_DISCOVERY_FAILED')
  if isinstance(refreshed,dict) and refreshed.get('models'):
   models=self.validate_models(refreshed['models']);credential=refreshed.get('credential',credential)
   if credential.get('type')!='api_key':self.deny('COMPANY_KEY_INVALID')
  elif not models:self.deny('COMPANY_MODEL_DISCOVERY_FAILED')
  if self.providers.catalog(provider) and self.providers.authenticate(provider,credential)is not True:self.deny('PROVIDER_AUTHENTICATION_FAILED')
  if any(key in model for model in models):self.deny('COMPANY_MODEL_CATALOG_INVALID')
  ident=str(uuid.uuid4());sealed=self.providers.cipher.encrypt(json.dumps(credential).encode())
  with self.providers.db() as db:
   self.providers.fence(actor,company,permission='connections.manage')
   db.execute('INSERT INTO company_provider_connections VALUES(?,?,?,?,1,1)',(company,ident,provider,sealed))
   db.execute('INSERT INTO company_connection_purposes VALUES(?,?,?,?)',(company,ident,purpose,'api_key'))
   if refreshed is not None:
    state=refreshed.get('modelsState') if isinstance(refreshed,dict) else None
    if len(json.dumps(state))>2097152:self.deny('COMPANY_MODEL_CATALOG_INVALID')
    db.execute('INSERT INTO company_provider_catalogs VALUES(?,?,?,?,?,?)',(company,ident,1,1,json.dumps(models),json.dumps(state) if state is not None else None))
   if purpose=='images':db.execute('INSERT INTO company_image_selections VALUES(?,?) ON CONFLICT(company) DO UPDATE SET connection=excluded.connection',(company,ident))
   self.providers.audit(db,company,actor,'connect_'+purpose+'_api_key',ident,1)
  return dict(companyId=company,connectionId=ident,purpose=purpose,models=models,revision=1,inferenceSelectionChanged=False)
 @staticmethod
 def validate_models(models):
  if type(models)is not list or not models or len(models)>20000 or any(type(model)is not str or not 0<len(model)<=180 or any(ord(c)<32 for c in model) for model in models):raise ValueError('COMPANY_MODEL_CATALOG_INVALID')
  return list(dict.fromkeys(models))
 def discover_endpoint(self,kind,base_url,key,configured=None):
  from urllib.parse import urlsplit,urlunsplit
  from open_webui.utils.safe_http import validate_target
  parsed=urlsplit(base_url)
  if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:self.deny('PUBLIC_HTTPS_ENDPOINT_REQUIRED')
  base=validate_target(base_url).rstrip('/')
  if kind=='ollama':
   root=base[:-3] if base.endswith('/v1') else base
   discovery=root+'/api/tags';api_base=root+'/v1'
  else:discovery=base+'/models';api_base=base
  headers={'Authorization':'Bearer '+key} if key else {}
  try:
   response=public_models_request(discovery,headers)
   if response.status!=200:raise ValueError('ENDPOINT_MODEL_DISCOVERY_FAILED')
   data=json.loads(response.body)
   models=[row['name'] for row in data.get('models',[]) if type(row)is dict and type(row.get('name'))is str] if kind=='ollama' else [row['id'] for row in data.get('data',[]) if type(row)is dict and type(row.get('id'))is str]
   models=self.validate_models(models)
   if configured:
    requested=self.validate_models(configured)
    if not set(requested)<=set(models):self.deny('ENDPOINT_MODEL_NOT_DISCOVERED')
    models=requested
   return api_base,models,'discovered'
  except Exception as error:
   # An explicit model list is configuration, not a successful discovery claim.
   # Always perform the pinned public-network request before allowing that path.
   from open_webui.utils.safe_http import SafeHTTPError
   if isinstance(error,SafeHTTPError):self.deny('PUBLIC_ENDPOINT_UNAVAILABLE_OR_BLOCKED')
   if configured:return api_base,self.validate_models(configured),'configured'
   self.deny('ENDPOINT_MODEL_DISCOVERY_FAILED')
 def connect_endpoint(self,actor,company,kind,base_url,key,model_ids,target_id=None):
  self.providers.fence(actor,company,permission='connections.manage')
  if target_id:self.deny('REGISTERED_COMPUTER_BRIDGE_NOT_AVAILABLE')
  if kind not in ('ollama','openai-compatible') or type(key)is not str or len(key)>2048 or any(ch in key for ch in ('\n','\r','\x00')):self.deny('ENDPOINT_CONFIGURATION_INVALID')
  if key and key in base_url:self.deny('ENDPOINT_CONFIGURATION_INVALID')
  base,models,source=self.discover_endpoint(kind,base_url,key,model_ids)
  if key and any(key in model for model in models):self.deny('COMPANY_MODEL_CATALOG_INVALID')
  if len(models)>2000:self.deny('COMPANY_MODEL_CATALOG_INVALID')
  ident=str(uuid.uuid4());provider='endpoint-'+ident
  credential=dict(type='api_key',key=key or ('ollama' if kind=='ollama' else 'no-key'),baseUrl=base,endpointKind=kind,models=models)
  with self.providers.db() as db:
   self.providers.fence(actor,company,permission='connections.manage')
   db.execute('INSERT INTO company_provider_connections VALUES(?,?,?,?,1,1)',(company,ident,provider,self.providers.cipher.encrypt(json.dumps(credential).encode())))
   db.execute('INSERT INTO company_connection_purposes VALUES(?,?,?,?)',(company,ident,'inference','api_key'))
   db.execute('INSERT INTO company_provider_catalogs VALUES(?,?,?,?,?,?)',(company,ident,1,1,json.dumps(models),None))
   self.providers.audit(db,company,actor,'connect_company_endpoint',ident,1)
  return dict(companyId=company,connectionId=ident,provider=provider,models=models,modelSource=source,revision=1,endpoint=dict(kind=kind,baseUrl=base),inferenceSelectionChanged=False)
 def refresh_endpoint(self,actor,company,connection,expected_revision):
  self.providers.fence(actor,company,permission='connections.manage')
  with self.providers.db() as db:
   row=db.execute('SELECT * FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
   if row is None or row['revision']!=expected_revision:self.deny('CONNECTION_CONFLICT')
   credential=json.loads(self.providers.cipher.decrypt(row['sealed']))
  base,models,source=self.discover_endpoint(credential['endpointKind'],credential['baseUrl'],credential['key'] if credential['key']not in ('ollama','no-key') else '')
  if credential['key']not in ('ollama','no-key') and any(credential['key']in model for model in models):self.deny('COMPANY_MODEL_CATALOG_INVALID')
  credential.update(baseUrl=base,models=models)
  with self.providers.db() as db:
   self.providers.fence(actor,company,permission='connections.manage')
   current=db.execute('SELECT revision FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
   if current is None or current['revision']!=expected_revision:self.deny('CONNECTION_CONFLICT')
   old=db.execute('SELECT revision FROM company_provider_catalogs WHERE company=? AND connection=?',(company,connection)).fetchone();revision=(old[0] if old else 0)+1
   db.execute('UPDATE company_provider_connections SET sealed=? WHERE company=? AND id=?',(self.providers.cipher.encrypt(json.dumps(credential).encode()),company,connection))
   db.execute('INSERT OR REPLACE INTO company_provider_catalogs VALUES(?,?,?,?,?,?)',(company,connection,revision,expected_revision,json.dumps(models),None))
  return dict(companyId=company,models=models,modelSource=source,catalogRevision=revision,connectionRevision=expected_revision)
 def connect_subscription(self,actor,company,provider,consent):
  self.providers.fence(actor,company,permission='connections.manage')
  if consent is not True:self.deny('COMPANY_ACCOUNT_CONSENT_REQUIRED')
  reference={'type':'company_account_reference','owner':actor,'company':company,'provider':provider}
  if self.providers._reference(actor,company,None,reference)is None:self.deny('ACCOUNT_REFERENCE_UNSUPPORTED')
  with self.providers.db() as db:
   self.providers.fence(actor,company,permission='connections.manage')
   rows=db.execute('SELECT id,sealed FROM company_provider_connections WHERE company=? AND provider=? AND active=1',(company,provider)).fetchall()
   for row in rows:
    if json.loads(self.providers.cipher.decrypt(row['sealed']))==reference:return dict(companyId=company,connectionId=row['id'],purpose='inference',inferenceSelectionChanged=False)
   ident=str(uuid.uuid4());db.execute('INSERT INTO company_provider_connections VALUES(?,?,?,?,1,1)',(company,ident,provider,self.providers.cipher.encrypt(json.dumps(reference).encode())))
   db.execute('INSERT INTO company_connection_purposes VALUES(?,?,?,?)',(company,ident,'inference','oauth'))
   self.providers.audit(db,company,actor,'connect_company_subscription',ident,1)
  return dict(companyId=company,connectionId=ident,purpose='inference',inferenceSelectionChanged=False)
 def image_key(self,actor,company):
  self.providers.fence(actor,company)
  with self.providers.db() as db:
   row=db.execute("SELECT c.* FROM company_image_selections s JOIN company_provider_connections c ON c.company=s.company AND c.id=s.connection WHERE s.company=? AND c.active=1 AND c.provider='openai'",(company,)).fetchone()
   if row is None:self.deny('COMPANY_IMAGE_KEY_REQUIRED')
   credential=json.loads(self.providers.cipher.decrypt(row['sealed']))
   if credential.get('type')!='api_key' or type(credential.get('key'))is not str:self.deny('COMPANY_IMAGE_KEY_REQUIRED')
   return row['id'],row['revision'],credential['key']
 def exclude_images_from_inference(self):
  original=self.providers.options;service=self
  def options(actor,company,bot):
   result=original(actor,company,bot)
   with service.providers.db() as db:ids={row[0] for row in db.execute("SELECT connection FROM company_connection_purposes WHERE company=? AND purpose='images'",(company,))}
   return [row for row in result if row.get('connectionId')not in ids]
  self.providers.options=options
  choose=self.providers.choose
  def guarded_choose(actor,company,bot,connection,model,expected_revision):
   with service.providers.db() as db:
    row=db.execute('SELECT purpose FROM company_connection_purposes WHERE company=? AND connection=?',(company,connection)).fetchone()
    if row and row[0]=='images':service.deny('IMAGE_CONNECTION_NOT_FOR_INFERENCE')
   return choose(actor,company,bot,connection,model,expected_revision)
  self.providers.choose=guarded_choose
  original_refresh=self.providers.refresh
  def refresh(actor,company,connection,expected_revision):
   with service.providers.db() as db:
    row=db.execute('SELECT provider FROM company_provider_connections WHERE company=? AND id=? AND active=1',(company,connection)).fetchone()
   if row and row['provider'].startswith('endpoint-'):return service.refresh_endpoint(actor,company,connection,expected_revision)
   result=original_refresh(actor,company,connection,expected_revision)
   return dict(result,companyId=company)
  self.providers.refresh=refresh

def public_models_request(url,headers):
 # Reuse the native pinned resolver without trusted_origin: that server-only
 # override intentionally permits private hosts and is unsafe for tenant URLs.
 async def fetch():
  import aiohttp
  from open_webui.utils.safe_http import PinnedResolver,validate_target,SafeHTTPError
  target=validate_target(url)
  connector=aiohttp.TCPConnector(resolver=PinnedResolver(False),use_dns_cache=False)
  try:
   async with aiohttp.ClientSession(connector=connector,cookie_jar=aiohttp.DummyCookieJar(),trust_env=False,timeout=aiohttp.ClientTimeout(total=20)) as session:
    async with session.get(target,headers=headers,allow_redirects=False) as response:
     raw=await response.content.read(2097153)
     if len(raw)>2097152:raise SafeHTTPError('Endpoint model response exceeds limit')
     return SimpleNamespace(status=response.status,body=raw)
  except SafeHTTPError:raise
  except Exception:raise SafeHTTPError('Public endpoint unavailable')from None
 try:asyncio.get_running_loop()
 except RuntimeError:return asyncio.run(fetch())
 from concurrent.futures import ThreadPoolExecutor
 with ThreadPoolExecutor(max_workers=1) as pool:return pool.submit(lambda:asyncio.run(fetch())).result(timeout=25)

def openai_image(key,prompt):
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):raise RuntimeError('IMAGE_PROVIDER_REDIRECT_DENIED')
 request=urllib.request.Request('https://api.openai.com/v1/images/generations',method='POST',headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},data=json.dumps(dict(model='gpt-image-2.5-sunburst',prompt=prompt,n=1,size='1024x1024',output_format='png')).encode())
 with urllib.request.build_opener(NoRedirect()).open(request,timeout=120) as response:raw=response.read(24*1024*1024+1)
 if len(raw)>24*1024*1024:raise RuntimeError('IMAGE_RESPONSE_LIMIT')
 result=json.loads(raw);items=result.get('data')
 if type(items)is not list or len(items)!=1 or type(items[0].get('b64_json'))is not str:raise RuntimeError('IMAGE_PROVIDER_OUTPUT_INVALID')
 data=base64.b64decode(items[0]['b64_json'],validate=True)
 if len(data)>16*1024*1024:raise RuntimeError('IMAGE_RESPONSE_LIMIT')
 # Re-encode only a bounded raster; no remote download, SVG, HTML or arbitrary file.
 from PIL import Image
 with Image.open(io.BytesIO(data)) as image:
  if image.format not in ('PNG','JPEG','WEBP') or image.width*image.height>16000000:raise RuntimeError('IMAGE_PROVIDER_OUTPUT_INVALID')
  image.load();out=io.BytesIO();image.convert('RGBA').save(out,format='PNG');return out.getvalue()

def install(app,runtime):
 from fastapi import APIRouter,Depends,Request,HTTPException
 from fastapi.responses import FileResponse
 from pydantic import BaseModel,Field,SecretStr
 from typing import Literal
 from starli_company_tools.core import ToolSpec,obj,require
 from company_bot_runtime.company_provider_api import SafeRoute
 from open_webui.routers.starli_providers import catalog
 from open_webui.routers.starli_v3_native import _mutation_guard
 providers=app.state.company_providers;native=app.state.starli_automations
 service=CompanyProviderImages(providers,native);service.exclude_images_from_inference()
 principal=app.state.company_messaging_session
 router=APIRouter(prefix='/api/v1/companies',route_class=SafeRoute)
 class KeyForm(BaseModel):
  provider:str=Field(min_length=1,max_length=180)
  authType:Literal['api_key']
  key:SecretStr
  purpose:Literal['inference','images']
  model_config={'extra':'forbid'}
 class SubscriptionForm(BaseModel):
  provider:str=Field(min_length=1,max_length=180)
  consentCompanyScope:bool=False
  model_config={'extra':'forbid'}
 def invoke(call):
  from company_bot_runtime.company_providers import Denied
  try:return call()
  except Denied as error:raise HTTPException(403,str(error))from None
  except Exception:raise HTTPException(503,'COMPANY_PROVIDER_SERVICE_UNAVAILABLE')from None
 async def auth_catalog(company,session):
  scope=invoke(lambda:providers.fence(session.user_id,company))
  from open_webui.routers.starli_providers import account
  data=await catalog();account_data=account(session.user_id);rows=[]
  for provider in data.get('providers',[]):
   methods=[{'type':method['type'],'label':method.get('label',method['type']),'interactive':method.get('interactive')is True} for method in provider.get('authMethods',[]) if method.get('type')in ('api_key','oauth')]
   if methods:rows.append(dict(id=provider['id'],name=provider.get('name',provider['id']),authMethods=methods,subscriptionAccountAvailable=(account_data.get('credentials',{}).get(provider['id']) or {}).get('type')=='oauth'))
  invoke(lambda:providers.fence(session.user_id,company))
  return dict(companyId=company,providers=rows,image=invoke(lambda:service.image_metadata(session.user_id,company)),canManage=scope.get('role')in ('owner','admin'),endpointKinds=['ollama','openai-compatible'])
 @router.get('/{company}/provider-auth-methods')
 async def methods(company:str,session=Depends(principal)):
  return await auth_catalog(company,session)
 @router.post('/{company}/provider-credentials')
 async def connect(company:str,form:KeyForm,request:Request,session=Depends(principal)):
  _mutation_guard(request)
  known=await auth_catalog(company,session)
  if not any(row['id']==form.provider and any(method['type']=='api_key' for method in row['authMethods']) for row in known['providers']):raise HTTPException(422,'API_KEY_AUTH_NOT_SUPPORTED_BY_SDK')
  return await asyncio.to_thread(invoke,lambda:service.connect_key(session.user_id,company,form.provider,form.key.get_secret_value(),form.purpose))
 class EndpointForm(BaseModel):
  kind:Literal['ollama','openai-compatible']
  baseUrl:str=Field(min_length=8,max_length=2048)
  apiKey:SecretStr|None=None
  modelIds:list[str]|None=None
  targetId:str|None=None
  model_config={'extra':'forbid'}
 @router.post('/{company}/provider-endpoints')
 def endpoint(company:str,form:EndpointForm,request:Request,session=Depends(principal)):
  _mutation_guard(request)
  return invoke(lambda:service.connect_endpoint(session.user_id,company,form.kind,form.baseUrl,form.apiKey.get_secret_value()if form.apiKey else '',form.modelIds,form.targetId))
 @router.post('/{company}/provider-subscription')
 async def subscription(company:str,form:SubscriptionForm,request:Request,session=Depends(principal)):
  _mutation_guard(request);known=await auth_catalog(company,session)
  if not any(row['id']==form.provider and any(method['type']=='oauth' for method in row['authMethods']) for row in known['providers']):raise HTTPException(422,'SUBSCRIPTION_AUTH_NOT_SUPPORTED_BY_SDK')
  return invoke(lambda:service.connect_subscription(session.user_id,company,form.provider,form.consentCompanyScope))

 # Delegate sign-in to the existing native Pi login process; bind its opaque
 # session to this company and requesting human on every poll/answer/cancel.
 company_logins={}
 class LoginForm(BaseModel):
  provider:str=Field(min_length=1,max_length=180)
  authType:Literal['oauth']
  consentCompanyScope:bool=False
  model_config={'extra':'forbid'}
 class LoginAnswer(BaseModel):
  promptId:str=Field(min_length=8,max_length=100)
  value:SecretStr
  model_config={'extra':'forbid'}
 def login_user(session):
  from open_webui.models.users import Users
  user=Users.get_user_by_id(session.user_id)
  if user is None or user.id!=session.user_id:raise HTTPException(403,'PROVIDER_LOGIN_OWNER_REVOKED')
  return user
 def owned_login(company,ident,session):
  invoke(lambda:providers.fence(session.user_id,company,permission='connections.manage'))
  entry=company_logins.get(ident)
  if entry is None or entry['company']!=company or entry['actor']!=session.user_id:raise HTTPException(404,'COMPANY_PROVIDER_LOGIN_NOT_FOUND')
  return entry
 async def login_result(company,ident,session):
  from open_webui.routers import starli_providers as personal
  entry=owned_login(company,ident,session)
  result=await personal.login_status(ident,user=login_user(session))
  owned_login(company,ident,session)
  public=dict(result,companyId=company,inferenceSelectionChanged=False)
  if result.get('status')=='CONNECTED':
   connected=invoke(lambda:service.connect_subscription(session.user_id,company,entry['provider'],True))
   public.update(connectionId=connected['connectionId'],purpose='inference')
  return public
 @router.post('/{company}/provider-logins')
 async def begin_login(company:str,form:LoginForm,request:Request,session=Depends(principal)):
  _mutation_guard(request)
  invoke(lambda:providers.fence(session.user_id,company,permission='connections.manage'))
  if form.consentCompanyScope is not True:raise HTTPException(403,'COMPANY_ACCOUNT_CONSENT_REQUIRED')
  known=await auth_catalog(company,session)
  if not any(row['id']==form.provider and any(method['type']=='oauth' and method['interactive'] for method in row['authMethods']) for row in known['providers']):raise HTTPException(422,'SUBSCRIPTION_AUTH_NOT_SUPPORTED_BY_SDK')
  from open_webui.routers import starli_providers as personal
  result=await personal.start_login(form.provider,personal.LoginBody(authType='oauth'),request,user=login_user(session))
  company_logins[result['id']]=dict(company=company,actor=session.user_id,provider=form.provider)
  return await login_result(company,result['id'],session)
 @router.get('/{company}/provider-logins/{ident}/status')
 async def login_status(company:str,ident:str,session=Depends(principal)):
  return await login_result(company,ident,session)
 @router.post('/{company}/provider-logins/{ident}/answer')
 async def login_answer(company:str,ident:str,form:LoginAnswer,request:Request,session=Depends(principal)):
  _mutation_guard(request);owned_login(company,ident,session)
  value=form.value.get_secret_value()
  if not 1<=len(value)<=20000:raise HTTPException(422,'PROVIDER_REQUEST_INVALID')
  from open_webui.routers import starli_providers as personal
  await personal.answer_login(ident,personal.AnswerBody(promptId=form.promptId,value=value),request,user=login_user(session))
  return await login_result(company,ident,session)
 @router.delete('/{company}/provider-logins/{ident}')
 async def login_cancel(company:str,ident:str,request:Request,session=Depends(principal)):
  _mutation_guard(request);owned_login(company,ident,session)
  from open_webui.routers import starli_providers as personal
  result=await personal.cancel_login(ident,request,user=login_user(session))
  return dict(result,companyId=company,inferenceSelectionChanged=False)

 # Existing attachment checker remains authoritative for every other file.
 original_attachment=native.store.authority._attachment
 def attachment(db,member,room,ident):
  row=db.execute("SELECT 1 FROM company_generated_images WHERE id=? AND company=? AND room=? AND state='COMPLETED'",(ident,member.company_id,room)).fetchone()
  if row:
   native.store.room(db,member,room);return dict(id=ident,url='/api/v1/companies/'+member.company_id+'/generated-images/'+ident+'/content',mimeType='image/png',name='Generated image.png',kind='image')
  return original_attachment(db,member,room,ident)
 native.store.authority._attachment=attachment

 def authorized_content(company,ident,session):
  with native.store.access(session,company) as (db,member,_):
   row=db.execute("SELECT room,file FROM company_generated_images WHERE id=? AND company=? AND state='COMPLETED'",(ident,company)).fetchone()
   if row is None:raise HTTPException(404,'IMAGE_NOT_FOUND')
   native.store.room(db,member,row['room'])
   from open_webui.models.files import Files
   from open_webui.storage.provider import Storage
   file=Files.get_file_by_id(row['file'])
   if file is None:raise HTTPException(404,'IMAGE_NOT_FOUND')
   path=Path(Storage.get_file(file.path))
   if not path.is_file():raise HTTPException(404,'IMAGE_NOT_FOUND')
   return FileResponse(path,media_type='image/png',headers={'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="Generated image.png"'})

 @router.get('/{company}/generated-images/{ident}/content')
 def content(company:str,ident:str,session=Depends(principal)):
  from company_messaging.authority import Denied as NativeDenied
  try:return authorized_content(company,ident,session)
  except NativeDenied:raise HTTPException(403,'COMPANY_IMAGE_ACCESS_DENIED')from None

 async def generate(bound,args):
  bound.check();ctx=native.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope)
  require(ctx.bot is not None and ctx.native_scope is not None,'NATIVE_IMAGE_RUN_REQUIRED')
  prompt=args['prompt'];ident=hashlib.sha256(json.dumps([ctx.company,bound.run_id,bound.call_id]).encode()).hexdigest()
  with native.access(ctx,'integrations.run') as db:
   old=db.execute('SELECT state FROM company_generated_images WHERE id=?',(ident,)).fetchone()
   require(old is None,'IMAGE_GENERATION_NO_AUTOMATIC_RETRY',409)
   db.execute('INSERT INTO company_generated_images VALUES(?,?,?,?,?,?,?,NULL,NULL)',(ident,ctx.company,ctx.room,ctx.bot,bound.run_id,bound.call_id,'INTENT'))
  try:
   key=service.image_key(ctx.actor,ctx.company);bound.check()
   with native.access(ctx,'integrations.run'):require(key==service.image_key(ctx.actor,ctx.company),'IMAGE_CONNECTION_CHANGED')
   data=await asyncio.to_thread(openai_image,key[2],prompt)
   bound.check()
   with native.access(ctx,'integrations.run'):require(key==service.image_key(ctx.actor,ctx.company),'IMAGE_CONNECTION_CHANGED')
   from open_webui.routers.images import upload_image
   from open_webui.models.users import Users
   user=Users.get_user_by_id(ctx.actor);require(user is not None,'IMAGE_OWNER_REVOKED')
   request=Request({'type':'http','app':app})
   url=await asyncio.to_thread(upload_image,request,{'companyId':ctx.company,'conversationId':ctx.room,'generated':True},data,'image/png',user)
   match=re.fullmatch('/api/v1/files/([A-Za-z0-9-]+)/content',str(url));require(match is not None,'NATIVE_IMAGE_UPLOAD_INVALID')
   file=match[1];message=str(uuid.uuid5(uuid.NAMESPACE_URL,'starli:company-image:'+ident))
   scoped='/api/v1/companies/'+ctx.company+'/generated-images/'+ident+'/content'
   artifact=dict(id=ident,url=scoped,mimeType='image/png',name='Generated image.png',kind='image')
   with native.access(ctx,'integrations.run') as db:
    bound.check();require(key==service.image_key(ctx.actor,ctx.company),'IMAGE_CONNECTION_CHANGED')
    db.execute("UPDATE company_generated_images SET state='COMPLETED',file=?,message=? WHERE id=? AND state='INTENT'",(file,message,ident))
    native.feedback.new_message(db,ctx,ctx.room,ctx.bot,message,'![Generated image]('+scoped+')')
    db.execute('UPDATE cm_messages SET attachments=? WHERE id=?',(json.dumps([artifact]),message))
    native.store.event(db,ctx.room,'message.updated',message)
   return dict(companyId=ctx.company,conversationId=ctx.room,status='GENERATED',messageId=message,attachments=[artifact],inferenceSelectionChanged=False)
  except BaseException:
   with native.store.db() as db:db.execute("UPDATE company_generated_images SET state='UNKNOWN' WHERE id=? AND state='INTENT'",(ident,))
   # Never return HTTP response text, key, request headers or provider exceptions.
   raise RuntimeError('COMPANY_IMAGE_GENERATION_UNCONFIRMED')from None
 runtime.company_tools.register(ToolSpec('company_image_generate','Generate one real image using the separate private company OpenAI image API key. Does not switch chat inference or Codex subscription. Publishes the actual image as a native attachment in this company conversation. Requires integrations.run; never ask for API keys in chat. An uncertain request is not automatically retried.',obj({'prompt':{'type':'string','minLength':1,'maxLength':8000}}),'write','company-image-generation',generate,'integrations.run'))
 # Insert before the static fallback mount, matching existing company routers.
 index=next((i for i,route in enumerate(app.router.routes) if getattr(route,'path',None)==''),len(app.router.routes));app.router.routes[index:index]=router.routes
 app.state.company_provider_images=service
 return service
