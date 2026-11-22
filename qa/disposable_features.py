"""Actual HTTP feature smoke against AgentX10's retained disposable instance only."""
import argparse, base64, hashlib, importlib.util, json, pathlib, secrets, sys, time, datetime
import urllib.request, urllib.error, urllib.parse
import http.cookiejar
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("first_run",ROOT/"onboarding/first_run.py")
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)

class Failure(Exception): pass

class Suite:
    def __init__(self,state,report_name="feature-smoke.json"):
        self.report_name=report_name
        self.state=state.resolve()
        if self.state.parent != (ROOT/"work").resolve() or not self.state.name.startswith("onboarding-e2e-"):
            raise Failure("Use a disposable onboarding-e2e directory directly under work")
        self.config=helper.private_read(self.state/"setup.json")
        if self.config["dashboard"]!="http://127.0.0.1:18280" or self.config["platform"]!="http://127.0.0.1:18281":
            raise Failure("Only the retained disposable 18280/18281 instance is accepted")
        if helper.private_read(self.state/"qa-result.json").get("core_passed") is not True or not (self.state/"qa-processes.json").exists():
            raise Failure("AgentX10 successful --serve handoff evidence is required")
        self.out=self.state/("feature-smoke-"+secrets.token_hex(4));helper.private_storage().ensure_private_directory(self.out)
        self.rows=[];self.raw=[];self.token=None;self.tag="QA-"+secrets.token_hex(5)
        self.catalog={};self.created={}

    def req(self,path,payload=None,method=None):
        headers={"Content-Type":"application/json","Origin":self.config["dashboard"]}
        if self.token:headers["Authorization"]="Bearer "+self.token
        request=urllib.request.Request(self.config["dashboard"]+path,
            data=None if payload is None else json.dumps(payload).encode(),headers=headers,method=method)
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),helper.NoRedirect())
        try:
            with opener.open(request,timeout=65) as r:
                raw=r.read(20*1024*1024+1)
                if len(raw)>20*1024*1024:raise Failure("response_limit")
                result=json.loads(raw)
                self.raw.append({"path":path,"method":request.get_method(),"http":r.status,"result":result})
                return result
        except urllib.error.HTTPError as e:
            self.raw.append({"path":path,"method":request.get_method(),"http":e.code,"error":e.read(20000).decode(errors="replace")})
            raise Failure("HTTP "+str(e.code)) from None
        except (OSError,ValueError) as e:raise Failure(type(e).__name__) from None

    def invoke(self,name,args,write=False):
        if name not in self.catalog:raise Failure("Tool absent from actual catalog: "+name)
        body={"tool":name,"args":args}
        if write:body["operationKey"]=self.tag+"-"+name+"-"+secrets.token_hex(3)
        receipt=self.req("/api/v1/starli/tools/invoke",body)
        if isinstance(receipt,dict) and receipt.get("isError"):raise Failure("Tool returned isError; inspect private receipt")
        if isinstance(receipt,dict) and "content" in receipt:
            texts=[x.get("text","") for x in receipt["content"] if x.get("type")=="text"]
            try:value=json.loads("\n".join(texts))
            except ValueError:raise Failure("Tool returned no JSON receipt") from None
            if isinstance(value,dict) and (value.get("error") or value.get("status") in ("FAILED","ERROR","DENIED")):
                raise Failure("Tool receipt reports failure; inspect private receipt")
            return value,receipt
        return receipt,receipt

    def run(self,name,owner,source,fn):
        before=len(self.raw)
        try:
            evidence=fn()
            self.rows.append({"name":name,"status":"PASS","owner":owner,"source":source,"evidence":evidence})
        except Exception as e:
            detail=str(e) if isinstance(e,Failure) else type(e).__name__
            self.rows.append({"name":name,"status":"FAIL","owner":owner,"source":source,"detail":detail,
                "private_receipt_range":[before,len(self.raw)],"action":"Inspect private receipts and reproduce with the same disposable instance; no automatic mutation retries."})
        self.save()

    def save(self):
        report={"parity_status":"NOT_VERIFIED","scope":"Representative local disposable HTTP actions; no external sends/inference/publishing/payment calls",
            "observed_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "dashboard":self.config["dashboard"],"created":self.created,"checks":self.rows,
            "passed":sum(x["status"]=="PASS" for x in self.rows),"failed":sum(x["status"]=="FAIL" for x in self.rows)}
        # Reports contain only test IDs and selected evidence; raw receipts stay private.
        helper.private_write(self.out/("report-"+str(len(self.rows))+".json"),report)
        helper.private_write(self.out/("receipts-"+str(len(self.rows))+".json"),self.raw)
        (ROOT/"qa/results"/self.report_name).write_text(json.dumps(report,indent=2),encoding="utf-8")

    def authenticate(self):
        credentials=helper.private_read(self.state/"qa-credentials.json")
        auth=helper.request(self.config["dashboard"],"/api/v1/auths/signin",credentials)
        self.token=auth.get("token")
        if not self.token or auth.get("role")!="admin":raise Failure("Disposable owner sign-in failed")
        return {"role":auth["role"]}

    def tools(self):
        result=self.req("/api/v1/starli/tools/catalog")
        self.catalog={t["name"]:t for t in result.get("tools",[])}
        required=["crm_upsert_prospect","agent_create","agent_get","video_project_create","video_project_get","video_validate","video_preview_frame","project_file_write"]
        missing=[n for n in required if n not in self.catalog]
        if missing:raise Failure("Missing required tools: "+", ".join(missing))
        return {"count":len(self.catalog),"required_present":required}

    def crm(self):
        value,_=self.invoke("crm_upsert_prospect",{"name":self.tag+" synthetic company","domain":self.tag.lower()+".invalid","notes":"Disposable local QA only"},True)
        ident=value.get("id")
        if not ident:raise Failure("No actual CRM create ID")
        self.created["crm_company"]=ident
        detail=self.req("/api/v1/starli/customer-data/crm/"+urllib.parse.quote(ident))
        listing=self.req("/api/v1/starli/customer-data/crm?q="+urllib.parse.quote(self.tag))
        if detail.get("company",{}).get("name")!=self.tag+" synthetic company" or not any(r.get("id")==ident for r in listing.get("items",[])):
            raise Failure("Created company missing from owner read model/search")
        return {"id":ident,"version":value.get("version"),"detail_matches":True,"search_matches":True}

    def project(self):
        p=self.req("/api/v1/starli/workspace/projects",{"name":self.tag+" project","brief":"Local offline QA"})
        ident=p.get("id")
        if not ident:raise Failure("No project create ID")
        self.created["project"]=ident
        d=self.req("/api/v1/starli/workspace/projects/"+ident)
        if d.get("id")!=ident:raise Failure("Project detail did not persist")
        return {"id":ident,"detail_matches":True}

    def file_edit(self):
        ident=self.created.get("project")
        if not ident:raise Failure("Blocked: project creation failed")
        path="/api/v1/starli/workspace/projects/"+ident+"/file"
        content="<!doctype html><html><body>"+self.tag+"</body></html>"
        w=self.req(path,{"path":"index.html","content":content},method="PUT")
        r=self.req(path+"?path=index.html")
        sha=hashlib.sha256(content.encode()).hexdigest()
        if w.get("status")!="SAVED" or r.get("content")!=content or r.get("sha256")!=sha:
            raise Failure("Saved file receipt/readback/hash mismatch")
        edited=content.replace("</body>"," edited</body>")
        second=self.req(path,{"path":"index.html","content":edited,"expectedSha256":sha},method="PUT")
        read=self.req(path+"?path=index.html")
        if read.get("content")!=edited or second.get("sha256")!=hashlib.sha256(edited.encode()).hexdigest():
            raise Failure("Edited file readback/hash mismatch")
        try:self.req(path,{"path":"index.html","content":"stale","expectedSha256":sha},method="PUT")
        except Failure as e:
            if str(e)!="HTTP 409":raise
        else:raise Failure("Stale edit was accepted")
        return {"sha256":second["sha256"],"version":second.get("version"),"stale_edit_http":409}

    def agent(self):
        args={"name":self.tag+" agent","businessName":self.tag+" business","type":"SUPPORT","instructions":"Local configuration QA; never call inference.","welcomeMessage":"Synthetic local greeting"}
        a,_=self.invoke("agent_create",args,True)
        ident=a.get("id")
        if not ident:raise Failure("No hosted agent ID")
        self.created["hosted_agent"]=ident
        r,_=self.invoke("agent_get",{"id":ident})
        if r.get("name")!=args["name"] or r.get("instructions")!=args["instructions"]:
            raise Failure("Hosted agent config readback differs")
        if r.get("status") in ("ACTIVE","DEMO"):raise Failure("New agent unexpectedly published")
        return {"id":ident,"status":r.get("status"),"configuration_matches":True}

    def unavailable(self):
        billing=self.req("/api/v1/starli/billing")
        mail=self.req("/api/v1/starli/mail")
        social=self.req("/api/v1/starli/social")
        if billing.get("available") is False and billing.get("wallet") is not None:raise Failure("Unavailable wallet replaced with balance")
        if billing.get("paymentsEnabled") is not False:raise Failure("Fresh payments unexpectedly enabled")
        if social.get("connected") is not False or social.get("state") not in ("CLIENT_NOT_CONFIGURED","CONNECTION_REQUIRED"):
            raise Failure("Fresh social integration availability not truthful")
        if mail.get("connected") is not False or mail.get("status")!="CONNECTION_REQUIRED":raise Failure("Fresh mailbox does not explicitly report unconnected")
        return {"wallet_available":billing.get("available"),"wallet_null":billing.get("wallet") is None,
            "paymentsEnabled":billing.get("paymentsEnabled"),"mail_connected":mail.get("connected"),"mail_status":mail.get("status"),"social_state":social.get("state")}

    def video_create(self):
        composition={"canvas":{"width":240,"height":240,"fps":10},"scenes":[{"id":"qa-scene","duration":0.3,"background":{"type":"color","color":"#102030"},"layers":[{"type":"text","text":"Local QA","fontSize":24}]}]}
        self.composition=composition
        r,_=self.invoke("video_project_create",{"title":self.tag+" video","format":"CUSTOM","spec":composition},True)
        project=r.get("project",{});ident=project.get("id")
        if not ident:raise Failure("No video project ID")
        self.created["video_project"]=ident
        d,_=self.invoke("video_project_get",{"projectId":ident})
        if (project.get("width"),project.get("height"),project.get("fps"))!=(240,240,10):raise Failure("Video create metadata differs from spec canvas")
        detail=d.get("project",{})
        if detail.get("id")!=ident or detail.get("spec")!=composition or (detail.get("width"),detail.get("height"),detail.get("fps"))!=(240,240,10):raise Failure("Video detail spec/metadata differs from create request")
        return {"id":ident,"width":project.get("width"),"height":project.get("height"),"fps":project.get("fps"),"metadata_matches_spec":True,"detail_received":True}

    def video_preview(self):
        ident=self.created.get("video_project")
        if not ident:raise Failure("Blocked: video project creation failed")
        validation,_=self.invoke("video_validate",{"projectId":ident})
        if validation.get("valid") is not True:raise Failure("Local video validation failed; inspect private Python runtime error")
        r,receipt=self.invoke("video_preview_frame",{"projectId":ident,"timestamp":0},True)
        images=[x for x in receipt.get("content",[]) if x.get("type")=="image"]
        if not images:raise Failure("No actual PNG image receipt")
        png=base64.b64decode(images[0]["data"],validate=True)
        if not png.startswith(b"\x89PNG\r\n\x1a\n"):raise Failure("PNG signature invalid")
        helper.private_storage().create_private_file(self.out/"video-preview.png",png)
        return {"bytes":len(png),"sha256":hashlib.sha256(png).hexdigest(),"valid":True}

    def video_render(self):
        ident=self.created.get("video_project")
        if not ident:raise Failure("Blocked: video project creation failed")
        r,_=self.invoke("video_render_start",{"projectId":ident},True)
        rid=r.get("renderId")
        if not rid:raise Failure("No actual render ID")
        self.created["video_render"]=rid
        deadline=time.monotonic()+75
        while True:
            status,_=self.invoke("video_render_status",{"renderId":rid})
            if status.get("status")=="COMPLETE":
                out,_=self.invoke("video_output_get",{"renderId":rid})
                url=out.get("outputUrl","")
                # Artifact URL may target another local origin; never follow external URLs.
                u=urllib.parse.urlsplit(url)
                if u.netloc and helper.origin(u.scheme+"://"+u.netloc)!=self.config["platform"]:
                    raise Failure("Video receipt URL is not the disposable local platform")
                if not u.path.startswith("/media/videos/") or u.query or u.fragment:raise Failure("Unexpected video media path")
                jar=http.cookiejar.CookieJar()
                client=urllib.request.build_opener(urllib.request.ProxyHandler({}),helper.NoRedirect(),urllib.request.HTTPCookieProcessor(jar))
                credentials=helper.private_read(self.state/"qa-credentials.json")
                login={"query":"mutation($u:String!,$p:String!){login(username:$u,password:$p){id role}}","variables":{"u":"qaowner","p":credentials["password"]}}
                request=urllib.request.Request(self.config["platform"]+"/graphql",data=json.dumps(login).encode(),headers={"Content-Type":"application/json","Origin":self.config["dashboard"]})
                try:
                    with client.open(request,timeout=15) as response:auth=json.load(response)
                    if auth.get("errors") or auth.get("data",{}).get("login",{}).get("role")!="ADMIN":raise Failure("Node media login failed")
                    with client.open(self.config["platform"]+u.path,timeout=20) as response:
                        media=response.read(20*1024*1024+1)
                    if len(media)>20*1024*1024 or len(media)<1000 or media[4:8]!=b"ftyp":raise Failure("Downloaded MP4 signature/size invalid")
                    helper.private_storage().create_private_file(self.out/"video-output.mp4",media)
                    return {"renderId":rid,"status":"COMPLETE","downloaded_bytes":len(media),"sha256":hashlib.sha256(media).hexdigest(),"mp4_ftyp":True}
                except urllib.error.HTTPError as e:raise Failure("Node media HTTP "+str(e.code)) from None
            if status.get("status") in ("FAILED","CANCELLED"):raise Failure("Video render "+status["status"]+"; inspect private receipt")
            if time.monotonic()>deadline:raise Failure("Render did not complete within 75 seconds; last status "+str(status.get("status")))
            time.sleep(3)

def main():
    p=argparse.ArgumentParser();p.add_argument("--state",type=pathlib.Path,required=True);p.add_argument("--video-render",action="store_true");p.add_argument("--catalog-only",action="store_true");p.add_argument("--preview-project")
    args=p.parse_args()
    try:s=Suite(args.state,"preview-retry.json" if args.preview_project else "catalog-smoke.json" if args.catalog_only else "feature-smoke.json")
    except Exception as e:
        print("Preflight failed: "+(str(e) if isinstance(e,Failure) else type(e).__name__));return 2
    s.run("owner-auth","AgentX10","onboarding/first_run.py",s.authenticate)
    if not s.token:
        print(json.dumps({"passed":0,"failed":1,"parity_status":"NOT_VERIFIED","detail":"Disposable sign-in failed; check current --serve state"}));return 1
    if args.preview_project:
        s.created["video_project"]=args.preview_project
        s.run("real-tool-catalog","AgentX2/3","dashboard/backend/open_webui/routers/starli_tools.py",s.tools)
        s.run("video-validate-png","AgentX3/5","platform/server/src/video/service.ts",s.video_preview)
        print(json.dumps({"passed":sum(r["status"]=="PASS" for r in s.rows),"failed":sum(r["status"]=="FAIL" for r in s.rows),"parity_status":"NOT_VERIFIED","private_artifacts":str(s.out)}))
        return 1 if any(r["status"]=="FAIL" for r in s.rows) else 0
    if args.catalog_only:
        s.run("real-tool-catalog","AgentX2/3","dashboard/backend/open_webui/routers/starli_tools.py",s.tools)
        print(json.dumps({"passed":sum(r["status"]=="PASS" for r in s.rows),"failed":sum(r["status"]=="FAIL" for r in s.rows),"parity_status":"NOT_VERIFIED"}))
        return 1 if any(r["status"]=="FAIL" for r in s.rows) else 0
    for name,owner,source,fn in [
        ("real-tool-catalog","AgentX2/3","dashboard/backend/open_webui/routers/starli_tools.py",s.tools),
        ("crm-create-search-detail","AgentX2/3","platform/control-plane/src/tools/crm.ts",s.crm),
        ("project-create-detail","AgentX2","dashboard/backend/open_webui/routers/starli_workspace.py",s.project),
        ("project-file-edit-cas","AgentX2","dashboard/backend/open_webui/routers/starli_workspace.py",s.file_edit),
        ("hosted-agent-create-read","AgentX3","platform/control-plane/src/tools/hosted-agents.ts",s.agent),
        ("unconfigured-integrations","AgentX2","dashboard/backend/open_webui/routers/starli_billing.py",s.unavailable),
        ("video-create-read","AgentX3","platform/server/src/video/service.ts",s.video_create),
        ("video-validate-png","AgentX3/5","platform/server/src/video/service.ts",s.video_preview)]:
        s.run(name,owner,source,fn)
    if args.video_render:s.run("video-mp4-render","AgentX3/5","platform/server/src/video/worker.ts",s.video_render)
    print(json.dumps({"passed":sum(r["status"]=="PASS" for r in s.rows),"failed":sum(r["status"]=="FAIL" for r in s.rows),"parity_status":"NOT_VERIFIED","private_artifacts":str(s.out)}))
    return 1 if any(r["status"]=="FAIL" for r in s.rows) else 0
if __name__=="__main__":sys.exit(main())
