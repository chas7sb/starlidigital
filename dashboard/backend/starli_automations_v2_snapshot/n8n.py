"""Private replaceable execution adapter; no undocumented editor APIs.

n8n coordinates an opaque execution reference only. Reviewed provider actions,
credentials and canonical approvals remain in the Starli gateway.
"""
import asyncio
import ipaddress
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Protocol
from .common import Fault, need, encoded

@dataclass(frozen=True)
class EngineWorkflow:
    id: str
    path: str

class AutomationEngine(Protocol):
    async def health(self): ...
    async def create_workflow(self, workflow, version, path): ...
    async def update_workflow(self, mapped, workflow, version): ...
    async def activate_workflow(self, mapped): ...
    async def pause_workflow(self, mapped): ...
    async def execute_workflow(self, mapped, execution): ...
    async def cancel_execution(self, mapped, execution): ...
    async def get_execution(self, mapped, execution): ...
    async def list_workflows(self, mapped): ...

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k): raise Fault('UPSTREAM_REDIRECT_DENIED',502)

class JsonTransport:
    """Exact server-owned origin; ignores ambient proxy settings; bounded bodies."""
    def __init__(self, origin, *, allow_loopback_http=False, timeout=20):
        parsed=urllib.parse.urlsplit(origin)
        need(not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and parsed.path in ('','/'), 'ENGINE_ORIGIN_INVALID',500)
        loopback=False
        try: loopback=ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError: pass
        need(parsed.scheme=='https' or parsed.scheme=='http' and loopback and allow_loopback_http, 'PRIVATE_TLS_OR_LOOPBACK_REQUIRED',500)
        self.origin=origin.rstrip('/');self.timeout=timeout
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    async def request(self, method, path, *, headers=None, body=None):
        need(path.startswith('/') and not path.startswith('//') and '#' not in path, 'TRANSPORT_PATH_INVALID',500)
        def send():
            raw=None if body is None else encoded(body).encode()
            request=urllib.request.Request(self.origin+path,data=raw,method=method,headers={'Content-Type':'application/json',**(headers or {})})
            try:
                with self.opener.open(request,timeout=self.timeout) as response:
                    data=response.read(1048577)
                    need(len(data)<=1048576,'UPSTREAM_OUTPUT_LIMIT',502)
                    return response.status,json.loads(data or b'{}')
            except urllib.error.HTTPError as error:
                # Never log or return remote error bodies containing secrets.
                failure=Fault('UPSTREAM_REJECTED',502)
                failure.upstream_status=error.code
                raise failure from None
            except (OSError,ValueError,TimeoutError): raise Fault('UPSTREAM_OUTCOME_UNKNOWN',502) from None
        return await asyncio.to_thread(send)

def graph(workflow, version, path):
    """Only these two reviewed node types; no model-controlled expression/code."""
    need(re.fullmatch('[a-f0-9]{32}',workflow) and re.fullmatch('[a-f0-9]{48}',path), 'ENGINE_BINDING_INVALID',500)
    return dict(name='Starli '+workflow+' v'+str(version),
        nodes=[dict(id='starli-trigger',name='Starli input',type='n8n-nodes-base.webhook',typeVersion=2,position=[0,0],
                    webhookId=path,parameters=dict(httpMethod='POST',path='starli-'+path,responseMode='lastNode',options={})),
               dict(id='starli-receipt',name='Starli receipt',type='n8n-nodes-base.set',typeVersion=3.4,position=[240,0],
                    parameters=dict(assignments=dict(assignments=[
                        dict(id='execution',name='executionId',type='string',value='={{ $json.body.executionId }}'),
                        dict(id='engine',name='engineExecutionId',type='string',value='={{ $execution.id }}')]),options={}))],
        connections={'Starli input':{'main':[[dict(node='Starli receipt',type='main',index=0)]]}},
        # Only opaque references exist in this graph. Retain its receipt so
        # public execution polling can verify completion/ownership afterwards.
        settings=dict(executionOrder='v1',executionTimeout=60,saveDataSuccessExecution='all',saveDataErrorExecution='all',saveManualExecutions=False))

class N8nEngine:
    def __init__(self, transport, api_key):
        need(callable(api_key),'ENGINE_KEY_CALLBACK_REQUIRED',500)
        self.transport,self.api_key=transport,api_key
    def headers(self):
        key=self.api_key();need(type(key)is str and len(key)>10,'ENGINE_NOT_CONFIGURED',503)
        return {'X-N8N-API-KEY':key}
    def path(self,identifier):
        need(type(identifier)is str and re.fullmatch('[A-Za-z0-9_-]{1,128}',identifier),'ENGINE_ID_INVALID',500)
        return identifier
    async def api(self,method,path,body=None):
        _,result=await self.transport.request(method,'/api/v1'+path,headers=self.headers(),body=body)
        return result
    async def health(self):
        await self.api('GET','/workflows?limit=1')
        return {'available':True}
    async def create_workflow(self,workflow,version,path):
        result=await self.api('POST','/workflows',graph(workflow,version,path))
        return EngineWorkflow(self.path(result['id']),path)
    async def update_workflow(self,mapped,workflow,version):
        await self.api('PUT','/workflows/'+self.path(mapped.id),graph(workflow,version,mapped.path))
    async def activate_workflow(self,mapped):
        await self.api('POST','/workflows/'+self.path(mapped.id)+'/activate')
    async def pause_workflow(self,mapped):
        await self.api('POST','/workflows/'+self.path(mapped.id)+'/deactivate')
    async def execute_workflow(self,mapped,execution):
        need(re.fullmatch('[a-f0-9]{32}',execution),'EXECUTION_REFERENCE_INVALID',500)
        # API key is deliberately absent on execution webhooks.
        for attempt in range(21):
            try:
                _,result=await self.transport.request('POST','/webhook/starli-'+mapped.path,body={'executionId':execution})
                break
            except Fault as error:
                # n8n 2.47.7 publishes activeVersion before webhook registration
                # settles. A 404 from this FIXED inert graph proves no execution
                # started; only that known-not-started case is safely retried.
                if getattr(error,'upstream_status',None)!=404 or attempt==20:raise
                await asyncio.sleep(.5)
        if isinstance(result,list) and len(result)==1: result=result[0]
        need(type(result)is dict and result.get('executionId')==execution and type(result.get('engineExecutionId'))is str,'ENGINE_RECEIPT_MISMATCH',502)
        return {'id':result['engineExecutionId'],'status':'COMPLETED'}
    async def get_execution(self,mapped,execution):
        result=await self.api('GET','/executions/'+self.path(execution)+'?includeData=false')
        need(str(result.get('workflowId'))==mapped.id,'ENGINE_EXECUTION_OWNER_MISMATCH',403)
        return {'id':str(result['id']),'status':result.get('status','UNKNOWN')}
    async def cancel_execution(self,mapped,execution):
        # No documented generic cancellation is assumed. Provider side effects
        # are independently stopped at gateway authorization fences.
        await self.get_execution(mapped,execution)
        return {'status':'UNSUPPORTED','confirmedStopped':False}
    async def list_workflows(self,mapped):
        # Never instance-wide list exposed to a tenant; only owned mappings.
        result=[]
        for item in mapped:
            row=await self.api('GET','/workflows/'+self.path(item.id))
            result.append({'id':item.id,'active':bool(row.get('active'))})
        return result
