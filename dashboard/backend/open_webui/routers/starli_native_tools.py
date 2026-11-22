"""Starli platform tools for native OpenWebUI chat."""
import json
from typing import Optional
from fastapi import HTTPException

def resolve_user(identity):
 from open_webui.models.users import Users
 from open_webui.routers.starli_platform import customer_principal as principal
 uid=identity.get('id') if isinstance(identity,dict) else None
 user=Users.get_user_by_id(uid) if uid else None
 if not user:raise HTTPException(403,'Authenticated user unavailable')
 principal(user)
 return user

class Tools:
 async def search_crm(self, query: str, __user__: Optional[dict]=None) -> str:
  """Search StarliDigital CRM companies by name, industry, locality or email."""
  from open_webui.routers.starli_platform import crm
  from open_webui.routers.starli_tools import bridge
  return json.dumps(await bridge(resolve_user(__user__),'invoke','crm_search_prospects',{'search':query[:200],'limit':20}))

 async def platform_capabilities(self, __user__: Optional[dict]=None) -> str:
  """List platform capability names. Catalog entries may require additional integration."""
  from open_webui.routers.starli_platform import capabilities
  from open_webui.routers.starli_tools import catalog
  data=await catalog(user=resolve_user(__user__))
  return json.dumps({'capabilities':[x['name'] for x in data.get('tools',[])],'execution':'owner-scoped customer tools'})

 async def browse_public_page(self,url:str,__user__:Optional[dict]=None,__event_emitter__=None)->str:
  """Open a public webpage in the live browser visible to the user. Public read-only research only."""
  from open_webui.routers.starli_browser import browser_action
  result=await browser_action(resolve_user(__user__),'navigate',{'url':url})
  if __event_emitter__:await __event_emitter__({'type':'status','data':{'description':'Opened live browser: '+result.get('title',''),'done':True}})
  return json.dumps({k:v for k,v in result.items() if k!='image'})

 async def read_browser(self,__user__:Optional[dict]=None)->str:
  """Read the current public page from the same live browser shown to the user."""
  from open_webui.routers.starli_browser import browser_action
  result=await browser_action(resolve_user(__user__),'frame',{})
  return json.dumps({k:v for k,v in result.items() if k!='image'})

 async def delegate_task(self,prompt:str,idempotency_key:str,__user__:Optional[dict]=None)->str:
  """Delegate a bounded research task to a Pi subagent. Maximum two active tasks. Use a unique stable idempotency key; never retry with a new key after an uncertain response."""
  from open_webui.routers.starli_runtime import dispatch_starli_task
  user=resolve_user(__user__)
  return json.dumps(await dispatch_starli_task(user.id,prompt,idempotency_key))

 async def task_status(self,task_id:str,__user__:Optional[dict]=None)->str:
  """Inspect the status, result and receipts of your delegated task."""
  from open_webui.routers.starli_runtime_adapter import adapter
  user=resolve_user(__user__)
  return json.dumps(await adapter(user.id,'tasks.get',{'taskId':task_id}))

 async def cancel_task(self,task_id:str,__user__:Optional[dict]=None)->str:
  """Cancel your delegated task. Cancellation does not replay any operation."""
  from open_webui.routers.starli_runtime_adapter import adapter
  user=resolve_user(__user__)
  return json.dumps(await adapter(user.id,'tasks.cancel',{'taskId':task_id}))

 async def inspect_tool_schema(self,tool_name:str,__user__:Optional[dict]=None)->str:
  """Inspect the actual parameter schema and execution availability of a Starli platform tool."""
  from open_webui.routers.starli_tools import catalog
  data=await catalog(user=resolve_user(__user__))
  return json.dumps(next((t for t in data.get('tools',[]) if t.get('name')==tool_name),{'error':'Unknown tool'}))

 async def invoke_platform_tool(self,tool_name:str,arguments_json:str,__user__:Optional[dict]=None,__metadata__:Optional[dict]=None)->str:
  """Execute a connected Starli platform tool after inspecting its schema. Approval mode permits reads; Full Access permits actions without per-action approval. Pass arguments as a JSON object."""
  from open_webui.routers.starli_tools import bridge
  args=json.loads(arguments_json)
  if not isinstance(args,dict):raise ValueError('Arguments must be an object')
  import hashlib
  key=hashlib.sha256(json.dumps({'message':(__metadata__ or {}).get('message_id'),'tool':tool_name,'args':args},sort_keys=True).encode()).hexdigest()
  return json.dumps(await bridge(resolve_user(__user__),'invoke',tool_name,args,operation_key=key))

 async def prepare_platform_action(self,tool_name:str,arguments_json:str,__user__:Optional[dict]=None)->str:
  """Prepare exact platform action arguments for human review. This does not execute the action. Ask the user to review and confirm in Approvals; never claim completion."""
  from open_webui.routers.starli_approvals import prepare,Prepare
  return json.dumps(prepare(Prepare(tool=tool_name,args=json.loads(arguments_json)),user=resolve_user(__user__)))

 async def execution_mode(self,__user__:Optional[dict]=None)->str:
  """Read the current user-selected execution mode. Only the user can change this in the interface."""
  from open_webui.routers.starli_access import status
  return json.dumps(status(user=resolve_user(__user__)))
