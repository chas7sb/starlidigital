"""One scoped REST contract for the right-hand pane; no legacy route replacement."""
from .core import Fault


def mount(app, adapter, *, native_session, resolve_scope):
    """resolve_scope(session,company,room,bot,run) returns fresh trusted Scope.

    Never construct Scope from request actor/membership/assistant fields.
    Host resolver must verify session membership, bot permission, room audience,
    run/assistant incarnation and company ownership on every request.
    """
    from fastapi import APIRouter, Depends, HTTPException, Request
    from fastapi.responses import JSONResponse
    router = APIRouter(prefix='/api/v1/starli/companies/{company}/browser')
    def reply(value):
        return JSONResponse(value, headers={'Cache-Control':'no-store', 'Pragma':'no-cache', 'X-Content-Type-Options':'nosniff'})

    async def scoped(request, company, session):
        from .core import invoke
        q = request.query_params
        if set(q) != {'roomId', 'botId', 'runId'}:
            raise Fault('BROWSER_SCOPE_QUERY_REQUIRED', 422)
        scope = await invoke(resolve_scope, session, company, q['roomId'], q['botId'], q['runId'])
        if scope.company != company or (scope.room, scope.bot, scope.run) != (q['roomId'], q['botId'], q['runId']):
            raise Fault('BROWSER_SCOPE_MISMATCH')
        return scope

    @router.get('/capability')
    async def capability(company: str, request: Request, session=Depends(native_session)):
        try:
            return reply(await adapter.capability(await scoped(request, company, session)))
        except Fault as e:
            raise HTTPException(e.status, e.code) from None

    @router.get('/frame')
    async def frame(company: str, request: Request, session=Depends(native_session)):
        try:
            return reply(await adapter.execute(await scoped(request, company, session), 'read', {}))
        except Fault as e:
            raise HTTPException(e.status, e.code) from None

    @router.post('/actions')
    async def action(company: str, request: Request, session=Depends(native_session)):
        try:
            if int(request.headers.get('content-length', '0')) > 16384:
                raise Fault('BROWSER_BODY_TOO_LARGE', 413)
            raw = await request.body()
            if len(raw) > 16384:
                raise Fault('BROWSER_BODY_TOO_LARGE', 413)
            import json
            body = json.loads(raw)
            if type(body) is not dict or set(body) != {'action', 'args', 'actionId', 'frameId'}:
                raise Fault('BROWSER_ACTION_INVALID', 422)
            return reply(await adapter.execute(await scoped(request, company, session), body['action'], body['args'], action_id=body['actionId'], frame_id=body['frameId']))
        except (ValueError, TypeError):
            raise HTTPException(422, 'BROWSER_ACTION_INVALID') from None
        except Fault as e:
            raise HTTPException(e.status, e.code) from None

    app.include_router(router)
    return router
