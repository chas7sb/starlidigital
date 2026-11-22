"""Bounded worker diagnostics. Raw stderr, prompts and provider output never persist."""
import asyncio,hashlib,json,re,sqlite3
from pathlib import Path

_TYPES={"Error","TypeError","ReferenceError","SyntaxError","RangeError","TimeoutError","AbortError","TransformError","ImportError","ModuleNotFoundError","PermissionError","ConnectionError","RuntimeError","JSONDecodeError","UnknownError"}
_STAGES={"startup","inference","decision","tool_result","worker","primary","unknown"}
_CODES={"PROVIDER_SUBSCRIPTION_MODEL_UNSUPPORTED","ERR_MODULE_NOT_FOUND","MODULE_NOT_FOUND","ERR_REQUIRE_ESM","ERR_PACKAGE_PATH_NOT_EXPORTED","ERR_INVALID_ARG_TYPE","ERR_UNKNOWN_FILE_EXTENSION","ERR_INVALID_MODULE_SPECIFIER","ERR_UNSUPPORTED_DIR_IMPORT","ENOMEM","EACCES","EPERM","ENOENT","ECONNREFUSED","ETIMEDOUT","ECONNRESET","UNABLE_TO_VERIFY_LEAF_SIGNATURE","CERT_HAS_EXPIRED","PROVIDER_INFERENCE_FAILED","INVALID_MODEL_DECISION","TOOL_NOT_ALLOWED","COORDINATOR_DISCONNECTED","STEP_LIMIT","REPEATED_TOOL_CALL","PI_EXECUTION_FAILED","PI_XAI_INFERENCE_FAILED","PI_XAI_EMPTY_OUTPUT","PI_XAI_AUTH_REQUIRED","WORKER_EXITED","WORKER_NO_FINAL_RECEIPT","PRIMARY_TIMEOUT"}

def safe_code(value):
    if not isinstance(value,str):return ""
    return value if value in _CODES or re.fullmatch(r"STARLI_INFERENCE_(?:HTTP_[0-9]{3}|EMPTY|URL_INVALID|TIMEOUT|OUTPUT_LIMIT)",value) else ""

def clean(value,*,fallback_stage="worker"):
    value=value if isinstance(value,dict) else {}
    fingerprint=value.get("fingerprint")
    result={"stage":value.get("stage") if isinstance(value.get("stage"),str) and value.get("stage") in _STAGES else fallback_stage,
            "errorType":value.get("errorType") if isinstance(value.get("errorType"),str) and value.get("errorType") in _TYPES else "UnknownError",
            "code":safe_code(value.get("code")) or "PI_EXECUTION_FAILED"}
    if isinstance(fingerprint,str) and re.fullmatch(r"[0-9a-f]{16}",fingerprint):result["fingerprint"]=fingerprint
    node=safe_code(value.get("nodeCode"))
    if node:result["nodeCode"]=node
    if isinstance(value.get("stderrBytes"),int):result["stderrBytes"]=max(0,min(value["stderrBytes"],1000000000))
    return result

def from_event(event):
    event=event if isinstance(event,dict) else {}
    value=event.get("diagnostic") if isinstance(event.get("diagnostic"),dict) else {}
    return clean({**value,"code":safe_code(event.get("code")) or value.get("code")})

def from_stderr(raw,total_bytes=None):
    raw=raw if isinstance(raw,bytes) else b""
    raw=raw[:8192];text=raw.decode("utf-8",errors="replace")
    for line in text.splitlines()[:80]:
        if line.startswith("STARLI_WORKER_FAILURE "):
            try:
                value=json.loads(line[len("STARLI_WORKER_FAILURE "):])
                if isinstance(value,dict):return clean({**value,"stderrBytes":total_bytes if total_bytes is not None else len(raw)})
            except (ValueError,TypeError):pass
    error_type=next((name for name in sorted(_TYPES) if re.search(r"(?:^|\n|STARLI_WORKER_FAILURE\s+)"+re.escape(name)+r"(?:[:\s\[])",text)), "UnknownError")
    code=next((code for code in sorted(_CODES) if re.search(r"(?<![A-Z0-9_])"+re.escape(code)+r"(?![A-Z0-9_])",text)), "WORKER_EXITED")
    return clean({"stage":"startup","errorType":error_type,"code":code,"fingerprint":hashlib.sha256(raw).hexdigest()[:16],"stderrBytes":total_bytes if total_bytes is not None else len(raw)},fallback_stage="startup")

async def drain(stream):
    captured=bytearray();total=0
    if stream is None:return from_stderr(b"",0)
    try:
        while True:
            chunk=await stream.read(2048)
            if not chunk:break
            if not isinstance(chunk,bytes):break
            total+=len(chunk)
            if len(captured)<8192:captured.extend(chunk[:8192-len(captured)])
    except asyncio.CancelledError:raise
    except Exception:pass
    return from_stderr(bytes(captured),total)

def merge(event,stderr):
    selected=clean(event) if event else clean(stderr,fallback_stage="startup")
    if stderr:
        other=clean(stderr,fallback_stage="startup")
        if selected["errorType"]=="UnknownError" and other["errorType"]!="UnknownError":selected["errorType"]=other["errorType"]
        if other.get("nodeCode"):selected["nodeCode"]=other["nodeCode"]
        if other.get("code") in _CODES and other["code"].startswith("ERR_"):selected["nodeCode"]=other["code"]
        if "stderrBytes" in other:selected["stderrBytes"]=other["stderrBytes"]
        if "fingerprint" not in selected and other.get("fingerprint"):selected["fingerprint"]=other["fingerprint"]
    return selected

def persist_primary(path,owner,prompt_hash,code,diagnostic):
    import time,uuid
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    receipt={"status":"FAILED","code":safe_code(code) or "PI_EXECUTION_FAILED","diagnostic":clean(diagnostic)}
    with sqlite3.connect(str(path)) as db:
        db.execute("CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,owner TEXT,prompt_hash TEXT,receipt TEXT,created REAL)")
        db.execute("INSERT INTO receipts VALUES(?,?,?,?,?)",(uuid.uuid4().hex,str(owner),str(prompt_hash)[:64],json.dumps(receipt),time.time()))
    path.chmod(0o600)
    return receipt["diagnostic"]

def persist_task(db_factory,ident,owner,diagnostic):
    value=clean(diagnostic)
    with db_factory() as db:
        db.execute("BEGIN IMMEDIATE")
        row=db.execute("SELECT payload FROM tasks WHERE id=? AND owner=?",(ident,owner)).fetchone()
        if not row:return
        task=json.loads(row[0])
        if task.get("status") not in ("FAILED","INTERRUPTED"):return
        task["failureDiagnostic"]=value
        db.execute("UPDATE tasks SET payload=? WHERE id=? AND owner=?",(json.dumps(task),ident,owner))
