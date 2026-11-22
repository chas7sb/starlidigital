"""Isolated G2 provisional bootstrap. NOT a mounted native route.

Guest receipts must be independently verified by mini2; never accept guest binding
or registered identity directly from an untrusted HTTP body.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import math
import re
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
class Denied(Exception): pass
class Conflict(Exception): pass

def stamp(now):
    return datetime.fromtimestamp(now, timezone.utc).isoformat()

def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

class ProvisionalStore:
    def __init__(self, db_path: str | Path, *, now=None):
        self.db_path = str(db_path)
        self.now = now or time.time
        self.db = sqlite3.connect(self.db_path, isolation_level=None, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=10000")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS provisional_companies (
          intent_id TEXT PRIMARY KEY, company_id TEXT NOT NULL UNIQUE,
          guest_binding TEXT NOT NULL, prompt_digest TEXT NOT NULL,
          boss_id TEXT NOT NULL UNIQUE, dm_id TEXT NOT NULL UNIQUE,
          channel_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL UNIQUE,
          created REAL NOT NULL, expires REAL NOT NULL, revision INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('PROVISIONAL','CLAIMED','REVOKED','EXPIRED')),
          claimed_owner TEXT, claimed_at REAL, claim_token_hash TEXT UNIQUE,
          claim_expires REAL, claim_issued_by TEXT,
          CHECK((status='CLAIMED') = (claimed_owner IS NOT NULL))
        );
        CREATE INDEX IF NOT EXISTS provisionals_guest_idx
          ON provisional_companies(guest_binding,status);
        CREATE TABLE IF NOT EXISTS provisional_artifacts (
          id TEXT PRIMARY KEY, company_id TEXT NOT NULL, kind TEXT NOT NULL,
          body TEXT NOT NULL, created REAL NOT NULL
        );
        """)
        # A partial index alone sees even expired PROVISIONAL rows. Normalize
        # stale rows and fail closed on pre-existing active duplicates in ONE
        # writer transaction, rather than arbitrarily choosing a tenant.
        try:
            self._tx(self._ensure_single_active_index_tx)
        except BaseException:
            self.db.close()
            raise
    @staticmethod
    def normalize_expired_tx(db, current: float):
        return db.execute("""
          UPDATE provisional_companies
             SET status='EXPIRED',revision=revision+1,
                 claim_token_hash=NULL,claim_expires=NULL,claim_issued_by=NULL
           WHERE status='PROVISIONAL' AND expires<=?
        """,(current,)).rowcount
    def _ensure_single_active_index_tx(self):
        self.normalize_expired_tx(self.db,self.now())
        dupe=self.db.execute("""
          SELECT guest_binding,COUNT(*) AS n FROM provisional_companies
           WHERE status='PROVISIONAL'
           GROUP BY guest_binding HAVING COUNT(*)>1 LIMIT 1
        """).fetchone()
        if dupe:
            raise Denied("existing active guest duplicates require audited migration")
        self.db.execute("""
          CREATE UNIQUE INDEX IF NOT EXISTS provisional_one_active_guest
             ON provisional_companies(guest_binding) WHERE status='PROVISIONAL'
        """)
        row=self.db.execute(
            "SELECT sql FROM sqlite_master WHERE type='index' AND name='provisional_one_active_guest'"
        ).fetchone()
        if not row or not isinstance(row[0],str) or (
            "ON provisional_companies(guest_binding)" not in row[0] or
            "WHERE status='PROVISIONAL'" not in row[0]
        ):
            raise Denied("guest admission unique index drift; abort migration")
        self.db.execute("""
          CREATE INDEX IF NOT EXISTS provisional_status_expiry
             ON provisional_companies(status,expires)
        """)
    def close(self): self.db.close()
    def _tx(self, fn):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            value = fn()
            self.db.execute("COMMIT")
            return value
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
    def _row(self, intent):
        self.db.row_factory = sqlite3.Row
        return self.db.execute("SELECT * FROM provisional_companies WHERE intent_id=?", (intent,)).fetchone()
    def _receipt(self, r):
        return dict(schemaVersion=SCHEMA_VERSION,intentId=r["intent_id"],
                    companyId=r["company_id"],guestBinding=r["guest_binding"],
                    bossBotId=r["boss_id"],bossDmRoomId=r["dm_id"],
                    channelRoomId=r["channel_id"],rootProjectId=r["project_id"],
                    bootstrapRevision=r["revision"],status=r["status"],
                    observedAt=stamp(self.now()),producer="mini-chatgpt3.stage")
    def bootstrap(self, intent: dict, verified_binding: str):
        """Caller MUST verify mini2 receipt against its store, including revocation/expiry.
        verified_binding comes only from authenticated cookie verifier, not user JSON.
        """
        required = ("schemaVersion","intentId","guestSessionBinding","originalPrompt",
                    "status","expiresAt")
        if not isinstance(intent,dict) or any(k not in intent for k in required):
            raise Denied("invalid intent receipt")
        if intent["schemaVersion"] != 1 or intent["status"] != "PROPOSED":
            raise Denied("intent not proposed")
        if not isinstance(verified_binding,str) or len(verified_binding)!=64:
            raise Denied("unverified binding")
        if not hmac.compare_digest(intent["guestSessionBinding"], verified_binding):
            raise Denied("guest mismatch")
        if not isinstance(intent["originalPrompt"], str) or not intent["originalPrompt"].strip():
            raise Denied("invalid prompt")
        try:
            expires=datetime.fromisoformat(intent["expiresAt"].replace("Z","+00:00")).timestamp()
        except (ValueError,TypeError,AttributeError):
            raise Denied("invalid expiry")
        if expires <= self.now(): raise Denied("expired intent")
        if not isinstance(intent["intentId"],str) or len(intent["intentId"])>128:
            raise Denied("invalid intent")
        return self._tx(lambda:self._bootstrap_tx(intent,verified_binding,expires))
    @staticmethod
    def bootstrap_verified_tx(db, intent, binding, expires, current: float):
        """Transaction BODY only; caller MUST hold BEGIN IMMEDIATE on this DB.

        Public routes must authenticate the issuer & guest BEFORE reaching here.
        The unique partial index protects against any competing bypass that
        might skip this explicit predicate.
        """
        if (not isinstance(intent,dict) or
            intent.get("schemaVersion")!=1 or intent.get("status")!="PROPOSED" or
            not isinstance(intent.get("intentId"),str) or
            not 1<=len(intent["intentId"])<=128 or
            not isinstance(intent.get("originalPrompt"),str) or
            not intent["originalPrompt"].strip()):
            raise Denied("intent invalid")
        if (not isinstance(binding,str) or
            re.fullmatch(r"[0-9a-f]{64}",binding) is None or
            not isinstance(intent.get("guestSessionBinding"),str) or
            not hmac.compare_digest(intent["guestSessionBinding"],binding)):
            raise Denied("verified binding required")
        if (not isinstance(expires,(float,int)) or
            not math.isfinite(expires) or expires<=current):
            raise Denied("expired or invalid issuer receipt")
        ProvisionalStore.normalize_expired_tx(db,current)
        old=db.execute("SELECT * FROM provisional_companies WHERE intent_id=?",
                       (intent["intentId"],)).fetchone()
        fingerprint=digest(intent["originalPrompt"])
        if old:
            if old["status"]!="PROVISIONAL" or old["expires"]<=current:
                raise Denied("provisional unavailable")
            if (not hmac.compare_digest(old["guest_binding"],binding) or
                not hmac.compare_digest(old["prompt_digest"],fingerprint)):
                raise Conflict("intent replay mismatch")
            return old
        active=db.execute("""
            SELECT intent_id FROM provisional_companies
             WHERE guest_binding=? AND status='PROVISIONAL' LIMIT 1
        """,(binding,)).fetchone()
        if active:
            raise Denied("active provisional already exists for guest")
        ids=[uuid.uuid4().hex for _ in range(5)]
        try:
            db.execute("""INSERT INTO provisional_companies(
                intent_id,company_id,guest_binding,prompt_digest,boss_id,dm_id,
                channel_id,project_id,created,expires,revision,status)
                VALUES(?,?,?,?,?,?,?,?,?,?,1,'PROVISIONAL')""",
                (intent["intentId"],ids[0],binding,fingerprint,ids[1],ids[2],
                 ids[3],ids[4],current,expires))
        except sqlite3.IntegrityError:
            # Unexpected race or ID/index conflict: never replay arbitrary rows.
            raise Denied("active guest admission or ID conflict") from None
        return db.execute(
            "SELECT * FROM provisional_companies WHERE intent_id=?",
            (intent["intentId"],)).fetchone()
    def _bootstrap_tx(self, intent, binding, expires):
        row=self.bootstrap_verified_tx(
            self.db,intent,binding,expires,self.now())
        return self._receipt(row)
    def get(self, intent_id, verified_binding):
        r=self._row(intent_id)
        if not r or r["status"]!="PROVISIONAL" or r["expires"]<=self.now() or not hmac.compare_digest(r["guest_binding"],verified_binding):
            raise Denied("unavailable")
        return self._receipt(r)
    def save_artifact(self,intent_id,verified_binding,kind,body,artifact_id=None):
        """Stage-only message/file metadata. No real native messaging created."""
        if kind not in ("message","file_metadata"): raise Denied("invalid artifact")
        if not isinstance(body,str) or len(body)>64000: raise Denied("invalid body")
        def write():
            r=self._row(intent_id)
            if not r or r["status"]!="PROVISIONAL" or r["expires"]<=self.now() or not hmac.compare_digest(r["guest_binding"],verified_binding):
                raise Denied("unavailable")
            a=artifact_id or uuid.uuid4().hex
            self.db.execute("INSERT INTO provisional_artifacts VALUES(?,?,?,?,?)",
                            (a,r["company_id"],kind,body,self.now()))
            return a
        return self._tx(write)
    def issue_claim(self,intent_id,verified_binding,verified_registered_user,ttl=900):
        """Called only AFTER native auth verified the registered user and reauthenticated them.
        A token alone must never authenticate a user.
        """
        if not isinstance(verified_registered_user,str) or not verified_registered_user.strip():
            raise Denied("registered identity required")
        if not 0<ttl<=3600: raise Denied("invalid claim TTL")
        token=secrets.token_urlsafe(32)
        def write():
            r=self._row(intent_id)
            if not r or r["status"]!="PROVISIONAL" or r["expires"]<=self.now() or not hmac.compare_digest(r["guest_binding"],verified_binding):
                raise Denied("unavailable")
            if r["claim_token_hash"] is not None:
                raise Conflict("outstanding claim; revoke before reissue")
            self.db.execute("""UPDATE provisional_companies
                  SET claim_token_hash=?,claim_expires=?,claim_issued_by=?,revision=revision+1
                  WHERE intent_id=?""",(digest(token),min(self.now()+ttl,r["expires"]),
                                         verified_registered_user,intent_id))
            return dict(claimToken=token,expiresAt=stamp(min(self.now()+ttl,r["expires"])))
        return self._tx(write)
    def claim(self,intent_id,verified_registered_user,claim_token,expected_revision):
        """Atomic staged ownership transition. No native membership inserted.

        ULTRA must reconcile native authority/messaging in ONE verified migration;
        do not expose CLAIMED stage receipt as a native member capability.
        """
        if not isinstance(verified_registered_user,str) or not verified_registered_user.strip():
            raise Denied("registered identity required")
        if not isinstance(claim_token,str): raise Denied("bad token")
        def write():
            r=self._row(intent_id)
            if not r or r["status"]!="PROVISIONAL" or r["expires"]<=self.now():
                raise Denied("claim unavailable")
            if r["revision"]!=expected_revision: raise Conflict("stale revision")
            if not r["claim_token_hash"] or not r["claim_expires"] or r["claim_expires"]<=self.now():
                raise Denied("claim expired")
            if r["claim_issued_by"]!=verified_registered_user or not hmac.compare_digest(r["claim_token_hash"],digest(claim_token)):
                raise Denied("wrong owner or token")
            self.db.execute("""UPDATE provisional_companies SET status='CLAIMED',
                  claimed_owner=?,claimed_at=?,guest_binding=?,claim_token_hash=NULL,
                  claim_expires=NULL,revision=revision+1 WHERE intent_id=?""",
                  (verified_registered_user,self.now(),digest(secrets.token_urlsafe(32)),intent_id))
            return dict(**self._receipt(self._row(intent_id)),ownerUserId=verified_registered_user,
                        nativeAuthorityActive=False)
        return self._tx(write)
    def list_artifacts_for_owner(self,intent_id,verified_registered_user):
        r=self._row(intent_id)
        if not r or r["status"]!="CLAIMED" or r["claimed_owner"]!=verified_registered_user:
            raise Denied("owner required")
        return [dict(id=a,kind=k,body=b) for a,k,b in
                self.db.execute("SELECT id,kind,body FROM provisional_artifacts WHERE company_id=? ORDER BY created,id",(r["company_id"],))]
    def revoke(self,intent_id,verified_binding):
        def write():
            r=self._row(intent_id)
            if not r or r["status"]!="PROVISIONAL" or not hmac.compare_digest(r["guest_binding"],verified_binding):
                raise Denied("unavailable")
            self.db.execute("UPDATE provisional_companies SET status='REVOKED',revision=revision+1,claim_token_hash=NULL WHERE intent_id=?",(intent_id,))
        return self._tx(write)
    def cleanup(self):
        """TTL marks expired. Retain artifacts for claimed owners; do not delete native data."""
        def write():
            count=self.db.execute("""UPDATE provisional_companies SET status='EXPIRED',
                 revision=revision+1,claim_token_hash=NULL WHERE status='PROVISIONAL' AND expires<=?""",
                 (self.now(),)).rowcount
            return count
        return self._tx(write)
