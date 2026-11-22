"""Private once-only remote invocation journal. No automatic effect retries."""
import hashlib,json,sqlite3
from .registry import Fault,identifier,encode
def ensure_journal(registry):
 with registry.db()as c:
  c.execute("CREATE TABLE IF NOT EXISTS invocations(owner TEXT,key TEXT,fingerprint TEXT,state TEXT,result TEXT,agent TEXT,run TEXT,PRIMARY KEY(owner,key))")
  columns={row[1]for row in c.execute("PRAGMA table_info(invocations)")}
  for field in ("agent","run"):
   if field not in columns:c.execute("ALTER TABLE invocations ADD COLUMN "+field+" TEXT")
class Invoker:
 def __init__(self,registry,adapter,validate_arguments,authorize_phase=None):
  self.registry=registry;self.adapter=adapter;self.validate_arguments=validate_arguments;self.authorize_phase=authorize_phase
  ensure_journal(registry)
 async def invoke(self,lease,public_name,args,*,run_id,tool_call_id):
  if getattr(self.adapter,"available",True)is not True:raise Fault("MCP_TRANSPORT_UNAVAILABLE",503)
  configuration=self.registry.check_lease(lease)
  identifier(run_id);identifier(tool_call_id)
  if type(args)is not dict or len(json.dumps(args,allow_nan=False).encode())>65536:raise Fault("MCP_ARGUMENT_LIMIT",413)
  with self.registry.db()as c:
   row=self.registry.getrow(c,lease.owner,lease.server_id);tools=json.loads(row["tools"])
  tool=next((v for v in tools if v["publicName"]==public_name),None)
  if tool is None:raise Fault("MCP_TOOL_UNAVAILABLE",404)
  if self.validate_arguments(args,tool["inputSchema"])is not True:raise Fault("MCP_ARGUMENTS_INVALID",422)
  key=hashlib.sha256(json.dumps([lease.owner,lease.agent,lease.server_id,run_id,tool_call_id],separators=(",",":")).encode()).hexdigest()
  fingerprint=hashlib.sha256(json.dumps([lease.revision,public_name,args],sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()
  with self.registry.db()as c:
   c.execute("BEGIN IMMEDIATE");self.registry.check_lease(lease)
   prior=c.execute("SELECT *FROM invocations WHERE owner=?AND key=?",(lease.owner,key)).fetchone()
   if prior:
    if prior["fingerprint"]!=fingerprint:raise Fault("MCP_CALL_REUSED",409)
    if prior["state"]in ("SUCCEEDED","FAILED"):return {"receiptReplayed":True,"state":prior["state"],"result":json.loads(prior["result"])}
    raise Fault("MCP_EFFECT_UNKNOWN",409)
   if c.execute("SELECT COUNT(*)FROM invocations WHERE owner=?",(lease.owner,)).fetchone()[0]>=10000:raise Fault("MCP_RECEIPT_QUOTA",409)
   c.execute("INSERT INTO invocations(owner,key,fingerprint,state,result,agent,run) VALUES(?,?,?,'INTENT',NULL,?,?)",(lease.owner,key,fingerprint,lease.agent,run_id))
  def authorize():
   self.registry.check_lease(lease)
   if self.authorize_phase is not None:self.authorize_phase()
  try:
   result=await self.adapter.invoke(configuration,tool["name"],args,authorize)
   authorize()
   raw=json.dumps(result,allow_nan=False,separators=(",",":"))
   if len(raw.encode())>1048576:raise Fault("MCP_OUTPUT_LIMIT",413)
   state="FAILED"if isinstance(result,dict)and result.get("isError")is True else "SUCCEEDED"
   with self.registry.db()as c:
    c.execute("BEGIN IMMEDIATE");authorize()
    c.execute("UPDATE invocations SET state=?,result=?WHERE owner=?AND key=?AND state='INTENT'",(state,raw,lease.owner,key))
   return {"receiptReplayed":False,"state":state,"result":result}
  except BaseException:
   # Includes cancellation: remote effects may have happened. Never replay blindly.
   with self.registry.db()as c:c.execute("UPDATE invocations SET state='UNKNOWN'WHERE owner=?AND key=?AND state='INTENT'",(lease.owner,key))
   raise
