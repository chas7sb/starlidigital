"""Authenticated chat projection of actual, explicitly published company apps."""
import starli_portable as _portable
import re
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse


def snapshot(runtime, service, session, company, room):
    # This is a real native session and room authorization, never a model URL.
    with runtime.store.access(session, company, room) as (db, _, _):
        changes = {}
        for row in db.execute("SELECT t.bot,MAX(c.rowid) FROM cr_company_tool_calls c JOIN cr_turns t ON t.id=c.run WHERE t.company=? AND t.room=? AND c.state='COMPLETED' AND c.name IN ('computer_process_start','computer_app_start','computer_app_http','computer_app_publish','computer_app_stop') GROUP BY t.bot", (company, room)):
            changes[row[0]] = row[1]
    items = []
    with service.db() as db:
        rows = db.execute('SELECT rowid AS serial,* FROM apps WHERE company=? AND room=? AND publication IS NOT NULL ORDER BY rowid DESC LIMIT 20', (company, room)).fetchall()
    for row in reversed(rows):
        if not re.fullmatch(r'[A-Za-z0-9_-]{32}', row['publication']) or not service.app_live(row):
            continue
        items.append(dict(id=row['process'], processId=row['process'],
                          url=_portable.public_url('/published/') + row['publication'] + '/',
                          revision=max(1, row['serial'], changes.get(row['bot'], 0)),
                          title='Website preview', status='PUBLISHED', source='computer_app_publish'))
    return dict(companyId=company, conversationId=room, items=items)


def install(app, runtime):
    service = app.state.company_compute
    router = APIRouter(prefix='/api/v1/starli/companies/{company}/messaging')

    @router.get('/rooms/{room}/app-previews')
    def previews(company: str, room: str, session=Depends(app.state.company_messaging_session)):
        try:
            return JSONResponse(snapshot(runtime, service, session, company, room),
                                headers={'Cache-Control': 'private, no-store'})
        except Exception as error:
            status = getattr(error, 'status', 503)
            if status not in (401, 403, 404):
                status = 503
            raise HTTPException(status, 'APP_PREVIEW_UNAVAILABLE') from None

    index = next((i for i, route in enumerate(app.router.routes) if getattr(route, 'path', None) == ''), len(app.router.routes))
    app.router.routes[index:index] = router.routes
