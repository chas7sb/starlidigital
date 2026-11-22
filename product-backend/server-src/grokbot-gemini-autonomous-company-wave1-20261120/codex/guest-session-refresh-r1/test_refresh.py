import sys,tempfile,contextlib,io,secrets,json,shutil,sqlite3
from pathlib import Path
base=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(base/'claim-review-r1'));sys.path.insert(0,str(base/'provider-integration-r1'))
from native_auth_staging import create_app
from openrouter_provider import install_public_provider
from guest_workspace import install_guest_workspace
from guest_session_refresh import install_guest_session_refresh

class FixtureProvider:
    def __init__(self):self.calls=0
    async def complete(self,*args,**kwargs):self.calls+=1;return 'Fixture retirement regression reply',{'provider':'FIXTURE','model':'FIXTURE','status':'completed'}

root=tempfile.mkdtemp(prefix='grokbot1-w1-guest-refresh-');checks=[]
try:
 with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
  app=create_app(root,'http://localhost:18181');svc=app.state.grokbot1
  install_guest_session_refresh(app,svc);provider=FixtureProvider();install_public_provider(svc,provider);install_guest_workspace(app,svc,allowed_origins={'http://localhost:18181'})
  from fastapi.testclient import TestClient
  with TestClient(app,client=('127.0.0.1',12345)) as client:
   gh={'Origin':'http://localhost:18181','X-Starli-Guest-Intent':'1'}
   r=client.get('/api/v1/starli/public/session');assert r.status_code==200
   old=client.cookies.get('starli_guest');rid='original-'+secrets.token_hex(8)
   original={'requestId':rid,'originalPrompt':'Plan a local bakery website.'}
   r=client.post('/api/v1/starli/public/grokbot1/intents',json=original,headers=gh);assert r.status_code in (200,201);intent=r.json()['intentId']
   client.get('/api/v1/starli/public/session');assert client.cookies.get('starli_guest')==old
   r=client.post('/api/v1/starli/public/grokbot1/intents',json=original,headers=gh);assert r.status_code==200 and r.json()['intentId']==intent
   checks.append('active cookie GET preserves exact intent provenance/idempotency')
   pw=secrets.token_urlsafe(24)
   r=client.post('/staging/bootstrap-owner',json={'email':'operator@refresh.example','password':pw,'name':'Synthetic private operator'},headers={'Origin':'http://localhost:18181','X-Starli-Staging-Bootstrap':'1'});assert r.status_code==200
   r=client.post('/api/v1/auths/signup',json={'email':'owner@refresh.example','password':pw,'name':'Synthetic native registered owner'});assert r.status_code==200
   r=client.post('/api/v1/auths/signin',json={'email':'owner@refresh.example','password':pw});assert r.status_code==200;token=r.json()['token']
   ah={'Origin':'http://localhost:18181','X-Starli-Claim':'1','Authorization':'Bearer '+token,'Idempotency-Key':'claim-'+secrets.token_hex(8)}
   r=client.post('/api/v1/starli/public/grokbot1/provisional',json={'intentId':intent},headers=gh);assert r.status_code==201
   body={'intentId':intent,'expectedRevision':r.json()['revision']}
   r=client.post('/api/v1/starli/public/grokbot1/claims',json=body,headers=ah);assert r.status_code==401
   assert client.post('/api/v1/starli/grokbot1/reauth',json={'password':pw},headers=ah).status_code==200
   r=client.post('/api/v1/starli/public/grokbot1/claims',json=body,headers=ah);assert r.status_code==200
   with sqlite3.connect(svc.p.intake) as db:before=db.execute('SELECT count(*) FROM revoked_guest_bindings WHERE binding=?',(svc.binding(old),)).fetchone()[0]
   assert before==1;checks.append('actual native password claim retires old signed guest binding')
   pending={'requestId':'new-pending-'+secrets.token_hex(8),'originalPrompt':'Say hello in the new guest conversation.'}
   r=client.post('/api/v1/starli/public/grokbot1/intents',json=pending,headers={**gh,'Cookie':'starli_guest='+old});assert r.status_code==403
   checks.append('retired cookie cannot submit new intent before refresh')
   r=client.get('/api/v1/starli/public/session',headers={'Cookie':'starli_guest='+old,'Authorization':'Bearer invalid-stale-native-session'});assert r.status_code==200
   fresh=client.cookies.get('starli_guest');assert fresh!=old
   r=client.post('/api/v1/starli/public/grokbot1/intents',json=pending,headers={**gh,'Authorization':'Bearer invalid-stale-native-session'});assert r.status_code in (200,201),r.text
   newintent=r.json()['intentId'];assert r.json()['requestId']==pending['requestId'] and newintent!=intent
   checks.append('GET native session reissues only retired guest; stale native bearer cannot block guest; pending request ID unchanged')
   url='/api/v1/starli/public/grokbot1/intents/'+newintent+'/workspace';r=client.get(url);assert r.status_code==200 and len(r.json()['messages'])==1 and provider.calls==0
   turn={'requestId':pending['requestId'],'replyToMessageId':r.json()['messages'][0]['id']}
   r=client.post(url+'/messages',json=turn,headers=gh);assert r.status_code==200 and r.json()['replyState']=='COMPLETE' and len(r.json()['messages'])==2 and provider.calls==1
   client.get(url);client.post(url+'/messages',json=turn,headers=gh);assert provider.calls==1
   checks.append('new guest canonical GET and explicit reply/replay pass native path once with fixture provider')
   with sqlite3.connect(svc.p.intake) as db:assert db.execute('SELECT count(*) FROM revoked_guest_bindings WHERE binding=?',(svc.binding(old),)).fetchone()[0]==1
   r=client.get('/api/v1/starli/public/grokbot1/intents/'+intent+'/workspace',headers={'Cookie':'starli_guest='+old});assert r.status_code==403
   r=client.get('/api/v1/auths/',headers={'Authorization':'Bearer invalid-stale-native-session'});assert r.status_code==401
   checks.append('old binding remains retired; no old claim reuse or native auth bypass')
 Path(sys.argv[1]).write_text(json.dumps({'passed':True,'uid':__import__('os').getuid(),'executionClass':'NATIVE_NONPRODUCTION','fixtureProvider':True,'fixtureInferenceCalls':provider.calls,'realInferenceCalls':0,'harnessMintedUsersOrJwt':False,'checks':checks,'productionModified':False},indent=2)+'\n')
 print(json.dumps({'passed':True,'checks':len(checks),'realInferenceCalls':0}))
finally:shutil.rmtree(root)
