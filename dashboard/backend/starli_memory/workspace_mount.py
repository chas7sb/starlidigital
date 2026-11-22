"""Explicit native composition. Reuse an active runtime's canonical memory root."""
import os,json
from pathlib import Path
from .store import MemoryStoreFactory,MemoryFault
from .native_directory import request_service_factory
from .workspace_api import create_workspace_router

def install_workspace_memory(app,*,factory=None,root=None,company_path=None,registry_path=None):
    if getattr(app.state,'workspace_memory_installed',None):raise RuntimeError('MEMORY_ALREADY_INSTALLED')
    from open_webui.config import DATA_DIR
    from open_webui.company_authority import Authority,Forbidden
    from open_webui.utils.auth import get_verified_user
    from open_webui.routers.starli_session_fence import capture_request_fence
    from open_webui.routers.starli_v3_native import _mutation_guard,_db
    runtime=getattr(app.state,'company_bot_runtime',None)
    canonical=getattr(runtime,'memory_factory',None)
    if factory is not None and canonical is not None and Path(factory.root)!=Path(canonical.root):raise RuntimeError('MEMORY_ROOT_MISMATCH')
    factory=canonical or factory
    config={}
    configured=os.environ.get('STARLI_COMPANY_COMPUTER_CONFIG')
    if configured:
        if not Path(configured).is_absolute():raise RuntimeError('MEMORY_OPERATOR_CONFIG_INVALID')
        config=json.loads(Path(configured).read_text())
        if not isinstance(config,dict):raise RuntimeError('MEMORY_OPERATOR_CONFIG_INVALID')
    declared=root or os.environ.get('STARLI_MEMORY_ROOT')
    operator_root=config.get('memory')
    if operator_root is not None and (not isinstance(operator_root,str)or not Path(operator_root).is_absolute()):raise RuntimeError('MEMORY_OPERATOR_CONFIG_INVALID')
    if declared is not None and operator_root is not None and Path(declared)!=Path(operator_root):raise RuntimeError('MEMORY_ROOT_MISMATCH')
    chosen=declared or operator_root
    if factory is None:
        if not chosen:
            app.state.workspace_memory_unavailable='MEMORY_ROOT_NOT_CONFIGURED'
            return {'version':'starli.memory.view.v1','available':False,'reason':'MEMORY_ROOT_NOT_CONFIGURED'}
        # Exact same on-disk root consumed by production_mount; no new namespace,
        # fallback DATA folder, copied state or provider/runtime instantiation.
        factory=MemoryStoreFactory(chosen)
    if chosen is not None and Path(factory.root)!=Path(chosen):raise RuntimeError('MEMORY_ROOT_MISMATCH')
    operator_company=config.get('authorityDatabase')
    company=Path(company_path or operator_company or os.environ.get('STARLI_COMPANY_DATABASE')or Path(DATA_DIR)/'company-authority.sqlite3')
    registry=Path(registry_path or operator_company or os.environ.get('STARLI_COMPANY_BOT_DATABASE')or company)
    if operator_company is not None and (company!=Path(operator_company)or registry!=Path(operator_company)):raise RuntimeError('MEMORY_AUTHORITY_MISMATCH')
    service=request_service_factory(company,registry,Authority)
    def personal(user,bot):
        with _db()as db:
            row=db.execute('SELECT id,owner,kind,status,archived_at FROM agents WHERE id=? AND owner=? AND archived_at IS NULL',(bot,user.id)).fetchone()
            if row is None or row['kind']not in ('boss','agent','bot','persistent')or row['status']not in ('IDLE','RUNNING','PAUSED','WAITING_INPUT','FAILED','COMPLETED'):
                raise MemoryFault('MEMORY_BOT_UNAVAILABLE',404)
            return {'id':row['id'],'kind':'personal','owner':row['owner'],'active':True,'revision':1}
    router=create_workspace_router(factory,verified_user=get_verified_user,capture_fence=capture_request_fence,
        service_factory=service,mutation_guard=_mutation_guard,forbidden_errors=(Forbidden,),resolve_personal=personal)
    # Root's assembled SPA catchall must remain last; preserve every other route.
    index=next((i for i,r in enumerate(app.router.routes)if getattr(r,'path',None)==''),len(app.router.routes))
    start=len(app.router.routes);app.include_router(router);added=app.router.routes[start:];del app.router.routes[start:]
    app.router.routes[index:index]=added
    app.state.workspace_memory_installed={'version':'starli.memory.view.v1','factory':factory,'companyPath':str(company),'registryPath':str(registry)}
    return app.state.workspace_memory_installed
