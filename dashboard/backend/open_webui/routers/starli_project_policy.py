"""Owned-agent project policy and private durable executor journal. No effects/network."""
from __future__ import annotations
import dataclasses,hashlib,json,os,re,sqlite3,stat,time
from contextlib import contextmanager
from pathlib import Path
class ProjectPolicyFault(Exception):
 def __init__(self,code,status=400):
  self.code=code if isinstance(code,str) and re.fullmatch(r"PROJECT_[A-Z0-9_]+",code) else "PROJECT_POLICY_UNAVAILABLE";self.status=status;super().__init__(self.code)
@dataclasses.dataclass(frozen=True)
class ProjectScope:
 owner_native_id:str
 agent_id:str
 run_id:str
 chat_id:str
NATIVE_TOOLS=("capabilities","starlis.list","platform.schema","platform.call")
PROJECT_TOOLS=("project_create","project_list","project_files","project_file_read","project_file_write","project_check","project_build","project_preview")
LIMITS={"maxModelTurns":120,"maxToolAttempts":120,"maxWallclockSeconds":3600,"maxProjectsPerRun":1,"maxFileBytes":65536,"maxProjectBytes":2000000,"maxFiles":200,"buildTimeoutSeconds":45}
def capability_scope():
 return {"version":"starli.capability-scope.v1","id":"owned-projects.v1","tools":list(NATIVE_TOOLS),"projectTools":list(PROJECT_TOOLS),"limits":dict(LIMITS),"eligibility":{"requiresAuthentication":True,"requiresOwnedActiveAgent":True,"supportedAgentProviders":["hosted","account"],"projectAccess":"agent-bound-owned"}}
def _id(value):
 if not isinstance(value,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}",value):raise ProjectPolicyFault("PROJECT_INVALID_IDENTIFIER",422)
 return value
def _scope(scope):
 if not isinstance(scope,ProjectScope):raise ProjectPolicyFault("PROJECT_SCOPE_REQUIRED",403)
 for value in dataclasses.astuple(scope):_id(value)
 return (scope.owner_native_id,scope.agent_id,scope.run_id,scope.chat_id)
def _path(value):
 if not isinstance(value,str) or not 1<=len(value)<=240 or "\\" in value or value.startswith("/") or any(ord(c)<32 for c in value) or any(p in ("",".","..") for p in value.split("/")) or ":" in value:raise ProjectPolicyFault("PROJECT_INVALID_PATH",422)
 return value
def validate_tool(tool,args):
 if tool not in PROJECT_TOOLS or not isinstance(args,dict):raise ProjectPolicyFault("PROJECT_TOOL_DENIED",403)
 allowed={"project_create":({"name","brief"},{"name"}),"project_list":(set(),set()),"project_files":({"projectId"},{"projectId"}),"project_file_read":({"projectId","path"},{"projectId","path"}),"project_file_write":({"projectId","path","content","expectedSha256"},{"projectId","path","content"}),"project_check":({"projectId"},{"projectId"}),"project_build":({"projectId","route"},{"projectId"}),"project_preview":({"projectId"},{"projectId"})}
 fields,required=allowed[tool]
 if set(args)-fields or required-set(args):raise ProjectPolicyFault("PROJECT_ARGUMENTS_INVALID",422)
 result=dict(args)
 if "projectId" in args:_id(args["projectId"])
 if "path" in args:_path(args["path"])
 if tool=="project_create":
  if not isinstance(args["name"],str) or not args["name"].strip() or len(args["name"])>120 or any(ord(c)<32 for c in args["name"]):raise ProjectPolicyFault("PROJECT_ARGUMENTS_INVALID",422)
  if "brief" in args and (not isinstance(args["brief"],str) or len(args["brief"].encode())>8000):raise ProjectPolicyFault("PROJECT_ARGUMENTS_INVALID",422)
 if "content" in args:
  if not isinstance(args["content"],str):raise ProjectPolicyFault("PROJECT_ARGUMENTS_INVALID",422)
  try:size=len(args["content"].encode("utf-8"))
  except UnicodeError:raise ProjectPolicyFault("PROJECT_ARGUMENTS_INVALID",422) from None
  if size>LIMITS["maxFileBytes"] or "\x00" in args["content"]:raise ProjectPolicyFault("PROJECT_FILE_LIMIT",413)
 if "expectedSha256" in args and args["expectedSha256"] is not None and (not isinstance(args["expectedSha256"],str) or not re.fullmatch(r"[a-f0-9]{64}",args["expectedSha256"])):raise ProjectPolicyFault("PROJECT_ARGUMENTS_INVALID",422)
 if "route" in args:
  route=args["route"]
  if not isinstance(route,str) or not route.startswith("/") or len(route)>240 or "\\" in route or any(ord(c)<32 for c in route) or any(p==".." for p in route.split("/")) or "://" in route or route.startswith("//"):raise ProjectPolicyFault("PROJECT_ARGUMENTS_INVALID",422)
 return result
def _json(value,maximum=1048576):
 try:encoded=json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False)
 except (TypeError,ValueError,UnicodeError):raise ProjectPolicyFault("PROJECT_RECEIPT_INVALID",422) from None
 try:size=len(encoded.encode())
 except UnicodeError:raise ProjectPolicyFault("PROJECT_RECEIPT_INVALID",422) from None
 if size>maximum:raise ProjectPolicyFault("PROJECT_RECEIPT_LIMIT",413)
 return encoded
class ProjectJournal:
 def __init__(self,path,authorize=None):
  self.path=Path(path);self.authorize=authorize
  if not self.path.is_absolute() or ".." in self.path.parts:raise ProjectPolicyFault("PROJECT_UNSAFE_STORAGE",503)
 def _auth(self,action):
  if self.authorize:
   try:
    if self.authorize(action) is False:raise ProjectPolicyFault("PROJECT_ACCESS_DENIED",403)
   except ProjectPolicyFault:raise
   except Exception:raise ProjectPolicyFault("PROJECT_ACCESS_DENIED",403) from None
 @contextmanager
 def _db(self,action):
  self._auth(action)
  try:
   # All existing parent components are checked; the server creates the private parent.
   for parent in [*reversed(self.path.parent.parents),self.path.parent]:
    if parent.is_symlink():raise ProjectPolicyFault("PROJECT_UNSAFE_STORAGE",503)
   self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   info=self.path.parent.stat()
   if info.st_uid!=os.geteuid() or info.st_mode&0o077:raise ProjectPolicyFault("PROJECT_UNSAFE_STORAGE",503)
   fd=os.open(self.path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
   try:
    info=os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=os.geteuid() or info.st_mode&0o077:raise ProjectPolicyFault("PROJECT_UNSAFE_STORAGE",503)
   finally:os.close(fd)
   db=sqlite3.connect(self.path,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
   try:
    db.execute("PRAGMA busy_timeout=10000");db.execute("PRAGMA journal_mode=DELETE");db.execute("PRAGMA synchronous=FULL")
    db.executescript("CREATE TABLE IF NOT EXISTS operations(owner TEXT,agent TEXT,run TEXT,chat TEXT,call TEXT,hash TEXT,tool TEXT,status TEXT,result TEXT,updated REAL,PRIMARY KEY(owner,agent,call)); CREATE TABLE IF NOT EXISTS bindings(owner TEXT,agent TEXT,project TEXT,created REAL,PRIMARY KEY(owner,agent,project),UNIQUE(owner,project)); CREATE TABLE IF NOT EXISTS run_projects(owner TEXT,agent TEXT,run TEXT,chat TEXT,project TEXT,create_call TEXT,PRIMARY KEY(owner,agent,run));")
    db.execute("BEGIN IMMEDIATE")
    try:self._auth(action);yield db;self._auth(action);db.execute("COMMIT")
    except BaseException:db.execute("ROLLBACK");raise
   finally:db.close()
  except ProjectPolicyFault:raise
  except Exception:raise ProjectPolicyFault("PROJECT_POLICY_UNAVAILABLE",503) from None
 def begin_operation(self,scope,call_id,tool,args):
  owner,agent,run,chat=_scope(scope);_id(call_id);args=validate_tool(tool,args)
  digest=hashlib.sha256(_json({"run":run,"chat":chat,"tool":tool,"args":args}).encode()).hexdigest()
  with self._db("begin_operation") as db:
   row=db.execute("SELECT * FROM operations WHERE owner=? AND agent=? AND call=?",(owner,agent,call_id)).fetchone()
   if row:
    if row["hash"]!=digest:raise ProjectPolicyFault("PROJECT_OPERATION_ID_REUSED",409)
    if row["status"]!="SETTLED":raise ProjectPolicyFault("PROJECT_OPERATION_UNCERTAIN",409)
    return {"replay":True,"status":"SETTLED","result":json.loads(row["result"])}
   if tool=="project_create":
    slot=db.execute("SELECT * FROM run_projects WHERE owner=? AND agent=? AND run=?",(owner,agent,run)).fetchone()
    if slot and (slot["chat"]!=chat or slot["project"] is not None or slot["create_call"]!=call_id):raise ProjectPolicyFault("PROJECT_RUN_PROJECT_LIMIT",409)
    db.execute("INSERT OR IGNORE INTO run_projects VALUES(?,?,?,?,NULL,?)",(owner,agent,run,chat,call_id))
   elif "projectId" in args:self._require(db,scope,args["projectId"])
   if db.execute("SELECT count(*) FROM operations WHERE owner=? AND agent=?",(owner,agent)).fetchone()[0]>=10000:raise ProjectPolicyFault("PROJECT_JOURNAL_QUOTA",429)
   db.execute("INSERT INTO operations VALUES(?,?,?,?,?,?,?,'INTENT',NULL,?)",(owner,agent,run,chat,call_id,digest,tool,time.time()))
   return {"replay":False,"status":"INTENT","result":None}
 def settle(self,scope,call_id,result,*,status="SETTLED",expected_status="INTENT",expected_body_hash=None):
  owner,agent,run,chat=_scope(scope);_id(call_id)
  if status not in ("SETTLED","UNCERTAIN") or expected_status not in ("INTENT","UNCERTAIN"):raise ProjectPolicyFault("PROJECT_RECEIPT_INVALID",422)
  encoded=_json(result)
  def credential(value):
   if isinstance(value,dict):return any(str(key).lower().replace("-","_") in {"authorization","credentials","api_key","apikey","access_token","refresh_token","password","cookie","set_cookie"} or credential(item) for key,item in value.items())
   if isinstance(value,list):return any(credential(item) for item in value)
   return isinstance(value,str) and bool(re.search(r"-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|(?i:authorization\s*:\s*bearer)",value))
  if credential(result):raise ProjectPolicyFault("PROJECT_RECEIPT_SECRET_DENIED",422)
  with self._db("settle") as db:
   row=db.execute("SELECT * FROM operations WHERE owner=? AND agent=? AND call=?",(owner,agent,call_id)).fetchone()
   if not row or row["run"]!=run or row["chat"]!=chat:raise ProjectPolicyFault("PROJECT_OPERATION_NOT_FOUND",404)
   if expected_body_hash is not None and expected_body_hash!=row["hash"]:raise ProjectPolicyFault("PROJECT_OPERATION_ID_REUSED",409)
   if row["status"]=="SETTLED":
    if status!="SETTLED" or row["result"]!=encoded:raise ProjectPolicyFault("PROJECT_OPERATION_ID_REUSED",409)
   elif row["status"]!=expected_status or expected_status=="UNCERTAIN" and (not isinstance(expected_body_hash,str) or expected_body_hash!=row["hash"]):raise ProjectPolicyFault("PROJECT_OPERATION_UNCERTAIN",409)
   elif expected_body_hash is not None and expected_body_hash!=row["hash"]:raise ProjectPolicyFault("PROJECT_OPERATION_ID_REUSED",409)
   else:db.execute("UPDATE operations SET status=?,result=?,updated=? WHERE owner=? AND agent=? AND call=?",(status,encoded,time.time(),owner,agent,call_id))
   return {"status":status,"result":result}
 def inspect_operation(self,scope,call_id):
  owner,agent,run,chat=_scope(scope);_id(call_id)
  with self._db("inspect_operation") as db:
   row=db.execute("SELECT * FROM operations WHERE owner=? AND agent=? AND call=?",(owner,agent,call_id)).fetchone()
   if not row or row["run"]!=run or row["chat"]!=chat:raise ProjectPolicyFault("PROJECT_OPERATION_NOT_FOUND",404)
   return {"callId":call_id,"tool":row["tool"],"bodySha256":row["hash"],"status":row["status"],"result":json.loads(row["result"]) if row["result"] is not None else None,"runId":run,"chatId":chat}
 def bind_project(self,scope,project_id):
  owner,agent,run,chat=_scope(scope);_id(project_id)
  with self._db("bind_project") as db:
   other=db.execute("SELECT agent FROM bindings WHERE owner=? AND project=?",(owner,project_id)).fetchone()
   if other and other["agent"]!=agent:raise ProjectPolicyFault("PROJECT_NOT_BOUND",404)
   slot=db.execute("SELECT * FROM run_projects WHERE owner=? AND agent=? AND run=?",(owner,agent,run)).fetchone()
   if slot and (slot["chat"]!=chat or slot["project"] not in (None,project_id)):raise ProjectPolicyFault("PROJECT_RUN_PROJECT_LIMIT",409)
   db.execute("INSERT OR IGNORE INTO bindings VALUES(?,?,?,?)",(owner,agent,project_id,time.time()))
   if slot:db.execute("UPDATE run_projects SET project=? WHERE owner=? AND agent=? AND run=?",(project_id,owner,agent,run))
   else:db.execute("INSERT INTO run_projects VALUES(?,?,?,?,?,NULL)",(owner,agent,run,chat,project_id))
   return {"projectId":project_id,"agentId":agent}
 def _require(self,db,scope,project):
  owner,agent,run,chat=_scope(scope);_id(project)
  if not db.execute("SELECT 1 FROM bindings WHERE owner=? AND agent=? AND project=?",(owner,agent,project)).fetchone():raise ProjectPolicyFault("PROJECT_NOT_BOUND",404)
  slot=db.execute("SELECT * FROM run_projects WHERE owner=? AND agent=? AND run=?",(owner,agent,run)).fetchone()
  if slot and (slot["chat"]!=chat or slot["project"]!=project):raise ProjectPolicyFault("PROJECT_RUN_PROJECT_LIMIT",409)
  if not slot:db.execute("INSERT INTO run_projects VALUES(?,?,?,?,?,NULL)",(owner,agent,run,chat,project))
  return project
 def require_project(self,scope,project_id):
  with self._db("require_project") as db:return self._require(db,scope,project_id)
 def list_bound(self,scope):
  owner,agent,_,_=_scope(scope)
  with self._db("list_bound") as db:return [row[0] for row in db.execute("SELECT project FROM bindings WHERE owner=? AND agent=? ORDER BY created,project LIMIT 1000",(owner,agent))]
