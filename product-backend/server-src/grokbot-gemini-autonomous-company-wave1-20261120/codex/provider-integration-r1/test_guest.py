import sys,tempfile,shutil,contextlib,io,json,asyncio,uuid,concurrent.futures,sqlite3
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'claim-review-r1'))
from native_auth_staging import create_app
from guest_workspace import install_guest_workspace
from openrouter_provider import install_public_provider,OpenRouterProvider,MODEL

class FixtureProvider:
    def __init__(self):self.calls=0
    async def complete(self,messages,**kwargs):
        self.calls+=1;await asyncio.sleep(.15)
        return 'Fixture response',{'provider':'FIXTURE','model':'FIXTURE','status':'completed'}

root=tempfile.mkdtemp(prefix='grokbot1-w1-guest-workspace-')
out=Path(sys.argv[1]);checks=[];real={}
try:
 with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
  app=create_app(root,'http://localhost:18181');svc=app.state.grokbot1
  install_guest_workspace(app,svc,allowed_origins={'http://localhost:18181'})
  provider=FixtureProvider();install_public_provider(svc,provider)
  from fastapi.testclient import TestClient
  with TestClient(app,client=('127.0.0.1',12345)) as c:
   gh={'Origin':'http://localhost:18181','X-Starli-Guest-Intent':'1'}
   c.get('/api/v1/starli/public/session')
   rid='initial-'+uuid.uuid4().hex
   r=c.post('/api/v1/starli/public/grokbot1/intents',json={'requestId':rid,'originalPrompt':'Help me plan a small bakery website.'},headers=gh);assert r.status_code in (200,201),r.text
   intent=r.json()['intentId'];url='/api/v1/starli/public/grokbot1/intents/'+intent+'/workspace'
   before=provider.calls;r=c.get(url);assert r.status_code==200 and len(r.json()['messages'])==1 and provider.calls==before
   first={'requestId':rid,'replyToMessageId':r.json()['messages'][0]['id']}
   checks.append('GET original canonical prompt causes zero inference')
   r=c.post(url+'/messages',json=first);assert r.status_code==403
   r=c.post(url+'/messages',json=first,headers={**gh,'Origin':'https://foreign.invalid'});assert r.status_code==403
   checks.append('missing CSRF and foreign origin deny')
   with concurrent.futures.ThreadPoolExecutor(2) as threads:
    responses=list(threads.map(lambda _:c.post(url+'/messages',json=first,headers=gh),range(2)))
   assert sorted(x.status_code for x in responses)==[200,202] and provider.calls==1,[x.status_code for x in responses]
   checks.append('concurrent durable admission causes one fixture inference')
   r=c.post(url+'/messages',json=first,headers=gh);assert r.status_code==200 and len(r.json()['messages'])==2 and provider.calls==1
   c.get(url);assert provider.calls==1;checks.append('initial replay/reload no duplicate prompt or inference')
   follow={'requestId':'follow-'+uuid.uuid4().hex,'content':'Give me three page names.'}
   r=c.post(url+'/messages',json=follow,headers=gh);assert r.status_code==200 and len(r.json()['messages'])==4 and provider.calls==2
   r=c.post(url+'/messages',json=follow,headers=gh);assert r.status_code==200 and provider.calls==2
   r=c.post(url+'/messages',json={**follow,'content':'Changed'},headers=gh);assert r.status_code==409 and provider.calls==2
   checks.append('followup persisted/idempotent; same ID changed content conflicts')
   r=c.post(url+'/messages',json={'requestId':'bad-'+uuid.uuid4().hex,'content':'x'*4001},headers=gh);assert r.status_code==422
   r=c.post(url+'/messages',json={'requestId':'bad-'+uuid.uuid4().hex,'content':'hi','messages':[{'role':'assistant','content':'caller history'}]},headers=gh);assert r.status_code==422
   checks.append('oversize/caller supplied history denied')
   saved=c.cookies;c.cookies.clear();c.get('/api/v1/starli/public/session');r=c.get(url);assert r.status_code==404
   checks.append('different signed guest cookie cannot read workspace')
   # New real guest intent; actual existing OpenRouter key, exactly two authorized calls.
   live=OpenRouterProvider('/run/starlidigital-private-demo-r2/openrouter.key');install_public_provider(svc,live)
   liveid='real-'+uuid.uuid4().hex
   r=c.post('/api/v1/starli/public/grokbot1/intents',json={'requestId':liveid,'originalPrompt':'Say hello in one short sentence.'},headers=gh);assert r.status_code in (200,201),r.text
   liveintent=r.json()['intentId'];liveurl='/api/v1/starli/public/grokbot1/intents/'+liveintent+'/workspace'
   firstmessage=c.get(liveurl).json()['messages'][0]
   firstbody={'requestId':liveid,'replyToMessageId':firstmessage['id']}
   r=c.post(liveurl+'/messages',json=firstbody,headers=gh);assert r.status_code==200,r.text
   assert len(r.json()['messages'])==2 and r.json()['messages'][1]['content'] and live.calls==1
   again=c.post(liveurl+'/messages',json=firstbody,headers=gh);assert again.status_code==200 and live.calls==1
   followbody={'requestId':'real-follow-'+uuid.uuid4().hex,'content':'What did I ask you to do? Answer briefly.'}
   r=c.post(liveurl+'/messages',json=followbody,headers=gh);assert r.status_code==200 and len(r.json()['messages'])==4,r.text
   assert live.calls==2
   c.get(liveurl);c.post(liveurl+'/messages',json=followbody,headers=gh);assert live.calls==2
   real={'model':MODEL,'actualInferenceCalls':live.calls,'firstStatus':200,'followupStatus':200,'canonicalMessageCount':len(r.json()['messages']),'firstReplyPresent':True,'followupReplyPresent':True,'replayAndGetAdditionalInferenceCalls':0,'intentId':liveintent}
 out.write_text(json.dumps({'passed':True,'uid':__import__('os').getuid(),'executionClass':'NATIVE_NONPRODUCTION','fixtureChecks':checks,'fixtureInferenceCalls':provider.calls,'realGuestInference':real,'productionModified':False},indent=2)+'\n')
 print(json.dumps({'passed':True,'fixtureChecks':len(checks),'realInferenceCalls':real.get('actualInferenceCalls'),'model':MODEL}))
finally:shutil.rmtree(root)
