"""Customer credentials and admission receipts; never a conversation/runtime store."""
from __future__ import annotations
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass

SCOPES = frozenset({'bots:read','conversations:read','messages:send','runs:read','runs:cancel'})
TOKEN = re.compile(r'^stli_([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$')

class CustomerError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message
        super().__init__(code)

def reject(status, code, message):
    raise CustomerError(status, code, message)

@dataclass(frozen=True)
class Principal:
    owner_id: str
    token_id: str

class Store:
    """account(owner)->active bool; owned_bots(owner)->fresh canonical ID set.

    Callbacks MUST query authoritative stores each time. No authorization cache.
    The runtime must use check() for every admission, tool and delivery fence.
    """
    def __init__(self, path, account, owned_bots, clock=time.time, *, personal_bots=None):
        self.path, self.account, self.owned_bots, self.clock = str(path), account, owned_bots, clock
        # Preserve existing all_owned grants when shared bots are added. Shared
        # access requires an explicit selected-bot grant; no silent token widening.
        self.personal_bots=personal_bots or owned_bots
        with self.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS customer_tokens (
              id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
              verifier TEXT NOT NULL, scopes TEXT NOT NULL, bots TEXT,
              created INTEGER NOT NULL, expires INTEGER NOT NULL,
              used INTEGER, revoked INTEGER);
            CREATE INDEX IF NOT EXISTS customer_tokens_owner ON customer_tokens(owner);
            CREATE TABLE IF NOT EXISTS customer_operations (
              id TEXT PRIMARY KEY, owner TEXT NOT NULL, token_id TEXT NOT NULL,
              key TEXT NOT NULL, fingerprint TEXT NOT NULL, bot TEXT NOT NULL,
              conversation TEXT NOT NULL, parent TEXT, state TEXT NOT NULL,
              turn_id TEXT NOT NULL, user_message_id TEXT NOT NULL,
              assistant_message_id TEXT NOT NULL, run_id TEXT,
              created INTEGER NOT NULL, UNIQUE(owner,token_id,key));
            CREATE UNIQUE INDEX IF NOT EXISTS customer_conversation_admission
              ON customer_operations(conversation) WHERE state IN ('admitting','accepted','uncertain');
            CREATE TABLE IF NOT EXISTS customer_audit (
              seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
              owner TEXT NOT NULL, token_id TEXT NOT NULL, operation_id TEXT,
              action TEXT NOT NULL);
            ''')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA busy_timeout=5000')
        try:
            yield db
        finally:
            db.close()

    def active(self, owner):
        if not self.account(owner):
            reject(401,'invalid_api_key','Credential is no longer authorized.')

    @staticmethod
    def metadata(row):
        return {'id':row['id'],'name':row['name'],'scopes':json.loads(row['scopes']),
                'botAccess':{'mode':'all_owned'} if row['bots'] is None else
                    {'mode':'selected','botIds':json.loads(row['bots'])},
                'createdAt':row['created'],'expiresAt':row['expires'],
                'lastUsedAt':row['used'],'revokedAt':row['revoked']}

    def create(self, owner, name, scopes, bot_ids, expires):
        # Caller must enforce a real native session, CSRF/origin policy and rate limit.
        self.active(owner)
        now=int(self.clock())
        if not isinstance(name,str) or not 1<=len(name.strip())<=100:
            reject(422,'invalid_name','Use a token name of 1–100 characters.')
        if not isinstance(scopes,list) or not scopes or any(not isinstance(s,str) for s in scopes) or not set(scopes)<=SCOPES:
            reject(422,'invalid_scopes','Select supported customer scopes.')
        if type(expires) is not int or not now < expires <= now+366*86400:
            reject(422,'invalid_expiration','Expiration must be within 366 days.')
        if bot_ids is not None:
            if not isinstance(bot_ids,list) or not bot_ids or len(bot_ids)>1000 or any(not isinstance(b,str) or not b or len(b)>128 for b in bot_ids):
                reject(422,'invalid_bot_access','Select at least one owned bot.')
            if not set(bot_ids)<=set(self.owned_bots(owner)):
                reject(404,'bot_not_found','Bot not found.')
        ident=uuid.uuid4().hex
        secret='stli_'+ident+'.'+secrets.token_urlsafe(32)
        verifier=hashlib.sha256(secret.encode()).hexdigest()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                self.active(owner)
                if bot_ids is not None and not set(bot_ids)<=set(self.owned_bots(owner)):
                    reject(404,'bot_not_found','Bot not found.')
                if db.execute('SELECT count(*) FROM customer_tokens WHERE owner=? AND revoked IS NULL AND expires>?',(owner,now)).fetchone()[0]>=100:
                    reject(429,'token_limit','Revoke an existing token first.')
                db.execute('INSERT INTO customer_tokens VALUES(?,?,?,?,?,?,?,?,?,?)',
                    (ident,owner,name.strip(),verifier,json.dumps(sorted(set(scopes))),
                     None if bot_ids is None else json.dumps(sorted(set(bot_ids))),now,expires,None,None))
                result=self.metadata(db.execute('SELECT * FROM customer_tokens WHERE id=?',(ident,)).fetchone())
                db.execute('INSERT INTO customer_audit(at,owner,token_id,action) VALUES(?,?,?,?)',(now,owner,ident,'token.created'))
                db.commit()
            except BaseException:
                db.rollback();raise
        return {**result,'token':secret}

    def list(self, owner):
        self.active(owner)
        with self.db() as db:
            return [self.metadata(r) for r in db.execute('SELECT * FROM customer_tokens WHERE owner=? ORDER BY created,id',(owner,))]

    def revoke(self, owner, ident):
        self.active(owner)
        with self.db() as db:
            result=db.execute('UPDATE customer_tokens SET revoked=COALESCE(revoked,?) WHERE owner=? AND id=?',(int(self.clock()),owner,ident))
            if not result.rowcount:reject(404,'token_not_found','Token not found.')
            db.execute('INSERT INTO customer_audit(at,owner,token_id,action) VALUES(?,?,?,?)',(int(self.clock()),owner,ident,'token.revoked'))

    def authenticate(self, bearer):
        match=TOKEN.fullmatch(bearer) if isinstance(bearer,str) and len(bearer)<200 else None
        ident=match[1] if match else ''
        digest=hashlib.sha256((bearer if match else '').encode()).hexdigest()
        with self.db() as db:
            row=db.execute('SELECT * FROM customer_tokens WHERE id=?',(ident,)).fetchone()
            valid=hmac.compare_digest(digest,row['verifier'] if row else '0'*64)
            if not valid or row is None:reject(401,'invalid_api_key','Invalid customer credential.')
            principal=Principal(row['owner'],ident)
            self._check_row(row,principal)
            db.execute('UPDATE customer_tokens SET used=? WHERE id=?',(int(self.clock()),ident))
            return principal

    def _check_row(self, row, principal, scope=None, bot=None):
        if not row or row['owner']!=principal.owner_id or row['revoked'] is not None or row['expires']<=self.clock():
            reject(401,'invalid_api_key','Credential is no longer authorized.')
        self.active(principal.owner_id)
        if scope is not None and scope not in json.loads(row['scopes']):
            reject(403,'insufficient_scope','Credential does not grant this operation.')
        permitted=self.personal_bots if row['bots'] is None else self.owned_bots
        if bot is not None and (bot not in set(permitted(principal.owner_id)) or
                (row['bots'] is not None and bot not in json.loads(row['bots']))):
            reject(404,'bot_not_found','Bot not found.')
        return row

    def check(self, principal, scope=None, bot=None):
        with self.db() as db:
            return self._check_row(db.execute('SELECT * FROM customer_tokens WHERE id=?',(principal.token_id,)).fetchone(),principal,scope,bot)

    def accessible_bots(self, principal):
        row=self.check(principal,'bots:read')
        owned=set((self.personal_bots if row['bots'] is None else self.owned_bots)(principal.owner_id))
        return sorted(owned if row['bots'] is None else owned & set(json.loads(row['bots'])))

    def admit(self, principal, key, bot, conversation, parent, content, *, automatic_parent=False):
        """Reserve once BEFORE native append. Crash/uncertainty requires reconciliation.

        Native CAS is still authoritative against frontend writers. This admission
        index only serializes API submissions; it does not replace native locking.
        """
        if not isinstance(key,str) or not re.fullmatch(r'[\x21-\x7e]{1,128}',key):
            reject(400,'idempotency_key_required','Supply an Idempotency-Key of 1–128 visible ASCII characters.')
        fingerprint=hashlib.sha256(json.dumps([bot,conversation,{'serverCurrent':True} if automatic_parent else parent,content],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                self._check_row(db.execute('SELECT * FROM customer_tokens WHERE id=?',(principal.token_id,)).fetchone(),principal,'messages:send',bot)
                old=db.execute('SELECT * FROM customer_operations WHERE owner=? AND token_id=? AND key=?',(principal.owner_id,principal.token_id,key)).fetchone()
                if old:
                    if old['fingerprint']!=fingerprint:reject(409,'idempotency_conflict','Key was used for different input.')
                    db.commit();return dict(old),False
                ident=uuid.uuid4().hex
                ids=[str(uuid.uuid4()) for _ in range(3)]
                try:
                    db.execute('INSERT INTO customer_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (ident,principal.owner_id,principal.token_id,key,fingerprint,bot,conversation,parent,'admitting',*ids,None,int(self.clock())))
                except sqlite3.IntegrityError:
                    reject(409,'conversation_busy','Conversation already has an unresolved API submission.')
                result=dict(db.execute('SELECT * FROM customer_operations WHERE id=?',(ident,)).fetchone())
                db.execute('INSERT INTO customer_audit(at,owner,token_id,operation_id,action) VALUES(?,?,?,?,?)',
                    (int(self.clock()),principal.owner_id,principal.token_id,ident,'operation.admitting'))
                db.commit();return result,True
            except BaseException:
                db.rollback();raise

    def transition(self, ident, expected, state, run_id=None, native_ids=None):
        allowed={('admitting','accepted'),('admitting','rejected'),('admitting','uncertain'),('accepted','terminal'),('uncertain','accepted'),('uncertain','terminal')}
        if (expected,state) not in allowed:raise ValueError('Invalid admission transition')
        if state=='accepted' and not run_id:raise ValueError('Accepted admission requires canonical run ID')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                if not db.execute('UPDATE customer_operations SET state=?,run_id=COALESCE(?,run_id) WHERE id=? AND state=?',(state,run_id,ident,expected)).rowcount:
                    reject(409,'operation_state_conflict','Reconcile the recorded operation before proceeding.')
                if native_ids is not None:
                    if state!='accepted' or any(not isinstance(native_ids.get(k),str) or not 1<=len(native_ids[k])<=180 for k in ('runId','userMessageId','assistantMessageId')):
                        raise ValueError('Canonical native receipt required')
                    db.execute('UPDATE customer_operations SET turn_id=?,user_message_id=?,assistant_message_id=? WHERE id=?',(native_ids['runId'],native_ids['userMessageId'],native_ids['assistantMessageId'],ident))
                row=db.execute('SELECT owner,token_id FROM customer_operations WHERE id=?',(ident,)).fetchone()
                db.execute('INSERT INTO customer_audit(at,owner,token_id,operation_id,action) VALUES(?,?,?,?,?)',
                    (int(self.clock()),row['owner'],row['token_id'],ident,'operation.'+state))
                db.commit()
            except BaseException:
                db.rollback();raise

    def operation(self, principal, ident):
        with self.db() as db:
            row=db.execute('SELECT * FROM customer_operations WHERE id=? AND owner=?',(ident,principal.owner_id)).fetchone()
            if row is None:reject(404,'operation_not_found','Operation not found.')
            self.check(principal,'runs:read',row['bot'])
            return dict(row)

    def accepted_for_conversation(self,principal,conversation):
        self.check(principal,'messages:send')
        with self.db() as db:
            row=db.execute("SELECT * FROM customer_operations WHERE owner=? AND conversation=? AND state='accepted'",(principal.owner_id,conversation)).fetchone()
        if row is not None:self.check(principal,'messages:send',row['bot'])
        return dict(row) if row is not None else None
