"""Owned workflow definition and settings verification for the native host wrapper."""
from __future__ import annotations
import hashlib,json,re
from .client import BridgeError

_SETTINGS={'executionOrder':'v1','saveManualExecutions':True,'saveExecutionProgress':False,'saveDataSuccessExecution':'all','saveDataErrorExecution':'all','executionTimeout':20,'callerPolicy':'none','timezone':'UTC'}
_WORKFLOW_KEYS=frozenset({'id','name','active','isArchived','versionId','activeVersionId','triggerCount','nodeCount','createdAt','updatedAt','settings','tags','parentFolderId','description','scopes','canExecute','connections','nodes','nodeGroups','activeVersion','meta'})
_NODE_KEYS=frozenset({'id','name','type','typeVersion','position','parameters'})

def strict_json_equal(left,right):
    if type(left)in(int,float)and type(right)in(int,float):return left==right
    if type(left)is not type(right):return False
    if type(left)is dict:return left.keys()==right.keys()and all(strict_json_equal(left[k],right[k])for k in left)
    if type(left)is list:return len(left)==len(right)and all(strict_json_equal(a,b)for a,b in zip(left,right))
    return left==right

def fixed_server_settings():return dict(_SETTINGS)
def fixed_settings_operations():return [{'type':'setWorkflowSettings','settings':fixed_server_settings()}]

def verify_owned_definition(details,workflow_id,compiled,graph,*,settings_phase='bounded',expected_node_ids=None,allow_private_mcp_exposure=False,allow_archived=False):
    """Validate against the SAME approved graph + compiler result, never model code.

    created phase accepts only known tool-created defaults. bounded phase requires
    exact fixed host settings. Exposure override is private-admin-only, explicit.
    After first verification store name->ID proof and pass it on subsequent reads.
    """
    digest=hashlib.sha256(json.dumps(graph,sort_keys=True,ensure_ascii=True,allow_nan=False,separators=(',',':')).encode()).hexdigest()
    if digest!=compiled.digest or not re.fullmatch('[a-f0-9]{32}',compiled.workflow_nonce)or compiled.workflow_name!='starli-owned-graph-'+compiled.workflow_nonce or compiled.node_names!={n['id']:'starli_node_'+str(i)for i,n in enumerate(graph['nodes'])}:raise BridgeError('approved_graph_binding_invalid')
    workflow=details.get('workflow')if type(details)is dict else None
    if type(workflow)is not dict or set(workflow)-_WORKFLOW_KEYS or workflow.get('id')!=workflow_id or workflow.get('name')!=compiled.workflow_name:raise BridgeError('owned_workflow_binding_invalid')
    if workflow.get('active')is not False or workflow.get('activeVersion')or workflow.get('activeVersionId')or not allow_archived and workflow.get('isArchived')is not False:raise BridgeError('owned_workflow_not_private_inactive')
    settings=workflow.get('settings')
    if type(settings)is not dict:raise BridgeError('owned_workflow_settings_missing')
    if settings.get('availableInMCP',False)is not False and not(allow_private_mcp_exposure and settings.get('availableInMCP')is True):raise BridgeError('automatic_mcp_exposure_rejected')
    if settings_phase=='created':
        if set(settings)-{'executionOrder','availableInMCP'}or settings.get('executionOrder')!='v1':raise BridgeError('owned_workflow_created_settings_changed')
    elif settings_phase=='bounded':
        if set(settings)-set(_SETTINGS)-{'availableInMCP'}or any(settings.get(k)!=v or type(settings.get(k))is not type(v)for k,v in _SETTINGS.items()):raise BridgeError('owned_workflow_bounded_settings_changed')
    else:raise BridgeError('settings_verification_phase_invalid')
    if workflow.get('nodeGroups')not in(None,[]):raise BridgeError('owned_workflow_groups_unapproved')
    meta=workflow.get('meta')or{}
    if type(meta)is not dict or set(meta)-{'aiBuilderAssisted','builderVariant','templateCredsSetupCompleted'}:raise BridgeError('owned_workflow_metadata_unapproved')
    nodes=workflow.get('nodes')
    if type(nodes)is not list or len(nodes)!=len(graph['nodes'])or workflow.get('nodeCount',len(nodes))!=len(nodes):raise BridgeError('owned_workflow_node_count')
    expected={compiled.node_names[n['id']]:n for n in graph['nodes']};actual_names=set();ids=set();node_ids={}
    for node in nodes:
        if type(node)is not dict or set(node)-_NODE_KEYS:raise BridgeError('owned_workflow_unsafe_node_property')
        name=node.get('name');wanted=expected.get(name);ident=node.get('id')
        if type(ident)is not str or not re.fullmatch('[A-Za-z0-9_-]{1,128}',ident)or ident in ids:raise BridgeError('owned_workflow_node_identity')
        if not wanted or name in actual_names or node.get('type')!=wanted['type']or type(node.get('typeVersion'))not in(int,float)or node.get('typeVersion')!=wanted['version']or not strict_json_equal(node.get('parameters',{}),wanted['parameters']):raise BridgeError('owned_workflow_node_mismatch')
        position=node.get('position')
        if type(position)is not list or len(position)!=2 or any(type(n)not in(int,float)or not -100000<=n<=100000 for n in position):raise BridgeError('owned_workflow_position_invalid')
        if expected_node_ids is not None and expected_node_ids.get(name)!=ident:raise BridgeError('owned_workflow_node_id_changed')
        actual_names.add(name);ids.add(ident);node_ids[name]=ident
    if expected_node_ids is not None and set(expected_node_ids)!=actual_names:raise BridgeError('owned_workflow_node_id_changed')
    connections=set();raw_connections=workflow.get('connections')
    if type(raw_connections)is not dict:raise BridgeError('owned_workflow_connections_missing')
    for source,ports in raw_connections.items():
        if source not in expected or type(ports)is not dict or set(ports)-{'main'}or type(ports.get('main'))is not list:raise BridgeError('owned_workflow_connection_invalid')
        for index,targets in enumerate(ports['main']):
            if type(targets)is not list:raise BridgeError('owned_workflow_connection_invalid')
            for target in targets:
                if type(target)is not dict or set(target)!={'node','type','index'}or target['type']!='main'or type(target['index'])is not int or target['index']!=0 or target['node']not in expected:raise BridgeError('owned_workflow_connection_invalid')
                edge=(source,target['node'],index)
                if edge in connections:raise BridgeError('owned_workflow_duplicate_connection')
                connections.add(edge)
    wanted={(compiled.node_names[e['from']],compiled.node_names[e['to']],e.get('output',0))for e in graph['edges']}
    if connections!=wanted:raise BridgeError('owned_workflow_topology_mismatch')
    return workflow

def definition_proof(workflow):
    nodes={n['name']:n['id']for n in workflow['nodes']}
    canonical={k:workflow[k]for k in('id','name','nodes','connections','settings')}
    return {'workflowId':workflow['id'],'name':workflow['name'],'versionId':workflow.get('versionId'),'nodeIds':nodes,'definitionSha256':hashlib.sha256(json.dumps(canonical,sort_keys=True,separators=(',',':')).encode()).hexdigest()}


def verify_bound_definition(details,proof,graph,*,allow_private_mcp_exposure=False,allow_archived=False):
    """Repeat full validation using the durable proof captured after bounded setup."""
    from .compiler import CompiledGraph
    if type(proof)is not dict or not {'workflowId','name','nodeIds','definitionSha256'}<=set(proof):raise BridgeError('owned_definition_proof_invalid')
    name=proof['name'];prefix='starli-owned-graph-'
    if type(name)is not str or not name.startswith(prefix):raise BridgeError('owned_definition_proof_invalid')
    digest=hashlib.sha256(json.dumps(graph,sort_keys=True,ensure_ascii=True,allow_nan=False,separators=(',',':')).encode()).hexdigest()
    compiled=CompiledGraph('',digest,name,name[len(prefix):],{n['id']:'starli_node_'+str(i)for i,n in enumerate(graph['nodes'])},tuple(n['type']for n in graph['nodes']))
    value=verify_owned_definition(details,proof['workflowId'],compiled,graph,expected_node_ids=proof['nodeIds'],allow_private_mcp_exposure=allow_private_mcp_exposure,allow_archived=allow_archived)
    if definition_proof(value)!=proof:raise BridgeError('owned_definition_proof_changed')
    return value
