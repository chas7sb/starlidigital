"""Actual installed metadata plus actual PublicAPI JSON schema; scalar forms only."""
import hashlib,json,re,math
from pathlib import Path
from starli_automations.common import need,encoded
VERSION='starli.company-engine-connections.v1'
MANAGED={'allowedHttpRequestDomains':'none','allowedDomains':''}

def conditions_valid(value,names):
 return type(value)is dict and set(value)<= {'show'} and type(value.get('show'))is dict and all(k in names and type(v)is list and 0<len(v)<=100 and all(type(x)in(str,int,float,bool)for x in v)for k,v in value['show'].items())

def visible(field,values):
 return all(any(type(values.get(k))is type(x)and values.get(k)==x for x in options)for k,options in field.get('displayOptions',{}).get('show',{}).items())
def sha(schema):return hashlib.sha256(encoded(schema).encode()).hexdigest()
class Catalog:
 def __init__(self,path=None):
  d=json.loads(Path(path or Path(__file__).with_name('installed-types.json')).read_text(encoding='utf-8-sig'))
  need(d.get('version')=='starli.installed-credential-types.v1','CREDENTIAL_CATALOG_INVALID',503)
  self.metadata=d;self.types={t['credentialType']:t for t in d['types']};need(len(self.types)==len(d['types']),'CREDENTIAL_CATALOG_DUPLICATE',503)
 def get(self,name):
  need(type(name)is str and re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,127}',name)and name in self.types,'CREDENTIAL_TYPE_NOT_INSTALLED',404);return self.types[name]
 def fields(self,name,seen=None):
  seen=set(seen or());need(name not in seen and len(seen)<16,'CREDENTIAL_INHERITANCE_INVALID',503);seen.add(name);d=self.get(name);result={}
  for parent in d.get('extends',[]):result.update(self.fields(parent,seen))
  result.update({f['name']:f for f in d['fields']});return result
 def oauth(self,name):
  return any('oauth' in n.lower()for n in [name,*self.ancestors(name)])
 def ancestors(self,name):
  result=set();todo=list(self.get(name).get('extends',[]))
  while todo:
   n=todo.pop();need(len(result)<32,'CREDENTIAL_INHERITANCE_INVALID',503)
   if n not in result:result.add(n);todo+=self.get(n).get('extends',[])
  return result
 def listing(self):return [dict(credentialType=n,title=d['title'],authKind='OAUTH'if self.oauth(n)else'FIELDS',status='NEEDS_PLATFORM_APP'if self.oauth(n)else'FORM_AVAILABLE'if d['status']=='LOADED'else'SCHEMA_UNAVAILABLE',executionStatus='POLICY_REQUIRED')for n,d in sorted(self.types.items())]
 def form(self,name,schema):
  self.get(name);need(type(schema)is dict and schema.get('type')=='object'and type(schema.get('properties'))is dict and len(encoded(schema))<=65536,'ENGINE_SCHEMA_INVALID',502)
  meta=self.fields(name);fields=[];unsupported=[];managed={};required=schema.get('required',[])
  for n,p in schema['properties'].items():
   need(type(n)is str and type(p)is dict,'ENGINE_SCHEMA_INVALID',502)
   if n in MANAGED:
    managed[n]=MANAGED[n]
    if p.get('type')!='string' or 'enum'in p and MANAGED[n]not in p['enum']:unsupported.append('managed-policy:'+n)
    continue
   if p.get('type') in('notice','hidden'):continue
   if 'oauthTokenData'==n:continue # OAuth status already disables raw submission.
   for keyword in set(p)-{'type','enum','default','title','description'}:unsupported.append('schema-field:'+n+':'+keyword)
   t=p.get('type');m=meta.get(n,{});enum=p.get('enum');kind='select'if enum is not None else t
   if t not in('string','number','integer','boolean')or enum is not None and(not isinstance(enum,list)or not enum or len(enum)>100 or any(type(x)not in(str,int,float,bool)for x in enum)):
    unsupported.append(n);continue
   f=dict(name=n,label=m.get('label',n),kind=kind,valueType=t,required=n in required,secret=bool(m.get('secret',t=='string')))
   if enum is not None:
    labels={encoded(o['value']):o['label']for o in m.get('options',[])};f['options']=[dict(label=labels.get(encoded(x),str(x)),value=x)for x in enum]
   if not f['secret'] and type(m.get('default'))in(str,int,float,bool)and len(str(m['default']))<=500:f['default']=m['default']
   if m.get('displayOptions'):
    if conditions_valid(m['displayOptions'],set(schema['properties'])):f['displayOptions']=m['displayOptions']
    else:unsupported.append('conditions:'+n)
   fields.append(f)
  # Unsupported conditional validation is explicit: no silently stripped requirements.
  if schema.get('additionalProperties')not in(False,None):unsupported.append('schema:additionalProperties')
  extras=set(schema)-{'type','properties','required','additionalProperties','$schema','title','description'}
  if extras:unsupported+=['schema:'+n for n in sorted(extras)]
  return dict(credentialType=name,schemaHash=sha(schema),status='NEEDS_PLATFORM_APP'if self.oauth(name)else'UNSUPPORTED_SCHEMA'if unsupported else'FORM_AVAILABLE',fields=fields,unsupported=unsupported,managedFields=managed,notice='Credential storage is not provider verification or permission to execute a connector.')
 def validate(self,name,schema,data):
  form=self.form(name,schema);need(form['status']=='FORM_AVAILABLE','NEEDS_PLATFORM_APP'if self.oauth(name)else'UNSUPPORTED_CREDENTIAL_SCHEMA',409)
  need(type(data)is dict and len(encoded(data).encode())<=32768,'CREDENTIAL_INPUT_LIMIT',422)
  props=schema['properties'];allowed={f['name']for f in form['fields']};need(set(data)<=allowed,'CREDENTIAL_FIELD_UNKNOWN',422)
  defaults={f['name']:f['default']for f in form['fields']if'default'in f}
  values={**defaults,**data}
  for f in form['fields']:
   if f['name']in data:need(visible(f,values),'CREDENTIAL_HIDDEN_FIELD',422)
  merged={**data,**form['managedFields']}
  need(set(schema.get('required',[]))<=set(merged),'CREDENTIAL_REQUIRED_FIELDS',422)
  for n,v in merged.items():
   p=props[n];t=p['type'];ok=(t=='string'and type(v)is str and len(v.encode())<=16384)or(t=='boolean'and type(v)is bool)or(t=='integer'and type(v)is int and abs(v)<=2**53)or(t=='number'and type(v)in(int,float)and math.isfinite(v)and abs(v)<=2**53)
   need(ok,'CREDENTIAL_FIELD_TYPE',422)
   if 'enum'in p:need(any(type(v)is type(x)and v==x for x in p['enum']),'CREDENTIAL_FIELD_OPTION',422)
   if t=='string':
    need(not any(ord(c)==0 for c in v)and '{{'not in v and '$env'not in v and '$secrets'not in v,'CREDENTIAL_EXPRESSION_DENIED',422)
    if n in schema.get('required',[]):need(bool(v.strip()),'CREDENTIAL_REQUIRED_FIELDS',422)
  return merged
