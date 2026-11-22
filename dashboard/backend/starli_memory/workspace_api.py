"""Native workspace memory editor over the EXISTING audience store and keys."""
from contextlib import contextmanager
import re
from fastapi import APIRouter,Depends,HTTPException,Request,Header
from fastapi.responses import Response
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel,ConfigDict,Field
from .audience import AudienceMemorySession,BotIdentity,Audience
from .store import MemoryFault,Provenance

HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
class PrivateMemoryRoute(APIRoute):
    def get_route_handler(self):
        handler=super().get_route_handler()
        async def private(request):
            try:
                if request.method in ('PUT','DELETE'):
                    body=bytearray()
                    async for part in request.stream():
                        if len(body)+len(part)>397312:raise HTTPException(413,'MEMORY_REQUEST_TOO_LARGE')
                        body.extend(part)
                    request._body=bytes(body)
                result=await handler(request);result.headers.update(HEADERS);return result
            except RequestValidationError as error:
                safe=[{k:item[k]for k in ('loc','msg','type')if k in item}for item in error.errors()]
                return JSONResponse({'detail':safe},status_code=422,headers=HEADERS)
            except HTTPException as error:
                error.headers={**(error.headers or {}),**HEADERS};raise
        return private
class Edit(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    content:str=Field(max_length=65536)
    expectedRevision:int=Field(ge=0,le=2**53-1)
    clientWriteId:str|None=Field(default=None,min_length=1,max_length=128)
class Clear(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    expectedRevision:int=Field(ge=0,le=2**53-1)
    clientWriteId:str|None=Field(default=None,min_length=1,max_length=128)

def _value(obj,key):return obj.get(key)if isinstance(obj,dict)else getattr(obj,key,None)

def create_workspace_router(factory,*,verified_user,capture_fence,service_factory,mutation_guard,
                            forbidden_errors=(),resolve_personal=None):
    """service_factory yields existing BotDirectory with company-authorized registry.
    No provisioning, new registry, company-as-personal aliases or migration.
    Company endpoint intentionally accepts ONLY the whole-company audience.
    Restricted/private-room partitions remain runtime-only until a verified room
    resolver is supplied; arbitrary audience IDs cannot select them.
    """
    router=APIRouter(route_class=PrivateMemoryRoute)
    @contextmanager
    def bound(request,user,kind,owner,bot,action):
        fence=capture_fence(request,user);fresh=fence.check();actor=_value(fresh,'id')
        if not actor or _value(fresh,'role')not in ('user','admin'):raise HTTPException(403,'MEMORY_ACCOUNT_UNAVAILABLE',headers=HEADERS)
        with service_factory()as service:
            registry=service.registry
            def record(current):
                if kind=='company':
                    member=registry.require_member(actor,owner,permission='write'if current=='write'else'read')
                    value=registry.require_bot(owner,bot)
                    return value,member.get('membership_revision',member.get('revision'))
                try:value=registry._get(bot)
                except MemoryFault:
                    if resolve_personal is None:raise
                    value=resolve_personal(fence.check(),bot)
                if value.get('kind')!='personal'or value.get('owner')!=actor or not value.get('active',True):raise MemoryFault('MEMORY_BOT_UNAVAILABLE',404)
                return value,None
            initial,member_revision=record(action);revision=initial['revision'];identity=BotIdentity(kind,owner,bot);audience=Audience(kind,owner)
            def resolve(bound_identity,conversation,next_action):
                latest=fence.check()
                if _value(latest,'id')!=actor or _value(latest,'role')not in ('user','admin'):raise MemoryFault('MEMORY_ACCOUNT_UNAVAILABLE',403)
                if bound_identity!=identity:raise MemoryFault('MEMORY_SCOPE_CHANGED',403)
                current,member=record(next_action)
                if current['id']!=bot or current['owner']!=owner or current['kind']!=kind or current['revision']!=revision or member!=member_revision:raise MemoryFault('MEMORY_SCOPE_CHANGED',403)
                return frozenset({audience})
            memory=AudienceMemorySession(factory,identity,actor_id=actor,run_id='user-editor',conversation_id='editor',resolve=resolve)
            yield memory._store(audience),actor,audience
            resolve(identity,'editor',action)

    def invoke(request,user,kind,owner,bot,action,operation):
        try:
            with bound(request,user,kind,owner,bot,action)as(store,actor,audience):
                return operation(store,actor,audience)
        except MemoryFault as error:raise HTTPException(error.status,error.code,headers=HEADERS)from None
        except forbidden_errors:raise HTTPException(403,'MEMORY_ACCESS_DENIED',headers=HEADERS)from None

    def audience(company,kind,ident):
        if kind!='company'or ident!=company:raise HTTPException(403,'MEMORY_AUDIENCE_DENIED',headers=HEADERS)
    def write_id(body,key):
        chosen=key or body.clientWriteId
        if not isinstance(chosen,str)or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}',chosen)or body.clientWriteId is not None and body.clientWriteId!=chosen:raise HTTPException(422,'MEMORY_WRITE_ID_INVALID',headers=HEADERS)
        return chosen
    def wrapped(company,bot,aud,document,write=None):
        result={'version':'starli.memory.view.v1','companyId':company,'botId':bot,'audience':{'kind':aud.kind,'id':aud.id},'document':document}
        if write is not None:result.update(write=write['write'],projectionPending=write['projectionPending'])
        return result

    @router.get('/api/v1/companies/{company}/bots/{bot}/memory')
    def read(request:Request,company:str,bot:str,audienceKind:str='company',audienceId:str='',documentId:str='memory',user=Depends(verified_user)):
        audience(company,audienceKind,audienceId)
        return invoke(request,user,'company',company,bot,'read',lambda store,actor,aud:wrapped(company,bot,aud,store.read(documentId)))

    @router.put('/api/v1/companies/{company}/bots/{bot}/memory')
    def edit(request:Request,company:str,bot:str,body:Edit,audienceKind:str='company',audienceId:str='',documentId:str='memory',key:str|None=Header(default=None,alias='Idempotency-Key'),user=Depends(verified_user)):
        mutation_guard(request);audience(company,audienceKind,audienceId);ident=write_id(body,key)
        def commit(store,actor,aud):
            result=store.write(documentId,body.content,body.expectedRevision,ident,Provenance('user',actor))
            return wrapped(company,bot,aud,result['document'],result)
        return invoke(request,user,'company',company,bot,'write',commit)

    @router.delete('/api/v1/companies/{company}/bots/{bot}/memory')
    def clear(request:Request,company:str,bot:str,body:Clear,audienceKind:str='company',audienceId:str='',documentId:str='memory',key:str|None=Header(default=None,alias='Idempotency-Key'),user=Depends(verified_user)):
        mutation_guard(request);audience(company,audienceKind,audienceId);ident=write_id(body,key)
        def commit(store,actor,aud):
            result=store.delete(documentId,body.expectedRevision,ident,Provenance('user',actor))
            return wrapped(company,bot,aud,result['document'],result)
        return invoke(request,user,'company',company,bot,'write',commit)

    @router.get('/api/v1/companies/{company}/bots/{bot}/memory/history')
    def history(request:Request,company:str,bot:str,audienceKind:str='company',audienceId:str='',documentId:str='memory',user=Depends(verified_user)):
        audience(company,audienceKind,audienceId)
        return invoke(request,user,'company',company,bot,'read',lambda store,actor,aud:{'version':'starli.memory.view.v1','companyId':company,'botId':bot,'audience':{'kind':aud.kind,'id':aud.id},'history':store.history(documentId)})

    @router.get('/api/v1/companies/{company}/bots/{bot}/memory/revisions/{revision}')
    def old(request:Request,company:str,bot:str,revision:int,audienceKind:str='company',audienceId:str='',documentId:str='memory',user=Depends(verified_user)):
        audience(company,audienceKind,audienceId)
        return invoke(request,user,'company',company,bot,'read',lambda store,actor,aud:wrapped(company,bot,aud,store.read_revision(documentId,revision)))

    @router.get('/api/v1/companies/{company}/bots/{bot}/memory/raw')
    def raw(request:Request,company:str,bot:str,audienceKind:str='company',audienceId:str='',documentId:str='memory',user=Depends(verified_user)):
        audience(company,audienceKind,audienceId)
        document=invoke(request,user,'company',company,bot,'read',lambda store,actor,aud:store.read(documentId))
        return Response(document['content'],media_type='text/markdown',headers={**HEADERS,'Content-Disposition':'inline; filename="'+document['filename']+'"'})

    # Legacy personal endpoints retain their existing DTO/routes and canonical
    # owner+agent storage key. A verified registry/native resolver is mandatory.
    from .api import create_router
    from .store import MemoryScope
    def authorize_personal(user,bot,action):
        actor=_value(user,'id')
        if not actor or _value(user,'role')not in ('user','admin'):raise HTTPException(403,'MEMORY_ACCOUNT_UNAVAILABLE')
        with service_factory()as service:
            try:row=service.registry._get(bot)
            except MemoryFault:
                if resolve_personal is None:raise
                row=resolve_personal(user,bot)
            if row.get('kind')!='personal'or row.get('owner')!=actor or not row.get('active',True):raise HTTPException(404,'MEMORY_BOT_UNAVAILABLE')
        return MemoryScope(actor,bot)
    async def personal_mutation(request:Request):
        if request.method in ('PUT','DELETE'):mutation_guard(request)
    router.include_router(create_router(factory,verified_user,authorize_personal,capture_fence),prefix='/api/v1/starli/memory',dependencies=[Depends(personal_mutation)])
    return router
