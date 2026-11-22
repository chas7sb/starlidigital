"""Read-only source contract and optional localhost HTTP smoke. Not a parity certificate."""
import argparse, ast, json, pathlib, re, sys, urllib.request, urllib.error
HERE = pathlib.Path(__file__).resolve().parent
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--root",type=pathlib.Path,default=HERE.parent)
    p.add_argument("--base-url")
    p.add_argument("--output",type=pathlib.Path)
    a=p.parse_args(); checks=[]
    def record(name,ok,detail): checks.append(dict(name=name,status="PASS" if ok else "FAIL",detail=detail))
    dashboard=a.root/"dashboard"; src=dashboard/"src"; backend=dashboard/"backend"
    for rel in (HERE/"source-evidence/ui-files.txt").read_text().splitlines():
        record("source:"+rel,(src/rel).is_file(),"File retained from active dashboard inventory")
    panels=json.loads((HERE/"source-evidence/panels.json").read_text(encoding="utf-8"))
    for panel in panels:
        f=src/"lib/components/starli-preview"/panel["file"]
        text=f.read_text(encoding="utf-8") if f.is_file() else ""
        missing=[n for n in panel["functions"] if not re.search(r"\bfunction\s+"+re.escape(n)+r"\b",text)]
        record("panel:"+panel["file"],f.is_file() and not missing,{"missing_functions":missing})
    expected=json.loads((HERE/"source-evidence/backend-routes.json").read_text())
    byfile={}
    for file,line,method,path,name in expected: byfile.setdefault(file,[]).append((method,path,name))
    for rel,routes in byfile.items():
        f=backend/rel; actual=set(); error=None
        try:
            tree=ast.parse(f.read_text(encoding="utf-8"))
            for n in ast.walk(tree):
                if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)):
                    for d in n.decorator_list:
                        if isinstance(d,ast.Call) and isinstance(d.func,ast.Attribute) and d.args and isinstance(d.args[0],ast.Constant):
                            actual.add((d.func.attr,str(d.args[0].value),n.name))
        except (OSError,SyntaxError) as exc:error=str(exc)
        missing=[r for r in routes if r not in actual]
        record("routes:"+rel,not error and not missing,{"error":error,"missing":missing})
    forbidden={"pricing","about","contact","landing","marketing","testimonials"}
    marketing=[]
    if (src/"routes").exists():
        for f in (src/"routes").rglob("+page.svelte"):
            if forbidden.intersection(f.relative_to(src/"routes").parts):marketing.append(str(f))
    record("marketing-route-names",(src/"routes").is_dir() and not marketing,{"candidates":marketing,"limitation":"Heuristic only; rendered root, auth and navigation review still required."})
    for rel in ["workspace_entry.py","open_webui/starli_task_worker.py"]:
        record("entrypoint:"+rel,(backend/rel).is_file(),"Effective production dashboard entrypoint/worker required")
    if a.base_url:
        from urllib.parse import urlparse
        u=urlparse(a.base_url)
        if u.scheme not in ("http","https") or u.hostname not in ("localhost","127.0.0.1","::1") or u.username or u.password:
            p.error("--base-url must target localhost without credentials")
        for path,kind in [("/","html"),("/auth","html"),("/api/config","json")]:
            try:
                with urllib.request.urlopen(a.base_url.rstrip("/")+path,timeout=15) as r:
                    body=r.read(200000);ct=r.headers.get("Content-Type","")
                    ok=r.status==200 and (("html" in ct and b"<html" in body.lower()) if kind=="html" else isinstance(json.loads(body),dict))
                    record("http:"+path,ok,{"status":r.status,"content_type":ct})
            except Exception as exc:record("http:"+path,False,str(exc))
    report={"parity_status":"NOT_VERIFIED","scope":"source contract plus optional unauthenticated local HTTP smoke","checks":checks,"passed":sum(c["status"]=="PASS" for c in checks),"failed":sum(c["status"]=="FAIL" for c in checks)}
    text=json.dumps(report,indent=2)
    if a.output:a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(text,encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k!="checks"}))
    return 1 if report["failed"] else 0
if __name__=="__main__":sys.exit(main())
