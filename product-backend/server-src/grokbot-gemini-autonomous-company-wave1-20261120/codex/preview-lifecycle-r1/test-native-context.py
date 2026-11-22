import json, secrets, tempfile, shutil, sys, contextlib, io
from pathlib import Path
sys.path.insert(0,'/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/codex/native-wiring-r1');sys.path.insert(0,'/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/codex/claim-review-r1')
from native_auth_staging import create_app
from native_claim_execution_routes import install_native_worker_routes
from native_node_dispatcher import NativeNodeDispatcher
root=tempfile.mkdtemp(prefix="grokbot1-w1-auth-review-")
out=Path(sys.argv[1])
results={}
try:
 with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
  app=create_app(root, "http://localhost:18181")
  install_native_worker_routes(app,app.state.grokbot1,NativeNodeDispatcher(root),allowed_origins={"http://localhost:18181"})
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


  import subprocess
  checked=subprocess.run(['/opt/starlidigital/node/bin/node','--experimental-transform-types',str(Path(__file__).with_name('test-context.mjs'))],input=json.dumps({'nativeRoot':root,'authorityPackage':str(Path(__file__).parent.parent/'authority-r1/package'),'orchestrationPackage':str(Path(__file__).parent.parent.parent/'gemini1/orchestration-r6'),'intentId':intent,'nativeJwt':token}),capture_output=True,text=True,timeout=90)
  assert checked.returncode==0,checked.stderr
  results['previewContext']=json.loads(checked.stdout)
  r=client.post("/api/v1/auths/signup",json={"email":"second@claim-review.example","password":secrets.token_urlsafe(24),"name":"Synthetic Second HTTP Registration"});assert r.status_code==200 and r.json()["role"]=="user",(r.status_code,r.text)
  results["nativePublicSignup"]=True
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
