"""Private staging RPC for the two enrolled Computer operations.

The run, room and principal come from the native runtime. The host owns the VM,
controller lease and physical receipt. Both sides use fixed loopback peers.
"""
import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from contextlib import contextmanager

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


class GrantDenied(Exception):
    pass


def digest(value):
    data = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def native_scope(grant):
    """Fixed mapping into Agent8's enrolled Scope, derived from one active call."""
    return {"company_id": grant["companyId"], "native_actor_id": grant["actorUserId"],
            "node_actor_id": hashlib.sha256(grant["actorBinding"].encode()).hexdigest(),
            "membership_id": grant["companyId"] + ":" + grant["actorUserId"],
            "membership_revision": grant["membershipRevision"], "agent_id": grant["botId"],
            "conversation_id": grant["roomId"], "assistant_id": grant["assistantMessageId"],
            "run_id": grant["runId"], "request_id": grant["toolCallId"], "actor": "agent",
            "viewer_id": grant["viewerId"]}


def host_sign(value, key):
    """Interoperable with company_transport_v3.sign (base64url canonical JSON)."""
    def encode(data):
        return base64.urlsafe_b64encode(data).rstrip(b"=")
    body = encode(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode())
    return (body + b"." + encode(hmac.digest(key, body, "sha256"))).decode("ascii")


class Channel:
    def __init__(self, key):
        if not isinstance(key, bytes) or len(key) != 32:
            raise ValueError("Expected a 32-byte private staging key")
        self.key = key

    def sign(self, purpose, payload):
        message = {"purpose": purpose, "payload": payload, "issued": int(time.time()),
                   "nonce": secrets.token_hex(16)}
        mac = hmac.digest(self.key, digest(message).encode("ascii"), "sha256")
        return {"message": message, "mac": mac.hex()}

    def read(self, purpose, envelope):
        try:
            msg = envelope["message"]
            expected = hmac.digest(self.key, digest(msg).encode("ascii"), "sha256").hex()
            if (not hmac.compare_digest(envelope["mac"], expected)
                    or msg["purpose"] != purpose or type(msg["issued"]) != int
                    or not -3 <= time.time() - msg["issued"] <= 35
                    or len(msg["nonce"]) != 32):
                raise GrantDenied()
            return msg["payload"]
        except (TypeError, ValueError, KeyError, AttributeError):
            raise GrantDenied() from None

    def endpoint(self, path, purpose, handler):
        async def respond(request: Request):
            try:
                size = 0
                chunks = []
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 16384:
                        return JSONResponse({}, status_code=413)
                    chunks.append(chunk)
                envelope = json.loads(b"".join(chunks))
                payload = self.read(purpose, envelope)
                result = await handler(payload)
                reply = self.sign(purpose + ".reply", {"request": digest(envelope), "result": result})
                return JSONResponse(reply, headers={"Cache-Control": "no-store"})
            except (GrantDenied, ValueError, KeyError, TypeError):
                return JSONResponse({"detail": "Computer grant denied"}, status_code=403)
        return Route(path, respond, methods=["POST"])

class NativeGrants:
    def __init__(self, channel, company, computer, require_member, *, platform_jobs=None):
        self.channel = channel
        self.company = company
        self.computer = computer
        self.require_member = require_member
        self.active = {}
        self.platform_jobs = platform_jobs
        self.viewer_for_run = None

    @contextmanager
    def register(self, op, grant, authorize):
        if op in self.active:
            raise GrantDenied()
        self.active[op] = (native_scope(grant), authorize)
        try:
            yield
        finally:
            del self.active[op]

    def callback_route(self):
        async def respond(request):
            try:
                data = bytearray()
                async for part in request.stream():
                    data.extend(part)
                    if len(data) > 8192:
                        return JSONResponse({}, status_code=413)
                token = json.loads(data)["signedRequest"]
                body = token.split(".", 1)[0]
                msg = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
                if not hmac.compare_digest(token, host_sign(msg, self.channel.key)):
                    raise GrantDenied()
                if (msg["aud"] != "starli-company-run-authorize-v1" or msg["kid"] != "stage-run"
                        or msg["permission"] not in {"computer.view", "computer.control"}
                        or len(msg["nonce"]) != 32):
                    raise GrantDenied()
                # Only a currently registered exact Scope is valid. A completed
                # or revoked call cannot be revived by replaying an old proof.
                item = next((v for v in self.active.values() if v[0] == msg["scope"]), None)
                if item is None or await item[1]() is not True:
                    raise GrantDenied()
                # Agent8 currently asks for control even on the read branch.
                # Check the very permission requested, for both identities.
                scope = item[0]
                for principal in (scope["native_actor_id"], scope["agent_id"]):
                    self.require_member(principal, self.company, permission=msg["permission"])
                result = {"aud": "starli-company-run-authorized-v1", "kid": "stage-run",
                          "nonce": msg["nonce"], "requestDigest": digest(msg), "authorized": True}
                return JSONResponse({"signedResponse": host_sign(result, self.channel.key)},
                                    headers={"Cache-Control": "no-store"})
            except Exception:
                return JSONResponse({"detail": "Computer grant denied"}, status_code=403)
        return Route("/internal/company-computer/authorize", respond, methods=["POST"])

    async def send(self, call, authorize, name, text=None):
        scope = call.native_scope
        if scope.company_id != self.company or await authorize() is not True:
            raise GrantDenied()
        permission = "computer.control" if name == "computer.display_note" else "computer.view"
        def require_both():
            actor = self.require_member(scope.actor_id, self.company, permission=permission)
            self.require_member(scope.bot_id, self.company, permission=permission)
            return actor["membership_revision"]
        revision = require_both()

        async def check():
            try:
                if await authorize() is not True:
                    reason = "runtime"
                elif require_both() != revision:
                    reason = "membership"
                elif self.viewer_for_run(grant, grant["viewerId"]) != grant["viewerId"]:
                    reason = "pinned_viewer"
                else:
                    return True
            except Exception as error:
                code = getattr(error, "code", "")
                reason = code if isinstance(code, str) and re.fullmatch(r"[A-Z_]{1,60}", code) else type(error).__name__
                logging.getLogger(__name__).warning("Computer check failed operation=%s reason=%s", call.operation_id[:12], reason)
                raise
            logging.getLogger(__name__).warning("Computer authorization stopped operation=%s reason=%s", call.operation_id[:12], reason)
            return False

        grant = {"version": 1, "tool": name, "companyId": self.company,
                 "computerId": self.computer, "actorUserId": scope.actor_id,
                 "actorBinding": scope.actor_binding, "membershipRevision": revision,
                 "botId": scope.bot_id, "roomId": scope.room_id, "runId": scope.run_id,
                 "assistantMessageId": scope.assistant_message_id, "toolCallId": scope.tool_call_id,
                 "operationId": call.operation_id}
        if self.viewer_for_run is None:
            raise GrantDenied()
        grant["viewerId"] = self.viewer_for_run(grant)
        if not grant["viewerId"]:
            raise GrantDenied()
        if text is not None:
            grant["noteSha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
        with self.register(call.operation_id, grant, check):
            if self.platform_jobs is None or name != "computer.display_note":
                raise GrantDenied()
            receipt = await self.platform_jobs.display(grant, text, check)
            if await check() is not True:
                raise GrantDenied()
        for field in ("companyId", "computerId", "actorUserId", "runId", "assistantMessageId",
                      "operationId"):
            if receipt.get(field) != grant[field]:
                raise GrantDenied()
        if text is not None and receipt.get("noteSha256") != grant["noteSha256"]:
            raise GrantDenied()
        return receipt

    async def status(self, call, authorize):
        return await self.send(call, authorize, "computer.status")

    async def display_note(self, call, text, authorize):
        return await self.send(call, authorize, "computer.display_note", text)

