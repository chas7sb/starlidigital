import json, secrets, tempfile, shutil, sys, contextlib, io
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'claim-review-r1'))
from native_auth_staging import create_app
from native_claim_execution_routes import install_native_worker_routes
from native_node_dispatcher import NativeNodeDispatcher
root=tempfile.mkdtemp(prefix="grokbot1-w1-auth-review-")
out=Path(sys.argv[1])
results={}
try:
 with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
  app=create_app(root, "http://localhost:18181")
  dispatcher=NativeNodeDispatcher(root,worker_hold_ms=5000)
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
  foreign_password=secrets.token_urlsafe(24)
  foreign=client.post("/api/v1/auths/signup",json={"email":"foreign@stop-test.example","password":foreign_password,"name":"Foreign Native Owner"})
  assert foreign.status_code==200
  foreign_token=foreign.json()["token"]
  foreign_session,foreign_uid=app.state.grokbot1.native_session(foreign_token)
  authority=app.state.grokbot1.ns.RbacAuthority(str(app.state.grokbot1.p.authority))
  try:
   foreign_company=authority.create(foreign_uid,"Foreign Company","Foreign Native Owner")
   assert authority.require_member(foreign_uid,foreign_company,permission="bots.run")["role"]=="owner"
  finally:authority.db.close()
  foreign_headers={"Authorization":"Bearer "+foreign_token,"Origin":"http://localhost:18181"}
  results["twoActualUsableNativeCompanies"]={"first":claimed["companyId"],"second":foreign_company,"foreignOwnerCreatedByNativeSignup":True}

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
  import time,os
  for attempt in range(15):
   if progress.json().get("liveNativeProcesses"):break
   time.sleep(.02)
   progress=client.get("/api/v1/starli/orchestration/graphs/"+built["graphId"]+"/progress",headers=ah)
   assert progress.status_code==200
  live=progress.json()["liveNativeProcesses"]
  assert len(live)==1,progress.text
  identity=live[0]
  def same_process():
   try:
    raw=Path("/proc")/str(identity["pid"])/"stat";text=raw.read_text()
    return text[text.rfind(")")+2:].split()[19]==str(identity["startTicks"])
   except FileNotFoundError:return False
  assert same_process()
  stop_endpoint="/api/v1/starli/orchestration/graphs/"+built["graphId"]+"/stop"
  before_controls=dispatcher.control_requests
  wrong=client.post(stop_endpoint,json={},headers=foreign_headers)
  assert wrong.status_code in (403,404),(wrong.status_code,wrong.text)
  assert dispatcher.control_requests==before_controls and same_process()
  wrong_run=client.post(stop_endpoint,json={"runId":"unrelated-native-run"},headers=ah)
  assert wrong_run.status_code==409 and dispatcher.control_requests==before_controls and same_process()
  forbidden_pid=client.post(stop_endpoint,json={"pid":identity["pid"]},headers=ah)
  assert forbidden_pid.status_code==422 and dispatcher.control_requests==before_controls
  import sqlite3
  with sqlite3.connect(Path(root)/"native-worker-runtime/canonical.sqlite") as db:
   control=json.loads(db.execute("SELECT payload FROM records WHERE collection='native-live-controls' AND id=?",(built["graphId"],)).fetchone()[0])
  socket_path=Path(control["socketPath"]);held_path=socket_path.with_suffix(".unavailable")
  socket_path.rename(held_path)
  try:
   pending=client.post(stop_endpoint,json={},headers=ah)
   assert pending.status_code==202 and pending.json()["confirmedStopped"] is False and pending.json()["disposition"]=="STOP_PENDING"
   assert same_process() and dispatcher.control_requests==before_controls
  finally:held_path.rename(socket_path)
  results["unavailableLiveControlReturnsPendingWithoutKill"]=True
  stopped=client.post(stop_endpoint,json={"reason":"Authenticated HTTP cancellation integration"},headers=ah)
  assert stopped.status_code==200,(stopped.status_code,stopped.text)
  stop=stopped.json()
  assert stop["confirmedStopped"] is True and stop["disposition"]=="TERMINAL"
  assert len(stop["processOutcomes"])==1 and stop["processOutcomes"][0]["confirmedExited"] is True
  assert stop["processOutcomes"][0]["pid"]==identity["pid"] and stop["processOutcomes"][0]["startTicks"]==identity["startTicks"]
  assert same_process() is False
  for attempt in range(15):
   progress=client.get("/api/v1/starli/orchestration/graphs/"+built["graphId"]+"/progress",headers=ah)
   if progress.json()["nativeQueue"]["state"]=="STOPPED":break
   time.sleep(.02)
  assert progress.json()["nativeQueue"]["state"]=="STOPPED",progress.text
  assert progress.json()["expectedContext"]["graphCompletionVerified"] is False
  assert all(not item["serverProvenanceVerified"] and not item["artifactDigest"] for item in progress.json()["items"])
  time.sleep(.1)
  late=client.get("/api/v1/starli/orchestration/graphs/"+built["graphId"]+"/progress",headers=ah)
  assert late.json()["nativeQueue"]["state"]=="STOPPED" and not late.json()["expectedContext"]["graphCompletionVerified"]
  duplicate=client.post(stop_endpoint,json={},headers=ah);assert duplicate.status_code==200 and duplicate.json()["confirmedStopped"] is True
  results["actualHeldNativeProcessBeforeStop"]=identity
  results["wrongTenantStopZeroControlEffects"]=True
  results["wrongRunStopZeroControlEffects"]=True
  results["callerPidRejectedWithoutControlEffects"]=True
  results["authenticatedHttpStopReachedSameLiveExecutor"]=stop
  with sqlite3.connect(Path(root)/"native-worker-admission.sqlite") as db:
   admission=json.loads(db.execute("SELECT admission FROM builds WHERE json_extract(result,'$.graphId')=?",(built["graphId"],)).fetchone()[0])
  def actual_scope_check(candidate=None):
   svc=app.state.grokbot1;session,uid=svc.native_session(token);navigation=svc.owner_navigation(token,intent)
   authority=svc.ns.RbacAuthority(str(svc.p.authority))
   try:scope=authority.require_member(uid,admission["companyId"],permission="bots.run")
   finally:authority.db.close()
   return uid==admission["actor"]["userId"] and navigation["companyId"]==admission["companyId"] and navigation["projectId"]==admission["projectId"] and scope["membership_revision"]==admission["authorizationRevision"] and session.revalidate() is True
  for _ in range(30):
   with sqlite3.connect(Path(root)/"native-worker-runtime/canonical.sqlite") as db:
    closed=json.loads(db.execute("SELECT payload FROM records WHERE collection='native-live-controls' AND id=?",(built["graphId"],)).fetchone()[0])["phase"]=="CLOSED"
   if closed:break
   time.sleep(.01)
  assert closed and not Path(control["noncePath"]).exists()
  async def late_execute():
   try:
    await dispatcher(admission,actual_scope_check)
    return False
   except RuntimeError:return True
  assert client.portal.call(late_execute) is True
  assert dispatcher.last_failure["nativeCompletionFence"] is True,dispatcher.last_failure
  after_late=client.get("/api/v1/starli/orchestration/graphs/"+built["graphId"]+"/progress",headers=ah)
  assert after_late.json()["nativeQueue"]["state"]=="STOPPED" and not after_late.json()["expectedContext"]["graphCompletionVerified"]
  assert all(not i["artifactDigest"] for i in after_late.json()["items"])
  results["actualNativeLateReexecutionRejected"]=True
  results["lateOutputNoRevival"]=True
  results["canonicalNativeProgressAfterStop"]=late.json()
  results["vmOrQuotaReleaseClaimed"]=False
  assert after_late.json()["stopState"]=="STOPPED"
  # A separate explicit command with a new key, admitted while consumer is stopped,
  # verifies the atomic queued Stop path cannot accidentally start a process.
  client.portal.call(app.state.native_build_queue.close)
  queued_headers={**ah,"Idempotency-Key":"queued-stop-"+secrets.token_hex(8)}
  queued=client.post(endpoint,json={"command":"Start building"},headers=queued_headers)
  assert queued.status_code==202
  queued_graph=queued.json()["graphId"]
  queued_stop=client.post("/api/v1/starli/orchestration/graphs/"+queued_graph+"/stop",json={},headers=ah)
  assert queued_stop.status_code==200 and queued_stop.json()["confirmedStopped"] is True
  assert queued_stop.json()["processOutcomes"]==[]
  queued_progress=client.get("/api/v1/starli/orchestration/graphs/"+queued_graph+"/progress",headers=ah)
  assert queued_progress.json()["nativeQueue"]["state"]=="STOPPED" and queued_progress.json()["stopState"]=="STOPPED"
  results["queuedStopAtomicAdmissionFence"]=True
  results["queuedStopNativeCanonicalReceipt"]=queued_stop.json()

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
 if "client" in globals():client.__exit__(None,None,None)
 shutil.rmtree(root)
