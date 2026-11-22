"""Preflight descriptors taken from the installed trusted mixin source.
Only literal schemas are decoded; no source or model expression is executed.
Actual admission and callbacks remain entirely with the existing runtime.
"""
import ast,inspect,textwrap

def literal(node):
 if isinstance(node,ast.Call)and isinstance(node.func,ast.Name)and node.func.id=='dict'and not node.args and all(k.arg for k in node.keywords):return {k.arg:literal(k.value)for k in node.keywords}
 return ast.literal_eval(node)

def descriptors(runtime,ctx):
 candidates=[]
 for cls in type(runtime).__mro__:
  method=cls.__dict__.get('tool_catalogue')
  if method is None:continue
  try:tree=ast.parse(textwrap.dedent(inspect.getsource(method)))
  except (OSError,TypeError,SyntaxError):continue
  for node in ast.walk(tree):
   if isinstance(node,ast.Call)and isinstance(node.func,ast.Attribute)and node.func.attr=='append'and len(node.args)==1:
    try:spec=literal(node.args[0])
    except (ValueError,TypeError):continue
    if isinstance(spec,dict)and {'name','description','parameters','effect'}<=set(spec):candidates.append(spec)
 if callable(getattr(runtime,'_memory_fence',None))and callable(getattr(runtime,'memory_factory',None)):
  from starli_memory.runtime_integration import schemas
  candidates+=schemas()
 result=[];seen=set()
 for spec in candidates:
  name=spec['name'];permission='read';origin=None;configured=False
  if name in ('email.draft','email.review'):origin='company-email';configured=callable(getattr(runtime,name.replace('.','_'),None))
  elif name in ('computer.status','computer.display_note'):
   origin='company-computer';configured=callable(getattr(runtime,name.replace('.','_'),None));permission='computer.control'if name.endswith('display_note')else'computer.view'
   if name.endswith('display_note')and ctx.visibility!='public':configured=False
  elif name.startswith('memory_'):origin='company-memory';configured=callable(getattr(runtime,'memory_factory',None))
  if not configured or name in seen:continue
  try:
   for who in (ctx.actor_id,ctx.bot_id):
    runtime.authority.require_member(who,ctx.company_id,permission=permission)
    if name=='computer.display_note':runtime.authority.require_member(who,ctx.company_id,permission='computer.view')
  except Exception:continue
  seen.add(name);result.append({**spec,'origin':origin,'ownership':'company','availability':'requires-run-admission'})
 return result
