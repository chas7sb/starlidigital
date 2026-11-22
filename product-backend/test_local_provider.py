"""Provider configuration/security integration only. No actual inference proof."""
import asyncio,importlib.util,json,secrets,uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent
def main():
 spec=importlib.util.spec_from_file_location('provider_test_server',HERE/'local_server.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 state=HERE.parent/'work'/('provider-config-qa-'+uuid.uuid4().hex[:12]);origin='http://127.0.0.1:18381';app=m.create_app(state,origin);ns=app.state.native
 from fastapi.testclient import TestClient
 from local_provider import MODEL
 password=secrets.token_urlsafe(24);ns.Auths.insert_new_auth('provider-owner@example.invalid',ns.auth.get_password_hash(password),'Provider QA','/user.png','admin')
 with TestClient(app,base_url=origin,client=('127.0.0.1',50000)) as c:
  token=c.post('/api/v1/auths/signin',json={'email':'provider-owner@example.invalid','password':password}).json()['token'];h={'Authorization':'Bearer '+token,'Origin':origin}
  company=c.post('/api/v1/companies',headers=h,json={'name':'Provider QA'}).json()['company_id']
  template=c.get('/api/v1/bot-directory/templates',headers=h).json()['templates'][0]['id']
  bot=c.post('/api/v1/bot-directory/installs',headers=h,json={'templateId':template,'scope':'company','companyId':company,'installKey':'provider-qa'}).json()['bot']['id']
  assert c.post('/api/v1/company-pilot/'+company+'/admit-bot',headers={**h,'idempotency-key':'provider-admit'},json={'bot_id':bot}).status_code==200
  base='/api/v1/companies/'+company
  for credential in [{'apiKey':'unknown-openai-key'},{'apiKey':'sk-or-v1-synthetic-fixture-only','baseUrl':'http://example.test'}]:
   assert c.post(base+'/provider-connections',headers=h,json={'provider':'openrouter','credential':credential}).status_code>=400
  synthetic='sk-or-v1-synthetic-fixture-only-never-used-for-network'
  saved=c.post(base+'/provider-connections',headers=h,json={'provider':'openrouter','credential':{'apiKey':synthetic}});assert saved.status_code==200,saved.text
  connection=saved.json()['connectionId'];assert synthetic.encode()not in(state/'data/company-providers.sqlite').read_bytes()
  public=c.get(base+'/provider-connections',headers=h);assert synthetic not in public.text
  selection=base+'/bots/'+bot+'/provider-selection'
  body={'connectionId':connection,'model':MODEL,'expectedRevision':0}
  r=c.put(selection,headers=h,json=body);assert r.status_code==200,r.text;assert r.json()['revision']==1
  assert c.put(selection,headers=h,json=body).status_code==409
  assert c.put(selection,headers={'Authorization':'Bearer '+token,'Origin':'http://127.0.0.1:9999'},json={**body,'expectedRevision':1}).status_code==403
  r=c.get(selection,headers=h);assert r.status_code==200 and r.json()['model']==MODEL and synthetic not in r.text
  assert c.get(base+'/bots/'+bot+'/provider-options',headers=h).status_code==200
  assert c.get('/local/provider').status_code==200
  assert c.get('/health').json()['modelExecution']=='CONFIGURED_NOT_YET_VERIFIED'
 report={'status':'PASS','scope':'configuration/security integration; no actual inference','checks':['reject unknown-key and arbitrary-endpoint credentials','encrypted company key persistence','no key in public connection/selection DTO','per-bot selection persistence','stale selection conflict','cross-origin provider mutation denied','provider options route','local setup page','configured-not-verified health'],'modelCalls':0,'externalActions':0}
 (HERE/'PROVIDER-VALIDATION.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
if __name__=='__main__':main()
