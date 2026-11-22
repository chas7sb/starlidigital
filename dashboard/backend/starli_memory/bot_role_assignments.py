"""Read-only owner view of canonical bot role links; no grants or schema changes."""
import sqlite3
from contextlib import closing


def build_bot_role_assignments_router(profiles,verified_user,capture_fence,forbidden_errors=()):
    from fastapi import APIRouter,Depends,Request,HTTPException
    from fastapi.responses import JSONResponse
    router=APIRouter(prefix='/api/v1/companies')
    @router.get('/{company}/members/{bot}/roles')
    def assigned(company:str,bot:str,request:Request,user=Depends(verified_user)):
        fence=capture_fence(request,user);fence.check()
        try:
            with closing(sqlite3.connect(profiles.path)) as db:
                db.execute('BEGIN')
                a=profiles._authority(db);scope=a.require_member(user.id,company)
                if scope['kind']!='person' or scope['role']!='owner':raise HTTPException(403,'BOT_ROLE_ASSIGNMENTS_OWNER_REQUIRED')
                target=a.require_member(bot,company)
                canonical=db.execute("SELECT 1 FROM bots WHERE id=? AND kind='company' AND owner=? AND active=1",(bot,company)).fetchone()
                if target['kind']!='bot' or not canonical:raise HTTPException(404,'COMPANY_BOT_NOT_FOUND')
                role_ids=[row[0] for row in db.execute("SELECT r.id FROM role_assignments x JOIN custom_roles r ON r.id=x.role_id AND r.company_id=x.company_id WHERE x.company_id=? AND x.subject_id=? AND r.kind='bot' ORDER BY r.id",(company,bot))]
                result=dict(version='starli.company-bot-role-assignments.v1',company_id=company,user_id=bot,kind='bot',membership_revision=target['membership_revision'],role_ids=role_ids)
            # Recheck actual current authority after the read snapshot is closed.
            with closing(sqlite3.connect(profiles.path)) as db:
                a=profiles._authority(db);a.require_member(user.id,company,expected_revision=scope['membership_revision']);a.require_member(bot,company,expected_revision=target['membership_revision'])
        except forbidden_errors:raise HTTPException(403,'BOT_ROLE_ASSIGNMENTS_DENIED') from None
        fence.check();return JSONResponse(result,headers={'Cache-Control':'no-store'})
    return router
