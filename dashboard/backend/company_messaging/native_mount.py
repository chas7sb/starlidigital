"""Actual native route installation. All state remains in the native SQLite DB."""
import hashlib
import time
from contextlib import closing
from dataclasses import dataclass, field
from pathlib import Path
from fastapi import Depends, Request
from pydantic import BaseModel,ConfigDict
from .authority import Session, Denied, require
from .native_authority import NativeAuthority
from .store import Store
from .http import make_router


class BotTurn(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    botId:str
    sourceMessageId:str


@dataclass(frozen=True)
class NativeSession(Session):
    revalidate:object=field(default=None,repr=False,compare=False)


def install(app,database,*,authority_database=None,registry_database=None,authority_class=None,run_authorizer=None,link_resolver=None):
    from open_webui.utils.auth import get_verified_user,decode_token
    from open_webui.utils.native_authorization import current_user
    from open_webui.routers.starli_session_revocation import assert_session_allowed
    if authority_class is None:
        from open_webui.company_authority.company_rbac import Authority
        authority_class=Authority
    # Initialize authority schema once before concurrent route transactions.
    path=str(Path(database).resolve())
    company_path=str(Path(authority_database or path).resolve())
    registry_path=str(Path(registry_database or company_path).resolve())
    require(Path(path).is_file() and Path(company_path).is_file() and Path(registry_path).is_file(),503,'EXISTING_DATABASE_MAPPING_REQUIRED')
    bootstrap=authority_class(company_path);bootstrap.db.close()
    attached={}
    authority_schema='main'
    if company_path!=path:attached['company_authority']=company_path;authority_schema='company_authority'
    registry_schema=authority_schema if registry_path==company_path else 'main'
    if registry_path not in (path,company_path):attached['company_bots']=registry_path;registry_schema='company_bots'
    if authority_schema!='main':
        import sqlite3
        with closing(sqlite3.connect(path)) as check:
            names={r[0] for r in check.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        require(not names.intersection({'members','companies','audit','custom_roles','role_assignments'}),503,'AUTHORITY_TABLE_COLLISION')
    def scoped(db):
        authority=object.__new__(authority_class);authority.db=db
        return authority
    def permission(db,user,company,capability='read'):
        try:return scoped(db).require_member(user,company,permission=capability)
        except Exception as error:
            if error.__class__.__name__=='Forbidden':raise Denied(403,'COMPANY_PERMISSION_DENIED') from None
            raise
    def authenticate(session):
        return isinstance(session,NativeSession) and callable(session.revalidate) and session.revalidate() is True
    def bot(db,member,bot_id):
        permission(db,member.user_id,member.company_id,'read')
        row=db.execute("SELECT id,kind,owner,revision,active FROM "+registry_schema+".bots WHERE id=?",(bot_id,)).fetchone()
        require(row is not None and row['kind']=='company' and row['owner']==member.company_id and row['active']==1,404,'COMPANY_BOT_NOT_FOUND')
        return {'id':row['id'],'companyId':row['owner'],'revision':row['revision']}
    def internal(db,member,target,bot_id,source):
        permission(db,member.user_id,member.company_id,'messages.send')
        permission(db,bot_id,member.company_id,'messages.send')
        bot(db,member,bot_id)
        return True  # Recipient source visibility is additionally enforced by service.
    def work(db,member,action,room):
        capability='read' if action in ('observe','discover') else 'messages.send'
        try:permission(db,member.user_id,member.company_id,capability);return True
        except Denied:return False
    def run(db,value):
        permission(db,value.actor_id,value.company_id,'bots.run')
        permission(db,value.bot_id,value.company_id,'bots.run')
        permission(db,value.bot_id,value.company_id,'messages.send')
        checker=run_authorizer or getattr(app.state,'company_messaging_authorize_run',None)
        require(checker is not None,403,'NATIVE_RUNTIME_NOT_INSTALLED')
        return checker(db,value) is True
    def attachment(*args):raise Denied(403,'COMPANY_ATTACHMENT_BINDING_REQUIRED')
    def dispatch_agent(db,member,bot_id):
        permission(db,member.user_id,member.company_id,'messages.send')
        permission(db,member.user_id,member.company_id,'bots.run')
        permission(db,bot_id,member.company_id,'bots.run')
        permission(db,bot_id,member.company_id,'messages.send')
        descriptor=bot(db,member,bot_id)
        readiness=getattr(app.state,'company_messaging_bot_eligible',None)
        return readiness(db,member,descriptor) is True if callable(readiness) else True
    authority=NativeAuthority(authenticate,bot,attachment,internal,work,run,link_resolver,authority_schema=authority_schema,dispatch_agent=dispatch_agent)
    # Use exact Agent1 read permission for every scoped actor, not merely presence.
    original_member=authority.require_member
    def member(user,company):
        permission(authority.connection(),user,company,'read')
        return original_member(user,company)
    authority.require_member=member
    store=Store(path,authority,attached_databases=attached)
    async def native_session(request:Request,user=Depends(get_verified_user)):
        header=request.headers.get('authorization','')
        token=header[7:] if header.startswith('Bearer ') else request.cookies.get('token')
        require(isinstance(token,str) and not token.startswith('sk-') and len(token)<=16384,401,'NATIVE_JWT_REQUIRED')
        uid=user.id
        def fresh():
            payload=decode_token(token)
            require(isinstance(payload,dict) and payload.get('id')==uid,401,'NATIVE_JWT_INVALID')
            assert_session_allowed(token,payload)
            return current_user({'id':uid}).role in ('user','admin')
        fresh();payload=decode_token(token)
        session=NativeSession(uid,hashlib.sha256(token.encode()).hexdigest(),float(payload['exp']) if 'exp' in payload else float('inf'),'jwt',fresh)
        if request.method not in ('GET','HEAD'):
            company=request.path_params.get('company')
            # Draft/typing/read/accept remain normal member operations. Explicit
            # messages, creation and intervention require delegated send power.
            suffix=request.url.path
            cap='bots.run' if suffix.endswith('/bot-turns') else 'messages.send' if suffix.endswith('/messages') or suffix.endswith('/commands') or suffix.endswith('/rooms') or suffix.endswith('/work-sessions') else 'write'
            with store.access(session,company) as (db,current,_):permission(db,uid,company,cap)
        return session
    from .native_capabilities import dispatch_capability
    router=make_router(store,native_session,native_dispatch=dispatch_capability(app,store,permission))
    @router.post('/rooms/{room}/bot-turns',status_code=202)
    async def bot_turn(company:str,room:str,body:BotTurn,request:Request,session=Depends(native_session)):
        from .context import capture
        from .store import ident
        import inspect
        key=request.headers.get('idempotency-key');ident(key)
        with store.access(session,company,room) as (db,member,row):
            permission(db,member.user_id,company,'bots.run')
            store.agent(db,member,room,body.botId)
            source=store.message_dto(db,room,body.sourceMessageId)
            require(source['speaker']=={'kind':'human','id':member.user_id} and not source['deleted'],403,'SOURCE_MESSAGE_DENIED')
            require({'kind':'agent','id':body.botId} in source['mentions'],422,'EXPLICIT_AGENT_MENTION_REQUIRED')
        audience=capture(store,session,company,room,body.botId)
        ingress=getattr(app.state,'company_messaging_start_turn',None)
        require(callable(ingress),503,'NATIVE_RUNTIME_NOT_INSTALLED')
        # Host performs durable idempotent admission and rechecks before any
        # model/tool work. No client actor, audience, run or assistant IDs.
        result=ingress(session,audience,source,key)
        return await result if inspect.isawaitable(result) else result
    from .channel_management import install as install_channel_management
    install_channel_management(app,store,native_session)
    app.include_router(router)
    app.state.company_messaging=store
    app.state.company_messaging_session=native_session
    return store


def install_from_environment(app):
    import os
    if os.getenv('STARLI_COMPANY_MESSAGING_ENABLED')!='1':return None
    from open_webui.env import DATABASE_URL
    require(DATABASE_URL.startswith('sqlite:///'),503,'COMPANY_NATIVE_SQLITE_REQUIRED')
    from open_webui.config import DATA_DIR
    company=os.getenv('STARLI_COMPANY_DATABASE') or str(Path(DATA_DIR)/'company-authority.sqlite3')
    registry=os.getenv('STARLI_COMPANY_BOT_DATABASE') or company
    # Fresh local installs start with EMPTY authority/registry schemas. Existing
    # files and external mappings are never replaced, populated or adopted.
    # Creating a schema grants no membership, bots or computer enrollment.
    data_root=Path(DATA_DIR).resolve()
    from open_webui.company_authority import Authority
    from starli_memory.registry import BotRegistry
    for candidate,kind in ((Path(company),'authority'),(Path(registry),'registry')):
        require(candidate.is_absolute() and not candidate.is_symlink(),503,'EXISTING_DATABASE_MAPPING_REQUIRED')
        if not candidate.exists():
            require(candidate.parent.resolve().is_relative_to(data_root),503,'EXISTING_DATABASE_MAPPING_REQUIRED')
            candidate.parent.mkdir(parents=True,exist_ok=True)
            # Exclusive creation prevents following a link or replacing state.
            try:descriptor=os.open(candidate,os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600)
            except FileExistsError:require(False,503,'EXISTING_DATABASE_MAPPING_REQUIRED')
            else:os.close(descriptor)
            if kind=='authority':store=Authority(str(candidate))
            else:store=BotRegistry(str(candidate),lambda *args,**kwargs:False)
            store.db.close()
        elif kind=='registry' and Path(company)==candidate:
            # Shared authority/registry layout needs both empty schemas.
            store=BotRegistry(str(candidate),lambda *args,**kwargs:False);store.db.close()
    return install(app,DATABASE_URL[len('sqlite:///'):],authority_database=company,registry_database=registry)
