import json, secrets, tempfile, shutil, sys, contextlib, io, os
assert os.geteuid()==997,"TEST_UID_997_REQUIRED"
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'claim-review-r1'))
from native_auth_staging import create_app
from native_claim_execution_routes import install_native_worker_routes
from native_node_dispatcher import NativeNodeDispatcher
import os
assert os.geteuid()==997,"UID_997_REQUIRED"
root=tempfile.mkdtemp(prefix="grokbot1-w1-auth-review-")
out=Path(sys.argv[1])
results={"executionUid":os.geteuid()}
try:
 with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
  app=create_app(root, "http://localhost:18181")
  dispatcher=NativeNodeDispatcher(root)
  app.state.quiescence_test_dispatcher=dispatcher
  install_native_worker_routes(app,app.state.grokbot1,dispatcher,allowed_origins={"http://localhost:18181"})
  from fastapi.testclient import TestClient
  client=TestClient(app,client=("127.0.0.1",12345));client.__enter__()
  ui=client.get("/staging/auth");assert ui.status_code==200 and "Create native user account" in ui.text
  pw=secrets.token_urlsafe(24)
  first={"email":"owner@claim-review.example","password":pw,"name":"Synthetic HTTP Registered Test"}
  h={"Origin":"http://localhost:18181","X-Starli-Staging-Bootstrap":"1"}
  r=client.post("/staging/bootstrap-owner",json=first,headers=h); assert r.status_code==200,(r.status_code,r.text)
  results["bootstrapNoSession"]=r.json()["sessionIssued"] is False
  first["email"]="acceptance-user@claim-review.example"
  r=client.post("/api/v1/auths/signup",json=first);assert r.status_code==200 and r.json()["role"]=="user",(r.status_code,r.text)
  results["claimOwnerCreatedByNativeSignup"]=True
  r=client.post("/api/v1/auths/signin",json={"email":first["email"],"password":pw});assert r.status_code==200,(r.status_code,r.text)
  token=r.json()["token"]
  ah={"Authorization":"Bearer "+token,"Origin":"http://localhost:18181","X-Starli-Claim":"1"}
  r=client.get("/api/v1/auths/",headers=ah);assert r.status_code==200,(r.status_code,r.text)
  results["nativeSigninAndSession"]=True
  r=client.get("/api/v1/starli/public/session");assert r.status_code==200,(r.status_code,r.text)
  gh={"Origin":"http://localhost:18181","X-Starli-Guest-Intent":"1"}
  r=client.post("/api/v1/starli/public/grokbot1/intents",json={"requestId":"claim_review_"+secrets.token_hex(8),"originalPrompt":"Build DogLove"},headers=gh);assert r.status_code in (200,201),(r.status_code,r.text)
  intent=r.json()["intentId"]
  r=client.post("/api/v1/starli/public/grokbot1/provisional",json={"intentId":intent},headers=gh);assert r.status_code==201,(r.status_code,r.text)
  revision=r.json()["revision"]
  body={"intentId":intent,"expectedRevision":revision};ah["Idempotency-Key"]="claim-review-"+secrets.token_hex(8)
  r=client.post("/api/v1/starli/public/grokbot1/claims",json=body,headers=ah);assert r.status_code==401 and r.json()["error"]["code"]=="RECENT_AUTH_REQUIRED",(r.status_code,r.text)
  results["requiresReauth"]=True
  r=client.post("/api/v1/starli/grokbot1/reauth",json={"password":pw},headers=ah);assert r.status_code==200,(r.status_code,r.text)
  r=client.post("/api/v1/starli/public/grokbot1/claims",json=body,headers=ah);assert r.status_code==200,(r.status_code,r.text)
  claimed=r.json()
  r=client.get("/api/v1/starli/grokbot1/claims/"+intent+"/navigation",headers=ah);assert r.status_code==200 and r.json()["stage"]=="ROOM_READY",(r.status_code,r.text)
  results["sameJwtSameClaimRoomReady"]=True
  build_headers={**ah,"Idempotency-Key":"worker-build-"+secrets.token_hex(8)}
  endpoint="/api/v1/starli/grokbot1/claims/"+intent+"/execute"
  r=client.post(endpoint,json={"command":"Start building"},headers=build_headers)
  assert r.status_code==202,(r.status_code,r.text)
  built=r.json()
  assert built["sourceMessageId"]!=built["originalPromptMessageId"]
  assert built["nativeExecutionCompleted"] is False and built["modelCalls"]==0 and built["queueState"]=="QUEUED"
  assert built["companyId"]==claimed["companyId"] and built["projectId"]==claimed["projectId"]
  r=client.post(endpoint,json={"command":"Start building"},headers=build_headers)
  assert r.status_code==202 and r.json()==built,(r.status_code,r.text)
  results["sameAuthenticatedClaimNativeWorkers"]=built
  results["sameBuildRetrySameHumanCommandAndGraph"]=True
  r=client.post(endpoint,json={"command":"Start building","companyId":"foreign"},headers=build_headers)
  assert r.status_code==422
  results["callerCannotSupplyScope"]=True
  progress=client.get("/api/v1/starli/orchestration/graphs/"+built["graphId"]+"/progress",headers=ah)
  assert progress.status_code==200,(progress.status_code,progress.text)
  observed=[progress.json().get("nativeQueue",{}).get("state")]
  import time
  for attempt in range(25):
   if progress.json().get("nativeQueue",{}).get("state")=="SUCCEEDED":break
   time.sleep(0.05)
   progress=client.get("/api/v1/starli/orchestration/graphs/"+built["graphId"]+"/progress",headers=ah)
   assert progress.status_code==200,(progress.status_code,progress.text)
   observed.append(progress.json().get("nativeQueue",{}).get("state"))
  assert progress.json()["nativeQueue"]["state"]=="SUCCEEDED",progress.text
  assert built["nativeExecutionCompleted"] is False and built["queueState"]=="QUEUED"
  results["canonicalNativeProgress"]=progress.json()
  results["actualQueueStatesObserved"]=observed
  results["response202IsAdmissionBeforeExecution"]=True
  results["nativeBuildResponse"]=built
  again=client.post(endpoint,json={"command":"Start building"},headers=build_headers)
  assert again.status_code==202 and again.json()["sourceMessageId"]==built["sourceMessageId"] and again.json()["graphId"]==built["graphId"]
  results["sameBuildRetryPreservesHumanMessageAndGraph"]=True
  session,uid=app.state.grokbot1.native_session(ah["Authorization"][7:])
  messages=app.state.grokbot1.store.messages(session,built["companyId"],built["roomId"])["messages"]
  assert sum(m["id"]==built["sourceMessageId"] for m in messages)==1
  results["humanStartBuildingMessageExactlyOnce"]=True


  r=client.post("/api/v1/auths/signup",json={"email":"second@claim-review.example","password":secrets.token_urlsafe(24),"name":"Synthetic Second HTTP Registration"});assert r.status_code==200 and r.json()["role"]=="user",(r.status_code,r.text)
  results["nativePublicSignup"]=True
  import sqlite3,hashlib,subprocess,selectors,urllib.request,urllib.error,time
  svc=app.state.grokbot1
  foreign_token=r.json()["token"]
  foreign_session,foreign_uid=svc.native_session(foreign_token)
  a=svc.ns.RbacAuthority(str(svc.p.authority))
  try:
   foreign_company=a.create(foreign_uid,"Quiescence Foreign Company","Foreign Native User")
   assert a.require_member(foreign_uid,foreign_company,permission="bots.run")["role"]=="owner"
  finally:a.db.close()
  foreign_headers={"Authorization":"Bearer "+foreign_token,"Origin":"http://localhost:18181"}
  stop_endpoint="/api/v1/starli/orchestration/graphs/"+built["graphId"]+"/stop"
  # Build queue contains the host-observed executor exit receipt; never export its session column.
  queue_db=Path(root)/"native-worker-jobs.sqlite"
  with sqlite3.connect(queue_db) as db:
   job_id,original_result=db.execute("SELECT id,result FROM native_build_jobs WHERE json_extract(result,'$.graphId')=?",(built["graphId"],)).fetchone()
  completed=json.loads(original_result)
  assert completed["_executorExit"]["waitConfirmed"] is True
  assert completed["_executorExit"]["exitCode"]==0
  dispatcher=app.state.quiescence_test_dispatcher
  before=(dispatcher.control_requests,dispatcher.terminal_inspections)
  wrong=client.post(stop_endpoint,json={},headers=foreign_headers)
  assert wrong.status_code in (403,404),(wrong.status_code,wrong.text)
  assert (dispatcher.control_requests,dispatcher.terminal_inspections)==before
  results["wrongTenantZeroControlOrTerminalEffects"]=True
  results["twoUsableNativeCompanies"]=[built["companyId"],foreign_company]
  def replace_result(value):
   with sqlite3.connect(queue_db) as db:db.execute("UPDATE native_build_jobs SET result=? WHERE id=?",(json.dumps(value) if not isinstance(value,str) else value,job_id))
  missing=json.loads(original_result);missing.pop("_executorExit")
  replace_result(missing)
  pending=client.post(stop_endpoint,json={},headers=ah)
  assert pending.status_code==202 and pending.json()["disposition"]=="STOP_PENDING"
  replace_result(original_result)
  results["missingExecutorIdentityStaysPending"]=True
  alive=json.loads(original_result)
  procstat=Path("/proc")/str(os.getpid())/"stat";raw=procstat.read_text()
  alive["_executorExit"]["pid"]=os.getpid();alive["_executorExit"]["startTicks"]=raw[raw.rfind(")")+2:].split()[19]
  replace_result(alive)
  pending=client.post(stop_endpoint,json={},headers=ah)
  assert pending.status_code==202 and pending.json()["disposition"]=="STOP_PENDING"
  replace_result(original_result)
  results["MatchingLiveIdentityNeverClaimedQuiescent"]=True
  bad=json.loads(original_result);bad["outputs"][0]["receipt"]["hmac"]="0"*64;replace_result(bad)
  pending=client.post(stop_endpoint,json={},headers=ah)
  assert pending.status_code==202 and pending.json()["disposition"]=="STOP_PENDING"
  replace_result(original_result)
  results["InvalidCompletedOutputReceiptStaysPending"]=True
  generated=next(f["path"] for f in completed["files"] if f["path"].endswith("/backend/pets.mjs"))
  app_db=Path(root)/"generated-component-app.sqlite"
  def launch_app():
   child=subprocess.Popen(["/opt/starlidigital/node/bin/node",str(Path(__file__).with_name("generated_app_component_host.mjs")),generated,str(app_db),built["companyId"]],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   selector=selectors.DefaultSelector();selector.register(child.stdout,selectors.EVENT_READ)
   assert selector.select(5),"GENERATED_APP_START_TIMEOUT"
   ready=json.loads(child.stdout.readline());selector.close()
   return child,ready
  generated_app,ready=launch_app()
  def app_request(method="GET",data=None):
   request=urllib.request.Request("http://127.0.0.1:"+str(ready["port"])+"/pets",method=method,data=json.dumps(data).encode() if data is not None else None,headers={"Content-Type":"application/json"})
   with urllib.request.urlopen(request,timeout=3) as response:return json.load(response)
  pet=app_request("POST",{"name":"QuiescentDog"})
  assert app_request()[0]["id"]==pet["id"]
  generated_app.stdin.write("CLOSE"+chr(10));generated_app.stdin.flush();assert generated_app.wait(5)==0
  generated_app,ready=launch_app()
  assert app_request()[0]["id"]==pet["id"]
  app_pid=generated_app.pid
  raw=(Path("/proc")/str(app_pid)/"stat").read_text();app_start=raw[raw.rfind(")")+2:].split()[19]
  successful=client.post(stop_endpoint,json={},headers=ah)
  assert successful.status_code==200,(successful.status_code,successful.text)
  terminal=successful.json()
  assert terminal["outcome"]=="ALREADY_COMPLETED" and terminal["confirmedStopped"] is False and terminal["quiescent"] is True
  assert terminal["signalRequested"] is None and terminal["generatedAppTouched"] is False
  assert len(terminal["processOutcomes"])==3 and all(o["confirmedExited"] and o["signalRequested"] is None for o in terminal["processOutcomes"])
  assert generated_app.poll() is None and generated_app.pid==app_pid
  raw=(Path("/proc")/str(app_pid)/"stat").read_text();assert raw[raw.rfind(")")+2:].split()[19]==app_start
  assert app_request()[0]["id"]==pet["id"]
  after=client.get("/api/v1/starli/orchestration/graphs/"+built["graphId"]+"/progress",headers=ah).json()
  assert after["nativeQueue"]["state"]=="SUCCEEDED" and after["stopState"]=="ALREADY_COMPLETED" and after["expectedContext"]["graphCompletionVerified"] is True
  again=client.post(stop_endpoint,json={},headers=ah);assert again.status_code==200 and again.json()["outcome"]=="ALREADY_COMPLETED"
  generated_app.stdin.write("REVOKE"+chr(10));generated_app.stdin.flush();time.sleep(.03)
  try:app_request();raise AssertionError("APP_REVOKE_NOT_ENFORCED")
  except urllib.error.HTTPError as error:assert error.code==403
  generated_app.stdin.write("CLOSE"+chr(10));generated_app.stdin.flush();assert generated_app.wait(5)==0
  results["terminalQuiescence"]=terminal
  results["completedQueueAndArtifactsRemainSucceeded"]=True
  results["generatedAppPersistedReadBeforeTerminalStop"]=True
  results["generatedAppSamePidStartAndReadAfterTerminalStop"]=True
  results["generatedAppRevokedSeparatelyAfterReadback"]=True
  results["generatedAppCheckScope"]="ACTUAL_GENERATED_BACKEND_PERSISTENCE_COMPONENT_WITH_LOCAL_LEASE_FIXTURE_NOT_NATIVE_PREVIEW_AUTHORITY"
  results["vmOrQuotaReleaseClaimed"]=False
  results["testUid"]=os.geteuid()
  results["sameClaimIds"]={k:claimed[k] for k in ["intentId","companyId","projectId","claimId","channelRoomId"]}
 import shutil
 runtime=Path(root)/"native-worker-runtime"
 if runtime.exists():
  artifact_out=out.parent/(out.stem+"-native-artifacts")
  shutil.copytree(runtime/"artifacts",artifact_out)
  for receipt in runtime.glob("execution-*.json"):shutil.copy2(receipt,artifact_out/receipt.name)
  import sqlite3
  for dbname in ("canonical.sqlite","graphs.sqlite"):
   srcdb=sqlite3.connect(runtime/dbname);dstdb=sqlite3.connect(artifact_out/dbname)
   srcdb.backup(dstdb);dstdb.close();srcdb.close()
  results["nativeArtifactsEvidenceDir"]=str(artifact_out)
 out.write_text(json.dumps({"executionClass":"NATIVE_NONPRODUCTION","identityClass":"SYNTHETIC_HTTP_REGISTERED_TEST_ACCOUNT_NOT_REAL_HUMAN","harnessMintedUsersOrJwt":False,"results":results,"passed":True},indent=2)+"\n")
 print("PASS native signup/signin/session/reauth/claim/navigation; no credential output")
finally:
 if "generated_app" in globals() and generated_app.poll() is None:generated_app.terminate();generated_app.wait(5)
 if "client" in globals():client.__exit__(None,None,None)
 shutil.rmtree(root)
