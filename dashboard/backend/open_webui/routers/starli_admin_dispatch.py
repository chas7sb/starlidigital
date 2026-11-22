"""Restricted, fresh-grant administrator reads. No customer fallback."""
import starli_portable as _portable
import hashlib
import inspect
import json
import os
import stat
from pathlib import Path
from fastapi import HTTPException
import re
import sqlite3
from contextlib import contextmanager
from open_webui.routers.starli_admin_policy import ADMIN_TOOLS, authorize_scope

class Draft7Validator:
 """Bounded fail-closed subset used by the reviewed MCP input schemas."""
 KEYS={'type','properties','required','additionalProperties','items','enum','const','minimum','maximum','minLength','maxLength','minItems','maxItems','description','title','default','format','$schema','pattern','anyOf','oneOf'}
 @classmethod
 def check_schema(cls,s,depth=0):
  if depth>12 or not isinstance(s,dict) or set(s)-cls.KEYS or 'pattern' in s:raise ValueError('unsupported schema')
  if s.get('format') not in (None,'email'):raise ValueError('unsupported format')
  if s.get('type') not in (None,'object','array','string','integer','number','boolean','null'):raise ValueError('unsupported type')
  for v in s.get('properties',{}).values():cls.check_schema(v,depth+1)
  if 'items' in s:cls.check_schema(s['items'],depth+1)
  for key in ('anyOf','oneOf'):
   for v in s.get(key,[]):cls.check_schema(v,depth+1)
 def __init__(self,s):self.s=s
 def is_valid(self,v):
  def valid(s,v,depth=0):
   if depth>16:return False
   t=s.get('type')
   if t=='object':
    if not isinstance(v,dict) or any(not isinstance(k,str) for k in v):return False
    props=s.get('properties',{})
    if any(k not in v for k in s.get('required',[])):return False
    if s.get('additionalProperties') is False and set(v)-set(props):return False
    if not all(valid(props[k],x,depth+1) for k,x in v.items() if k in props):return False
   elif t=='array':
    if not isinstance(v,list) or len(v)<s.get('minItems',0) or len(v)>s.get('maxItems',10000):return False
    if 'items' in s and not all(valid(s['items'],x,depth+1) for x in v):return False
   elif t=='string':
    if not isinstance(v,str) or len(v)<s.get('minLength',0) or len(v)>s.get('maxLength',65536):return False
    if s.get('format')=='email' and (len(v)>320 or re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',v) is None):return False
   elif t in ('integer','number'):
    if isinstance(v,bool) or not isinstance(v,(int,float)) or (t=='integer' and not isinstance(v,int)):return False
    if v<s.get('minimum',float('-inf')) or v>s.get('maximum',float('inf')):return False
   elif t=='boolean' and not isinstance(v,bool):return False
   elif t=='null' and v is not None:return False
   if 'enum' in s and v not in s['enum']:return False
   if 'const' in s and v!=s['const']:return False
   if 'anyOf' in s and not any(valid(x,v,depth+1) for x in s['anyOf']):return False
   if 'oneOf' in s and sum(valid(x,v,depth+1) for x in s['oneOf'])!=1:return False
   return True
  try:return valid(self.s,v)
  except (TypeError,ValueError,re.error):return False

MUTATIONS=frozenset({'crm_upsert_prospect','crm_add_activity','outreach_create_draft'})
LOCAL = frozenset(ADMIN_TOOLS[:2])
REMOTE = frozenset(ADMIN_TOOLS[2:])
PROTECTED = {'.git','.env','node_modules','__pycache__','.venv','venv','dist','build','.svelte-kit','secrets','credentials','private','state'}
SUFFIXES = {'.pem','.key','.p12','.pfx','.sqlite','.sqlite3','.db'}
ROOT_FILES = {'README.md','package.json','tsconfig.json','vite.config.ts','svelte.config.js'}
SOURCE_SCHEMAS = [
 {'name':'starli_source_read','description':'Read bounded protected platform source (administrator only).','inputSchema':{'type':'object','properties':{'path':{'type':'string','minLength':1,'maxLength':512},'startLine':{'type':'integer','minimum':1},'maxLines':{'type':'integer','minimum':1,'maximum':250}},'required':['path'],'additionalProperties':False}},
 {'name':'starli_source_list','description':'List protected platform source (administrator only).','inputSchema':{'type':'object','properties':{'path':{'type':'string','minLength':1,'maxLength':512},'maxEntries':{'type':'integer','minimum':1,'maximum':150}},'required':['path'],'additionalProperties':False}}
]
def denied(code='ADMIN_TOOL_DENIED',status=403): raise HTTPException(status,code)
async def awaitable(value):
 return await value if inspect.isawaitable(value) else value

def safe_part(part):
 return part not in PROTECTED and not part.startswith('.env') and Path(part).suffix.lower() not in SUFFIXES

class SourceSnapshot:
 """Hold ancestor descriptors throughout execution; reject every symlink/hardlink."""
 def __init__(self,root,tool,args):
  self.fds=[];self.links=[]
  try:
   raw=args['path']
   if not isinstance(raw,str) or '\u0000' in raw or '\\' in raw or any(ord(c)<32 for c in raw):denied('ADMIN_SOURCE_PATH_DENIED')
   parts=raw.split('/')
   if raw=='.':parts=[]
   if raw.startswith('/') or any(x in ('','..','.') or not safe_part(x) for x in parts):denied('ADMIN_SOURCE_PATH_DENIED')
   rel='/'.join(parts)
   tree=rel=='backend' or rel.startswith('backend/') or rel=='src' or rel.startswith('src/') or rel=='scripts/starli-runtime' or rel.startswith('scripts/starli-runtime/')
   if not tree and rel not in ROOT_FILES and not (not rel and tool=='starli_source_list'):denied('ADMIN_SOURCE_PATH_DENIED')
   # Only the fixed operator deployment root may resolve a symlink.
   resolved=Path(root).resolve(strict=True)
   current=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
   self.fds.append(current)
   for part in resolved.parts[1:]:
    nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=current)
    self.fds.append(nxt);self.links.append((current,part,os.fstat(nxt)));current=nxt
   for n,part in enumerate(parts):
    flags=os.O_RDONLY|os.O_NOFOLLOW
    if n<len(parts)-1 or tool=='starli_source_list':flags|=os.O_DIRECTORY
    nxt=os.open(part,flags,dir_fd=current)
    self.fds.append(nxt);self.links.append((current,part,os.fstat(nxt)));current=nxt
   info=os.fstat(current)
   if tool=='starli_source_read':
    if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>250000:denied('ADMIN_SOURCE_FILE_DENIED')
    data=b''
    while len(data)<=250000:
     chunk=os.read(current,65536)
     if not chunk:break
     data+=chunk
    if len(data)>250000:denied('ADMIN_SOURCE_FILE_DENIED')
    text=data.decode('utf-8')
    if re.search(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,})|(?im:^[ \t]*(?:export[ \t]+)?(?:[A-Z_]*(?:API_KEY|SECRET|PASSWORD|ACCESS_TOKEN))[ \t]*=[ \t]*[^ \t#]{8,})',text):denied('ADMIN_SOURCE_CREDENTIAL_DENIED')
    lines=text.splitlines();start=args.get('startLine',1);count=args.get('maxLines',160)
    self.result={'path':rel,'sha256':hashlib.sha256(data).hexdigest(),'totalLines':len(lines),'startLine':start,'content':'\n'.join(f'{i+1}: {lines[i]}' for i in range(start-1,min(start-1+count,len(lines))))}
   else:
    if not stat.S_ISDIR(info.st_mode):denied('ADMIN_SOURCE_PATH_DENIED')
    entries=[]
    for name in sorted(os.listdir(current)):
     if not safe_part(name):continue
     item=os.stat(name,dir_fd=current,follow_symlinks=False)
     if stat.S_ISLNK(item.st_mode) or (stat.S_ISREG(item.st_mode) and item.st_nlink!=1):continue
     if not (stat.S_ISREG(item.st_mode) or stat.S_ISDIR(item.st_mode)):continue
     entries.append({'name':name,'type':'directory' if stat.S_ISDIR(item.st_mode) else 'file'})
     if len(entries)>=args.get('maxEntries',100):break
    self.result={'path':rel or '.','entries':entries}
  except HTTPException:self.close();raise
  except (OSError,UnicodeError):self.close();denied('ADMIN_SOURCE_UNAVAILABLE',409)
 def unchanged(self):
  try:
   for parent,name,before in self.links:
    now=os.stat(name,dir_fd=parent,follow_symlinks=False)
    if (now.st_dev,now.st_ino,now.st_mode,now.st_nlink)!=(before.st_dev,before.st_ino,before.st_mode,before.st_nlink):denied('ADMIN_SOURCE_CHANGED',409)
  except OSError:denied('ADMIN_SOURCE_CHANGED',409)
 def close(self):
  for fd in reversed(self.fds):
   try:os.close(fd)
   except OSError:pass
  self.fds=[]

async def _bridge(user,scope,operation,tool=None,args=None):
 from open_webui.routers.starli_execution_context import agent_scope
 from open_webui.routers.starli_tools import _bridge as actual
 with agent_scope(scope.agent_id,scope.chat_id):
  return await actual(user,operation,tool,args,require_admin=True)

class AdminDispatcher:
 def __init__(self,*,source_root=str(_portable.DASHBOARD),bridge=_bridge,authorize_scope_fn=authorize_scope,local_available=None,journal_path=None):
  self.root=source_root;self.bridge=bridge;self.authorize=authorize_scope_fn;self.local_available=local_available;self.journal_path=journal_path
 def fresh(self,user,scope,authorize):
  if getattr(user,'id',None)!=scope.owner_native_id:denied('ADMIN_SCOPE_OWNER_MISMATCH')
  return self.authorize(scope,authorize)
 async def schemas(self,user,scope,authorize):
  fresh=self.fresh(user,scope,authorize)
  result=[]
  local=self.local_available
  if local is None:
   from open_webui.routers.starli_pi_master import _tool
   local=callable(_tool)
  if local and Path(self.root).is_dir():result.extend(json.loads(json.dumps(SOURCE_SCHEMAS)))
  # These exact installation-owner tools have independent VM/private-binding
  # readiness and never use the generic remote MCP bridge or customer fallback.
  from open_webui.routers import starli_local_vm_tools
  from open_webui.routers.starli_execution_context import agent_scope
  try:
   with agent_scope(scope.agent_id,scope.chat_id):result.extend(starli_local_vm_tools.catalog(fresh))
  except HTTPException as error:
   if error.status_code not in (403,503):raise
  # Local source authority is the native administrator grant, independent of CRM membership.
  try:
   catalog=await self.bridge(fresh,scope,'catalog')
  except Exception:
   catalog={'tools':[]}
  self.fresh(user,scope,authorize)
  items=catalog.get('tools',[]) if isinstance(catalog,dict) else []
  for item in items:
   if not isinstance(item,dict) or item.get('name') not in REMOTE:continue
   if any(item.get(x) is False for x in ('available','configured','executable','previewExecutable')):continue
   schema=item.get('inputSchema')
   if not isinstance(schema,dict) or schema.get('type')!='object':continue
   schema=json.loads(json.dumps(schema));schema['additionalProperties']=False
   try:Draft7Validator.check_schema(schema)
   except Exception:continue
   result.append({'name':item['name'],'description':str(item.get('description',''))[:1000],'inputSchema':schema})
  return result
 async def dispatch(self,user,scope,tool,args,call_id,authorize,local_execute=None,*,schemas_snapshot=None):
  if tool not in ADMIN_TOOLS:denied()
  if not isinstance(call_id,str) or not call_id or len(call_id)>200:denied('ADMIN_CALL_ID_INVALID',400)
  try:
   encoded=json.dumps(args,allow_nan=False).encode()
  except (ValueError,TypeError):denied('ADMIN_ARGUMENTS_INVALID',400)
  if len(encoded)>65536:denied('ADMIN_ARGUMENTS_INVALID',400)
  self.fresh(user,scope,authorize)
  if schemas_snapshot is None:available=await self.schemas(user,scope,authorize)
  else:
   if not isinstance(schemas_snapshot,(list,tuple)):denied('ADMIN_SCHEMA_SNAPSHOT_INVALID',400)
   available=[];seen=set()
   for item in schemas_snapshot:
    if not isinstance(item,dict) or set(item)-{'name','description','inputSchema'} or item.get('name') not in ADMIN_TOOLS or item['name'] in seen:denied('ADMIN_SCHEMA_SNAPSHOT_INVALID',400)
    seen.add(item['name']);schema=item.get('inputSchema')
    if not isinstance(schema,dict) or schema.get('type')!='object' or schema.get('additionalProperties') is not False:denied('ADMIN_SCHEMA_SNAPSHOT_INVALID',400)
    try:Draft7Validator.check_schema(schema)
    except Exception:denied('ADMIN_SCHEMA_SNAPSHOT_INVALID',400)
    if item['name'] in LOCAL and schema!=next(x['inputSchema'] for x in SOURCE_SCHEMAS if x['name']==item['name']):denied('ADMIN_SCHEMA_SNAPSHOT_INVALID',400)
    available.append(item)
  selected=next((x for x in available if x['name']==tool),None)
  if selected is None:denied('ADMIN_TOOL_UNAVAILABLE',409)
  if not isinstance(args,dict) or not Draft7Validator(selected['inputSchema']).is_valid(args):denied('ADMIN_ARGUMENTS_INVALID',400)
  fresh=self.fresh(user,scope,authorize)
  from open_webui.routers import starli_local_vm_tools
  if tool in starli_local_vm_tools.NAMES:
   from open_webui.routers.starli_execution_context import agent_scope
   identity=[scope.owner_native_id,scope.agent_id,scope.run_id,call_id,tool]
   operation_key=hashlib.sha256(json.dumps(identity,separators=(',',':')).encode()).hexdigest()
   with agent_scope(scope.agent_id,scope.chat_id):
    result=await starli_local_vm_tools.tool(fresh,tool,args,operation_key)
   self.fresh(user,scope,authorize)
   return result
  if tool in LOCAL:
   if not callable(local_execute):denied('ADMIN_LOCAL_EXECUTOR_UNAVAILABLE',409)
   snapshot=SourceSnapshot(self.root,tool,args)
   try:
    result=await awaitable(local_execute(fresh,tool,args,call_id))
    self.fresh(user,scope,authorize);snapshot.unchanged()
    # Never forward unverified callback content or arbitrary filesystem paths.
    if tool=='starli_source_read' and (not isinstance(result,dict) or result.get('sha256')!=snapshot.result['sha256']):denied('ADMIN_SOURCE_CHANGED',409)
    return snapshot.result
   finally:snapshot.close()
  if tool in MUTATIONS:
   return await self.mutate(user,scope,tool,args,call_id,authorize)
  result=await self.bridge(fresh,scope,'invoke',tool,args)
  self.fresh(user,scope,authorize)
  if not isinstance(result,dict):denied('ADMIN_TOOL_INVALID_RECEIPT',502)
  return result
 @contextmanager
 def journal(self):
  path=self.journal_path
  if path is None:
   from open_webui.routers.starli_state import state_dir
   path=Path(state_dir())/'admin-runtime'/'operations.sqlite'
  path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  db=sqlite3.connect(path,timeout=5);os.chmod(path,0o600)
  db.execute("CREATE TABLE IF NOT EXISTS operations (key TEXT PRIMARY KEY,body TEXT NOT NULL,state TEXT NOT NULL,result TEXT)")
  try:
   with db:yield db
  finally:db.close()
 async def mutate(self,user,scope,tool,args,call_id,authorize):
  identity=[scope.owner_native_id,scope.agent_id,scope.run_id,call_id,tool]
  key=hashlib.sha256(json.dumps(identity,separators=(',',':')).encode()).hexdigest()
  body=hashlib.sha256(json.dumps(args,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
  unknown={'ok':False,'status':'UNCERTAIN','error':'ADMIN_OPERATION_UNCERTAIN','needsReview':True,'_adminRuntime':{'uncertain':True}}
  self.fresh(user,scope,authorize)
  with self.journal() as db:
   db.execute('BEGIN IMMEDIATE')
   row=db.execute('SELECT body,state,result FROM operations WHERE key=?',(key,)).fetchone()
   if row:
    if row[0]!=body:denied('ADMIN_CALL_ID_REUSED',409)
    if row[1]=='SETTLED':return json.loads(row[2])
    return unknown
   if db.execute('SELECT COUNT(*) FROM operations').fetchone()[0]>=10000:denied('ADMIN_RECEIPT_QUOTA',429)
   db.execute("INSERT INTO operations VALUES (?,?,'INTENT',NULL)",(key,body));db.commit()
  try:
   fresh=self.fresh(user,scope,authorize)
   result=await self.bridge(fresh,scope,'invoke',tool,args)
   self.fresh(user,scope,authorize)
   if not isinstance(result,dict) or result.get('isError'):return unknown
   raw=json.dumps(result,allow_nan=False)
   if len(raw.encode())>262144:return unknown
   with self.journal() as db:
    db.execute("UPDATE operations SET state='SETTLED',result=? WHERE key=? AND body=? AND state='INTENT'",(raw,key,body))
   return result
  except BaseException as error:
   import asyncio
   if isinstance(error,(asyncio.CancelledError,KeyboardInterrupt,SystemExit)):raise
   return unknown

_default=AdminDispatcher()
async def schemas(user,scope,authorize):return await _default.schemas(user,scope,authorize)
async def dispatch(user,scope,tool,args,call_id,authorize,local_execute=None,*,schemas_snapshot=None):
 return await _default.dispatch(user,scope,tool,args,call_id,authorize,local_execute,schemas_snapshot=schemas_snapshot)
