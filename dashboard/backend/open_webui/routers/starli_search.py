"""Server-only native search registration. No guest/credential/provider fallback."""
import starli_portable as _portable
import asyncio,importlib.util,inspect,json,sqlite3,time,uuid
from contextlib import contextmanager
from pathlib import Path
from fastapi import HTTPException

IDS=('web_search','web_fetch')
_GATEWAY=None
_PROFILE=None
_PROTECTED=('135.125.159.42',)
_SCHEMA_PATH=Path(_portable.runtime_file('search-gateway/releases/research-v1-r2/gateway/tool-schemas.v1.json'))

def install(profile,*,gateway_path,schema_path,protected_addresses):
 """Trusted application bootstrap only; never accept these arguments from HTTP/tools."""
 global _PROFILE,_GATEWAY,_SCHEMA_PATH,_PROTECTED
 import ipaddress
 if not callable(getattr(profile,'prepare',None))  or not callable(getattr(profile,'launch',None)) or getattr(profile,'available',False) is not True or getattr(profile,'profile_id',None)!='starli.research.public-https.v1':raise ValueError('SEARCH_PROFILE_INVALID')
 if not protected_addresses or any(ipaddress.ip_address(x).version!=4 for x in protected_addresses):raise ValueError('SEARCH_PROTECTED_ADDRESSES_INVALID')
 path=Path(gateway_path)
 if not path.is_absolute():raise ValueError('SEARCH_GATEWAY_INVALID')
 spec=importlib.util.spec_from_file_location('_starli_private_search_gateway',path)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 _PROFILE=profile;_GATEWAY=module;_SCHEMA_PATH=Path(schema_path);_PROTECTED=tuple(protected_addresses)

def disable():
 global _PROFILE,_GATEWAY
 _PROFILE=None;_GATEWAY=None

def schemas():
 if _PROFILE is None or _GATEWAY is None or getattr(_PROFILE,'available',False) is not True:return []
 try:
  raw=json.loads(_SCHEMA_PATH.read_text())
  if raw.get('schemaVersion')!='starli.research.v1':return []
  items=raw['tools']
  if [x['name'] for x in items]!=list(IDS):return []
  return [{'name':x['name'],'description':x['description'],'inputSchema':x['parameters']} for x in items]
 except (OSError,ValueError,KeyError,TypeError):return []

def with_capability(descriptor,available):
 copy=json.loads(json.dumps(descriptor))
 if any(x not in IDS for x in available):raise HTTPException(403,'SEARCH_TOOL_DENIED')
 copy['webTools']=[x for x in IDS if x in available]
 return copy

@contextmanager
def _lease(owner,run_id,path=None):
 if path is None:
  from open_webui.routers.starli_state import state_dir
  path=state_dir()/'search-runtime'/'leases.sqlite'
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 import os
 db=sqlite3.connect(path,timeout=3);os.chmod(path,0o600)
 key=uuid.uuid4().hex
 try:
  with db:
   db.execute('CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY,owner TEXT,run TEXT,pid INTEGER)')
   if 'uncertain' not in {row[1] for row in db.execute('PRAGMA table_info(leases)')}:db.execute('ALTER TABLE leases ADD COLUMN uncertain INTEGER NOT NULL DEFAULT 0')
   db.execute('BEGIN IMMEDIATE')
   for stale,pid in db.execute('SELECT id,pid FROM leases WHERE uncertain=0').fetchall():
    try:os.kill(pid,0)
    except ProcessLookupError:db.execute('DELETE FROM leases WHERE id=?',(stale,))
    except PermissionError:pass
   if db.execute('SELECT COUNT(*) FROM leases').fetchone()[0]>=2 or db.execute('SELECT COUNT(*) FROM leases WHERE owner=?',(owner,)).fetchone()[0]>=1:raise HTTPException(429,'SEARCH_BUSY')
   # Never expire a live backend lease while physical child cleanup is pending.
   db.execute('INSERT INTO leases(id,owner,run,pid) VALUES(?,?,?,?)',(key,owner,run_id,os.getpid()))
  state={'uncertain':False}
  try:yield state
  finally:
   with db:
    if state['uncertain']:db.execute('UPDATE leases SET uncertain=1 WHERE id=?',(key,))
    else:db.execute('DELETE FROM leases WHERE id=?',(key,))
 finally:
  db.close()

def _server_protected_hosts():
 """Current server model endpoint only; never derive protection from tool arguments."""
 import os,ipaddress,re
 from urllib.parse import urlsplit
 try:
  endpoint=urlsplit(os.environ.get('STARLI_INFERENCE_BASE_URL',''))
  if endpoint.scheme not in ('http','https') or not endpoint.hostname:return []
  host=endpoint.hostname.rstrip('.')
  try:host=ipaddress.ip_address(host).compressed.lower()
  except ValueError:
   host=host.encode('idna').decode('ascii').lower()
   if len(host)>253 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',label)for label in host.split('.')):return []
  return [host]
 except (ValueError,UnicodeError):return []

async def dispatch(user,scope,name,args,call_id,authorize,*,schemas_snapshot=None,cancel=None,lease_path=None):
 """scope is ProjectScope/AdminScope captured by native stream, never tool input."""
 if name not in IDS or not isinstance(call_id,str) or not call_id:raise HTTPException(403,'SEARCH_TOOL_DENIED')
 if _PROFILE is None or _GATEWAY is None or getattr(_PROFILE,'available',False) is not True:raise HTTPException(503,'SEARCH_UNAVAILABLE')
 from open_webui.routers.starli_admin_dispatch import Draft7Validator
 available=schemas() if schemas_snapshot is None else schemas_snapshot
 actual=next((x for x in available if x.get('name')==name),None)
 if actual is None or not isinstance(args,dict) or not Draft7Validator(actual['inputSchema']).is_valid(args):raise HTTPException(400,'SEARCH_ARGUMENTS_INVALID')
 server={'accountId':scope.owner_native_id,'botId':scope.agent_id,'runId':scope.run_id,'origin':'http://127.0.0.1:8888','protectedAddresses':list(_PROTECTED),'protectedHosts':_server_protected_hosts()}
 async def fresh(_user,_server,_name,_call):
  if (_server,_name,_call)!=(server,name,call_id):raise HTTPException(403,'SEARCH_SCOPE_CHANGED')
  resolved=authorize()
  if inspect.isawaitable(resolved):resolved=await resolved
  if getattr(resolved,'id',None)!=scope.owner_native_id or getattr(user,'id',None)!=scope.owner_native_id:raise HTTPException(403,'SEARCH_SCOPE_OWNER_MISMATCH')
  return True
 await fresh(user,server,name,call_id)
 with _lease(scope.owner_native_id,scope.run_id,lease_path) as lease:
  try:
   result=await _GATEWAY.dispatch(user,server,name,args,call_id,fresh,cancel,child_setup=_PROFILE.prepare,launcher=_PROFILE)
   await fresh(user,server,name,call_id)
   return result
  except _GATEWAY.ResearchError as error:
   code=str(error)
   if code=='SEARCH_STOP_UNCONFIRMED':
    lease['uncertain']=True
    return {'ok':False,'status':'INTERRUPTED','error':code,'requiresReview':True,'automaticRetryAllowed':False}
   if not code.isupper() or len(code)>64:code='SEARCH_FAILED'
   return {'ok':False,'status':'FAILED','error':code}
