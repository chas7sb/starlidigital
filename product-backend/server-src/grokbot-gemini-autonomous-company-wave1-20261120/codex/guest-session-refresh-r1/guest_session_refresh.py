"""Private staging native guest session refresh for valid but retired cookies."""
import sqlite3
from http.cookies import SimpleCookie
from contextlib import closing
from fastapi import Request,Response,HTTPException
from fastapi.routing import APIRoute

def install_guest_session_refresh(app,svc):
    if getattr(app.state,'guest_session_retirement_refresh',False):return
    path='/api/v1/starli/public/session'
    original_index=next((i for i,r in enumerate(app.router.routes) if getattr(r,'path',None)==path and 'GET' in getattr(r,'methods',set())),None)
    if original_index is None:raise RuntimeError('NATIVE_GUEST_SESSION_ROUTE_REQUIRED')
    def refresh(request:Request,response:Response):
        token=request.cookies.get(svc.ns.public.COOKIE,'')
        try:svc.ns.public.verify_cookie(token)
        except HTTPException:return svc.ns.public.session(request,response)
        binding=svc.binding(token)
        try:
            with closing(sqlite3.connect(svc.p.intake.as_uri()+'?mode=ro',uri=True,timeout=5)) as db:
                retired=db.execute('SELECT 1 FROM revoked_guest_bindings WHERE binding=?',(binding,)).fetchone() is not None
        except sqlite3.Error:raise HTTPException(503,'GUEST_SESSION_AUTHORITY_UNAVAILABLE') from None
        if not retired:return svc.ns.public.session(request,response)
        # Issue a new native capability; old binding/intent/claim stays irrevocably retired.
        cookies=SimpleCookie()
        for key,value in request.cookies.items():cookies[key]=value
        cookies[svc.ns.public.COOKIE]=svc.ns.public.new_cookie()
        headers=[(k,v) for k,v in request.scope['headers'] if k.lower()!=b'cookie']
        headers.append((b'cookie',cookies.output(header='',sep=';').strip().encode('latin-1')))
        refreshed=Request({**request.scope,'headers':headers},receive=request.receive)
        return svc.ns.public.session(refreshed,response)
    app.router.routes.insert(original_index,APIRoute(path,refresh,methods=['GET'],name='private_native_guest_session_refresh'))
    app.state.guest_session_retirement_refresh=True
