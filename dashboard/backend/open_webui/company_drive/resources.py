"""Company resources v1. All identities must come from a verified server session."""
import json
import secrets
import sqlite3
import time
import uuid

class Denied(PermissionError):
    pass

class Resources:
    def __init__(self, path, authorize, blob_write, blob_read):
        self.db = sqlite3.connect(path, uri=True)
        self.db.row_factory = sqlite3.Row
        self.authorize = authorize
        self.blob_write, self.blob_read = blob_write, blob_read
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS resource(
          id TEXT PRIMARY KEY, company TEXT NOT NULL, owner TEXT NOT NULL,
          kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
          blob TEXT, channel TEXT, version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS event(
          cursor INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL,
          resource TEXT NOT NULL, version INTEGER NOT NULL, type TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS preview(
          token TEXT PRIMARY KEY, actor TEXT NOT NULL, company TEXT NOT NULL,
          resource TEXT NOT NULL, version INTEGER NOT NULL, expires REAL NOT NULL);
        """)
        self.db.commit()

    def check(self, actor, company, action="read", channel=None):
        # Adapter MUST read authoritative membership each call; no admin fallback.
        if not self.authorize(actor, company, action, channel):
            raise Denied("resource unavailable")

    def _row(self, actor, company, rid, action="read"):
        self.check(actor, company, action)
        row = self.db.execute("SELECT * FROM resource WHERE id=? AND company=?", (rid, company)).fetchone()
        if row is None:
            raise Denied("resource unavailable")
        if row["owner"] != actor:
            if not row["channel"]:
                raise Denied("resource unavailable")
            self.check(actor, company, action, row["channel"])
        return row

    def _event(self, row, event):
        self.db.execute("INSERT INTO event(company,resource,version,type) VALUES(?,?,?,?)",
                        (row["company"], row["id"], row["version"], event))

    def create(self, actor, company, kind, title, body="", data=None):
        self.check(actor, company, "write")
        if kind not in ("file", "project", "task", "knowledge"):
            raise ValueError("unsupported resource kind")
        if not isinstance(title, str) or not 0 < len(title) <= 240:
            raise ValueError("invalid title")
        if not isinstance(body, str) or len(body) > 100000:
            raise ValueError("invalid body")
        if data is not None and (kind != "file" or not isinstance(data, bytes) or len(data) > 16*1024*1024):
            raise ValueError("invalid upload")
        if kind == "file" and data is None:
            raise ValueError("file requires bytes")
        rid = str(uuid.uuid4())
        # No path/URL/reference imports: only explicit fresh uploads.
        blob = self.blob_write(rid, data) if data is not None else None
        self.check(actor, company, "write")
        with self.db:
            self.db.execute("INSERT INTO resource(id,company,owner,kind,title,body,blob) VALUES(?,?,?,?,?,?,?)",
                            (rid, company, actor, kind, title, body, blob))
            self._event(self._row(actor, company, rid), kind + ".created")
        return rid

    def get(self, actor, company, rid):
        row = dict(self._row(actor, company, rid))
        row.pop("blob")
        return row

    def share(self, actor, company, rid, channel):
        row = self._row(actor, company, rid, "write")
        if row["owner"] != actor:
            raise Denied("only owner can share")
        if channel is not None:
            self.check(actor, company, "share", channel)
        with self.db:
            self.db.execute("UPDATE resource SET channel=?,version=version+1 WHERE id=?", (channel, rid))
            self._event(self._row(actor, company, rid), "resource.shared" if channel else "resource.revoked")

    def update(self, actor, company, rid, title, body, expected_version):
        row = self._row(actor, company, rid, "write")
        if not isinstance(title, str) or not 0 < len(title) <= 240 or not isinstance(body, str) or len(body) > 100000:
            raise ValueError("invalid metadata")
        with self.db:
            result = self.db.execute("UPDATE resource SET title=?,body=?,version=version+1 WHERE id=? AND version=?",
                                     (title, body, rid, expected_version))
            if result.rowcount != 1:
                raise ValueError("version conflict")
            self._event(self._row(actor, company, rid), row["kind"] + ".updated")

    def download(self, actor, company, rid):
        row = self._row(actor, company, rid)
        if row["kind"] != "file":
            raise ValueError("not a file")
        data = self.blob_read(row["blob"])
        self._row(actor, company, rid)  # recheck after potentially slow storage read
        return data

    def preview_link(self, actor, company, rid):
        row = self._row(actor, company, rid)
        token = secrets.token_urlsafe(32)
        with self.db:
            self.db.execute("INSERT INTO preview VALUES(?,?,?,?,?,?)",
                            (token, actor, company, rid, row["version"], time.time()+60))
        return token

    def preview(self, actor, company, token):
        link = self.db.execute("SELECT * FROM preview WHERE token=? AND actor=? AND company=?",
                               (token, actor, company)).fetchone()
        if link is None or link["expires"] <= time.time():
            raise Denied("preview unavailable")
        row = self._row(actor, company, link["resource"])
        if row["version"] != link["version"]:
            raise Denied("preview revoked")
        # Preview/thumbnail adapters consume these authorized bytes only.
        return self.download(actor, company, row["id"])

    def search(self, actor, company, query):
        self.check(actor, company)
        result = []
        for row in self.db.execute("SELECT id FROM resource WHERE company=? AND instr(lower(title),lower(?))>0 LIMIT 200", (company, query)):
            try:
                result.append(self.get(actor, company, row["id"]))
            except Denied:
                pass
        return result

    def events(self, actor, company, after=0):
        self.check(actor, company)
        result = []
        rows = self.db.execute("SELECT * FROM event WHERE company=? AND cursor>? ORDER BY cursor LIMIT 200", (company, after)).fetchall()
        for event in rows:
            try:
                self._row(actor, company, event["resource"])
                result.append(dict(event))
            except Denied:
                pass
        self.check(actor, company)
        return {"version": "company-resources.v1", "events": result,
                "cursor": rows[-1]["cursor"] if rows else after}

    def list(self, actor, company, kind=None):
        self.check(actor, company)
        if kind is not None and kind not in ("file", "project", "task", "knowledge"):
            raise ValueError("unsupported kind")
        rows = self.db.execute("SELECT id FROM resource WHERE company=? AND (? IS NULL OR kind=?) ORDER BY id", (company, kind, kind)).fetchall()
        result = []
        for row in rows:
            try:
                result.append(self.get(actor, company, row["id"]))
            except Denied:
                pass
        self.check(actor, company)
        return result

    def counters(self, actor, company):
        counts = dict.fromkeys(("file", "project", "task", "knowledge"), 0)
        for row in self.list(actor, company):
            counts[row["kind"]] += 1
        return {"contract": "company-resources.v1", "counts": counts}
