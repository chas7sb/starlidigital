"""Explicit company-only integration; caller supplies actual configured services."""
from .core import CompanyTools,ToolFault
from .domains import DriveTools,register_messaging,register_research
from .runtime import install_runtime
from .router import make_router

def install(runtime,*,drive_factory=None,messaging=False,research=None,user_lookup=None,mcp=None):
 tools=CompanyTools()
 if drive_factory is not None:DriveTools(drive_factory).register(tools)
 else:tools.unavailable.append({'family':'company-drive','reason':'NATIVE_CHANNEL_DRIVE_FACTORY_NOT_CONFIGURED'})
 if messaging:register_messaging(tools)
 else:tools.unavailable.append({'family':'company-messaging','reason':'NATIVE_MESSAGING_NOT_CONFIGURED'})
 if research is not None and callable(user_lookup):
  register_research(tools,research,user_lookup)
  tools.refresh=lambda:register_research(tools,research,user_lookup)
 else:tools.unavailable.append({'family':'public-research','reason':'RESTRICTED_RESEARCH_GATEWAY_NOT_CONFIGURED'})
 for family in ('company-project-build','company-browser','company-crm','company-integrations','company-delegation'):
  tools.unavailable.append({'family':family,'reason':'EXISTING_EXECUTOR_IS_PERSONAL_OR_ADMIN_SCOPED_COMPANY_SERVICE_REQUIRED'})
 return install_runtime(runtime,tools,mcp)
