"""One server-owned account MCP management/runtime binding installation."""
from .native import NativeAccountMCP,create_native_router
from .remote import NodeRemoteAdapter
PREFIX="/api/v1/starli/mcp"
def create_native_service(*,launcher=None):
 from open_webui.routers.starli_state import state_dir
 from open_webui.routers.starli_providers import cipher
 return NativeAccountMCP(state_dir()/"account-mcp",cipher_loader=cipher),NodeRemoteAdapter(launcher=launcher)
def install(app,*,launcher=None,service=None,adapter=None,authenticate=None,capture_fence=None):
 # Only trusted application bootstrap calls this. No HTTP/env authority.
 if getattr(app.state,"starli_account_mcp_installed",False):
  return app.state.starli_account_mcp_service,app.state.starli_account_mcp_adapter
 if service is None:
  service,default_adapter=create_native_service(launcher=launcher)
  if adapter is None:adapter=default_adapter
 elif adapter is None:adapter=NodeRemoteAdapter(launcher=launcher)
 router=create_native_router(service=service,remote_adapter=adapter,authenticate=authenticate,capture_fence=capture_fence)
 app.include_router(router,prefix=PREFIX)
 app.state.starli_account_mcp_service=service
 app.state.starli_account_mcp_adapter=adapter
 app.state.starli_account_mcp_installed=True
 return service,adapter
