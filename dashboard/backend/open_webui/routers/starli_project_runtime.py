"""Server-derived owned-project runtime. No model/provider, publish, shell or global platform grant."""
from __future__ import annotations
import asyncio,hashlib,json,re
from fastapi import HTTPException
from open_webui.routers import starli_workspace as workspace
from open_webui.routers import starli_project_build as compiler
from open_webui.routers.starli_project_policy import ProjectScope,ProjectJournal,ProjectPolicyFault,validate_tool
from open_webui.routers.starli_state import state_dir
MUTATIONS={"project_create","project_file_write","project_check","project_build","project_preview"}
def schemas():
    string={"type":"string"}
    fields={
      "project_create":({"name":{**string,"maxLength":120},"brief":{**string,"maxLength":8000}},["name"]),
      "project_list":({},[]),
      "project_files":({"projectId":string},["projectId"]),
      "project_file_read":({"projectId":string,"path":string},["projectId","path"]),
      "project_file_write":({"projectId":string,"path":string,"content":{**string,"maxLength":65536},"expectedSha256":{"type":["string","null"],"pattern":"^[a-f0-9]{64}$"}},["projectId","path","content"]),
      "project_check":({"projectId":string},["projectId"]),
      "project_build":({"projectId":string,"route":{**string,"default":"/"}},["projectId"]),
      "project_preview":({"projectId":string},["projectId"])}
    return [{"name":name,"description":name.replace("_"," ")+" within this owned agent project only.","inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":False}} for name,(properties,required) in fields.items()]
def _failure(code,status="FAILED"):
    return {"ok":False,"status":status,"error":code,"needsReview":status=="UNCERTAIN"}
def _uncertain():
    return {**_failure("PROJECT_OPERATION_UNCERTAIN","UNCERTAIN"),"_projectRuntime":{"uncertain":True,"receiptReplayed":False}}
_DIAGNOSTIC_MESSAGES={
    "ENTRY_NOT_FOUND":"No browser entry found. Add pages/index.js (or index.jsx/ts/tsx), src/pages/index.*, app/page.*, src/app/page.*, or a supported React entry.",
    "SERVER_RUNTIME_UNSUPPORTED":"This source uses a server-only feature. Use browser-compatible code for the preview.",
    "MODULE_UNSUPPORTED":"This dependency is unavailable in the browser preview. Use a supported browser package or a local source file.",
    "SOURCE_IMPORT_ERROR":"A source import could not be resolved. Check its package name and relative file path.",
    "SOURCE_SYNTAX_ERROR":"Browser source has a syntax error at this location.",
    "BROWSER_ROUTE_UNSUPPORTED":"Requested page is unavailable in browser preview. Choose a supported static route.",
    "ROUTE_LIMIT":"The project exceeds the browser preview route limit.",
    "DUPLICATE_ROUTE":"Two source pages resolve to the same browser route. Keep one page per route.",
    "COMPILATION_FAILED":"Browser compilation failed. Inspect the project layout and source."}
def _diagnostic_sensitive(value):
    return bool(re.search(r"(?i)sk-(?:proj-|ant-)?[a-z0-9_-]{8,}|bearer|api[_-]?key|password|credential|access[_-]?token|refresh[_-]?token|secret|private|authorization|cookie|-----BEGIN",value))
def _diagnostic_file(value):
    if not isinstance(value,str):return None
    if value.startswith("project:"):value=value[len("project:"):]
    if not value or len(value)>180 or value.startswith(("/",".")) or ":" in value or "\\" in value or any(ord(c)<32 or ord(c)==127 for c in value) or _diagnostic_sensitive(value):return None
    parts=value.split("/")
    if any(p in ("",".","..",".git","node_modules",".env") or p.startswith(".env.") for p in parts) or parts[0].lower() in {"etc","var","srv","home","root","tmp","users"}:return None
    if not re.fullmatch(r"[A-Za-z0-9_@(). /-]+",value):return None
    return value
def _diagnostic_module(message):
    if not isinstance(message,str) or len(message)>2000 or _diagnostic_sensitive(message):return None
    match=re.match(r'(?:Unavailable browser module:|Server/Node module|Server module|Preview dependency is unavailable:|Could not resolve|Cannot resolve)\s*["\']?([@A-Za-z0-9_][@A-Za-z0-9_./-]{0,100})',message)
    if not match:match=re.search(r'(?:^|\s)Import: ([@A-Za-z0-9_][@A-Za-z0-9_./-]{0,100})[.]?$',message)
    if not match:return None
    value=match.group(1).rstrip(".")
    if value.startswith(".") or any(p in ("",".","..") for p in value.split("/")) or value.split("/")[0].lower() in {"etc","var","srv","home","root","tmp","users"}:return None
    return value
def _diagnostic_syntax(message):
    if not isinstance(message,str) or len(message)>2000 or _diagnostic_sensitive(message):return None
    for prefix in ("Unterminated string literal","Unterminated template literal","Unterminated regular expression","Unterminated multi-line comment","Unexpected end of file","Unexpected end of input"):
        if message.startswith(prefix):return prefix+"."
    tokens={"}","{",";",":",")","(","=",",","]","[",">","<","=>","/","identifier","string","number","end of file","end of input"}
    if message in {"Unexpected token in browser source.","Unterminated source token.","Browser source syntax is invalid."}:return message
    trusted=re.fullmatch(r'Expected (.+?) in browser source[.]',message)
    if trusted:
        token=trusted.group(1).strip('"\'')
        if token in tokens:return "Expected "+json.dumps(token)+" in browser source."
    match=re.fullmatch(r'Expected (.+?) but found (.+?)[.]?',message.strip())
    if match:
        expected=match.group(1).strip('"\'');found=match.group(2).strip('"\'')
        if expected in tokens and found in tokens:return "Expected "+expected+" but found "+found+"."
    match=re.fullmatch(r'Unexpected ["\'](.{1,3})["\'][.]?',message.strip())
    if match and match.group(1) in tokens:return "Unexpected token "+match.group(1)+"."
    if re.fullmatch(r'The symbol ["\'][A-Za-z_$][A-Za-z0-9_$]{0,100}["\'] has already been declared',message):return "A symbol is declared more than once at this location."
    return None
def private_diagnostics(values):
    """Owner-private repair DTO only: max10/4KiB, no sourceLine/HTML/absolute paths or raw errors."""
    if not isinstance(values,list):return []
    result=[]
    for value in values[:100]:
        if not isinstance(value,dict):continue
        code=value.get("code")
        if not isinstance(code,str) or code not in _DIAGNOSTIC_MESSAGES:code="COMPILATION_FAILED"
        message=_DIAGNOSTIC_MESSAGES[code]
        if code=="SOURCE_SYNTAX_ERROR":message=_diagnostic_syntax(value.get("message")) or message
        elif code in {"MODULE_UNSUPPORTED","SERVER_RUNTIME_UNSUPPORTED","SOURCE_IMPORT_ERROR"}:
            module=_diagnostic_module(value.get("message"))
            if module:message=("Unavailable browser module: "+module+". Check the import or use supported browser code.")
        item={"code":code,"message":message[:240]}
        file=_diagnostic_file(value.get("file") or value.get("path"))
        if file:item["file"]=file
        for key in ("line","column"):
            coordinate=value.get(key)
            if type(coordinate) is int and (1 if key=="line" else 0)<=coordinate<=1000000:item[key]=coordinate
        if len(json.dumps([*result,item],ensure_ascii=False,separators=(",",":")).encode())>4096:break
        result.append(item)
        if len(result)>=10:break
    return result
def _normalized(tool,result,ident):
    if tool=="project_create":
        return {"ok":True,"status":"CREATED","projectId":result["id"],"name":str(result.get("name",""))[:120],"version":result.get("version",1)}
    if tool=="project_file_write":
        return {"ok":True,"status":"SAVED",**{k:result[k] for k in ("projectId","path","sha256","version")}}
    if tool=="project_preview":return dict(result)
    return {"ok":result.get("ok") is True,"status":result.get("status","FAILED"),"projectId":ident,
        **{k:result[k] for k in ("sourceDigest","currentSourceDigest","sourceVersion","framework","previewUpdated","verification","serverRuntimeVerified","applicationTestsRun") if k in result},
        "diagnosticCount":result.get("diagnosticCount",len(result.get("diagnostics") or [])),"diagnostics":private_diagnostics(result.get("diagnostics")),"routes":[x for x in result.get("routes",[])[:30] if isinstance(x,str) and len(x)<=240]}
def _marker(scope,call_id,tool,body_hash):
    key=hashlib.sha256(json.dumps([scope.owner_native_id,scope.agent_id,scope.run_id,scope.chat_id,call_id,tool],separators=(",",":")).encode()).hexdigest()
    return {"key":key,"bodySha256":body_hash}
async def dispatch(user,scope:ProjectScope,tool,args,call_id,authorize):
    if not isinstance(scope,ProjectScope):raise ProjectPolicyFault("PROJECT_SCOPE_REQUIRED",403)
    def fresh():
        current=authorize()
        identity=current.get("id") if isinstance(current,dict) else getattr(current,"id",None)
        if identity!=scope.owner_native_id:raise ProjectPolicyFault("PROJECT_ACCESS_DENIED",403)
        return current
    fresh_user=fresh()
    supplied=user.get("id") if isinstance(user,dict) else getattr(user,"id",None)
    if supplied!=scope.owner_native_id:raise ProjectPolicyFault("PROJECT_ACCESS_DENIED",403)
    root_owner=workspace.owner(fresh_user)
    def check():
        current=fresh()
        if workspace.owner(current)!=root_owner:raise ProjectPolicyFault("PROJECT_ACCESS_DENIED",403)
        return current
    args=validate_tool(tool,args)
    journal=ProjectJournal(state_dir()/"project-runtime"/"operations.sqlite",authorize=lambda action:check())
    if tool=="project_list":
        items=[]
        for ident in journal.list_bound(scope)[:100]:
            try:project=workspace.read(root_owner,ident)
            except HTTPException as error:
                if error.status_code==404:continue
                raise
            items.append(workspace.summary(project))
        check();return {"ok":True,"status":"COMPLETED","items":items}
    ident=args.get("projectId")
    if tool not in MUTATIONS:
        journal.require_project(scope,ident);project=workspace.read(root_owner,ident)
        if tool=="project_files":result={"ok":True,"status":"COMPLETED","projectId":ident,"version":project.get("version",1),"files":workspace.manifest(project)}
        else:
            path=workspace.file_path(args["path"]);file=next((f for f in project.get("files",[]) if f.get("path")==path),None)
            if file is None:raise HTTPException(404,"Project file not found")
            content=file.get("content","")
            if not isinstance(content,str) or len(content.encode())>65536:raise HTTPException(413,"Project file exceeds runtime read limit")
            result={"ok":True,"status":"COMPLETED","projectId":ident,"path":path,"content":content,"sha256":hashlib.sha256(content.encode()).hexdigest(),"version":project.get("version",1)}
        check();return result
    # Existing unsettled intents NEVER re-enter the effect executor.
    try:begin=journal.begin_operation(scope,call_id,tool,args)
    except ProjectPolicyFault as error:
        if error.code!="PROJECT_OPERATION_UNCERTAIN":raise
        prior=journal.inspect_operation(scope,call_id);operation=_marker(scope,call_id,tool,prior["bodySha256"])
        candidate=workspace.runtime_project_id(root_owner,operation["key"]) if tool=="project_create" else ident
        try:committed=workspace.operation_receipt(root_owner,candidate,operation["key"],operation["bodySha256"])
        except HTTPException as unavailable:
            if unavailable.status_code!=404:raise
            committed=None
        if committed is None:return _uncertain()
        result=_normalized(tool,committed,candidate)
        if tool=="project_create":journal.bind_project(scope,candidate)
        journal.settle(scope,call_id,result,expected_status=prior["status"],expected_body_hash=prior["bodySha256"])
        check();return {**result,"_projectRuntime":{"receiptReplayed":True,"reconciled":True}}
    if begin["replay"]:
        if begin["result"].get("ok") is True:workspace.read(root_owner,begin["result"].get("projectId") or ident)
        check();return {**begin["result"],"_projectRuntime":{"receiptReplayed":True,"reconciled":False}}
    prior=journal.inspect_operation(scope,call_id);operation=_marker(scope,call_id,tool,prior["bodySha256"])
    effect_started=False
    try:
        check()
        if tool=="project_create":
            effect_started=True;raw=workspace.create(root_owner,args["name"],args.get("brief",""),runtime_operation=operation,authorize=check)
            ident=raw["id"];journal.bind_project(scope,ident)
        else:
            journal.require_project(scope,ident)
            if tool=="project_file_write":
                effect_started=True;raw=workspace.write(root_owner,ident,args["path"],args["content"],args.get("expectedSha256"),runtime_operation=operation,authorize=check)
            elif tool in ("project_check","project_build"):
                effect_started=True;raw=await compiler.build(check(),args,check_only=tool=="project_check",runtime_operation=operation,authorize=check)
            else:
                with workspace.db() as db:
                    db.execute("BEGIN IMMEDIATE");project=workspace.get(db,root_owner,ident)
                    preview=compiler.compiled_preview(project);report=project.get("previewBuild") or {};digest=compiler.source_digest(project)
                    if not isinstance(preview,dict) or preview.get("available") is not True or report.get("status")!="PASSED" or report.get("sourceDigest")!=digest:
                        raw=_failure("PREVIEW_UNAVAILABLE");raw["projectId"]=ident
                    else:raw={"ok":True,"status":"COMPLETED","projectId":ident,"version":project.get("version",1),"sourceDigest":digest,"url":None}
                    workspace.record_operation(project,operation,raw);check();workspace.save(db,root_owner,project);check()
        result=_normalized(tool,raw,ident)
        check();journal.settle(scope,call_id,result,expected_body_hash=prior["bodySha256"])
        return {**result,"_projectRuntime":{"receiptReplayed":False}}
    except asyncio.CancelledError:
        try:journal.settle(scope,call_id,_failure("PROJECT_OPERATION_UNCERTAIN","UNCERTAIN"),status="UNCERTAIN",expected_body_hash=prior["bodySha256"])
        except Exception:pass
        raise
    except (HTTPException,ProjectPolicyFault) as error:
        # Known precondition errors from owned transactional native methods have rolled back effects.
        # But a committed marker (e.g. effect committed before a bind/session failure) must remain uncertain.
        candidate=workspace.runtime_project_id(root_owner,operation["key"]) if tool=="project_create" else ident
        committed=None
        try:committed=workspace.operation_receipt(root_owner,candidate,operation["key"],operation["bodySha256"])
        except Exception:pass
        if committed is not None or getattr(error,"status_code",getattr(error,"status",500))>=500:
            try:journal.settle(scope,call_id,_failure("PROJECT_OPERATION_UNCERTAIN","UNCERTAIN"),status="UNCERTAIN",expected_body_hash=prior["bodySha256"])
            except Exception:pass
            return _uncertain()
        result=_failure("PROJECT_PRECONDITION_REJECTED");result["httpStatus"]=getattr(error,"status_code",getattr(error,"status",400))
        try:journal.settle(scope,call_id,result,expected_body_hash=prior["bodySha256"])
        except Exception:return _uncertain()
        return {**result,"_projectRuntime":{"receiptReplayed":False}}
    except Exception:
        try:journal.settle(scope,call_id,_failure("PROJECT_OPERATION_UNCERTAIN","UNCERTAIN"),status="UNCERTAIN",expected_body_hash=prior["bodySha256"])
        except Exception:pass
        return _uncertain()
