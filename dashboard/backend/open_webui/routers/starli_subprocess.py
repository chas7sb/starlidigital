"""Trusted server-only child setup. No ambient Node injection or client supplied paths."""
import os,stat,json,hashlib,secrets
from pathlib import Path

_STAGE_ROOT=Path("/srv/starlidigital/mcp-workspace/customer-native-phase2-20261112/release-tools/phase2-stage-20261112/isolated-stacks")
def _owned(path,mode,directory=False):
    info=path.lstat()
    return not stat.S_ISLNK(info.st_mode) and (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) and info.st_uid==os.geteuid() and stat.S_IMODE(info.st_mode)==mode

def child_setup(base_env):
    """Return explicit Node pre-import args and copied explicit environment.

    Production has no guard. QA opt-in is accepted only for an owned private
    direct-child actual-* stage and its fixed private child_guard.mjs.
    """
    env=dict(base_env)
    guard=os.environ.get("STARLI_SUBPROCESS_GUARD")
    if not guard:
        if os.environ.get("QA_SANDBOX"):raise ValueError("STARLI_SUBPROCESS_GUARD_INVALID")
        return [],env
    try:
        raw=os.environ.get("QA_SANDBOX","")
        sandbox=Path(raw)
        if not sandbox.is_absolute() or str(sandbox)!=str(sandbox.resolve(strict=True)) or sandbox.parent!=_STAGE_ROOT or not sandbox.name.startswith("actual-") or not _owned(sandbox,0o700,True):
            raise ValueError()
        expected=sandbox/"child_guard.mjs"
        if guard!=str(expected) or not _owned(expected,0o600):raise ValueError()
        audit=sandbox/"child-audit"
        if not _owned(audit,0o700,True):raise ValueError()
        runtime=sandbox/"empty.env"
        if os.environ.get("STARLI_RUNTIME_ENV_PATH")!=str(runtime) or not _owned(runtime,0o600) or runtime.stat().st_size!=0:raise ValueError()
        for name in ["home","tmp","assets","video","state"]:
            p=sandbox/name
            if not p.is_dir() or p.is_symlink() or p.resolve().parent!=sandbox or p.stat().st_uid!=os.geteuid():raise ValueError()
        env.update({"QA_SANDBOX":str(sandbox),"QA_AUDIT_CHILD":str(audit),"STARLI_RUNTIME_ENV_PATH":str(runtime),"HOME":str(sandbox/"home"),"TMPDIR":str(sandbox/"tmp"),"ASSET_STORAGE_DIR":str(sandbox/"assets"),"VIDEO_STORAGE_DIR":str(sandbox/"video"),"STARLI_SOURCE_DATABASE":str(sandbox/"source.sqlite"),"STARLI_STATE_DIR":str(sandbox/"state"),"QA_CHILD_NONCE":secrets.token_hex(32),"QA_CHILD_GUARD_SHA256":hashlib.sha256(expected.read_bytes()).hexdigest()})
        return ["--import",str(expected)],env
    except (OSError,ValueError,RuntimeError):
        raise ValueError("STARLI_SUBPROCESS_GUARD_INVALID") from None


def check_child_guard(process,env):
    """A guarded child cannot return a successful receipt without its fresh audit."""
    if "QA_AUDIT_CHILD" not in env:return
    try:
        sandbox=Path(env["QA_SANDBOX"])
        guard=sandbox/"child_guard.mjs"
        if not _owned(guard,0o600) or hashlib.sha256(guard.read_bytes()).hexdigest()!=env["QA_CHILD_GUARD_SHA256"]:raise ValueError()
        pid=process.pid
        if not isinstance(pid,int) or pid<=0:raise ValueError()
        report=Path(env["QA_AUDIT_CHILD"])/("child-"+str(pid)+".json")
        if not _owned(report,0o600) or report.stat().st_size>16384:raise ValueError()
        value=json.loads(report.read_text())
        if set(value)!={"network","subprocess","filesystem","sites","uid","nonce","loaderIpcSuppressed"} or value["uid"]!=os.geteuid() or value["sites"]!=[] or not isinstance(value["nonce"],str) or not secrets.compare_digest(value["nonce"],env["QA_CHILD_NONCE"]):raise ValueError()
        if any(type(value[k]) is not int or value[k]!=0 for k in ["network","subprocess","filesystem"]):raise ValueError()
        if type(value["loaderIpcSuppressed"]) is not int or not 0<=value["loaderIpcSuppressed"]<=2:raise ValueError()
    except (OSError,ValueError,KeyError,TypeError,AttributeError):
        raise ValueError("STARLI_SUBPROCESS_AUDIT_INVALID") from None
