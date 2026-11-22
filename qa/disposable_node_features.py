"""Independent actual Node GraphQL checks; dashboard tool failures remain separately recorded."""
import argparse,base64,hashlib,http.cookiejar,json,pathlib,time,urllib.request,urllib.error
from disposable_features import Suite,ROOT,helper,Failure

class NodeSuite(Suite):
    def __init__(self,state):
        super().__init__(state,"node-feature-smoke.json")
        self.jar=http.cookiejar.CookieJar()
        self.client=urllib.request.build_opener(urllib.request.ProxyHandler({}),helper.NoRedirect(),urllib.request.HTTPCookieProcessor(self.jar))
    def gql(self,query,variables=None,record=True):
        request=urllib.request.Request(self.config["platform"]+"/graphql",data=json.dumps({"query":query,"variables":variables or {}}).encode(),headers={"Content-Type":"application/json","Origin":self.config["dashboard"]})
        try:
            with self.client.open(request,timeout=60) as response:result=json.load(response)
        except urllib.error.HTTPError as e:raise Failure("GraphQL HTTP "+str(e.code)) from None
        if record:self.raw.append({"graphql":query,"result":result})
        if result.get("errors"):raise Failure("GraphQL errors; inspect private receipt")
        return result.get("data",{})
    def login(self):
        c=helper.private_read(self.state/"qa-credentials.json")
        d=self.gql("mutation($u:String!,$p:String!){login(username:$u,password:$p){id role}}",{"u":"qaowner","p":c["password"]},record=False)
        if d.get("login",{}).get("role")!="ADMIN":raise Failure("Node owner login failed")
        self.authenticate()
        return {"node_role":"ADMIN","dashboard_role":"admin"}
    def crm_node(self):
        r=self.gql("mutation($i:CrmCompanyInput!){crmUpsertCompany(input:$i){id name version}}",{"i":{"name":self.tag+" Node CRM","domain":self.tag.lower()+".invalid"}})["crmUpsertCompany"]
        self.created["crm_company"]=r["id"]
        d=self.gql("query($id:String!){crmCompany(id:$id){id name version}}",{"id":r["id"]})["crmCompany"]
        view=self.req("/api/v1/starli/customer-data/crm/"+r["id"])
        if d["name"]!=r["name"] or view.get("company",{}).get("name")!=r["name"]:raise Failure("Node/dashboard CRM read model mismatch")
        return {"id":r["id"],"version":r["version"],"node_and_dashboard_readback":True}
    def agent_node(self):
        r=self.gql("mutation($i:HostedAgentCreateInput!){hostedAgentCreate(input:$i){id name status instructions}}",{"i":{"name":self.tag+" Node agent","businessName":"Synthetic local QA","type":"SUPPORT","instructions":"Local QA config only"}})["hostedAgentCreate"]
        self.created["hosted_agent"]=r["id"]
        d=self.gql("query($id:ID!){hostedAgent(id:$id){id name status instructions}}",{"id":r["id"]})["hostedAgent"]
        if d!=r or d["status"] in ("ACTIVE","DEMO"):raise Failure("Agent readback/publish status mismatch")
        return {"id":r["id"],"status":r["status"],"configuration_readback":True}
    def create_video(self):
        self.spec={"canvas":{"width":240,"height":240,"fps":10},"scenes":[{"id":"qa-scene","duration":0.3,"background":{"type":"color","color":"#102030"},"layers":[{"type":"text","text":"Local QA","fontSize":24}]}]}
        r=self.gql("mutation($t:String!,$s:String!){createVideoProject(title:$t,format:CUSTOM,specJson:$s){id title width height duration}}",{"t":self.tag+" Node video","s":json.dumps(self.spec)})["createVideoProject"]
        self.created["video_project"]=r["id"]
        d=self.gql("query($id:ID!){videoProject(id:$id){id title specJson}}",{"id":r["id"]})["videoProject"]
        if d["id"]!=r["id"] or json.loads(d["specJson"])!=self.spec:raise Failure("Video spec readback mismatch")
        return r
    def preview_video(self):
        if "video_project" not in self.created:raise Failure("Blocked: no video project")
        v=self.gql("query($s:String!){validateVideoSpec(specJson:$s){valid errorsJson}}",{"s":json.dumps(self.spec)})["validateVideoSpec"]
        if not v["valid"]:raise Failure("Video validation failed; inspect private engine errors")
        d=self.gql("query($id:ID!){videoPreviewFrame(projectId:$id,timestamp:0){dataUrl}}",{"id":self.created["video_project"]})["videoPreviewFrame"]
        png=base64.b64decode(d["dataUrl"].split(",",1)[1],validate=True)
        if not png.startswith(b"\x89PNG\r\n\x1a\n"):raise Failure("Actual PNG signature invalid")
        helper.private_storage().create_private_file(self.out/"node-video-preview.png",png)
        return {"bytes":len(png),"sha256":hashlib.sha256(png).hexdigest(),"png_signature":True}
    def render_video(self):
        if "video_project" not in self.created:raise Failure("Blocked: no video project")
        d=self.gql("mutation($id:ID!){startVideoRender(projectId:$id){id status}}",{"id":self.created["video_project"]})["startVideoRender"]
        rid=d["id"];self.created["video_render"]=rid;deadline=time.monotonic()+75
        while True:
            r=self.gql("query($id:ID!){videoRender(id:$id){id status stage outputUrl fileSize error}}",{"id":rid})["videoRender"]
            if r["status"]=="COMPLETE":
                url=r["outputUrl"]
                if not url.startswith("/media/videos/") or "?" in url:raise Failure("Unexpected video media URL")
                with self.client.open(self.config["platform"]+url,timeout=20) as response:media=response.read(20*1024*1024+1)
                if len(media)<1000 or len(media)>20*1024*1024 or media[4:8]!=b"ftyp":raise Failure("Actual MP4 signature/size invalid")
                helper.private_storage().create_private_file(self.out/"node-video-output.mp4",media)
                return {"render_id":rid,"status":"COMPLETE","bytes":len(media),"sha256":hashlib.sha256(media).hexdigest(),"mp4_ftyp":True}
            if r["status"] in ("FAILED","CANCELLED"):raise Failure("Render "+r["status"]+"; inspect private engine receipt")
            if time.monotonic()>deadline:raise Failure("Render deadline exceeded; last status "+r["status"])
            time.sleep(3)
def main():
    p=argparse.ArgumentParser();p.add_argument("--state",required=True,type=pathlib.Path);a=p.parse_args();s=NodeSuite(a.state)
    s.run("node-owner-auth","AgentX10","onboarding/platform-owner.mjs",s.login)
    if not s.token:return 1
    for name,fn in [("node-crm-create-read-dashboard",s.crm_node),("node-agent-create-read",s.agent_node),("node-video-create-read",s.create_video),("node-video-validate-png",s.preview_video),("node-video-mp4",s.render_video)]:
        s.run(name,"AgentX3/5","platform/server/src/schema.ts and domain GraphQL resolvers",fn)
    print(json.dumps({"passed":sum(r["status"]=="PASS" for r in s.rows),"failed":sum(r["status"]=="FAIL" for r in s.rows),"parity_status":"NOT_VERIFIED","private_artifacts":str(s.out)}))
    return 1 if any(r["status"]=="FAIL" for r in s.rows) else 0
if __name__=="__main__":raise SystemExit(main())
