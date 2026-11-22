"""Root-reviewed integration helpers. Calling these requires the canonical DB path."""
from .agent_profiles import AgentProfiles, build_router
from .agent_profile_runtime import AgentProfileRuntimeMixin


def canonical_profile_database(store):
    from pathlib import Path
    schema=store.authority.schema
    if schema=='main':path=Path(store.path)
    elif schema in store.attached_databases:path=Path(store.attached_databases[schema])
    else:raise RuntimeError('AGENT_AUTHORITY_MAPPING_REQUIRED')
    registry=store.attached_databases.get('company_bots')
    if registry and Path(registry).resolve()!=path.resolve():
        raise RuntimeError('AGENT_CANONICAL_REGISTRY_REQUIRED')
    return str(path.resolve())


def profile_runtime_type(existing_runtime):
    return type('ProfileCompanyRuntime', (AgentProfileRuntimeMixin, existing_runtime), {})


def install_profiles(app, runtime, canonical_authority_database, verified_user, capture_fence, mutation_guard, authority_type, forbidden_type):
    profiles = AgentProfiles(canonical_authority_database, authority_type)
    profiles.initialize()
    runtime.agent_profiles = profiles
    app.include_router(build_router(profiles, verified_user, capture_fence, mutation_guard, (forbidden_type,)))
    from pathlib import Path
    from .agent_creation import AgentCreation,build_creation_router
    creation=AgentCreation(profiles,Path(__file__).resolve().parent.parent/'bot-templates.v1.json')
    creation.initialize()
    runtime.agent_creation=creation
    app.include_router(build_creation_router(creation,verified_user,capture_fence,mutation_guard,(forbidden_type,)))
    from .bot_role_assignments import build_bot_role_assignments_router
    app.include_router(build_bot_role_assignments_router(profiles,verified_user,capture_fence,(forbidden_type,)))
    return profiles
