"""Generic bounded GRAPH DSL -> server-generated SDK. Input is JSON, never code."""
from __future__ import annotations
import json,re,uuid,hashlib,math
from dataclasses import dataclass
from decimal import Decimal
from starli_n8n_mcp.client import BridgeError

BLOCKED_TYPES=frozenset({'code','function','functionItem','executeCommand','ssh','readWriteFile','readBinaryFile','readBinaryFiles','writeBinaryFile','localFileTrigger','httpRequestTool','webhook','respondToWebhook','executeWorkflow','executeWorkflowTrigger','n8n','n8nTrigger','readPdf','ftp','sftp','git','scheduleTrigger','interval','cron','errorTrigger','wait'})
FORBIDDEN_KEYS=frozenset({'__proto__','prototype','constructor','token','secret','auth','credentials','credential','credentialid','apikey','api_key','accesstoken','access_token','refreshtoken','refresh_token','authorization','password','clientsecret','client_secret','privatekey','private_key','jscode','pythoncode','command','shell','environment','env','executable','filename','filepath','path'})
DANGEROUS_TEXT=re.compile(r'\{\{|\}\}|\$\{|\$env\b|\$credentials\b|\bprocess\s*\.|\bglobalThis\b|\brequire\s*\(|\bimport\s*\(|<script\b|javascript:|(?:file|ssh|https?)://',re.I)
@dataclass(frozen=True)
class NodeSpec:
    type:str
    version:str
    trigger:bool=False
@dataclass(frozen=True)
class CompiledGraph:
    code:str
    digest:str
    workflow_name:str
    workflow_nonce:str
    node_names:dict
    types:tuple


def inspect_json(value,depth=0,budget=None):
    budget=budget or [0];budget[0]+=1
    if budget[0]>10000 or depth>20:raise BridgeError('graph_parameter_complexity')
    if type(value)is dict:
        if len(value)>128:raise BridgeError('graph_parameter_object_limit')
        for key,item in value.items():
            if type(key)is not str or key.lower()in FORBIDDEN_KEYS or len(key)>160:raise BridgeError('graph_secret_or_code_parameter')
            if key.lower()in {'numberofitems','batchsize','limit','maxitems','iterations','count','timeout','seconds','minutes','hours','days'}and type(item)in(int,float)and not 0<=item<=1000:raise BridgeError('graph_resource_budget')
            inspect_json(item,depth+1,budget)
    elif type(value)is list:
        if len(value)>1000:raise BridgeError('graph_parameter_array_limit')
        for item in value:inspect_json(item,depth+1,budget)
    elif type(value)is str:
        if len(value)>16000 or '\x00'in value or value.lstrip().startswith('=') or DANGEROUS_TEXT.search(value):raise BridgeError('graph_expression_or_destination_forbidden')
    elif type(value)in(int,float):
        if not math.isfinite(value)or abs(value)>10**15:raise BridgeError('graph_number_limit')
    elif value is not None and type(value)is not bool:raise BridgeError('graph_json_only')


def resolve_specs(client,installed,nodes):
    if type(nodes)is not list or not 1<=len(nodes)<=50:raise BridgeError('graph_size_limit')
    requests=[]
    for value in nodes:
        if type(value)is not dict or set(value)!={'id','type','version','parameters'}or type(value['type'])is not str or type(value['version'])not in(int,float)or not math.isfinite(value['version'])or not 0<value['version']<100 or type(value['parameters'])is not dict:raise BridgeError('graph_node_fields_invalid')
        inspect_json(value['parameters'])
        typ=value.get('type');version=value.get('version')
        if typ not in installed:raise BridgeError('graph_node_not_installed')
        if typ.rsplit('.',1)[-1]in BLOCKED_TYPES:raise BridgeError('graph_node_type_forbidden')
        if installed[typ].get('credentialTypes'):raise BridgeError('company_credential_binding_required')
        requests.append({'nodeId':typ,'version':str(version),**{k:value.get('parameters',{}).get(k)for k in ('resource','operation','mode')if type(value.get('parameters',{}).get(k))is str}})
    response=client.content(client.call('get_node_types',{'nodeIds':requests}))
    definitions=response.get('definitions')if type(response)is dict else None
    if type(definitions)is not str:raise BridgeError('node_definition_unavailable')
    found={(typ,str(Decimal(ver).normalize()))for typ,ver in re.findall(r"type:\s*['\"]([^'\"]+)['\"];\s*version:\s*([0-9.]+)",definitions)}
    specs={}
    for request in requests:
        version=str(Decimal(request['version']).normalize());key=(request['nodeId'],version)
        if key not in found:raise BridgeError('node_version_not_verified')
        typ=request['nodeId'];specs[key]=NodeSpec(typ,version,typ=='n8n-nodes-base.manualTrigger')
    return specs,definitions


def compile_graph(graph,installed,specs):
    if type(graph)is not dict or set(graph)!={'nodes','edges'}:raise BridgeError('graph_fields_invalid')
    nodes,edges=graph['nodes'],graph['edges']
    if type(nodes)is not list or not 1<=len(nodes)<=50 or type(edges)is not list or len(edges)>100:raise BridgeError('graph_size_limit')
    try:raw_graph=json.dumps(graph,allow_nan=False)
    except (TypeError,ValueError):raise BridgeError('graph_json_only')from None
    if len(raw_graph.encode())>128000:raise BridgeError('graph_payload_limit')
    identifiers={};types=[];triggers=[];safe_nodes=[]
    for index,value in enumerate(nodes):
        if type(value)is not dict or set(value)!={'id','type','version','parameters'}:raise BridgeError('graph_node_fields_invalid')
        ident,typ,version,params=(value[k]for k in('id','type','version','parameters'))
        if type(ident)is not str or not re.fullmatch('[A-Za-z][A-Za-z0-9_-]{0,63}',ident)or ident in identifiers:raise BridgeError('graph_node_identity_invalid')
        if type(typ)is not str or typ not in installed:raise BridgeError('graph_node_not_installed')
        if not typ.startswith('n8n-nodes-base.')or typ.rsplit('.',1)[-1]in BLOCKED_TYPES:raise BridgeError('graph_node_type_forbidden')
        if installed[typ].get('credentialTypes'):raise BridgeError('company_credential_binding_required')
        if type(version)not in(int,float)or not math.isfinite(version)or not 0<version<100:raise BridgeError('graph_node_version_invalid')
        key=(typ,str(Decimal(str(version)).normalize()));spec=specs.get(key)
        if not spec or spec.type!=typ:raise BridgeError('node_version_not_verified')
        if type(params)is not dict:raise BridgeError('graph_parameters_object_required')
        if typ=='n8n-nodes-base.httpRequest':
            from .policy import public_https
            public_https(params.get('url'))
            if set(params)-{'url','method','authentication','options'} or params.get('authentication','none')!='none' or params.get('method','GET')!='GET':raise BridgeError('unauthenticated_http_get_only')
            if type(params.get('options'))is not dict or set(params['options'])-{'redirect','timeout'}:raise BridgeError('http_options_not_reviewed')
            inspect_json({k:v for k,v in params.items() if k!='url'})
            if params.get('options',{}).get('redirect',{}).get('redirect',{}).get('followRedirects') is not False:raise BridgeError('http_redirects_must_be_disabled')
        else:inspect_json(params)
        identifiers[ident]=index;types.append(typ)
        if installed[typ].get('kind')=='trigger' and not spec.trigger:raise BridgeError('server_trigger_binding_required')
        if spec.trigger:triggers.append(ident)
        safe_nodes.append((spec,params))
    if len(triggers)!=1:raise BridgeError('graph_single_server_manual_trigger_required')
    incoming={k:0 for k in identifiers};outgoing={k:[]for k in identifiers};seen=set();safe_edges=[]
    for edge in edges:
        if type(edge)is not dict or not {'from','to'}<=set(edge)<= {'from','to','output'}:raise BridgeError('graph_edge_fields_invalid')
        source,target=edge['from'],edge['to'];output=edge.get('output',0)
        if type(source)is not str or type(target)is not str or source not in identifiers or target not in identifiers or source==target or type(output)is not int or not 0<=output<=15:raise BridgeError('graph_edge_invalid')
        key=(source,target,output)
        if key in seen:raise BridgeError('graph_duplicate_edge')
        seen.add(key);incoming[target]+=1;outgoing[source].append(target);safe_edges.append(key)
    if incoming[triggers[0]]!=0:raise BridgeError('graph_trigger_has_input')
    queue=[key for key,count in incoming.items()if count==0];visited=[];remaining=dict(incoming)
    while queue:
        current=queue.pop();visited.append(current)
        for target in outgoing[current]:
            remaining[target]-=1
            if remaining[target]==0:queue.append(target)
    if len(visited)!=len(nodes):raise BridgeError('graph_cycle_forbidden')
    reachable=set();todo=list(triggers)
    while todo:
        item=todo.pop()
        if item in reachable:continue
        reachable.add(item);todo.extend(outgoing[item])
    if reachable!=set(identifiers):raise BridgeError('graph_disconnected_nodes')
    nonce=uuid.uuid4().hex;name='starli-owned-graph-'+nonce
    literal=lambda v:json.dumps(v,ensure_ascii=True,allow_nan=False,separators=(',',':'))
    lines=["import { workflow, node, trigger } from '@n8n/workflow-sdk';"]
    names={ident:'starli_node_'+str(index)for ident,index in identifiers.items()}
    for index,(spec,params)in enumerate(safe_nodes):
        config={'name':'starli_node_'+str(index),'parameters':params}
        payload={'type':spec.type,'version':float(spec.version),'config':config}
        lines.append('const n'+str(index)+' = '+('trigger'if spec.trigger else'node')+'('+literal(payload)+');')
    lines.append('export default workflow('+literal(nonce)+','+literal(name)+')')
    for index in range(len(nodes)):lines.append('  .add(n'+str(index)+')')
    for source,target,output in safe_edges:lines.append('  .add(n'+str(identifiers[source])+'.output('+str(output)+').to(n'+str(identifiers[target])+'))')
    code='\n'.join(lines)+';\n'
    digest=hashlib.sha256(json.dumps(graph,sort_keys=True,ensure_ascii=True,allow_nan=False,separators=(',',':')).encode()).hexdigest()
    return CompiledGraph(code,digest,name,nonce,names,tuple(types))
