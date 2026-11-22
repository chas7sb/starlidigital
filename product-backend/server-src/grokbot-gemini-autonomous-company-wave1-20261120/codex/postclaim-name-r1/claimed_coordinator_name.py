"""One-time actual native coordinator name, atomic with native owner audit."""
import json,time

def initialize_claim_name(svc,token,intent_id,result):
    if result.get("state")!="CLAIM_COMMITTED":return result
    _,uid=svc.native_session(token)
    nav=svc.owner_navigation(token,intent_id)
    company=result.get("companyId");bot=result.get("bossBotId");claim=result.get("claimId")
    if (nav.get("stage")!="ROOM_READY" or nav.get("verifiedBy")!="native-store-readback"
        or nav.get("companyId")!=company or nav.get("bossBotId")!=bot
        or nav.get("claimId")!=claim or result.get("ownerUserId")!=uid
        or not all(isinstance(v,str) and v for v in (company,bot,claim))):
        raise RuntimeError("COORDINATOR_NAME_CLAIM_SCOPE_DENIED")
    a=svc.ns.RbacAuthority(str(svc.p.authority))
    try:
        scope=a.require_member(uid,company,permission="bots.install")
        if scope.get("kind")!="person" or scope.get("role")!="owner":
            raise RuntimeError("COORDINATOR_NAME_OWNER_REQUIRED")
        def operation(db):
            # This transaction is admitted by native commit_authorized, not a raw DB bypass.
            fresh=a.require_member(uid,company,scope["membership_revision"],"bots.install")
            if fresh["kind"]!="person" or fresh["role"]!="owner":
                raise RuntimeError("COORDINATOR_NAME_OWNER_REQUIRED")
            db.execute("""CREATE TABLE IF NOT EXISTS starli_claim_name_defaults(
                claim_id TEXT PRIMARY KEY,company_id TEXT NOT NULL,bot_id TEXT NOT NULL,
                owner_id TEXT NOT NULL,state TEXT NOT NULL,applied_at REAL NOT NULL)""")
            old=db.execute("SELECT company_id,bot_id,owner_id,state FROM starli_claim_name_defaults WHERE claim_id=?",(claim,)).fetchone()
            if old:
                if old[:3]!=(company,bot,uid) or old[3] not in ("COMMITTED","SKIPPED_CUSTOM"):
                    raise RuntimeError("COORDINATOR_NAME_REVIEW_REQUIRED")
                return
            member=db.execute("SELECT name,kind,active FROM members WHERE company_id=? AND user_id=?",(company,bot)).fetchone()
            registry=db.execute("SELECT name,kind,owner,active,purpose FROM bots WHERE id=?",(bot,)).fetchone()
            if (not member or member[1:]!=("bot",1) or not registry
                or registry[1:]!=("company",company,1,"company-boss")):
                raise RuntimeError("COORDINATOR_NAME_NATIVE_BOT_MISMATCH")
            # Never overwrite a human's earlier customization.
            state="COMMITTED" if member[0] in ("BOSS","Starli") and registry[0] in ("BOSS","Starli") else "SKIPPED_CUSTOM"
            if state=="COMMITTED":
                db.execute("UPDATE members SET name='Starli' WHERE company_id=? AND user_id=?",(company,bot))
                db.execute("UPDATE bots SET name='Starli',revision=revision+1 WHERE id=?",(bot,))
            db.execute("INSERT INTO starli_claim_name_defaults VALUES(?,?,?,?,?,?)",(claim,company,bot,uid,state,time.time()))
            a.log(company,uid,"bot.coordinator_name.initialize",json.dumps({"claimId":claim,"botId":bot,"state":state,"name":"Starli" if state=="COMMITTED" else None},sort_keys=True))
        a.commit_authorized(uid,company,scope["membership_revision"],"bots.install",operation)
    finally:a.db.close()
    return result

def install_claimed_coordinator_name(svc):
    claim=svc.claim;resume=svc.resume
    def wrapped_claim(token,cookie,intent_id,idem_key,expected_revision):
        return initialize_claim_name(svc,token,intent_id,claim(token,cookie,intent_id,idem_key,expected_revision))
    def wrapped_resume(token,intent_id):
        return initialize_claim_name(svc,token,intent_id,resume(token,intent_id))
    svc.claim=wrapped_claim;svc.resume=wrapped_resume
