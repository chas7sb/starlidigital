"""Typed ports: native sessions and current membership are server-issued only."""
from dataclasses import dataclass
import time


class Denied(Exception):
    def __init__(self, status=403, code='ACCESS_DENIED'):
        self.status, self.code = status, code
        super().__init__(code)


def require(condition, status=403, code='ACCESS_DENIED'):
    if not condition:
        raise Denied(status, code)


@dataclass(frozen=True)
class Session:
    user_id: str
    token_hash: str
    expires_at: float
    kind: str = 'jwt'


@dataclass(frozen=True)
class Member:
    company_id: str
    user_id: str
    membership_id: str
    join_epoch: int
    revision: int

    @property
    def binding(self):
        return f'{self.membership_id}:{self.join_epoch}'


class Authority:
    """Implement using Agent1's DB and native revocation resolver.

    require_member must return a stable membership incarnation (membership_id +
    join_epoch), not a role revision. Removal/rejoin MUST change the incarnation.
    Native authentication and membership are reloaded, never cached by this lane.
    `guard` is an optional integration transaction/lock covering authorization and
    local commit, needed when authority lives outside the native SQLite database.
    """
    def authenticate(self, session: Session):
        raise NotImplementedError

    def require_member(self, user_id: str, company_id: str) -> Member:
        raise NotImplementedError

    def require_agent(self, member: Member, agent_id: str):
        """Return current shared company bot descriptor; never personal bot data."""
        raise NotImplementedError

    def require_attachment(self, member: Member, room_id: str, attachment_id: str):
        """Validate explicit company/room binding and return safe public metadata."""
        raise NotImplementedError

    def directory(self, member: Member, query: str):
        """Bounded [{userId,displayName}] from this company's current members."""
        raise NotImplementedError

    def require_internal_send(self, member, recipient, bot_id, source_room):
        """Check DM policy, bot send permission and source-derived text policy.

        Must deny forwarding private-source information when recipient lacks
        source visibility, unless an explicit authorized share grant exists.
        This lane defaults to recipient-has-source-access, below.
        """
        raise NotImplementedError

    def require_work_permission(self, member, permission, session_id):
        """Distinct discover/observe/create/intervene decisions, default deny."""
        raise NotImplementedError

    def require_bot_run(self, run):
        """Fresh native run/grants/model/membership authority; no client IDs."""
        raise NotImplementedError

    def resolve_link(self, member, room_id, kind, resource_id):
        """Fresh audience guard and server route for a panel/artifact at open."""
        raise NotImplementedError

    def can_dispatch_agent(self, member, agent_id):
        """Fresh per-actor send/run eligibility. Missing adapter fails closed."""
        return False


def actor(authority, session, company):
    customer=False
    if isinstance(session,Session) and session.kind=='customer-token':
        from open_webui.routers.customer_session import authentic
        customer=authentic(session)
    standing=False
    if isinstance(session,Session) and session.kind=='automation-grant':
        from starli_agent_wake.principal import authentic
        standing=authentic(session,authority,company)
    require(isinstance(session, Session) and (session.kind == 'jwt' or customer or standing), 401, 'NATIVE_JWT_REQUIRED')
    require(session.expires_at > time.time(), 401, 'SESSION_EXPIRED')
    require(authority.authenticate(session) is True, 401, 'SESSION_REVOKED')
    member = authority.require_member(session.user_id, company)
    require(isinstance(member, Member) and member.company_id == company and member.user_id == session.user_id)
    return member
