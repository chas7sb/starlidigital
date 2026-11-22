"""Independent OS-process worker: builds the real candidate app on a shared disposable root and performs
real HTTP calls through the actual routes (or recovery / a real uvicorn server).
Prints `SETUP <json>` / `RESULT <json>` lines.  usage: worker_proc.py ROOT CMD JSON_ARGS [GO_FILE]
"""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def emit(tag, obj):
    sys.stdout.write(tag + ' ' + json.dumps(obj) + '\n')
    sys.stdout.flush()


def main():
    root, cmd, args = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
    go = sys.argv[4] if len(sys.argv) > 4 else None
    from grokbot1_routes import build_candidate_app
    import native_harness as h
    import flow as flowmod
    app, svc, ns = build_candidate_app(root)
    if os.environ.get('GROKBOT1_LEASE_SECONDS'):
        svc.lease_seconds = float(os.environ['GROKBOT1_LEASE_SECONDS'])
    f = flowmod.Flow(app)

    def setup(a):
        out = {'cookie': f.guest_cookie(), 'intents': [], 'tokens': {}}
        for n in range(a.get('intents', 1)):
            r = f.intent(out['cookie'], f"req-setup-{n:04d}-{os.getpid()}")
            assert r.status_code == 201, r.text
            out['intents'].append(r.json()['intentId'])
        if a.get('provisional', True):
            r = f.provisional(out['cookie'], out['intents'][0]); assert r.status_code == 201, r.text
            out['revision'], out['companyId'] = r.json()['revision'], r.json()['companyId']
        for u in a.get('users', []):
            h.create_disposable_native_user(ns, u, u)
            out['tokens'][u] = h.mint_native_jwt(ns, u, 120)
        return out

    if cmd == 'serve':
        import uvicorn
        emit('READY', {'pid': os.getpid()})
        uvicorn.run(app, host='127.0.0.1', port=int(args['port']), log_level='warning', access_log=False)
        return
    if cmd == 'setup_claim':
        s = setup(args)
        emit('SETUP', s)
        owner = args['users'][0]
        r = f.claim(s['cookie'], s['tokens'][owner], s['intents'][0], s['revision'], 'key-crash-claim-0001')
        emit('RESULT', {'status': r.status_code, 'body': r.json()})
        return
    if go:  # barrier: all contenders finish native import before contending
        Path(go + '.ready.' + str(os.getpid())).touch()
        deadline = time.time() + 60
        while not os.path.exists(go) and time.time() < deadline:
            time.sleep(0.005)
    out = {'pid': os.getpid(), 't': time.time()}
    if cmd == 'setup':
        out.update(setup(args))
    elif cmd == 'mkuser':
        h.create_disposable_native_user(ns, args['user'], args['user'])
        out['token'] = h.mint_native_jwt(ns, args['user'], 120)
    elif cmd == 'intent':
        r = f.intent(args['cookie'], args['requestId'])
        out.update(status=r.status_code, body=r.json())
    elif cmd == 'provisional':
        r = f.provisional(args['cookie'], args['intentId'])
        out.update(status=r.status_code, body=r.json())
    elif cmd == 'claim':
        r = f.claim(args['cookie'], args['token'], args['intentId'], args['revision'], args['key'])
        out.update(status=r.status_code, body=r.json(), reauth=f.last_reauth)
    elif cmd == 'recover_flow':
        out['pre'] = f.navigation(args['token'], args['intentId']).json()
        out['preProgress'] = f.progress(args['cookie'], args['intentId']).json()
        out['preRooms'] = f.native_rooms(args['token'], args['companyId']).status_code
        wait = args.get('waitLease', 0)
        time.sleep(wait)
        out['recovered'] = svc.recover()
        out['postRecover'] = f.navigation(args['token'], args['intentId']).json()
        if args.get('resume'):
            r = f.resume(args['token'], args['intentId'])
            out['resume'] = {'status': r.status_code, 'body': r.json()}
            r2 = f.resume(args['token'], args['intentId'])
            out['resumeReplay'] = {'status': r2.status_code, 'body': r2.json()}
        out['post'] = f.navigation(args['token'], args['intentId']).json()
        if args.get('retryKey'):
            r = f.claim(args['cookie'], args['token'], args['intentId'], args['revision'], args['retryKey'])
            out['retry'] = {'status': r.status_code, 'body': r.json()}
            out['postRetry'] = f.navigation(args['token'], args['intentId']).json()
        out['recoveredAgain'] = svc.recover()
    else:
        raise SystemExit('unknown cmd')
    emit('RESULT', out)


if __name__ == '__main__':
    main()
