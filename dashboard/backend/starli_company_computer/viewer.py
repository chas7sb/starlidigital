"""Short-lived native viewer grants for the enrolled company desktop."""
import base64
import json
import secrets
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from starlette.responses import JSONResponse

from transport import digest


class ViewerIssuer:
    def __init__(self, key, company, computer, room, bot, store, authority, *, clock=time.time):
        self.key = key
        self.company, self.computer, self.room, self.bot = company, computer, room, bot
        self.store, self.authority, self.clock = store, authority, clock
        self.boot = secrets.token_hex(16)

    def snapshot(self, session):
        with self.store.access(session, self.company, self.room, readonly=True) as (db, member, room):
            if room["visibility"] != "public" or session.revalidate() is not True:
                raise PermissionError()
            self.store.agent(db, member, self.room, self.bot)
            self.authority.require_member(session.user_id, self.company, permission="computer.view")
            # Only the native room's captured assistant may be associated. A
            # browser cannot name a different run or supply its own actor ID.
            row = db.execute("SELECT id,message FROM cr_turns WHERE company=? AND room=? AND bot=? "
                             "AND state='RUNNING' ORDER BY rowid DESC LIMIT 1",
                             (self.company, self.room, self.bot)).fetchone()
            values = (self.boot, session.token_hash, self.company, self.room, member.binding, member.revision)
            return {"companyId": self.company, "computerId": self.computer,
                    "roomId": self.room, "botId": self.bot, "actorUserId": session.user_id,
                    "membershipRevision": member.revision, "actorBindingSha256": digest(member.binding),
                    "viewerId": str(uuid.uuid5(uuid.NAMESPACE_URL, digest(values))),
                    "runId": row["id"] if row else None, "assistantMessageId": row["message"] if row else None}

    def issue(self, session, operation):
        if operation not in {"open", "frame"}:
            raise ValueError("Unsupported viewer operation")
        scope = self.snapshot(session)
        now = int(self.clock())
        claims = {"aud": "starli-company-stage-viewer-v1", "issuer": self.boot,
                  "operation": operation, "nonce": secrets.token_hex(16), "iat": now,
                  "exp": now + 5, **scope}
        encoded = json.dumps(claims, sort_keys=True, separators=(",", ":")).encode()
        def b64(raw):
            return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
        return {"claims": claims, "signature": b64(self.key.sign(encoded))}


def make_viewer_router(issuer, native_session):
    router = APIRouter(prefix="/api/v1/companies/{company}/computer")

    @router.post("/viewer-grants/{operation}")
    async def issue(company: str, operation: str, session=Depends(native_session)):
        if company != issuer.company or operation not in ("open", "frame"):
            raise HTTPException(404)
        try:
            result = issuer.issue(session, operation)
        except Exception:
            raise HTTPException(403, "Viewer access denied") from None
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    return router
