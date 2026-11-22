"""Native authenticated transport to private preview controller; no JWT minting."""
from __future__ import annotations
import json, urllib.request, urllib.error, asyncio, re
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

class Empty(BaseModel):
    model_config=ConfigDict(extra='forbid')

def install_preview_routes(app, svc, *, controller_url, controller_key, allowed_origins):
    from grokbot1_routes import _token
    from grokbot1_claim import ClaimError
    from urllib.parse import urlsplit
    parsed=urlsplit(controller_url)
    if parsed.scheme!='http' or parsed.hostname not in {'127.0.0.1','localhost','::1'}:raise RuntimeError('PRIVATE_PREVIEW_CONTROLLER_REQUIRED')
    router=APIRouter()
    async def request_action(intent_id,action,request):
        origins=request.headers.getlist('origin')
        if len(origins)!=1 or origins[0] not in allowed_origins:raise ClaimError(403,'ORIGIN_DENIED')
        if request.headers.get('sec-fetch-site','same-origin') not in {'same-origin','same-site','none'}:raise ClaimError(403,'ORIGIN_DENIED')
        token=_token(request)
        session,uid=svc.native_session(token)
        nav=svc.owner_navigation(token,intent_id)
        if nav.get('stage')!='ROOM_READY' or nav.get('verifiedBy')!='native-store-readback':raise ClaimError(409,'NATIVE_CLAIM_NOT_READY')
        if session.revalidate() is not True:raise ClaimError(401,'NATIVE_SESSION_REVOKED')
        def call():
            req=urllib.request.Request(controller_url+'/internal/v1/preview/'+action,
                data=json.dumps({'intentId':intent_id,'nativeJwt':token}).encode(),
                headers={'Content-Type':'application/json','X-Starli-Preview-Key':controller_key},method='POST')
            try:
                with urllib.request.urlopen(req,timeout=90) as result:return result.status,json.load(result)
            except urllib.error.HTTPError as e:
                return e.code,json.load(e)
        status,result=await asyncio.to_thread(call)
        # Never include native credentials or private controller keys in the response.
        if status==202:
            result.update({k:nav.get(k) for k in ('companyId','projectId','channelRoomId')})
            return JSONResponse(result,status_code=202,headers={'Cache-Control':'no-store'})
        if status!=200:return JSONResponse(result,status_code=status,headers={'Cache-Control':'no-store'})
        if action!='stop' and any(result.get(k)!=nav.get(k) for k in ('companyId','projectId')):raise ClaimError(503,'PREVIEW_NATIVE_NAV_BINDING_MISMATCH')
        return JSONResponse(result,headers={'Cache-Control':'no-store'})
    @router.post('/api/v1/starli/grokbot1/claims/{intent_id}/preview')
    async def open_preview(intent_id:str,body:Empty,request:Request):return await request_action(intent_id,'open',request)
    @router.post('/api/v1/starli/grokbot1/claims/{intent_id}/preview/bootstrap')
    async def bootstrap(intent_id:str,body:Empty,request:Request):return await request_action(intent_id,'bootstrap',request)
    @router.post('/api/v1/starli/grokbot1/claims/{intent_id}/preview/restart')
    async def restart(intent_id:str,body:Empty,request:Request):return await request_action(intent_id,'restart',request)
    @router.post('/api/v1/starli/grokbot1/claims/{intent_id}/preview/stop')
    async def stop(intent_id:str,body:Empty,request:Request):return await request_action(intent_id,'stop',request)
    app.include_router(router)
    return {'previewPath':'/api/v1/starli/grokbot1/claims/{intentId}/preview','executionClass':'NATIVE_NONPRODUCTION'}
