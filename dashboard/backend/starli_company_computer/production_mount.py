"""Install a single registered company's native Agata and live Computer."""
import starli_portable as _portable
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import Depends, HTTPException, Request
from fastapi.routing import APIRoute
from starlette.routing import Mount

from company_bot_runtime.company_providers import CompanyProviders
from company_messaging.authority import Denied
from starli_memory.company_install import install_memory_company as install_computer
from composition import install_runtime
from open_webui.company_authority.company_rbac import Authority, Forbidden
from open_webui.utils.auth import get_verified_user
from platform_jobs import PlatformNoteJobs, verified_platform_result
from production_factory import PilotRegistry, make_company_computer
from production_hosted import hosted_runner
from production_relay import install_pilot_relay
from starli_memory.registry import BotRegistry
from starli_memory.store import MemoryStoreFactory
from transport import Channel, GrantDenied, NativeGrants
from viewer import ViewerIssuer

PILOT = "580c3817-c603-40f9-b8cc-b6252860cd9f"
COMPUTER = "c41e1661-c2d2-41c2-8533-62b37fb7fc84"
COMPONENTS = Path(__file__).resolve().parent


def install_production(app, config_path, *, providers=None, selected_company=None):
    _routes_before = {id(route) for route in app.router.routes}
    config = json.loads(Path(config_path).read_text())
    registry = PilotRegistry(config["enrollmentDatabase"])
    record = registry.current(PILOT)
    if (record is None or record.computer != COMPUTER or record.worker != "company-note-worker"
            or record.producer_ref != "company-pilot-producer-v1" or record.issuer_ref != "viewer-ed25519-342fb60f98479f4db20d4c31e7d463a294cd988d8c8dea398f474608795bd6dc"):
        raise RuntimeError("Missing the enrolled company Computer")
    private = Path(config["private"]).resolve(strict=True)
    operator = json.loads((private / "config.json").read_text())
    if (operator["companyId"], operator["computerId"], operator["workerId"]) != (record.company, record.computer, record.worker):
        raise RuntimeError("Physical registration disagrees with native enrollment")
    company_database = Path(config["authorityDatabase"])

    def active(actor):
        if selected_company:
            return selected_company(actor)
        with closing(sqlite3.connect(company_database.as_uri() + "?mode=ro", uri=True)) as db:
            rows = db.execute("SELECT company_id FROM members WHERE user_id=? AND active=1 AND kind='person' LIMIT 2",
                              (actor,)).fetchall()
            return rows[0][0] if len(rows) == 1 else None

    def current():
        return registry.current(PILOT) == record

    class AuthorityPort:
        def require_member(self, *args, **kwargs):
            scoped = object.__new__(Authority)
            if hasattr(self, "db"):
                scoped.db = self.db
                return scoped.require_member(*args, **kwargs)
            with closing(sqlite3.connect(company_database)) as db:
                scoped.db = db
                return scoped.require_member(*args, **kwargs)

    class BotPort:
        def require_bot(self, company, bot):
            with closing(sqlite3.connect(company_database)) as db:
                api = object.__new__(BotRegistry)
                api.db = db
                return api.require_bot(company, bot)

    auth, bots = AuthorityPort(), BotPort()
    from company_provider_install import build_company_providers, selected_runner, mount_company_providers
    if providers is None:
        providers = build_company_providers(config, private, auth, bots, PILOT)
    mount_company_providers(app, providers, get_verified_user)
    runner = hosted_runner(enrolled_company=PILOT, endpoint=config["hostedBaseUrl"], sdk=config["sdk"],
                           node=config["node"], worker=COMPONENTS / "runtime/company_bot_runtime/sdk/turn-worker.mts",
                           profile=COMPONENTS / "production-hosted-profile.mts")
    runner = selected_runner(config, runner)
    creds = json.loads((private / "producer-credential.json").read_text())
    if (creds["companyId"], creds["computerId"], creds["workerId"], creds["role"]) != (PILOT, COMPUTER, record.worker, "producer"):
        raise RuntimeError("Invalid company producer scope")
    channel = Channel((private / "transport.key").read_bytes())
    submit, status = PlatformNoteJobs.graphql_producer(_portable.company_platform_url('/graphql'), creds["token"])
    queue = PlatformNoteJobs(channel, record.worker, submit, status, verified_platform_result)
    grants = NativeGrants(channel, PILOT, COMPUTER, auth.require_member, platform_jobs=queue)
    bundle = SimpleNamespace(ready=current, native_grants=grants)
    _, resolve, display = make_company_computer(registry, active, auth.require_member, lambda _: bundle)
    runtime = install_runtime(app, install_computer, providers=providers, bots=bots, authority=auth,
                              memory_factory=MemoryStoreFactory(config["memory"]), runner=runner,
                              computer_display_note=display)
    # Explicit existing company enrollment; no legacy admin browser fallback.
    from enterprise_browser.native import attach as attach_company_browser
    from open_webui.routers import starli_browser
    attach_company_browser(app, runtime,
        private_directory=config.get("browserStateDirectory", str(private.parent / "state/browser")),
        enrolled_companies=(PILOT,), native_session=app.state.company_messaging_session,
        boundary=starli_browser)
    from enterprise_browser.company_tools_mount import install_baseline
    install_baseline(app, runtime)
    from starli_automations.production import install_production_automations
    install_production_automations(app, runtime)
    from starli_workflow_tools.production import install_production as install_common_workflow_tools
    install_common_workflow_tools(app, runtime)
    from starli_integration_catalog import install as install_integration_catalog
    install_integration_catalog(app, runtime)
    from starli_company_n8n.production import install_production as install_company_n8n
    install_company_n8n(app, runtime)
    from starli_agent_wake.production import install_production as install_agent_wake
    install_agent_wake(app, runtime, _portable.config_file('agent-wake-broker.key'))
    from starli_agent_triggers.production import install_production as install_agent_triggers
    install_agent_triggers(app, runtime)
    from starli_engine_connections.production import install_production as install_engine_connections
    install_engine_connections(app, runtime)
    from starli_priority_gateway import install_production as install_priority_connectors
    install_priority_connectors(app, runtime)
    from starli_priority_gateway.reuse import install as install_connection_reuse
    install_connection_reuse(app)
    from company_provider_images import install as install_company_provider_images
    install_company_provider_images(app, runtime)
    from company_compute import install as install_company_compute
    install_company_compute(app, runtime, registry)
    from app_previews import install as install_app_previews
    install_app_previews(app, runtime)
    from starli_memory.company_avatars import install as install_company_avatars
    install_company_avatars(app, runtime)
    from company_messaging.native_dispatch import install as install_native_dispatch
    install_native_dispatch(app, runtime)
    from starli_company_tools.action_grounding import install as install_action_grounding
    install_action_grounding(runtime)
    def eligible(db, member, descriptor):
        if not runtime.accepting:
            return False
        try:
            auth.require_member(member.user_id, member.company_id, permission='bots.run')
            bot = bots.require_bot(member.company_id, descriptor['id'])
            selection = providers.public_selection(member.user_id, member.company_id, bot['id'])
            return selection.get('status') == 'ready'
        except Exception:
            return False

    app.state.company_messaging_bot_eligible = eligible
    async def session(request: Request, user=Depends(get_verified_user)):
        requested = request.path_params.get("company") or request.headers.get("X-Company-ID") or active(user.id)
        if requested != PILOT or request.headers.get("X-Company-ID") not in (None, PILOT):
            raise HTTPException(403, "Company viewer scope denied")
        scoped = Request({**request.scope, "path_params": {**request.path_params, "company": requested}}, receive=request.receive)
        native = await app.state.company_messaging_session(scoped, user)
        try:
            resolve(native, requested)
        except (GrantDenied, Forbidden, PermissionError, LookupError):
            raise HTTPException(403, "Company viewer unavailable") from None
        return native

    issuer = ViewerIssuer(load_pem_private_key((private / "viewer-signing.pem").read_bytes(), password=None),
                          PILOT, COMPUTER, record.room, record.bot, app.state.company_messaging, auth)
    install_pilot_relay(app, issuer, session, private, {"room": record.room, "bot": record.bot}, current)
    grants.viewer_for_run = app.state.company_frame_relay.viewer_for_run
    index = next((i for i, r in enumerate(app.router.routes) if isinstance(r, Mount) and not r.path), len(app.router.routes))
    app.router.routes[index:index] = [queue.callback_route(), grants.callback_route()]
    # All native installers must precede the existing SPA catch-all.
    _added_routes = [route for route in app.router.routes if id(route) not in _routes_before]
    _retained_routes = [route for route in app.router.routes if id(route) in _routes_before]
    _spa_index = next((i for i, route in enumerate(_retained_routes) if isinstance(route, Mount) and not route.path), len(_retained_routes))
    app.router.routes[:] = _retained_routes[:_spa_index] + _added_routes + _retained_routes[_spa_index:]
    return runtime
