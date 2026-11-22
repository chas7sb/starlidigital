"""Explicit native WebUI -> Node service identities; never link accounts by email."""
from __future__ import annotations
import hashlib,json,secrets,sqlite3,time
from fastapi import APIRouter,Depends,HTTPException,Request,Response
from open_webui.utils.auth import get_verified_user
from open_webui.models.users import Users
from open_webui.routers.starli_state import source_database

router=APIRouter()
AUTHORITY="OPENWEBUI_NATIVE"
DISABLED_PASSWORD_HASH="!OPENWEBUI_ONLY_NO_PASSWORD_LOGIN!"
def value(user,key,default=None):return user.get(key,default) if isinstance(user,dict) else getattr(user,key,default)
def canonical(user):
    uid=value(user,"id")
    if not isinstance(uid,str) or not uid or len(uid)>150:raise HTTPException(401,"Authenticated native account required")
    current=Users.get_user_by_id(uid)
    if not current or value(current,"role") not in ("user","admin"):raise HTTPException(403,"Native account is not active")
    subject=value(current,"oauth_sub")
    if isinstance(subject,str) and subject.startswith("starli-node:"):raise HTTPException(409,"This account already uses the verified Node identity bridge")
    return current
def initialize(db):
    db.execute("""CREATE TABLE IF NOT EXISTS webui_customer_identities(
        webui_id TEXT PRIMARY KEY,node_id TEXT NOT NULL UNIQUE,binding_nonce TEXT NOT NULL,
        created_at TEXT NOT NULL)""")
def checked_payload(row,mapping):
    if not row:raise HTTPException(403,"Customer service identity is missing")
    try:user=json.loads(row[0])
    except (TypeError,ValueError):raise HTTPException(503,"Customer identity record is invalid") from None
    if (user.get("id")!=mapping["node_id"] or user.get("identityAuthority")!=AUTHORITY or
        user.get("webuiUserId")!=mapping["webui_id"] or user.get("identityBindingNonce")!=mapping["binding_nonce"] or
        user.get("role")!="USER" or user.get("passwordLoginEnabled") is not False or user.get("passwordHash")!=DISABLED_PASSWORD_HASH):
        raise HTTPException(403,"Customer identity binding is invalid")
    if user.get("disabled") is not False:raise HTTPException(403,"Customer service identity is disabled")
    return user
def _existing_native_customer(uid):
    # Authorization is read-only once provisioned. A project write may already
    # hold this SourceDB's writer lock when it rechecks the identity at precommit.
    try:
        with sqlite3.connect("file:"+str(source_database())+"?mode=ro",uri=True,timeout=3) as db:
            db.row_factory=sqlite3.Row
            db.execute("BEGIN")
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='webui_customer_identities'").fetchone():return None
            existing=db.execute("SELECT * FROM webui_customer_identities WHERE webui_id=?",(uid,)).fetchone()
            if existing is None:return None
            checked_payload(db.execute("SELECT payload FROM users WHERE id=?",(existing["node_id"],)).fetchone(),existing)
            return {"v2UserId":existing["node_id"],"customer":True,"identitySource":"native-service-identity"}
    except sqlite3.Error:
        raise HTTPException(503,"Customer identity authority unavailable") from None

def ensure_native_customer(user):
    """Call only from authenticated customer_principal after its existing admin/Node-link branches."""
    current=canonical(user);uid=value(current,"id")
    existing=_existing_native_customer(uid)
    if existing is not None:return existing
    stamp=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
    with sqlite3.connect(source_database(),timeout=10) as db:
        db.row_factory=sqlite3.Row;db.execute("PRAGMA busy_timeout=10000");db.execute("BEGIN IMMEDIATE");initialize(db)
        existing=db.execute("SELECT * FROM webui_customer_identities WHERE webui_id=?",(uid,)).fetchone()
        if existing:
            checked_payload(db.execute("SELECT payload FROM users WHERE id=?",(existing["node_id"],)).fetchone(),existing)
            return {"v2UserId":existing["node_id"],"customer":True,"identitySource":"native-service-identity"}
        # Reuse the authenticated local ID to preserve existing native-owned projects.
        # A pre-existing Node ID is never adopted, even if an email happens to match.
        if db.execute("SELECT 1 FROM users WHERE id=?",(uid,)).fetchone():raise HTTPException(409,"An independent platform identity already uses this ID")
        username="webui_"+hashlib.sha256(uid.encode()).hexdigest()[:24]
        if db.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE",(username,)).fetchone():raise HTTPException(409,"Customer service username collision")
        nonce=secrets.token_urlsafe(32)
        payload={"id":uid,"username":username,"email":username+"@identity.starlidigital.invalid","recoveryEmail":"",
                 "name":str(value(current,"name","Customer"))[:120],"role":"USER","disabled":False,
                 "passwordHash":DISABLED_PASSWORD_HASH,"passwordLoginEnabled":False,
                 "identityAuthority":AUTHORITY,"webuiUserId":uid,"identityBindingNonce":nonce,"createdAt":stamp}
        db.execute("INSERT INTO users(id,username,payload) VALUES(?,?,?)",(uid,username,json.dumps(payload)))
        db.execute("INSERT INTO webui_customer_identities VALUES(?,?,?,?)",(uid,uid,nonce,stamp))
    return {"v2UserId":uid,"customer":True,"identitySource":"native-service-identity"}
def reconcile_native_identities():
    """Optional supervisor hook: revoke provisioned identities when native accounts become inactive.

    Never re-enable an identity disabled by an operator, and never alter independent Node users.
    Hosted agents owned by a revoked service identity are also disabled so public execution stops.
    """
    changed=[]
    with sqlite3.connect(source_database(),timeout=10) as db:
        db.row_factory=sqlite3.Row;db.execute("BEGIN IMMEDIATE");initialize(db)
        rows=db.execute("SELECT * FROM webui_customer_identities LIMIT 1000").fetchall()
        for binding in rows:
            record=db.execute("SELECT payload FROM users WHERE id=?",(binding["node_id"],)).fetchone()
            if not record:continue
            try:user=json.loads(record[0])
            except (TypeError,ValueError):continue
            if user.get("identityAuthority")!=AUTHORITY or user.get("identityBindingNonce")!=binding["binding_nonce"] or user.get("webuiUserId")!=binding["webui_id"]:continue
            current=Users.get_user_by_id(binding["webui_id"])
            inactive=not current or value(current,"role") not in ("user","admin") or str(value(current,"oauth_sub","")).startswith("starli-node:") or user.get("disabled") is True or user.get("role")!="USER" or user.get("passwordLoginEnabled") is not False or user.get("passwordHash")!=DISABLED_PASSWORD_HASH
            if not inactive:continue
            if user.get("disabled") is not True:
                user["disabled"]=True;user["identityRevokedAt"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
                db.execute("UPDATE users SET payload=? WHERE id=?",(json.dumps(user),binding["node_id"]));changed.append(binding["node_id"])
            db.execute("DELETE FROM sessions WHERE user_id=?",(binding["node_id"],))
            db.execute("DELETE FROM resets WHERE user_id=?",(binding["node_id"],))
            for row in db.execute("SELECT id,payload FROM records WHERE collection='hosted-agent-agents' AND owner=?",(binding["node_id"],)).fetchall():
                try:agent=json.loads(row["payload"])
                except (TypeError,ValueError):continue
                if agent.get("ownerId")!=binding["node_id"] or agent.get("status") not in ("ACTIVE","DEMO"):continue
                agent.update(status="DISABLED",version=int(agent.get("version",1))+1,updatedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()))
                db.execute("UPDATE records SET payload=? WHERE collection='hosted-agent-agents' AND id=? AND owner=?",(json.dumps(agent),row["id"],binding["node_id"]))
    return {"revoked":changed}


@router.get("")
def customer_identity(request:Request,response:Response,user=Depends(get_verified_user)):
    """Fixed-loopback social bridge introspection. Browser tokens travel only in Authorization."""
    if not request.headers.get("authorization","").startswith("Bearer "):
        raise HTTPException(403,"Bearer authentication is required")
    uid=value(user,"id")
    current=Users.get_user_by_id(uid) if isinstance(uid,str) else None
    if not current or value(current,"role") not in ("user","admin"):
        raise HTTPException(403,"Customer account is not active")
    from open_webui.routers.starli_platform import customer_principal
    _,binding=customer_principal(current)
    response.headers["Cache-Control"]="no-store"
    response.headers["Pragma"]="no-cache"
    return {"active":True,"nativeUserId":uid,"nodeUserId":binding["v2UserId"],
            "accessRole":"CUSTOMER","customerMode":True,"canUseCustomerTools":True,
            "administratorSession":False,"identitySource":binding.get("identitySource","verified-platform-binding")}
