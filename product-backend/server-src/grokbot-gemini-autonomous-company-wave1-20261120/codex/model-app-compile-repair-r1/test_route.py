import sys,tempfile,sqlite3,json,asyncio,types,shutil,os
from pathlib import Path
from fastapi import FastAPI,Request
from fastapi.testclient import TestClient
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'model-app-execution-r1'))
from model_app_compile_repair import install_model_app_compile_repair,INTENT,BUILD,VERSION,sha
root=Path(tempfile.mkdtemp(prefix='grokbot1-w1-repair-unit-'))
try:
 key=root/'.model-app-control.key';key.write_text('test-private-control');key.chmod(0o600)
 path=root/'intake.sqlite';source=[{'id':'guest-original:'+INTENT,'role':'user','content':'Fixture source'}]
 snapshot={'intentId':INTENT,'guestBinding':'fixture-binding','companyId':'fixture-company','projectId':'fixture-project','requestId':'fixture-request','messages':source}
 class Context:
  def __init__(self):self.initial=dict(snapshot)
  def revalidate(self):return dict(snapshot)
  def revalidate_build(self,s):return self.revalidate()
 class Authority:
  def resolve_guest_request(self,r,i):
   if r.cookies.get('starli_guest')!='actual-fixture-cookie':raise __import__('fastapi').HTTPException(403,'COOKIE_REQUIRED')
   return Context()
 class Lifecycle:
  def __init__(self):self.apps={};self.calls=0
  async def on_built(self,result,ctx):self.calls+=1;return {'artifactDigest':'a'*64,'preview':{'previewId':BUILD}}
 result={'buildId':BUILD,'intentId':INTENT,'sourceMessageId':source[0]['id'],'companyId':snapshot['companyId'],'projectId':snapshot['projectId'],'requestId':snapshot['requestId'],'provider':'OPENROUTER_MODEL','modelCalls':2,'outputs':[{},{}]}
 directory=root/'model-app-state'/BUILD;directory.mkdir(parents=True);(directory/'compile-input.json').write_text(json.dumps({'execution':result}))
 with sqlite3.connect(path) as c:
  c.execute('CREATE TABLE guest_model_app_jobs(id TEXT,intent TEXT,binding TEXT,source TEXT,conversation_hash TEXT,state TEXT,result TEXT,error TEXT)')
  c.execute('INSERT INTO guest_model_app_jobs VALUES(?,?,?,?,?,?,?,?)',(BUILD,INTENT,'fixture-binding',source[0]['id'],sha(source),'INTERRUPTED','{}','MODEL_APP_COMPILE_FAILED'))
 app=FastAPI();nonce='fixture-current-nonce'
 @app.get('/internal/v1/model-app-control/instance')
 def instance(request:Request):return {'pid':os.getpid(),'instanceNonce':nonce}
 lifecycle=Lifecycle();install_model_app_compile_repair(app,types.SimpleNamespace(p=types.SimpleNamespace(root=root,intake=path)),Authority(),None,lifecycle)
 headers={'X-Starli-Model-Control':'test-private-control','X-Starli-Control-Instance':nonce,'Cookie':'starli_guest=actual-fixture-cookie'};body={'intentId':INTENT,'buildId':BUILD,'approvedRepairVersion':VERSION};url='/internal/v1/model-app-control/'+BUILD+'/compile-repair'
 with TestClient(app,client=('127.0.0.1',123)) as c:
  assert c.post(url,json=body).status_code==403
  assert c.post(url,json=body,headers={**headers,'X-Starli-Control-Instance':'old'}).status_code==409
  assert c.post(url,json={**body,'approvedRepairVersion':'unapproved'},headers=headers).status_code==403
  assert c.post(url,json=body,headers={**headers,'Cookie':'starli_guest=wrong'}).status_code==403
  r=c.post(url,json=body,headers=headers);assert r.status_code==200,r.text;assert lifecycle.calls==1
  assert c.post(url,json=body,headers=headers).json()==r.json() and lifecycle.calls==1
 with sqlite3.connect(path) as c:
  row=c.execute('SELECT state,error FROM guest_model_app_jobs').fetchone();assert row==('READY',None)
  row=c.execute('SELECT state,original_error FROM model_app_compile_repairs').fetchone();assert row==('COMPLETE','MODEL_APP_COMPILE_FAILED')
 print(json.dumps({'passed':True,'uid':os.getuid(),'fixtureOnly':True,'checks':7,'actualModelCalls':0,'actualWorkerDispatch':0}))
finally:shutil.rmtree(root)
