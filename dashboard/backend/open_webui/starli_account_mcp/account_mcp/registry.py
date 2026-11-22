"""Isolated encrypted account registry and network admission primitives. No network."""
import hashlib,ipaddress,json,os,re,sqlite3,uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
class Fault(Exception):
 def __init__(self,code,status=400):self.code=code;self.status=status;super().__init__(code)
def fail(code,status=400):raise Fault(code,status)
def endpoint(url):
 if type(url)is not str or len(url)>2048:fail("MCP_URL_INVALID")
 try:p=urlsplit(url);port=p.port
 except ValueError:fail("MCP_URL_INVALID")
 if p.scheme!="https"or not p.hostname or p.username or p.password or p.query or p.fragment or port not in (None,443):fail("MCP_URL_DENIED")
 host=p.hostname.lower()
 try:host=host.encode("idna").decode("ascii")
 except UnicodeError:fail("MCP_URL_INVALID")
 if not re.fullmatch("[a-z0-9.-]+",host)or host.endswith(".")or host in ("localhost",)or host.endswith((".localhost",".local",".internal")):fail("MCP_URL_DENIED")
 try:
  if not ipaddress.ip_address(host).is_global:fail("MCP_ADDRESS_DENIED")
 except ValueError:pass
 if any(ord(c)<33 for c in url)or chr(92)in url:fail("MCP_URL_DENIED")
 return "https://"+host+(p.path or "/")
class URLGuard:
 def __init__(self,resolve):self.resolve=resolve
 def prepare(self,url):
  url=endpoint(url);host=urlsplit(url).hostname
  addresses=self.resolve(host)
  if not addresses or len(addresses)>32:fail("MCP_DNS_DENIED")
  try:ips=frozenset(str(ipaddress.ip_address(a))for a in addresses)
  except ValueError:fail("MCP_DNS_DENIED")
  if not all(ipaddress.ip_address(a).is_global for a in ips):fail("MCP_ADDRESS_DENIED")
  return url,ips
 def peer(self,approved,address):
  try:value=str(ipaddress.ip_address(address))
  except ValueError:fail("MCP_PEER_DENIED")
  if value not in approved or not ipaddress.ip_address(value).is_global:fail("MCP_PEER_DENIED")
 def redirect(self,*args):fail("MCP_REDIRECT_DENIED")
def identifier(value):
 if type(value)is not str or not re.fullmatch("[A-Za-z0-9_.:-]{1,180}",value):fail("MCP_ID_INVALID")
 return value
def encode(value):
 raw=json.dumps(value,separators=(",",":"),allow_nan=False)
 if len(raw.encode())>262144:fail("MCP_METADATA_LIMIT",413)
 return raw
@dataclass(frozen=True)
class Lease:
 owner:str
 agent:str
 server_id:str
 revision:int

class Registry:
 def __init__(self,path,*,cipher,authorize,owned_agent):
  self.path=Path(path);self.cipher=cipher;self.authorize=authorize;self.owned_agent=owned_agent
  if not self.path.is_absolute()or self.path.is_symlink():fail("MCP_STORAGE_DENIED",503)
  self.path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
  if self.path.parent.is_symlink()or self.path.parent.stat().st_mode&0o077:fail("MCP_STORAGE_DENIED",503)
  fd=os.open(self.path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);os.close(fd)
  if self.path.stat().st_mode&0o077 or self.path.stat().st_nlink!=1:fail("MCP_STORAGE_DENIED",503)
  with self.db()as c:c.execute("CREATE TABLE IF NOT EXISTS servers(owner TEXT,id TEXT,revision INTEGER,name TEXT,url TEXT,transport TEXT,enabled INTEGER,sealed BLOB,tools TEXT,deleted INTEGER,PRIMARY KEY(owner,id))")
 @contextmanager
 def db(self):
  c=sqlite3.connect(self.path,timeout=5);c.row_factory=sqlite3.Row
  try:
   with c:yield c
  finally:c.close()
 def auth(self,owner):
  identifier(owner)
  if self.authorize(owner)is not True:fail("MCP_ACCOUNT_DENIED",403)
 def getrow(self,c,owner,ident):
  row=c.execute("SELECT * FROM servers WHERE owner=?AND id=?AND deleted=0",(owner,identifier(ident))).fetchone()
  if not row:fail("MCP_NOT_FOUND",404)
  return row
 def dto(self,row):
  tools=json.loads(row["tools"])
  return dict(version="starli.account-mcp.v1",id=row["id"],revision=row["revision"],name=row["name"],url=row["url"],transport=row["transport"],enabled=bool(row["enabled"]),credentialConfigured=bool(row["sealed"]),toolCount=len(tools),status="DISCOVERED"if tools else "UNTESTED")
 def fields(self,values,create=False):
  if type(values)is not dict or set(values)-{"name","url","transport","credential"}or(create and not {"name","url","transport"}.issubset(values)):fail("MCP_ARGUMENTS_INVALID",422)
  values=dict(values)
  if "name"in values and(type(values["name"])is not str or not 1<=len(values["name"])<=100):fail("MCP_ARGUMENTS_INVALID",422)
  if "url"in values:values["url"]=endpoint(values["url"])
  if "transport"in values and values["transport"]not in ("streamable-http","sse"):fail("MCP_TRANSPORT_UNAVAILABLE",422)
  if "credential"in values and values["credential"]is not None and(type(values["credential"])is not str or not 1<=len(values["credential"])<=8192 or any(ord(c)<32 for c in values["credential"])):fail("MCP_CREDENTIAL_INVALID",422)
  return values
 def create(self,owner,values):
  self.auth(owner);values=self.fields(values,True);credential=values.get("credential")
  sealed=self.cipher.encrypt(credential.encode())if credential else None
  ident="mcp_"+uuid.uuid4().hex
  with self.db()as c:
   c.execute("BEGIN IMMEDIATE");self.auth(owner)
   c.execute("INSERT INTO servers VALUES(?,?,1,?,?,?,0,?,'[]',0)",(owner,ident,values["name"],values["url"],values["transport"],sealed))
   self.auth(owner);result=self.dto(self.getrow(c,owner,ident))
  return result
 def list(self,owner,*,after="",limit=50):
  self.auth(owner)
  if type(limit)is not int or not 1<=limit<=50 or type(after)is not str or len(after)>180:fail("MCP_PAGE_INVALID",422)
  with self.db()as c:rows=c.execute("SELECT *FROM servers WHERE owner=?AND deleted=0 AND id>? ORDER BY id LIMIT ?",(owner,after,limit+1)).fetchall()
  self.auth(owner);page=rows[:limit]
  return dict(items=[self.dto(r)for r in page],hasMore=len(rows)>limit,cursor=page[-1]["id"]if page else after)
 def get(self,owner,ident):
  self.auth(owner)
  with self.db()as c:result=self.dto(self.getrow(c,owner,ident))
  self.auth(owner);return result
 def mutate(self,owner,ident,expected,values=None,*,enabled=None,delete=False):
  self.auth(owner)
  if type(expected)is not int or not 1<=expected<=2**53-1:fail("MCP_REVISION_INVALID",422)
  values=self.fields({}if values is None else values)
  if type(delete)is not bool or enabled is not None and type(enabled)is not bool:fail("MCP_ARGUMENTS_INVALID",422)
  with self.db()as c:
   c.execute("BEGIN IMMEDIATE");row=self.getrow(c,owner,ident)
   if row["revision"]!=expected:fail("MCP_REVISION_CONFLICT",409)
   sealed=row["sealed"]
   if "credential"in values:sealed=self.cipher.encrypt(values["credential"].encode())if values["credential"]else None
   if delete:sealed=None
   self.auth(owner)
   c.execute("UPDATE servers SET revision=revision+1,name=?,url=?,transport=?,enabled=?,sealed=?,tools=?,deleted=?WHERE owner=?AND id=?",(values.get("name",row["name"]),values.get("url",row["url"]),values.get("transport",row["transport"]),0 if delete else int(row["enabled"]if enabled is None else enabled),sealed,"[]"if values or delete else row["tools"],int(delete),owner,ident))
   self.auth(owner)
   return None if delete else self.dto(self.getrow(c,owner,ident))
 def lease(self,owner,agent,ident):
  self.auth(owner)
  if self.owned_agent(owner,identifier(agent))is not True:fail("MCP_AGENT_DENIED",403)
  with self.db()as c:row=self.getrow(c,owner,ident)
  if not row["enabled"]:fail("MCP_SERVER_DISABLED",403)
  lease=Lease(owner,agent,ident,row["revision"]);self.check_lease(lease);return lease
 def check_lease(self,lease):
  if not isinstance(lease,Lease):fail("MCP_LEASE_INVALID",403)
  self.auth(lease.owner)
  if self.owned_agent(lease.owner,lease.agent)is not True:fail("MCP_AGENT_DENIED",403)
  with self.db()as c:row=self.getrow(c,lease.owner,lease.server_id)
  if not row["enabled"]or row["revision"]!=lease.revision:fail("MCP_LEASE_REVOKED",403)
  self.auth(lease.owner)
  try:credential=self.cipher.decrypt(row["sealed"]).decode()if row["sealed"]else None
  except Exception:fail("MCP_VAULT_UNAVAILABLE",503)
  return {"_owner":lease.owner,"url":row["url"],"transport":row["transport"],"credential":credential}

 def record_discovery(self,owner,ident,expected,tools):
  self.auth(owner)
  if type(tools)is not list or len(tools)>200:fail("MCP_TOOL_LIMIT",413)
  cleaned=[];names=set()
  for tool in tools:
   # MCP Tool metadata can contain title, outputSchema, _meta and future
   # presentation-only extensions. This registry stores ONLY the validated
   # executable name, input schema and bounded untrusted description.
   # Never treat optional annotations or other server metadata as authority.
   if type(tool)is not dict:fail("MCP_TOOL_INVALID",422)
   name=tool.get("name")
   if type(name)is not str or not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,128}",name)or name in names:fail("MCP_TOOL_INVALID",422)
   names.add(name);schema=tool.get("inputSchema")
   if type(schema)is not dict or schema.get("type")!="object":fail("MCP_SCHEMA_INVALID",422)
   encoded=encode(schema)
   if len(encoded.encode())>16384:fail("MCP_SCHEMA_LIMIT",413)
   def depth(v,n=0):
    if n>16:fail("MCP_SCHEMA_LIMIT",413)
    if isinstance(v,dict):
     if "$ref"in v and(not isinstance(v["$ref"],str)or not v["$ref"].startswith("#/")):fail("MCP_SCHEMA_EXTERNAL_REF",422)
     for x in v.values():depth(x,n+1)
    elif isinstance(v,list):
     for x in v:depth(x,n+1)
   depth(schema)
   description=tool.get("description","")
   if type(description)is not str:fail("MCP_TOOL_INVALID",422)
   # Description text is untrusted. Long SDK/tool docs must not make an
   # otherwise-valid tools/list unusable; retain a bounded display subset.
   description=description[:1000]
   cleaned.append({"name":name,"publicName":ident+"__"+hashlib.sha256(name.encode()).hexdigest()[:20],"description":description,"inputSchema":schema,"trust":"untrusted-remote-metadata"})
  encoded=encode(cleaned)
  with self.db()as c:
   c.execute("BEGIN IMMEDIATE");row=self.getrow(c,owner,ident)
   if type(expected)is not int or row["revision"]!=expected:fail("MCP_REVISION_CONFLICT",409)
   self.auth(owner);c.execute("UPDATE servers SET tools=?,revision=revision+1 WHERE owner=?AND id=?",(encoded,owner,ident));self.auth(owner)
   return self.dto(self.getrow(c,owner,ident))

 def connection(self,owner,ident,expected):
  # Manual test/discovery may inspect a disabled configuration; no tool grant.
  self.auth(owner)
  with self.db()as c:row=self.getrow(c,owner,ident)
  if row["revision"]!=expected:fail("MCP_REVISION_CONFLICT",409)
  try:credential=self.cipher.decrypt(row["sealed"]).decode()if row["sealed"]else None
  except Exception:fail("MCP_VAULT_UNAVAILABLE",503)
  self.auth(owner)
  return {"_owner":owner,"url":row["url"],"transport":row["transport"],"credential":credential}
