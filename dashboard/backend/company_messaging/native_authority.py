"""Same-DB Agent1 adapter with stable incarnation derived from its audit log.

Agent1 v1 increments `revision` for role changes AND remove/rejoin. We must not
use that revision as a private-room incarnation. Its immutable create/accept
audit row ID is a stable join epoch until rejoin. Fail closed without that row.
All callbacks below are server-owned native adapters, never HTTP input.
"""
import hashlib
import re
from contextlib import contextmanager
from contextvars import ContextVar
from .authority import Authority, Member, require


class NativeAuthority(Authority):
    def __init__(self,authenticate,shared_bot,attachment,internal_policy,work_policy,bot_run,link_resolver=None,authority_schema='main',dispatch_agent=None):
        require(re.fullmatch(r'[a-z][a-z_]{0,40}',authority_schema),503,'INVALID_AUTHORITY_SCHEMA')
        self.schema=authority_schema
        self._db=ContextVar('company_messaging_authority_db',default=None)
        self._authenticate=authenticate;self._shared_bot=shared_bot
        self._attachment=attachment;self._internal_policy=internal_policy
        self._work_policy=work_policy;self._bot_run=bot_run
        self._link_resolver=link_resolver
        self._dispatch_agent=dispatch_agent

    @contextmanager
    def bind_connection(self,db):
        token=self._db.set(db)
        try:yield
        finally:self._db.reset(token)

    def connection(self):
        db=self._db.get();require(db is not None,503,'ATOMIC_AUTHORITY_REQUIRED')
        return db

    def authenticate(self,session):return self._authenticate(session)

    def require_member(self,user_id,company_id):
        db=self.connection()
        row=db.execute('SELECT role,active,revision,kind FROM '+self.schema+'.members WHERE company_id=? AND user_id=?',(company_id,user_id)).fetchone()
        require(row is not None and row['active']==1 and row['kind']=='person')
        epoch=db.execute("SELECT max(id) FROM "+self.schema+".audit WHERE company_id=? AND actor=? AND action IN ('create','accept')",(company_id,user_id)).fetchone()[0]
        require(epoch is not None,503,'MEMBERSHIP_INCARNATION_REQUIRED')
        membership_id=hashlib.sha256((company_id+'\0'+user_id).encode()).hexdigest()
        return Member(company_id,user_id,membership_id,epoch,row['revision'])

    def require_agent(self,member,agent_id):return self._shared_bot(self.connection(),member,agent_id)
    def require_attachment(self,member,room_id,attachment_id):return self._attachment(self.connection(),member,room_id,attachment_id)
    def require_internal_send(self,member,recipient,bot_id,source_room):return self._internal_policy(self.connection(),member,recipient,bot_id,source_room)
    def require_work_permission(self,member,permission,session_id):return self._work_policy(self.connection(),member,permission,session_id)
    def require_bot_run(self,run):return self._bot_run(self.connection(),run)
    def can_dispatch_agent(self,member,agent_id):
        return self._dispatch_agent is not None and self._dispatch_agent(self.connection(),member,agent_id) is True
    def resolve_link(self,member,room_id,kind,resource_id):
        require(self._link_resolver is not None,403,'LINK_UNAVAILABLE')
        return self._link_resolver(self.connection(),member,room_id,kind,resource_id)

    def directory(self,member,query):
        rows=self.connection().execute("SELECT user_id,name FROM "+self.schema+".members WHERE company_id=? AND active=1 AND kind='person' ORDER BY user_id LIMIT 1001",(member.company_id,)).fetchall()
        require(len(rows)<=1000,503,'DIRECTORY_PAGINATION_REQUIRED')
        exact=[r for r in rows if r[0]==query]
        matches=exact or [r for r in rows if r[1].strip().casefold()==query.strip().casefold()]
        require(len(matches)<=50,422,'RECIPIENT_AMBIGUOUS')
        return [{'userId':r[0],'displayName':r[1]} for r in matches]
