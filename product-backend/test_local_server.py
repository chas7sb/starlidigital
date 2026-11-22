"""Actual local ASGI calls, fresh native schemas, no inference or provider credentials."""
import importlib.util,json,secrets,uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent
def main():
 spec=importlib.util.spec_from_file_location('product_local_server',HERE/'local_server.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 state=HERE.parent/'work'/('new-product-qa-'+uuid.uuid4().hex[:12]);origin='http://127.0.0.1:18381'
 app=m.create_app(state,origin)
 from fastapi.testclient import TestClient
 svc=app.state.grokbot1;ns=svc.ns
 password=secrets.token_urlsafe(24)
 owner=ns.Auths.insert_new_auth('owner@example.invalid',ns.auth.get_password_hash(password),'Local QA owner','/user.png','admin')
 checks=[]
 with TestClient(app,base_url=origin) as c:
  r=c.get('/health');assert r.status_code==200 and r.json()['providerConfigured'] is False;checks.append('truthful health')
  r=c.post('/api/v1/auths/signin',json={'email':'owner@example.invalid','password':password});assert r.status_code==200,r.text[:100];token=r.json()['token'];headers={'Authorization':'Bearer '+token,'Origin':origin}
  checks.append('native password signin')
  r=c.post('/api/v1/companies',headers=headers,json={'name':'Fresh collaboration company'});assert r.status_code==200,r.text[:100];company=r.json()['company_id'];checks.append('native company create')
  r=c.get('/api/v1/companies/'+company+'/directory',headers=headers);assert r.status_code==200;checks.append('owner company directory')
  r=c.get('/api/v1/bot-directory/templates',headers=headers);assert r.status_code==200,r.text[:100];templates=r.json()['templates'];assert templates
  bots=[]
  for i in range(2):
   r=c.post('/api/v1/bot-directory/installs',headers=headers,json={'templateId':templates[i%len(templates)]['id'],'scope':'company','companyId':company,'installKey':'qa-install-'+str(i)});assert r.status_code==200,r.text[:150];bot=r.json()['bot']['id'];bots.append(bot)
   r=c.post('/api/v1/company-pilot/'+company+'/admit-bot',headers={**headers,'idempotency-key':'qa-admit-'+str(i)},json={'bot_id':bot});assert r.status_code==200,r.text[:150]
  checks.append('two actual company bots installed and explicitly admitted')
  prefix='/api/v1/starli/companies/'+company+'/messaging'
  r=c.post(prefix+'/work-sessions',headers={**headers,'idempotency-key':'qa-team-session'},json={'name':'QA team work','administratorId':owner.id,'botIds':bots,'maxTurns':2});assert r.status_code==201,r.text[:200];room=r.json()['id'];checks.append('bounded two-bot team work session created')
  r=c.get(prefix+'/work-sessions/'+room,headers=headers);assert r.status_code==200 and r.json()['botIds']==bots;checks.append('team session persisted readback without simulated inference')
  c.cookies.clear();r=c.get('/api/v1/companies/'+company+'/directory');assert r.status_code in (401,403),r.status_code;checks.append('unauthenticated company denied')
  c.cookies.clear();r=c.get('/api/v1/starli/public/session');assert r.status_code==200,r.text[:100]
  request={'requestId':'qa-'+uuid.uuid4().hex,'originalPrompt':'Create a company collaboration workspace'}
  r=c.post('/api/v1/starli/public/grokbot1/intents',headers={'Origin':origin,'x-starli-guest-intent':'1'},json=request);assert r.status_code==201,r.text[:150];intent=r.json()['intentId'];checks.append('native cookie guest intent and provisional company')
  r=c.get('/api/v1/starli/public/grokbot1/intents/'+intent+'/workspace');assert r.status_code==200,r.text[:150];assert r.json()['messages'][0]['content']==request['originalPrompt'];checks.append('persisted guest workspace readback')
  r=c.post('/api/v1/starli/public/grokbot1/intents/'+intent+'/workspace/messages',headers={'Origin':origin,'x-starli-guest-intent':'1'},json={'requestId':'qa-'+uuid.uuid4().hex,'content':'Hello'});assert r.status_code==503,r.status_code;checks.append('unconfigured inference fails closed without fallback')
  r=c.get('/api/v1/starli/orchestration/graphs/example/progress');assert r.status_code==503;checks.append('unconfigured worker fails closed')
 report={'status':'PASS','checks':checks,'modelCalls':0,'externalActions':0,'state':'disposable local work directory; credentials omitted','limitations':['No model/provider credentials configured','No orchestration execution or preview lifecycle claimed','ASGI TestClient validation; separate socket launch validation required']}
 (HERE/'LOCAL-VALIDATION.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
if __name__=='__main__':main()
