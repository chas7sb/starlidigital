from pathlib import Path
import json
from open_webui.models.users import Users
from open_webui.models.tools import Tools,ToolForm,ToolMeta
from open_webui.models.models import Models,ModelForm,ModelMeta,ModelParams
from open_webui.utils.tools import get_tool_specs
from open_webui.routers.starli_native_tools import Tools as NativeTools
root=Path('/srv/starlidigital/mcp-workspace/starli-ultra-openwebui-v3/preview-runtime')
login=json.loads((root/'preview-login.json').read_text())
user=Users.get_user_by_email(login['email'])
assert user and user.role=='admin'
content=Path('/srv/starlidigital/mcp-workspace/starli-ultra-openwebui-v3/starli-ultra-fork/backend/open_webui/routers/starli_native_tools.py').read_text()
specs=get_tool_specs(NativeTools())
tool_id='starli-platform-native'
form=ToolForm(id=tool_id,name='Starli Platform',content=content,meta=ToolMeta(description='CRM, platform tools, live browser and Pi delegation'),access_control={})
existing=Tools.get_tool_by_id(tool_id)
result=Tools.update_tool_by_id(tool_id,{**form.model_dump(),'specs':specs}) if existing else Tools.insert_new_tool(user.id,form,specs)
assert result
form=ModelForm(id='starli-ultra',base_model_id='gpt-6-luna',name='Starli AI',meta=ModelMeta(description='Your StarliDigital assistant',toolIds=[tool_id],capabilities={'vision':True,'file_upload':True}),params=ModelParams(function_calling='native',reasoning_effort='none',system='You are Starli AI. Use available tools for real platform data. Subagents are delegated through delegate_task, never simulated. Inspect schemas before invoke_platform_tool. The browser is shared live with the user. Catalog presence does not establish execution availability. Report task IDs and verified receipts. Never invent completion.'),access_control={})
result=Models.update_model_by_id('starli-ultra',form) if Models.get_model_by_id('starli-ultra') else Models.insert_new_model(form,user.id)
assert result
print(json.dumps({'tool':tool_id,'functions':[s['name'] for s in specs],'model':'starli-ultra','private':True}))

from open_webui.models.functions import Functions,FunctionForm,FunctionMeta
pipe_content=Path('/srv/starlidigital/mcp-workspace/starli-ultra-openwebui-v3/starli-ultra-fork/scripts/starli-runtime/starli-pi-pipe.py').read_text()
form=FunctionForm(id='starli_pi',name='Starli AI · Pi',content=pipe_content,meta=FunctionMeta(description='Primary Starli Pi runtime with live tools and bounded delegation'))
if Functions.get_function_by_id('starli_pi'):
 result=Functions.update_function_by_id('starli_pi',form.model_dump())
else:result=Functions.insert_new_function(user.id,'pipe',form)
assert result
Functions.update_function_by_id('starli_pi',{'is_active':True})
print('Registered native Starli AI Pi pipe.')

# Public read is intentional for the single verified-account inference pipe.
# No native toolIds/actions are attached; only the bound admin master grants tools.
form=ModelForm(id='starli_pi',base_model_id=None,name='Starli AI',meta=ModelMeta(description='STARLIDIGITAL assistant',toolIds=[],actionIds=[],capabilities={'vision':True,'file_upload':True,'web_search':False,'code_interpreter':False}),params=ModelParams(),access_control=None)
result=Models.update_model_by_id('starli_pi',form) if Models.get_model_by_id('starli_pi') else Models.insert_new_model(form,user.id)
assert result
