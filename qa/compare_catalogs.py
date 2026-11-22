"""Read-only real HTTP catalog comparison on the two declared disposable backends."""
import argparse,json,pathlib
from disposable_features import Suite,helper,ROOT
def main():
 p=argparse.ArgumentParser();p.add_argument("--state",type=pathlib.Path,required=True);a=p.parse_args();s=Suite(a.state)
 credentials=helper.private_read(s.state/"qa-credentials.json");out=[]
 for port in (18280,18282):
  base="http://127.0.0.1:"+str(port);row={"origin":base}
  try:
   auth=helper.request(base,"/api/v1/auths/signin",credentials)
   token=auth.get("token")
   if not token:raise RuntimeError("Owner token absent")
   r=helper.request(base,"/api/v1/starli/tools/catalog",token=token)
   helper.private_write(s.out/("catalog-"+str(port)+".json"),r)
   tools=r.get("tools",[])
   names={x["name"] for x in tools}
   required={"crm_upsert_prospect","agent_create","agent_get","video_project_create","video_project_get","video_validate","video_preview_frame","project_file_write"}
   row.update(http=200,tool_count=len(tools),isError=r.get("isError",False),missing_required=sorted(required-names))
  except Exception as e:
   # The shared helper errors contain status/path only, never response contents.
   row.update(error=str(e) if isinstance(e,RuntimeError) else type(e).__name__)
  out.append(row)
 report={"parity_status":"NOT_VERIFIED","read_only":True,"checks":out}
 (ROOT/"qa/results/catalog-comparison.json").write_text(json.dumps(report,indent=2));print(json.dumps(report))
if __name__=="__main__":main()
