"""Actual isolated native HTTP guest/model/CRUD test. No synthetic JWT or model output."""
import json,time,uuid,urllib.request,urllib.error,http.cookiejar,os
from pathlib import Path
BASE="http://127.0.0.1:18382";ORIGIN="http://127.0.0.1:18381"
ROOT=Path("/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/codex")
OUT=ROOT/"runtime-model-app-api-r1";jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));evidence={"identityClass":"ACTUAL_NATIVE_HTTP_SYNTHETIC_GUEST_TEST","harnessMintedJWT":False,"modelOutputFixtures":False,"events":[]}
def call(method,path,body=None,origin=ORIGIN,headers=None):
    url=path if path.startswith("http") else BASE+path
    req=urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,method=method,headers={"Origin":origin,"Content-Type":"application/json",**(headers or {})})
    started=time.monotonic()
    try:
        with opener.open(req,timeout=90) as response:status=response.status;value=json.load(response)
    except urllib.error.HTTPError as error:status=error.code;value=json.loads(error.read())
    evidence["events"].append({"method":method,"path":urllib.parse.urlsplit(url).path,"status":status,"durationMs":round((time.monotonic()-started)*1000)})
    return status,value
try:
    assert call("GET","/staging/instance")[0]==200
    assert call("GET","/api/v1/starli/public/session")[0]==200
    request_id="model-api-"+uuid.uuid4().hex
    prompt="Build a small agency client tracker. Clients must have name, email, status (New, Active, Paused), and notes. I need to add clients, edit their status and notes, list them and delete them. Save data so it persists after an app restart. Use a polished clean blue interface."
    h={"X-Starli-Guest-Intent":"1"}
    status,intent=call("POST","/api/v1/starli/public/grokbot1/intents",{"requestId":request_id,"originalPrompt":prompt},headers=h)
    assert status in (200,201),(status,intent)
    iid=intent["intentId"];workspace="/api/v1/starli/public/grokbot1/intents/"+iid+"/workspace"
    status,value=call("GET",workspace);assert status==200
    status,value=call("POST",workspace+"/messages",{"requestId":request_id,"replyToMessageId":value["messages"][0]["id"]},headers=h)
    assert status in (200,202),(status,value)
    deadline=time.monotonic()+240
    while time.monotonic()<deadline:
        status,value=call("GET",workspace);assert status==200
        build=value.get("build")
        if build and build["status"] not in ("QUEUED","RUNNING"):break
        time.sleep(1)
    assert build and build["status"]=="READY",build
    evidence["build"]={k:build.get(k) for k in ["buildId","status","graphId","artifactDigest","sourceMessageId","conversationHash","modelCalls","sourceProvenance"]}
    preview=build["preview"];status,ticket=call("POST",preview["ticketUrl"],{},headers=h);assert status==200,(status,ticket)
    status,boot=call("POST",preview["bootstrapUrl"],{"ticket":ticket["bootstrapTicket"]});assert status==200,(status,boot)
    app=preview["previewUrl"].rstrip("/")
    status,session=call("GET",app+"/api/app/session",origin=app);assert status==200,(status,session)
    status,schema=call("GET",app+"/api/app/schema",origin=app);assert status==200
    collection=next(c for c in schema["collections"] if {"name","email","status","notes"}.issubset({f["name"] for f in c["fields"]}))
    fields={f["name"]:f for f in collection["fields"]};name=collection["name"];url=app+"/api/app/"+name
    status,empty=call("GET",url,origin=app);assert status==200 and empty["items"]==[],empty
    record={"name":"API Verification Client","email":"client@example.com","status":fields["status"]["options"][0],"notes":"Created through actual app HTTP"}
    wh={"X-CSRF-Token":session["csrfToken"]}
    status,created=call("POST",url,record,origin=app,headers=wh);assert status==201,(status,created)
    edited={**record,"status":fields["status"]["options"][1],"notes":"Edited before process restart"}
    status,updated=call("PATCH",url+"/"+created["id"],edited,origin=app,headers=wh);assert status==200 and updated["notes"]==edited["notes"]
    control=(Path("/tmp/grokbot1-w1-model-app-r1")/".model-app-control.key").read_text()
    ch={"X-Starli-Model-Control":control};status,instance=call("GET","/internal/v1/model-app-control/instance",headers=ch);assert status==200
    ch["X-Starli-Control-Instance"]=instance["instanceNonce"]
    status,restarted=call("POST","/internal/v1/model-app-control/"+build["buildId"]+"/restart",{},headers=ch);assert status==200,(status,restarted)
    result=restarted["result"];assert result["before"]["pid"]!=result["after"]["pid"] and result["storageNamespaceUnchanged"] and result["stop"]["exitConfirmed"]
    status,read=call("GET",url,origin=app);assert status==200 and any(r["id"]==created["id"] and r["notes"]==edited["notes"] for r in read["items"]),read
    evidence.update(passed=True,intentId=iid,appName=schema["name"],collection=name,fieldNames=list(fields),recordId=created["id"],created201=True,edited200=True,independentProcessRestart=result,persistedReadAfterRestart=True,initialDataEmpty=True,productionReady=False)
except BaseException as error:
    evidence.update(passed=False,error=str(error)[:1200])
finally:
    (OUT/"actual-api-evidence.json").write_text(json.dumps(evidence,indent=2))
    print(json.dumps({k:evidence.get(k) for k in ["passed","intentId","appName","collection","error"]}))
