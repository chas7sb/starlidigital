"""In-process sealed standing principals. Never parse from HTTP or serialize."""
from dataclasses import dataclass,field
from company_messaging.authority import Session
_registry={}
@dataclass(frozen=True)
class StandingSession(Session):
    revalidate:object=field(default=None,repr=False,compare=False)
def register(session,service,grant):_registry[id(session)]=(session,service,grant)
def authentic(session,authority=None,company=None):
    entry=_registry.get(id(session))
    if entry is None or entry[0] is not session:return False
    _,service,grant=entry
    if authority is not None and authority is not service.store.authority:return False
    return service.validate_session(session,grant,company)
def forget(session):_registry.pop(id(session),None)

def is_verified_principal(session,authority=None,company=None):
    return type(session)is StandingSession and authentic(session,authority,company)
