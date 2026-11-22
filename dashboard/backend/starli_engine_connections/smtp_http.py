"""HTTP API, FastAPI mount, and Native Company Tool registration for Company SMTP."""
import starli_portable as _portable

import asyncio
import json
from typing import Any

from starli_automations.common import Fault
from .production import configured_origins
from .smtp import VERSION, CompanySmtpService, SmtpFault, exact, need

_AUTH_FAIL_CODES = frozenset(
    {
        "NATIVE_JWT_REQUIRED",
        "MEMBERSHIP_CHANGED",
        "SMTP_BOT_BINDING_MISMATCH",
        "SMTP_APPROVER_REVOKED",
        "SMTP_ACTOR_REVOKED",
        "SMTP_APPROVAL_NOT_FOUND",
        "SOURCE_CONVERSATION_CHANGED",
        "ROOM_NOT_FOUND",
        "AGENT_NOT_IN_ROOM",
    }
)


def _parse_json_unique(raw: bytes) -> Any:
    def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for k, v in pairs:
            need(k not in out, "DUPLICATE_SMTP_FIELD", 422)
            out[k] = v
        return out

    return json.loads(raw, object_pairs_hook=unique)


def register_tools(runtime: Any, service: CompanySmtpService) -> None:
    """Register the 5 native company SMTP tools into runtime.company_tools."""
    from starli_company_tools.core import ID, REV, ToolSpec, obj

    def _ctx(bound: Any):
        bound.check()
        return service.context(
            bound.session,
            bound.context.company_id,
            bound.context.room_id,
            bound.context.bot_id,
            bound.native_scope,
        )

    def _connections_list(bound: Any, _args: dict[str, Any]) -> dict[str, Any]:
        return service.list_bot_connections(_ctx(bound))

    def _draft_prepare(bound: Any, args: dict[str, Any]) -> dict[str, Any]:
        return service.prepare_draft(_ctx(bound), args, f"{bound.run_id}:{bound.call_id}")

    def _approval_request(bound: Any, args: dict[str, Any]) -> dict[str, Any]:
        return service.request_approval(_ctx(bound), args, f"{bound.run_id}:{bound.call_id}")

    def _send_status(bound: Any, args: dict[str, Any]) -> dict[str, Any]:
        return service.send_status(_ctx(bound), args["approvalId"])

    async def _send(bound: Any, args: dict[str, Any]) -> dict[str, Any]:
        ctx = _ctx(bound)
        key = args.get("idempotencyKey")
        try:
            res = await service.send_approved(ctx, args["approvalId"], idempotency_key=key)
            return {
                "version": VERSION,
                "companyId": ctx.company,
                "ok": True,
                "sent": True,
                "smtpAccepted": True,
                "deliveryVerified": False,
                "retryAllowed": False,
                "idempotentReplay": bool(res.get("idempotentReplay")),
                "receipt": res.get("receipt"),
                "approval": res.get("approval"),
            }
        except SmtpFault as exc:
            if exc.code in _AUTH_FAIL_CODES:
                raise
            latest = None
            try:
                latest = service.send_status(ctx, args["approvalId"])
            except Exception:
                latest = None
            rec = exc.receipt or (latest.get("receipt") if isinstance(latest, dict) else None)
            smtp_acc = rec.get("smtpAccepted") if isinstance(rec, dict) else False
            return {
                "version": VERSION,
                "companyId": ctx.company,
                "ok": False,
                "sent": False,
                "smtpAccepted": smtp_acc,
                "deliveryVerified": False,
                "retryAllowed": False,
                "errorCode": exc.code,
                "receipt": rec,
                "approval": latest.get("approval") if isinstance(latest, dict) else None,
            }

    email_item = {"type": "string", "minLength": 3, "maxLength": 320}
    draft_schema = obj(
        {
            "connectionId": ID,
            "to": {"type": "array", "minItems": 1, "maxItems": 50, "items": email_item},
            "cc": {"type": "array", "minItems": 0, "maxItems": 50, "items": email_item},
            "bcc": {"type": "array", "minItems": 0, "maxItems": 50, "items": email_item},
            "subject": {"type": "string", "minLength": 1, "maxLength": 998},
            "textBody": {"type": "string", "minLength": 0, "maxLength": 50000},
            "htmlBody": {"type": "string", "minLength": 0, "maxLength": 50000},
        },
        ["connectionId", "to", "subject"],
    )
    approval_req_schema = obj(
        {
            "draftId": ID,
            "expectedRevision": REV,
            "note": {"type": "string", "minLength": 0, "maxLength": 500},
        },
        ["draftId"],
    )
    send_schema = obj(
        {
            "approvalId": ID,
            "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 180},
        },
        ["approvalId"],
    )

    specs = (
        ToolSpec(
            "company_smtp_connections_list",
            "List active company SMTP email connections available to this company without exposing secrets or usernames.",
            obj({}),
            "read",
            "starli-company-smtp",
            _connections_list,
            "integrations.run",
        ),
        ToolSpec(
            "company_smtp_draft_prepare",
            "Prepare an immutable email draft bound to an active company SMTP connection, exact recipients (To/Cc/Bcc), subject, plain text and sanitized HTML.",
            draft_schema,
            "write",
            "starli-company-smtp",
            _draft_prepare,
            "integrations.run",
        ),
        ToolSpec(
            "company_smtp_approval_request",
            "Submit a prepared company SMTP draft for explicit human review and render an approval card in this exact conversation.",
            approval_req_schema,
            "write",
            "starli-company-smtp",
            _approval_request,
            "integrations.run",
        ),
        ToolSpec(
            "company_smtp_send_status",
            "Check approval decision and durable SMTP send receipt status. SMTP acceptance never verifies inbox delivery.",
            obj({"approvalId": ID}, ["approvalId"]),
            "read",
            "starli-company-smtp",
            _send_status,
            "integrations.run",
        ),
        ToolSpec(
            "company_smtp_send",
            "Execute a single-flight send for an explicitly human-approved company SMTP draft. Fails closed if rejected, expired, revoked, or previously uncertain (never auto-retries).",
            send_schema,
            "write",
            "starli-company-smtp",
            _send,
            "integrations.run",
        ),
    )
    for spec in specs:
        runtime.company_tools.register(spec)


def install(app: Any, runtime: Any, service: CompanySmtpService, *, allowed_origins: frozenset[str] | None = None) -> CompanySmtpService:
    from fastapi import APIRouter, Depends, Request
    from fastapi.responses import JSONResponse
    from fastapi.routing import APIRoute

    need(not hasattr(app.state, "starli_company_smtp"), "COMPANY_SMTP_ALREADY_INSTALLED", 409)
    origins = frozenset(allowed_origins or _portable.allowed_origins())
    need(bool(origins) and origins <= _portable.allowed_origins(), "SMTP_ORIGIN_CONFIG_INVALID", 503)

    service.install_card_projection()
    register_tools(runtime, service)

    class SafeSmtpRoute(APIRoute):
        def get_route_handler(self):
            handler = super().get_route_handler()

            async def safe(request: Request):
                try:
                    if request.method not in ("GET", "HEAD"):
                        need(request.headers.get("authorization", "").startswith("Bearer "), "NATIVE_BEARER_REQUIRED", 401)
                        need(request.headers.get("sec-fetch-site") != "cross-site", "SAME_ORIGIN_REQUIRED", 403)
                        origin = request.headers.get("origin")
                        need(origin is None or origin in origins, "SAME_ORIGIN_REQUIRED", 403)

                    size = request.headers.get("content-length")
                    need(size is None or (size.isdigit() and int(size) <= 131072), "INPUT_LIMIT", 413)

                    async def read_limited() -> bytes:
                        body = bytearray()
                        async for chunk in request.stream():
                            need(len(body) + len(chunk) <= 131072, "INPUT_LIMIT", 413)
                            body.extend(chunk)
                        return bytes(body)

                    request._body = await asyncio.wait_for(read_limited(), 5)
                    response = await handler(request)
                except SmtpFault as error:
                    payload: dict[str, Any] = {"code": error.code}
                    if error.receipt is not None:
                        payload["receipt"] = error.receipt
                    response = JSONResponse(status_code=error.status, content={"detail": payload})
                except Fault as error:
                    response = JSONResponse(status_code=error.status, content={"detail": {"code": error.code}})
                except (ValueError, TypeError, TimeoutError):
                    response = JSONResponse(status_code=422, content={"detail": {"code": "INVALID_SMTP_INPUT"}})
                response.headers.update(
                    {
                        "Cache-Control": "no-store",
                        "Pragma": "no-cache",
                        "Referrer-Policy": "no-referrer",
                        "X-Content-Type-Options": "nosniff",
                    }
                )
                return response

            return safe

    router = APIRouter(prefix="/api/v1/starli/companies/{company}/integrations/smtp", route_class=SafeSmtpRoute)
    dep = app.state.company_messaging_session

    def _ctx(principal: Any, company: str, room: str | None = None):
        return service.context(principal, company, room)

    @router.get("/connections")
    def list_connections(company: str, principal=Depends(dep)):
        return service.list_admin_connections(_ctx(principal, company))

    @router.post("/connections")
    async def create_connection(company: str, request: Request, principal=Depends(dep)):
        form = _parse_json_unique(await request.body())
        return service.create_connection(_ctx(principal, company), form)

    @router.put("/connections/{ident}")
    async def update_connection(company: str, ident: str, request: Request, principal=Depends(dep)):
        form = _parse_json_unique(await request.body())
        return service.update_connection(_ctx(principal, company), ident, form)

    @router.post("/connections/{ident}/test")
    async def test_connection(company: str, ident: str, principal=Depends(dep)):
        return await service.test_connection(_ctx(principal, company), ident)

    @router.post("/connections/{ident}/revoke")
    async def revoke_connection(company: str, ident: str, request: Request, principal=Depends(dep)):
        form = _parse_json_unique(await request.body())
        exact(form, ("expectedRevision",))
        return service.revoke_connection(_ctx(principal, company), ident, form["expectedRevision"])

    @router.get("/receipts")
    def receipts(company: str, roomId: str | None = None, principal=Depends(dep)):
        return service.list_receipts(_ctx(principal, company, roomId), room_id=roomId)

    @router.get("/approvals/{ident}")
    def get_approval(company: str, ident: str, sourceConversationId: str | None = None, principal=Depends(dep)):
        return service.get_approval(_ctx(principal, company, sourceConversationId), ident)

    @router.post("/approvals/{ident}/decision")
    async def decide_approval(company: str, ident: str, request: Request, principal=Depends(dep)):
        form = _parse_json_unique(await request.body())
        return service.decide_approval(_ctx(principal, company), ident, form)

    @router.post("/approvals/{ident}/send")
    async def send_approval(company: str, ident: str, request: Request, principal=Depends(dep)):
        raw = await request.body()
        form = _parse_json_unique(raw) if raw.strip() else {}
        exact(form, (), ("idempotencyKey", "sourceConversationId"))
        return await service.send_approved(
            _ctx(principal, company, form.get("sourceConversationId")),
            ident,
            idempotency_key=form.get("idempotencyKey"),
        )

    idx = next((i for i, route in enumerate(app.router.routes) if getattr(route, "path", None) == ""), len(app.router.routes))
    app.router.routes[idx:idx] = router.routes
    app.state.starli_company_smtp = service
    return service


def install_production(app: Any, runtime: Any) -> CompanySmtpService:
    """Mount company SMTP onto the production app reusing app.state.starli_automations Vault & RBAC."""
    from starli_automations.native import native_permission

    need(runtime is getattr(app.state, "company_bot_runtime", None), "NATIVE_RUNTIME_REQUIRED", 503)
    gateway = getattr(app.state, "starli_automations", None)
    need(gateway is not None and gateway.store is runtime.store and gateway.connections.vault is not None, "NATIVE_COMPANY_VAULT_REQUIRED", 503)
    service = CompanySmtpService(runtime.store, native_permission(runtime), gateway.connections.vault)
    service.recover()
    return install(app, runtime, service, allowed_origins=configured_origins(gateway))
