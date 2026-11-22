"""Open only the current conversation's real project preview from actual tool activity."""
import hashlib,json,re
from fastapi import HTTPException
PROJECT_TOOLS={"project_file_write","project_build","project_preview","website_generate"}
def payloads(result):
    if isinstance(result,dict):
        yield result
        for part in result.get("content",[]) if isinstance(result.get("content"),list) else []:
            if isinstance(part,dict) and part.get("type")=="text" and isinstance(part.get("text"),str):
                try:value=json.loads(part["text"])
                except (ValueError,TypeError):continue
                if isinstance(value,dict):yield value

async def scoped_project_activity(user,scope,tool,args,result,authorize=None):
    """Server-only trusted scope; never use elevated workspace.tool or result-supplied URLs."""
    from open_webui.routers.starli_project_policy import ProjectScope,ProjectJournal
    if not isinstance(scope,ProjectScope) or tool not in {"project_build","project_preview"}:return None
    if not isinstance(result,dict) or result.get("ok") is not True or (result.get("_projectRuntime") or {}).get("receiptReplayed"):return None
    if result.get("status") not in {"PASSED","COMPLETED"}:return None
    from open_webui.models.users import Users
    from open_webui.models.chats import Chats
    from open_webui.routers import starli_workspace as workspace,starli_v3_native as native
    from open_webui.routers import starli_project_build as compiler
    from open_webui.routers.starli_state import state_dir
    def fresh():
        current=authorize() if authorize else Users.get_user_by_id(scope.owner_native_id)
        if not current or current.id!=scope.owner_native_id or current.role not in {"user","admin"}:raise HTTPException(403,"Project preview access denied")
        if not Chats.get_chat_by_id_and_user_id(scope.chat_id,current.id):raise HTTPException(404,"Project preview conversation unavailable")
        with native._db() as registry:
            native._get(registry,native._owner(current),scope.agent_id)
            row=registry.execute("SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",(native._owner(current),scope.chat_id)).fetchone()
            if not row or row["agent_id"]!=scope.agent_id:raise HTTPException(404,"Project preview agent binding unavailable")
        return current
    current=fresh()
    if user.id!=scope.owner_native_id:return None
    args=args if isinstance(args,dict) else {};ident=args.get("projectId")
    if not isinstance(ident,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}",ident) or result.get("projectId")!=ident:return None
    journal=ProjectJournal(state_dir()/"project-runtime"/"operations.sqlite",authorize=lambda action:fresh())
    journal.require_project(scope,ident)
    root_owner=workspace.owner(current)
    project=workspace.read(root_owner,ident);report=project.get("previewBuild") or {}
    digest=compiler.source_digest(project);preview=compiler.compiled_preview(project)
    if report.get("status")!="PASSED" or report.get("sourceDigest")!=digest or not isinstance(preview,dict) or preview.get("available") is not True:return None
    if result.get("sourceDigest")!=digest:return None
    source_version=project.get("version",1)
    if type(source_version) is not int or source_version<1:return None
    routes=[route for route in report.get("routes",[])[:30] if isinstance(route,str) and route.startswith("/") and not route.startswith("//") and len(route)<=240 and not any(ord(c)<32 for c in route)]
    build_id=workspace.preview_identity(project)["buildId"]
    event={"schemaVersion":"starli.project.preview.v1","type":"preview.ready","chatId":scope.chat_id,"agentId":scope.agent_id,"runId":scope.run_id,
        "projectId":ident,"name":str(project.get("name","Project"))[:160],"phase":"ready","sourceVersion":source_version,"sourceDigest":digest,
        "buildId":build_id,"buildKey":build_id,"routes":routes,"previewEndpoint":"/api/v1/starli/workspace/projects/"+ident+"/preview",
        "showPreview":True,"explicitShow":tool=="project_preview"}
    fresh()
    # Do not announce readiness if source changed while checking role/binding.
    latest=workspace.read(root_owner,ident)
    if compiler.source_digest(latest)!=digest or latest.get("version",1)!=source_version or (latest.get("previewBuild") or {}).get("status")!="PASSED":return None
    from open_webui.routers.starli_session_fence import emit_owner
    await emit_owner("starli-project",event,current.id)
    return event

async def _project_activity(user,chat_id,agent_id,tool,args,result=None,phase="building",run_id=None):
    if tool not in PROJECT_TOOLS or not chat_id:return
    from open_webui.models.chats import Chats
    if not Chats.get_chat_by_id_and_user_id(chat_id,user.id):return
    if result is not None:
        from open_webui.routers.starli_result_status import classify_result
        if classify_result(result)["status"] not in ("COMPLETED","PENDING"):return
    args=args if isinstance(args,dict) else {}
    ident=args.get("projectId")
    for data in payloads(result):
        project=data.get("project")
        ident=data.get("projectId") or (project.get("id") if isinstance(project,dict) else None) or ident
    if not isinstance(ident,str):return
    from open_webui.routers import starli_workspace as workspace
    from open_webui.routers import starli_v3_native as native
    from open_webui.routers.starli_execution_context import agent_scope,platform_enabled
    uid=workspace.owner(user)
    with agent_scope(agent_id,chat_id):
        if platform_enabled(user):
            with workspace.db() as connection:row=connection.execute("SELECT owner FROM records WHERE collection='projects' AND id=?",(ident,)).fetchone()
            if row:uid=row["owner"]
        try:project=workspace.read(uid,ident)
        except HTTPException:return
    if tool=="project_file_write":
        web_extensions=(".html",".htm",".tsx",".jsx",".svelte",".vue",".css")
        has_ui=any(isinstance(f,dict) and str(f.get("path","")).lower().endswith(web_extensions) for f in project.get("files",[]))
        writing_ui=str(args.get("path","")).lower().endswith(web_extensions)
        if not has_ui and not writing_ui:return
    # One mission key survives bounded continuations. Closing it does not cause
    # each subsequent file write to reopen the same build.
    mission=str(run_id or chat_id)
    if agent_id:
        with native._db() as connection:
            session=connection.execute("SELECT objective FROM autonomous_sessions WHERE owner=? AND agent_id=? AND enabled=1",(native._owner(user),agent_id)).fetchone()
        if session:mission=agent_id+":"+session["objective"]
    build_key=hashlib.sha256(mission.encode()).hexdigest()
    event={"chatId":chat_id,"agentId":agent_id,"projectId":ident,"name":project.get("name","Project"),
           "phase":phase,"version":project.get("version",1),"buildKey":build_key,
           "showPreview":True,"explicitShow":tool=="project_preview"}
    from open_webui.routers.starli_session_fence import emit_owner
    await emit_owner("starli-project",event,user.id)

async def project_activity(*args,**kwargs):
    try:await _project_activity(*args,**kwargs)
    except Exception:
        import logging
        logging.getLogger(__name__).warning("Project preview notification deferred")
