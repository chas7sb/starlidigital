import sys,tempfile,contextlib,io,secrets,json,shutil,sqlite3,os
from pathlib import Path
base=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(base/'claim-review-r1'));sys.path.insert(0,str(base/'provider-integration-r1'));sys.path.insert(0,str(base/'guest-build-tools-r1'));sys.path.insert(0,str(Path(__file__).parent))
from native_auth_staging import create_app
from guest_company_authority import install_guest_company_authority,guard_guest_write
from guest_workspace import install_guest_workspace
from openrouter_provider import install_public_provider
class FixtureProvider:
 async def complete(self,*a,**k):return 'Fixture reply, no live inference',{'provider':'FIXTURE','model':'FIXTURE','status':'completed'}
root=tempfile.mkdtemp(prefix='grokbot1-w1-guest-authority-');checks=[]
try:
 with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
  app=create_app(root,'http://localhost:18181');svc=app.state.grokbot1
  a=install_guest_company_authority(app,svc,allowed_origins={'http://localhost:18181'})
  install_public_provider(svc,FixtureProvider());install_guest_workspace(app,svc,allowed_origins={'http://localhost:18181'},authority=a)
  from fastapi.testclient import TestClient
  from starlette.requests import Request
  with TestClient(app,client=('127.0.0.1',12345)) as c:
   gh={'Origin':'http://localhost:18181','X-Starli-Guest-Intent':'1'};assert c.get('/api/v1/starli/public/session').status_code==200
   rid='initial-'+secrets.token_hex(8);r=c.post('/api/v1/starli/public/grokbot1/intents',json={'requestId':rid,'originalPrompt':'Build a shared bakery order list.'},headers=gh);assert r.status_code==201,r.text
   intent=r.json()['intentId'];url='/api/v1/starli/public/grokbot1/intents/'+intent+'/workspace';r=c.get(url);assert r.status_code==200,r.text
   w=r.json();assert w['temporaryWorkspace']['principalKind']=='restricted_guest';assert w['temporaryWorkspace']['companyId'];checks.append('explicit native intent POST creates exact actual provisional workspace; GET projects persisted identity')
   body={'requestId':rid,'replyToMessageId':w['messages'][0]['id']};r=c.post(url+'/messages',json=body,headers=gh);assert r.status_code==200,r.text
   r=c.post(url+'/messages',json={'requestId':'followup-'+secrets.token_hex(8),'content':'Make orders editable.'},headers=gh);assert r.status_code==200,r.text;assert len(r.json()['messages'])==4
   cookie=c.cookies.get('starli_guest');req=Request({'type':'http','method':'POST','headers':[(b'cookie',('starli_guest='+cookie).encode())]});ctx=a.resolve_guest_request(req,intent)
   registration=a.register_build(ctx,{'buildId':'actual-build-test','artifactDigest':'a'*64,'leaseId':'test-lease','generation':'1','appOrigin':'http://localhost:18282','parentOrigin':'http://localhost:18181','authorityBaseUrl':'http://localhost:18181'})
   kh={'X-Starli-App-Authority':registration['authorityKey']};ticketpath='/api/v1/starli/public/grokbot1/intents/'+intent+'/builds/actual-build-test/ticket'
   r=c.post(ticketpath,json={},headers=gh);assert r.status_code==200,r.text;t=r.json()['bootstrapTicket'];rpc='/internal/v1/model-app-authority/actual-build-test'
   r=c.post(rpc+'/redeem',json={'ticket':t,'appOrigin':'http://localhost:18282'},headers=kh);assert r.status_code==200,r.text;guest_session=r.json()['sessionToken'];assert r.json()['actor']['principalKind']=='GUEST_TEMPORARY'
   assert c.post(rpc+'/redeem',json={'ticket':t,'appOrigin':'http://localhost:18282'},headers=kh).status_code==403
   assert c.post(rpc+'/authorize',json={'sessionToken':guest_session},headers=kh).status_code==200
   assert c.post(rpc+'/authorize',json={'sessionToken':guest_session},headers={'X-Starli-App-Authority':'bad'}).status_code==403
   checks.append('actual cookie-bound guest app ticket one-use; session authorization validates exact private build key and tenant')
   pw=secrets.token_urlsafe(24);assert c.post('/staging/bootstrap-owner',json={'email':'operator@authority.example','password':pw,'name':'Operator fixture'},headers={'Origin':'http://localhost:18181','X-Starli-Staging-Bootstrap':'1'}).status_code==200
   assert c.post('/api/v1/auths/signup',json={'email':'owner@authority.example','password':pw,'name':'Owner fixture'}).status_code==200
   r=c.post('/api/v1/auths/signin',json={'email':'owner@authority.example','password':pw});assert r.status_code==200;token=r.json()['token'];ah={'Origin':'http://localhost:18181','X-Starli-Claim':'1','Authorization':'Bearer '+token,'Idempotency-Key':'claim-'+secrets.token_hex(8)}
   assert c.post('/api/v1/starli/grokbot1/reauth',json={'password':pw},headers=ah).status_code==200
   from guest_company_authority import GuestContext,digest
   source=dict(ctx.initial);source['messages']=source['messages'][:-1];source['conversationHash']=digest(source['messages'])
   queued_context=GuestContext(a,req,intent,source)
   a.freeze(token,cookie,intent)
   with contextlib.closing(a.db()) as db:
    db.execute('BEGIN IMMEDIATE')
    try:guard_guest_write(db,intent,svc.binding(cookie));raise AssertionError('admitted frozen write')
    except __import__('fastapi').HTTPException:pass
   checks.append('same-transaction admission fence rejects any guest turn after immutable snapshot freeze')
   r=c.post('/api/v1/starli/public/grokbot1/claims',json={'intentId':intent,'expectedRevision':1},headers=ah);assert r.status_code==200,r.text;transfer=r.json()['claimTransfer'];assert transfer['complete'] and len(transfer['messageMap'])==4
   ids=transfer['messageMap'];r=c.post('/api/v1/starli/public/grokbot1/claims',json={'intentId':intent,'expectedRevision':1},headers=ah);assert r.status_code==200 and r.json()['claimTransfer']['messageMap']==ids,r.text
   with sqlite3.connect(svc.p.main) as db:
    assert db.execute('SELECT count(*) FROM guest_native_message_map WHERE intent=?',(intent,)).fetchone()[0]==4
    assert db.execute("SELECT count(*) FROM cm_messages WHERE id IN (SELECT native_id FROM guest_native_message_map WHERE intent=?) AND kind='system'",(intent,)).fetchone()[0]==4
   session,_=svc.native_session(token);assert len(a.imported_history(session,transfer['companyId'],transfer['roomId']))==4
   checks.append('actual native password reauth+claim transfers all four canonical messages once; original ID reused; all imports system provenance; validated imported model context preserves four messages')
   assert c.post(rpc+'/authorize',json={'sessionToken':guest_session},headers=kh).status_code==403
   assert c.post(ticketpath,json={},headers=gh).status_code==403
   r=c.get('/api/v1/starli/grokbot1/claims/'+intent+'/conversation',headers=ah);assert r.status_code==200 and len(r.json()['messages'])==4,r.text
   assert c.get('/api/v1/starli/grokbot1/claims/'+intent+'/conversation',headers={'Authorization':'Bearer invalid'}).status_code==401
   adopted=queued_context.revalidate_build(source);assert adopted['principalKind']=='VERIFIED_CLAIMED_BUILD_CONTINUATION' and adopted['projectId']==source['projectId'] and adopted['currentProjectId']==transfer['projectId']
   altered=dict(source,messages=[{'id':'forged','role':'user','content':'different task'}])
   try:queued_context.revalidate_build(altered);raise AssertionError('adopted forged prefix')
   except __import__('fastapi').HTTPException:pass
   checks.append('retired guest app session/tickets deny; exact native owner reads transcript; trusted in-flight fixture prefix may continue after verified claim but forged prefix denied')
   path='/api/v1/starli/grokbot1/claims/'+intent+'/builds/actual-build-test/ticket';r=c.post(path,json={},headers=ah);assert r.status_code==200,r.text
   r=c.post(rpc+'/redeem',json={'ticket':r.json()['bootstrapTicket'],'appOrigin':'http://localhost:18282'},headers=kh);assert r.status_code==200,r.text
   actor=r.json()['actor'];assert actor['storageNamespace']==registration['storageNamespace'];assert actor['currentProjectId']==transfer['projectId'];assert actor['principalKind']=='VERIFIED_REGISTERED_PERSON';assert actor['generation']==2
   a.revoke_build('actual-build-test');assert c.post(rpc+'/authorize',json={'sessionToken':r.json()['sessionToken']},headers=kh).status_code==403
   checks.append('native owner fresh app session rotates generation and exact native project binding while retaining immutable existing storage namespace')
 Path(sys.argv[1]).write_text(json.dumps({'passed':True,'uid':os.getuid(),'executionClass':'NATIVE_NONPRODUCTION','fixtureInference':True,'realInferenceCalls':0,'checks':checks},indent=2)+'\n');print(json.dumps({'passed':True,'checks':len(checks),'uid':os.getuid()}))
finally:shutil.rmtree(root)
