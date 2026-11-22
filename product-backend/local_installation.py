"""One-company installation policy and atomic, permanently one-shot owner setup."""
import json,re,sqlite3,time,uuid
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit
from fastapi import APIRouter,HTTPException,Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel,ConfigDict,Field,SecretStr

class InstallationError(Exception):
 def __init__(self,code,status=409):self.code,self.status=code,status;super().__init__(code)

class Installation:
 def __init__(self,ns):
  self.ns=ns;self.main=Path(ns.paths.main);self.authority=Path(ns.paths.authority)
  self._install_policy()
 def _install_policy(self):
  with closing(sqlite3.connect(self.main)) as main:
   users=main.execute('SELECT id FROM user ORDER BY created_at,id').fetchall()
  db=sqlite3.connect(self.authority,timeout=10,isolation_level=None)
  try:
   db.execute('BEGIN IMMEDIATE')
   companies=db.execute('SELECT id FROM companies ORDER BY id').fetchall()
   if len(companies)>1:raise InstallationError('SINGLE_COMPANY_MIGRATION_REQUIRED',503)
   for statement in [
    'CREATE TABLE IF NOT EXISTS local_installation_company(slot INTEGER PRIMARY KEY CHECK(slot=1),company_id TEXT NOT NULL UNIQUE)',
    'CREATE TABLE IF NOT EXISTS local_first_run(slot INTEGER PRIMARY KEY CHECK(slot=1),owner_id TEXT NOT NULL,locked_at INTEGER NOT NULL)',
   ]:db.execute(statement)
   if companies:
    bound=db.execute('SELECT company_id FROM local_installation_company WHERE slot=1').fetchone()
    if bound and bound[0]!=companies[0][0]:raise InstallationError('SINGLE_COMPANY_BINDING_MISMATCH',503)
    db.execute('INSERT OR IGNORE INTO local_installation_company VALUES(1,?)',(companies[0][0],))
   if users:db.execute('INSERT OR IGNORE INTO local_first_run VALUES(1,?,?)',(users[0][0],int(time.time())))
   for statement in [
    "CREATE TRIGGER IF NOT EXISTS local_one_company BEFORE INSERT ON companies WHEN EXISTS(SELECT 1 FROM companies) OR EXISTS(SELECT 1 FROM local_installation_company) BEGIN SELECT RAISE(ABORT,'SINGLE_COMPANY_ONLY'); END",
    'CREATE TRIGGER IF NOT EXISTS local_bind_company AFTER INSERT ON companies BEGIN INSERT INTO local_installation_company VALUES(1,NEW.id); END',
    "CREATE TRIGGER IF NOT EXISTS local_company_required BEFORE DELETE ON companies BEGIN SELECT RAISE(ABORT,'SINGLE_COMPANY_REQUIRED'); END",
    "CREATE TRIGGER IF NOT EXISTS local_company_id_immutable BEFORE UPDATE OF id ON companies WHEN NEW.id!=OLD.id BEGIN SELECT RAISE(ABORT,'COMPANY_ID_IMMUTABLE'); END",
    "CREATE TRIGGER IF NOT EXISTS local_binding_no_delete BEFORE DELETE ON local_installation_company BEGIN SELECT RAISE(ABORT,'INSTALLATION_BINDING_LOCKED'); END",
    "CREATE TRIGGER IF NOT EXISTS local_binding_no_update BEFORE UPDATE ON local_installation_company BEGIN SELECT RAISE(ABORT,'INSTALLATION_BINDING_LOCKED'); END",
    "CREATE TRIGGER IF NOT EXISTS local_setup_no_delete BEFORE DELETE ON local_first_run BEGIN SELECT RAISE(ABORT,'FIRST_RUN_PERMANENTLY_LOCKED'); END",
    "CREATE TRIGGER IF NOT EXISTS local_setup_no_update BEFORE UPDATE ON local_first_run BEGIN SELECT RAISE(ABORT,'FIRST_RUN_PERMANENTLY_LOCKED'); END",
   ]:db.execute(statement)
   db.commit()
  except BaseException:db.rollback();raise
  finally:db.close()
 def status(self):
  with closing(sqlite3.connect(self.main)) as db:users=db.execute('SELECT count(*) FROM user').fetchone()[0]
  with closing(sqlite3.connect(self.authority)) as db:
   companies=db.execute('SELECT count(*) FROM companies').fetchone()[0];locked=db.execute('SELECT 1 FROM local_first_run').fetchone()is not None
  return {'profile':'single-company','singleCompany':True,'setupRequired':not locked and users==0 and companies==0,'setupLocked':locked or users>0,'companyConfigured':companies==1,'registrationAllowed':False,'requiresMigration':companies>1 or (not locked and users==0 and self.main!=self.authority)}
 def setup(self,*,name,email,password,company_name,after_user=None,before_commit=None):
  if self.main.resolve()!=self.authority.resolve():raise InstallationError('ATOMIC_SETUP_LAYOUT_MIGRATION_REQUIRED',503)
  if not isinstance(password,str) or not 14<=len(password) or len(password.encode())>72 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email) or any(ord(c)<32 or ord(c)==127 for c in name+email+company_name):raise InstallationError('SETUP_INPUT_INVALID',422)
  if not name.strip() or len(name)>120 or not company_name.strip() or len(company_name)>100:raise InstallationError('SETUP_INPUT_INVALID',422)
  from open_webui.internal.db import engine
  from open_webui.models.auths import Auth
  from open_webui.models.users import User
  password_hash=self.ns.auth.get_password_hash(password)
  user=str(uuid.uuid4());company=str(uuid.uuid4());now=int(time.time())
  with engine.connect() as conn:
   conn.exec_driver_sql('BEGIN IMMEDIATE')
   try:
    if conn.exec_driver_sql('SELECT 1 FROM local_first_run').first() or conn.exec_driver_sql('SELECT 1 FROM user').first() or conn.exec_driver_sql('SELECT 1 FROM auth').first() or conn.exec_driver_sql('SELECT 1 FROM companies').first():raise InstallationError('FIRST_RUN_LOCKED')
    conn.execute(User.__table__.insert().values(id=user,name=name.strip(),email=email.strip().lower(),role='admin',profile_image_url='/user.png',last_active_at=now,created_at=now,updated_at=now,settings={},info={}))
    conn.execute(Auth.__table__.insert().values(id=user,email=email.strip().lower(),password=password_hash,active=True))
    if after_user is not None:after_user()
    conn.exec_driver_sql('INSERT INTO companies VALUES(?,?)',(company,company_name.strip()))
    conn.exec_driver_sql("INSERT INTO members VALUES(?,?,?,1,1,?,'person')",(company,user,'owner',name.strip()))
    conn.exec_driver_sql('INSERT INTO audit(company_id,actor,action,target,at) VALUES(?,?,?,?,?)',(company,user,'create',company,time.time()))
    conn.exec_driver_sql('INSERT INTO audit(company_id,actor,action,target,at) VALUES(?,?,?,?,?)',(company,user,'installation.setup',company,time.time()))
    conn.exec_driver_sql('INSERT INTO local_first_run VALUES(1,?,?)',(user,now))
    if before_commit is not None:before_commit()
    conn.commit()
   except BaseException:conn.rollback();raise
  return {'setupComplete':True,'companyId':company,'setupLocked':True,'signInRequired':True,'registrationAllowed':False}

class SetupRoute(APIRoute):
 def get_route_handler(self):
  handler=super().get_route_handler()
  async def safe(request):
   try:
    if request.method=='POST':
     body=bytearray()
     async for chunk in request.stream():
      body.extend(chunk)
      if len(body)>16384:return JSONResponse({'detail':'SETUP_INPUT_TOO_LARGE'},status_code=413)
     request._body=bytes(body)
    response=await handler(request)
   except RequestValidationError:response=JSONResponse({'detail':'SETUP_INPUT_INVALID'},status_code=422)
   except InstallationError as e:response=JSONResponse({'detail':e.code},status_code=e.status)
   response.headers['Cache-Control']='no-store';return response
  return safe

def mount(app,ns,origin):
 installation=Installation(ns);app.state.installation=installation
 router=APIRouter(prefix='/api/v1/setup',route_class=SetupRoute)
 class Form(BaseModel):
  model_config=ConfigDict(extra='forbid',strict=True)
  name:str=Field(min_length=1,max_length=120)
  email:str=Field(min_length=3,max_length=254)
  password:SecretStr=Field(min_length=14,max_length=72)
  companyName:str=Field(min_length=1,max_length=100)
 def guard(request,mutation=False):
  hosts=request.headers.getlist('host')
  if request.client is None or request.client.host not in ('127.0.0.1','::1') or len(hosts)!=1:raise HTTPException(403,'LOCAL_SETUP_ONLY')
  try:
   host=urlsplit('http://'+hosts[0]);host_port=host.port;host_name=host.hostname
  except ValueError:raise HTTPException(403,'LOCAL_SETUP_HOST_DENIED')from None
  ports={urlsplit(origin).port,request.scope.get('server',('',None))[1]}
  if host_name not in ('127.0.0.1','::1') or host.username or host.password or host.path or host.query or host.fragment or host_port not in ports:raise HTTPException(403,'LOCAL_SETUP_HOST_DENIED')
  if mutation and (request.headers.getlist('origin')!=[origin] or request.headers.get('x-starli-setup')!='1'):raise HTTPException(403,'SETUP_ORIGIN_CSRF_REQUIRED')
 @router.get('/status')
 def status(request:Request):guard(request);return installation.status()
 @router.post('',status_code=201)
 def setup(body:Form,request:Request):
  guard(request,True)
  return installation.setup(name=body.name,email=body.email,password=body.password.get_secret_value(),company_name=body.companyName)
 app.include_router(router);return installation
