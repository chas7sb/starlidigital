"""HTTP flow helpers over the real candidate ASGI app (FastAPI TestClient)."""
from __future__ import annotations

import sys
from pathlib import Path

STAGE = Path(__file__).resolve().parents[1]
if str(STAGE) not in sys.path:
    sys.path.insert(0, str(STAGE))

ORIGIN = 'http://localhost:8080'
PROMPT = 'Build DogLove: a dog adoption app where shelters list dogs and families apply. Include an admin view.'


class Flow:
    def __init__(self, app):
        from fastapi.testclient import TestClient
        self.c = TestClient(app, raise_server_exceptions=True)
        self.app = app

    def guest_cookie(self) -> str:
        self.c.cookies.clear()
        r = self.c.get('/api/v1/starli/public/session')
        self.c.cookies.clear()
        assert r.status_code == 200, r.text
        return r.cookies['starli_guest']

    @staticmethod
    def h(cookie=None, token=None, csrf='x-starli-guest-intent', origin=ORIGIN, extra=None):
        headers = {'content-type': 'application/json'}
        if origin:
            headers['origin'] = origin
        if csrf:
            headers[csrf] = '1'
        cookies = []
        if cookie:
            cookies.append('starli_guest=' + cookie)
        if cookies:
            headers['cookie'] = '; '.join(cookies)
        if token:
            headers['authorization'] = 'Bearer ' + token
        headers.update(extra or {})
        return headers

    def intent(self, cookie, request_id, prompt=PROMPT, **kw):
        return self.c.post('/api/v1/starli/public/grokbot1/intents', json={'requestId': request_id, 'originalPrompt': prompt}, headers=self.h(cookie, **kw))

    def provisional(self, cookie, intent_id, **kw):
        return self.c.post('/api/v1/starli/public/grokbot1/provisional', json={'intentId': intent_id}, headers=self.h(cookie, **kw))

    def progress(self, cookie, intent_id):
        return self.c.get(f'/api/v1/starli/public/grokbot1/progress/{intent_id}', headers=self.h(cookie, csrf=None, origin=None))

    def rotate(self, cookie):
        r = self.c.post('/api/v1/starli/public/grokbot1/intents/rotate', headers=self.h(cookie))
        self.c.cookies.clear()
        return r

    def reauth(self, token, password, **kw):
        kw.setdefault('csrf', 'x-starli-claim')
        return self.c.post('/api/v1/starli/grokbot1/reauth', json={'password': password}, headers=self.h(None, token, **kw))

    def auto_reauth(self, token):
        """Test helper: fresh RECENT_AUTH_V1 for a SYNTHETIC_DISPOSABLE_NATIVE_USER token (if decodable)."""
        import native_harness as h
        try:
            payload = self.app.state.grokbot1.ns.auth.decode_token(token) if token else None
        except Exception:
            payload = None
        if isinstance(payload, dict) and isinstance(payload.get('id'), str):
            return self.reauth(token, h.test_password(payload['id']))
        return None

    def claim(self, cookie, token, intent_id, revision, key, reauth=True, **kw):
        self.last_reauth = None
        if reauth:
            ra = self.auto_reauth(token)
            self.last_reauth = None if ra is None else {'status': ra.status_code, 'body': ra.json()}
        kw.setdefault('csrf', 'x-starli-claim')
        extra = {'idempotency-key': key} if key else {}
        return self.c.post('/api/v1/starli/public/grokbot1/claims', json={'intentId': intent_id, 'expectedRevision': revision},
                           headers=self.h(cookie, token, extra=extra, **kw))

    def resume(self, token, intent_id):
        return self.c.post(f'/api/v1/starli/grokbot1/claims/{intent_id}/resume', json={}, headers=self.h(None, token, csrf='x-starli-claim'))

    def navigation(self, token, intent_id):
        return self.c.get(f'/api/v1/starli/grokbot1/claims/{intent_id}/navigation', headers=self.h(None, token, csrf=None, origin=None))

    def native_rooms(self, token, company):
        return self.c.get(f'/api/v1/starli/companies/{company}/messaging/rooms', headers={'authorization': 'Bearer ' + token})
