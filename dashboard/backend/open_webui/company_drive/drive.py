"""Company Drive v2. Shares the native DB with agent1/agent7; no personal-file import."""
import base64
import hashlib
import io
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from .resources import Resources, Denied

CONTRACT = "starli.company-drive.v2"

class Drive(Resources):
    def __init__(self, path, authority_class, blob_write, blob_read):
        super().__init__(path, lambda *args: False, blob_write, blob_read)
        self.authority_class = authority_class
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS drive_meta(
          id TEXT PRIMARY KEY, parent TEXT, trashed INTEGER NOT NULL DEFAULT 0,
          modified REAL NOT NULL, owner_binding TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS drive_versions(
          resource TEXT NOT NULL, version INTEGER NOT NULL, blob TEXT NOT NULL,
          mime TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(resource,version));
        CREATE TABLE IF NOT EXISTS drive_attachments(
          id TEXT PRIMARY KEY, company TEXT NOT NULL, owner TEXT NOT NULL,
          binding TEXT NOT NULL, draft TEXT NOT NULL, resource TEXT NOT NULL, version INTEGER NOT NULL);
        """)
        self.db.commit()

    def member(self, actor, company, action="read"):
        # Invoke the actual agent1 authority against THIS transaction connection.
        from types import SimpleNamespace
        permission = "read" if action == "read" else "tools.dispatch" if action == "tool" else "files.manage"
        try:
            authority = self.authority_class.__new__(self.authority_class)
            authority.db = self.db
            member = authority.require_member(actor, company, permission=permission)
            if member.get("kind", "person") != "person":
                raise Denied("human session required")
            epoch = self.db.execute("SELECT max(id) FROM audit WHERE company_id=? AND actor=? AND action IN ('create','accept')", (company, actor)).fetchone()[0]
            if epoch is None:
                raise Denied("membership incarnation unavailable")
            member["binding"] = hashlib.sha256((company+"\0"+actor).encode()).hexdigest()+":"+str(epoch)
            return member
        except Denied:
            raise
        except Exception as error:
            raise Denied("resource unavailable") from error

    @contextmanager
    def access(self, actor, company, action="read"):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            member = self.member(actor, company, action)
            yield member
            fresh = self.member(actor, company, action)
            if fresh["binding"] != member["binding"]:
                raise Denied("membership changed")
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def channel(self, member, channel, action="read"):
        row = self.db.execute("SELECT * FROM cm_rooms WHERE id=? AND company=?", (channel, member["company_id"])).fetchone()
        if not row or row["kind"] == "work_session":
            raise Denied("channel unavailable")
        if row["visibility"] == "private":
            found = self.db.execute("SELECT 1 FROM cm_members WHERE room=? AND user=? AND binding=? AND active=1",
                                    (channel, member["user_id"], member["binding"])).fetchone()
            if not found:
                raise Denied("channel unavailable")

    def row(self, member, rid, write=False, trash=False):
        row = self.db.execute("SELECT r.*,m.parent,m.trashed,m.modified,m.owner_binding FROM resource r JOIN drive_meta m ON r.id=m.id WHERE r.id=? AND r.company=?",
                              (rid, member["company_id"])).fetchone()
        if row is None or (row["trashed"] and not trash):
            raise Denied("resource unavailable")
        owner = row["owner"] == member["user_id"] and row["owner_binding"] == member["binding"]
        if not owner:
            if write or not row["channel"]:
                raise Denied("resource unavailable")
            self.channel(member, row["channel"])
        # Folder shares never widen descendant ACLs; ancestor trash hides descendants.
        seen = {rid}
        parent = row["parent"]
        while parent:
            if parent in seen:
                raise Denied("folder cycle")
            seen.add(parent)
            ancestor = self.db.execute("SELECT r.company,m.parent,m.trashed FROM resource r JOIN drive_meta m ON m.id=r.id WHERE r.id=?", (parent,)).fetchone()
            if ancestor is None or ancestor["company"] != member["company_id"] or ancestor["trashed"]:
                raise Denied("folder unavailable")
            parent = ancestor["parent"]
        return row

    @staticmethod
    def public(row):
        return {key: row[key] for key in ("id","company","kind","title","body","channel","version","parent","trashed","modified")}

    def emit(self, row, event):
        self._event(row, event)

    @staticmethod
    def upload_data(data, mime):
        if not isinstance(data, bytes) or len(data) > 16*1024*1024:
            raise ValueError("upload exceeds 16 MiB")
        # Inline rendering only for verified raster images/plain UTF-8.
        if mime == "image/png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("invalid PNG")
        if mime == "image/jpeg" and not data.startswith(b"\xff\xd8\xff"):
            raise ValueError("invalid JPEG")
        if mime.startswith("text/"):
            data.decode("utf-8")
        if mime not in ("image/png","image/jpeg","text/plain","text/markdown","application/pdf","application/octet-stream"):
            raise ValueError("unsupported file type")
        if mime == "application/pdf" and not data.startswith(b"%PDF-"):
            raise ValueError("invalid PDF")

    def _write_blob(self,company,key,data):
        return self.blob_write(key,data)

    def create_item(self, actor, company, title, kind="folder", parent=None, data=None, mime="application/octet-stream", body=""):
        if kind not in ("folder","file","project","task","knowledge") or not isinstance(title,str) or not 0 < len(title) <= 240 or "/" in title or "\\" in title:
            raise ValueError("invalid item")
        if not isinstance(body,str) or len(body)>100000:
            raise ValueError("invalid body")
        if kind == "file":
            self.upload_data(data, mime)
        elif data is not None:
            raise ValueError("only files accept bytes")
        with self.access(actor, company, "write") as member:
            if parent and self.row(member,parent,write=True)["kind"] != "folder":
                raise ValueError("parent must be folder")
            rid = str(uuid.uuid4())
            blob = self._write_blob(company,rid,data) if kind == "file" else None
            self.db.execute("INSERT INTO resource(id,company,owner,kind,title,body,blob) VALUES(?,?,?,?,?,?,?)", (rid,company,actor,kind,title,body,blob))
            self.db.execute("INSERT INTO drive_meta VALUES(?,?,0,?,?)", (rid,parent,time.time(),member["binding"]))
            if kind == "file":
                self.db.execute("INSERT INTO drive_versions VALUES(?,1,?,?,?)", (rid,blob,mime,len(data)))
            row = self.row(member,rid)
            self.emit(row,kind+".created")
            return self.public(row)

    def browse(self, actor, company, parent=None, query=None, recent=False, trash=False, kind=None):
        with self.access(actor,company) as member:
            if parent:
                self.row(member,parent)
            rows = self.db.execute("SELECT r.id FROM resource r JOIN drive_meta m ON m.id=r.id WHERE r.company=? ORDER BY m.modified DESC,r.id", (company,)).fetchall()
            result = []
            for item in rows:
                try:
                    row = self.row(member,item["id"],trash=trash)
                    if bool(row["trashed"]) != bool(trash):
                        continue
                    if kind and row["kind"] != kind:
                        continue
                    if query is not None:
                        if query.casefold() not in row["title"].casefold():
                            continue
                    elif not recent and not trash and row["parent"] != parent:
                        continue
                    result.append(self.public(row))
                    if len(result) >= 200:
                        break
                except Denied:
                    pass
            return result

    def mutate(self, actor, company, rid, version, operation, value=None):
        with self.access(actor,company,"write") as member:
            row = self.row(member,rid,write=True,trash=operation=="restore")
            if row["version"] != version:
                raise ValueError("version conflict")
            if operation == "share":
                if value:
                    self.channel(member,value,"write")
                self.db.execute("UPDATE resource SET channel=? WHERE id=?", (value,rid))
            elif operation == "move":
                if value:
                    if self.row(member,value,write=True)["kind"] != "folder":
                        raise ValueError("destination must be folder")
                    ancestor=value
                    while ancestor:
                        if ancestor == rid:
                            raise ValueError("folder cycle")
                        ancestor=self.row(member,ancestor)["parent"]
                self.db.execute("UPDATE drive_meta SET parent=? WHERE id=?", (value,rid))
            elif operation in ("trash","restore"):
                self.db.execute("UPDATE drive_meta SET trashed=? WHERE id=?", (int(operation=="trash"),rid))
            else:
                raise ValueError("unknown operation")
            self.db.execute("UPDATE resource SET version=version+1 WHERE id=?", (rid,))
            self.db.execute("UPDATE drive_meta SET modified=? WHERE id=?", (time.time(),rid))
            changed=self.db.execute("SELECT * FROM resource WHERE id=?", (rid,)).fetchone()
            self.emit(changed,"resource."+operation)
            return {"id":rid,"version":version+1}

    def replace(self, actor, company, rid, version, data, mime):
        self.upload_data(data,mime)
        with self.access(actor,company,"write") as member:
            row=self.row(member,rid,write=True)
            if row["kind"]!="file" or row["version"]!=version:
                raise ValueError("version conflict")
            key=self._write_blob(company,str(uuid.uuid4()),data)
            self.db.execute("UPDATE resource SET blob=?,version=version+1 WHERE id=?", (key,rid))
            self.db.execute("INSERT INTO drive_versions VALUES(?,?,?,?,?)", (rid,version+1,key,mime,len(data)))
            self.db.execute("UPDATE drive_meta SET modified=? WHERE id=?", (time.time(),rid))
            self.emit(self.row(member,rid),"file.updated")
            return self.public(self.row(member,rid))

    def content(self, actor, company, rid, version):
        with self.access(actor,company) as member:
            row=self.row(member,rid)
            if row["version"] != version or row["kind"] != "file":
                raise ValueError("version conflict")
            blob=self.db.execute("SELECT * FROM drive_versions WHERE resource=? ORDER BY version DESC LIMIT 1", (rid,)).fetchone()
            data=self.blob_read(blob["blob"])
            self.row(member,rid)
            return data,blob["mime"]

    def attach(self, actor, company, draft, rid, version, draft_policy):
        with self.access(actor,company) as member:
            if draft_policy(self.db,member,draft) is not True:
                raise Denied("draft unavailable")
            row=self.row(member,rid)
            if row["kind"]!="file" or row["version"]!=version:
                raise ValueError("version conflict")
            aid=str(uuid.uuid4())
            self.db.execute("INSERT INTO drive_attachments VALUES(?,?,?,?,?,?,?)", (aid,company,actor,member["binding"],draft,rid,version))
            return {"id":aid,"resource":rid,"version":version}

    def attachment(self, actor, company, aid, draft_policy):
        # Resolve on each draft render, thumbnail, and eventual send validation.
        with self.access(actor,company) as member:
            a=self.db.execute("SELECT * FROM drive_attachments WHERE id=? AND company=? AND owner=? AND binding=?", (aid,company,actor,member["binding"])).fetchone()
            if a is None or draft_policy(self.db,member,a["draft"]) is not True:
                raise Denied("attachment unavailable")
            row=self.row(member,a["resource"])
            if row["version"]!=a["version"]:
                raise Denied("attachment changed or revoked")
            blob=self.db.execute("SELECT * FROM drive_versions WHERE resource=? ORDER BY version DESC LIMIT 1", (row["id"],)).fetchone()
            data=self.blob_read(blob["blob"])
            self.row(member,row["id"])
            return data,blob["mime"]

    def channels(self, actor, company):
        with self.access(actor,company) as member:
            result=[]
            for row in self.db.execute("SELECT id FROM cm_rooms WHERE company=? ORDER BY id",(company,)).fetchall():
                try:
                    self.channel(member,row["id"])
                    result.append({"id":row["id"]})
                except Denied:
                    pass
            return result[:200]

    def picker(self, actor, company, bot, query, bot_policy):
        with self.access(actor,company,"tool") as member:
            if bot_policy(self.db,member,bot) is not True:
                raise Denied("bot unavailable")
            rows=self.db.execute("SELECT id FROM resource WHERE company=? AND kind='file' ORDER BY id",(company,)).fetchall()
            result=[]
            for item in rows:
                try:
                    row=self.row(member,item["id"])
                    if query.casefold() in row["title"].casefold():
                        result.append(self.public(row))
                    if len(result)>=200:
                        break
                except Denied:
                    pass
            return {"contract":CONTRACT,"items":result}

    def document(self, actor, company, rid, version, title, body):
        if not isinstance(title,str) or not 0<len(title)<=240 or not isinstance(body,str) or len(body)>100000:
            raise ValueError("invalid document")
        with self.access(actor,company,"write") as member:
            row=self.row(member,rid,write=True)
            if row["kind"]!="knowledge" or row["version"]!=version:
                raise ValueError("version conflict")
            self.db.execute("UPDATE resource SET title=?,body=?,version=version+1 WHERE id=?",(title,body,rid))
            self.db.execute("UPDATE drive_meta SET modified=? WHERE id=?",(time.time(),rid))
            self.emit(self.row(member,rid),"knowledge.updated")
            return self.public(self.row(member,rid))

    def changes(self, actor, company, after=0):
        with self.access(actor,company) as member:
            events=self.db.execute("SELECT * FROM event WHERE company=? AND cursor>? ORDER BY cursor LIMIT 200", (company,after)).fetchall()
            result=[]
            for event in events:
                try:
                    self.row(member,event["resource"])
                    result.append(dict(event))
                except Denied:
                    pass
            # Always reset visible metadata on poll; revoked IDs never leak through tombstones.
            return {"contract":CONTRACT,"reset":True,"events":result,"cursor":events[-1]["cursor"] if events else after}

    def dashboard(self, actor, company):
        counts=dict.fromkeys(("folder","file","project","task","knowledge"),0)
        for item in self.browse(actor,company,recent=True):
            counts[item["kind"]]+=1
        return {"contract":CONTRACT,"counts":counts,"bounded":True}

class LocalBlobs:
    """Private candidate storage. Root may substitute the native Storage adapter."""
    def __init__(self, root):
        from pathlib import Path
        self.root=Path(root)
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
    def path(self,key):
        uuid.UUID(key)
        return self.root/key
    def write(self,key,data):
        with self.path(key).open("xb") as stream:
            stream.write(data)
        self.path(key).chmod(0o600)
        return key
    def read(self,key):
        return self.path(key).read_bytes()
