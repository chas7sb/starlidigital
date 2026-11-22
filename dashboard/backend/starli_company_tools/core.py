"""Company-only tool registry. No personal/admin/global fallback dispatch."""
import hashlib,inspect,json,re,math
from dataclasses import dataclass
class ToolFault(Exception):
 def __init__(self,code,status=403):self.code=code;self.status=status;super().__init__(code)
def require(value,code,status=403):
 if value is not True:raise ToolFault(code,status)
def validate(value,schema):
 t=schema.get('type')
 if t=='object':return type(value)is dict and set(schema.get('required',[]))<=set(value) and (schema.get('additionalProperties',True) or set(value)<=set(schema.get('properties',{}))) and all(validate(v,schema['properties'][k])for k,v in value.items()if k in schema.get('properties',{}))
 if t=='array':return type(value)is list and schema.get('minItems',0)<=len(value)<=schema.get('maxItems',1000) and all(validate(v,schema['items'])for v in value)
 if t=='string':return type(value)is str and schema.get('minLength',0)<=len(value)<=schema.get('maxLength',65536) and ('enum'not in schema or value in schema['enum'])
 if t=='integer':return type(value)is int and schema.get('minimum',-2**53)<=value<=schema.get('maximum',2**53-1)
 if t=='boolean':return type(value)is bool
 if t=='number':return type(value)in (int,float) and math.isfinite(value)
 return False
@dataclass(frozen=True)
class BoundCall:
 runtime:object
 session:object
 context:object
 selection:dict
 run_id:str
 call_id:str
 assistant_id:str
 native_scope:object
 def check(self):
  require(self.runtime.authorize_run(self.session,self.context.company_id,self.context.bot_id,self.context.room_id,self.run_id),'COMPANY_TOOL_RUN_REVOKED')
  for who in (self.context.actor_id,self.context.bot_id):self.runtime.authority.require_member(who,self.context.company_id,permission='tools.dispatch')
  return True
@dataclass(frozen=True)
class ToolSpec:
 name:str
 description:str
 parameters:dict
 effect:str
 origin:str
 handler:object
 permission:str='read'
 ownership:str='company'
 available:object=None
 def dto(self):return dict(name=self.name,description=self.description,parameters=self.parameters,effect=self.effect,origin=self.origin,ownership=self.ownership,availability='available')
class CompanyTools:
 def __init__(self):self.specs={};self.unavailable=[]
 def register(self,spec):
  require(isinstance(spec,ToolSpec) and spec.name not in self.specs and callable(spec.handler),'COMPANY_TOOL_REGISTRATION_INVALID',500);self.specs[spec.name]=spec
 def permitted(self,runtime,ctx,spec):
  require(spec.available is None or spec.available()is True,'COMPANY_TOOL_BACKING_SERVICE_UNAVAILABLE',503)
  for who in (ctx.actor_id,ctx.bot_id):
   runtime.authority.require_member(who,ctx.company_id,permission='tools.dispatch');runtime.authority.require_member(who,ctx.company_id,permission=spec.permission)
  return True
 def catalogue(self,runtime,ctx):
  if callable(getattr(self,'refresh',None)):self.refresh()
  result=[]
  for spec in self.specs.values():
   try:self.permitted(runtime,ctx,spec);result.append(spec.dto())
   except Exception:pass
  return result
 async def execute(self,bound,name,args):
  spec=self.specs.get(name);require(spec is not None,'COMPANY_TOOL_UNAVAILABLE');bound.check();self.permitted(bound.runtime,bound.context,spec)
  require(validate(args,spec.parameters),'COMPANY_TOOL_ARGUMENTS_INVALID',422)
  result=spec.handler(bound,args);result=await result if inspect.isawaitable(result)else result
  bound.check();self.permitted(bound.runtime,bound.context,spec)
  require(len(json.dumps(result,allow_nan=False).encode())<=262144,'COMPANY_TOOL_RESULT_LIMIT',413)
  return result
def obj(properties,required=None):return dict(type='object',properties=properties,required=list(properties)if required is None else required,additionalProperties=False)
ID={'type':'string','minLength':1,'maxLength':160};REV={'type':'integer','minimum':1,'maximum':2**53-1}
