"""Single native Memory/Email/Computer runtime; no synthetic QA setup or sender provisioning."""
from .runtime_integration import MemoryToolsMixin
from enterprise_browser.install import runtime_type as browser_runtime_type

def install_memory_company(app,providers,bots,authority,memory_factory,runner,
                           computer_status=None,computer_display_note=None,email_rpc=None):
    from computer_runtime import ComputerRuntime
    from company_bot_runtime.router import mount
    from company_email_install import email_runtime_type,email_constructor_kwargs,finish_email_install
    if email_rpc is None:
        from email_service import EmailWorker
        email_rpc=EmailWorker()
    from .install_agent_profiles import profile_runtime_type,install_profiles,canonical_profile_database
    CompanyRuntime=browser_runtime_type(profile_runtime_type(email_runtime_type(MemoryToolsMixin,ComputerRuntime)))
    store=getattr(app.state,'company_messaging',None)
    session=getattr(app.state,'company_messaging_session',None)
    if store is None or not callable(session):raise RuntimeError('MEMORY_NATIVE_MESSAGING_REQUIRED')
    if hasattr(app.state,'company_messaging_start_turn'):raise RuntimeError('NATIVE_INGRESS_ALREADY_INSTALLED')
    runtime=CompanyRuntime(store,providers,bots,authority,memory_factory,runner,
        computer_status=computer_status,computer_display_note=computer_display_note,
        **email_constructor_kwargs(email_rpc))
    import os
    from pathlib import Path
    from open_webui.config import DATA_DIR
    from open_webui.company_authority.company_rbac import Authority,Forbidden
    from open_webui.utils.auth import get_verified_user
    from open_webui.routers.starli_session_fence import capture_request_fence
    from open_webui.routers.starli_v3_native import _mutation_guard
    install_profiles(app,runtime,canonical_profile_database(store),
                     get_verified_user,capture_request_fence,_mutation_guard,Authority,Forbidden)
    finish_email_install(runtime)
    app.state.company_messaging_start_turn=runtime.start_turn
    app.state.company_messaging_authorize_run=runtime.authorize_native
    # mount assigns app.state.company_bot_runtime and registers ONE shutdown callback.
    mount(app,runtime,session)
    app.add_event_handler('startup',runtime.startup)
    # composition.install_runtime transfers these one-start/one-close callbacks into
    # the existing native lifespan. Never add another runtime.close callback here.
    return runtime
