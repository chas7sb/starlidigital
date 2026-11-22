"""Native owner-verified postclaim chat defaults; provisional drafts never granted."""
import sqlite3,time
from pathlib import Path
def install_claimed_chat_defaults(svc):
    def after(token,intent_id,result):
        if result.get("state")!="CLAIM_COMMITTED":return result
        session,uid=svc.native_session(token)
        nav=svc.owner_navigation(token,intent_id)
        if nav.get("stage")!="ROOM_READY" or nav.get("verifiedBy")!="native-store-readback":
            return result
        company=nav["companyId"]
        if result.get("ownerUserId")!=uid or result.get("companyId")!=company:
            raise RuntimeError("CLAIM_CHAT_OWNER_MISMATCH")
        journal=sqlite3.connect(str(Path(svc.p.root)/"claimed-chat-defaults.sqlite"))
        journal.execute("CREATE TABLE IF NOT EXISTS defaults(claim_id TEXT PRIMARY KEY,company TEXT NOT NULL,state TEXT NOT NULL)")
        journal.execute("BEGIN IMMEDIATE")
        old=journal.execute("SELECT company,state FROM defaults WHERE claim_id=?",(result["claimId"],)).fetchone()
        if old:
            journal.rollback();journal.close()
            if old[0]!=company or old[1]!="COMMITTED":raise RuntimeError("CLAIM_CHAT_DEFAULTS_REVIEW_REQUIRED")
            return result
        journal.execute("INSERT INTO defaults VALUES(?,?,'STARTED')",(result["claimId"],company))
        journal.commit()
        a=svc.ns.RbacAuthority(str(svc.p.authority))
        try:
            scope=a.require_member(uid,company,permission="roles.manage")
            if scope["kind"]!="person" or scope["role"]!="owner":
                raise RuntimeError("CLAIM_CHAT_OWNER_REQUIRED")
            bots=a.db.execute("SELECT user_id FROM members WHERE company_id=? AND kind='bot' AND active=1",(company,)).fetchall()
            roles=[r for r in a.list_custom_roles(uid,company) if r["name"]=="Company chat execution" and r["kind"]=="bot" and r["active"]]
            if roles and sorted(roles[0]["grants"])!=["bots.run","messages.send"]:
                raise RuntimeError("CLAIM_CHAT_ROLE_REVIEW_REQUIRED")
            rid=roles[0]["id"] if roles else a.create_custom_role(uid,company,"Company chat execution","bot",["bots.run","messages.send"])
            for (bot,) in bots:
                if not a.db.execute("SELECT 1 FROM role_assignments WHERE company_id=? AND subject_id=? AND role_id=?",(company,bot,rid)).fetchone():
                    a.assign_custom_role(uid,company,rid,bot)
            journal.execute("UPDATE defaults SET state='COMMITTED' WHERE claim_id=?",(result["claimId"],))
            journal.commit()
        finally:
            a.db.close();journal.close()
        return result
    original_claim=svc.claim
    def claim(token,cookie,intent_id,idem_key,expected_revision):
        return after(token,intent_id,original_claim(token,cookie,intent_id,idem_key,expected_revision))
    original_resume=svc.resume
    def resume(token,intent_id):
        return after(token,intent_id,original_resume(token,intent_id))
    svc.claim=claim
    svc.resume=resume
