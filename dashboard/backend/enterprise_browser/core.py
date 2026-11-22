"""Opt-in company browser. Authority and browser registration are host-owned.

No legacy user/admin session is borrowed. A durable journal is mandatory so a
lost response or process restart never repeats an uncertain browser effect.
"""
import asyncio
import hashlib
import inspect
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass


class Fault(Exception):
    def __init__(self, code, status=403):
        self.code, self.status = code, status
        super().__init__(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


async def invoke(fn, *args):
    value = fn(*args)
    return await value if inspect.isawaitable(value) else value


@dataclass(frozen=True)
class Scope:
    company: str
    user: str
    bot: str
    room: str
    run: str
    assistant: str
    membership: str
    revision: int

    def __post_init__(self):
        if any(not isinstance(v, str) or not 1 <= len(v) <= 180 for k, v in asdict(self).items() if k != 'revision') or type(self.revision) is not int or self.revision < 1:
            raise Fault('BROWSER_NATIVE_SCOPE_REQUIRED')

    @property
    def key(self):
        return digest(asdict(self))


READS = {'status', 'read', 'observe'}
EFFECTS = {'navigate', 'click', 'type', 'key', 'scroll', 'close'}


def arguments(action, args):
    if type(args) is not dict or not isinstance(action, str):
        raise Fault('BROWSER_ARGUMENTS_INVALID', 422)
    fields = {'navigate': {'url'}, 'click': {'x', 'y'}, 'type': {'text'}, 'key': {'key'}, 'scroll': {'direction'}}.get(action, set())
    if not isinstance(action, str) or action not in READS | EFFECTS or set(args) != fields:
        raise Fault('BROWSER_ARGUMENTS_INVALID', 422)
    if action == 'navigate' and (not isinstance(args['url'], str) or not 1 <= len(args['url']) <= 2048):
        raise Fault('BROWSER_URL_INVALID', 422)
    if action == 'click' and any(type(args[k]) is not int or not 0 <= args[k] <= 5000 for k in ('x', 'y')):
        raise Fault('BROWSER_COORDINATES_INVALID', 422)
    if action == 'type' and (not isinstance(args['text'], str) or not 1 <= len(args['text']) <= 2000):
        raise Fault('BROWSER_TEXT_INVALID', 422)
    if action == 'key' and args['key'] not in ('Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown'):
        raise Fault('BROWSER_KEY_INVALID', 422)
    if action == 'scroll' and args['direction'] not in ('up', 'down'):
        raise Fault('BROWSER_SCROLL_INVALID', 422)


class BrowserAdapter:
    def __init__(self, journal, *, authorize, registration):
        self.authorize, self.registration = authorize, registration
        self.journal = str(journal)
        self.locks, self.sessions = {}, {}
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS browser_actions(scope TEXT, action TEXT, fingerprint TEXT, state TEXT, receipt TEXT, PRIMARY KEY(scope,action))')
        os.chmod(self.journal, 0o600)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.journal, timeout=3)
        try:
            with db:
                yield db
        finally:
            db.close()

    async def check(self, scope, permission):
        if not isinstance(scope, Scope) or await invoke(self.authorize, scope, permission) is not True:
            raise Fault('BROWSER_AUTHORITY_DENIED')

    async def capability(self, scope):
        await self.check(scope, 'view')
        registered = await invoke(self.registration, scope)
        control = False
        if registered is not None:
            control = await invoke(self.authorize, scope, 'control') is True
        await self.check(scope, 'view')
        return {'version': 'starli.browser.v1', 'scope': asdict(scope), 'available': registered is not None,
                'view': registered is not None, 'control': control, 'transport': 'jpeg-poll', 'vision': False}

    async def execute(self, scope, action, args, *, action_id=None, frame_id=None):
        arguments(action, args)
        permission = 'control' if action in EFFECTS else 'view'
        await self.check(scope, permission)
        driver = await invoke(self.registration, scope)
        if driver is None:
            raise Fault('BROWSER_NOT_REGISTERED', 503)
        async with self.locks.setdefault(scope.key, asyncio.Lock()):
            await self.check(scope, permission)
            session = self.sessions.get(scope.key)
            if session is not None and session['driver'] is not driver:
                raise Fault('BROWSER_REGISTRATION_CHANGED', 409)
            fingerprint = digest([action, args, frame_id])
            if action in EFFECTS:
                try:
                    if str(uuid.UUID(action_id)) != action_id:
                        raise ValueError()
                except (ValueError, TypeError, AttributeError):
                    raise Fault('BROWSER_ACTION_UUID_REQUIRED', 422) from None
                with self.db() as db:
                    old = db.execute('SELECT fingerprint,state,receipt FROM browser_actions WHERE scope=? AND action=?', (scope.key, action_id)).fetchone()
                if old:
                    if old[0] != fingerprint:
                        raise Fault('BROWSER_ACTION_ID_COLLISION', 409)
                    if old[1] != 'COMPLETED':
                        raise Fault('BROWSER_ACTION_UNCERTAIN_NO_REPLAY', 409)
                    return json.loads(old[2])
                if action != 'navigate' and (session is None or frame_id != session['frame']):
                    raise Fault('BROWSER_STALE_FRAME', 409)
                if action == 'navigate' and session and frame_id != session['frame']:
                    raise Fault('BROWSER_STALE_FRAME', 409)
                if action == 'navigate' and not session and frame_id is not None:
                    raise Fault('BROWSER_STALE_FRAME', 409)
                with self.db() as db:
                    db.execute('INSERT INTO browser_actions VALUES(?,?,?,?,NULL)', (scope.key, action_id, fingerprint, 'INTENT'))
            try:
                await self.check(scope, permission)
                # Driver performs only the fixed action; no caller JS/selectors/argv.
                frame = await invoke(driver.perform, scope, action, args)
                await self.check(scope, permission)
                if not isinstance(frame, dict) or set(frame) != {'available', 'url', 'title', 'image', 'text'}:
                    raise Fault('BROWSER_FRAME_INVALID', 502)
                if type(frame['available']) is not bool or any(not isinstance(frame[k], str) for k in ('url', 'title', 'image', 'text')) or len(frame['text']) > 8000 or len(frame['image']) > 8_000_000:
                    raise Fault('BROWSER_FRAME_INVALID', 502)
                seq = (session or {}).get('seq', 0) + 1
                next_id = str(uuid.uuid4())
                self.sessions[scope.key] = {'driver': driver, 'seq': seq, 'frame': next_id}
                result = {'version': 'starli.browser.v1', 'scope': asdict(scope), 'frameId': next_id, 'sequence': seq, 'actionId': action_id, **frame}
                if action in EFFECTS:
                    with self.db() as db:
                        db.execute("UPDATE browser_actions SET state='COMPLETED',receipt=? WHERE scope=? AND action=?", (json.dumps(result), scope.key, action_id))
                return result
            except BaseException:
                # INTENT deliberately persists after cancellation, timeout, lost reply,
                # revocation or crash. It cannot be resumed as a fresh action.
                raise
