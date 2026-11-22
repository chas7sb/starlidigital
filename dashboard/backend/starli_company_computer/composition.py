"""Join the company runtime to the already mounted native WebUI application."""
from contextlib import asynccontextmanager

from starlette.routing import Mount


def install_runtime(app, installer, **dependencies):
    """Call after importing native main and before the ASGI server accepts requests."""
    if getattr(app.state, "company_messaging", None) is None:
        raise RuntimeError("Native company messaging must be installed first")
    if getattr(app.state, "company_bot_runtime", None) is not None:
        raise RuntimeError("Company bot runtime is already installed")

    router = app.router
    catchalls = [route for route in router.routes if isinstance(route, Mount) and route.path == ""]
    if len(catchalls) > 1:
        raise RuntimeError("Multiple root mounts in the native application")
    start_index = len(router.routes)
    runtime = installer(app, **dependencies)
    if app.state.company_bot_runtime is not runtime:
        raise RuntimeError("The installed runtime does not own the native routes")

    # Agent6's standalone installer registers legacy callbacks. The native
    # app uses an explicit lifespan, so transfer those two callbacks to it.
    router.on_startup.remove(runtime.startup)
    router.on_shutdown.remove(runtime.close)
    if catchalls:
        new_routes = router.routes[start_index:]
        del router.routes[start_index:]
        root_index = router.routes.index(catchalls[0])
        router.routes[root_index:root_index] = new_routes

    native_lifespan = router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        async with native_lifespan(application) as state:
            try:
                await runtime.startup()
                yield state
            finally:
                await runtime.close()

    router.lifespan_context = lifespan
    return runtime
