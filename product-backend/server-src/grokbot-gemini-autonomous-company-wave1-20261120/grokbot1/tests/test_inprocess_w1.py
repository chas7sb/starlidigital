"""grokbot1 W1 in-process suite: real candidate ASGI app (native v33 modules, disposable DBs).
Execution class NATIVE_NONPRODUCTION. Accounts are SYNTHETIC_DISPOSABLE_NATIVE_USER rows."""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flow import Flow, PROMPT  # noqa: E402

ROOT = tempfile.mkdtemp(prefix='grokbot1-w1-inproc-', dir='/tmp')


def q(path, sql, args=()):
    with sqlite3.connect(str(path)) as db:
        return db.execute(sql, args).fetchall()


class InProcess(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from grokbot1_routes import build_candidate_app
        import native_harness as h
        import grokbot1_claim as gc
        cls.h, cls.gc = h, gc
        cls.app, cls.svc, cls.ns = build_candidate_app(ROOT)
        cls.f = Flow(cls.app)
        cls.p = cls.ns.paths
        cls.n = 0

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(ROOT, ignore_errors=True)

    def user(self, name=None):
        name = name or 'user-' + uuid.uuid4().hex[:10]
        self.h.create_disposable_native_user(self.ns, name, name)
        return name, self.h.mint_native_jwt(self.ns, name)

    def guest_with_provisional(self):
        g = self.f.guest_cookie()
        r = self.f.intent(g, 'req-' + uuid.uuid4().hex[:12]); self.assertEqual(r.status_code, 201, r.text)
        i = r.json()['intentId']
        r = self.f.provisional(g, i); self.assertEqual(r.status_code, 201, r.text)
        return g, i, r.json()

    def claimed(self):
        g, i, prov = self.guest_with_provisional()
        uid, tok = self.user()
        r = self.f.claim(g, tok, i, prov['revision'], 'key-' + uuid.uuid4().hex)
        self.assertEqual(r.status_code, 200, r.text)
        return g, i, prov, uid, tok, r.json()

    # 1
    def test_01_native_and_vendor_pins_and_mini2_schema_identity(self):
        pins = self.h.verify_pins()
        self.assertEqual(len(pins), len(self.h.NATIVE_PINS) + len(self.h.VENDOR_PINS))
        g = self.f.guest_cookie(); self.assertEqual(self.f.intent(g, 'req-schema-0001').status_code, 201)
        live = {r[0] for r in q(self.p.intake, "SELECT sql FROM sqlite_master WHERE name IN ('guest_intents','revoked_guest_bindings','guest_intent_limits','guest_intent_audiences','guest_intent_retirements','idx_guest_intents_binding')")}
        mine = {s.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TABLE').replace('CREATE INDEX IF NOT EXISTS', 'CREATE INDEX') for s in self.gc.MINI2_SCHEMA}
        self.assertEqual(live, mine)

    # 2
    def test_02_happy_path_room_ready_native_readback(self):
        g, i, prov, uid, tok, c = self.claimed()
        self.assertEqual(c['state'], 'CLAIM_COMMITTED'); self.assertEqual(c['companyId'], prov['companyId'])
        nav = self.f.navigation(tok, i).json()
        self.assertEqual(nav['stage'], 'ROOM_READY', nav)
        self.assertTrue(all(nav['checks'].values()))
        self.assertTrue(self.gc.verify_navigation(nav, self.svc.nav_key))
        forged = dict(nav, roomId=str(uuid.uuid4())); self.assertFalse(self.gc.verify_navigation(forged, self.svc.nav_key))
        rooms = self.f.native_rooms(tok, c['companyId']).json()['rooms']
        self.assertEqual(sorted((r['kind'], r['name']) for r in rooms), [('channel', 'doglove'), ('dm', 'BOSS')])
        msgs = self.f.c.get(f"/api/v1/starli/companies/{c['companyId']}/messaging/rooms/{c['channelRoomId']}/messages", headers={'authorization': 'Bearer ' + tok}).json()
        msgs = msgs.get('messages', msgs)
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0]['speaker'], {'kind': 'system', 'id': 'starli-guest-intake'})
        self.assertEqual(msgs[0]['content'], PROMPT)
        # original prompt exactly once in native message table; no human message fabricated
        self.assertEqual(q(self.p.main, 'SELECT count(*) FROM message WHERE content=? AND channel_id IN (SELECT id FROM cm_rooms WHERE company=?)', (PROMPT, c['companyId']))[0][0], 1)
        self.assertEqual(q(self.p.main, "SELECT count(*) FROM cm_messages m JOIN cm_rooms r ON r.id=m.room WHERE r.company=? AND m.kind='human'", (c['companyId'],))[0][0], 0)
        self.assertEqual(q(self.p.authority, "SELECT role,kind FROM members WHERE company_id=? ORDER BY kind", (c['companyId'],)), [('member', 'bot'), ('owner', 'person')])
        self.assertEqual(q(self.p.intake, 'SELECT status,claimed_owner FROM provisional_companies WHERE intent_id=?', (i,)), [('CLAIMED', uid)])
        self.assertEqual(self.f.progress(g, i).json()['stage'], 'CLAIM_COMMITTED')
        # guest capability retired after claim: issuer refuses the old guest binding
        self.assertEqual(self.f.c.get(f'/api/v1/starli/public/grokbot1/intents/{i}', headers=self.f.h(g, csrf=None, origin=None)).status_code, 403)

    # 3
    def test_03_same_key_replay_one_intent_one_provisional(self):
        g = self.f.guest_cookie()
        a = self.f.intent(g, 'req-replay-0001'); b = self.f.intent(g, 'req-replay-0001')
        self.assertEqual((a.status_code, b.status_code), (201, 200)); self.assertEqual(a.json()['intentId'], b.json()['intentId'])
        self.assertEqual(self.f.intent(g, 'req-replay-0001', prompt='different').status_code, 409)
        i = a.json()['intentId']
        p1 = self.f.provisional(g, i).json(); p2 = self.f.provisional(g, i).json()
        self.assertEqual(p1['companyId'], p2['companyId'])
        self.assertEqual(q(self.p.intake, 'SELECT count(*) FROM guest_intents WHERE intent_id=?', (i,))[0][0], 1)
        self.assertEqual(q(self.p.intake, 'SELECT count(*) FROM provisional_companies WHERE intent_id=?', (i,))[0][0], 1)

    # 4
    def test_04_second_distinct_intent_obeys_one_active(self):
        g, i, prov = self.guest_with_provisional()
        r = self.f.intent(g, 'req-second-0001'); self.assertEqual(r.status_code, 201)
        r2 = self.f.provisional(g, r.json()['intentId'])
        self.assertEqual(r2.status_code, 409); self.assertEqual(r2.json()['error']['code'], 'ACTIVE_PROVISIONAL_EXISTS')
        binding = prov and q(self.p.intake, 'SELECT guest_binding FROM provisional_companies WHERE intent_id=?', (i,))[0][0]
        self.assertEqual(q(self.p.intake, "SELECT count(*) FROM provisional_companies WHERE guest_binding=? AND status='PROVISIONAL'", (binding,))[0][0], 1)

    # 5
    def test_05_two_tenant_isolation(self):
        ga, ia, pa = self.guest_with_provisional(); gb, ib, pb = self.guest_with_provisional()
        self.assertEqual(self.f.progress(gb, ia).status_code, 404)
        self.assertEqual(self.f.provisional(gb, ia).status_code, 404)
        ua, ta = self.user(); ub, tb = self.user()
        r = self.f.claim(gb, tb, ia, pa['revision'], 'key-cross-tenant-1'); self.assertEqual(r.status_code, 404, r.text)
        ca = self.f.claim(ga, ta, ia, pa['revision'], 'key-tenant-a-0001').json()
        cb = self.f.claim(gb, tb, ib, pb['revision'], 'key-tenant-b-0001').json()
        self.assertNotEqual(ca['companyId'], cb['companyId'])
        self.assertEqual(self.f.native_rooms(tb, ca['companyId']).status_code, 403)
        self.assertEqual(self.f.native_rooms(ta, cb['companyId']).status_code, 403)
        self.assertEqual(self.f.navigation(tb, ia).status_code, 404)
        self.assertEqual(self.f.navigation(ta, ia).json()['stage'], 'ROOM_READY')
        self.assertEqual(self.f.navigation(tb, ib).json()['stage'], 'ROOM_READY')
        self.assertEqual(q(self.p.authority, 'SELECT count(*) FROM members WHERE company_id=? AND user_id=?', (ca['companyId'], ub))[0][0], 0)

    # 6
    def test_06_origin_csrf_auth_negatives(self):
        g, i, prov = self.guest_with_provisional(); uid, tok = self.user()
        cases = {
            'no_origin': self.f.claim(g, tok, i, prov['revision'], 'key-neg-000001', origin=None),
            'evil_origin': self.f.claim(g, tok, i, prov['revision'], 'key-neg-000002', origin='https://evil.example'),
            'no_csrf': self.f.claim(g, tok, i, prov['revision'], 'key-neg-000003', csrf=None),
            'cross_site': self.f.claim(g, tok, i, prov['revision'], 'key-neg-000004', extra=None) if False else self.f.c.post('/api/v1/starli/public/grokbot1/claims', json={'intentId': i, 'expectedRevision': prov['revision']}, headers=dict(self.f.h(g, tok, csrf='x-starli-claim'), **{'sec-fetch-site': 'cross-site', 'idempotency-key': 'key-neg-000004'})),
            'no_jwt': self.f.claim(g, None, i, prov['revision'], 'key-neg-000005'),
            'forged_jwt': self.f.claim(g, tok[:-4] + 'AAAA', i, prov['revision'], 'key-neg-000006'),
            'api_key': self.f.claim(g, 'sk-123', i, prov['revision'], 'key-neg-000007'),
            'no_guest_cookie': self.f.claim(None, tok, i, prov['revision'], 'key-neg-000008'),
            'forged_guest_cookie': self.f.claim(g[:-3] + 'abc', tok, i, prov['revision'], 'key-neg-000009'),
            'no_idem': self.f.claim(g, tok, i, prov['revision'], None),
            'extra_field': self.f.c.post('/api/v1/starli/public/grokbot1/claims', json={'intentId': i, 'expectedRevision': prov['revision'], 'ownerUserId': 'x'}, headers=self.f.h(g, tok, csrf='x-starli-claim', extra={'idempotency-key': 'key-neg-000010'})),
            'provisional_no_csrf': self.f.provisional(g, i, csrf=None),
        }
        got = {k: v.status_code for k, v in cases.items()}
        self.assertEqual(got, {'no_origin': 403, 'evil_origin': 403, 'no_csrf': 403, 'cross_site': 403, 'no_jwt': 401, 'forged_jwt': 401,
                               'api_key': 401, 'no_guest_cookie': 403, 'forged_guest_cookie': 403, 'no_idem': 422, 'extra_field': 422,
                               'provisional_no_csrf': 403})
        self.assertEqual(q(self.p.intake, 'SELECT count(*) FROM grokbot1_claim_journal WHERE intent_id=?', (i,))[0][0], 0)
        self.assertEqual(self.f.claim(g, tok, i, prov['revision'], 'key-neg-ok-0001').status_code, 200)

    # 7
    def test_07_expiry(self):
        g, i, prov = self.guest_with_provisional(); uid, tok = self.user()
        real = self.svc.now
        self.svc.now = lambda: real() + 2 * 86400
        try:
            r = self.f.claim(g, tok, i, prov['revision'], 'key-expired-0001')
            self.assertEqual(r.status_code, 410, r.text)
            self.assertEqual(self.f.progress(g, i).json()['stage'], 'EXPIRED_OR_REVOKED')
        finally:
            self.svc.now = real

    # 8
    def test_08_guest_revocation_before_claim(self):
        g, i, prov = self.guest_with_provisional(); uid, tok = self.user()
        self.assertEqual(self.f.rotate(g).status_code, 200)
        r = self.f.claim(g, tok, i, prov['revision'], 'key-revoked-0001')
        self.assertEqual((r.status_code, r.json()['error']['code']), (403, 'GUEST_REVOKED'))
        self.assertEqual(self.f.progress(g, i).json()['stage'], 'EXPIRED_OR_REVOKED')
        self.assertEqual(self.f.provisional(g, i).status_code, 403)

    # 9
    def test_09_native_session_revoked_before_claim(self):
        g, i, prov = self.guest_with_provisional(); uid, tok = self.user()
        self.ns.revocation.revoke_and_enqueue(tok, self.ns.auth.decode_token(tok))
        r = self.f.claim(g, tok, i, prov['revision'], 'key-jwtrevoked-01')
        self.assertEqual((r.status_code, r.json()['error']['code']), (401, 'NATIVE_SESSION_REVOKED'))
        self.assertEqual(self.f.navigation(tok, i).status_code, 401)

    # 10
    def test_10_session_revoked_between_prepare_and_commit_aborts_cleanly(self):
        g, i, prov = self.guest_with_provisional(); uid, tok = self.user()
        session, _ = self.svc.native_session(tok)
        txn = self.svc._prepare(uid, self.svc.binding(g), i, 'key-mid-revoke-01', 'digest', prov['revision'])
        self.ns.revocation.revoke_and_enqueue(tok, self.ns.auth.decode_token(tok))
        with self.assertRaises(self.gc.ClaimError) as cm:
            self.svc._drive(txn, session)
        self.assertEqual(cm.exception.code, 'CLAIM_ABORTED')
        self.assertEqual(cm.exception.detail['reason'], 'NATIVE_SESSION_REVOKED_BEFORE_COMMIT')
        self.assertEqual(q(self.p.authority, 'SELECT count(*) FROM companies WHERE id=?', (prov['companyId'],))[0][0], 0)
        self.assertEqual(q(self.p.main, 'SELECT count(*) FROM cm_rooms WHERE company=?', (prov['companyId'],))[0][0], 0)
        self.assertEqual(q(self.p.intake, 'SELECT status FROM provisional_companies WHERE intent_id=?', (i,)), [('PROVISIONAL',)])
        _, tok2 = self.user(uid + '-x') if False else (None, self.h.mint_native_jwt(self.ns, uid))
        r = self.f.claim(g, tok2, i, prov['revision'], 'key-after-abort-1')
        self.assertEqual(r.status_code, 200, r.text)

    # 11
    def test_11_claim_replay_and_conflicts(self):
        g, i, prov = self.guest_with_provisional(); uid, tok = self.user(); other, tok_o = self.user()
        r1 = self.f.claim(g, tok, i, prov['revision'] + 5, 'key-replay-00001')
        self.assertEqual((r1.status_code, r1.json()['error']['code']), (409, 'REVISION_CONFLICT'))
        a = self.f.claim(g, tok, i, prov['revision'], 'key-replay-00002'); b = self.f.claim(g, tok, i, prov['revision'], 'key-replay-00002')
        self.assertEqual((a.status_code, b.status_code), (200, 200)); self.assertEqual(a.json()['claimId'], b.json()['claimId'])
        self.assertEqual(self.f.claim(g, tok, i, prov['revision'] + 1, 'key-replay-00002').json()['error']['code'], 'IDEMPOTENCY_CONFLICT')
        c = self.f.claim(g, tok, i, prov['revision'], 'key-replay-00003')
        self.assertEqual(c.status_code, 403)  # guest binding retired by the committed claim
        d = self.f.claim(g, tok_o, i, prov['revision'], 'key-replay-00004'); self.assertEqual(d.status_code, 403)
        self.assertEqual(q(self.p.authority, 'SELECT count(*) FROM companies WHERE id=?', (prov['companyId'],))[0][0], 1)
        self.assertEqual(q(self.p.intake, "SELECT count(*) FROM grokbot1_claim_journal WHERE intent_id=? AND state='COMMITTED'", (i,))[0][0], 1)

    # 12
    def test_12_decision_exclusivity_abort_wins_no_grant(self):
        g, i, prov = self.guest_with_provisional(); uid, tok = self.user()
        session, _ = self.svc.native_session(tok)
        txn = self.svc._prepare(uid, self.svc.binding(g), i, 'key-exclusive-01', 'digest', prov['revision'])
        j = self.svc._journal(txn)
        self.assertEqual(self.svc._decide(j, None), 'ABORT')        # recoverer decides first
        self.assertEqual(self.svc._decide(j, session), 'ABORT')     # late committer cannot flip it
        self.assertEqual(q(self.p.authority, 'SELECT count(*) FROM members WHERE company_id=?', (prov['companyId'],))[0][0], 0)
        self.assertEqual(q(self.p.authority, 'SELECT count(*) FROM grokbot1_saga_decisions WHERE txn=?', (txn,))[0][0], 1)

    # 13
    def test_13_prepared_state_is_unexposed(self):
        g, i, prov = self.guest_with_provisional(); uid, tok = self.user()
        txn = self.svc._prepare(uid, self.svc.binding(g), i, 'key-unexposed-01', 'digest', prov['revision'])
        nav = self.f.navigation(tok, i).json()
        self.assertEqual((nav['stage'], nav['companyId'], nav['roomId']), ('CLAIM_PENDING', None, None))
        self.assertEqual(self.f.progress(g, i).json()['stage'], 'CLAIM_PENDING')
        self.assertEqual(self.f.native_rooms(tok, prov['companyId']).status_code, 403)
        self.assertEqual(q(self.p.authority, 'SELECT count(*) FROM companies WHERE id=?', (prov['companyId'],))[0][0], 0)
        r = self.f.claim(g, tok, i, prov['revision'], 'key-unexposed-02')
        self.assertEqual((r.status_code, r.json()['error']['code']), (409, 'CLAIM_IN_PROGRESS'))
        self.assertEqual(q(self.p.intake, "SELECT state FROM grokbot1_claim_journal WHERE txn=?", (txn,)), [('PREPARED',)])


    # 14
    def test_14_migration_forward_rollback_on_disposable_copies(self):
        mig = Path(__file__).resolve().parents[1] / 'migration'
        for name in ('authority', 'intake'):
            src = getattr(self.p, name)
            copy = Path(ROOT) / f'migcopy-{name}.sqlite3'
            with sqlite3.connect(str(src)) as a, sqlite3.connect(str(copy)) as b:
                a.backup(b)
            with sqlite3.connect(str(copy)) as db:
                before = {r[0] for r in db.execute("SELECT name FROM sqlite_master")}
                db.executescript((mig / '001_forward.sql').read_text())   # idempotent on already-migrated copy
                db.executescript((mig / '001_rollback.sql').read_text())
                after_rb = {r[0] for r in db.execute("SELECT name FROM sqlite_master")}
                self.assertFalse({'grokbot1_saga_decisions', 'grokbot1_claim_journal'} & after_rb)
                self.assertEqual(before - after_rb, {x for x in before if 'grokbot1_' in x})
                db.executescript((mig / '001_forward.sql').read_text())   # re-apply
                again = {r[0] for r in db.execute("SELECT name FROM sqlite_master")}
                self.assertTrue({'grokbot1_saga_decisions', 'grokbot1_claim_journal'} <= again)
                # native tables untouched by rollback
                self.assertTrue({x for x in before if 'grokbot1_' not in x} <= after_rb)
            copy.unlink()


    def test_15_environment_hook_fail_closed_and_mounts(self):
        import os
        from fastapi import FastAPI
        from grokbot1_routes import install_from_environment
        saved = {k: os.environ.get(k) for k in ('STARLI_GROKBOT1_CLAIM_ENABLED', 'STARLI_GROKBOT1_ALLOWED_ORIGINS', 'STARLI_GROKBOT1_INTAKE_DATABASE')}
        try:
            os.environ.pop('STARLI_GROKBOT1_CLAIM_ENABLED', None)
            self.assertIsNone(install_from_environment(FastAPI(), self.svc.store))
            os.environ['STARLI_GROKBOT1_CLAIM_ENABLED'] = '1'
            os.environ.pop('STARLI_GROKBOT1_ALLOWED_ORIGINS', None)
            with self.assertRaises(RuntimeError):
                install_from_environment(FastAPI(), self.svc.store)
            os.environ['STARLI_GROKBOT1_ALLOWED_ORIGINS'] = 'http://localhost:8080'
            os.environ['STARLI_GROKBOT1_INTAKE_DATABASE'] = str(self.p.root / 'intake' / 'hook-intake.sqlite3')
            app = FastAPI(); svc = install_from_environment(app, self.svc.store)
            self.assertIsNotNone(svc)
            self.assertTrue(str(svc.p.intake).startswith(str(self.p.root)))
            paths = {getattr(r, 'path', '') for r in app.routes}
            self.assertTrue(any(x.startswith('/api/v1/starli/grokbot1/claims/') for x in paths))
            self.assertTrue(any(x.startswith('/api/v1/starli/public/grokbot1/') for x in paths))
        finally:
            for k, v in saved.items():
                if v is None: os.environ.pop(k, None)
                else: os.environ[k] = v

    def test_16_recent_auth_required_bound_and_limited(self):
        g, i, prov = self.guest_with_provisional(); uid, tok = self.user()
        r = self.f.claim(g, tok, i, prov['revision'], 'key-noreauth-001', reauth=False)
        self.assertEqual((r.status_code, r.json()['error']['code']), (401, 'RECENT_AUTH_REQUIRED'), r.text)
        self.assertEqual(q(self.p.intake, 'SELECT count(*) FROM grokbot1_claim_journal WHERE intent_id=?', (i,))[0][0], 0)
        self.assertEqual(self.f.reauth(tok, 'wrong-password').json()['error']['code'], 'RECENT_AUTH_FAILED')
        self.assertEqual(self.f.reauth(tok, self.h.test_password(uid), origin='https://evil.example').status_code, 403)
        self.assertEqual(self.f.reauth(tok, self.h.test_password(uid), csrf=None).status_code, 403)
        self.assertEqual(self.f.reauth(None, self.h.test_password(uid)).status_code, 401)
        # evidence is bound to the exact JWT: re-auth on token A does not authorize token B of the same user
        tok_b = self.h.mint_native_jwt(self.ns, uid)
        ok = self.f.reauth(tok, self.h.test_password(uid)); self.assertEqual(ok.status_code, 200, ok.text)
        body = ok.json(); self.assertEqual((body['contract'], body['method'], body['userId']), ('RECENT_AUTH_V1', 'native_password', uid))
        self.assertNotIn(self.h.test_password(uid), json.dumps(q(self.p.intake, 'SELECT * FROM grokbot1_recent_auth')))
        r = self.f.claim(g, tok_b, i, prov['revision'], 'key-otherjwt-001', reauth=False)
        self.assertEqual(r.json()['error']['code'], 'RECENT_AUTH_REQUIRED')
        # window expiry: evidence older than REAUTH_WINDOW_SECONDS is refused
        real = self.svc.now
        self.svc.now = lambda: real() + self.gc.REAUTH_WINDOW_SECONDS + 1
        try:
            r = self.f.claim(g, tok, i, prov['revision'], 'key-staleauth-01', reauth=False)
            self.assertEqual(r.json()['error']['code'], 'RECENT_AUTH_REQUIRED')
        finally:
            self.svc.now = real
        r = self.f.claim(g, tok, i, prov['revision'], 'key-freshauth-01', reauth=False)
        self.assertEqual(r.status_code, 200, r.text)
        reason = q(self.p.authority, "SELECT reason FROM grokbot1_saga_decisions WHERE company_id=? AND decision='COMMIT'", (prov['companyId'],))[0][0]
        self.assertEqual(reason, 'VERIFIED_NATIVE_SESSION+RECENT_AUTH:' + body['reauthId'])
        # bounded failures -> 429
        _, tok_c = self.user()
        codes = [self.f.reauth(tok_c, 'nope').status_code for _ in range(self.gc.REAUTH_MAX_FAILURES + 1)]
        self.assertEqual(codes[-1], 429); self.assertTrue(all(c == 401 for c in codes[:-1]))

    def test_17_navigation_receipt_correlation_and_expiry(self):
        g, i, prov, uid, tok, c = self.claimed()
        self.assertEqual(c['channelRoomId'] is not None and 'doglovRoomId' not in c, True)
        nav = self.f.navigation(tok, i).json()
        self.assertEqual(nav['stage'], 'ROOM_READY', nav)
        self.assertEqual((nav['intentId'], nav['claimId'], nav['claimRevision']), (i, c['claimId'], c['claimRevision']))
        self.assertEqual(nav['claimRevision'], prov['revision'] + 1)
        self.assertEqual(nav['channelRoomId'], c['channelRoomId']); self.assertEqual(nav['roomId'], c['channelRoomId'])
        from datetime import datetime
        v = datetime.fromisoformat(nav['verifiedAt'].replace('Z', '+00:00')).timestamp()
        e = datetime.fromisoformat(nav['expiresAt'].replace('Z', '+00:00')).timestamp()
        self.assertAlmostEqual(e - v, self.gc.NAV_TTL_SECONDS, delta=1)
        self.assertTrue(self.gc.verify_navigation(nav, self.svc.nav_key))
        self.assertFalse(self.gc.verify_navigation(nav, self.svc.nav_key, now=e + 1))
        self.assertFalse(self.gc.verify_navigation(dict(nav, claimRevision=nav['claimRevision'] + 1), self.svc.nav_key))
        # pending (non-verified) stages carry no verifiedAt
        g2, i2, prov2 = self.guest_with_provisional()
        self.assertIsNone(self.f.progress(g2, i2).json()['verifiedAt'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
