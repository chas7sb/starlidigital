"""Summarize actual base execution plus a targeted successful preview correction."""
import json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1];results=ROOT/"qa/results"
base=json.loads((results/"feature-smoke.json").read_text());sources=[("feature-smoke.json",base)]
execution="Single complete actual HTTP execution"
if base["failed"]:
 retry=json.loads((results/"preview-retry.json").read_text())
 if base["dashboard"]!=retry["dashboard"] or base["created"]["video_project"]!=retry["created"]["video_project"]:raise SystemExit("Reports do not refer to the same disposable project/origin")
 sources.append(("preview-retry.json",retry));execution="Base execution plus targeted operation-key correction on the same video project; see source-report attribution"
checks={}
for filename,report in sources:
 for row in report["checks"]:checks[row["name"]]={**row,"source_report":filename}
report={"parity_status":"NOT_VERIFIED","scope":"Ten representative local disposable authenticated HTTP feature checks; not full feature/OS/UI/VM parity",
 "execution":execution,
 "dashboard":base["dashboard"],"created":base["created"],"checks":list(checks.values()),
 "passed":sum(r["status"]=="PASS" for r in checks.values()),"failed":sum(r["status"]=="FAIL" for r in checks.values())}
(results/"representative-smoke.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps({k:report[k] for k in ("passed","failed","parity_status")}))
