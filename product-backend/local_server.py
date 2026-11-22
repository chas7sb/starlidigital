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
 os.environ.update(DATA_DIR=str(paths['data']),DATABASE_URL='sqlite:///'+(paths['data']/'webui.db').as_posix(),WEBUI_SECRET_KEY=secret.read_text(),
  WEBUI_AUTH='true',ENABLE_SIGNUP='false',ENABLE_LOGIN_FORM='true',ENABLE_PERSISTENT_CONFIG='false',OFFLINE_MODE='true',HF_HUB_OFFLINE='1',ANONYMIZED_TELEMETRY='false',
  ENABLE_OPENAI_API='false',ENABLE_OLLAMA_API='false',ENABLE_COMMUNITY_SHARING='false',ENABLE_VERSION_UPDATE_CHECK='false',
  STARLI_STATE_DIR=str(paths['state']),STARLI_DATA_DIR=str(paths['data']),STARLI_CONFIG_DIR=str(paths['config']),STARLI_MEMORY_ROOT=str(paths['memory']),STARLI_TASK_HOME=str(paths['tasks']),
  STARLI_SOURCE_DATABASE=str(state/'compatibility-unused.sqlite'),STARLI_COMPANY_DATABASE=str(paths['data']/'company-authority.sqlite3'),STARLI_COMPANY_BOT_DATABASE=str(paths['data']/'company-authority.sqlite3'),
  STATIC_DIR=str(paths['static']),WEBUI_URL=origin,STARLI_PUBLIC_ORIGIN=origin,CORS_ALLOW_ORIGIN=origin)
 os.chdir(state)
 for directory in [WAVE/'grokbot1',WAVE/'grokbot1/vendor',CODEX/'guest-company-authority-r1',CODEX/'guest-session-refresh-r1',CODEX/'postclaim-name-r1',CODEX/'assembly-r1/adapters']:
  sys.path.insert(0,str(directory))
 return state

def native(state):
 import native_harness as h
 h.NATIVE_BACKEND=str(REPO/'dashboard/backend')
 h.NATIVE_PINS=json.loads((HERE/'LOCAL-NATIVE-PINS.json').read_text())
 ns=h.load_native(h.Paths(state));h.ensure_native_databases(ns)
 return ns

def create_app(state,origin):
 state=configure(state,origin);ns=native(state)
 from fastapi import FastAPI,Request,HTTPException
 from fastapi.responses import JSONResponse
 from grokbot1_claim import Grokbot1Service
 from grokbot1_routes import install
 app=FastAPI(title='Starli company candidate — local native backend')
 async def no_provider(*args,**kwargs):raise HTTPException(503,'LOCAL_MODEL_PROVIDER_NOT_CONFIGURED')
 ns.public.call_provider=no_provider
 app.state.config=SimpleNamespace(JWT_EXPIRES_IN='1h',USER_PERMISSIONS={},ENABLE_SIGNUP=False,ENABLE_LOGIN_FORM=True,WEBHOOK_URL='',ENABLE_API_KEY_ENDPOINT_RESTRICTIONS=True,API_KEY_ALLOWED_ENDPOINTS='')
 app.state.WEBUI_NAME='Starli local company'
 @app.middleware('http')
 async def auth_state(request:Request,call_next):
  request.state.enable_api_key=False
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
 app.include_router(ns.public.router,prefix='/api/v1/starli/public')
 store=ns.native_mount.install(app,str(ns.paths.main),authority_database=str(ns.paths.authority),registry_database=str(ns.paths.authority))
 key=(state/'session.key').read_bytes()
 svc=Grokbot1Service(ns,store,signing_key=hmac.new(key,b'grokbot1-intent-binding',hashlib.sha256).digest(),nav_key=hmac.new(key,b'grokbot1-navigation',hashlib.sha256).digest())
 install(app,svc,allowed_origins={origin});app.state.grokbot1=svc
 from open_webui.utils.auth import get_verified_user
 from open_webui.company_authority.company_routes import build_router
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
 from guest_session_refresh import install_guest_session_refresh
 install_guest_session_refresh(app,svc)
 from claimed_chat_defaults import install_claimed_chat_defaults
 install_claimed_chat_defaults(svc)
 from claimed_coordinator_name import install_claimed_coordinator_name
 install_claimed_coordinator_name(svc)
 from guest_company_authority import install_guest_company_authority
 authority=install_guest_company_authority(app,svc,allowed_origins={origin})
 from guest_workspace import install_guest_workspace
 install_guest_workspace(app,svc,allowed_origins={origin},authority=authority)
 @app.get('/health')
 def health():
  with company_providers.db() as db:configured=db.execute('SELECT 1 FROM company_provider_connections WHERE active=1 LIMIT 1').fetchone()is not None
  return {'status':'ready','backend':'NEW_COMPANY_NATIVE_CANDIDATE','nativeAuth':True,'nativeMessaging':True,'guestClaim':True,'providerConfigured':configured,'modelExecution':'CONFIGURED_NOT_YET_VERIFIED' if configured else 'NOT_CONFIGURED','boundedCollaborationAvailable':True,'workerExecution':'NOT_CONFIGURED','productionReady':False}
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
 if a.action=='init':
  import getpass
  state=configure(a.state,origin);ns=native(state)
  if ns.Users.get_num_users()!=0:raise RuntimeError('Existing native users preserved; owner initialization refused')
  email=input('Local owner email: ').strip().lower();name=input('Owner display name: ').strip();password=getpass.getpass('Owner password (14+ characters): ')
  import re
  if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email) or not name or len(password)<14 or len(password.encode())>72:raise ValueError('Invalid local owner credentials')
  if password!=getpass.getpass('Confirm password: '):raise ValueError('Passwords differ')
  ns.Auths.insert_new_auth(email,ns.auth.get_password_hash(password),name,'/user.png','admin');print('Local owner initialized; no session issued.');return
 import uvicorn
 uvicorn.run(create_app(a.state,origin),host='127.0.0.1',port=a.port,access_log=False,log_level='warning')

if __name__=='__main__':main()
