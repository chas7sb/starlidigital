"""Read-only catalog subprocess diagnosis; raw process output stays private."""
import argparse,importlib.util,json,pathlib,re,subprocess
from disposable_features import ROOT,Suite,helper
def main():
    p=argparse.ArgumentParser();p.add_argument("--state",type=pathlib.Path,required=True);p.add_argument("--systemroot",action="store_true");a=p.parse_args();s=Suite(a.state)
    helper.LOCAL=s.state;helper.CONFIG=s.state/"setup.json"
    env=helper.environment(s.config)
    bindings=helper.private_read(s.state/"bindings.json")
    owner=next(iter(bindings["memberships"].values()))["v2UserId"]
    allowed=("PATH","HOME","LANG","OPENAI_API_KEY","STARLI_PLATFORM_SOURCE_ROOT","STARLI_SOURCE_DATABASE","STARLI_STATE_DIR","STARLI_RUNTIME_CODE_DIR","STARLI_PLATFORM_ORIGIN","STARLI_WORKSPACE_ROOT","PYTHON_BIN")
    child_env={k:v for k,v in env.items() if k in allowed}
    if a.systemroot:
        child_env.update({k:v for k,v in env.items() if k.upper()=="SYSTEMROOT"})
    result=subprocess.run([env["STARLI_NODE_BINARY"],"--import","tsx",str(ROOT/"platform/extensions/starli-runtime/platform-bridge.mts")],
        cwd=ROOT/"platform/extensions/starli-runtime",env=child_env,input=json.dumps({"owner":owner,"operation":"catalog","customer":True,"customerEmail":"owner@example.invalid"})+"\n",
        capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=55)
    helper.private_write(s.out/"bridge-diagnosis.json",{"returncode":result.returncode,"stdout":result.stdout,"stderr":result.stderr})
    codes=sorted(set(re.findall(r"\b(?:ERR_[A-Z_]+|[A-Z_]+_REQUIRED|RAW_DATABASE_ACCESS_DENIED|MODULE_NOT_FOUND)\b",result.stderr)))
    if "ncrypto::CSPRNG" in result.stderr:codes.append("NODE_CSPRNG_INITIALIZATION_ABORT")
    missing=re.findall(r"Cannot find (?:package|module) ['\"]([^'\"]+)",result.stderr)
    # Only module identifiers; never print environment values, paths or complete stderr.
    safe_missing=[x for x in missing if "/" not in x and "\\" not in x and ":" not in x]
    public={"operation":"catalog","added_systemroot":a.systemroot,"returncode":result.returncode,"error_codes":codes,"missing_packages":safe_missing,"stdout_json_receipt":any(x.startswith("{") for x in result.stdout.splitlines()),"private_artifacts":str(s.out)}
    (ROOT/"qa/results/bridge-diagnosis.json").write_text(json.dumps(public,indent=2))
    print(json.dumps(public))
if __name__=="__main__":main()
