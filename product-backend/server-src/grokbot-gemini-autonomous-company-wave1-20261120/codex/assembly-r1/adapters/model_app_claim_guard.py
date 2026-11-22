"""Scoped atomic claim-vs-build fence outside frozen component source."""
from contextlib import closing
from fastapi import HTTPException
from guest_company_authority import canonical,digest
def install_model_claim_guard(authority,svc):
    # This trigger is evaluated inside the real durable build-admission transaction.
    with closing(authority.db()) as db,db:
        db.executescript("""
CREATE TRIGGER IF NOT EXISTS model_build_requires_open_guest_conversation
BEFORE INSERT ON guest_model_app_jobs
WHEN EXISTS(SELECT 1 FROM guest_conversation_transfer WHERE intent=NEW.intent AND (binding!=NEW.binding OR state!='OPEN'))
BEGIN SELECT RAISE(ABORT,'GUEST_CONVERSATION_CLAIM_FROZEN'); END;
""")
    def freeze(token,cookie,intent):
        session,uid=svc.native_session(token)
        with closing(authority.db()) as db:
            committed=db.execute("SELECT 1 FROM grokbot1_claim_journal WHERE intent_id=? AND owner_user_id=? AND state='COMMITTED'",(intent,uid)).fetchone()
        if committed:return
        svc._recent_auth(uid,token)
        issued=svc._issued(cookie,intent);binding=issued.verified_binding
        with closing(authority.db()) as db,db:
            db.execute("BEGIN IMMEDIATE");authority.provisional(db,intent,binding)
            if db.execute("SELECT 1 FROM guest_model_app_jobs WHERE intent=? AND binding=? AND state IN ('QUEUED','RUNNING')",(intent,binding)).fetchone():
                raise HTTPException(409,"The app is still building. You can register or keep chatting now; claim this company when its preview is ready.")
            if db.execute("SELECT 1 FROM staging_guest_workspace_turns WHERE intent=? AND state='RUNNING'",(intent,)).fetchone():raise HTTPException(409,"GUEST_REPLY_IN_PROGRESS")
            messages=authority.transcript(db,intent,issued.receipt);sha=digest(messages)
            prior=db.execute("SELECT * FROM guest_conversation_transfer WHERE intent=?",(intent,)).fetchone()
            if prior and prior["state"]!="OPEN":
                if prior["owner"]!=uid or prior["digest"]!=sha:raise HTTPException(409,"TRANSFER_ALREADY_FROZEN")
                return
            db.execute("INSERT OR REPLACE INTO guest_conversation_transfer VALUES(?,?,?,?,?,?,?,?)",(intent,binding,"FROZEN",canonical(messages),sha,uid,None,svc.now()))
    authority.freeze=freeze
