"""Strict public graph shape checks. No mutation and no provider data in errors."""
import math,re
MESSAGES={
 'GRAPH_JSON_REQUIRED':'graphJson must be a JSON string containing a JSON object.',
 'GRAPH_REQUIRED':'graphJson must decode to exactly {"nodes":[...],"edges":[...]}; do not wrap it in graph/workflow or use a connections root key.',
 'GRAPH_NODE_FIELDS_REQUIRED':'Every node requires id,type,version,parameters; only connection is optional. id/type are strings, version is a number, parameters is an object.',
 'GRAPH_CONNECTION_FIELDS_REQUIRED':'connection must be exactly {"handle":"company connection handle","credentialType":"native type","expectedRevision":1}. Never use engine IDs or credentials.',
 'GRAPH_EDGE_FIELDS_REQUIRED':'Every edge is exactly {"from":"node id","to":"node id","output":0}; output is optional and must be an integer 0..15.',
 'CONNECTOR_POLICY_REQUIRED':'One or more native node types are not permitted by the protected installed-node policy. Discover the exact native type ID and choose a supported node.',
 'INPUT_LIMIT':'The graph exceeds the permitted input size.',
 'INVALID_INPUT':'The graph must contain finite JSON values within the permitted size.'}
def graph_shape_error(graph):
 if type(graph)is not dict or set(graph)!={'nodes','edges'} or type(graph['nodes'])is not list or not 1<=len(graph['nodes'])<=50 or type(graph['edges'])is not list or len(graph['edges'])>100:return 'GRAPH_REQUIRED'
 for node in graph['nodes']:
  if type(node)is not dict or not {'id','type','version','parameters'}<=set(node)<={'id','type','version','parameters','connection'}:return 'GRAPH_NODE_FIELDS_REQUIRED'
  if type(node['id'])is not str or re.fullmatch('[A-Za-z][A-Za-z0-9_-]{0,63}',node['id'])is None or type(node['type'])is not str or type(node['version'])not in(int,float) or not math.isfinite(node['version']) or type(node['parameters'])is not dict:return 'GRAPH_NODE_FIELDS_REQUIRED'
  connection=node.get('connection')
  if connection is not None and (type(connection)is not dict or set(connection)!={'handle','credentialType','expectedRevision'} or type(connection['handle'])is not str or type(connection['credentialType'])is not str or type(connection['expectedRevision'])is not int or connection['expectedRevision']<1):return 'GRAPH_CONNECTION_FIELDS_REQUIRED'
 for edge in graph['edges']:
  if type(edge)is not dict or not {'from','to'}<=set(edge)<={'from','to','output'} or type(edge['from'])is not str or type(edge['to'])is not str or type(edge.get('output',0))is not int or not 0<=edge.get('output',0)<=15:return 'GRAPH_EDGE_FIELDS_REQUIRED'
 return None
def rejection(code):return dict(isError=True,status='REJECTED',error={'code':code,'message':MESSAGES[code]},effectsStarted=False)
