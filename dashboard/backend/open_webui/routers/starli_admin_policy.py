"""Server-captured administrator grant; no client/model-supplied authority."""
from dataclasses import dataclass
from fastapi import HTTPException
NATIVE_TOOLS=('capabilities','starlis.list','platform.schema','platform.call')
PROJECT_TOOLS=('project_create','project_list','project_files','project_file_read','project_file_write','project_check','project_build','project_preview')
ADMIN_TOOLS=('starli_source_read','starli_source_list','starli_status','platform_capabilities','platform_overview','api_overview','projects_list','project_get','crm_upsert_prospect','crm_add_activity','outreach_create_draft')
ADMIN_TOOLS += ('local_vm_status','local_vm_screenshot','local_vm_click','local_vm_type','local_vm_key','local_vm_scroll')
LIMITS={'maxModelTurns':120,'maxToolAttempts':120,'maxWallclockSeconds':3600,'maxProjectsPerRun':1,'maxFileBytes':65536,'maxProjectBytes':2000000,'maxFiles':200,'buildTimeoutSeconds':45}
@dataclass(frozen=True)
class AdminScope:
    owner_native_id:str
    agent_id:str
    run_id:str
    chat_id:str
    provider:str
    model:str
    grant_version:int
    account_binding:tuple|None=None

def capability_scope(available_admin_ids):
    ids=set(available_admin_ids)
    if not ids.issubset(ADMIN_TOOLS):raise HTTPException(403,'ADMIN_TOOL_DENIED')
    return {'version':'starli.capability-scope.v1','id':'starli-admin.v1','tools':list(NATIVE_TOOLS),'projectTools':list(PROJECT_TOOLS),'adminTools':[x for x in ADMIN_TOOLS if x in ids],'limits':dict(LIMITS),'eligibility':{'requiresAuthentication':True,'requiresOwnedActiveAgent':True,'requiresAdministrator':True,'requiresPersistedPlatformGrant':True,'supportedAgentProviders':['hosted','account'],'projectAccess':'agent-bound-owned'}}

def capture_identity(user,chat_id):
    from open_webui.models.users import Users
    from open_webui.routers import starli_v3_native as native
    uid=getattr(user,'id',None);fresh=Users.get_user_by_id(uid)
    if fresh is None or getattr(fresh,'role',None)!='admin':raise HTTPException(403,'ADMIN_ROLE_REQUIRED')
    native._ready(fresh);native.owned_live_chat(fresh,chat_id);owner=native._owner(fresh)
    with native._db() as db:
        row=db.execute("SELECT a.* FROM agent_conversations c JOIN agents a ON a.id=c.agent_id AND a.owner=c.owner WHERE c.owner=? AND c.chat_id=? AND a.archived_at IS NULL",(owner,chat_id)).fetchone()
    if not row:raise HTTPException(404,'ADMIN_AGENT_UNAVAILABLE')
    if row['status']!='IDLE' or not row['platform_access']:raise HTTPException(403,'ADMIN_GRANT_REVOKED')
    from open_webui.routers.starli_personal_provider import capture_provider
    return {'owner_native_id':uid,'agent_id':row['id'],'chat_id':chat_id,'grant_version':row['version'],**capture_provider(fresh,row,"ADMIN")}

def authorize_scope(scope,authorize):
    if not isinstance(scope,AdminScope):raise HTTPException(403,'ADMIN_SCOPE_REQUIRED')
    user=authorize()
    if getattr(user,'id',None)!=scope.owner_native_id:raise HTTPException(403,'ADMIN_SCOPE_OWNER_MISMATCH')
    actual=capture_identity(user,scope.chat_id)
    expected={k:getattr(scope,k) for k in actual}
    if actual!=expected:raise HTTPException(403,'ADMIN_SCOPE_CHANGED')
    return user
