"""Atomic mount helper. Backend owner calls install() before catch-all routes."""
import os
from pathlib import Path
from open_webui.routers.customer_store import Store
from open_webui.routers.customer_http import make_routers
from open_webui.routers.customer_native import NativeAdapter,active_account,owned_bots,session_owner
from open_webui.routers.starli_state import state_dir

def install(app):
    if os.getenv('STARLI_CUSTOMER_API_ENABLED')!='1':return False
    if getattr(app.state,'customer_api',None) is not None:raise RuntimeError('Customer API already installed')
    directory=Path(state_dir())/'customer-api'
    directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    if directory.is_symlink() or not directory.is_dir():raise RuntimeError('Customer API private state directory required')
    directory.chmod(0o700)
    path=directory/'credentials.sqlite'
    if path.is_symlink():raise RuntimeError('Customer API state must not be a symlink')
    # The service must also run with UMask=0077 for SQLite journals/WAL.
    from open_webui.routers.customer_company import CompanyAdapter,JoinedAdapter
    runtime=getattr(app.state,'company_bot_runtime',None)
    def accessible(owner):
        # Directory authority is fresh account/member/room authority, never the
        # admin platform API. Shared bots require explicit selected-token grants.
        return set(owned_bots(owner))|{r['id']for r in company.catalogue(owner)}
    store=Store(path,active_account,accessible,personal_bots=owned_bots)
    company=CompanyAdapter(store,runtime,active_account)
    path.chmod(0o600)
    adapter=JoinedAdapter(store,NativeAdapter(store),company)
    for router in make_routers(store,adapter,session_owner):app.include_router(router)
    app.state.customer_api=adapter
    return True
