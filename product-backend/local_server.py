"""Local native composition of the recovered company/claim candidate; no upstream state."""
import argparse,hashlib,hmac,importlib.util,json,os,secrets,sys
from pathlib import Path
from types import SimpleNamespace

HERE=Path(__file__).resolve().parent
REPO=HERE.parent
WAVE=HERE/'server-src/grokbot-gemini-autonomous-company-wave1-20261120'
CODEX=WAVE/'codex'

def configure(state,origin):
 from urllib.parse import urlsplit
 u=urlsplit(origin)
 if u.scheme!='http' or u.hostname not in ('127.0.0.1','::1') or not u.port or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:raise ValueError('Explicit literal-loopback HTTP origin required')
 state=Path(state).resolve()
 if not state.is_relative_to(REPO/'work'):raise ValueError('Local candidate state must be inside repository work/; existing state is never adopted')
 sys.path.insert(0,str(REPO/'dashboard/backend'))
 import starli_private_fs as private
 private.ensure_private_directory(state)
 marker=state/'instance.json'
 if not marker.exists():
  if any(state.iterdir()):raise ValueError('Unrecognized existing state refused; choose a fresh empty state directory')
  private.create_private_file(marker,json.dumps({'schema':'starli.local-company-candidate.v1','instanceId':secrets.token_hex(16)}).encode())
 private.require_private_file(marker)
 if json.loads(marker.read_text()).get('schema')!='starli.local-company-candidate.v1':raise ValueError('Local instance marker invalid')
 secret=state/'session.key'
 if not secret.exists():private.create_private_file(secret,secrets.token_hex(48).encode())
 private.require_private_file(secret)
 for name in list(os.environ):
  if name.startswith(('STARLI_','DATABASE_','WEBUI_','OPENAI','OPENROUTER','REDIS')) or name in ('DATA_DIR','EMAIL_FROM','SMTP_FROM'):os.environ.pop(name,None)
 paths={'data':state/'data','state':state/'state','memory':state/'memory','config':state/'config','static':state/'static','tasks':state/'tasks'}
 for p in paths.values():private.ensure_private_directory(p)
 authority_path=paths['data']/'company-authority.sqlite3'
 if not authority_path.exists():authority_path=paths['data']/'webui.db'
 os.environ.update(DATA_DIR=str(paths['data']),DATABASE_URL='sqlite:///'+(paths['data']/'webui.db').as_posix(),WEBUI_SECRET_KEY=secret.read_text(),
  WEBUI_AUTH='true',ENABLE_SIGNUP='false',ENABLE_LOGIN_FORM='true',ENABLE_PERSISTENT_CONFIG='false',OFFLINE_MODE='true',HF_HUB_OFFLINE='1',ANONYMIZED_TELEMETRY='false',
  ENABLE_OPENAI_API='false',ENABLE_OLLAMA_API='false',ENABLE_COMMUNITY_SHARING='false',ENABLE_VERSION_UPDATE_CHECK='false',
  STARLI_STATE_DIR=str(paths['state']),STARLI_DATA_DIR=str(paths['data']),STARLI_CONFIG_DIR=str(paths['config']),STARLI_MEMORY_ROOT=str(paths['memory']),STARLI_TASK_HOME=str(paths['tasks']),
  STARLI_SOURCE_DATABASE=str(state/'compatibility-unused.sqlite'),STARLI_COMPANY_DATABASE=str(authority_path),STARLI_COMPANY_BOT_DATABASE=str(authority_path),
  STATIC_DIR=str(paths['static']),WEBUI_URL=origin,STARLI_PUBLIC_ORIGIN=origin,CORS_ALLOW_ORIGIN=origin)
 os.chdir(state)
 for directory in [WAVE/'grokbot1',WAVE/'grokbot1/vendor',CODEX/'guest-company-authority-r1',CODEX/'guest-session-refresh-r1',CODEX/'postclaim-name-r1',CODEX/'assembly-r1/adapters']:
  sys.path.insert(0,str(directory))
 return state

def native(state):
 import native_harness as h
 h.NATIVE_BACKEND=str(REPO/'dashboard/backend')
 h.NATIVE_PINS=json.loads((HERE/'LOCAL-NATIVE-PINS.json').read_text())
 ns=h.load_native(h.Paths(state))
 previous=ns.paths
 ns.paths=SimpleNamespace(root=previous.root,data=previous.data,state=previous.state,main=previous.main,authority=Path(os.environ['STARLI_COMPANY_DATABASE']),drive=previous.drive,intake=previous.intake)
 h.ensure_native_databases(ns)
 return ns

def create_app(state,origin):
 state=configure(state,origin);ns=native(state)
 from fastapi import FastAPI,Request,HTTPException,Depends
 from fastapi.responses import JSONResponse
 app=FastAPI(title='Starli single-company local backend')
 app.state.native=ns
 from local_installation import mount as mount_installation
 installation=mount_installation(app,ns,origin)
 async def no_provider(*args,**kwargs):raise HTTPException(503,'LOCAL_MODEL_PROVIDER_NOT_CONFIGURED')
 ns.public.call_provider=no_provider
 app.state.config=SimpleNamespace(JWT_EXPIRES_IN='1h',USER_PERMISSIONS={},ENABLE_SIGNUP=False,ENABLE_LOGIN_FORM=True,WEBHOOK_URL='',ENABLE_API_KEY_ENDPOINT_RESTRICTIONS=True,API_KEY_ALLOWED_ENDPOINTS='')
 app.state.WEBUI_NAME='Starli local company'
 @app.middleware('http')
 async def auth_state(request:Request,call_next):
  request.state.enable_api_key=False
  if request.url.path.startswith(('/api/v1/starli/public','/api/v1/starli/grokbot1')) or request.url.path in ('/api/v1/auths/signup','/api/v1/auths/add','/api/v1/company-pilot/company'):
   return JSONResponse({'detail':'ROUTE_NOT_AVAILABLE'},status_code=404)
  if request.method in ('POST','PUT','PATCH','DELETE') and ('/provider-' in request.url.path or '/collaborations' in request.url.path or request.url.path.endswith('/provider-selection')):
   if not request.headers.get('authorization','').startswith('Bearer ') or request.headers.get('origin')!=origin:
    return JSONResponse({'detail':'PROVIDER_BEARER_ORIGIN_REQUIRED'},status_code=403)
  if request.method=='POST' and request.url.path.startswith('/api/v1/starli/public/grokbot1/intents/') and request.url.path.endswith('/workspace/messages'):
   return JSONResponse({'detail':'LOCAL_MODEL_PROVIDER_NOT_CONFIGURED'},status_code=503,headers={'Cache-Control':'no-store'})
  return await call_next(request)
 from open_webui.routers import auths
 from copy import copy
 from starlette.routing import compile_path
 for source in auths.router.routes:
  if source.path in ('/','/signin','/signout'):
   route=copy(source);route.path='/api/v1/auths'+source.path;route.path_format='/api/v1/auths'+source.path_format;route.path_regex,route.path_format,route.param_convertors=compile_path(route.path);app.router.routes.append(route)
 store=ns.native_mount.install(app,str(ns.paths.main),authority_database=str(ns.paths.authority),registry_database=str(ns.paths.authority))
 from open_webui.utils.auth import get_verified_user
 from open_webui.company_authority.company_routes import build_router,CompanyForm
 @app.post('/api/v1/companies')
 def create_only_company(body:CompanyForm,request:Request,user=Depends(get_verified_user)):
  if not request.headers.get('authorization','').startswith('Bearer ') or request.headers.get('origin')!=origin:raise HTTPException(403,'COMPANY_BEARER_ORIGIN_REQUIRED')
  if installation.status()['companyConfigured']:raise HTTPException(409,'SINGLE_COMPANY_ONLY')
  if user.role!='admin':raise HTTPException(403,'ADMINISTRATOR_REQUIRED')
  import sqlite3
  authority=ns.RbacAuthority(str(ns.paths.authority))
  try:return {'company_id':authority.create(user.id,body.name,user.name)}
  except sqlite3.IntegrityError:raise HTTPException(409,'SINGLE_COMPANY_ONLY')from None
  finally:authority.db.close()
 app.include_router(build_router(get_verified_user,str(ns.paths.authority)),prefix='/api/v1/companies')
 from starli_memory.native_directory import build_native_router
 app.include_router(build_native_router(company_path=str(ns.paths.authority),registry_path=str(ns.paths.authority)),prefix='/api/v1/bot-directory')
 from open_webui.company_authority.pilot_routes import build_router as pilot_router
 from open_webui.routers.starli_session_fence import capture_request_fence
 from open_webui.routers.starli_v3_native import _mutation_guard
 app.include_router(pilot_router(get_verified_user,capture_request_fence,_mutation_guard,str(ns.paths.authority)),prefix='/api/v1/company-pilot')
 from local_provider import install as install_local_provider
 model_runtime,company_providers=install_local_provider(app,ns,state,store,origin)
 from local_collaboration_routes import install as install_collaboration
 install_collaboration(app,state,store,model_runtime)
 @app.get('/health')
 def health():
  with company_providers.db() as db:configured=db.execute('SELECT 1 FROM company_provider_connections WHERE active=1 LIMIT 1').fetchone()is not None
  return {'status':'ready','backend':'NEW_COMPANY_NATIVE_CANDIDATE','nativeAuth':True,'nativeMessaging':True,'guestClaim':False,'singleCompany':True,'registrationAllowed':False,'setupRequired':installation.status()['setupRequired'],'providerConfigured':configured,'modelExecution':'CONFIGURED_NOT_YET_VERIFIED' if configured else 'NOT_CONFIGURED','boundedCollaborationAvailable':True,'workerExecution':'NOT_CONFIGURED','productionReady':False}
 from fastapi.responses import HTMLResponse
 @app.get('/local/provider',response_class=HTMLResponse)
 @app.get('/api/local/provider',response_class=HTMLResponse)
 def setup_provider(request:Request):
  if request.client is None or request.client.host not in ('127.0.0.1','::1'):raise HTTPException(403,'LOOPBACK_ONLY')
  return HTMLResponse((HERE/'provider-setup.html').read_text(encoding='utf-8'),headers={'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"})
 @app.api_route('/api/v1/starli/orchestration/{rest:path}',methods=['GET','POST'])
 def unavailable(rest:str):raise HTTPException(503,'LOCAL_WORKER_EXECUTION_NOT_CONFIGURED')
 return app

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['serve','init']);p.add_argument('--state',required=True);p.add_argument('--port',type=int,default=18381);p.add_argument('--origin');a=p.parse_args();origin=a.origin or f'http://127.0.0.1:{a.port}'
 if a.action=='init':raise RuntimeError('Use the browser first-run setup to create the administrator and sole company atomically.')
 import uvicorn
 uvicorn.run(create_app(a.state,origin),host='127.0.0.1',port=a.port,access_log=False,log_level='warning')

if __name__=='__main__':main()
