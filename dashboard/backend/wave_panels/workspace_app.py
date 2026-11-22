"""Product composition for an isolated b-viewer release."""
import json,os,subprocess
from pathlib import Path
from fastapi import HTTPException,Depends
from open_webui.main import app
from open_webui.config import DATA_DIR
from open_webui.company_authority import Authority
from open_webui.company_drive.drive import Drive
from open_webui.company_drive.quota import SafeBlobs,UploadPolicy
from open_webui.company_drive.native_channels import ChannelDrive,NativeChannels
from open_webui.routers.company_drive import router as drive_router,native_database
from open_webui.routers.starli_session_fence import capture_request_fence
from open_webui.routers.starli_v3_native import _mutation_guard
from open_webui.utils.auth import get_verified_user
from native_install import install_panels, EmailPanelAdapter
from product_router import create_router
from sheets import Sheets,build_router

HERE=Path(__file__).resolve().parent
DATA=Path(DATA_DIR)
DB=DATA/'company-authority.sqlite3'
BLOBS=DATA/'company-drive-blobs'
from email_service import EmailWorker

rpc=EmailWorker(); blobs=SafeBlobs(BLOBS)
drive_policy=UploadPolicy.from_env()
drive_channels=NativeChannels(native_database)
def panel_drive_factory():
    return ChannelDrive(str(DB),Authority,blobs,drive_policy,drive_channels)
email_adapter=EmailPanelAdapter(rpc.panel,lambda:Authority(str(DB)))
email_adapter.manifest={**email_adapter.manifest,
    "workflowActions":["preview","review"],
    "workflowBinding":{"version":"starli.email.workflow.v1",
        "route":"/api/v1/companies/{company}/email-studio/{rid}/{operation}"}}
native_routes=list(app.router.routes)
native_ids={id(route) for route in native_routes}
from open_webui.routers.starli_customer_api import install as install_customer_api
install_customer_api(app)
from starli_memory.workspace_mount import install_workspace_memory
install_workspace_memory(app)
app.include_router(drive_router)
install_panels(app,verified_user=get_verified_user,db_path=str(DB),authority_class=Authority,drive_class=Drive,
             blob_write=blobs.write,blob_read=blobs.read,sheets_class=Sheets,email_adapter=email_adapter,drive_factory=panel_drive_factory)
app.include_router(build_router(get_verified_user,str(DB),Authority),prefix='/api/v1/companies')
from controlled_routes import create_controlled_router
app.include_router(create_controlled_router(rpc,get_verified_user,_mutation_guard,capture_request_fence,
                   enabled=os.getenv("WAVE_CONTROLLED_SMTP")=="1"))
app.include_router(create_router(rpc,get_verified_user,_mutation_guard,capture_request_fence))
from enterprise_messaging import install_enterprise_messaging
def unavailable_feature(prefix,code):
    async def unavailable(company:str,path:str='',user=Depends(get_verified_user)):
        raise HTTPException(503,code)
    app.add_api_route(prefix,unavailable,methods=['GET','POST','PUT','PATCH','DELETE'])
    app.add_api_route(prefix+'/{path:path}',unavailable,methods=['GET','POST','PUT','PATCH','DELETE'])

if hasattr(app.state,'company_messaging') and hasattr(app.state,'company_messaging_session'):
    install_enterprise_messaging(app)
else:
    app.state.workspace_enterprise_messaging_unavailable='COMPANY_MESSAGING_NOT_CONFIGURED'
    unavailable_feature('/api/v1/starli/companies/{company}/messaging','COMPANY_MESSAGING_NOT_CONFIGURED')
from starli_engine_connections.smtp_http import install_production as install_company_smtp
company_runtime=getattr(app.state,'company_bot_runtime',None)
if company_runtime is not None and getattr(app.state,'starli_automations',None) is not None:
    install_company_smtp(app,company_runtime)
else:
    app.state.workspace_company_smtp_unavailable='NATIVE_COMPANY_VAULT_NOT_CONFIGURED'
    unavailable_feature('/api/v1/starli/companies/{company}/integrations/smtp','NATIVE_COMPANY_VAULT_NOT_CONFIGURED')
# Nested installers can insert before the SPA mount; do not slice by old length.
added=[route for route in app.router.routes if id(route) not in native_ids]
idx=next((i for i,route in enumerate(native_routes) if getattr(route,'path',None)==''),len(native_routes))
app.router.routes[:]=native_routes[:idx]+added+native_routes[idx:]
