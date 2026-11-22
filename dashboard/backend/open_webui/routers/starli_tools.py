"""Native Starli MCP bridge for explicitly bound private-preview administrators."""
import starli_portable as _portable
import asyncio,json,os
from fastapi import APIRouter,Depends,HTTPException,Request
from pydantic import BaseModel,Field
from open_webui.utils.auth import get_verified_user
from open_webui.routers.starli_platform import customer_principal as principal
from open_webui.routers.starli_state import runtime_code_dir

router=APIRouter()
LOCAL_TOOLS=frozenset('project_manage website_generate crm_upsert_prospect crm_add_activity outreach_create_draft agent_create agent_update agent_configure agent_add_knowledge video_project_create video_project_apply_spec video_project_patch_spec video_validate video_preview_frame video_render_start video_voiceover_create brand_profile_create video_asset_upload video_asset_import'.split())
READ_TOOLS=frozenset('brand_profile_get video_render_status agency_overview agent_get agent_list_conversations agent_list_customer_leads assets_list audit_recent_actions client_workspace_get company_signals crm_get_prospect crm_list_opportunities crm_search_prospects inbox_read inbox_search interaction_list lead_score outreach_get_limits outreach_get_thread pipeline_get platform_capabilities platform_overview project_get project_verify_live projects_list prospect_research starli_status suppression_check task_agent_approval_get task_agent_logs task_agent_result task_agent_status video_output_get video_project_get video_project_list video_validate website_get_structure api_overview'.split())
async def _bridge(user,operation,tool=None,args=None,approved=False,*,require_admin=False):
 from open_webui.routers.starli_execution_context import platform_enabled
 unrestricted=platform_enabled(user)
 if require_admin and not unrestricted:raise HTTPException(403,"ADMIN_PLATFORM_GRANT_REQUIRED")
 if unrestricted:
  from open_webui.routers.starli_platform import principal as platform_principal
  uid,binding=platform_principal(user)
 else:uid,binding=principal(user)
 if operation!='catalog' and tool not in READ_TOOLS|LOCAL_TOOLS and not approved and not unrestricted:raise HTTPException(403,'This tool needs a scoped write integration and approval; execution is not enabled here')
 payload={'owner':binding['v2UserId'],'operation':operation,'tool':tool,'args':args or {},'customer':not unrestricted,'customerEmail':getattr(user,'email',None)}
 child_env={k:v for k,v in os.environ.items() if k in ('PATH','HOME','LANG','OPENAI_API_KEY','STARLI_PLATFORM_SOURCE_ROOT','STARLI_SOURCE_DATABASE','STARLI_STATE_DIR','STARLI_RUNTIME_CODE_DIR')}
 guard_args=[]
 if require_admin:
  from open_webui.routers.starli_subprocess import child_setup
  guard_args,child_env=child_setup(child_env)
 process=await asyncio.create_subprocess_exec(_portable.node_binary(),*guard_args,'--import','tsx',str(runtime_code_dir()/'platform-bridge.mts'),
 cwd=str(runtime_code_dir()),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,
 env=child_env,start_new_session=require_admin)
 try:
  out,_=await asyncio.wait_for(process.communicate((json.dumps(payload)+'\n').encode()),45)
  if len(out)>1000000:raise HTTPException(502,'Tool response exceeds preview limit')
  lines=[line for line in out.decode().splitlines() if line.startswith('{')]
  if not lines:raise HTTPException(502,'Platform tool returned no receipt')
  return json.loads(lines[-1])
 except asyncio.TimeoutError:raise HTTPException(504,'Tool timed out; no automatic retry')
 finally:
  if require_admin:
   from open_webui.routers.starli_pi_master import _stop_primary_worker
   await _stop_primary_worker(process,child_env)
  elif process.returncode is None:process.kill();await process.wait()

async def bridge(user,operation,tool=None,args=None,approved=False,operation_key=None):
 uid,_=principal(user)
 from open_webui.routers import starli_customer_actions,starli_mail
 for module in (starli_customer_actions,starli_mail):
  if operation!='catalog' and module.schema(tool):return await module.tool(user,tool,args or {},operation_key)
 from open_webui.routers import starli_project_build
 if operation!='catalog' and starli_project_build.schema(tool):return await starli_project_build.tool(user,tool,args or {})
 from open_webui.routers import starli_social
 if operation!='catalog' and starli_social.schema(tool):return await starli_social.tool(user,tool,args or {})
 from open_webui.routers.starli_access import full_access
 from open_webui.routers import starli_workspace as workspace
 if operation!='catalog' and workspace.schema(tool):return workspace.tool(user,tool,args or {})
 if operation!='catalog' and tool not in READ_TOOLS:
  from open_webui.routers.starli_tool_receipts import execute
  return await execute(uid,operation_key,tool,args or {},lambda:_bridge(user,operation,tool,args,approved))
 from open_webui.routers import starli_workspace as workspace
 if operation!='catalog' and workspace.schema(tool):return workspace.tool(user,tool,args or {})
 return await _bridge(user,operation,tool,args,approved)

@router.get('/catalog')
async def catalog(user=Depends(get_verified_user)):
 result=await bridge(user,'catalog')
 from open_webui.routers.starli_approvals import APPROVABLE
 from open_webui.routers.starli_access import full_access
 unrestricted=full_access(user)
 from open_webui.routers.starli_workspace import TOOL_SCHEMAS
 from open_webui.routers.starli_social import TOOL_SCHEMAS as SOCIAL_SCHEMAS
 from open_webui.routers.starli_project_build import TOOL_SCHEMAS as BUILD_SCHEMAS
 from open_webui.routers.starli_customer_actions import TOOL_SCHEMAS as ACTION_SCHEMAS
 from open_webui.routers.starli_mail import TOOL_SCHEMAS as MAIL_SCHEMAS
 TOOL_SCHEMAS=[*TOOL_SCHEMAS,*SOCIAL_SCHEMAS,*BUILD_SCHEMAS,*ACTION_SCHEMAS,*MAIL_SCHEMAS]
 result.setdefault('tools',[]).extend(TOOL_SCHEMAS)
 result['fullAccess']=unrestricted
 for tool in result.get('tools',[]):
  tool['previewExecutable']=unrestricted or tool.get('name') in READ_TOOLS|LOCAL_TOOLS or tool.get('name') in {t['name'] for t in TOOL_SCHEMAS}
  tool['approvalAvailable']=tool.get('name') in APPROVABLE
 from open_webui.routers.starli_tool_presentation import present
 result['tools']=[present(tool) for tool in result.get('tools',[])]
 return result

class InvokeBody(BaseModel):
 tool:str=Field(min_length=1,max_length=100)
 args:dict=Field(default_factory=dict)
 operationKey:str|None=Field(default=None,min_length=1,max_length=256)
 class Config:extra='forbid'

@router.post('/invoke')
async def invoke(body:InvokeBody,request:Request,user=Depends(get_verified_user)):
 from open_webui.routers.starli_v3_native import _mutation_guard
 _mutation_guard(request)
 return await bridge(user,'invoke',body.tool,body.args,operation_key=body.operationKey)

@router.get('/operator-trace')
async def operator_trace(chatId:str|None=None,taskId:str|None=None,limit:int=100,user=Depends(get_verified_user)):
 from open_webui.routers.starli_tool_trace import recent
 uid,_=principal(user)
 if str(getattr(user,'role','')).lower()!='admin':raise HTTPException(403,'Admin only')
 return {'events':recent(uid,chatId,taskId,limit)}
