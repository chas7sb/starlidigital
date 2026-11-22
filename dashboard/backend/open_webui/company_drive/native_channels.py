"""Read agent7 v4 channel ACLs in the attached native DB, never copy its data."""
import json
from pathlib import Path
from .resources import Denied
from .quota import QuotaDrive

SCHEMA="native_messaging"

class NativeChannels:
    def __init__(self,native_database):
        self.path=Path(native_database).resolve()
        if not self.path.is_file():
            raise ValueError("existing native messaging database required")

    def attach(self,db):
        main=next(row[2] for row in db.execute("PRAGMA database_list") if row[1]=="main")
        if Path(main).resolve()==self.path:
            raise ValueError("split native and authority paths must differ")
        # mode=rw forbids silent creation if the file disappears after validation.
        db.execute("ATTACH DATABASE ? AS "+SCHEMA,(self.path.as_uri()+"?mode=rw",))
        mapped=next(row[2] for row in db.execute("PRAGMA database_list") if row[1]==SCHEMA)
        if Path(mapped).resolve()!=self.path:
            raise ValueError("native database mapping mismatch")

    def require_room(self,db,member,room):
        if not db.in_transaction:
            raise RuntimeError("native room checks require authority transaction")
        row=db.execute("""SELECT r.*,c.name AS native_name,c.type AS native_type,c.data AS native_data
          FROM native_messaging.cm_rooms r
          JOIN native_messaging.channel c ON c.id=r.id
          WHERE r.id=? AND r.company=?""",(room,member["company_id"])).fetchone()
        if row is None or row["kind"] not in ("channel","group","dm") or row["visibility"] not in ("public","private"):
            raise Denied("channel unavailable")
        if row["visibility"]=="public" and row["kind"]!="channel":
            raise Denied("channel unavailable")
        try:
            valid=row["native_type"]=="starli_company" and json.loads(row["native_data"])["companyId"]==member["company_id"]
        except (ValueError,TypeError,KeyError):
            valid=False
        if not valid:
            raise Denied("channel unavailable")
        if row["visibility"]=="private":
            joined=db.execute("""SELECT 1 FROM native_messaging.cm_members
              WHERE room=? AND user=? AND binding=? AND active=1""",
              (room,member["user_id"],member["binding"])).fetchone()
            if joined is None:
                raise Denied("channel unavailable")
        return row

class ChannelDrive(QuotaDrive):
    def __init__(self,path,authority_class,blobs,policy,channels=None):
        super().__init__(path,authority_class,blobs,policy)
        self.native_channels=channels
        self.db.executescript("""CREATE TABLE IF NOT EXISTS drive_channel_shares(
          resource TEXT PRIMARY KEY,room TEXT NOT NULL,creator TEXT NOT NULL,
          creator_binding TEXT NOT NULL,kind TEXT NOT NULL);""")
        if channels is not None:
            channels.attach(self.db)

    def channel(self,member,channel,action="read"):
        if self.native_channels is None:
            raise Denied("native channel binding unavailable")
        return self.native_channels.require_room(self.db,member,channel)

    def row(self,member,rid,write=False,trash=False):
        row=super().row(member,rid,write,trash)
        owner=row["owner"]==member["user_id"] and row["owner_binding"]==member["binding"]
        if not owner and row["channel"]:
            room=self.channel(member,row["channel"])
            grant=self.db.execute("SELECT * FROM drive_channel_shares WHERE resource=? AND room=?",(rid,row["channel"])).fetchone()
            if grant is None or (grant["creator"],grant["creator_binding"],grant["kind"])!=(room["creator"],room["creator_binding"],room["kind"]):
                raise Denied("channel share unavailable")
        return row

    def emit(self,row,event):
        if event=="resource.share":
            if row["channel"]:
                # A share is an owner-only mutation in the base service.
                member=self.member(row["owner"],row["company"],"write")
                room=self.channel(member,row["channel"],"write")
                self.db.execute("""INSERT INTO drive_channel_shares VALUES(?,?,?,?,?)
                  ON CONFLICT(resource) DO UPDATE SET room=excluded.room,creator=excluded.creator,
                  creator_binding=excluded.creator_binding,kind=excluded.kind""",
                  (row["id"],row["channel"],room["creator"],room["creator_binding"],room["kind"]))
            else:
                self.db.execute("DELETE FROM drive_channel_shares WHERE resource=?",(row["id"],))
        super().emit(row,event)

    def channel_reference(self,actor,company,rid,version,room):
        from .channel_attachments import reference,validate
        with self.access(actor,company) as member:
            return validate(self.db,member,room,reference(rid,version))

    def channel_content(self,actor,company,aid,room):
        from .channel_attachments import validate,parse
        with self.access(actor,company) as member:
            safe=validate(self.db,member,room,aid)
            rid,_=parse(aid)
            blob=self.db.execute("SELECT blob FROM drive_versions WHERE resource=? ORDER BY version DESC LIMIT 1",(rid,)).fetchone()
            data=self.blobs.read(blob["blob"])
            validate(self.db,member,room,aid)
            return data,safe["mime"]

    def channel_metadata(self,actor,company,aid,room):
        from .channel_attachments import validate
        with self.access(actor,company) as member:
            return validate(self.db,member,room,aid)

    def channels(self,actor,company):
        with self.access(actor,company) as member:
            if self.native_channels is None:
                return []
            result=[]
            rows=self.db.execute("SELECT id FROM native_messaging.cm_rooms WHERE company=? ORDER BY id",(company,)).fetchall()
            for row in rows:
                try:
                    room=self.channel(member,row["id"])
                    result.append({"id":room["id"],"name":room["native_name"]})
                    if len(result)>=200:
                        break
                except Denied:
                    pass
            return result
