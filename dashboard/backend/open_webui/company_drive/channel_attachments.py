"""Versioned Drive attachments in agent7's existing transaction connection."""
import hashlib
import json
import re
from pathlib import Path
from .resources import Denied

def reference(resource,version):
    if not re.fullmatch(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}",resource) or type(version) is not int or version<1:
        raise ValueError("invalid attachment reference")
    return "drive."+resource+".v"+str(version)

def parse(value):
    match=re.fullmatch(r"drive\.([0-9a-f-]{36})\.v([1-9][0-9]{0,12})",value or "")
    if not match:
        raise Denied("attachment unavailable")
    rid,version=match.group(1),int(match.group(2))
    if reference(rid,version)!=value:
        raise Denied("attachment unavailable")
    return rid,version

def validate(db,member,room,attachment,*,company_schema="main",native_schema="native_messaging"):
    if not db.in_transaction or not all(re.fullmatch(r"[a-z][a-z_]{0,40}",s) for s in (company_schema,native_schema)):
        raise Denied("attachment transaction unavailable")
    if isinstance(member,dict):
        company,user,binding=member["company_id"],member["user_id"],member["binding"]
    else:
        company,user,binding=member.company_id,member.user_id,member.binding
    c,n=company_schema,native_schema
    person=db.execute(f"SELECT active,kind FROM {c}.members WHERE company_id=? AND user_id=?",(company,user)).fetchone()
    epoch=db.execute(f"SELECT max(id) FROM {c}.audit WHERE company_id=? AND actor=? AND action IN ('create','accept')",(company,user)).fetchone()[0]
    current=hashlib.sha256((company+"\0"+user).encode()).hexdigest()+":"+str(epoch)
    if person is None or person["active"]!=1 or person["kind"]!="person" or epoch is None or current!=binding:
        raise Denied("attachment unavailable")
    channel=db.execute(f"""SELECT r.*,ch.type AS native_type,ch.data AS native_data FROM {n}.cm_rooms r
      JOIN {n}.channel ch ON ch.id=r.id WHERE r.id=? AND r.company=?""",(room,company)).fetchone()
    if channel is None or channel["kind"] not in ("channel","group","dm") or channel["visibility"] not in ("public","private"):
        raise Denied("attachment unavailable")
    try:valid=channel["native_type"]=="starli_company" and json.loads(channel["native_data"])["companyId"]==company
    except (ValueError,TypeError,KeyError):valid=False
    if not valid or (channel["visibility"]=="public" and channel["kind"]!="channel"):
        raise Denied("attachment unavailable")
    if channel["visibility"]=="private":
        if db.execute(f"SELECT 1 FROM {n}.cm_members WHERE room=? AND user=? AND binding=? AND active=1",(room,user,binding)).fetchone() is None:
            raise Denied("attachment unavailable")
    rid,version=parse(attachment)
    row=db.execute(f"""SELECT r.*,m.parent,m.trashed FROM {c}.resource r
      JOIN {c}.drive_meta m ON m.id=r.id WHERE r.id=? AND r.company=?""",(rid,company)).fetchone()
    if row is None or row["kind"]!="file" or row["version"]!=version or row["trashed"] or row["channel"]!=room:
        raise Denied("attachment unavailable")
    grant=db.execute(f"SELECT * FROM {c}.drive_channel_shares WHERE resource=? AND room=?",(rid,room)).fetchone()
    if grant is None or (grant["creator"],grant["creator_binding"],grant["kind"])!=(channel["creator"],channel["creator_binding"],channel["kind"]):
        raise Denied("attachment unavailable")
    parent,seen=row["parent"],{rid}
    while parent:
        if parent in seen:raise Denied("attachment unavailable")
        seen.add(parent)
        ancestor=db.execute(f"""SELECT r.company,m.parent,m.trashed FROM {c}.resource r
          JOIN {c}.drive_meta m ON m.id=r.id WHERE r.id=?""",(parent,)).fetchone()
        if ancestor is None or ancestor["company"]!=company or ancestor["trashed"]:
            raise Denied("attachment unavailable")
        parent=ancestor["parent"]
    blob=db.execute(f"SELECT mime,size FROM {c}.drive_versions WHERE resource=? ORDER BY version DESC LIMIT 1",(rid,)).fetchone()
    if blob is None:raise Denied("attachment unavailable")
    return {"id":attachment,"resource":rid,"version":version,"companyId":company,
            "roomId":room,"filename":row["title"],"mime":blob["mime"],"size":blob["size"]}

def bind_messaging_attachments(store,*,authority_database,native_database):
    """Call after agent7 native install; never opens a nested DB transaction."""
    from company_messaging.authority import Denied as MessagingDenied
    company_path,native_path=Path(authority_database).resolve(),Path(native_database).resolve()
    schema=getattr(store.authority,"schema",None)
    if schema is None or Path(store.path).resolve()!=native_path or not hasattr(store.authority,"_attachment"):
        raise ValueError("native messaging attachment port unavailable")
    def attachment(member,room,aid):
        db=store.authority.connection()
        mapping={r[1]:Path(r[2]).resolve() for r in db.execute("PRAGMA database_list") if r[2]}
        if mapping.get("main")!=native_path or mapping.get(schema)!=company_path:
            raise MessagingDenied(403,"COMPANY_ATTACHMENT_DATABASE_MISMATCH")
        try:return validate(db,member,room,aid,company_schema=schema,native_schema="main")
        except Denied:raise MessagingDenied(403,"COMPANY_ATTACHMENT_DENIED") from None
    store.authority._attachment=attachment
    return {"contract":"starli.company-drive.channel-attachments.v1","installed":True}
