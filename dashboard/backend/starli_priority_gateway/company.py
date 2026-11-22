"""Generic reviewed nodes + symbolic company connections -> private SDK.

No per-provider handler, model credential IDs, placeholders or model code.
"""
import asyncio,copy,hashlib,json,re
from dataclasses import dataclass
from decimal import Decimal
from starli_n8n_mcp.client import BridgeError
from .bounded import compile_graph,NodeSpec
from starli_n8n_mcp.lifecycle import verify_owned_definition,definition_proof,verify_bound_definition

def need(v,code):
    if not v:raise BridgeError(code)
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()

@dataclass(frozen=True)
class NodeRule:
    operations:frozenset # exact (resource,operation/action/mode) tuples, or ('default','default')
    effect:str # pure | external_read | external_write
    hosts:tuple=()
    scopes:tuple=()

def operation(params):return (params.get('resource','default'),params.get('operation',params.get('action',params.get('mode','default'))))
def account_free_policy():
    pure=lambda values:NodeRule(frozenset(('default',v) for v in values),'pure')
    return {
        'n8n-nodes-base.manualTrigger':pure(['default']),
        'n8n-nodes-base.noOp':pure(['default']),
        'n8n-nodes-base.set':pure(['manual','raw']),
        'n8n-nodes-base.if':pure(['default']),
        'n8n-nodes-base.switch':pure(['rules','expression']),
        'n8n-nodes-base.merge':pure(['append','combine','chooseBranch']),
        'n8n-nodes-base.limit':pure(['default']),
        'n8n-nodes-base.aggregate':pure(['aggregateIndividualFields','aggregateAllItemData']),
        'n8n-nodes-base.splitOut':pure(['default']),
        'n8n-nodes-base.sort':pure(['simple']),
        'n8n-nodes-base.summarize':pure(['default']),
        'n8n-nodes-base.dateTime':pure(['addToDate','extractDate','formatDate','getCurrentDate','getTimeBetweenDates','roundDate','subtractFromDate']),
        'n8n-nodes-base.crypto':pure(['hash']), # No raw encryption/HMAC/signing secrets.
    }

@dataclass(frozen=True)
class BoundGraph:
    compiled:object
    graph:dict # sanitized frozen compiler graph, no user credential objects
    bindings:dict # private nodeName -> verified owned credential metadata
    connections:dict # private model nodeID -> handle/type/revision for fresh resolve
    review_hash:str
    effects:tuple

def public_review(ctx,bound):
    """Exact business graph for human review, without engine credential IDs/names."""
    graph=copy.deepcopy(bound.graph)
    for node in graph['nodes']:
        conn=bound.connections.get(node['id'])
        if conn:
            lease=bound.bindings[bound.compiled.node_names[node['id']]]
            need(lease['companyId']==ctx.company,'company_review_scope_changed')
            node['connection']={**conn,'status':lease['status'],'scopeVerification':lease.get('scopeVerification','NOT_AVAILABLE')}
    return {'version':'starli.connector-execution.v1','companyId':ctx.company,'reviewHash':bound.review_hash,'graph':graph,'effects':copy.deepcopy(list(bound.effects))}

class CompanyCompiler:
    def __init__(self,client,installed,resolver,policy):
        self.client,self.installed,self.resolver,self.policy=client,installed,resolver,policy
    def call(self,name,args):return self.client.content(self.client.call(name,args))
    async def compile(self,ctx,graph):
        need(type(graph)is dict and set(graph)=={'nodes','edges'} and type(graph['nodes'])is list and 1<=len(graph['nodes'])<=50,'company_graph_invalid')
        sanitized=copy.deepcopy(graph);connections={};specs={};bindings={};effects=[]
        metadata=copy.deepcopy(self.installed)
        for index,node in enumerate(sanitized['nodes']):
            need(type(node)is dict and {'id','type','version','parameters'}<=set(node)<= {'id','type','version','parameters','connection'},'company_node_fields_invalid')
            need(type(node['id'])is str and re.fullmatch('[A-Za-z][A-Za-z0-9_-]{0,63}',node['id']) and type(node['type'])is str and type(node['version']) in (int,float) and type(node['parameters'])is dict,'company_node_fields_invalid')
            typ=node['type'];rule=self.policy.get(typ);need(rule is not None and typ in metadata,'company_node_policy_not_reviewed')
            need(all(type(node['parameters'][k])is str for k in ('resource','operation','action','mode') if k in node['parameters']),'company_operation_not_reviewed')
            need(rule.effect in ('pure','external_read','external_write') and (operation(node['parameters']) in rule.operations or ('*','*') in rule.operations or (operation(node['parameters'])[0],'*') in rule.operations),'company_operation_not_reviewed')
            connection=node.pop('connection',None);lease=None
            if metadata[typ].get('credentialTypes') and not (typ=='n8n-nodes-base.httpRequest' and node['parameters'].get('authentication','none')=='none'):
                need(rule.effect!='pure','company_credentialed_node_effect_not_reviewed')
                need(type(connection)is dict and set(connection)=={'handle','credentialType','expectedRevision'},'company_connection_required')
                need(connection['credentialType'] in metadata[typ]['credentialTypes'],'company_credential_type_not_supported')
                lease=await self.resolver.resolve(ctx,connection['handle'],connection['credentialType'],connection['expectedRevision'])
                self.check_lease(ctx,lease,connection,rule)
                connections[node['id']]=connection;bindings['starli_node_'+str(index)]=dict(lease)
            else:need(connection is None,'company_node_credentials_unexpected')
            if rule.effect!='pure':
                need(bool(rule.hosts) and all(h=='@public' or type(h)is str and re.fullmatch('[a-z0-9](?:[a-z0-9.-]{0,250}[a-z0-9])?',h) and '.' in h and not h.endswith('.local') for h in rule.hosts),'company_provider_egress_not_reviewed')
            effects.append({'nodeId':node['id'],'nodeType':typ,'operation':operation(node['parameters']),'effect':rule.effect,'hosts':list(rule.hosts),'scopes':list(rule.scopes)})
            request={'nodeId':typ,'version':str(node['version']),**{k:node['parameters'][k] for k in ('resource','operation','mode') if type(node['parameters'].get(k))is str}}
            response=await asyncio.to_thread(self.call,'get_node_types',{'nodeIds':[request]})
            definitions=response.get('definitions') if type(response)is dict else None
            need(type(definitions)is str,'company_node_definition_missing')
            versions={(t,str(Decimal(v).normalize())) for t,v in re.findall(r"type:\s*['\"]([^'\"]+)['\"];\s*version:\s*([0-9.]+)",definitions)}
            key=(typ,str(Decimal(str(node['version'])).normalize()));need(key in versions,'company_node_version_not_installed')
            if lease:need(re.search(r'\b'+re.escape(lease['credentialType'])+r'\??\s*:\s*CredentialReference',definitions) is not None,'company_node_credential_schema_changed')
            specs[key]=NodeSpec(typ,key[1],typ=='n8n-nodes-base.manualTrigger')
            metadata[typ]['credentialTypes']=[] # Credentials already resolved above, never auto-assigned.
        compiled=compile_graph(sanitized,metadata,specs)
        lines=compiled.code.splitlines()
        for index,node in enumerate(sanitized['nodes']):
            name=compiled.node_names[node['id']];lease=bindings.get(name)
            if lease:
                # SDK existing CredentialReference literal: exact actual registry ID/name.
                prefix='const n'+str(index)+' = node('
                matching=[i for i,line in enumerate(lines) if line.startswith(prefix)];need(len(matching)==1,'company_sdk_shape_changed')
                line=matching[0];payload=json.loads(lines[line][len(prefix):-2]);payload['config']['credentials']={lease['credentialType']:{'id':lease['credentialId'],'name':lease['credentialName']}}
                lines[line]=prefix+json.dumps(payload,separators=(',',':'))+');'
        compiled=type(compiled)('\n'.join(lines)+'\n',compiled.digest,compiled.workflow_name,compiled.workflow_nonce,compiled.node_names,compiled.types)
        valid=await asyncio.to_thread(self.call,'validate_node_config',{'nodes':[{'name':compiled.node_names[n['id']],'type':n['type'],'typeVersion':n['version'],'parameters':n['parameters']} for n in sanitized['nodes']]})
        need(type(valid)is dict and valid.get('valid')is True and len(valid.get('results',[]))==len(sanitized['nodes']),'company_native_node_schema_invalid')
        result=await asyncio.to_thread(self.call,'validate_workflow',{'code':compiled.code});need(type(result)is dict and result.get('valid')is True,'company_sdk_validation_failed')
        return BoundGraph(compiled,sanitized,bindings,connections,digest({'graph':graph,'bindings':bindings,'effects':effects}),tuple(effects))
    @staticmethod
    def check_lease(ctx,lease,connection,rule):
        need(type(lease)is dict and lease.get('companyId')==ctx.company and lease.get('connectionId')==connection['handle'] and lease.get('credentialType')==connection['credentialType'] and lease.get('revision')==connection['expectedRevision'],'company_credential_scope_mismatch')
        need(lease.get('requestedByBotId')==ctx.bot and lease.get('sourceConversationId')==ctx.room,'company_credential_actor_scope_mismatch')
        need(lease.get('status') in ('STORED_NOT_VERIFIED','VERIFIED'),'company_credential_not_available')
        need(type(lease.get('credentialId'))is str and type(lease.get('credentialName'))is str and len(lease['credentialId'])<=160 and len(lease['credentialName'])<=200,'company_credential_reference_invalid')
        need(set(rule.scopes)<=set(lease.get('scopes',[])),'company_credential_scopes_not_verified')
    async def refresh_bindings(self,ctx,bound):
        for node in bound.graph['nodes']:
            conn=bound.connections.get(node['id'])
            if conn:
                fresh=await self.resolver.resolve(ctx,conn['handle'],conn['credentialType'],conn['expectedRevision'])
                self.check_lease(ctx,fresh,conn,self.policy[node['type']])
                need(fresh==bound.bindings[bound.compiled.node_names[node['id']]],'company_credential_binding_changed')

def verify_definition(details,workflow_id,bound,*,phase='bounded',proof=None):
    original=copy.deepcopy(details);workflow=original.get('workflow') if type(original)is dict else None
    need(type(workflow)is dict,'company_definition_missing')
    for node in workflow.get('nodes',[]):
        lease=bound.bindings.get(node.get('name'));expected={lease['credentialType']:{'id':lease['credentialId'],'name':lease['credentialName']}} if lease else None
        actual=node.pop('credentials',None)
        need(actual==expected or expected is None and actual=={},'company_workflow_credentials_changed')
    if proof:verify_bound_definition(original,proof,bound.graph,allow_private_mcp_exposure=True)
    else:verify_owned_definition(original,workflow_id,bound.compiled,bound.graph,settings_phase=phase,allow_private_mcp_exposure=True)
    return definition_proof(workflow)
