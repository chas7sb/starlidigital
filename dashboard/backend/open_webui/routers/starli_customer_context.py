"""Trusted customer-token entry point to the EXISTING native runtime.

Only the customer router calls issue_context after its own strict HTTP parsing.
No native JWT/API-key impersonation and no incoming JSON context is accepted.
"""
from __future__ import annotations
from contextlib import contextmanager
from contextvars import ContextVar
from types import MappingProxyType
from weakref import WeakSet
import os
from fastapi import HTTPException

_SEAL=object()
_ISSUED=WeakSet()
_CURRENT=ContextVar('starli_customer_authority',default=None)

class CustomerContext:
    __slots__=('_store','_principal','_identity','__weakref__')
    kind='customer-token'
    def __init__(self,seal,store,principal,identity):
        if seal is not _SEAL:raise TypeError('Server-issued customer context required')
        object.__setattr__(self,'_store',store)
        object.__setattr__(self,'_principal',principal)
        object.__setattr__(self,'_identity',MappingProxyType(dict(identity)))
        _ISSUED.add(self)
    def __setattr__(self,*args):raise TypeError('Customer context is immutable')
    @property
    def user_id(self):return self._principal.owner_id
    @property
    def token_id(self):return self._principal.token_id
    @property
    def identity(self):return self._identity
    def check(self,chat_id=None):
        require_context(self)
        from open_webui.routers.customer_store import CustomerError
        try:self._store.check(self._principal,'messages:send',self._identity['agentId'])
        except CustomerError as e:raise HTTPException(e.status,e.code) from None
        user,current=_existing(self.user_id,self._identity['agentId'])
        if current!=dict(self._identity) or (chat_id is not None and chat_id!=current['conversationId']):
            raise HTTPException(409,'CUSTOMER_BOT_BINDING_CHANGED')
        return user

def require_context(value):
    if type(value) is not CustomerContext or value not in _ISSUED:
        raise HTTPException(403,'CUSTOMER_PRINCIPAL_REQUIRED')
    return value

def _existing(owner,bot_id):
    from open_webui.models.users import Users
    from open_webui.routers import starli_v3_native as native
    user=Users.get_user_by_id(owner)
    if user is None or user.role not in ('user','admin'):raise HTTPException(401,'CUSTOMER_ACCOUNT_UNAVAILABLE')
    native._ready(user)
    if native._owner(user)!=owner:raise HTTPException(403,'CUSTOMER_OWNER_MISMATCH')
    with native._db() as db:
        row=dict(native._get(db,owner,bot_id))
        bindings=db.execute('SELECT chat_id FROM agent_conversations WHERE owner=? AND agent_id=?',(owner,bot_id)).fetchall()
        # No _boss, ensure_chat_agent, resolve_conversation or binding writes.
        if not bindings:raise HTTPException(409,'CUSTOMER_INITIALIZE_CONVERSATION_IN_STARLI')
        if len(bindings)!=1:raise HTTPException(409,'CUSTOMER_CANONICAL_BINDING_AMBIGUOUS')
        binding=bindings[0]
    if row.get('status')!='IDLE':raise HTTPException(409,'CUSTOMER_BOT_UNAVAILABLE')
    chat_id=binding['chat_id']
    native.owned_live_chat(user,chat_id)
    from open_webui.routers.starli_personal_provider import capture_provider
    if os.getenv('STARLI_RUNTIME_OWNED_PROJECTS')!='1':raise HTTPException(503,'CUSTOMER_NATIVE_RUNTIME_UNAVAILABLE')
    # Same native account/hosted resolver as personal Chat; no credentials copied.
    provider_identity=capture_provider(user,row,'PROJECT')
    return user,{'agentId':row['id'],'conversationId':chat_id,'revision':row['version'],**provider_identity}


def issue_context(store,bearer,bot_id):
    # The factory authenticates the secret itself; constructing a Principal is insufficient.
    principal=store.authenticate(bearer)
    store.check(principal,'messages:send',bot_id)
    user,identity=_existing(principal.owner_id,bot_id)
    context=CustomerContext(_SEAL,store,principal,identity)
    context.check(identity['conversationId'])
    return user,context

@contextmanager
def activate(context):
    require_context(context).check()
    token=_CURRENT.set(context)
    try:yield
    finally:_CURRENT.reset(token)

def current():return _CURRENT.get()
def assert_customer_authority():
    context=current()
    if context is not None:require_context(context).check()
    return context

def mode_identity(context):
    require_context(context).check()
    return dict(context.identity)

def capability_scope():
    from open_webui.routers.starli_project_policy import capability_scope as native_scope
    value=native_scope()
    value['id']='starli-customer-projects.v1'
    value['tools']=[name for name in value['tools'] if name!='starlis.list']
    return value

def authorize_tool(op,args):
    context=assert_customer_authority()
    if context is None:return
    from open_webui.routers.starli_chat_stream import current_capability_scope
    descriptor=current_capability_scope() or capability_scope()
    if descriptor.get('id')!='starli-customer-projects.v1':
        raise HTTPException(403,'CUSTOMER_TOOL_NOT_ALLOWED')
    if op not in descriptor['tools']:
        raise HTTPException(403,'CUSTOMER_TOOL_NOT_ALLOWED')
    if op in ('platform.call','platform.schema'):
        targets=[*descriptor.get('projectTools',[]),*descriptor.get('webTools',[]),*descriptor.get('accountMcpTools',[])]
        if not isinstance(args,dict) or args.get('tool') not in targets:
            raise HTTPException(403,'CUSTOMER_TARGET_NOT_ALLOWED')
