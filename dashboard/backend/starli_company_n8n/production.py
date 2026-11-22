"""Protected server composition; no owner credential is exposed to bot tools."""
import starli_portable as _portable
import json,threading
from pathlib import Path
from starli_automations.production import private_json
from starli_n8n_mcp.client import McpClient,OWNED_WORKFLOW_TOOLS
from .gateway import Gateway,PURE

class LazyClient:
    def __init__(self,client):self.client=client;self.ready=False;self.lock=threading.Lock()
    def call(self,name,args):
        with self.lock:
            if not self.ready:self.client.initialize();self.ready=True
        return self.client.call(name,args)
    def content(self,result):return self.client.content(result)

def install_production(app,runtime,config_path=_portable.config_file('n8n-mcp.json')):
    from .native import install
    from starli_automations.common import need
    need(runtime is app.state.company_bot_runtime,'NATIVE_RUNTIME_MISMATCH',503)
    config=private_json(config_path)
    directory=Path(__file__).parent
    schemas=json.loads((directory/'mcp-tools.json').read_text())['tools']
    metadata=json.loads((directory/'connector-catalog.json').read_text())['connectors']
    installed={c['id']:c for c in metadata if c['id'].rsplit('.',1)[-1]in PURE}
    client=LazyClient(McpClient(config['baseUrl'],config['token'],{t['name']:t['inputSchema']for t in schemas},allowed_tools=OWNED_WORKFLOW_TOOLS,timeout=25))
    gateway=Gateway(app.state.starli_automations,client,installed)
    gateway.recover()
    return install(app,gateway)
