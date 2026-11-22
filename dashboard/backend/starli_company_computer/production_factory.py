"""Composition for operator-approved company pilots. Contains no staging IDs or keys."""
from contextlib import closing
from dataclasses import dataclass
import sqlite3
from pathlib import Path
from uuid import UUID

from transport import GrantDenied


@dataclass(frozen=True)
class Enrollment:
    company: str
    computer: str
    worker: str
    revision: int
    producer_ref: str
    issuer_ref: str
    bot: str
    room: str


class PilotRegistry:
    """Read-only enrollment source; provisioned by the platform registrar."""
    def __init__(self, database):
        self.database = Path(database).resolve(strict=True)

    def current(self, company):
        try:
            if str(UUID(company)) != company:
                return None
        except (ValueError, TypeError, AttributeError):
            return None
        with closing(sqlite3.connect(self.database.as_uri() + "?mode=ro", uri=True)) as db:
            row = db.execute(
                "SELECT company,computer,worker,revision,producer_ref,issuer_ref,bot,room FROM "
                "company_computer_enrollments WHERE company=? AND active=1 AND approved=1",
                (company,)).fetchone()
        return Enrollment(*row) if row else None


def make_company_computer(registry, active_company, require_member, components):
    """Bind real providers and native session authority at the application's entry point.

    components(enrollment) returns the enrolled company's Channel and queue.
    Queues must route signed callbacks by company, enrollment revision and
    operation, and live in the native worker that admitted the run.
    """
    def resolve(session, requested_company=None):
        if session.revalidate() is not True:
            raise GrantDenied()
        company = active_company(session.user_id)
        if not company or (requested_company is not None and company != requested_company):
            raise GrantDenied()
        require_member(session.user_id, company, permission="computer.view")
        enrollment = registry.current(company)
        if enrollment is None:
            raise GrantDenied()
        return enrollment

    def available(session, requested_company=None):
        try:
            enrollment = resolve(session, requested_company)
            return components(enrollment).ready() is True
        except (GrantDenied, PermissionError, LookupError, sqlite3.Error):
            return False

    async def display_note(call, text, authorize):
        # Actor and company come from Agent6's validated NativeToolScope.
        scope = call.native_scope
        if await authorize() is not True or active_company(scope.actor_id) != scope.company_id:
            raise GrantDenied()
        enrollment = registry.current(scope.company_id)
        if enrollment is None or enrollment.bot != scope.bot_id or enrollment.room != scope.room_id:
            raise GrantDenied()
        bundle = components(enrollment)
        if bundle.ready() is not True:
            raise GrantDenied()

        async def fresh():
            return (await authorize() is True and active_company(scope.actor_id) == scope.company_id
                    and registry.current(scope.company_id) == enrollment and bundle.ready() is True)

        return await bundle.native_grants.display_note(call, text, fresh)

    return available, resolve, display_note
