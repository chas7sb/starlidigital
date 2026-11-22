"""Private server-side Streamable HTTP client; no user/bot administrative proxy."""
from __future__ import annotations
import json,time,urllib.request,urllib.error,urllib.parse,pathlib,threading

class BridgeError(Exception):
    """Only bounded stable codes cross trust/logging boundaries."""
    def __init__(self,code):self.code=code;super().__init__(code)

class SchemaError(BridgeError):pass
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise BridgeError('mcp_redirect_forbidden')

def validate(value,schema,root=None,depth=0):
    if depth>50:raise SchemaError('schema_depth')
    root=root or schema
    if schema is True:return
    if schema is False:raise SchemaError('schema_forbidden')
    if '$ref' in schema:
        ref=schema['$ref']
        if not ref.startswith('#/'):raise SchemaError('external_schema_reference')
        target=root
        try:
            for part in ref[2:].split('/'):target=target[part.replace('~1','/').replace('~0','~')]
        except (KeyError,TypeError):raise SchemaError('schema_reference_invalid') from None
        validate(value,target,root,depth+1)
    for key in ('anyOf','oneOf'):
        if key in schema:
            successes=0
            for option in schema[key]:
                try:validate(value,option,root,depth+1);successes+=1
                except SchemaError:pass
            if not successes or key=='oneOf' and successes!=1:raise SchemaError('schema_union')
    for option in schema.get('allOf',[]):validate(value,option,root,depth+1)
    types={'object':lambda v:type(v)is dict,'array':lambda v:type(v)is list,'string':lambda v:type(v)is str,'integer':lambda v:type(v)is int,'number':lambda v:type(v)in(int,float),'boolean':lambda v:type(v)is bool,'null':lambda v:v is None}
    expected=schema.get('type')
    if expected:
        names=expected if type(expected)is list else [expected]
        if not any(n in types and types[n](value)for n in names):raise SchemaError('schema_type')
    if 'enum'in schema and value not in schema['enum']:raise SchemaError('schema_enum')
    if 'const'in schema and value!=schema['const']:raise SchemaError('schema_const')
    if type(value)is dict:
        props=schema.get('properties',{})
        if not set(schema.get('required',[]))<=set(value):raise SchemaError('schema_required')
        if len(value)>256:raise SchemaError('schema_object_limit')
        for key,item in value.items():
            if key in props:validate(item,props[key],root,depth+1)
            elif schema.get('additionalProperties',True)is False:raise SchemaError('schema_extra_property')
            elif type(schema.get('additionalProperties'))is dict:validate(item,schema['additionalProperties'],root,depth+1)
    elif type(value)is list:
        if len(value)<schema.get('minItems',0)or len(value)>min(schema.get('maxItems',10000),10000):raise SchemaError('schema_array_limit')
        for item in value:validate(item,schema.get('items',{}),root,depth+1)
    elif type(value)is str:
        if len(value)<schema.get('minLength',0)or len(value)>min(schema.get('maxLength',300000),300000):raise SchemaError('schema_string_limit')
        if 'pattern'in schema:
            import re
            if not re.search(schema['pattern'],value):raise SchemaError('schema_pattern')
    elif type(value)in(int,float):
        import math
        if not math.isfinite(value):raise SchemaError('schema_number_invalid')
        if 'minimum'in schema and value<schema['minimum']or 'maximum'in schema and value>schema['maximum']or 'exclusiveMinimum'in schema and value<=schema['exclusiveMinimum']or 'exclusiveMaximum'in schema and value>=schema['exclusiveMaximum']:raise SchemaError('schema_number_limit')

READ_ONLY_TOOLS=frozenset({'search_nodes','get_node_types','get_workflow_sdk_reference','get_workflow_best_practices','validate_workflow','validate_node_config'})
OWNED_WORKFLOW_TOOLS=READ_ONLY_TOOLS|{'create_workflow_from_code','get_workflow_details','execute_workflow','get_workflow_execution','archive_workflow','update_workflow'}

class McpClient:
    def __init__(self,endpoint,token,schemas,*,allowed_tools=READ_ONLY_TOOLS,timeout=25,max_bytes=2*1024*1024,opener=None):
        u=urllib.parse.urlsplit(endpoint)
        if u.scheme not in ('http','https')or u.username or u.password or u.query or u.fragment or u.path!='/mcp-server/http'or u.hostname not in ('127.0.0.1','localhost','::1'):raise BridgeError('private_loopback_endpoint_required')
        if not token or '\r'in token or '\n'in token:raise BridgeError('private_credential_required')
        self._endpoint,self._token,self.schemas=endpoint,token,schemas
        self.allowed=frozenset(allowed_tools);self.timeout=min(max(timeout,1),60);self.max_bytes=min(max_bytes,4*1024*1024);self.opener=opener or urllib.request.build_opener(_NoRedirect()).open;self.session=None;self.counter=0;self.lock=threading.Lock()
    def __repr__(self):return '<McpClient private>'
    @classmethod
    def from_private_file(cls,path,catalog,**options):
        data=json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
        tools=json.loads(pathlib.Path(catalog).read_text(encoding='utf-8'))['tools']
        return cls(data['baseUrl'],data['token'],{t['name']:t['inputSchema']for t in tools},**options)
    def close(self):self._token='';self.session=None
    def _post(self,method,params=None,notification=False):
        with self.lock:
            self.counter+=1;ident=self.counter;payload={'jsonrpc':'2.0','method':method}
            if not notification:payload['id']=ident
            if params is not None:payload['params']=params
            body=json.dumps(payload,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
            if len(body)>400000:raise BridgeError('mcp_request_limit')
            if not self._token:raise BridgeError('mcp_client_closed')
            headers={'Authorization':'Bearer '+self._token,'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'}
            if self.session:headers['Mcp-Session-Id']=self.session
            request=urllib.request.Request(self._endpoint,data=body,headers=headers,method='POST');started=time.monotonic()
            try:
                with self.opener(request,timeout=self.timeout)as response:
                    sid=response.headers.get('Mcp-Session-Id')
                    if sid:
                        if len(sid)>256 or '\r'in sid or '\n'in sid:raise BridgeError('mcp_session_invalid')
                        self.session=sid
                    if notification:return None
                    mime=response.headers.get('Content-Type','').split(';')[0]
                    if mime=='text/event-stream':
                        buffer=b'';event=[];total=0
                        while True:
                            if time.monotonic()-started>self.timeout:raise BridgeError('mcp_deadline')
                            chunk=response.read1(4096)if hasattr(response,'read1')else response.read(4096)
                            if not chunk:break
                            total+=len(chunk)
                            if total>self.max_bytes:raise BridgeError('mcp_response_limit')
                            buffer+=chunk
                            while b'\n'in buffer:
                                line,buffer=buffer.split(b'\n',1);line=line.rstrip(b'\r')
                                if line.startswith(b'data:'):event.append(line[5:].lstrip())
                                elif not line and event:
                                    value=json.loads(b'\n'.join(event));event=[]
                                    if value.get('id')==ident:return self._result(value)
                        raise BridgeError('mcp_response_incomplete')
                    if mime!='application/json':raise BridgeError('mcp_content_type')
                    chunks=[];size=0
                    while True:
                        if time.monotonic()-started>self.timeout:raise BridgeError('mcp_deadline')
                        part=response.read1(4096)if hasattr(response,'read1')else response.read(4096)
                        if not part:break
                        size+=len(part)
                        if size>self.max_bytes:raise BridgeError('mcp_response_limit')
                        chunks.append(part)
                    raw=b''.join(chunks)
                    value=json.loads(raw)
                    if value.get('id')!=ident:raise BridgeError('mcp_response_identity')
                    return self._result(value)
            except BridgeError:raise
            except urllib.error.HTTPError as error:raise BridgeError('mcp_http_'+str(error.code))from None
            except Exception:raise BridgeError('mcp_transport_unavailable')from None
    def _result(self,value):
        if 'error'in value:raise BridgeError('mcp_rpc_rejected')
        if 'result'not in value:raise BridgeError('mcp_result_missing')
        return value['result']
    def initialize(self):
        result=self._post('initialize',{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'starli-private-graph-bridge','version':'1.0'}})
        self._post('notifications/initialized',notification=True);return result
    def list_tools(self):return self._post('tools/list',{})
    def call(self,name,arguments):
        if type(name)is not str or name not in self.allowed:raise BridgeError('mcp_tool_not_allowed')
        if name not in self.schemas:raise BridgeError('mcp_tool_schema_missing')
        validate(arguments,self.schemas[name])
        if name=='update_workflow':
            from .lifecycle import fixed_settings_operations
            if arguments.get('operations')!=fixed_settings_operations():raise BridgeError('mcp_update_server_constants_only')
        result=self._post('tools/call',{'name':name,'arguments':arguments})
        if type(result)is not dict:raise BridgeError('mcp_tool_result_invalid')
        if result.get('isError'):raise BridgeError('mcp_tool_rejected')
        return result
    @staticmethod
    def content(result):
        if type(result.get('structuredContent'))is dict:return result['structuredContent']
        texts=[v.get('text','')for v in result.get('content',[])if v.get('type')=='text']
        joined='\n'.join(texts)
        try:return json.loads(joined)
        except ValueError:return joined
