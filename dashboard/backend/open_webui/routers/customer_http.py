"""Versioned HTTP facade. A native adapter is mandatory; no provider client exists here."""
from __future__ import annotations
import asyncio
import json
import re
import time
from collections import defaultdict, deque
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field
try:
    from .customer_store import CustomerError, reject
except ImportError:
    from customer_store import CustomerError, reject

VERSION='starli.customer-api.v1'
PREFIX='/api/customer/v1'
MANAGEMENT='/api/v1/starli/api-tokens'
MAX_BODY=65536
STREAM_SOURCE_SECONDS=55
FINALIZATION_SECONDS=5
NATIVE_ERRORS={
    'CUSTOMER_INITIALIZE_CONVERSATION_IN_STARLI':('conversation_not_initialized','Initialize this bot conversation in Starli first. This API cannot create it.'),
    'CUSTOMER_CANONICAL_BINDING_AMBIGUOUS':('canonical_binding_ambiguous','The bot conversation binding needs repair in Starli.'),
    'CUSTOMER_PROVIDER_NOT_YET_SUPPORTED':('configured_provider_unavailable','This bot uses a configured provider not yet supported by the native customer API. Its provider settings were not changed.'),
    'CUSTOMER_NATIVE_RUNTIME_UNAVAILABLE':('native_runtime_unavailable','The native customer runtime is unavailable.'),
    'TURN_CURRENT_ID_CONFLICT':('stale_parent','The canonical conversation parent changed. Refresh it in Starli before submitting a new turn.'),
    'TURN_ACTIVE_RUN_EXISTS':('conversation_busy','This conversation already has active work.'),
    'TURN_ACTIVE_ASSISTANT_EXISTS':('conversation_busy','This conversation already has an active assistant turn.'),
    'CUSTOMER_BOT_BINDING_CHANGED':('bot_binding_changed','The bot binding or configuration changed. Refresh before submitting new work.'),
    'ROOM_TURN_ACTIVE':('conversation_busy','This shared conversation already has active work.'),
    'TURN_STOP_UNCERTAIN':('stop_unconfirmed','The native worker has not confirmed stopping. Read status; do not restart work.'),
}

def error_body(code,message,status):
    return {'error':{'message':message,'type':'authentication_error' if status==401 else 'permission_error' if status==403 else 'invalid_request_error' if status<500 else 'server_error','param':None,'code':code}}

class BoundedRoute(APIRoute):
    def get_route_handler(self):
        handler=super().get_route_handler()
        async def bounded(request):
            try:
                if request.method in ('POST','PUT','PATCH'):
                    if request.headers.get('content-encoding','identity')!='identity':reject(415,'unsupported_encoding','Compressed request bodies are unsupported.')
                    body=bytearray()
                    async for chunk in request.stream():
                        if len(body)+len(chunk)>MAX_BODY:reject(413,'request_too_large','Request exceeds 64 KiB.')
                        body.extend(chunk)
                    request._body=bytes(body)
                response=await handler(request)
            except CustomerError as e:
                response=JSONResponse(error_body(e.code,e.message,e.status),status_code=e.status)
                operation=getattr(e,'operation',None)
                if isinstance(operation,dict):
                    response.headers['X-Starli-Operation-ID']=operation['id']
                    response.headers['Location']=PREFIX+'/operations/'+operation['id']
            except HTTPException as e:
                # Never expose private exception strings/diagnostics or message bodies.
                code,message=NATIVE_ERRORS.get(e.detail,('native_request_rejected','The native runtime rejected this request. Check the operation status before retrying.')) if isinstance(e.detail,str) else ('native_request_rejected','The native runtime rejected this request.')
                response=JSONResponse(error_body(code,message,e.status_code),status_code=e.status_code)
            except RequestValidationError:
                response=JSONResponse(error_body('invalid_request','Request fields do not match the documented schema.',422),status_code=422)
            except Exception as e:
                status=getattr(e,'status',503)
                if status not in (401,403,404,409,422):status=503
                code,message=NATIVE_ERRORS.get(getattr(e,'code',''),('native_request_rejected','The native runtime rejected this request. Check operation status before retrying.'))
                response=JSONResponse(error_body(code,message,status),status_code=status)
            response.headers['Cache-Control']='no-store'
            response.headers['Pragma']='no-cache'
            response.headers['X-Content-Type-Options']='nosniff'
            return response
        return bounded

class Strict(BaseModel):model_config=ConfigDict(extra='forbid',strict=True)
class BotAccess(Strict):
    mode:str
    botIds:list[str]|None=None
class CreateToken(Strict):
    name:str
    expiresAt:int
    scopes:list[str]
    botAccess:BotAccess

class RateLimits:
    """Per-process backstop. Deployment also requires shared ingress limits."""
    def __init__(self):self.rows={};self.streams=defaultdict(int)
    def request(self,owner):
        now=time.monotonic()
        if len(self.rows)>=10000:
            self.rows={k:v for k,v in self.rows.items() if v and v[-1]>now-60}
            if len(self.rows)>=10000:reject(503,'api_capacity','API is at capacity.')
        bucket=self.rows.setdefault(owner,deque())
        while bucket and bucket[0]<=now-60:bucket.popleft()
        if len(bucket)>=120:reject(429,'rate_limit_exceeded','Request rate exceeded. Retry later.')
        bucket.append(now)

def parse_completion(body):
    if not isinstance(body,dict):reject(422,'invalid_request','Expected a JSON object.')
    allowed={'model','messages','stream','starli'}
    if set(body)-allowed:reject(422,'unsupported_parameter','Unsupported request fields: '+', '.join(sorted(set(body)-allowed)))
    model=body.get('model')
    if not isinstance(model,str) or not re.fullmatch(r'starli/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}',model):
        reject(422,'invalid_model','Select an accessible starli/{botId}.')
    messages=body.get('messages')
    if not isinstance(messages,list) or len(messages)!=1 or not isinstance(messages[0],dict) or set(messages[0])!={'role','content'} or messages[0].get('role')!='user':
        reject(422,'new_user_message_only','Send exactly one new user message; history is owned by Starli.')
    content=messages[0].get('content')
    if not isinstance(content,str) or not content.strip() or len(content.encode())>32768 or '\x00' in content:
        reject(422,'invalid_content','Use nonempty text up to 32 KiB.')
    if model[7:].startswith('company:') and len(content.encode())>16000:
        reject(422,'invalid_content','Shared native turns accept at most 16000 UTF-8 bytes.')
    stream=body.get('stream',False)
    if type(stream) is not bool:reject(422,'invalid_stream','stream must be a boolean.')
    extension=body.get('starli',{})
    if not isinstance(extension,dict) or set(extension)-{'expectedCurrentId'}:reject(422,'unsupported_parameter','Unsupported Starli extension.')
    parent=extension.get('expectedCurrentId')
    if parent is not None and (not isinstance(parent,str) or not 1<=len(parent)<=180):reject(422,'invalid_parent','Invalid canonical parent.')
    return model[7:],content,stream,extension

def completion(operation,text,model,reason='stop'):
    return {'id':'chatcmpl-'+operation['run_id'],'object':'chat.completion','created':operation['created'],'model':model,
            'choices':[{'index':0,'message':{'role':'assistant','content':text},'finish_reason':reason,'logprobs':None}]}

def chunk(operation,model,delta,finish=None):
    return {'id':'chatcmpl-'+operation['run_id'],'object':'chat.completion.chunk','created':operation['created'],'model':model,
            'choices':[{'index':0,'delta':delta,'finish_reason':finish,'logprobs':None}]}

def make_routers(store,native,session_owner,*,allow_http_for_tests=False):
    """native must implement canonical operations; session_owner rejects ALL API keys.

    Authentication is deliberately outside native get_verified_user so customer
    tokens cannot enter legacy endpoints or acquire admin identity.
    """
    api=APIRouter(prefix=PREFIX,route_class=BoundedRoute)
    management=APIRouter(prefix=MANAGEMENT,route_class=BoundedRoute)
    limits=RateLimits()

    def principal(request:Request):
        if not allow_http_for_tests and request.url.scheme!='https':reject(400,'https_required','HTTPS is required.')
        if any(k.lower() in {'token','api_key','access_token','authorization'} for k in request.query_params):reject(400,'credential_in_url','Credentials belong in the Authorization header.')
        header=request.headers.get('authorization','')
        if not header.startswith('Bearer ') or len(header)>210:reject(401,'invalid_api_key','Customer bearer credential required.')
        p=store.authenticate(header[7:]);limits.request(p.owner_id)
        return p

    @management.get('')
    def list_tokens(owner=Depends(session_owner)):
        return {'version':VERSION,'data':store.list(owner)}

    @management.post('',status_code=201)
    def create_token(body:CreateToken,owner=Depends(session_owner)):
        access=body.botAccess
        if access.mode=='all_owned' and access.botIds is None:bots=None
        elif access.mode=='selected' and access.botIds:bots=access.botIds
        else:reject(422,'invalid_bot_access','Choose all_owned or selected bot access.')
        return {'version':VERSION,**store.create(owner,body.name,body.scopes,bots,body.expiresAt)}

    @management.get('/bots')
    def token_bots(owner=Depends(session_owner)):
        return {'version':VERSION,'items':native.catalogue(owner)}

    @management.delete('/{token_id}')
    def revoke_token(token_id:str,owner=Depends(session_owner)):
        store.revoke(owner,token_id)
        return {'version':VERSION,'revoked':True}

    @api.get('/models')
    def models(p=Depends(principal)):
        return {'object':'list','data':[{'id':'starli/'+b,'object':'model','created':0,'owned_by':'starli'} for b in store.accessible_bots(p)]}

    async def submit(request,p,body):
        bot,content,stream,extension=parse_completion(body)
        store.check(p,'messages:send',bot)
        resolved=native.resolve(p,bot)
        conversation,parent=resolved['conversationId'],resolved['currentId']
        previous=store.accepted_for_conversation(p,conversation)
        if previous is not None and native.result(p,previous)['terminal']:
            try:store.transition(previous['id'],'accepted','terminal')
            except CustomerError:pass
        operation,new=store.admit(p,request.headers.get('idempotency-key'),bot,conversation,
            extension.get('expectedCurrentId',parent),content,automatic_parent='expectedCurrentId' not in extension)
        if not new:
            if operation['state'] in ('admitting','uncertain'):
                error=CustomerError(409,'operation_uncertain','Submission is recorded. Read its operation status; do not use a new key.')
                error.operation=operation
                raise error
            if operation['state']=='rejected':reject(409,'operation_rejected','This submission was rejected before execution. Use a new key after resolving the cause.')
            return operation,stream,None
        source=None
        try:
            # This method must perform native prepare CAS, then existing stream
            # admission. An exception is uncertain unless adapter certifies no append.
            accepted=await native.submit(request,p,operation,content)
            source=accepted.get('source')
            canonical=accepted if all(k in accepted for k in ('userMessageId','assistantMessageId')) else None
            store.transition(operation['id'],'admitting','accepted',accepted['runId'],native_ids=canonical)
            if canonical:operation.update(turn_id=accepted['runId'],user_message_id=accepted['userMessageId'],assistant_message_id=accepted['assistantMessageId'])
            operation.update(state='accepted',run_id=accepted['runId'])
        except BaseException as e:
            # Never replay a native append/launch with uncertain receipt persistence.
            store.transition(operation['id'],'admitting','rejected' if getattr(e,'no_effects',False) else 'uncertain')
            if isinstance(e,Exception) and not getattr(e,'no_effects',False):
                error=CustomerError(503,'operation_uncertain','Native admission needs reconciliation. Read this operation; do not start another execution.')
                error.operation=operation
                raise error from None
            raise
        return operation,stream,source

    def headers(op):
        return {'X-Starli-Operation-ID':op['id'],'X-Starli-Run-ID':op['run_id'],
                'X-Starli-Conversation-ID':op['conversation'],'Location':PREFIX+'/operations/'+op['id']}

    async def result(p,op,seconds=55):
        deadline=time.monotonic()+seconds
        while True:
            store.check(p,'messages:send',op['bot'])
            value=native.result(p,op)
            if value['terminal']:
                if op['state']=='accepted':
                    try:store.transition(op['id'],'accepted','terminal')
                    except CustomerError:pass
                if value.get('error'):reject(409,'run_stopped','The native run stopped; inspect run status.')
                return value
            if time.monotonic()>=deadline:reject(504,'completion_wait_timeout','Run continues. Retrieve status using the operation ID; do not start another execution.')
            await asyncio.sleep(.25)

    async def stream_completion(request,p,op,source):
        owner=p.owner_id
        if limits.streams[owner]>=8:reject(429,'too_many_observers','Too many concurrent observers.')
        limits.streams[owner]+=1
        model='starli/'+op['bot']
        async def generate():
            delivered=''
            try:
                store.check(p,'messages:send',op['bot'])
                yield 'data: '+json.dumps(chunk(op,model,{'role':'assistant','content':''}))+'\n\n'
                if source is not None:
                    # Adapter yields ONLY native assistant deltas, not tool payloads.
                    try:
                        async with asyncio.timeout(STREAM_SOURCE_SECONDS):
                            async for text in source:
                                if await request.is_disconnected():return
                                store.check(p,'messages:send',op['bot'])
                                if text:
                                    delivered+=text
                                    yield 'data: '+json.dumps(chunk(op,model,{'content':text}))+'\n\n'
                    except TimeoutError:
                        # Observation expiry is not execution failure. Give the
                        # SAME run bounded time to settle, then reconcile only
                        # its authorized canonical result; never launch/replay.
                        value=await result(p,op,seconds=FINALIZATION_SECONDS)
                        if not value['text'].startswith(delivered):reject(409,'completion_projection_conflict','Read the canonical result before continuing.')
                        tail=value['text'][len(delivered):]
                        if tail:
                            store.check(p,'messages:send',op['bot'])
                            yield 'data: '+json.dumps(chunk(op,model,{'content':tail}))+'\n\n'
                    else:value=await result(p,op,seconds=FINALIZATION_SECONDS)
                else:
                    value=await result(p,op)
                    yield 'data: '+json.dumps(chunk(op,model,{'content':value['text']}))+'\n\n'
                yield 'data: '+json.dumps(chunk(op,model,{},value.get('finishReason','stop')))+'\n\n'
                yield 'data: [DONE]\n\n'
            except CustomerError as e:
                if e.status not in (401,403,404):
                    yield 'data: '+json.dumps(error_body(e.code,e.message,e.status))+'\n\n'
                    yield 'data: [DONE]\n\n'
            except Exception as error:
                # Operator-only bounded diagnosis; never log exception arguments,
                # headers, prompts, native tool data or a traceback.
                try:
                    kind=type(error).__name__
                    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,79}',kind):kind='UnknownError'
                    with store.db()as db:
                        db.execute('INSERT INTO customer_audit(at,owner,token_id,operation_id,action)VALUES(?,?,?,?,?)',
                            (int(store.clock()),p.owner_id,p.token_id,op['id'],'stream.error.'+kind))
                except Exception:pass
                yield 'data: '+json.dumps(error_body('stream_unavailable','Read the operation status before reconnecting.',503))+'\n\n'
                yield 'data: [DONE]\n\n'
            finally:
                limits.streams[owner]-=1
                if not limits.streams[owner]:limits.streams.pop(owner,None)
                if source is not None:await source.aclose()
                native.detach(p,op)
        return StreamingResponse(generate(),media_type='text/event-stream',headers={**headers(op),'Cache-Control':'no-store','X-Accel-Buffering':'no'})

    @api.post('/chat/completions')
    async def chat(request:Request,p=Depends(principal)):
        try:body=await request.json()
        except (ValueError,UnicodeError):reject(400,'invalid_json','Expected valid JSON.')
        op,stream,source=await submit(request,p,body)
        if stream:return await stream_completion(request,p,op,source)
        try:
            # Detach HTTP observation, not native execution; result polls canonical state.
            native.detach(p,op)
            value=await result(p,op)
            return JSONResponse(completion(op,value['text'],'starli/'+op['bot'],value.get('finishReason','stop')),headers=headers(op))
        except CustomerError as e:
            return JSONResponse(error_body(e.code,e.message,e.status),status_code=e.status,headers=headers(op))
        finally:
            if source is not None:await source.aclose()

    @api.post('/bots/{bot_id}/messages',status_code=202)
    async def send(bot_id:str,request:Request,p=Depends(principal)):
        try:body=await request.json()
        except (ValueError,UnicodeError):reject(400,'invalid_json','Expected valid JSON.')
        if not isinstance(body,dict) or set(body)-{'content','expectedCurrentId'}:reject(422,'invalid_request','Use content and optional expectedCurrentId.')
        op,_,source=await submit(request,p,{'model':'starli/'+bot_id,'messages':[{'role':'user','content':body.get('content')}],
            'starli':{k:body[k] for k in ('expectedCurrentId',) if k in body}})
        native.detach(p,op)
        if source is not None:await source.aclose()
        return JSONResponse({'version':VERSION,**public_operation(op)},status_code=202,headers=headers(op))

    @api.get('/operations/{operation_id}')
    def operation(operation_id:str,p=Depends(principal)):
        op=store.operation(p,operation_id)
        if op['state'] in ('admitting','uncertain'):
            recovered=native.reconcile(p,op)
            if recovered is not None:
                canonical=recovered if all(k in recovered for k in ('userMessageId','assistantMessageId')) else None
                store.transition(op['id'],op['state'],'accepted',recovered['runId'],native_ids=canonical)
                if canonical:op.update(turn_id=recovered['runId'],user_message_id=recovered['userMessageId'],assistant_message_id=recovered['assistantMessageId'])
                op.update(state='accepted',run_id=recovered['runId'])
        if op['state']=='accepted' and native.status(p,op['run_id'])['terminal']:
            try:store.transition(op['id'],'accepted','terminal');op['state']='terminal'
            except CustomerError:pass
        return {'version':VERSION,**public_operation(op)}

    @api.get('/bots/{bot_id}/messages')
    def messages(bot_id:str,after:str|None=None,limit:int=50,p=Depends(principal)):
        store.check(p,'conversations:read',bot_id)
        if not 1<=limit<=100:reject(422,'invalid_limit','limit must be between 1 and 100.')
        return {'version':VERSION,**native.messages(p,bot_id,after,limit)}

    @api.get('/runs/{run_id}')
    def run(run_id:str,p=Depends(principal)):
        return {'version':VERSION,**native.status(p,run_id)}

    @api.get('/runs/{run_id}/result')
    def final_result(run_id:str,p=Depends(principal)):
        value=native.final(p,run_id)
        return JSONResponse({'version':VERSION,**value},status_code=200 if value['terminal'] else 202)

    @api.get('/runs/{run_id}/events')
    async def events(run_id:str,request:Request,after:int=0,p=Depends(principal)):
        if after<0 or after>9223372036854775807:reject(422,'invalid_cursor','Invalid event cursor.')
        if limits.streams[p.owner_id]>=8:reject(429,'too_many_observers','Too many concurrent observers.')
        initial=native.status(p,run_id)  # authorize BEFORE headers
        limits.streams[p.owner_id]+=1
        async def generate():
            cursor=after;deadline=time.monotonic()+40;count=0
            try:
                while time.monotonic()<deadline and count<2000:
                    if await request.is_disconnected():return
                    page=native.events(p,run_id,cursor)
                    if page.get('replayTruncated'):
                        snapshot=native.snapshot(p,run_id)
                        cursor=snapshot['cursor']
                        yield f'id: {cursor}\ndata: '+json.dumps({'type':'run.resync','version':VERSION,'snapshot':snapshot})+'\n\n'
                        continue
                    for row in page['events']:
                        if type(row['cursor']) is not int or row['cursor']<=cursor:reject(503,'invalid_native_cursor','Native event order unavailable.')
                        native.status(p,run_id)  # fresh authority before each delivery
                        cursor=row['cursor'];count+=1
                        yield f'id: {cursor}\ndata: '+json.dumps(row['event'])+'\n\n'
                    yield 'data: '+json.dumps({'type':'run.state','version':VERSION,'run':page['run'],'cursor':cursor})+'\n\n'
                    if page.get('terminal') and not page.get('hasMore'):return
                    if not page.get('hasMore'):await asyncio.sleep(.5)
            except (CustomerError,HTTPException):return
            finally:
                limits.streams[p.owner_id]-=1
                if not limits.streams[p.owner_id]:limits.streams.pop(p.owner_id,None)
        return StreamingResponse(generate(),media_type='text/event-stream',headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'})

    @api.post('/runs/{run_id}/cancel')
    async def cancel(run_id:str,p=Depends(principal)):
        return {'version':VERSION,**await native.cancel(p,run_id)}

    return api,management

def public_operation(op):
    return {'operationId':op['id'],'botId':op['bot'],'conversationId':op['conversation'],
            'turnId':op['turn_id'],'userMessageId':op['user_message_id'],'assistantMessageId':op['assistant_message_id'],
            'runId':op['run_id'],'state':op['state'],'createdAt':op['created']}
