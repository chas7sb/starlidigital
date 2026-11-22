"""Bind Agent11 baseline tools to the existing canonical company services."""
from pathlib import Path


def install_baseline(app, runtime):
    from starli_company_tools import install, make_router
    from starli_memory.install_agent_profiles import canonical_profile_database
    from open_webui.company_authority.company_rbac import Authority
    from open_webui.company_drive.native_channels import ChannelDrive, NativeChannels
    from open_webui.company_drive.quota import SafeBlobs, UploadPolicy
    from open_webui.models.users import Users
    from open_webui.config import DATA_DIR
    from open_webui.routers import starli_search
    from open_webui.routers.company_drive import native_database
    from open_webui.routers.starli_session_fence import capture_request_fence
    from starli_company_tools.mcp import AccountDelegation
    from fastapi import Request, Depends
    from open_webui.utils.auth import get_verified_user

    database = canonical_profile_database(runtime.store)
    if Path(native_database).resolve() != Path(runtime.store.path).resolve():
        raise RuntimeError('COMPANY_TOOLS_CANONICAL_NATIVE_DRIVE_MAPPING_REQUIRED')
    channels = NativeChannels(native_database)
    policy = UploadPolicy.from_env()
    blob_directory = Path(DATA_DIR) / 'company-drive-blobs'

    def drive_factory():
        return ChannelDrive(database, Authority, SafeBlobs(blob_directory), policy, channels)

    delegation = AccountDelegation(app.state.starli_account_mcp_service,
                                   app.state.starli_account_mcp_adapter,
                                   capture_request_fence)
    install(runtime, drive_factory=drive_factory, messaging=True,
            research=starli_search, user_lookup=Users.get_user_by_id, mcp=delegation)
    from starli_company_tools.bot_outreach import install as install_bot_outreach
    install_bot_outreach(runtime, runtime.company_tools)
    from starli_company_tools.company_roster import install as install_company_roster
    install_company_roster(runtime, runtime.company_tools)
    # MCP metadata self-discovery for this native bot's private owner DM.
    # Execution still uses explicit per-next-turn human consent.
    from starli_company_tools.self_discovery import install as install_mcp_self_discovery
    install_mcp_self_discovery(runtime, runtime.company_tools)
    from starli_company_tools.company_channels import install as install_company_channels
    install_company_channels(runtime, runtime.company_tools)
    from starli_company_tools.bot_outreach import install_admission
    install_admission(app, runtime)
    # A registered company browser is a native-run tool, never an admin fallback.
    if runtime.browser_adapter is not None:
        for entry in runtime.company_tools.unavailable:
            if entry.get('family') == 'company-browser':
                entry['reason'] = 'EXISTING_RUNTIME_REQUIRES_RUN_ADMISSION'
    # Agent11's companyId path parameter must be normalized to the EXISTING
    # native dependency's company parameter, especially for POST consent writes.
    async def native_company_session(request: Request, user=Depends(get_verified_user)):
        company = request.path_params.get('companyId')
        if not isinstance(company, str) or not company:
            raise RuntimeError('COMPANY_TOOLS_NATIVE_COMPANY_REQUIRED')
        scoped = Request({**request.scope, 'path_params': {**request.path_params, 'company': company}}, receive=request.receive)
        return await app.state.company_messaging_session(scoped, user)

    app.include_router(make_router(runtime, native_company_session))
    from starli_company_social.production import install_production as install_company_social
    install_company_social(app, runtime)
    app.state.company_tools_drive_factory = drive_factory
    from starli_company_computer.chat_vision import install as install_chat_vision
    install_chat_vision(app, runtime)
    return runtime.company_tools

