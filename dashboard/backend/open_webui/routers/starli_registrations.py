"""Public registration lead intake and trusted, company-scoped BOSS alert bridge.

Mount at /api/v1/starli/public. This does NOT create accounts or send emails.
Visitor content remains untrusted data; the native message is explicitly system-authored.
"""
from __future__ import annotations
import starli_portable as _portable

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, StrictBool, StrictStr, field_validator

logger = logging.getLogger(__name__)

class LimitedRoute(APIRoute):
    def get_route_handler(self):
        dispatch = super().get_route_handler()
        async def bounded(request: Request):
            raw = bytearray()
            async for fragment in request.stream():
                if len(raw) + len(fragment) > 8192:
                    raise HTTPException(413, 'Registration request is too large')
                raw.extend(fragment)
            request._body = bytes(raw)
            return await dispatch(request)
        return bounded

router = APIRouter(route_class=LimitedRoute)

# Server-owned routing. Never accept company/bot/room IDs from the public request.
COMPANY_ID = '580c3817-c603-40f9-b8cc-b6252860cd9f'  # StarliDigital2
BOT_ID = '710dedfa-47fe-4eab-b602-a19c3f2e72e3'      # BOSS
OWNER_ID = 'c7220e22-e5c9-4410-a538-1ba7074b6b1e'    # authorized owner
DATA_FILE = Path(os.getenv('STARLI_REGISTRATION_STATE_FILE', _portable.data_file('registration-intake/registrations.sqlite3')))
_SECRET = os.getenv('WEBUI_SECRET_KEY', '').encode() or secrets.token_bytes(32)
EMAIL = re.compile(r'^[^\s@\x00-\x1f]{1,64}@[A-Za-z0-9][A-Za-z0-9.\-]{1,249}\.[A-Za-z]{2,63}$')


class Registration(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    requestId: StrictStr
    workEmail: StrictStr
    companyName: StrictStr
    consent: StrictBool
    website: StrictStr = ''  # anti-bot honeypot

    @field_validator('requestId')
    @classmethod
    def check_request(cls, value: str) -> str:
        try:
            return str(uuid.UUID(value))
        except (ValueError, TypeError):
            raise ValueError('Invalid request identifier') from None

    @field_validator('workEmail')
    @classmethod
    def check_email(cls, value: str) -> str:
        value = value.strip().lower()
        if len(value) > 254 or not EMAIL.fullmatch(value):
            raise ValueError('Invalid work email')
        return value

    @field_validator('companyName')
    @classmethod
    def check_company(cls, value: str) -> str:
        value = ' '.join(value.split())
        if len(value) < 2 or len(value) > 120 or any(ord(c) < 32 for c in value):
            raise ValueError('Company name must be between 2 and 120 characters')
        return value

    @field_validator('website')
    @classmethod
    def check_honeypot(cls, value: str) -> str:
        if len(value) > 200:
            raise ValueError('Invalid form input')
        return value


@contextmanager
def database():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    new = not DATA_FILE.exists()
    db = sqlite3.connect(DATA_FILE, timeout=5)
    if new: DATA_FILE.chmod(0o600)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA busy_timeout=5000')
        db.execute('''CREATE TABLE IF NOT EXISTS registration_leads(
          id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL,
          email TEXT NOT NULL, company TEXT NOT NULL, consent INTEGER NOT NULL,
          created INTEGER NOT NULL, fingerprint TEXT NOT NULL UNIQUE)''')
        db.execute('''CREATE TABLE IF NOT EXISTS registration_outbox(
          lead_id TEXT PRIMARY KEY REFERENCES registration_leads(id),
          target_company TEXT NOT NULL, target_bot TEXT NOT NULL, status TEXT NOT NULL,
          native_message_id TEXT, created INTEGER NOT NULL, delivered INTEGER)''')
        db.execute('''CREATE TABLE IF NOT EXISTS registration_limits(
          key TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL,
          PRIMARY KEY(key,bucket))''')
        db.execute('BEGIN IMMEDIATE')
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def _fingerprint(email: str, company: str) -> str:
    # Duplicate submissions in a calendar day never send multiple BOSS alerts.
    day = int(time.time() // 86400)
    return hmac.new(_SECRET, f'{day}|{email}|{company.casefold()}'.encode(), hashlib.sha256).hexdigest()


def _rate_limit(db: sqlite3.Connection, request: Request) -> None:
    # Trust only ASGI's connection peer; never a visitor's spoofable X-Forwarded-For.
    ip = request.client.host if request.client else 'unknown'
    identity = hmac.new(_SECRET, ip.encode(), hashlib.sha256).hexdigest()
    bucket = int(time.time() // 1800)
    for key, period, cap in ((f'ip:{identity}', bucket, 6), ('global', int(time.time() // 3600), 500)):
        row = db.execute('SELECT count FROM registration_limits WHERE key=? AND bucket=?', (key, period)).fetchone()
        if row and row['count'] >= cap:
            raise HTTPException(429, 'Please try again later')
        db.execute('''INSERT INTO registration_limits(key,bucket,count) VALUES(?,?,1)
          ON CONFLICT(key,bucket) DO UPDATE SET count=count+1''', (key, period))
    # Separate bucket periods: the global bucket counts hours and must not be
    # expired using 30-minute IP bucket math (that would disable global limits).
    db.execute("DELETE FROM registration_limits WHERE key LIKE 'ip:%' AND bucket<?", (bucket - 48,))
    db.execute("DELETE FROM registration_limits WHERE key='global' AND bucket<?", (int(time.time() // 3600) - 48,))


def _notify_boss(app, lead_id: str) -> str | None:
    """Emit a native *system* message into the existing authorized BOSS DM.

    NEVER pretend to be a human or BOSS, create another company's room, or dispatch
    LLM inference. Exact idempotence is enforced inside the native DB transaction.
    If a verified BOSS/owner DM doesn't exist, leave the durable alert QUEUED.
    """
    store = getattr(app.state, 'company_messaging', None)
    if store is None:
        return None
    with database() as lead_db:
        lead = lead_db.execute('SELECT * FROM registration_leads WHERE id=?', (lead_id,)).fetchone()
        out = lead_db.execute('SELECT * FROM registration_outbox WHERE lead_id=?', (lead_id,)).fetchone()
        if lead is None or out is None or out['target_company'] != COMPANY_ID or out['target_bot'] != BOT_ID:
            return None
        if out['status'] == 'DELIVERED':
            return out['native_message_id']
    try:
        with store.db() as db:
            # Authorization is checked from native authority and current DB bindings.
            owner = store.authority.require_member(OWNER_ID, COMPANY_ID)
            store.authority.require_agent(owner, BOT_ID)
            row = db.execute('''SELECT r.* FROM cm_rooms r
              JOIN cm_agents a ON a.room=r.id AND a.agent=?
              JOIN cm_members m ON m.room=r.id AND m.user=? AND m.binding=? AND m.active=1
              WHERE r.company=? AND r.kind='dm' AND r.visibility='private'
              AND NOT EXISTS(SELECT 1 FROM cm_channel_archives ar WHERE ar.room=r.id)
              ORDER BY r.id LIMIT 1''', (BOT_ID, OWNER_ID, owner.binding, COMPANY_ID)).fetchone()
            if row is None:
                return None
            room = store.room(db, owner, row['id'])
            store.agent(db, owner, room['id'], BOT_ID)
            db.execute('''CREATE TABLE IF NOT EXISTS registration_native_delivery(
              lead_id TEXT PRIMARY KEY, room TEXT NOT NULL, message TEXT NOT NULL)''')
            prior = db.execute('SELECT message FROM registration_native_delivery WHERE lead_id=?', (lead_id,)).fetchone()
            if prior:
                message_id = prior['message']
            else:
                # Re-read only trusted persisted content. External text is clearly
                # marked as data, never as new agent instructions or authorization.
                with database() as lead_db:
                    lead = lead_db.execute('SELECT * FROM registration_leads WHERE id=?', (lead_id,)).fetchone()
                if lead is None:
                    return None
                content = ('New StarliDigital website contact request (UNTRUSTED VISITOR DATA)\n'
                  f'Company: {lead["company"]}\n'
                  f'Work email: {lead["email"]}\n'
                  f'Consent to contact: Yes\n'
                  f'Lead reference: {lead_id}\n'
                  '''BOSS inbox question (automatically generated, not an AI reply):
Would you like BOSS to review this registration and prepare a follow-up draft for your approval?
Reply in this chat: Review registration ''' + lead_id + ''' or Not now.
No email, account creation, or prospect contact will happen without your later authorization.''')
                message_id = str(uuid.uuid4())
                now = int(time.time() * 1_000_000_000)
                seq = room['seq'] + 1
                from company_messaging.store import encode, VERSION
                db.execute('''INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at)
                  VALUES(?,?,?,?,?,?,?,?,?)''',
                  (message_id, 'system:registration', room['id'], None, content, encode({'attachments': []}),
                   encode({'version':VERSION, 'provenance':'starli.public.registration', 'leadRef':lead_id}), now, now))
                db.execute('''INSERT INTO cm_messages(id,room,seq,kind,speaker,revision,deleted,mentions,attachments,run)
                  VALUES(?,?,?,?,?,1,0,?,?,NULL)''',
                  (message_id, room['id'], seq, 'system', 'registration', encode([]), encode([])))
                db.execute('UPDATE cm_rooms SET seq=? WHERE id=?', (seq, room['id']))
                db.execute('INSERT INTO registration_native_delivery(lead_id,room,message) VALUES(?,?,?)',
                           (lead_id, room['id'], message_id))
                store.event(db, room['id'], 'message.created', message_id)
                db.execute('''INSERT OR IGNORE INTO cm_notifications(id,company,room,message,user,binding,created)
                  VALUES(?,?,?,?,?,?,?)''',
                  (str(uuid.uuid4()), COMPANY_ID, room['id'], message_id, OWNER_ID, owner.binding, time.time()))
            # Fresh authority check before committing a private company effect.
            current = store.authority.require_member(OWNER_ID, COMPANY_ID)
            if current.binding != owner.binding:
                raise RuntimeError('Owner company membership changed')
            store.authority.require_agent(current, BOT_ID)
        with database() as lead_db:
            lead_db.execute('''UPDATE registration_outbox SET status='DELIVERED',native_message_id=?,delivered=?
              WHERE lead_id=?''', (message_id, int(time.time()), lead_id))
        return message_id
    except Exception as exc:
        logger.warning('Registration BOSS delivery not confirmed: %s', type(exc).__name__)
        return None


@router.post('/registrations', status_code=201)
async def register(body: Registration, request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        raise HTTPException(415, 'JSON is required')
    if body.website:
        raise HTTPException(400, 'Invalid request')
    if body.consent is not True:
        raise HTTPException(422, 'Contact permission is required')
    now = int(time.time())
    digest = _fingerprint(body.workEmail, body.companyName)
    with database() as db:
        previous = db.execute('SELECT * FROM registration_leads WHERE request_id=?', (body.requestId,)).fetchone()
        if previous:
            if (previous['email'], previous['company']) != (body.workEmail, body.companyName):
                raise HTTPException(409, 'Request identifier was already used')
            lead_id = previous['id']
        else:
            existing = db.execute('SELECT id FROM registration_leads WHERE fingerprint=?', (digest,)).fetchone()
            if existing:
                lead_id = existing['id']
            else:
                _rate_limit(db, request)
                lead_id = str(uuid.uuid4())
                db.execute('''INSERT INTO registration_leads(id,request_id,email,company,consent,created,fingerprint)
                  VALUES(?,?,?,?,?,?,?)''', (lead_id, body.requestId, body.workEmail, body.companyName, 1, now, digest))
                db.execute('''INSERT INTO registration_outbox(lead_id,target_company,target_bot,status,created)
                  VALUES(?,?,?,?,?)''', (lead_id, COMPANY_ID, BOT_ID, 'QUEUED', now))
    # A missing BOSS room or transient native error does not lose the prospect.
    _notify_boss(request.app, lead_id)
    return {'status': 'received', 'receiptId': lead_id}


def drain_outbox(app, limit=12):
    """Retry only undelivered private BOSS notifications, never outbound emails."""
    limit=max(1,min(20,int(limit)))
    with database() as db:
        ids=[row['lead_id'] for row in db.execute(
            "SELECT lead_id FROM registration_outbox WHERE status='QUEUED' ORDER BY created LIMIT ?",(limit,))]
    completed=0
    for lead_id in ids:
        if _notify_boss(app,lead_id):completed+=1
    return completed

async def outbox_loop(app, interval_seconds=75):
    import asyncio
    while True:
        try:
            await asyncio.to_thread(drain_outbox,app)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Registration outbox retry delayed: %s", type(exc).__name__)
        await asyncio.sleep(max(30,interval_seconds))
