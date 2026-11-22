"""Isolated authenticated Markdown memory API; integration supplies all identity policy."""
import re
from fastapi import APIRouter,Depends,HTTPException,Path as ApiPath,Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse,Response
from fastapi.routing import APIRoute
from pydantic import BaseModel,ConfigDict,Field
from .store import MemoryFault,MemoryScope,Provenance

VERSION="starli.memory.v1"
RENDER_POLICY="native-sanitized-markdown"
PRIVATE_HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
DOCUMENTS={"memory":"MEMORY.md","working":"WORKING.md"}
MAX_REVISION=2**53-1
MAX_WRITE_ID=128

class _PrivateJSON(JSONResponse):
    def __init__(self,*args,**kwargs):
        kwargs["headers"]={**PRIVATE_HEADERS,**(kwargs.get("headers") or {})}
        super().__init__(*args,**kwargs)

def _failure(fault):
    code=getattr(fault,"code","MEMORY_OPERATION_FAILED")
    if not isinstance(code,str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}",code):code="MEMORY_OPERATION_FAILED"
    status=getattr(fault,"status",500)
    if type(status) is not int or not 400<=status<=599:status=500
    raise HTTPException(status,code,headers=PRIVATE_HEADERS) from None

def create_router(factory,authenticate,authorize_scope,capture_fence):
    """No live application imports, mount, global account scope or credential retention."""
    content_limit=factory.max_content_bytes
    if type(content_limit) is not int or not 1<=content_limit<=1024*1024:raise ValueError("MEMORY_API_INVALID_LIMIT")
    json_limit=6*content_limit+4096

    class WriteRequest(BaseModel):
        model_config=ConfigDict(extra="forbid",strict=True)
        content:str=Field(max_length=content_limit)
        expectedRevision:int=Field(ge=0,le=MAX_REVISION)
        clientWriteId:str=Field(min_length=1,max_length=MAX_WRITE_ID)

    class DeleteRequest(BaseModel):
        model_config=ConfigDict(extra="forbid",strict=True)
        expectedRevision:int=Field(ge=0,le=MAX_REVISION)
        clientWriteId:str=Field(min_length=1,max_length=MAX_WRITE_ID)

    class BoundedPrivateRoute(APIRoute):
        def get_route_handler(self):
            original=super().get_route_handler()
            async def handle(request):
                try:
                    if request.method in ("PUT","DELETE"):
                        declared=request.headers.get("content-length")
                        if declared is not None:
                            try:size=int(declared)
                            except ValueError:raise HTTPException(400,"MEMORY_INVALID_REQUEST_SIZE")
                            if size<0:raise HTTPException(400,"MEMORY_INVALID_REQUEST_SIZE")
                            if size>json_limit:raise HTTPException(413,"MEMORY_REQUEST_TOO_LARGE")
                        body=bytearray()
                        async for chunk in request.stream():
                            if len(body)+len(chunk)>json_limit:raise HTTPException(413,"MEMORY_REQUEST_TOO_LARGE")
                            body.extend(chunk)
                        request._body=bytes(body)
                    response=await original(request)
                    response.headers.update(PRIVATE_HEADERS)
                    return response
                except RequestValidationError as error:
                    safe=[{key:item[key] for key in ("loc","msg","type") if key in item} for item in error.errors()]
                    return _PrivateJSON({"detail":safe},status_code=422)
                except HTTPException as error:
                    error.headers={**(error.headers or {}),**PRIVATE_HEADERS}
                    raise
            return handle
    router=APIRouter(route_class=BoundedPrivateRoute,default_response_class=_PrivateJSON)

    def context(request,user,agent_id,action):
        fence=capture_fence(request,user)
        fresh=fence.check()
        scope=authorize_scope(fresh,agent_id,action)
        uid=fresh.get("id") if isinstance(fresh,dict) else getattr(fresh,"id",None)
        if not isinstance(scope,MemoryScope) or scope.agent_id!=agent_id or scope.account_id!=uid:raise HTTPException(403,"MEMORY_SCOPE_DENIED")
        def authorize(next_action):
            latest=fence.check()
            current=authorize_scope(latest,agent_id,next_action)
            if not isinstance(current,MemoryScope) or current!=scope:raise HTTPException(403,"MEMORY_SCOPE_CHANGED")
        authorize(action)
        return scope,fence,authorize

    def document(ident):
        if ident not in DOCUMENTS:raise HTTPException(404,"MEMORY_DOCUMENT_NOT_FOUND")
        return ident

    def invoke(request,user,agent_id,action,operation):
        try:
            scope,fence,authorize=context(request,user,agent_id,action)
            store=factory.open(scope,authorize)
            return operation(store,scope,fence)
        except MemoryFault as error:_failure(error)

    @router.get("/capabilities")
    def capabilities(request:Request,user=Depends(authenticate)):
        capture_fence(request,user).check()
        return {"version":VERSION,"documents":[{"documentId":key,"filename":value} for key,value in DOCUMENTS.items()],
            "limits":{"maxContentBytes":content_limit,"maxClientWriteIdLength":MAX_WRITE_ID,"maxExpectedRevision":MAX_REVISION,"historyLimit":factory.history_limit,"receiptLimit":factory.receipt_limit},
            "renderPolicy":RENDER_POLICY,"capabilities":{"read":True,"write":True,"history":True,"rawMarkdown":True,"delete":True,"clearCurrent":True,"deleteMode":"clear-current-history-retained","search":True,"share":False}}

    @router.get("/agents/{agent_id}/documents")
    def documents(request:Request,agent_id:str=ApiPath(min_length=1,max_length=180),user=Depends(authenticate)):
        return invoke(request,user,agent_id,"read",lambda store,scope,fence:{"version":VERSION,"agentId":scope.agent_id,"documents":[store.read(key) for key in DOCUMENTS]})

    @router.get("/agents/{agent_id}/documents/{document_id}")
    def current(request:Request,agent_id:str=ApiPath(min_length=1,max_length=180),document_id:str=ApiPath(min_length=1,max_length=32),user=Depends(authenticate)):
        ident=document(document_id)
        return invoke(request,user,agent_id,"read",lambda store,scope,fence:store.read(ident))

    @router.put("/agents/{agent_id}/documents/{document_id}")
    def write(request:Request,body:WriteRequest,agent_id:str=ApiPath(min_length=1,max_length=180),document_id:str=ApiPath(min_length=1,max_length=32),user=Depends(authenticate)):
        ident=document(document_id)
        if len(body.content.encode("utf-8"))>content_limit:raise HTTPException(413,"MEMORY_CONTENT_TOO_LARGE")
        def commit(store,scope,fence):
            fresh=fence.check()
            actor=fresh.get("id") if isinstance(fresh,dict) else getattr(fresh,"id",None)
            if not isinstance(actor,str) or not actor:raise HTTPException(403,"MEMORY_ACTOR_REQUIRED")
            return store.write(ident,body.content,body.expectedRevision,body.clientWriteId,Provenance(kind="user",actor_id=actor))
        return invoke(request,user,agent_id,"write",commit)

    @router.get("/agents/{agent_id}/documents/{document_id}/raw")
    def raw(request:Request,agent_id:str=ApiPath(min_length=1,max_length=180),document_id:str=ApiPath(min_length=1,max_length=32),user=Depends(authenticate)):
        ident=document(document_id)
        value=invoke(request,user,agent_id,"read",lambda store,scope,fence:store.read(ident))
        return Response(value["content"],media_type="text/markdown",headers={**PRIVATE_HEADERS,"Content-Disposition":'inline; filename="'+DOCUMENTS[ident]+'"'})

    @router.get("/agents/{agent_id}/documents/{document_id}/history")
    def history(request:Request,agent_id:str=ApiPath(min_length=1,max_length=180),document_id:str=ApiPath(min_length=1,max_length=32),user=Depends(authenticate)):
        ident=document(document_id)
        return invoke(request,user,agent_id,"history",lambda store,scope,fence:store.history(ident))

    @router.get("/agents/{agent_id}/documents/{document_id}/revisions/{revision}")
    def revision(request:Request,agent_id:str=ApiPath(min_length=1,max_length=180),document_id:str=ApiPath(min_length=1,max_length=32),revision:int=ApiPath(ge=0,le=MAX_REVISION),user=Depends(authenticate)):
        ident=document(document_id)
        return invoke(request,user,agent_id,"read_revision",lambda store,scope,fence:store.read_revision(ident,revision))
    @router.delete("/agents/{agent_id}/documents/{document_id}")
    def delete(request:Request,body:DeleteRequest,agent_id:str=ApiPath(min_length=1,max_length=180),document_id:str=ApiPath(min_length=1,max_length=32),user=Depends(authenticate)):
        ident=document(document_id)
        def commit(store,scope,fence):
            fresh=fence.check();actor=fresh.get("id") if isinstance(fresh,dict) else getattr(fresh,"id",None)
            if actor!=scope.account_id:raise HTTPException(403,"MEMORY_ACTOR_REQUIRED")
            return store.delete(ident,body.expectedRevision,body.clientWriteId,Provenance(kind="user",actor_id=actor))
        return invoke(request,user,agent_id,"write",commit)

    @router.get("/agents/{agent_id}/documents/{document_id}/search")
    def search(request:Request,query:str,limit:int=10,agent_id:str=ApiPath(min_length=1,max_length=180),document_id:str=ApiPath(min_length=1,max_length=32),user=Depends(authenticate)):
        ident=document(document_id)
        return invoke(request,user,agent_id,"read",lambda store,scope,fence:store.search(ident,query,limit))
    return router
