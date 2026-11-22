"""Native active-run computer jobs. Worker receives no JWT or model credentials."""
import starli_portable as _portable
import asyncio,base64,hashlib,json,pathlib,re,sqlite3,time,secrets
from contextlib import contextmanager
from transport import Channel,digest

class Compute:
 def __init__(self,runtime,registry,config):
  self.runtime=runtime;self.registry=registry;self.worker=config['workerId'];self.channel=Channel(pathlib.Path(config['keyFile']).read_bytes());self.path=config['database'];self.active={}
  with self.db()as db:db.executescript('''CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,digest TEXT NOT NULL,company TEXT NOT NULL,computer TEXT NOT NULL,worker TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,result TEXT,created REAL NOT NULL);
   CREATE TABLE IF NOT EXISTS apps(company TEXT NOT NULL,process TEXT NOT NULL,computer TEXT NOT NULL,actor TEXT NOT NULL,binding TEXT NOT NULL,bot TEXT NOT NULL,room TEXT NOT NULL,publication TEXT UNIQUE,PRIMARY KEY(company,process));''')
 @contextmanager
 def db(self):
  db=sqlite3.connect(self.path,timeout=5);db.row_factory=sqlite3.Row
  try:
   yield db;db.commit()
  except BaseException:db.rollback();raise
  finally:db.close()
 def fresh(self,ident):
  item=self.active.get(ident)
  if not item:return False
  if callable(item):return item()is True
  bound,enrollment=item
  try:
   bound.check()
   if self.registry.current(bound.context.company_id)!=enrollment:return False
   for who in (bound.context.actor_id,bound.context.bot_id):self.runtime.authority.require_member(who,bound.context.company_id,permission='computer.control')
   with self.runtime.store.db()as db:return self.runtime.authorize_native(db,bound.native_scope)is True
  except Exception:return False
 async def request(self,bound,method,arguments):
  from starli_company_tools.core import require
  bound.check();ctx=bound.context;enrollment=self.registry.current(ctx.company_id);require(enrollment is not None,'COMPANY_COMPUTER_NOT_PROVISIONED',409)
  for who in (ctx.actor_id,ctx.bot_id):self.runtime.authority.require_member(who,ctx.company_id,permission='computer.control')
  ident=digest([ctx.company_id,bound.run_id,bound.call_id,method]);scope=dict(company_id=ctx.company_id,actor_id=ctx.actor_id,bot_id=ctx.bot_id,room_id=ctx.room_id,run_id=bound.run_id,tool_call_id=bound.call_id,assistant_message_id=bound.assistant_id)
  with self.runtime.store.access(bound.session,ctx.company_id,ctx.room_id)as(_,member,_):scope.update(membership_revision=member.revision,actor_binding_sha256=digest(member.binding))
  worker_id=self.worker+':'+ctx.company_id
  job=dict(operationId=ident,companyId=ctx.company_id,computerId=enrollment.computer,enrollmentRevision=enrollment.revision,workerId=worker_id,method=method,arguments=arguments,scope=scope);job['requestDigest']=digest(job)
  with self.db()as db:
   old=db.execute('SELECT * FROM jobs WHERE id=?',(ident,)).fetchone()
   require(old is None,'COMPUTER_OPERATION_NO_AUTOMATIC_RETRY',409)
   db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,NULL,?)',(ident,job['requestDigest'],ctx.company_id,enrollment.computer,worker_id,json.dumps(job),'QUEUED',time.time()))
  self.active[ident]=(bound,enrollment)
  try:
   for _ in range(900):
    require(self.fresh(ident),'COMPUTER_RUN_REVOKED',403)
    with self.db()as db:row=db.execute('SELECT state,result FROM jobs WHERE id=?',(ident,)).fetchone()
    if row['state']=='COMPLETED':return json.loads(row['result'])
    require(row['state']not in ('FAILED','UNKNOWN','REVOKED'),'COMPUTER_OPERATION_UNCONFIRMED',503)
    await asyncio.sleep(1)
   require(False,'COMPUTER_OPERATION_TIMEOUT',504)
  finally:
   self.active.pop(ident,None)
   with self.db()as db:db.execute("UPDATE jobs SET state='REVOKED' WHERE id=? AND state IN ('QUEUED','CLAIMED')",(ident,))
 def claim(self,value):
  from starli_company_tools.core import require
  worker_id=value.get('workerId');require(type(worker_id)is str and worker_id.startswith(self.worker+':')and self.registry.current(worker_id[len(self.worker)+1:])is not None,'COMPUTER_WORKER_DENIED')
  with self.db()as db:
   db.execute('BEGIN IMMEDIATE')
   for row in db.execute("SELECT * FROM jobs WHERE worker=? AND state='QUEUED' ORDER BY created LIMIT 20",(worker_id,)).fetchall():
    if not self.fresh(row['id']):db.execute("UPDATE jobs SET state='REVOKED' WHERE id=?",(row['id'],));continue
    db.execute("UPDATE jobs SET state='CLAIMED' WHERE id=? AND state='QUEUED'",(row['id'],));return dict(job=json.loads(row['payload']))
  return dict(job=None)
 def authorize(self,value):
  from starli_company_tools.core import require
  worker_id=value.get('workerId');require(type(worker_id)is str and worker_id.startswith(self.worker+':'),'COMPUTER_WORKER_DENIED')
  with self.db()as db:row=db.execute('SELECT digest,state FROM jobs WHERE id=? AND worker=?',(value.get('operationId'),worker_id)).fetchone()
  return dict(authorized=bool(row and row['digest']==value.get('requestDigest')and row['state']=='CLAIMED'and self.fresh(value['operationId'])))
 def finish(self,value):
  from starli_company_tools.core import require
  require(self.authorize(value)['authorized'],'COMPUTER_RUN_REVOKED')
  result=value.get('result');require(type(result)is dict and len(json.dumps(result,allow_nan=False).encode())<=800000,'COMPUTER_RESULT_INVALID',422)
  with self.db()as db:
   row=db.execute('SELECT payload FROM jobs WHERE id=?',(value['operationId'],)).fetchone();job=json.loads(row['payload'])
   require(result.get('companyId')==job['companyId']and result.get('computerId')==job['computerId']and result.get('operationId')==job['operationId'],'COMPUTER_RECEIPT_SCOPE_CHANGED')
   require(self.fresh(value['operationId']),'COMPUTER_RUN_REVOKED')
   state='COMPLETED'if result.get('state')=='COMPLETED'else'FAILED'
   db.execute("UPDATE jobs SET state=?,result=? WHERE id=? AND state='CLAIMED'",(state,json.dumps(result),value['operationId']))
  return dict(accepted=True)
 def track_app(self,bound,result):
  from starli_company_tools.core import require
  require(type(result.get('processId'))is str and result.get('httpHealthy')is True,'COMPANY_APP_HEALTH_UNCONFIRMED',409)
  c=bound.context
  with self.runtime.store.access(bound.session,c.company_id,c.room_id)as(_,member,_):binding=json.dumps(member.binding)
  with self.db()as db:db.execute('INSERT OR IGNORE INTO apps VALUES(?,?,?,?,?,?,?,NULL)',(c.company_id,result['processId'],result['computerId'],c.actor_id,binding,c.bot_id,c.room_id))
 def app_live(self,row):
  try:
   enrollment=self.registry.current(row['company'])
   if enrollment is None or enrollment.computer!=row['computer']:return False
   for who in (row['actor'],row['bot']):self.runtime.authority.require_member(who,row['company'],permission='computer.control')
   with self.runtime.store.db(readonly=True)as db:
    member=self.runtime.store.authority.require_member(row['actor'],row['company'])
    if json.dumps(member.binding)!=row['binding']:return False
    self.runtime.store.room(db,member,row['room'])
   return True
  except Exception:return False
 def publish(self,bound,process):
  from starli_company_tools.core import require
  bound.check();c=bound.context
  for who in(c.actor_id,c.bot_id):self.runtime.authority.require_member(who,c.company_id,permission='computer.control')
  with self.db()as db:
   row=db.execute('SELECT * FROM apps WHERE company=? AND process=?',(c.company_id,process)).fetchone()
   require(row is not None and row['actor']==c.actor_id and row['bot']==c.bot_id and self.app_live(row),'COMPANY_APP_PUBLISH_DENIED')
   publication=row['publication']or secrets.token_urlsafe(24);db.execute('UPDATE apps SET publication=? WHERE company=? AND process=?',(publication,c.company_id,process))
  return dict(companyId=c.company_id,processId=process,status='PUBLISHED',url=_portable.public_url('/published/')+publication+'/',browserStorage='sandboxed',inferenceRequired=False)
 async def published_http(self,publication,path,http_method='GET',body=b'',content_type='application/octet-stream'):
  from starli_company_tools.core import require
  require(type(publication)is str and re.fullmatch('[A-Za-z0-9_-]{32}',publication)is not None,'APP_NOT_FOUND',404)
  require(path.startswith('/')and not path.startswith('//')and len(path)<=2000 and '\\'not in path and not any(c in path for c in ('\x00','\r','\n')),'APP_PATH_INVALID',422)
  require(http_method in ('GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS')and len(body)<=65536,'APP_REQUEST_INVALID',413)
  with self.db()as db:row=db.execute('SELECT * FROM apps WHERE publication=?',(publication,)).fetchone()
  require(row is not None and self.app_live(row),'APP_NOT_AVAILABLE',404);row=dict(row)
  enrollment=self.registry.current(row['company']);ident=digest(['published-app',publication,secrets.token_hex(16)])
  # Explicit standing publication principal, not a fabricated native bot turn.
  scope=dict(principal_kind='published-app',company_id=row['company'],actor_id=row['actor'],bot_id=row['bot'],room_id=row['room'],run_id='publication:'+publication,tool_call_id=ident,assistant_message_id='publication',actor_binding_sha256=digest(row['binding']),membership_revision=0)
  arguments=dict(processId=row['process'],path=path,httpMethod=http_method,bodyBase64=base64.b64encode(body).decode(),contentType=content_type)
  job=dict(operationId=ident,companyId=row['company'],computerId=row['computer'],enrollmentRevision=enrollment.revision,workerId=self.worker+':'+row['company'],method='app.http',arguments=arguments,scope=scope);job['requestDigest']=digest(job)
  with self.db()as db:
   require(db.execute("SELECT count(*) FROM jobs WHERE company=? AND state IN ('QUEUED','CLAIMED')",(row['company'],)).fetchone()[0]<8,'APP_BUSY',503)
   db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,NULL,?)',(ident,job['requestDigest'],row['company'],row['computer'],job['workerId'],json.dumps(job),'QUEUED',time.time()))
  self.active[ident]=lambda:self.app_live(row)and self.registry.current(row['company'])==enrollment
  try:
   for _ in range(60):
    require(self.fresh(ident),'APP_NOT_AVAILABLE',404)
    with self.db()as db:receipt=db.execute('SELECT state,result FROM jobs WHERE id=?',(ident,)).fetchone()
    if receipt['state']=='COMPLETED':
     value=json.loads(receipt['result']);require(value.get('state')=='COMPLETED'and type(value.get('status'))is int,'APP_RESPONSE_UNAVAILABLE',503);return value
    require(receipt['state']not in('FAILED','REVOKED','UNKNOWN'),'APP_NOT_AVAILABLE',503)
    await asyncio.sleep(.5)
   require(False,'APP_TIMEOUT',504)
  finally:
   self.active.pop(ident,None)
   with self.db()as db:db.execute("UPDATE jobs SET state='REVOKED' WHERE id=? AND state IN ('QUEUED','CLAIMED')",(ident,))

def install(app,runtime,registry,path=_portable.config_file('company-compute.json')):
 from fastapi import APIRouter,Request,HTTPException
 from fastapi.responses import JSONResponse,Response
 from starli_company_tools.core import ToolSpec,obj,ID,require
 service=Compute(runtime,registry,json.loads(pathlib.Path(path).read_text()));router=APIRouter(prefix='/internal/company-compute')
 async def worker(request,phase):
  try:
   data=bytearray()
   async for chunk in request.stream():data.extend(chunk);require(len(data)<=1000000,'COMPUTER_INPUT_LIMIT',413)
   value=service.channel.read('compute.'+phase,json.loads(data));handler=getattr(service,phase);result=handler(value)
   return JSONResponse(service.channel.sign('compute.'+phase+'.reply',result),headers={'Cache-Control':'no-store'})
  except Exception:return JSONResponse({'detail':'COMPUTER_WORKER_REQUEST_DENIED'},status_code=403)
 @router.post('/claim')
 async def claim(request:Request):return await worker(request,'claim')
 @router.post('/authorize')
 async def authorize(request:Request):return await worker(request,'authorize')
 @router.post('/finish')
 async def finish(request:Request):return await worker(request,'finish')
 public=APIRouter()
 @public.api_route('/published/{publication}/',methods=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'])
 @public.api_route('/published/{publication}/{path:path}',methods=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'])
 async def published(publication:str,request:Request,path:str=''):
  try:
   target='/'+path
   if request.url.query:target+='?'+request.url.query
   body=bytearray()
   async for chunk in request.stream():body.extend(chunk);require(len(body)<=65536,'APP_REQUEST_LIMIT',413)
   content_type=request.headers.get('content-type','application/octet-stream');require(len(content_type)<=200 and all(32<=ord(c)<127 for c in content_type),'APP_CONTENT_TYPE_INVALID',422)
   if request.method=='OPTIONS' and request.headers.get('access-control-request-method'):
    require(re.fullmatch('[A-Za-z0-9_-]{32}',publication)is not None,'APP_NOT_FOUND',404)
    require(request.headers['access-control-request-method'] in ('GET','HEAD','POST','PUT','PATCH','DELETE'),'APP_METHOD_INVALID',405)
    requested={h.strip().lower()for h in request.headers.get('access-control-request-headers','').split(',')if h.strip()}
    require(requested<={'content-type'},'APP_HEADERS_DENIED',403)
    with service.db()as db:row=db.execute('SELECT * FROM apps WHERE publication=?',(publication,)).fetchone()
    require(row is not None and service.app_live(row),'APP_NOT_AVAILABLE',404)
    return Response(status_code=204,headers={'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Access-Control-Request-Method, Access-Control-Request-Headers'})
   value=await service.published_http(publication,target,request.method,bytes(body),content_type);data=base64.b64decode(value['bodyBase64'],validate=True);require(len(data)<=524288,'APP_RESPONSE_LIMIT',502)
   own=_portable.public_url('/published/')+publication+'/'
   policy="sandbox allow-scripts allow-forms allow-downloads; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' "+own+"; style-src 'unsafe-inline' "+own+"; img-src data: blob: "+own+"; connect-src "+own+"; font-src data: "+own+"; object-src 'none'; base-uri 'none'; form-action "+own
   media=value.get('contentType','application/octet-stream').split(';')[0]
   require(re.fullmatch('[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+',media)is not None,'APP_CONTENT_TYPE_INVALID',502)
   return Response(data,status_code=value['status'],media_type=media,headers={'Cache-Control':'no-store','Content-Security-Policy':policy,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type'})
  except Exception as error:return JSONResponse({'detail':'APP_NOT_AVAILABLE'},status_code=getattr(error,'status',503))
 commands={
 'computer_process_start':('Run a shell command INSIDE the enrolled company Debian computer, never the Windows host. Returns an actual process receipt. Use status/logs for progress; do not retry an uncertain start.',obj({'command':{'type':'string','minLength':1,'maxLength':8000},'timeoutSeconds':{'type':'integer','minimum':1,'maximum':900}},['command']),'process.start','write'),
 'computer_process_status':('Inspect an existing company-computer process.',obj({'processId':ID}),'process.status','read'),
 'computer_process_logs':('Read bounded actual company-computer command OR app logs. Use the returned processId to diagnose failed HTTP health before restarting an app.',obj({'processId':ID}),'process.logs','read'),
 'computer_process_stop':('Stop an owned company-computer process.',obj({'processId':ID}),'process.stop','write'),
 'computer_app_start':('Start a persistent HTTP SERVER from a relative /home/starli/workspace entrypoint. The program MUST stay running and listen on 127.0.0.1 at the numeric PORT environment variable supplied by this tool (never hardcode 3000/8000/9000). Python servers: int(os.environ["PORT"]); Node: process.env.PORT. Current pilot has Python 3 standard library; check/install dependencies explicitly before choosing Node. Use a separate project directory, do not overwrite other projects. Reuse an existing healthy process instead of repeatedly starting copies. httpHealthy=false is NOT a working preview: inspect computer_process_logs using the returned processId, fix the actual error, and stop only your failed app before another start. Returns processId and assigned port; publish separately only after HTTP verification.',obj({'entrypoint':{'type':'string','minLength':1,'maxLength':240},'runtime':{'type':'string','enum':['node','python']}}),'app.start','write'),
 'computer_app_status':('Inspect a company web application.',obj({'processId':ID}),'app.status','read'),
 'computer_app_stop':('Stop a company web application.',obj({'processId':ID}),'app.stop','write'),
 'computer_app_http':('Read an owned company HTTP app using its exact processId and relative path such as /. Do not supply a full URL. On failure inspect computer_process_logs for that processId; do not keep starting duplicate apps. No arbitrary URL or host access.',obj({'processId':ID,'path':{'type':'string','minLength':1,'maxLength':2000}},['processId']),'app.http','read')}
 for name,(description,schema,method,effect)in commands.items():
  async def execute(bound,args,method=method):
   arguments=dict(args)
   if method=='process.start':arguments={'argv':['/bin/sh','-lc',arguments['command']],'timeoutSeconds':arguments.get('timeoutSeconds',300)}
   if method=='app.http':arguments.setdefault('path','/')
   result=await service.request(bound,method,arguments)
   if method=='app.start'and result.get('httpHealthy'):service.track_app(bound,result)
   if method=='app.http'and len(json.dumps(result))>200000:result={**result,'bodyBase64':result.get('bodyBase64','')[:160000],'truncated':True}
   return result
  runtime.company_tools.register(ToolSpec(name,description,schema,effect,'company-computer-process',execute,'computer.control'))
 async def publish(bound,args):return service.publish(bound,args['processId'])
 runtime.company_tools.register(ToolSpec('computer_app_publish','Publish an actual healthy company app and return a public sandboxed URL. Only this app is exposed; backend requests stay inside its company computer. Requires company computer-control authority. Browser storage is isolated; no platform cookies or credentials are forwarded.',obj({'processId':ID}),'write','company-computer-publish',publish,'computer.control'))
 index=next((i for i,r in enumerate(app.router.routes)if getattr(r,'path',None)==''),len(app.router.routes));app.router.routes[index:index]=router.routes+public.routes;app.state.company_compute=service
 return service
