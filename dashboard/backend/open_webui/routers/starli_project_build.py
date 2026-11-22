"""Version-bound browser compilation from tenant project snapshots; no host package-script execution."""
from __future__ import annotations
import starli_portable as _portable
import asyncio,hashlib,json,os,signal,time
from fastapi import HTTPException
from open_webui.routers import starli_workspace as workspace
from open_webui.routers.starli_state import runtime_code_dir,state_dir

NODE=_portable.node_binary()
_ACTIVE=asyncio.Semaphore(4)
_OWNER_LIMITS={}
MAX_SECONDS=45

def source_digest(project):
    files=project.get("files") or []
    canonical=[{"path":f.get("path"),"content":f.get("content",""),"encoding":f.get("encoding","utf8")} for f in files if isinstance(f,dict)]
    canonical.sort(key=lambda f:str(f["path"]))
    return hashlib.sha256(json.dumps(canonical,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()

def invalidate_preview(project):
    """Call after a file mutation. Old compiled HTML must never represent new source."""
    project.pop("previewHtml",None)
    project.pop("html",None)
    report=project.get("previewBuild")
    if isinstance(report,dict):
        project["previewBuild"]={**report,"status":"STALE","reason":"Project files changed. Build the current source to update the preview."}
    return project

def compiled_preview(project):
    """None = no compiled build record. Otherwise return an honest current/stale preview state."""
    report=project.get("previewBuild")
    if not isinstance(report,dict):return None
    current=source_digest(project)
    if report.get("sourceDigest")!=current or report.get("status")!="PASSED":
        return {"available":False,"reason":"Project source changed or its last build failed. Ask Starli to build the current files.","sourceDigest":current,"build":report}
    html=project.get("previewHtml")
    if not isinstance(html,str) or not html:
        return {"available":False,"reason":"The current build has no browser preview.","sourceDigest":current,"build":report}
    return {"available":True,"html":html,"sourceDigest":current,"version":project.get("version",1),"framework":report.get("framework"),"checks":report.get("checks",[]),"limitations":report.get("limitations",[])}

def capabilities():
    return {"browserCompilation":True,"browserPreview":True,"hostCodeExecution":False,
            "serverBuild":False,"applicationTests":False,
            "reason":"The existing restricted Next.js Docker runner is not accessible to this service account. Package scripts, backend servers and application tests are not executed on the host."}

def _owner_limit(uid):
    if uid not in _OWNER_LIMITS:_OWNER_LIMITS[uid]=asyncio.Semaphore(1)
    return _OWNER_LIMITS[uid]

async def _launch_compiler(root):
    from open_webui.routers.starli_subprocess import child_setup
    env={"PATH":os.environ.get("PATH",os.defpath),"LANG":"C.UTF-8","HOME":str(root)}
    guard_args,child_env=child_setup(env)
    spawn=asyncio.create_task(asyncio.create_subprocess_exec(NODE,"--max-old-space-size=384",*guard_args,"--import","tsx",str(runtime_code_dir()/"project-build.mts"),
        cwd=str(runtime_code_dir()),env=_portable.child_environment(child_env),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,start_new_session=True,limit=8*1024*1024))
    interrupted=False
    while True:
        try:
            process=await asyncio.shield(spawn)
            break
        except asyncio.CancelledError:
            interrupted=True
            if spawn.cancelled():raise HTTPException(503,"Compiler launch settlement is not confirmed") from None
    if interrupted:
        await _settle_compiler(process,terminate=True)
        raise asyncio.CancelledError()
    return process,child_env

async def _wait_owned_compiler(process,terminate):
    if terminate and process.returncode is None:
        try:os.killpg(process.pid,signal.SIGKILL)
        except OSError:
            # A failed signal is never an acknowledgment. Keep waiting for proof.
            pass
    await process.wait()
    if process.returncode is None:raise HTTPException(503,"Compiler shutdown is not confirmed")
    return process.returncode

async def _settle_compiler(process,terminate=False):
    """Repeated task cancellation cannot escape before the owned child is gone."""
    waiter=asyncio.create_task(_wait_owned_compiler(process,terminate))
    interrupted=False
    while True:
        try:
            await asyncio.shield(waiter)
            break
        except asyncio.CancelledError:
            interrupted=True
            if waiter.done():
                if waiter.cancelled():raise HTTPException(503,"Compiler shutdown is not confirmed") from None
                break
    result=waiter.result()
    if interrupted:raise asyncio.CancelledError()
    return result

async def compile_snapshot(uid,project,route="/"):
    if not isinstance(route,str) or not route.startswith("/") or len(route)>160 or any(s in route for s in ("..","?","#","\\","\x00")):
        raise HTTPException(422,"Use a project page path such as / or /contact")
    files=project.get("files") or []
    if not files:raise HTTPException(409,"This project has no source files to build")
    if len(files)>200 or sum(len(str(f.get("content","")).encode()) for f in files)>2500000:raise HTTPException(422,"Project exceeds the browser compiler limit")
    for f in files:workspace.file_path(f.get("path"))
    payload={"name":str(project.get("name") or "Project preview")[:160],"files":files,"route":route}
    root=state_dir()/"compiler";root.mkdir(parents=True,exist_ok=True,mode=0o700)
    process=None
    settled=False
    async with _owner_limit(uid),_ACTIVE:
        try:
            process,child_env=await _launch_compiler(root)
            output,_=await asyncio.wait_for(process.communicate((json.dumps(payload)+"\n").encode()),MAX_SECONDS)
            await _settle_compiler(process)
            settled=True
            from open_webui.routers.starli_subprocess import check_child_guard
            check_child_guard(process,child_env)
            if len(output)>8*1024*1024:raise HTTPException(502,"Compiler output exceeds its limit")
            lines=[line for line in output.splitlines() if line.startswith(b"{")]
            if not lines or process.returncode:raise HTTPException(502,"Browser compiler stopped without a result")
            result=json.loads(lines[-1])
            if not isinstance(result.get("ok"),bool):raise HTTPException(502,"Compiler returned an invalid result")
            return result
        except asyncio.TimeoutError:raise HTTPException(504,"Browser compilation exceeded 45 seconds. No project code was executed on the host.") from None
        except (ValueError,UnicodeError):raise HTTPException(502,"Compiler returned an unreadable or unaudited result") from None
        finally:
            if process and not settled:
                await _settle_compiler(process,terminate=True)

def _authorize_build(authorize):
    if authorize is not None and authorize() is False:raise HTTPException(403,"Project build authorization is no longer available")

async def build(user,args,check_only=False,*,runtime_operation=None,authorize=None):
    _authorize_build(authorize)
    uid=workspace.owner(user);ident=args.get("projectId")
    if runtime_operation is not None and (not isinstance(runtime_operation,dict) or set(runtime_operation)!={"key","bodySha256"}):
        raise HTTPException(422,"Invalid server project operation")
    snapshot=workspace.read(uid,ident)
    if runtime_operation is not None:
        previous=workspace.operation_receipt_from_project(snapshot,runtime_operation["key"],runtime_operation["bodySha256"])
        if previous is not None:
            _authorize_build(authorize)
            return previous
    digest=source_digest(snapshot);version=snapshot.get("version",1)
    result=await compile_snapshot(uid,snapshot,args.get("route","/"))
    report={"status":"PASSED" if result["ok"] else "FAILED","sourceDigest":digest,"sourceVersion":version,
            "framework":result.get("framework"),"routes":result.get("routes",[]),
            "diagnostics":result.get("diagnostics",[])[:100],"checks":result.get("checks",[]),
            "limitations":result.get("limitations",[]),"builtAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
            "verification":"BROWSER_COMPILE_ONLY","serverRuntimeVerified":False,"applicationTestsRun":False}
    normalized={"ok":bool(result["ok"]),"status":report["status"],"projectId":ident,**report,
            "previewUpdated":bool(result["ok"] and not check_only),"capabilities":capabilities()}
    with workspace.db() as db:
        db.execute("BEGIN IMMEDIATE");current=workspace.get(db,uid,ident)
        if runtime_operation is not None:
            previous=workspace.operation_receipt_from_project(current,runtime_operation["key"],runtime_operation["bodySha256"])
            if previous is not None:
                _authorize_build(authorize)
                return previous
        changed=source_digest(current)!=digest
        _authorize_build(authorize)
        if changed:
            normalized={"ok":False,"status":"SOURCE_CHANGED","projectId":ident,"sourceDigest":digest,
                "currentSourceDigest":source_digest(current),"diagnostics":report["diagnostics"],
                "message":"Project files changed during compilation. This result was not saved or shown as the current preview."}
            if runtime_operation is not None:
                workspace.record_operation(current,runtime_operation,normalized)
                _authorize_build(authorize)
                workspace.save(db,uid,current)
            return normalized
        current["lastSourceCheck"]=report
        if not check_only:
            current["previewBuild"]=report
            if result["ok"]:current["previewHtml"]=result["html"]
            else:current.pop("previewHtml",None)
        if runtime_operation is not None:workspace.record_operation(current,runtime_operation,normalized)
        _authorize_build(authorize)
        workspace.save(db,uid,current)
    return normalized

TOOL_SCHEMAS=[
 {"name":"project_build","description":"Compile the actual current project files into a browser preview and report syntax/import errors. Supports HTML, React and browser-compatible Next.js pages. Does not run backend servers or package scripts.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string","description":"Current customer project ID"},"route":{"type":"string","default":"/","description":"Static page route to preview, for example /contact"}},"required":["projectId"]},"previewExecutable":True},
 {"name":"project_check","description":"Check browser source syntax and imports from the actual project snapshot. This is compilation, not an application test suite or backend verification.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string","description":"Current customer project ID"}},"required":["projectId"]},"previewExecutable":True}
]
def schema(name):return next((t for t in TOOL_SCHEMAS if t["name"]==name),None)
async def tool(user,name,args):
    if name=="project_test":raise HTTPException(409,capabilities()["reason"])
    if name not in ("project_build","project_check"):raise HTTPException(404,"Unknown compiler tool")
    return await build(user,args,check_only=name=="project_check")
