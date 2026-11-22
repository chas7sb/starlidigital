"""Permanent, revocable owner-authorized FIRST-PARTY read-only MCP tools for company bots.

Never grants blanket MCP access. All tool calls still use the original account
registry, immutable schema/revision leases, native run+room fences, and the
once-only remote invocation journal. No credential is copied into grant rows.
"""
from __future__ import annotations
import json
import re
import time
import uuid

from .core import ToolFault, require
from open_webui.starli_account_mcp.account_mcp.runtime import RuntimeSnapshot
from open_webui.starli_account_mcp.account_mcp.firstparty_mcp import PUBLIC_URL

SAFE_FIRSTPARTY_TOOLS = frozenset({
    "ops_health", "platform_overview", "platform_capabilities"
})
SAFE_TRANSPORT = "streamable-http"
MAX_GRANTS_PER_ROOM = 1


def _context_hash(ctx):
    from .mcp import context_key
    return context_key(ctx)


def _identity(user):
    return user.get("id") if isinstance(user, dict) else getattr(user, "id", None)


def _single_owner_dm(ctx):
    require(
        ctx.visibility == "private"
        and len(ctx.audience) == 1
        and ctx.audience[0][0] == ctx.actor_id,
        "COMPANY_MCP_ALWAYS_PRIVATE_OWNER_DM_REQUIRED",
    )


class AlwaysMcpGrants:
    """Grant manager. An explicit human approval is required to add/renew grants."""
    def __init__(self, service, adapter, capture):
        self.service = service
        self.adapter = adapter
        self.capture = capture
        self.runs = {}

    def install(self, runtime):
        with runtime.store.db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS cr_account_mcp_always_grants(
                id TEXT PRIMARY KEY,
                owner TEXT NOT NULL, company TEXT NOT NULL, room TEXT NOT NULL,
                bot TEXT NOT NULL, actor_binding TEXT NOT NULL,
                context_hash TEXT NOT NULL, server TEXT NOT NULL,
                server_revision INTEGER NOT NULL, selection TEXT NOT NULL,
                status TEXT NOT NULL, created REAL NOT NULL, revoked REAL
            )""")
            db.execute("""CREATE INDEX IF NOT EXISTS cr_mcp_always_scope_idx
                ON cr_account_mcp_always_grants(owner,company,room,bot,status)""")
            db.execute("""CREATE TABLE IF NOT EXISTS cr_account_mcp_always_audit(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                grant_id TEXT NOT NULL, owner TEXT NOT NULL,
                company TEXT NOT NULL, room TEXT NOT NULL, bot TEXT NOT NULL,
                action TEXT NOT NULL, happened REAL NOT NULL, detail TEXT NOT NULL
            )""")

    def _require_scope(self, runtime, session, ctx, *, approve=False):
        require(
            session.kind == "jwt"
            and session.user_id == ctx.actor_id
            and session.revalidate() is True,
            "COMPANY_MCP_ALWAYS_NATIVE_JWT_REQUIRED",
        )
        _single_owner_dm(ctx)
        for who in (ctx.actor_id, ctx.bot_id):
            for permission in ("tools.dispatch", "integrations.run"):
                runtime.authority.require_member(
                    who, ctx.company_id, permission=permission)
        if approve:
            who = runtime.authority.require_member(
                ctx.actor_id, ctx.company_id, permission="connections.manage")
            require(
                who.get("role") == "owner" and who.get("kind") == "person",
                "COMPANY_MCP_ALWAYS_COMPANY_OWNER_REQUIRED",
            )
        from company_messaging.context import revalidate
        revalidate(runtime.store, session, ctx)
        return True

    def _registry(self, session, ctx):
        self._require_session(session, ctx)
        user = self.service.user_lookup(ctx.actor_id)
        require(
            user is not None and _identity(user) == ctx.actor_id,
            "COMPANY_MCP_ALWAYS_ACCOUNT_DENIED",
        )

        class NativeFence:
            kind = "jwt"
            def check(self):
                require(
                    session.revalidate() is True,
                    "COMPANY_MCP_ALWAYS_NATIVE_JWT_REQUIRED")
                fresh = self_service.user_lookup(ctx.actor_id)
                require(
                    fresh is not None and _identity(fresh) == ctx.actor_id,
                    "COMPANY_MCP_ALWAYS_ACCOUNT_DENIED")
                return fresh

        self_service = self.service
        return self.service.registry_for(user, NativeFence()), NativeFence()

    @staticmethod
    def _require_session(session, ctx):
        require(
            getattr(session, "kind", None) == "jwt"
            and getattr(session, "user_id", None) == ctx.actor_id
            and session.revalidate() is True,
            "COMPANY_MCP_ALWAYS_NATIVE_JWT_REQUIRED",
        )

    def _active(self, runtime, ctx):
        with runtime.store.db(readonly=True) as db:
            rows = db.execute(
                """SELECT * FROM cr_account_mcp_always_grants
                    WHERE owner=? AND company=? AND room=? AND bot=?
                    AND actor_binding=? AND context_hash=? AND status='ACTIVE'
                    ORDER BY created DESC LIMIT 2""",
                (ctx.actor_id, ctx.company_id, ctx.room_id, ctx.bot_id,
                 ctx.actor_binding, _context_hash(ctx))).fetchall()
        require(len(rows) <= MAX_GRANTS_PER_ROOM,
                "COMPANY_MCP_ALWAYS_GRANT_CONFLICT", 409)
        return dict(rows[0]) if rows else None

    def active(self, runtime, session, ctx):
        self._require_scope(runtime, session, ctx)
        return self._active(runtime, ctx)

    def _validate_selection(self, registry, owner, server_id, expected_revision,
                            tool_names):
        require(
            type(server_id) is str and type(expected_revision) is int
            and type(tool_names) is list
            and 1 <= len(tool_names) <= len(SAFE_FIRSTPARTY_TOOLS)
            and all(type(n) is str and
                    re.fullmatch(r"[A-Za-z0-9_]+__[0-9a-f]{20}", n) is not None
                    for n in tool_names)
            and len(set(tool_names)) == len(tool_names),
            "COMPANY_MCP_ALWAYS_TOOL_NOT_APPROVABLE", 422)
        with registry.db() as db:
            row = registry.getrow(db, owner, server_id)
            require(
                row["enabled"] == 1 and
                row["revision"] == expected_revision and
                row["url"] == PUBLIC_URL and
                row["transport"] == SAFE_TRANSPORT,
                "COMPANY_MCP_ALWAYS_FIRST_PARTY_REVISION_REQUIRED", 409)
            tools = json.loads(row["tools"])
        from open_webui.starli_account_mcp.account_mcp.runtime import digest, supported
        hashes = {}
        original_names = set()
        for wanted in tool_names:
            matches = [t for t in tools if t["publicName"] == wanted]
            require(
                len(matches) == 1
                and matches[0]["name"] in SAFE_FIRSTPARTY_TOOLS
                and matches[0]["name"] not in original_names
                and supported(matches[0]["inputSchema"]),
                "COMPANY_MCP_ALWAYS_TOOL_NOT_APPROVABLE", 422)
            hashes[wanted] = digest(matches[0]["inputSchema"])
            original_names.add(matches[0]["name"])
        return [{
            "serverId": server_id,
            "expectedRevision": expected_revision,
            "toolNames": sorted(hashes),
            "schemaHashes": hashes,
        }]

    def approve(self, runtime, session, ctx, request, form):
        self._require_scope(runtime, session, ctx, approve=True)
        require(
            isinstance(form, dict) and
            set(form) == {
                "conversationId", "serverId", "expectedRevision",
                "toolNames", "acknowledgeAudienceSharing",
                "acknowledgePersistentAccess",
            } and
            form["conversationId"] == ctx.room_id and
            form["acknowledgeAudienceSharing"] is True and
            form["acknowledgePersistentAccess"] is True,
            "COMPANY_MCP_ALWAYS_APPROVAL_INVALID", 422)
        require(
            getattr(self.adapter, "available", False) is True,
            "MCP_TRANSPORT_UNAVAILABLE", 503)
        registry, fence = self.capture(session, request)
        selection = self._validate_selection(
            registry, ctx.actor_id, form["serverId"],
            form["expectedRevision"], form["toolNames"])
        self._require_scope(runtime, session, ctx, approve=True)
        registry.auth(ctx.actor_id)
        identifier = str(uuid.uuid4())
        now = time.time()
        with runtime.store.access(session, ctx.company_id, ctx.room_id) as (db, _, _):
            db.execute("""UPDATE cr_account_mcp_always_grants
                SET status='REPLACED',revoked=?
                WHERE owner=? AND company=? AND room=? AND bot=? AND status='ACTIVE'""",
                (now, ctx.actor_id, ctx.company_id, ctx.room_id, ctx.bot_id))
            db.execute(
                """INSERT INTO cr_account_mcp_always_grants
                VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,NULL)""",
                (identifier, ctx.actor_id, ctx.company_id, ctx.room_id,
                 ctx.bot_id, ctx.actor_binding, _context_hash(ctx),
                 form["serverId"], form["expectedRevision"],
                 json.dumps(selection, sort_keys=True, separators=(",", ":")),
                 "ACTIVE", now))
            db.execute("""INSERT INTO cr_account_mcp_always_audit(
                grant_id,owner,company,room,bot,action,happened,detail)
                VALUES(?,?,?,?,?,'APPROVED',?,?)""",
                (identifier, ctx.actor_id, ctx.company_id, ctx.room_id,
                 ctx.bot_id, now, json.dumps({
                     "serverId": form["serverId"],
                     "expectedRevision": form["expectedRevision"],
                     "toolNames": sorted(form["toolNames"])
                 })))
        return {
            "version": "starli.company-mcp-always.v1",
            "grantId": identifier, "state": "ACTIVE",
            "nextTurnOnly": False, "ownerApproval": "native-jwt",
            "botId": ctx.bot_id, "companyId": ctx.company_id,
            "conversationId": ctx.room_id,
            "toolNames": sorted(form["toolNames"]),
            "revocable": True,
        }

    def list(self, runtime, session, ctx):
        self._require_scope(runtime, session, ctx)
        with runtime.store.db(readonly=True) as db:
            rows = db.execute(
                """SELECT id,server,server_revision,selection,created,status
                   FROM cr_account_mcp_always_grants
                   WHERE owner=? AND company=? AND room=? AND bot=?
                     AND status='ACTIVE' ORDER BY created DESC LIMIT 10""",
                (ctx.actor_id, ctx.company_id, ctx.room_id,
                 ctx.bot_id)).fetchall()
        return {
            "version": "starli.company-mcp-always.v1",
            "companyId": ctx.company_id, "botId": ctx.bot_id,
            "conversationId": ctx.room_id,
            "grants": [
                {
                    "grantId": row["id"], "serverId": row["server"],
                    "serverRevision": row["server_revision"],
                    "toolNames": json.loads(row["selection"])[0]["toolNames"],
                    "status": row["status"], "createdAt": row["created"],
                } for row in rows
            ],
        }

    def revoke(self, runtime, session, ctx, identifier):
        self._require_scope(runtime, session, ctx, approve=True)
        require(
            type(identifier) is str
            and re.fullmatch(r"[0-9a-f-]{36}", identifier) is not None,
            "COMPANY_MCP_ALWAYS_GRANT_INVALID", 422)
        now = time.time()
        with runtime.store.access(session, ctx.company_id, ctx.room_id) as (db, _, _):
            changed = db.execute(
                """UPDATE cr_account_mcp_always_grants
                   SET status='REVOKED',revoked=?
                   WHERE id=? AND owner=? AND company=? AND room=? AND bot=?
                   AND status='ACTIVE'""",
                (now, identifier, ctx.actor_id, ctx.company_id,
                 ctx.room_id, ctx.bot_id)).rowcount
            require(changed == 1, "COMPANY_MCP_ALWAYS_GRANT_NOT_FOUND", 404)
            db.execute("""INSERT INTO cr_account_mcp_always_audit(
                grant_id,owner,company,room,bot,action,happened,detail)
                VALUES(?,?,?,?,?,'REVOKED',?,'{}')""",
                (identifier, ctx.actor_id, ctx.company_id,
                 ctx.room_id, ctx.bot_id, now))
        return {"grantId": identifier, "state": "REVOKED", "revoked": True}

    def availability(self, runtime, session, ctx):
        row = self.active(runtime, session, ctx)
        if row is None:
            return {}
        try:
            selection = json.loads(row["selection"])
            refs = {name: (s["expectedRevision"], s["schemaHashes"][name])
                    for s in selection for name in s["toolNames"]}
            return refs
        except (ValueError, TypeError, KeyError):
            return {}

    async def runtime_catalogue(self, runtime, session, ctx, selection, run):
        if run in self.runs:
            return self.schemas(run)
        grant = self.active(runtime, session, ctx)
        if grant is None:
            return []
        require(runtime.authorize_run(session, ctx.company_id, ctx.bot_id,
                                      ctx.room_id, run),
                "COMPANY_MCP_RUN_REVOKED")
        with runtime.store.access(session, ctx.company_id, ctx.room_id, readonly=True) as (db, _, _):
            row = db.execute(
                """SELECT message FROM cr_turns WHERE id=? AND company=? AND
                   room=? AND bot=? AND actor=? AND binding=?""",
                (run, ctx.company_id, ctx.room_id, ctx.bot_id,
                 ctx.actor_id, ctx.actor_binding)).fetchone()
            require(row is not None, "COMPANY_MCP_RUN_REVOKED")
            assistant_id = row["message"]
        self_service = self.service

        class NativeFence:
            kind = "jwt"
            def check(self, room=None):
                require(room in (None, ctx.room_id),
                        "COMPANY_MCP_ROOM_CHANGED")
                require(session.revalidate() is True,
                        "COMPANY_MCP_NATIVE_JWT_REQUIRED")
                user = self_service.user_lookup(ctx.actor_id)
                require(user is not None and _identity(user) == ctx.actor_id,
                        "COMPANY_MCP_ACCOUNT_DENIED")
                return user

        user = self_service.user_lookup(ctx.actor_id)
        require(user is not None and _identity(user) == ctx.actor_id,
                "COMPANY_MCP_ACCOUNT_DENIED")
        registry = self_service.registry_for(user, NativeFence())

        from company_messaging.internal_send import NativeToolScope
        from company_messaging.context import revalidate

        def check():
            revalidate(runtime.store, session, ctx)
            self._require_scope(runtime, session, ctx)
            require(runtime.authorize_run(session, ctx.company_id, ctx.bot_id,
                                          ctx.room_id, run),
                    "COMPANY_MCP_RUN_REVOKED")
            native = NativeToolScope(
                ctx.company_id, ctx.room_id, ctx.bot_id, run,
                "mcp-always:" + grant["id"], ctx.actor_id,
                ctx.actor_binding, ctx, assistant_id)
            with runtime.store.access(session, ctx.company_id, ctx.room_id, readonly=True) as (db, _, _):
                require(runtime.authorize_native(db, native),
                        "COMPANY_MCP_NATIVE_RUN_REVOKED")
            current = self._active(runtime, ctx)
            require(
                current is not None and
                current["id"] == grant["id"] and
                current["server_revision"] == grant["server_revision"] and
                current["selection"] == grant["selection"],
                "COMPANY_MCP_ALWAYS_GRANT_REVOKED")
            registry.auth(ctx.actor_id)
            return True

        from .mcp import DelegatedRegistry
        selected = json.loads(grant["selection"])
        check()
        delegated = DelegatedRegistry(
            registry, selected, check, ctx.actor_id, ctx.bot_id)
        class CompanyFence:
            kind = "jwt"
            def check(self, room=None):
                require(room in (None, ctx.room_id),
                        "COMPANY_MCP_ROOM_CHANGED")
                check()
                return user
        def binding(owner, bot, room, turn):
            check()
            return (owner, bot, room, turn) == (
                ctx.actor_id, ctx.bot_id, ctx.room_id, run)
        snapshot = RuntimeSnapshot(
            delegated, self.adapter, owner=ctx.actor_id, agent=ctx.bot_id,
            chat=ctx.room_id, run=run, fence=CompanyFence(),
            authorize_binding=binding)
        self.runs[run] = {
            "snapshot": snapshot, "grantId": grant["id"],
            "assistantId": assistant_id, "completed": set()
        }
        return self.schemas(run)

    def schemas(self, run):
        state = self.runs.get(run)
        if state is None:
            return []
        return [
            {"name": s["name"], "description": s["description"],
             "parameters": s["inputSchema"], "effect": "read"}
            for s in state["snapshot"].schemas()
        ]

    def owns(self, run, name):
        state = self.runs.get(run)
        return bool(state is not None and name in state["snapshot"].tools)

    async def execute(self, runtime, session, ctx, selection, run, value):
        require(
            type(value) is dict
            and set(value) == {"toolCallId", "name", "args"}
            and isinstance(value["toolCallId"], str)
            and re.fullmatch(r"[A-Za-z0-9_.:-]{1,180}", value["toolCallId"]) is not None,
            "COMPANY_MCP_CALL_INVALID", 422)
        saved = runtime.scopes.get(run)
        require(
            saved is not None and saved[0] is session
            and saved[1] == ctx and saved[2] == selection,
            "COMPANY_MCP_CONTEXT_CHANGED")
        state = self.runs.get(run)
        require(state is not None and value["name"] in state["snapshot"].tools,
                "COMPANY_MCP_ALWAYS_TOOL_NOT_GRANTED")
        from company_messaging.internal_send import NativeToolScope
        native = NativeToolScope(
            ctx.company_id, ctx.room_id, ctx.bot_id, run,
            value["toolCallId"], ctx.actor_id, ctx.actor_binding,
            ctx, state["assistantId"])
        with runtime.store.access(session, ctx.company_id, ctx.room_id, readonly=True) as (db, _, _):
            require(runtime.authorize_native(db, native),
                    "COMPANY_MCP_NATIVE_RUN_REVOKED")
        response = await state["snapshot"].dispatch(
            value["name"], value["args"], value["toolCallId"])
        if response["state"] == "SUCCEEDED":
            state["completed"].add((value["name"], value["toolCallId"]))
        return {
            "outcome": "settled",
            "result": {
                "content": [{
                    "type": "text",
                    "text": json.dumps({
                        "ownership": "account-owner",
                        "companyOwned": False,
                        "authorization": "persistent-owner-approved-read-only",
                        "grantId": state["grantId"],
                        "untrustedData": True,
                        **response,
                    }),
                }]
            },
        }

    def event_allowed(self, run, value):
        state = self.runs.get(run)
        if state is None:
            return False
        return (
            value.get("status") != "succeeded"
            or (value.get("name"), value.get("toolCallId"))
            in state["completed"]
        )

    def release(self, run):
        self.runs.pop(run, None)
