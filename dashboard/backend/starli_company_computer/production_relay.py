"""Register the reviewed first-party frame relay in the enrolled native stage."""
import starli_portable as _portable
import hashlib
import json
import logging
import sqlite3
from contextlib import closing
from pathlib import Path


def install_pilot_relay(app, issuer, session_dependency, private, scope, current):
    from company_frame_relay.relay import EnrolledPublisher
    from company_frame_relay.routes import install
    from production_publisher import publisher_authenticator

    public = (private / "reply-public.pem").read_text()
    authenticate = publisher_authenticator(EnrolledPublisher, {"company-note-reply-v1": public}, company=issuer.company, computer=issuer.computer, worker="company-frame-publisher")

    def publisher_authorize(identity):
        # Check the current device registration on every heartbeat, including
        # browser reads between polls, so revocation takes effect immediately.
        if not current() or identity.company_id != issuer.company or identity.computer_id != issuer.computer:
            return False
        db_path = private.parent / "state/notes.sqlite"
        with closing(sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True, timeout=1)) as db:
            return db.execute(
                "SELECT 1 FROM company_note_principals WHERE id=? AND company=? AND computer=? "
                "AND worker='company-frame-publisher' AND role='publisher' AND revoked=0 AND enrollment_revision=?",
                (identity.publisher_id, issuer.company, issuer.computer, identity.enrollment_revision),
            ).fetchone() is not None

    def binding_authorize(binding):
        # issuer.snapshot() and relay._live() revalidate the originating JWT
        # and membership incarnation for each browser read and publisher work.
        if (not current() or binding.get("companyId") != issuer.company or binding.get("computerId") != issuer.computer
                or binding.get("roomId") != scope["room"] or binding.get("botId") != scope["bot"]):
            return False
        try:
            with issuer.store.db(readonly=True) as db:
                member = issuer.store.authority.require_member(binding["actorUserId"], issuer.company)
                if (member.revision != binding["membershipRevision"] or
                        hashlib.sha256(json.dumps(member.binding, ensure_ascii=False).encode()).hexdigest()
                        != binding["actorBindingSha256"]):
                    return False
                issuer.store.room(db, member, issuer.room)
                issuer.store.agent(db, member, issuer.room, issuer.bot)
                issuer.authority.require_member(member.user_id, issuer.company, permission="computer.view")
                if binding.get("runId"):
                    active = db.execute("SELECT message FROM cr_turns WHERE id=? AND company=? AND "
                                        "room=? AND bot=? AND state='RUNNING'", (binding["runId"], issuer.company,
                                        issuer.room, issuer.bot)).fetchone()
                    if active is None or active["message"] != binding.get("assistantMessageId"):
                        return False
                return True
        except Exception as error:
            logging.getLogger(__name__).warning("Computer viewer binding check denied (%s)", type(error).__name__)
            return False

    return install(app, issuer, session_dependency, publisher_authenticate=authenticate,
                   publisher_authorize=publisher_authorize, binding_authorize=binding_authorize,
                   allowed_origins=(_portable.public_url(''), _portable.public_origin()), replace_compatibility=True)
