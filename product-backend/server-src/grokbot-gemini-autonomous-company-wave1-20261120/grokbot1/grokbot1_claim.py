"""grokbot1 W1 — guest intent -> restricted provisional company -> verified native claim.

Contracts: GUEST_INTENT_V1 (mini2 W4 issuer, byte-exact vendor), PROVISIONAL_COMPANY_V1,
CLAIMED_NATIVE_COMPANY_V1, VERIFIED_ROOM_NAVIGATION_V1. See CONTRACT.md.

Split-database protocol CLAIM_SAGA_V1 (presumed abort; the COMMIT decision row is written in
the SAME native company-authority transaction that grants native membership):
  intake DB  : PREPARED journal (unexposed)                         [step 1]
  authority  : decision COMMIT + company + owner PERSON + BOSS bot   [step 2 = commit point]
  webui.db   : BOSS DM, #doglove, provenance message (native Store)  [step 3, idempotent]
  drive DB   : DogLove project (native Resources)                    [step 3, idempotent]
  intake DB  : COMMITTED + provisional CLAIMED + guest retired       [step 4]
Recovery: lease expired + no decision -> ABORT decision (PK makes COMMIT/ABORT exclusive).
"""
from __future__ import annotations

import hashlib
import hmac
import importlib
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

SCHEMA_VERSION = 1
EXECUTION_CLASS = 'NATIVE_NONPRODUCTION'
PRODUCER = 'grokbot1.wave1'
NS_UUID = uuid.UUID('6f1e1f0a-9b1d-4c55-9a51-67726f6b3101')
GUEST_COOKIE = 'starli_guest'
IDEM_RE = re.compile(r'[!-~]{8,128}')
OWNER_REAUTH_HREF = '/api/v1/starli/grokbot1/reauth'

# Additive candidate schema (intake DB). Partial unique index: at most one live claim per intent.
JOURNAL_SQL = """
CREATE TABLE IF NOT EXISTS grokbot1_claim_journal(
  txn TEXT PRIMARY KEY, intent_id TEXT NOT NULL, guest_binding TEXT NOT NULL,
  owner_user_id TEXT NOT NULL, idem_key TEXT NOT NULL, request_digest TEXT NOT NULL,
  company_id TEXT NOT NULL, boss_bot_id TEXT NOT NULL, provisional_revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PREPARED','COMMITTED','ABORTED')),
  lease_owner TEXT, lease_until REAL NOT NULL, created REAL NOT NULL, updated REAL NOT NULL,
  receipts TEXT, abort_reason TEXT,
  CHECK((state='COMMITTED') = (receipts IS NOT NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS grokbot1_one_live_claim_per_intent
  ON grokbot1_claim_journal(intent_id) WHERE state IN ('PREPARED','COMMITTED');
CREATE UNIQUE INDEX IF NOT EXISTS grokbot1_claim_idempotency
  ON grokbot1_claim_journal(owner_user_id, idem_key);
"""
# Identical to mini2 W4 guest_intents.py connect() bootstrap (lines 158-166); test asserts equality.
MINI2_SCHEMA = [
    "CREATE TABLE IF NOT EXISTS guest_intents (intent_id TEXT PRIMARY KEY, binding TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, receipt TEXT NOT NULL, expires REAL NOT NULL, UNIQUE(binding,request_id))",
    "CREATE INDEX IF NOT EXISTS idx_guest_intents_binding ON guest_intents(binding,intent_id)",
    "CREATE TABLE IF NOT EXISTS revoked_guest_bindings (binding TEXT PRIMARY KEY, revoked REAL NOT NULL)",
    "CREATE TABLE IF NOT EXISTS guest_intent_limits (subject TEXT NOT NULL, bucket INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(subject,bucket))",
    "CREATE TABLE IF NOT EXISTS guest_intent_audiences (intent_id TEXT PRIMARY KEY, audience TEXT NOT NULL CHECK (audience='provisional.bootstrap'))",
    "CREATE TABLE IF NOT EXISTS guest_intent_retirements (intent_id TEXT PRIMARY KEY, binding TEXT NOT NULL, retired_at REAL NOT NULL, state TEXT NOT NULL CHECK(state IN ('CLAIMED','REVOKED')))",
]
# RECENT_AUTH_V1 (intake DB, additive): server-verified password re-authentication bound to the exact
# native JWT (sha256) and user, with a bounded window. Never stores the password; failures rate-limited.
RECENT_AUTH_SQL = """
CREATE TABLE IF NOT EXISTS grokbot1_recent_auth(
  reauth_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_sha256 TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method='native_password'), verified_at REAL NOT NULL, expires_at REAL NOT NULL,
  CHECK(expires_at > verified_at));
CREATE INDEX IF NOT EXISTS grokbot1_recent_auth_lookup ON grokbot1_recent_auth(user_id, token_sha256, expires_at);
CREATE TABLE IF NOT EXISTS grokbot1_recent_auth_failures(
  user_id TEXT NOT NULL, bucket INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(user_id, bucket));
"""
REAUTH_WINDOW_SECONDS = 300
REAUTH_MAX_FAILURES = 5
NAV_TTL_SECONDS = 120
# Additive candidate schema (native company-authority DB).
DECISION_SQL = """
CREATE TABLE IF NOT EXISTS grokbot1_saga_decisions(
  txn TEXT PRIMARY KEY, decision TEXT NOT NULL CHECK(decision IN ('COMMIT','ABORT')),
  company_id TEXT, owner_user_id TEXT, owner_audit_id INTEGER, reason TEXT,
  decided REAL NOT NULL, decided_by TEXT NOT NULL);
"""


class ClaimError(Exception):
    def __init__(self, status: int, code: str, detail: dict | None = None):
        self.status, self.code, self.detail = status, code, detail or {}
        super().__init__(code)


def utc(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace('+00:00', 'Z')


def sha(value) -> str:
    if not isinstance(value, (bytes, bytearray)):
        value = (value if isinstance(value, str) else json.dumps(value, sort_keys=True, separators=(',', ':'))).encode()
    return hashlib.sha256(value).hexdigest()


def connect(path) -> sqlite3.Connection:
    db = sqlite3.connect(str(path), timeout=15, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA busy_timeout=15000')
    return db


@contextmanager
def immediate(db: sqlite3.Connection):
    db.execute('BEGIN IMMEDIATE')
    try:
        yield db
        db.execute('COMMIT')
    except BaseException:
        db.execute('ROLLBACK')
        raise


def sign(key: bytes, payload: dict) -> str:
    return hmac.new(key, json.dumps(payload, sort_keys=True, separators=(',', ':')).encode(), hashlib.sha256).hexdigest()


def verify_navigation(dto: dict, key: bytes, now: float | None = None) -> bool:
    """Server-side verifier for VERIFIED_ROOM_NAVIGATION_V1 (Gemini1 BFF / Grokbot2 dispatch).
    Rejects a forged/altered DTO and any DTO past its server-issued expiresAt."""
    body = {k: v for k, v in dto.items() if k != 'proof'}
    if not (isinstance(dto.get('proof'), str) and hmac.compare_digest(dto['proof'], sign(key, body))):
        return False
    try:
        expires = datetime.fromisoformat(str(dto['expiresAt']).replace('Z', '+00:00')).timestamp()
    except Exception:
        return False
    return (time.time() if now is None else now) < expires


class Grokbot1Service:
    def __init__(self, ns, store, *, signing_key: bytes, nav_key: bytes, now=time.time, lease_seconds: float = 20.0):
        if not isinstance(signing_key, bytes) or len(signing_key) < 32 or not isinstance(nav_key, bytes) or len(nav_key) < 32:
            raise ValueError('server-owned 32+ byte keys required')
        self.ns, self.p, self.store = ns, ns.paths, store
        self.key, self.nav_key, self.now, self.lease_seconds = signing_key, nav_key, now, lease_seconds
        self.instance = f'{os.getpid()}:{secrets.token_hex(6)}'
        self.sm = importlib.import_module(type(store).__module__)  # native company_messaging.store
        self.p.intake.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        ns.mini3.ProvisionalStore(str(self.p.intake)).close()   # mini3 schema + one-active index
        with closing(connect(self.p.intake)) as db:
            db.execute('PRAGMA journal_mode=WAL')
            for stmt in MINI2_SCHEMA:
                db.execute(stmt)
            db.executescript(JOURNAL_SQL)
            db.executescript(RECENT_AUTH_SQL)
        with closing(connect(self.p.authority)) as db:
            db.executescript(DECISION_SQL)

    # ------------------------------------------------------------------ identity
    def _crash(self, point: str) -> None:
        if os.environ.get('GROKBOT1_CRASH_AT') == point and str(self.p.root).startswith('/tmp/grokbot1-w1-'):
            os._exit(77)   # test-only hard process death (no cleanup, no commit)

    def binding(self, cookie: str) -> str:
        try:
            return self.ns.mini2._guest_binding(cookie or '', self.ns.public.verify_cookie, self.key)
        except Exception:
            raise ClaimError(403, 'GUEST_CAPABILITY_REQUIRED') from None

    def native_session(self, token):
        """Mirror of native_mount.native_session using the actual native functions."""
        if not isinstance(token, str) or not token or token.startswith('sk-') or len(token) > 16384:
            raise ClaimError(401, 'NATIVE_JWT_REQUIRED')
        payload = self.ns.auth.decode_token(token)
        if not isinstance(payload, dict) or not isinstance(payload.get('id'), str):
            raise ClaimError(401, 'NATIVE_JWT_INVALID')
        uid = payload['id']
        auth, rev, authz = self.ns.auth, self.ns.revocation, self.ns.authz

        def fresh():
            current = auth.decode_token(token)
            if not isinstance(current, dict) or current.get('id') != uid:
                return False
            rev.assert_session_allowed(token, current)
            return authz.current_user({'id': uid}).role in ('user', 'admin')
        try:
            ok = fresh()
        except Exception as error:
            code = getattr(error, 'status_code', 401)
            raise ClaimError(401 if code == 401 else 403, 'NATIVE_SESSION_REVOKED' if code == 401 else 'NATIVE_USER_UNAVAILABLE') from None
        if ok is not True:
            raise ClaimError(401, 'NATIVE_JWT_INVALID')
        session = self.ns.native_mount.NativeSession(uid, hashlib.sha256(token.encode()).hexdigest(),
                                                     float(payload.get('exp', float('inf'))), 'jwt', fresh)
        return session, uid

    # ------------------------------------------------------------------ recent auth (RECENT_AUTH_V1)
    def reauthenticate(self, token, password) -> dict:
        """Fresh re-authentication: genuine native JWT + the account's native password (native
        Auths.authenticate_user). Evidence is server-owned and bound to sha256(JWT) + user id."""
        session, uid = self.native_session(token)
        if not isinstance(password, str) or not password or len(password) > 1024:
            raise ClaimError(422, 'INVALID_REAUTH')
        now = self.now()
        bucket = int(now // REAUTH_WINDOW_SECONDS)
        with closing(connect(self.p.intake)) as db:
            row = db.execute('SELECT used FROM grokbot1_recent_auth_failures WHERE user_id=? AND bucket=?', (uid, bucket)).fetchone()
        if row and row['used'] >= REAUTH_MAX_FAILURES:
            raise ClaimError(429, 'REAUTH_RATE_LIMITED')
        user = self.ns.Users.get_user_by_id(uid)
        verified = self.ns.Auths.authenticate_user(user.email, password) if user is not None and getattr(user, 'email', None) else None
        if verified is None or getattr(verified, 'id', None) != uid:
            with closing(connect(self.p.intake)) as db, immediate(db):
                db.execute('INSERT INTO grokbot1_recent_auth_failures VALUES(?,?,1) ON CONFLICT(user_id,bucket) DO UPDATE SET used=used+1', (uid, bucket))
            raise ClaimError(401, 'RECENT_AUTH_FAILED')
        try:
            fresh = session.revalidate() is True     # session must still be live after the password check
        except Exception:
            fresh = False
        if not fresh:
            raise ClaimError(401, 'NATIVE_SESSION_REVOKED')
        reauth_id = 'ra_' + secrets.token_hex(16)
        token_sha = hashlib.sha256(token.encode()).hexdigest()
        with closing(connect(self.p.intake)) as db, immediate(db):
            db.execute('INSERT INTO grokbot1_recent_auth VALUES(?,?,?,?,?,?)',
                       (reauth_id, uid, token_sha, 'native_password', now, now + REAUTH_WINDOW_SECONDS))
        return dict(schemaVersion=SCHEMA_VERSION, contract='RECENT_AUTH_V1', executionClass=EXECUTION_CLASS,
                    reauthId=reauth_id, method='native_password', userId=uid, verifiedAt=utc(now),
                    expiresAt=utc(now + REAUTH_WINDOW_SECONDS), boundTo='native-jwt-sha256', producer=PRODUCER)

    def _recent_auth(self, uid, token):
        token_sha = hashlib.sha256(token.encode()).hexdigest()
        with closing(connect(self.p.intake)) as db:
            row = db.execute('SELECT * FROM grokbot1_recent_auth WHERE user_id=? AND token_sha256=? AND expires_at>? AND verified_at<=? ORDER BY verified_at DESC LIMIT 1',
                             (uid, token_sha, self.now(), self.now())).fetchone()
        if row is None:
            raise ClaimError(401, 'RECENT_AUTH_REQUIRED', {'reauthHref': OWNER_REAUTH_HREF, 'windowSeconds': REAUTH_WINDOW_SECONDS})
        return dict(row)

    # ------------------------------------------------------------------ provisional
    def _issued(self, cookie: str, intent_id: str):
        from fastapi import HTTPException
        try:
            return self.ns.mini2.resolve_issued_guest_intent(
                request=SimpleNamespace(cookies={GUEST_COOKIE: cookie or ''}), intent_id=intent_id,
                verify_cookie=self.ns.public.verify_cookie, signing_key=self.key,
                db_path=self.p.intake, now=self.now)
        except HTTPException as e:
            raise ClaimError(e.status_code, {403: 'GUEST_CAPABILITY_REQUIRED', 404: 'INTENT_UNAVAILABLE'}.get(e.status_code, 'ISSUER_UNAVAILABLE')) from None

    def _provisional_dto(self, row, receipt=None) -> dict:
        return dict(schemaVersion=SCHEMA_VERSION, contract='PROVISIONAL_COMPANY_V1', executionClass=EXECUTION_CLASS,
                    state='RESTRICTED_PROVISIONAL_ACTIVE', intentId=row['intent_id'],
                    companyId=str(uuid.UUID(hex=row['company_id'])), provisionalProjectId=row['project_id'],
                    projectId=None, requestId=(receipt or {}).get('requestId'),
                    idempotencyKey=(receipt or {}).get('idempotencyKey'), promptDigest=row['prompt_digest'],
                    revision=row['revision'], expiresAt=utc(row['expires']), principalKind='restricted_guest',
                    nativeAuthorityActive=False, capabilities=['progress.read', 'claim.request'],
                    observedAt=utc(self.now()), producer=PRODUCER)

    def bootstrap_provisional(self, cookie: str, intent_id: str) -> dict:
        issued = self._issued(cookie, intent_id)
        receipt, binding = issued.receipt, issued.verified_binding
        expires = datetime.fromisoformat(receipt['expiresAt'].replace('Z', '+00:00')).timestamp()
        mini3 = self.ns.mini3
        with closing(connect(self.p.intake)) as db, immediate(db):
            if db.execute('SELECT 1 FROM revoked_guest_bindings WHERE binding=?', (binding,)).fetchone():
                raise ClaimError(403, 'GUEST_REVOKED')
            if db.execute('SELECT 1 FROM guest_intent_retirements WHERE intent_id=?', (intent_id,)).fetchone():
                raise ClaimError(410, 'INTENT_RETIRED')
            try:
                row = mini3.ProvisionalStore.bootstrap_verified_tx(db, receipt, binding, expires, self.now())
            except mini3.Conflict:
                raise ClaimError(409, 'INTENT_REPLAY_MISMATCH') from None
            except mini3.Denied as e:
                if 'active' in str(e):
                    raise ClaimError(409, 'ACTIVE_PROVISIONAL_EXISTS') from None
                raise ClaimError(410, 'PROVISIONAL_UNAVAILABLE') from None
        return self._provisional_dto(row, receipt)

    # ------------------------------------------------------------------ claim saga
    def _journal(self, txn):
        with closing(connect(self.p.intake)) as db:
            return db.execute('SELECT * FROM grokbot1_claim_journal WHERE txn=?', (txn,)).fetchone()

    def _decision(self, txn):
        with closing(connect(self.p.authority)) as db:
            return db.execute('SELECT * FROM grokbot1_saga_decisions WHERE txn=?', (txn,)).fetchone()

    def claim(self, token, cookie, intent_id, idem_key, expected_revision) -> dict:
        session, uid = self.native_session(token)
        binding = self.binding(cookie)
        if not isinstance(idem_key, str) or not IDEM_RE.fullmatch(idem_key):
            raise ClaimError(422, 'IDEMPOTENCY_KEY_REQUIRED')
        if not isinstance(intent_id, str) or not re.fullmatch(r'[0-9a-f]{40}', intent_id) or type(expected_revision) is not int:
            raise ClaimError(422, 'INVALID_CLAIM')
        digest = sha([intent_id, expected_revision, binding])
        with closing(connect(self.p.intake)) as db:
            prior = db.execute('SELECT * FROM grokbot1_claim_journal WHERE owner_user_id=? AND idem_key=?', (uid, idem_key)).fetchone()
        if prior:
            if not hmac.compare_digest(prior['request_digest'], digest):
                raise ClaimError(409, 'IDEMPOTENCY_CONFLICT')
            if prior['state'] != 'PREPARED' or self._decision(prior['txn']):
                return self._drive(prior['txn'], session)      # decided: replay / roll-forward only
            return self._drive(prior['txn'], session, self._recent_auth(uid, token))
        recent = self._recent_auth(uid, token)                 # fresh re-auth required to grant ownership
        txn = self._prepare(uid, binding, intent_id, idem_key, digest, expected_revision)
        self._crash('after_prepare')
        return self._drive(txn, session, recent)

    def _prepare(self, uid, binding, intent_id, idem_key, digest, expected_revision) -> str:
        now = self.now()
        with closing(connect(self.p.intake)) as db, immediate(db):
            if db.execute('SELECT 1 FROM revoked_guest_bindings WHERE binding=?', (binding,)).fetchone():
                raise ClaimError(403, 'GUEST_REVOKED')
            intent = db.execute('SELECT * FROM guest_intents WHERE intent_id=? AND binding=?', (intent_id, binding)).fetchone()
            prov = db.execute('SELECT * FROM provisional_companies WHERE intent_id=?', (intent_id,)).fetchone()
            if intent is None or prov is None or not hmac.compare_digest(prov['guest_binding'], binding):
                raise ClaimError(404, 'INTENT_UNAVAILABLE')
            live = db.execute("SELECT state FROM grokbot1_claim_journal WHERE intent_id=? AND state IN ('PREPARED','COMMITTED')", (intent_id,)).fetchone()
            if prov['status'] == 'CLAIMED' or (live and live['state'] == 'COMMITTED'):
                raise ClaimError(409, 'ALREADY_CLAIMED')
            if live:
                raise ClaimError(409, 'CLAIM_IN_PROGRESS')
            if (intent['expires'] <= now or prov['status'] != 'PROVISIONAL' or prov['expires'] <= now
                    or db.execute('SELECT 1 FROM guest_intent_retirements WHERE intent_id=?', (intent_id,)).fetchone()):
                raise ClaimError(410, 'PROVISIONAL_EXPIRED_OR_REVOKED')
            if prov['revision'] != expected_revision:
                raise ClaimError(409, 'REVISION_CONFLICT', {'currentRevision': prov['revision']})
            company = str(uuid.UUID(hex=prov['company_id']))
            txn = str(uuid.uuid4())
            try:
                db.execute('INSERT INTO grokbot1_claim_journal(txn,intent_id,guest_binding,owner_user_id,idem_key,request_digest,company_id,boss_bot_id,provisional_revision,state,lease_owner,lease_until,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (txn, intent_id, binding, uid, idem_key, digest, company, str(uuid.uuid5(NS_UUID, company + ':boss')),
                            prov['revision'], 'PREPARED', self.instance, now + self.lease_seconds, now, now))
            except sqlite3.IntegrityError:
                raise ClaimError(409, 'CLAIM_IN_PROGRESS') from None
        return txn

    def _take_lease(self, txn) -> bool:
        now = self.now()
        with closing(connect(self.p.intake)) as db, immediate(db):
            return db.execute("UPDATE grokbot1_claim_journal SET lease_owner=?,lease_until=?,updated=? WHERE txn=? AND state='PREPARED' AND (lease_owner=? OR lease_until<=?)",
                              (self.instance, now + self.lease_seconds, now, txn, self.instance, now)).rowcount == 1

    def _drive(self, txn, session=None, recent=None) -> dict:
        j = self._journal(txn)
        if j['state'] == 'COMMITTED':
            return self._claimed_dto(j)
        if j['state'] == 'ABORTED':
            raise ClaimError(409, 'CLAIM_ABORTED', {'reason': j['abort_reason']})
        found = self._decision(txn)
        if found and found['decision'] == 'COMMIT' and session is None:
            # Native messaging accepts only a genuine native JWT session (actor(): kind=='jwt').
            # Never fabricate one: roll-forward resumes on the owner's next authenticated request.
            raise ClaimError(202, 'AWAITING_OWNER_SESSION')
        if not self._take_lease(txn):
            raise ClaimError(409, 'CLAIM_IN_PROGRESS')
        decision = self._decide(j, session, recent)
        if decision != 'COMMIT':
            reason = self._decision(txn)['reason']
            self._mark_aborted(txn, reason)
            raise ClaimError(409, 'CLAIM_ABORTED', {'reason': reason})
        self._crash('after_decision')
        self._roll_forward(j, session)
        return self._claimed_dto(self._journal(txn))

    def _decide(self, j, session, recent=None) -> str:
        """Commit point. Native-shaped statements identical to company_authority_base.Authority.create
        and company_rbac.Authority.register_bot, plus the decision row, in ONE authority transaction."""
        now, txn, company, uid, boss = self.now(), j['txn'], j['company_id'], j['owner_user_id'], j['boss_bot_id']
        with closing(connect(self.p.authority)) as db, immediate(db):
            found = db.execute('SELECT decision FROM grokbot1_saga_decisions WHERE txn=?', (txn,)).fetchone()
            if found:
                return found['decision']

            def abort(reason):
                db.execute('INSERT INTO grokbot1_saga_decisions(txn,decision,company_id,owner_user_id,reason,decided,decided_by) VALUES(?,?,?,?,?,?,?)',
                           (txn, 'ABORT', company, uid, reason, now, self.instance))
                return 'ABORT'
            if session is None:
                return abort('RECOVERY_PRESUMED_ABORT')
            try:
                fresh = session.revalidate() is True
            except Exception:
                fresh = False
            if not fresh:
                return abort('NATIVE_SESSION_REVOKED_BEFORE_COMMIT')
            if not recent or recent.get('user_id') != uid:
                return abort('RECENT_AUTH_REQUIRED')
            if not (recent['verified_at'] <= now < recent['expires_at']):
                return abort('RECENT_AUTH_EXPIRED_BEFORE_COMMIT')
            if db.execute('SELECT 1 FROM companies WHERE id=?', (company,)).fetchone():
                return abort('COMPANY_ID_COLLISION')
            name = 'DogLove' if 'doglove' in self._prompt(j).lower().replace(' ', '') else 'New company'
            db.execute('INSERT INTO companies VALUES(?,?)', (company, name))
            db.execute("INSERT INTO members VALUES(?,?,?,1,1,?,?)", (company, uid, 'owner', uid, 'person'))
            audit = db.execute('INSERT INTO audit(company_id,actor,action,target,at) VALUES(?,?,?,?,?)', (company, uid, 'create', company, now)).lastrowid
            db.execute("INSERT INTO members VALUES(?,?,?,1,1,?,?)", (company, boss, 'member', 'BOSS', 'bot'))
            db.execute('INSERT INTO audit(company_id,actor,action,target,at) VALUES(?,?,?,?,?)', (company, uid, 'bot.register', boss, now))
            db.execute("INSERT INTO bots(id,kind,owner,name,purpose) VALUES(?,?,?,?,?)", (boss, 'company', company, 'BOSS', 'company-boss'))
            db.execute('INSERT INTO grokbot1_saga_decisions(txn,decision,company_id,owner_user_id,owner_audit_id,reason,decided,decided_by) VALUES(?,?,?,?,?,?,?,?)',
                       (txn, 'COMMIT', company, uid, audit, 'VERIFIED_NATIVE_SESSION+RECENT_AUTH:' + recent['reauth_id'], now, self.instance))
            return 'COMMIT'

    def _mark_aborted(self, txn, reason) -> None:
        with closing(connect(self.p.intake)) as db, immediate(db):
            db.execute("UPDATE grokbot1_claim_journal SET state='ABORTED',abort_reason=?,lease_owner=NULL,lease_until=0,updated=? WHERE txn=? AND state='PREPARED'",
                       (reason, self.now(), txn))

    def _prompt(self, j) -> str:
        with closing(connect(self.p.intake)) as db:
            row = db.execute('SELECT receipt,digest FROM guest_intents WHERE intent_id=?', (j['intent_id'],)).fetchone()
            prov = db.execute('SELECT prompt_digest FROM provisional_companies WHERE intent_id=?', (j['intent_id'],)).fetchone()
        prompt = json.loads(row['receipt'])['originalPrompt']
        if not (hmac.compare_digest(sha(prompt.encode()), row['digest']) and hmac.compare_digest(sha(prompt.encode()), prov['prompt_digest'])):
            raise ClaimError(503, 'ORIGINAL_PROMPT_INTEGRITY')
        return prompt

    def _resources(self):
        rbac, path = self.ns.RbacAuthority, str(self.p.authority)

        def authorize(actor, company, action, channel=None):
            a = rbac(path)
            try:
                a.require_member(actor, company, permission='read' if action == 'read' else 'write')
                return True
            except Exception:
                return False
            finally:
                a.db.close()
        return self.ns.Resources(str(self.p.drive), authorize, lambda rid, data: None, lambda blob: b'')

    def _roll_forward(self, j, session=None) -> None:
        txn, company, uid, boss = j['txn'], j['company_id'], j['owner_user_id'], j['boss_bot_id']
        if session is None or session.user_id != uid:
            raise ClaimError(202, 'AWAITING_OWNER_SESSION')
        sess = session

        def renew():
            if not self._take_lease(txn):
                raise ClaimError(409, 'CLAIM_IN_PROGRESS')
        renew()
        dm = self.store.create(sess, company, f'g1-{txn}-dm', 'dm', 'private', 'BOSS', [], [boss])
        self._crash('after_dm')
        renew()
        room = self.store.create(sess, company, f'g1-{txn}-doglove', 'channel', 'private', 'doglove', [], [boss])
        renew()
        message = self._provenance_message(sess, j, room['id'])
        self._crash('after_message')
        renew()
        project = self._project(j)
        self._crash('after_project')
        d = self._decision(txn)
        receipts = dict(decision='COMMIT', authorityAuditId=d['owner_audit_id'], decidedAt=utc(d['decided']),
                        bossBotId=boss, bossDmRoomId=dm['id'], doglovRoomId=room['id'],
                        originalPromptMessageId=message, projectId=project)
        now = self.now()
        with closing(connect(self.p.intake)) as db, immediate(db):
            cur = db.execute('SELECT state,lease_owner FROM grokbot1_claim_journal WHERE txn=?', (txn,)).fetchone()
            if cur['state'] == 'COMMITTED':
                return
            if cur['state'] != 'PREPARED' or cur['lease_owner'] != self.instance:
                raise ClaimError(409, 'CLAIM_IN_PROGRESS')
            db.execute("UPDATE grokbot1_claim_journal SET state='COMMITTED',receipts=?,lease_owner=NULL,lease_until=0,updated=? WHERE txn=?",
                       (json.dumps(receipts, sort_keys=True), now, txn))
            db.execute("UPDATE provisional_companies SET status='CLAIMED',claimed_owner=?,claimed_at=?,revision=revision+1,claim_token_hash=NULL,claim_expires=NULL,claim_issued_by=NULL WHERE intent_id=? AND status IN ('PROVISIONAL','EXPIRED')",
                       (uid, now, j['intent_id']))
            db.execute('INSERT OR IGNORE INTO guest_intent_retirements VALUES(?,?,?,?)', (j['intent_id'], j['guest_binding'], now, 'CLAIMED'))
            db.execute('INSERT OR IGNORE INTO revoked_guest_bindings VALUES(?,?)', (j['guest_binding'], now))

    def _provenance_message(self, sess, j, room) -> str:
        """Original guest prompt preserved ONCE as a system provenance record — never a human/bot speaker."""
        msg = str(uuid.uuid5(NS_UUID, j['txn'] + ':original-prompt'))
        prompt = self._prompt(j)
        provenance = dict(kind='GUEST_ORIGINAL_PROMPT_CLAIMED_BY_PERSON', authoredBy='anonymous_guest_before_sign_in',
                          intentId=j['intent_id'], promptDigest=sha(prompt.encode()), claimedBy=j['owner_user_id'],
                          sagaTxn=j['txn'], companyId=j['company_id'])
        provenance['hmac'] = sign(self.key, provenance)
        with self.store.access(sess, j['company_id'], room) as (db, member, row):
            if db.execute('SELECT 1 FROM cm_messages WHERE id=?', (msg,)).fetchone():
                return msg
            now, seq = int(self.now() * 1e9), row['seq'] + 1
            db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
                       (msg, 'starli-guest-intake', room, None, prompt, self.sm.encode({'attachments': []}),
                        self.sm.encode({'version': self.sm.VERSION, 'starliProvenance': provenance}), now, now))
            db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,NULL)', (msg, room, seq, 'system', 'starli-guest-intake', 1, '[]', '[]'))
            db.execute('UPDATE cm_rooms SET seq=? WHERE id=?', (seq, room))
            self.store.event(db, room, 'message.created', msg)
        return msg

    def _project(self, j) -> str:
        marker = 'starli-saga:' + j['txn']
        res = self._resources()
        try:
            row = res.db.execute("SELECT id FROM resource WHERE company=? AND owner=? AND kind='project' AND body LIKE ?",
                                 (j['company_id'], j['owner_user_id'], '%' + marker)).fetchone()
            if row:
                return row[0]
            return res.create(j['owner_user_id'], j['company_id'], 'project', 'DogLove', body='DogLove project\n' + marker)
        finally:
            res.db.close()

    def resume(self, token, intent_id) -> dict:
        """Owner-authenticated resume of a COMMIT-decided saga (after a crash) or replay of a finished one."""
        session, uid = self.native_session(token)
        with closing(connect(self.p.intake)) as db:
            j = db.execute("SELECT * FROM grokbot1_claim_journal WHERE intent_id=? AND owner_user_id=? AND state IN ('PREPARED','COMMITTED')", (intent_id, uid)).fetchone()
        if j is None:
            raise ClaimError(404, 'CLAIM_UNAVAILABLE')
        if j['state'] == 'PREPARED':
            d = self._decision(j['txn'])
            if not d or d['decision'] != 'COMMIT':
                raise ClaimError(409, 'CLAIM_IN_PROGRESS')
        return self._drive(j['txn'], session)

    def recover(self) -> list:
        """Operator/worker recovery. Idempotent; safe to run from any process."""
        out = []
        with closing(connect(self.p.intake)) as db:
            rows = db.execute("SELECT txn FROM grokbot1_claim_journal WHERE state='PREPARED' AND lease_until<=?", (self.now(),)).fetchall()
        for (txn,) in rows:
            try:
                out.append({'txn': txn, 'result': self._drive(txn, None)['state']})
            except ClaimError as e:
                out.append({'txn': txn, 'result': e.code})
        return out

    # ------------------------------------------------------------------ DTOs / navigation
    def _claimed_dto(self, j) -> dict:
        r = json.loads(j['receipts']) if j['receipts'] else {}
        return dict(schemaVersion=SCHEMA_VERSION, contract='CLAIMED_NATIVE_COMPANY_V1', executionClass=EXECUTION_CLASS,
                    state='CLAIM_COMMITTED' if j['state'] == 'COMMITTED' else 'CLAIM_' + j['state'], claimId=j['txn'],
                    intentId=j['intent_id'], companyId=j['company_id'], projectId=r.get('projectId'),
                    ownerUserId=j['owner_user_id'], principalKind='verified_registered_person',
                    bossBotId=j['boss_bot_id'], bossDmRoomId=r.get('bossDmRoomId'), channelRoomId=r.get('doglovRoomId'),
                    originalPromptMessageId=r.get('originalPromptMessageId'), idempotencyKey=j['idem_key'],
                    revision=j['provisional_revision'] + (1 if j['state'] == 'COMMITTED' else 0),
                    claimRevision=j['provisional_revision'] + (1 if j['state'] == 'COMMITTED' else 0),
                    nativeReceipts=dict(decision=r.get('decision'), authorityAuditId=r.get('authorityAuditId'), decidedAt=r.get('decidedAt')),
                    observedAt=utc(self.now()), producer=PRODUCER)

    def _nav(self, stage, *, intent_id, company=None, project=None, room=None, dm=None, action=None, href=None, verified=None, extra=None):
        dto = dict(schemaVersion=SCHEMA_VERSION, contract='VERIFIED_ROOM_NAVIGATION_V1', executionClass=EXECUTION_CLASS,
                   stage=stage, intentId=intent_id, companyId=company, projectId=project, roomId=room, dmRoomId=dm,
                   next=dict(action=action, href=href), verifiedBy=verified, observedAt=utc(self.now()),
                   verifiedAt=utc(self.now()) if verified else None, expiresAt=utc(self.now() + NAV_TTL_SECONDS),
                   producer=PRODUCER)
        if extra:
            dto.update(extra)
        dto['proof'] = sign(self.nav_key, dto)
        return dto

    def guest_progress(self, cookie, intent_id) -> dict:
        binding = self.binding(cookie)
        now = self.now()
        with closing(connect(self.p.intake)) as db:
            intent = db.execute('SELECT expires FROM guest_intents WHERE intent_id=? AND binding=?', (intent_id, binding)).fetchone()
            if intent is None:
                raise ClaimError(404, 'INTENT_UNAVAILABLE')
            prov = db.execute('SELECT * FROM provisional_companies WHERE intent_id=? AND guest_binding=?', (intent_id, binding)).fetchone()
            j = db.execute("SELECT * FROM grokbot1_claim_journal WHERE intent_id=? AND state IN ('PREPARED','COMMITTED')", (intent_id,)).fetchone()
            revoked = db.execute('SELECT 1 FROM revoked_guest_bindings WHERE binding=?', (binding,)).fetchone() is not None
        company = str(uuid.UUID(hex=prov['company_id'])) if prov else None
        if (prov and prov['status'] == 'CLAIMED') or (j and j['state'] == 'COMMITTED'):
            return self._nav('CLAIM_COMMITTED', intent_id=intent_id, action='sign_in_as_owner', href='/auth?redirect=/companies')
        if j:
            d = self._decision(j['txn'])
            return self._nav('CLAIM_COMMITTED_MATERIALIZING' if d and d['decision'] == 'COMMIT' else 'CLAIM_PENDING',
                             intent_id=intent_id, action='wait', href=None)
        if revoked:
            return self._nav('EXPIRED_OR_REVOKED', intent_id=intent_id, action='start_new_guest_session')
        if prov is None:
            if intent['expires'] <= now:
                return self._nav('EXPIRED_OR_REVOKED', intent_id=intent_id, action='start_new_guest_session')
            return self._nav('INTENT_ACCEPTED', intent_id=intent_id, action='create_provisional_company')
        if prov['status'] == 'PROVISIONAL' and prov['expires'] > now:
            return self._nav('RESTRICTED_PROVISIONAL_ACTIVE', intent_id=intent_id, company=company,
                             action='sign_in_to_claim', href='/auth?redirect=/claim/' + intent_id,
                             extra={'revision': prov['revision'], 'provisionalProjectId': prov['project_id']})
        return self._nav('EXPIRED_OR_REVOKED', intent_id=intent_id, action='start_new_guest_session')

    def native_readback(self, session, uid, j) -> dict:
        r = json.loads(j['receipts'])
        company = j['company_id']
        rooms = {x['id']: x for x in self.store.rooms(session, company)['rooms']}
        with self.store.db(readonly=True) as db:
            agents = {room: [a[0] for a in db.execute('SELECT agent FROM cm_agents WHERE room=?', (room,))] for room in (r['bossDmRoomId'], r['doglovRoomId'])}
        msgs = self.store.messages(session, company, r['doglovRoomId'])
        msgs = msgs.get('messages', msgs) if isinstance(msgs, dict) else msgs
        provenance = [m for m in msgs if m['id'] == r['originalPromptMessageId']]
        res = self._resources()
        try:
            project = res.get(uid, company, r['projectId'])
        finally:
            res.db.close()
        a = self.ns.RbacAuthority(str(self.p.authority))
        try:
            scope = a.effective(uid, company)
            boss = a.db.execute('SELECT kind,active FROM members WHERE company_id=? AND user_id=?', (company, j['boss_bot_id'])).fetchone()
        finally:
            a.db.close()
        checks = dict(
            ownerRole=scope['role'] == 'owner' and scope['kind'] == 'person',
            bossBotMember=bool(boss and boss[0] == 'bot' and boss[1] == 1),
            dmVisible=r['bossDmRoomId'] in rooms and rooms[r['bossDmRoomId']]['kind'] == 'dm',
            doglovVisible=r['doglovRoomId'] in rooms and rooms[r['doglovRoomId']]['name'] == 'doglove',
            bossInRooms=all(j['boss_bot_id'] in agents[x] for x in agents),
            originalPromptOnce=len(provenance) == 1 and provenance[0]['speaker'] == {'kind': 'system', 'id': 'starli-guest-intake'},
            projectReadable=bool(project) and (project['id'] if isinstance(project, dict) else project[0]) == r['projectId'],
        )
        return checks

    def owner_navigation(self, token, intent_id) -> dict:
        session, uid = self.native_session(token)
        with closing(connect(self.p.intake)) as db:
            j = db.execute("SELECT * FROM grokbot1_claim_journal WHERE intent_id=? AND owner_user_id=? ORDER BY CASE state WHEN 'COMMITTED' THEN 0 WHEN 'PREPARED' THEN 1 ELSE 2 END, updated DESC LIMIT 1",
                           (intent_id, uid)).fetchone()
        if j is None:
            raise ClaimError(404, 'CLAIM_UNAVAILABLE')
        if j['state'] == 'ABORTED':
            return self._nav('CLAIM_ABORTED', intent_id=intent_id, action='retry_claim', extra={'reason': j['abort_reason']})
        if j['state'] == 'PREPARED':
            d = self._decision(j['txn'])
            committed = bool(d and d['decision'] == 'COMMIT')
            return self._nav('CLAIM_COMMITTED_MATERIALIZING' if committed else 'CLAIM_PENDING', intent_id=intent_id,
                             company=j['company_id'] if committed else None,
                             action='resume_claim' if committed and j['lease_until'] <= self.now() else 'wait',
                             href=f'/api/v1/starli/grokbot1/claims/{intent_id}/resume' if committed else None)
        r = json.loads(j['receipts'])
        try:
            checks = self.native_readback(session, uid, j)
        except Exception as error:
            checks = {'error': type(error).__name__ + ':' + str(getattr(error, 'code', error))}
        if all(v is True for v in checks.values()):
            return self._nav('ROOM_READY', intent_id=intent_id, company=j['company_id'], project=r['projectId'],
                             room=r['doglovRoomId'], dm=r['bossDmRoomId'], action='open_room',
                             href=f"/companies/{j['company_id']}/messaging/rooms/{r['doglovRoomId']}",
                             verified='native-store-readback',
                             extra={'checks': checks, 'bossBotId': j['boss_bot_id'], 'claimId': j['txn'],
                                    'claimRevision': j['provisional_revision'] + 1, 'channelRoomId': r['doglovRoomId']})
        return self._nav('CLAIM_COMMITTED_MATERIALIZING', intent_id=intent_id, company=j['company_id'], action='wait', extra={'checks': checks})
