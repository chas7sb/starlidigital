"""Actual native setup, rollback, races, permanent lock and company invariants; no models."""
import concurrent.futures,importlib.util,json,secrets,sqlite3,uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent
def main():
 s=importlib.util.spec_from_file_location('singleton_test_server',HERE/'local_server.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
 state=HERE.parent/'work'/('singleton-qa-'+uuid.uuid4().hex[:12]);origin='http://127.0.0.1:18381';app=m.create_app(state,origin);ns=app.state.native;policy=app.state.installation
 assert Path(ns.paths.main)==Path(ns.paths.authority)
 from fastapi.testclient import TestClient
 password=secrets.token_urlsafe(24);body={'name':'Initial administrator','email':'singleton-owner@example.invalid','password':password,'companyName':'The sole company'};setup_headers={'Origin':origin,'X-Starli-Setup':'1'}
 with TestClient(app,base_url=origin,client=('127.0.0.1',50000)) as c:
  value=c.get('/api/v1/setup/status').json();assert value['setupRequired']and value['singleCompany']and not value['registrationAllowed']
  assert c.get('/health').status_code==200
  assert c.post('/api/v1/setup',headers={'Origin':'http://127.0.0.1:9999','X-Starli-Setup':'1'},json=body).status_code==403
  assert c.post('/api/v1/setup',headers={**setup_headers,'Host':'evil.example'},json=body).status_code==403
  for host in ['127.0.0.1:invalid','127.0.0.1:999999','127.0.0.1:18381?query','127.0.0.1:18381#fragment']:
   assert c.post('/api/v1/setup',headers={**setup_headers,'Host':host},json=body).status_code==403,host
  invalid=c.post('/api/v1/setup',headers=setup_headers,json={**body,'unexpectedPasswordField':password});assert invalid.status_code==422 and password not in invalid.text
  def fail():raise RuntimeError('Injected failure after native account inserts')
  try:policy.setup(name=body['name'],email=body['email'],password=password,company_name=body['companyName'],after_user=fail)
  except RuntimeError:pass
  else:raise AssertionError('Failure injection did not run')
  try:policy.setup(name=body['name'],email=body['email'],password=password,company_name=body['companyName'],before_commit=fail)
  except RuntimeError:pass
  else:raise AssertionError('Failure before commit did not run')
  with sqlite3.connect(ns.paths.main) as db:
   for table in ['user','auth','companies','members','local_first_run','local_installation_company']:assert db.execute('SELECT count(*) FROM '+table).fetchone()[0]==0,table
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   results=list(pool.map(lambda i:c.post('/api/v1/setup',headers=setup_headers,json={**body,'email':f'owner{i}@example.invalid'}),range(2)))
  assert sorted(r.status_code for r in results)==[201,409],[(r.status_code,r.text)for r in results]
  winner=next(i for i,r in enumerate(results)if r.status_code==201);company=results[winner].json()['companyId'];assert 'token'not in results[winner].json() and password not in results[winner].text
  assert c.post('/api/v1/setup',headers=setup_headers,json=body).status_code==409
  with sqlite3.connect(ns.paths.main) as db:
   assert [db.execute('SELECT count(*) FROM '+table).fetchone()[0]for table in ['user','auth','companies','local_first_run','local_installation_company']]==[1]*5
   assert db.execute('SELECT role FROM user').fetchone()[0]=='admin';assert db.execute('SELECT role FROM members').fetchone()[0]=='owner'
  signed=c.post('/api/v1/auths/signin',json={'email':f'owner{winner}@example.invalid','password':password});assert signed.status_code==200,signed.text[:100]
  h={'Authorization':'Bearer '+signed.json()['token'],'Origin':origin}
  templates=c.get('/api/v1/bot-directory/templates',headers=h).json()['templates'];bots=[]
  for i in range(2):
   r=c.post('/api/v1/bot-directory/installs',headers=h,json={'templateId':templates[i%len(templates)]['id'],'scope':'company','companyId':company,'installKey':'singleton-bot-'+str(i)});assert r.status_code==200,r.text;bot=r.json()['bot']['id'];bots.append(bot)
   r=c.post('/api/v1/company-pilot/'+company+'/admit-bot',headers={**h,'idempotency-key':'singleton-admit-'+str(i)},json={'bot_id':bot});assert r.status_code==200,r.text
  prefix='/api/v1/starli/companies/'+company+'/messaging'
  owner=signed.json()['id']
  r=c.post(prefix+'/work-sessions',headers={**h,'idempotency-key':'singleton-team'},json={'name':'First-owner team','administratorId':owner,'botIds':bots,'maxTurns':2});assert r.status_code==201,r.text;room=r.json()['id'];revision=r.json()['revision']
  r=c.post(prefix+'/work-sessions/'+room+'/commands',headers={**h,'idempotency-key':'singleton-floor'},json={'action':'take_floor','expectedRevision':revision});assert r.status_code==200,r.text
  r=c.post(prefix+'/work-sessions/'+room+'/commands',headers={**h,'idempotency-key':'singleton-direction'},json={'action':'intervene','expectedRevision':r.json()['revision'],'content':'Human direction after browser setup'});assert r.status_code==200 and r.json()['messageId'],r.text
  readback=c.get(prefix+'/rooms/'+room+'/messages',headers=h);assert readback.status_code==200 and any(x['content']=='Human direction after browser setup' for x in readback.json()['messages']),readback.text
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
   seconds=list(pool.map(lambda i:c.post('/api/v1/companies',headers=h,json={'name':'Forbidden second '+str(i)}),range(4)))
  assert all(r.status_code==409 for r in seconds)
  # The database boundary catches alternate/direct creation writers, not just the HTTP route.
  with sqlite3.connect(ns.paths.authority) as db:
   for sql,args in [('INSERT INTO companies VALUES(?,?)',(str(uuid.uuid4()),'Bypass')),('DELETE FROM companies',()),('DELETE FROM local_first_run',()),('DELETE FROM local_installation_company',())]:
    try:db.execute(sql,args)
    except sqlite3.IntegrityError:db.rollback()
    else:raise AssertionError('Singleton invariant bypassed: '+sql)
  assert c.get('/api/v1/companies/not-this-company/directory',headers=h).status_code in(403,404)
  for path in ['/api/v1/auths/signup','/api/v1/starli/public/session','/api/v1/starli/public/grokbot1/intents','/api/v1/starli/grokbot1/claims/x/resume','/api/v1/company-pilot/company']:
   assert c.post(path,json=body).status_code in(403,404),path
  assert c.get('/api/v1/setup/status').json()['setupRequired']is False
  from local_installation import Installation
  assert Installation(ns).status()['setupLocked']is True
  # Legacy configured layout remains separate and unchanged; no private key is read.
  from types import SimpleNamespace
  legacy=state/'legacy-fixture';legacy.mkdir();main=legacy/'native.sqlite';authority=legacy/'authority.sqlite'
  with sqlite3.connect(main) as db:db.execute('CREATE TABLE user(id TEXT,created_at INTEGER,role TEXT)');db.execute("INSERT INTO user VALUES('existing-owner',1,'admin')")
  a=ns.RbacAuthority(str(authority));legacy_company=a.create('existing-owner','Retained company','Retained owner');a.db.close()
  fake=SimpleNamespace(paths=SimpleNamespace(main=main,authority=authority));old=Installation(fake)
  assert old.status()['setupLocked']and old.status()['companyConfigured']
  with sqlite3.connect(main) as db:assert db.execute('SELECT id,role FROM user').fetchall()==[('existing-owner','admin')]
  with sqlite3.connect(authority) as db:assert db.execute('SELECT id,name FROM companies').fetchall()==[(legacy_company,'Retained company')]
  invalid=state/'multi-company-fixture';invalid.mkdir();multi=invalid/'authority.sqlite'
  a=ns.RbacAuthority(str(multi));a.create('owner','One','Owner');a.create('owner','Two','Owner');a.db.close()
  try:Installation(SimpleNamespace(paths=SimpleNamespace(main=main,authority=multi)))
  except Exception as error:assert str(error)=='SINGLE_COMPANY_MIGRATION_REQUIRED'
  else:raise AssertionError('Existing multiple companies were adopted')
  with sqlite3.connect(multi) as db:assert db.execute('SELECT name FROM companies ORDER BY name').fetchall()==[('One',),('Two',)]
 report={'status':'PASS','checks':['fresh private boot before owner','strict browser Origin/Host guards','password-safe validation','atomic rollback leaves no account/company/lock','concurrent first setup exactly one201 and one409','native administrator sign-in','first-owner canonical membership audit supports actual team and human direction','one administrator plus one owner company','permanent setup lock','four concurrent second-company creates denied','database-trigger alternate-writer/deletion protection','wrong-company access denied','signup/guest/claim/pilot-company creation disabled'],'modelCalls':0,'externalActions':0}
 (HERE/'SINGLE-COMPANY-VALIDATION.json').write_bytes((json.dumps(report,indent=2)+'\n').encode());print(json.dumps(report))
if __name__=='__main__':main()
