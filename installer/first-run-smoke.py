"""Actual new private instance + browser-API bootstrap race; no model calls."""
import argparse,concurrent.futures,hashlib,json,os,secrets,signal,socket,subprocess,time,urllib.error,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('Redirect refused')
def main():
 p=argparse.ArgumentParser();p.add_argument('--frontend-port',type=int,default=18860);p.add_argument('--backend-port',type=int,default=18861);a=p.parse_args()
 if not all(1024<=v<=65535 for v in [a.frontend_port,a.backend_port]) or a.frontend_port==a.backend_port:raise ValueError('Distinct bounded ports required')
 for port in [a.frontend_port,a.backend_port]:
  with socket.socket() as s:s.bind(('127.0.0.1',port))
 instance='first-run-smoke-'+secrets.token_hex(6);state=ROOT/'work'/instance
 origin=f'http://127.0.0.1:{a.frontend_port}';config=ROOT/'installer/.runtime'/('product-'+instance+'.json')
 env=dict(os.environ,STARLI_PRODUCT_INSTANCE=instance,STARLI_PRODUCT_STATE=str(state),STARLI_PRODUCT_FRONTEND_PORT=str(a.frontend_port),STARLI_PRODUCT_BACKEND_PORT=str(a.backend_port))
 checks=[];child=None;stream=None
 def request(path,body=None,token=None,setup=False):
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
  headers={'Origin':origin}
  if body is not None:headers['Content-Type']='application/json'
  if setup:headers['X-Starli-Setup']='1'
  if token:headers['Authorization']='Bearer '+token
  req=urllib.request.Request(origin+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
  try:
   with opener.open(req,timeout=20) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def stop():
  if child is None or child.poll() is not None:return
  if os.name=='nt':subprocess.run(['taskkill.exe','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
  else:os.killpg(child.pid,signal.SIGTERM)
  child.wait(timeout=30)
 def launch():
  nonlocal child
  process=subprocess.Popen(['node',str(ROOT/'installer/starli.mjs'),'start'],cwd=ROOT,env=env,stdout=stream,stderr=stream,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0,start_new_session=os.name!='nt')
  child=process
  deadline=time.monotonic()+180
  while time.monotonic()<deadline:
   if process.poll() is not None:raise RuntimeError('Installer process exited before setup status')
   try:
    code,value=request('/api/v1/setup/status')
    if code==200 and value.get('singleCompany') is True and value.get('registrationAllowed') is False:return process,value
   except Exception:pass
   time.sleep(1)
  raise RuntimeError('First-run readiness deadline exceeded')
 # Logs and report are test-only; credentials remain in process memory.
 log=ROOT/'work'/('first-run-log-'+instance+'.txt');log.parent.mkdir(exist_ok=True)
 report={'status':'FAIL','checks':checks,'modelCalls':0,'credentials':'synthetic, omitted','scope':'actual HTTP through public installer; browser DOM not tested'}
 try:
  stream=log.open('w',encoding='utf-8');child,status=launch();assert status['setupRequired'] is True
  checks.append('public start without CLI setup exposes authoritative first-run status')
  assert config.is_file();config_before=config.read_bytes();key_before=hashlib.sha256((state/'session.key').read_bytes()).hexdigest()
  passwords=[secrets.token_urlsafe(24),secrets.token_urlsafe(24)]
  forms=[{'email':f'owner{i}@example.invalid','name':f'First owner {i}','password':passwords[i],'companyName':f'Only company {i}'} for i in range(2)]
  assert request('/api/v1/setup',forms[0])[0]==403;checks.append('setup requires explicit same-origin setup header')
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda f:request('/api/v1/setup',f,setup=True),forms))
  assert sorted(r[0] for r in results)==[201,409],[(r[0],r[1].get('detail')) for r in results]
  winner=next(i for i,r in enumerate(results) if r[0]==201);reply=results[winner][1]
  assert reply.get('setupComplete') is True and reply.get('companyId') and 'token' not in reply and 'password' not in reply
  checks.append('concurrent first-admin/company setup has one winner and one409, returns no credentials')
  assert request('/api/v1/setup',forms[winner],setup=True)[0]==409
  code,status=request('/api/v1/setup/status');assert code==200 and status['setupRequired'] is False and status['registrationAllowed'] is False
  checks.append('replay denied and first-run closes')
  code,auth=request('/api/v1/auths/signin',{'email':forms[winner]['email'],'password':passwords[winner]});assert code==200 and auth.get('token') and auth.get('role')=='admin'
  token=auth['token'];code,companies=request('/api/v1/companies',token=token);assert code==200
  values=companies if isinstance(companies,list) else companies.get('companies',[]);assert len(values)==1
  assert request('/api/v1/companies',{'name':'Forbidden second company'},token)[0] in (403,404,405,409)
  assert request('/api/v1/auths/signup',forms[1-winner])[0] in (403,404)
  assert request('/api/v1/starli/public/session')[0] in (403,404)
  checks.append('native login has one company; registration, guest and second company creation denied')
  stop();child,status=launch();assert status['setupRequired'] is False
  assert config.read_bytes()==config_before and hashlib.sha256((state/'session.key').read_bytes()).hexdigest()==key_before
  assert request('/api/v1/setup',forms[winner],setup=True)[0]==409
  code,auth=request('/api/v1/auths/signin',{'email':forms[winner]['email'],'password':passwords[winner]});assert code==200 and auth.get('token')
  checks.append('restart preserves initialized administrator, configuration and private session key')
  report['status']='PASS'
 except Exception as error:
  report['failure']={'type':type(error).__name__}
  raise
 finally:
  stop()
  if stream:stream.close()
  output=ROOT/'work'/('first-run-result-'+instance+'.json');output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
 print(json.dumps(report));return 0
if __name__=='__main__':raise SystemExit(main())
