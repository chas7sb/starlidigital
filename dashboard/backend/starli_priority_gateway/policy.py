"""Protected deployment policy; re-read at every engine mutation and fence."""
import starli_portable as _portable
import hashlib,ipaddress,json,os,socket,stat
from pathlib import Path
from urllib.parse import urlsplit
from .company import need,NodeRule,account_free_policy

def public_https(value):
    need(type(value)is str and len(value)<=2048 and not any(x in value for x in ('{{','}}','${','\\','\x00')),'https_literal_required')
    parsed=urlsplit(value)
    need(parsed.scheme=='https' and parsed.hostname and not parsed.username and not parsed.password and not parsed.fragment and parsed.port in (None,443),'https_public_destination_required')
    host=parsed.hostname.lower()
    try:literal=ipaddress.ip_address(host)
    except ValueError:literal=None
    need(literal is None or literal.is_global,'private_destination_denied')
    need('.' in host and not host.endswith(('.local','.internal','.localhost')),'public_hostname_required')
    try:addresses=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
    except OSError:need(False,'destination_dns_unavailable')
    need(bool(addresses) and all(ipaddress.ip_address(item[4][0]).is_global for item in addresses),'private_destination_denied')
    return host

class DeploymentPolicy:
    def __init__(self,path=_portable.config_file('n8n-execution-policy.json')):self.path=Path(path)
    def read(self):
        info=self.path.stat()
        need(stat.S_ISREG(info.st_mode) and not self.path.is_symlink(),'private_policy_required')
        if os.name!='nt':need(info.st_uid==0 and info.st_mode & 0o027==0,'private_policy_required')
        data=json.loads(self.path.read_text())
        need(data.get('version')=='starli.execution-policy.v1' and data.get('networkMode')=='PUBLIC_ONLY','private_network_policy_required')
        need(type(data.get('sourcePins'))is dict and bool(data['sourcePins']),'source_pins_required')
        for path,digest in data['sourcePins'].items():
            need(Path(path).is_absolute() and hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest,'deployment_source_changed')
        need(type(data.get('loadedNodeTypes'))is list and type(data.get('allowedOperations'))is dict,'installed_nodes_policy_required')
        return data
    def rules(self):
        data=self.read();rules=account_free_policy()
        need(data.get('allowedHosts')==['@public'],'public_network_class_required')
        for typ,operations in data['allowedOperations'].items():
            need(typ in data['loadedNodeTypes'],'node_not_loaded')
            if typ in rules:continue
            if operations=='*':operations=[['*','*']]
            need(type(operations)is list and all(type(op)is list and len(op)==2 for op in operations),'node_operations_required')
            rules[typ]=NodeRule(frozenset(tuple(op) for op in operations),'external_write',('@public',),())
        return rules
    def check(self,bound):
        data=self.read();rules=self.rules()
        need(set(bound.compiled.types)<=set(data['loadedNodeTypes']),'node_not_loaded')
        for effect in bound.effects:
            rule=rules.get(effect['nodeType']);operation=tuple(effect['operation'])
            need(rule is not None and (operation in rule.operations or ('*','*') in rule.operations or (operation[0],'*') in rule.operations) and effect['effect']==rule.effect and tuple(effect['hosts'])==rule.hosts and tuple(effect['scopes'])==rule.scopes,'reviewed_policy_changed')
            if effect['nodeType']=='n8n-nodes-base.httpRequest':
                node=next(n for n in bound.graph['nodes'] if n['id']==effect['nodeId'])
                public_https(node['parameters'].get('url'))
        return True
