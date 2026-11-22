"""grokbot1 W1 multi-process suite: independent OS processes against shared disposable SQLite files,
real hard process death (os._exit at saga points) + recovery by a NEW process, and a real
uvicorn localhost server killed with SIGKILL and restarted. Bounded: <=3 concurrent workers
(~350 MiB RSS each, measured) and a MemAvailable guard. Execution class NATIVE_NONPRODUCTION."""
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = '/opt/starlidigital/webui-runtime/bin/python3'
WORKER = str(HERE / 'worker_proc.py')
MAX_PAR = 3
WORKER_MIB = 400
# Headroom left free on the host beyond WORKER_MIB per worker (measured RSS ~350 MiB). Default 600;
# bounded override (>= 400) for a host whose MemAvailable sits just under 1800 MiB.
HEADROOM_MIB = max(400, int(os.environ.get('GROKBOT1_MP_HEADROOM_MIB', '600')))
RECEIPTS = []


def mem_available_mib():
    with open('/proc/meminfo') as fh:
        for line in fh:
            if line.startswith('MemAvailable:'):
                return int(line.split()[1]) // 1024
    return 0


def new_root(tag):
    return tempfile.mkdtemp(prefix=f'grokbot1-w1-mp-{tag}-', dir='/tmp')


def spawn(root, cmd, args, env=None, go=None):
    e = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', **(env or {}))
    argv = [PY, WORKER, root, cmd, json.dumps(args)] + ([go] if go else [])
    return subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=e)


def collect(proc, timeout=120):
    out, _ = proc.communicate(timeout=timeout)
    tags = {}
    for line in out.splitlines():
        for tag in ('SETUP', 'RESULT', 'READY'):
            if line.startswith(tag + ' '):
                tags[tag] = json.loads(line[len(tag) + 1:])
    tags['exit'] = proc.returncode
    RECEIPTS.append({'pid': proc.pid, 'argv': proc.args[2:4], 'exit': proc.returncode})
    return tags


def run(root, cmd, args, env=None):
    return collect(spawn(root, cmd, args, env))


def parallel(root, cmd, arglist):
    n = len(arglist)
    if n > MAX_PAR:
        raise AssertionError('bounded parallelism exceeded')
    need = n * WORKER_MIB + HEADROOM_MIB
    waited = time.time() + 45  # bounded wait for memory to settle, then truthful skip
    while mem_available_mib() < need and time.time() < waited:
        time.sleep(3)
    if mem_available_mib() < need:
        raise unittest.SkipTest(f'BLOCKED_RESOURCE: MemAvailable {mem_available_mib()} MiB < {need}')
    go = os.path.join(root, 'go-' + str(time.time_ns()))
    procs = [spawn(root, cmd, a, go=go) for a in arglist]
    deadline = time.time() + 90
    while time.time() < deadline:
        ready = [p for p in os.listdir(root) if p.startswith(os.path.basename(go) + '.ready.')]
        if len(ready) == n:
            break
        time.sleep(0.05)
    Path(go).touch()
    return [collect(p)['RESULT'] for p in procs]


def q(path, sql, args=()):
    with sqlite3.connect(str(path)) as db:
        return db.execute(sql, args).fetchall()


class P:
    def __init__(self, root):
        self.root = Path(root)
        self.intake = self.root / 'intake/grokbot1-intake.sqlite3'
        self.authority = self.root / 'data/company-authority.sqlite3'
        self.main = self.root / 'data/webui.db'
        self.drive = self.root / 'data/company-drive.sqlite3'

    def native_counts(self, company):
        return dict(
            companies=q(self.authority, 'SELECT count(*) FROM companies WHERE id=?', (company,))[0][0],
            members=q(self.authority, 'SELECT count(*) FROM members WHERE company_id=?', (company,))[0][0],
            bots=q(self.authority, 'SELECT count(*) FROM bots WHERE owner=?', (company,))[0][0],
            dm=q(self.main, "SELECT count(*) FROM cm_rooms WHERE company=? AND kind='dm'", (company,))[0][0],
            doglove=q(self.main, "SELECT count(*) FROM cm_rooms r JOIN channel c ON c.id=r.id WHERE r.company=? AND c.name='doglove'", (company,))[0][0],
            provenance=q(self.main, "SELECT count(*) FROM cm_messages m JOIN cm_rooms r ON r.id=m.room WHERE r.company=? AND m.kind='system'", (company,))[0][0],
            human=q(self.main, "SELECT count(*) FROM cm_messages m JOIN cm_rooms r ON r.id=m.room WHERE r.company=? AND m.kind='human'", (company,))[0][0],
            projects=q(self.drive, "SELECT count(*) FROM resource WHERE company=? AND kind='project'", (company,))[0][0] if self.drive.exists() else 0,
        )

    def journal(self, intent):
        return q(self.intake, 'SELECT state,abort_reason FROM grokbot1_claim_journal WHERE intent_id=? ORDER BY created', (intent,))

    def decisions(self, company):
        return q(self.authority, 'SELECT decision,reason FROM grokbot1_saga_decisions WHERE company_id=? ORDER BY decided', (company,))


FULL = dict(companies=1, members=2, bots=1, dm=1, doglove=1, provenance=1, human=0, projects=1)
NONE = dict(companies=0, members=0, bots=0, dm=0, doglove=0, provenance=0, human=0, projects=0)


class MultiProcess(unittest.TestCase):
    roots = []

    @classmethod
    def tearDownClass(cls):
        for r in cls.roots:
            shutil.rmtree(r, ignore_errors=True)
        (HERE.parent / 'evidence').mkdir(exist_ok=True)
        with open(HERE.parent / 'evidence' / 'MULTIPROCESS-RECEIPTS-W1.json', 'w') as fh:
            json.dump({'workers': RECEIPTS, 'maxParallel': MAX_PAR, 'measuredWorkerRssMiB': 350}, fh, indent=1)

    def root(self, tag):
        r = new_root(tag); self.roots.append(r); return r

    def test_01_concurrent_same_key_intent_one_intent(self):
        root = self.root('samekey'); s = run(root, 'setup', {'intents': 0, 'provisional': False})['RESULT']
        res = parallel(root, 'intent', [{'cookie': s['cookie'], 'requestId': 'req-same-key-0001'}] * 3)
        self.assertEqual(sorted(r['status'] for r in res), [200, 200, 201], res)
        self.assertEqual(len({r['body']['intentId'] for r in res}), 1)
        self.assertEqual(q(P(root).intake, "SELECT count(*) FROM guest_intents WHERE request_id='req-same-key-0001'")[0][0], 1)
        self.assertEqual(len({r['pid'] for r in res}), 3)

    def test_02_concurrent_distinct_intents_one_active_provisional(self):
        root = self.root('oneactive'); s = run(root, 'setup', {'intents': 3, 'provisional': False})['RESULT']
        res = parallel(root, 'provisional', [{'cookie': s['cookie'], 'intentId': i} for i in s['intents']])
        self.assertEqual(sorted(r['status'] for r in res), [201, 409, 409], res)
        self.assertTrue(all(r['body']['error']['code'] == 'ACTIVE_PROVISIONAL_EXISTS' for r in res if r['status'] == 409))
        self.assertEqual(q(P(root).intake, "SELECT count(*) FROM provisional_companies WHERE status='PROVISIONAL'")[0][0], 1)

    def test_03_concurrent_claims_exactly_one_company(self):
        root = self.root('claimrace'); s = run(root, 'setup', {'users': ['owner-a', 'owner-b']})['RESULT']
        i, rev, c = s['intents'][0], s['revision'], s['companyId']
        res = parallel(root, 'claim', [
            {'cookie': s['cookie'], 'token': s['tokens']['owner-a'], 'intentId': i, 'revision': rev, 'key': 'key-race-a-0001'},
            {'cookie': s['cookie'], 'token': s['tokens']['owner-a'], 'intentId': i, 'revision': rev, 'key': 'key-race-a-0002'},
            {'cookie': s['cookie'], 'token': s['tokens']['owner-b'], 'intentId': i, 'revision': rev, 'key': 'key-race-b-0001'}])
        ok = [r for r in res if r['status'] == 200]
        self.assertEqual(len(ok), 1, res)
        self.assertTrue(all(r['status'] in (403, 409) for r in res if r['status'] != 200), res)
        self.assertEqual(P(root).native_counts(c), FULL)
        self.assertEqual([x[0] for x in P(root).journal(i)].count('COMMITTED'), 1)
        self.assertEqual(q(P(root).authority, 'SELECT user_id FROM members WHERE company_id=? AND kind=\'person\'', (c,)), [(ok[0]['body']['ownerUserId'],)])

    def crash(self, point):
        root = self.root('crash-' + point.replace('_', ''))
        t = run(root, 'setup_claim', {'users': ['owner-c']}, env={'GROKBOT1_CRASH_AT': point, 'GROKBOT1_LEASE_SECONDS': '2'})
        self.assertEqual(t['exit'], 77, t)              # genuine hard death mid-saga
        self.assertNotIn('RESULT', t)
        s = t['SETUP']; i, c = s['intents'][0], s['companyId']
        p = P(root)
        before = dict(native=p.native_counts(c), journal=p.journal(i), decisions=p.decisions(c))
        args = {'token': s['tokens']['owner-c'], 'cookie': s['cookie'], 'intentId': i, 'companyId': c, 'revision': s['revision'], 'waitLease': 2.5}
        if point == 'after_prepare':
            args['retryKey'] = 'key-after-recovery-01'
        else:
            args['resume'] = True
        r = run(root, 'recover_flow', args)
        self.assertEqual(r['exit'], 0, r)
        return root, p, s, before, r['RESULT'], p.native_counts(c)

    def test_04_crash_after_prepare_presumed_abort_then_retry(self):
        root, p, s, before, r, after = self.crash('after_prepare')
        self.assertEqual(before['native'], NONE); self.assertEqual(before['journal'], [('PREPARED', None)]); self.assertEqual(before['decisions'], [])
        self.assertEqual(r['pre']['stage'], 'CLAIM_PENDING'); self.assertIsNone(r['pre']['companyId'])
        self.assertEqual(r['preProgress']['stage'], 'CLAIM_PENDING'); self.assertEqual(r['preRooms'], 403)
        self.assertEqual(r['recovered'][0]['result'], 'CLAIM_ABORTED')
        self.assertEqual(r['post']['stage'], 'CLAIM_ABORTED')
        self.assertEqual(r['retry']['status'], 200, r['retry'])
        self.assertEqual(r['postRetry']['stage'], 'ROOM_READY')
        self.assertEqual([x[0] for x in p.journal(s['intents'][0])], ['ABORTED', 'COMMITTED'])
        self.assertEqual([x[0] for x in p.decisions(s['companyId'])], ['ABORT', 'COMMIT'])
        self.assertEqual(after, FULL)

    def _rolled_forward(self, point, expect_before):
        root, p, s, before, r, after = self.crash(point)
        self.assertEqual([d[0] for d in before['decisions']], ['COMMIT'])
        self.assertTrue(before['decisions'][0][1].startswith('VERIFIED_NATIVE_SESSION+RECENT_AUTH:ra_'), before['decisions'])
        self.assertEqual(before['journal'], [('PREPARED', None)])
        for k, v in expect_before.items():
            self.assertEqual(before['native'][k], v, (point, k, before))
        self.assertEqual(r['pre']['stage'], 'CLAIM_COMMITTED_MATERIALIZING')
        self.assertIsNone(r['pre']['roomId'])
        # background recovery holds without an owner session (native actor() requires kind=='jwt')
        self.assertEqual(r['recovered'][0]['result'], 'AWAITING_OWNER_SESSION')
        self.assertEqual(r['postRecover']['stage'], 'CLAIM_COMMITTED_MATERIALIZING')
        self.assertEqual(r['postRecover']['next']['action'], 'resume_claim')
        self.assertEqual(r['resume']['status'], 200, r['resume'])
        self.assertEqual(r['resume']['body']['state'], 'CLAIM_COMMITTED')
        self.assertEqual(r['resumeReplay']['body']['claimId'], r['resume']['body']['claimId'])
        self.assertEqual(r['post']['stage'], 'ROOM_READY', r['post'])
        self.assertTrue(all(r['post']['checks'].values()))
        self.assertEqual(r['recoveredAgain'], [])
        self.assertEqual(after, FULL)
        self.assertEqual(p.journal(s['intents'][0]), [('COMMITTED', None)])
        self.assertEqual(q(p.intake, 'SELECT status FROM provisional_companies WHERE intent_id=?', (s['intents'][0],)), [('CLAIMED',)])

    def test_05_crash_after_decision_roll_forward(self):
        self._rolled_forward('after_decision', dict(companies=1, members=2, bots=1, dm=0, doglove=0, provenance=0, projects=0))

    def test_06_crash_after_dm_roll_forward_idempotent(self):
        self._rolled_forward('after_dm', dict(dm=1, doglove=0, provenance=0, projects=0))

    def test_07_crash_after_message_roll_forward_idempotent(self):
        self._rolled_forward('after_message', dict(dm=1, doglove=1, provenance=1, projects=0))

    def test_08_crash_after_project_before_finalize(self):
        self._rolled_forward('after_project', dict(dm=1, doglove=1, provenance=1, projects=1))

    def test_09_real_uvicorn_server_sigkill_restart_persistence(self):
        root = self.root('restart'); p = P(root)
        tok = run(root, 'mkuser', {'user': 'owner-r'})['RESULT']['token']
        with socket.socket() as sk:
            sk.bind(('127.0.0.1', 0)); port = sk.getsockname()[1]
        base = f'http://127.0.0.1:{port}'

        def start():
            proc = spawn(root, 'serve', {'port': port})
            deadline = time.time() + 90
            while time.time() < deadline:
                try:
                    urllib.request.urlopen(base + '/api/v1/starli/public/session', timeout=1).read(); return proc
                except Exception:
                    time.sleep(0.3)
            proc.kill(); raise AssertionError('server did not start')

        def call(method, path, body=None, headers=None):
            req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers or {})
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    return resp.status, json.loads(resp.read() or b'null'), resp.headers
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read() or b'null'), e.headers
        srv = start(); pid1 = srv.pid
        self.addCleanup(lambda: srv.poll() is None and (srv.kill(), srv.wait(timeout=20)))   # never leak a server on failure
        st, body, hdr = call('GET', '/api/v1/starli/public/session')
        cookie = [v for k, v in hdr.items() if k.lower() == 'set-cookie'][0].split(';')[0]
        self.assertIn('HttpOnly', [v for k, v in hdr.items() if k.lower() == 'set-cookie'][0])
        H = {'origin': 'http://localhost:8080', 'content-type': 'application/json', 'cookie': cookie}
        st, intent, _ = call('POST', '/api/v1/starli/public/grokbot1/intents', {'requestId': 'req-restart-0001', 'originalPrompt': 'Build DogLove, a dog adoption app.'}, dict(H, **{'x-starli-guest-intent': '1'}))
        self.assertEqual(st, 201, intent)
        st, prov, _ = call('POST', '/api/v1/starli/public/grokbot1/provisional', {'intentId': intent['intentId']}, dict(H, **{'x-starli-guest-intent': '1'}))
        self.assertEqual(st, 201, prov)
        CH = dict(H, **{'x-starli-claim': '1', 'authorization': 'Bearer ' + tok, 'idempotency-key': 'key-restart-claim-1'})
        st, claim, _ = call('POST', '/api/v1/starli/public/grokbot1/claims', {'intentId': intent['intentId'], 'expectedRevision': prov['revision']}, CH)
        self.assertEqual((st, claim['error']['code']), (401, 'RECENT_AUTH_REQUIRED'), claim)   # no re-auth yet
        import importlib.util
        spec = importlib.util.spec_from_file_location('gb1_native_harness', str(HERE.parent / 'native_harness.py'))
        import sys as _sys
        native_harness = importlib.util.module_from_spec(spec); _sys.modules['gb1_native_harness'] = native_harness
        spec.loader.exec_module(native_harness)
        RH = {'origin': 'http://localhost:8080', 'content-type': 'application/json', 'x-starli-claim': '1', 'authorization': 'Bearer ' + tok}
        st, ra, rh = call('POST', '/api/v1/starli/grokbot1/reauth', {'password': native_harness.test_password('owner-r')}, RH)
        self.assertEqual((st, ra['contract']), (200, 'RECENT_AUTH_V1'), ra)
        self.assertEqual(rh.get('cache-control'), 'no-store')
        st, claim, _ = call('POST', '/api/v1/starli/public/grokbot1/claims', {'intentId': intent['intentId'], 'expectedRevision': prov['revision']}, CH)
        self.assertEqual(st, 200, claim)
        st, nav1, _ = call('GET', f"/api/v1/starli/grokbot1/claims/{intent['intentId']}/navigation", headers={'authorization': 'Bearer ' + tok})
        self.assertEqual(nav1['stage'], 'ROOM_READY')
        os.kill(pid1, signal.SIGKILL); srv.wait(timeout=20)
        RECEIPTS.append({'pid': pid1, 'argv': ['serve', 'SIGKILL'], 'exit': srv.returncode})
        srv2 = start(); pid2 = srv2.pid
        try:
            self.assertNotEqual(pid1, pid2)
            st, nav2, _ = call('GET', f"/api/v1/starli/grokbot1/claims/{intent['intentId']}/navigation", headers={'authorization': 'Bearer ' + tok})
            self.assertEqual(nav2['stage'], 'ROOM_READY')
            for k in ('companyId', 'projectId', 'roomId', 'dmRoomId'):
                self.assertEqual(nav1[k], nav2[k])
            st, replay, _ = call('POST', '/api/v1/starli/public/grokbot1/claims', {'intentId': intent['intentId'], 'expectedRevision': prov['revision']}, CH)
            self.assertEqual((st, replay['claimId']), (200, claim['claimId']))
            st, rooms, _ = call('GET', f"/api/v1/starli/companies/{claim['companyId']}/messaging/rooms", headers={'authorization': 'Bearer ' + tok})
            self.assertEqual(sorted(r['name'] for r in rooms['rooms']), ['BOSS', 'doglove'])
            self.assertEqual(p.native_counts(claim['companyId']), FULL)
            (HERE.parent / 'evidence').mkdir(exist_ok=True)
            with open(HERE.parent / 'evidence' / 'RESTART-E2E-W1.json', 'w') as fh:
                json.dump({'executionClass': 'NATIVE_NONPRODUCTION', 'server': 'uvicorn 127.0.0.1 ephemeral port', 'pidBefore': pid1, 'pidAfter': pid2,
                           'killSignal': 'SIGKILL', 'claim': claim, 'navigationBefore': nav1, 'navigationAfter': nav2,
                           'nativeRoomsAfterRestart': rooms, 'nativeCounts': p.native_counts(claim['companyId'])}, fh, indent=1)
        finally:
            srv2.kill(); srv2.wait(timeout=20)


if __name__ == '__main__':
    unittest.main(verbosity=2)
