"""Native sink/authority integration using an explicit model fixture, NEVER inference evidence."""
import asyncio,importlib.util,json,secrets,time,uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent
def main():
 s=importlib.util.spec_from_file_location('native_collab_test_server',HERE/'local_server.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
 state=HERE.parent/'work'/('native-collab-fixture-'+uuid.uuid4().hex[:12]);origin='http://127.0.0.1:18381';app=m.create_app(state,origin);ns=app.state.grokbot1.ns
 from fastapi.testclient import TestClient
 import local_provider
 password=secrets.token_urlsafe(24);ns.Auths.insert_new_auth('collab-owner@example.invalid',ns.auth.get_password_hash(password),'Collaboration fixture owner','/user.png','admin')
 calls=[]
 async def fixture(selection,messages,instructions):
  calls.append(selection['botId'])
  if 'Return ONLY JSON' in instructions:
   question=json.loads(messages[-1]['content'])
   text=json.dumps({'requests':[],'done':True})if question['round']>1 else json.dumps({'requests':[{'agentId':bot['id'],'message':'Unit fixture request for '+bot['name']}for bot in question['allowedTeammates']],'done':False})
  else:text='Explicit fixture answer; not a model inference'
  return {'answer':text,'provider':'TEST_FIXTURE','model':local_provider.MODEL,'receipt':{'executionClass':'TEST_FIXTURE','provider':'TEST_FIXTURE','model':local_provider.MODEL,'status':'completed','responseId':'fixture-'+str(len(calls))}}
 original=local_provider.provider_complete;local_provider.provider_complete=fixture
 try:
  with TestClient(app,base_url=origin,client=('127.0.0.1',50000)) as c:
   token=c.post('/api/v1/auths/signin',json={'email':'collab-owner@example.invalid','password':password}).json()['token'];h={'Authorization':'Bearer '+token,'Origin':origin}
   company=c.post('/api/v1/companies',headers=h,json={'name':'Collaboration fixture'}).json()['company_id'];base='/api/v1/companies/'+company
   template=c.get('/api/v1/bot-directory/templates',headers=h).json()['templates'][0]['id'];bots=[]
   connection=c.post(base+'/provider-connections',headers=h,json={'provider':'openrouter','credential':{'apiKey':'sk-or-v1-synthetic-fixture-only-never-network'}}).json()['connectionId']
   for i in range(3):
    bot=c.post('/api/v1/bot-directory/installs',headers=h,json={'templateId':template,'scope':'company','companyId':company,'installKey':'fixture-bot-'+str(i)}).json()['bot']['id'];bots.append(bot)
    assert c.post('/api/v1/company-pilot/'+company+'/admit-bot',headers={**h,'idempotency-key':'fixture-admit-'+str(i)},json={'bot_id':bot}).status_code==200
    assert c.put(base+'/bots/'+bot+'/provider-selection',headers=h,json={'connectionId':connection,'model':local_provider.MODEL,'expectedRevision':0}).status_code==200
   prefix='/api/v1/starli/companies/'+company+'/messaging'
   r=c.post(prefix+'/rooms',headers={**h,'idempotency-key':'fixture-room'},json={'kind':'group','visibility':'private','name':'Team fixture','agentIds':bots});assert r.status_code==201,r.text;room=r.json()['id']
   r=c.post(prefix+'/rooms/'+room+'/messages',headers={**h,'idempotency-key':'fixture-source'},json={'content':'Discuss this unit test objective'});assert r.status_code==201,r.text;source=r.json()['message']['id']
   url=prefix+'/rooms/'+room+'/collaborations';body={'bossId':bots[0],'teammateIds':bots[1:],'sourceMessageId':source}
   r=c.post(url,headers={**h,'idempotency-key':'fixture-run'},json=body);assert r.status_code==202,r.text;run=r.json()['runId']
   for _ in range(100):
    r=c.get(url+'/'+run,headers=h);assert r.status_code==200,r.text;value=r.json()
    if value['state']not in ('QUEUED','RUNNING'):break
    time.sleep(.05)
   assert value['state']=='COMPLETED',value
   assert calls==[bots[0],bots[1],bots[2],bots[0],bots[0]],calls
   assert value['participantCoverage']=={'selectedIds':bots[1:],'repliedIds':bots[1:],'missingIds':[]}
   posted=value['messages'];assert [p['kind']for p in posted]==['request','reply','request','reply','final'];assert all(p['state']=='POSTED'and p['messageId']for p in posted)
   native=c.get(prefix+'/rooms/'+room+'/messages',headers=h).json()['messages'];ids={p['messageId']for p in posted}
   saved=[x for x in native if x['id']in ids];assert len(saved)==5 and all(x['speaker']['kind']=='agent' for x in saved)
   assert {x['speaker']['id']for x in saved}==set(bots)
   assert all(x['runId'] is None and x['attribution']['requestedBy'] for x in saved)
   with app.state.company_messaging.db(readonly=True) as db:
    assert db.execute('SELECT 1 FROM cr_turns WHERE id=?',(run,)).fetchone()is None
    for message in saved:
     meta=json.loads(db.execute('SELECT meta FROM message WHERE id=?',(message['id'],)).fetchone()[0])
     assert meta['collaboration']['runId']==run
     assert meta['attribution']['requestedBy']==message['attribution']['requestedBy']
   replay=c.post(url,headers={**h,'idempotency-key':'fixture-run'},json=body);assert replay.status_code==202 and replay.json()['runId']==run
   assert c.post(url,headers={**h,'Origin':'http://127.0.0.1:9999','idempotency-key':'blocked'},json=body).status_code==403
   turn_url='/api/v1/starli/companies/'+company+'/rooms/'+room+'/bots/'+bots[0]+'/runtime/turns'
   r=c.post(turn_url,headers={**h,'idempotency-key':'fixture-direct-turn'},json={'prompt':'Unit fixture direct native chat'});assert r.status_code==200,r.text;turn=r.json()['runId']
   for _ in range(100):
    current=c.get(turn_url+'/'+turn,headers=h);assert current.status_code==200,current.text
    if current.json()['status']not in ('RUNNING','QUEUED'):break
    time.sleep(.05)
   assert current.json()['status']=='ANSWERED',current.text
   direct=c.get(prefix+'/rooms/'+room+'/messages',headers=h).json()['messages']
   assert any(x['id']==current.json()['assistantMessageId'] and x['runId']==turn for x in direct)
   result=c.get(base+'/rooms/'+room+'/bots/'+bots[0]+'/runs/'+turn+'/receipt',headers=h);assert result.status_code==200,result.text
   assert result.json()['receipt']['executionClass']=='TEST_FIXTURE'
  report={'status':'PASS','scope':'native collaboration integration with explicit model fixture','actualInference':False,'externalCalls':0,'checks':['native human source required','selected company bots only','Boss request/teammate reply/Boss final native persisted agent messages','per-bot selected configuration captured','durable run/model/message receipts','idempotent replay','cross-origin mutation denied']}
  (HERE/'COLLABORATION-ROUTES-VALIDATION.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
 finally:local_provider.provider_complete=original
if __name__=='__main__':main()
