"""Concrete opt-in production hook. Config is server-owned and never a DTO."""
import asyncio,base64,json,os,stat
from pathlib import Path
from contextlib import asynccontextmanager
from .common import need
from .n8n import N8nEngine,JsonTransport
from .connections import Vault
from .native import install
from .providers import ReviewedProviders
from .worker import Worker

INTERNAL_COMPANY='580c3817-c603-40f9-b8cc-b6252860cd9f'

def private_json(path):
    path=Path(path)
    need(path.is_absolute() and path.is_file(),'AUTOMATION_PRIVATE_CONFIG_REQUIRED',503)
    if os.name!='nt':need(stat.S_IMODE(path.stat().st_mode)&0o027==0,'AUTOMATION_PRIVATE_CONFIG_PERMISSIONS',503)
    return json.loads(path.read_text(encoding='utf-8-sig'))

def install_production_automations(app,runtime,config_path='/etc/starlidigital/automation-engine.json'):
    need(not hasattr(app.state,'starli_automations'),'AUTOMATIONS_ALREADY_INSTALLED',409)
    need(runtime is app.state.company_bot_runtime,'NATIVE_AUTOMATION_RUNTIME_MISMATCH',503)
    from starli_memory.install_agent_profiles import canonical_profile_database
    canonical_profile_database(runtime.store)  # exact existing authority/registry mapping
    config=private_json(config_path)
    transport=JsonTransport(config['baseUrl'],allow_loopback_http=True)
    def api_key():
        current=private_json(config_path)
        need(current['baseUrl']==config['baseUrl'],'AUTOMATION_ENGINE_ORIGIN_CHANGED',503)
        return current['apiKey']
    engine=N8nEngine(transport,api_key)
    vault=None
    key_file=config.get('vaultKeyFile')
    if key_file:
        path=Path(key_file);need(path.is_absolute() and path.is_file(),'BUSINESS_VAULT_KEY_UNAVAILABLE',503)
        if os.name!='nt':need(stat.S_IMODE(path.stat().st_mode)&0o027==0,'BUSINESS_VAULT_KEY_PERMISSIONS',503)
        raw=path.read_bytes();raw=raw if len(raw)==32 else base64.b64decode(raw.strip(),validate=True)
        vault=Vault(raw)
    # Business apps remain unavailable until their host-owned OAuth configuration
    # and real provider identity proofs are wired. An engine key is not OAuth.
    gateway,router=install(app,engine=engine,vault=vault,
                           internal_companies=tuple(config.get('internalCompanyIds',[INTERNAL_COMPANY])))
    from .business_config import BusinessApps
    from .oauth_http import OAuthTransport,AccountVerifier
    from .access_logs import install as install_oauth_log_filter
    business_path=config.get('businessOAuthConfigFile')
    def load_business():return private_json(business_path) if business_path else {}
    registry=BusinessApps(gateway,load_business)
    gateway.connections.app_resolver=registry
    gateway.connections.transport=OAuthTransport({},allow_shopify=True)
    gateway.connections.verify_identity=AccountVerifier(lambda origin:JsonTransport(origin),lambda ctx,provider:registry.selected_shop(ctx) if provider=='shopify' else '')
    install_oauth_log_filter()
    gateway.providers=ReviewedProviders(gateway.connections,lambda origin:JsonTransport(origin))
    app.include_router(router)  # production_mount's final ordering precedes SPA
    stop=asyncio.Event();worker=Worker(gateway);task=None
    async def supervise():
        while not stop.is_set():
            try:
                app.state.starli_automation_worker_status='RUNNING'
                await worker.run(stop)
            except asyncio.CancelledError:raise
            except Exception:
                app.state.starli_automation_worker_status='UNAVAILABLE'
                try:await asyncio.wait_for(stop.wait(),timeout=1)
                except TimeoutError:pass
        app.state.starli_automation_worker_status='STOPPED'
    async def startup():
        nonlocal task
        gateway.recover()  # once before any new worker claims; no unknown replay
        await gateway.health()
        task=asyncio.create_task(supervise(),name='starli-automation-worker')
        app.state.starli_automation_worker_task=task
    async def shutdown():
        stop.set()
        if task:
            done,_=await asyncio.wait({task},timeout=5)
            if task not in done:task.cancel()
            await asyncio.gather(task,return_exceptions=True)
    # Actual native host uses explicit nested lifespan contexts; on_event hooks
    # are intentionally not run there. Enter after native runtime startup and
    # stop our worker before its runtime/Store dependencies close.
    native_lifespan=app.router.lifespan_context
    @asynccontextmanager
    async def lifespan(application):
        async with native_lifespan(application) as state:
            await startup()
            try:yield state
            finally:await shutdown()
    app.router.lifespan_context=lifespan
    app.state.starli_automation_worker=worker
    return gateway
