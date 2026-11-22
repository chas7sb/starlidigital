"""Private staging composition. Native auth issues every JWT; no harness users/tokens."""
import os
import sys
from pathlib import Path
from types import SimpleNamespace
SOURCE = Path(__file__).resolve().parents[2] / "grokbot1"
sys.path.insert(0, str(SOURCE))
def create_app(root=None, origin=None):
    root = root or os.environ["STARLI_AUTH_STAGING_ROOT"]
    origin = origin or os.environ.get("STARLI_AUTH_STAGING_ORIGIN", "http://localhost:18181")
    isolated = Path(root).resolve()
    if not str(isolated).startswith("/tmp/grokbot1-w1-"):
        raise ValueError("DISPOSABLE_ROOT_REQUIRED")
    isolated.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chdir(isolated)  # Native dotenv discovery must never inspect an operator working directory.
    from grokbot1_routes import build_candidate_app
    app, svc, ns = build_candidate_app(root, allowed_origins={origin})
    # Real native company shell facade: verified native session and the SAME authority DB.
    from open_webui.utils.auth import get_verified_user
    from open_webui.company_authority.company_routes import build_router as build_company_router
    app.include_router(build_company_router(get_verified_user, str(ns.paths.authority)),
                       prefix="/api/v1/companies")
    from starli_memory.native_directory import build_native_router
    app.include_router(build_native_router(company_path=str(ns.paths.authority),
                                          registry_path=str(ns.paths.authority)),
                       prefix="/api/v1/bot-directory")
    from open_webui.routers import auths
    if not auths.WEBUI_AUTH or auths.WEBUI_AUTH_TRUSTED_EMAIL_HEADER:
        raise RuntimeError("NATIVE_PASSWORD_AUTH_REQUIRED")
    app.state.config = SimpleNamespace(JWT_EXPIRES_IN="1h", USER_PERMISSIONS={},
        ENABLE_SIGNUP=True, ENABLE_LOGIN_FORM=True, WEBHOOK_URL="",
        ENABLE_API_KEY_ENDPOINT_RESTRICTIONS=True, API_KEY_ALLOWED_ENDPOINTS="")
    app.state.WEBUI_NAME = "Starli private staging"
    @app.middleware("http")
    async def private_auth_state(request, call_next):
        request.state.enable_api_key = False
        return await call_next(request)
    # Export only routes needed for the isolated flow; no admin/config/API-key surfaces.
    for route in auths.router.routes:
        if route.path in {"/", "/signin", "/signup", "/signout"}:
            app.router.routes.append(_prefixed_route(route, "/api/v1/auths"))
    from fastapi import Request, HTTPException
    from pydantic import BaseModel
    class BootstrapForm(BaseModel):
        email: str
        password: str
        name: str
    # Explicit private operator registration, because native public signup refuses zero-user DB.
    # Does not mint JWT; caller must subsequently use real native /signin.
    @app.post("/staging/bootstrap-owner")
    async def bootstrap_owner(body: BootstrapForm, request: Request):
        if request.client is None or request.client.host not in {"127.0.0.1", "::1"}:
            raise HTTPException(403, "LOOPBACK_ONLY")
        if request.headers.get("origin") != origin or request.headers.get("x-starli-staging-bootstrap") != "1":
            raise HTTPException(403, "ORIGIN_CSRF_REQUIRED")
        if ns.Users.get_num_users() != 0:
            raise HTTPException(409, "OWNER_ALREADY_REGISTERED")
        if not auths.validate_email_format(body.email.lower()) or not body.name.strip() or not 12 <= len(body.password.encode()) <= 72:
            raise HTTPException(422, "INVALID_REGISTRATION")
        user = ns.Auths.insert_new_auth(body.email.lower(), ns.auth.get_password_hash(body.password),
                                        body.name, "/user.png", "admin")
        if user is None:
            raise HTTPException(500, "NATIVE_REGISTRATION_FAILED")
        return {"registered": True, "userId": user.id, "sessionIssued": False,
                "executionClass": "NATIVE_NONPRODUCTION"}
    from fastapi.responses import HTMLResponse
    @app.get("/staging/auth", response_class=HTMLResponse)
    async def staging_auth():
        return HTMLResponse((Path(__file__).parent / "staging-auth.html").read_text(), headers={"Cache-Control":"no-store"})
    @app.get("/staging/health")
    async def health():
        return {"status":"ready", "executionClass":"NATIVE_NONPRODUCTION",
                "nativeAuth":True, "nativeClaim":True,
                "ownerRegistrationRequired":ns.Users.get_num_users() == 0}
    return app
def _prefixed_route(route, prefix):
    import copy
    route = copy.copy(route)
    route.path = prefix + route.path
    route.path_format = prefix + route.path_format
    from starlette.routing import compile_path
    route.path_regex, route.path_format, route.param_convertors = compile_path(route.path)
    return route
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--origin", default="http://localhost:18181")
    parser.add_argument("--port", type=int, default=18181)
    args = parser.parse_args()
    import uvicorn
    uvicorn.run(create_app(args.root, args.origin), host="127.0.0.1", port=args.port,
                access_log=False, log_level="warning")
