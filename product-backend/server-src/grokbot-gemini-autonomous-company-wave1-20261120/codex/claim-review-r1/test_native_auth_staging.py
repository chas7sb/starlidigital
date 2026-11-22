import json, secrets, tempfile, shutil, sys, contextlib, io
from pathlib import Path
from native_auth_staging import create_app
root=tempfile.mkdtemp(prefix="grokbot1-w1-auth-review-")
out=Path(sys.argv[1])
results={}
try:
 with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
  app=create_app(root, "http://localhost:18181")
  from fastapi.testclient import TestClient
  client=TestClient(app,client=("127.0.0.1",12345))
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
  company=claimed["companyId"]
  r=client.get("/api/v1/companies",headers=ah);assert r.status_code==200,(r.status_code,r.text)
  company_list=r.json();assert company in str(company_list),company_list
  results["nativeCompanyList"]=True
  for suffix in ["capabilities","directory","roles"]:
   r=client.get("/api/v1/companies/"+company+"/"+suffix,headers=ah);assert r.status_code==200,(suffix,r.status_code,r.text)
   if suffix=="directory":assert any(x["id"]==claimed["bossBotId"] and x["kind"]=="bot" for x in r.json()),r.text
  results["nativeCapabilitiesDirectoryRoles"]=True
  r=client.post("/api/v1/companies/"+company+"/switch",headers=ah);assert r.status_code==200,(r.status_code,r.text)
  r=client.get("/api/v1/starli/companies/"+company+"/messaging/rooms",headers=ah);assert r.status_code==200 and any(x["id"]==claimed["channelRoomId"] for x in r.json()["rooms"]),(r.status_code,r.text)
  results["nativeSwitchAndClaimedRooms"]=True
  r=TestClient(app,client=("127.0.0.1",12346)).get("/api/v1/companies/"+company+"/directory");assert r.status_code in (401,403),(r.status_code,r.text)
  results["unauthenticatedDirectoryDenied"]=True
  r=client.post("/api/v1/auths/signup",json={"email":"second@claim-review.example","password":secrets.token_urlsafe(24),"name":"Synthetic Second HTTP Registration"});assert r.status_code==200 and r.json()["role"]=="user",(r.status_code,r.text)
  results["nativePublicSignup"]=True
  results["sameClaimIds"]={k:claimed[k] for k in ["intentId","companyId","projectId","claimId","channelRoomId"]}
 out.write_text(json.dumps({"executionClass":"NATIVE_NONPRODUCTION","identityClass":"SYNTHETIC_HTTP_REGISTERED_TEST_ACCOUNT_NOT_REAL_HUMAN","harnessMintedUsersOrJwt":False,"results":results,"passed":True},indent=2)+"\n")
 print("PASS native signup/signin/session/reauth/claim/navigation; no credential output")
finally:
 shutil.rmtree(root)
