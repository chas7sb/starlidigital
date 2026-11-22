"""Mount in the native FastAPI app with its get_verified_user dependency.
No fixture authentication or user IDs from request bodies are accepted here.
"""
import io
from fastapi import APIRouter, Depends, Request
from starlette.responses import Response
from starlette.concurrency import run_in_threadpool
from .drive_http import App

def create_router(factory, get_verified_user, draft_policy, bot_policy):
    router=APIRouter()
    @router.api_route("/api/v1/companies/{company}/tasks",methods=["GET"])
    @router.api_route("/api/v1/companies/{company}/drive",methods=["GET","POST","PATCH"])
    @router.api_route("/api/v1/companies/{company}/drive/{tail:path}",methods=["GET","POST","PATCH"])
    async def drive(request:Request,company:str,tail:str="",user=Depends(get_verified_user)):
        parts=[]
        size=0
        async for chunk in request.stream():
            size+=len(chunk)
            if size>23*1024*1024:
                return Response('{"error":"request too large"}',status_code=413,media_type="application/json",headers={"Cache-Control":"no-store"})
            parts.append(chunk)
        body=b"".join(parts)
        # New App per verified request. Actor is captured from native session only.
        app=App(factory,lambda environ:user.id,draft_policy,bot_policy)
        task_list=request.url.path.endswith("/tasks")
        path=f"/api/v1/companies/{company}/drive" if task_list else request.url.path
        query="kind=task&recent=1" if task_list else request.url.query
        environ={"PATH_INFO":path,"QUERY_STRING":query,
                 "REQUEST_METHOD":request.method,"CONTENT_LENGTH":str(len(body)),"wsgi.input":io.BytesIO(body)}
        def execute():
            captured={}
            def start(status,headers):
                captured["status"]=int(status.split()[0]);captured["headers"]=dict(headers)
            payload=b"".join(app(environ,start))
            return Response(payload,status_code=captured["status"],headers=captured["headers"])
        return await run_in_threadpool(execute)
    return router
