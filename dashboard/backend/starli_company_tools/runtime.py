"""Explicit install hook for the EXISTING CompanyRuntime object; keeps all mixins."""
import json,hashlib,re,types
from .core import BoundCall,ToolFault,require
def install_runtime(runtime,tools,mcp=None):
 require(not getattr(runtime,'_company_tools_installed',False),'COMPANY_TOOLS_ALREADY_INSTALLED',409)
 catalogue=runtime.tool_catalogue;execute=runtime.execute_tool;event=runtime.tool_event;run=runtime._run
 if mcp:mcp.install(runtime)
 with runtime.store.db()as db:db.execute('CREATE TABLE IF NOT EXISTS cr_company_tool_calls(run TEXT,call TEXT,name TEXT,hash TEXT,state TEXT,result TEXT,PRIMARY KEY(run,call))')
 async def tool_catalogue(self,session,ctx,selection,turn):
  result=await catalogue(session,ctx,selection,turn);require(self.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,turn),'COMPANY_TOOL_RUN_REVOKED');result+= [{k:v for k,v in spec.items()if k in ('name','description','parameters','effect')}for spec in tools.catalogue(self,ctx)]
  if mcp:result+=await mcp.runtime_catalogue(self,session,ctx,selection,turn)
  return result
 async def execute_tool(self,session,ctx,selection,turn,value):
  if mcp and isinstance(value,dict) and mcp.owns(turn,value.get('name')):return await mcp.execute(self,session,ctx,selection,turn,value)
  if not isinstance(value,dict)or value.get('name')not in tools.specs:return await execute(session,ctx,selection,turn,value)
  require(set(value)=={'toolCallId','name','args'} and isinstance(value['toolCallId'],str)and re.fullmatch(r'[A-Za-z0-9_.:-]{1,180}',value['toolCallId'])is not None,'COMPANY_TOOL_BINDING_INVALID',422)
  from company_messaging.internal_send import NativeToolScope
  with self.store.access(session,ctx.company_id,ctx.room_id)as(db,_,_):
   row=db.execute('SELECT message FROM cr_turns WHERE id=?',(turn,)).fetchone();require(row is not None,'COMPANY_TOOL_RUN_REVOKED');native=NativeToolScope(ctx.company_id,ctx.room_id,ctx.bot_id,turn,value['toolCallId'],ctx.actor_id,ctx.actor_binding,ctx,row['message']);require(self.authorize_native(db,native),'COMPANY_TOOL_RUN_REVOKED')
   fingerprint=hashlib.sha256(json.dumps([value['name'],value['args']],sort_keys=True,allow_nan=False).encode()).hexdigest();old=db.execute('SELECT * FROM cr_company_tool_calls WHERE run=? AND call=?',(turn,value['toolCallId'])).fetchone()
   if old:
    require(old['hash']==fingerprint,'COMPANY_TOOL_CALL_COLLISION',409);require(old['state']=='COMPLETED','COMPANY_TOOL_UNCERTAIN_NO_RETRY',409);return result(json.loads(old['result']))
   db.execute('INSERT INTO cr_company_tool_calls VALUES(?,?,?,?,?,NULL)',(turn,value['toolCallId'],value['name'],fingerprint,'INTENT'))
  bound=BoundCall(self,session,ctx,selection,turn,value['toolCallId'],native.assistant_message_id,native)
  try:
   output=await tools.execute(bound,value['name'],value['args'])
   with self.store.access(session,ctx.company_id,ctx.room_id)as(db,_,_):
    require(self.authorize_native(db,native),'COMPANY_TOOL_RUN_REVOKED');db.execute("UPDATE cr_company_tool_calls SET state='COMPLETED',result=? WHERE run=? AND call=?",(json.dumps(output),turn,value['toolCallId']))
   return result(output)
  except BaseException:
   with self.store.db()as db:db.execute("UPDATE cr_company_tool_calls SET state='UNKNOWN' WHERE run=? AND call=? AND state='INTENT'",(turn,value['toolCallId']))
   raise
 def tool_event(self,session,ctx,selection,turn,value):
  require(isinstance(value,dict),'COMPANY_TOOL_EVENT_INVALID',422)
  name=value.get('name')
  if name not in tools.specs and not(mcp and mcp.owns(turn,name)):return event(session,ctx,selection,turn,value)
  require(self.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,turn),'COMPANY_TOOL_RUN_REVOKED');require(value.get('status')in ('started','succeeded','failed','uncertain')and isinstance(value.get('toolCallId'),str)and re.fullmatch(r'[A-Za-z0-9_.:-]{1,180}',value['toolCallId'])is not None,'COMPANY_TOOL_EVENT_INVALID',422)
  with self.store.access(session,ctx.company_id,ctx.room_id)as(db,_,_):
   if mcp and mcp.owns(turn,name):require(mcp.event_allowed(turn,value),'COMPANY_MCP_SUCCESS_WITHOUT_RECEIPT',503)
   if value['status']=='succeeded'and name in tools.specs:
    old=db.execute('SELECT state FROM cr_company_tool_calls WHERE run=? AND call=?',(turn,value['toolCallId'])).fetchone();require(old is not None and old['state']=='COMPLETED','COMPANY_TOOL_SUCCESS_WITHOUT_RECEIPT',503)
   safe={'version':'starli.tool.v1','toolCallId':value['toolCallId'],'publicToolName':name,'status':{'started':'RUNNING','succeeded':'COMPLETED','failed':'FAILED','uncertain':'UNCERTAIN'}[value['status']]};db.execute("INSERT INTO cr_events(turn,type,state)VALUES(?,'tool.lifecycle',?)",(turn,json.dumps(safe)))
 async def cleanup(self,*args,**kwargs):
  try:return await run(*args,**kwargs)
  finally:
   if mcp:mcp.release(args[3])
 runtime.tool_catalogue=types.MethodType(tool_catalogue,runtime);runtime.execute_tool=types.MethodType(execute_tool,runtime);runtime.tool_event=types.MethodType(tool_event,runtime);runtime._run=types.MethodType(cleanup,runtime);runtime._company_tools_installed=True;runtime.company_tools=tools;runtime.company_mcp=mcp
 return runtime
def result(value):return {'outcome':'settled','result':{'content':[{'type':'text','text':json.dumps(value)}]}}
