"""Fixed Node official-SDK bridge with fresh native authorization IPC."""
import starli_portable as _portable
import asyncio,json,os,signal,weakref
from pathlib import Path
from .registry import Fault
from .firstparty_mcp import LocalFirstPartyMcp
NODE=_portable.node_binary()
SERVICE=Path(__file__).resolve().parents[1]/"remote/service.mjs"
class StopUnconfirmed(Fault):
 unknownEffect=True
 requiresReview=True
 automaticRetryAllowed=False
 def __init__(self,process=None):
  super().__init__("MCP_STOP_UNCONFIRMED",503);self.process=process

async def settle(p):
 async def physical():
  if p.returncode is None:
   killer=getattr(p,"kill_group",None)
   if callable(killer):
    try:await killer()
    except Exception:pass # wait() still requires root physical stop acknowledgement.
   elif isinstance(p,asyncio.subprocess.Process):
    try:os.killpg(p.pid,signal.SIGKILL)
    except OSError:pass
   else:raise StopUnconfirmed(p)
  try:await p.wait()
  except Exception:raise StopUnconfirmed(p)from None
  if p.returncode is None:raise StopUnconfirmed(p)
 task=asyncio.create_task(physical());cancelled=False
 while not task.done():
  try:await asyncio.shield(task)
  except asyncio.CancelledError:cancelled=True
 await task
 if cancelled:raise asyncio.CancelledError()
_LIMITS=weakref.WeakKeyDictionary()
class NodeRemoteAdapter:
 def __init__(self,*,launcher=None,service_path=SERVICE):
  self.launcher=launcher;self.service_path=Path(service_path);self._uncertain=[];self._reconcile_lock=asyncio.Lock();self.firstparty=LocalFirstPartyMcp()
 @property
 def available(self):
  return not self._uncertain and (self.broker_available or self.firstparty is not None)
 @property
 def broker_available(self):
  launcher=self.launcher
  return not self._uncertain and launcher is not None and getattr(launcher,"available",False)is True and getattr(launcher,"profile_id",None)=="starli.account-mcp.public-https.v1" and callable(getattr(launcher,"launch",None))
 async def operation(self,configuration,request,authorize):
  if not self.broker_available:raise Fault("MCP_TRANSPORT_UNAVAILABLE",503)
  owner=configuration.get("_owner")
  if not isinstance(owner,str)or not owner:raise Fault("MCP_ACCOUNT_DENIED",403)
  loop=asyncio.get_running_loop()
  if loop not in _LIMITS:_LIMITS[loop]=(asyncio.Semaphore(4),{})
  global_slot,owners=_LIMITS[loop]
  if owner not in owners:owners[owner]=asyncio.Semaphore(1)
  # Retain actual occupancy after an unconfirmed physical stop.
  owner_slot=owners[owner];global_acquired=False;owner_acquired=False;retain=False
  try:
   await asyncio.wait_for(global_slot.acquire(),timeout=5);global_acquired=True
   await asyncio.wait_for(owner_slot.acquire(),timeout=5);owner_acquired=True
   authorize()
   return await self._operation(configuration,request,authorize)
  except StopUnconfirmed as error:
   retain=True;self._uncertain.append((owner,error.process,global_slot,owner_slot))
   raise
  except asyncio.TimeoutError:raise Fault("MCP_BUSY",503)from None
  finally:
   if not retain:
    if owner_acquired:owner_slot.release()
    if global_acquired:global_slot.release()
 async def reconcile_uncertain(self,confirm_stopped):
  # Trusted broker callback only: literal True means actual owned cgroup empty.
  async with self._reconcile_lock:
   proven=[]
   for entry in list(self._uncertain):
    owner,process,global_slot,owner_slot=entry
    if await confirm_stopped(owner,process)is True:proven.append(entry)
   # No slot is released if a proof callback fails halfway through.
   for owner,process,global_slot,owner_slot in proven:
    owner_slot.release();global_slot.release()
   identities={id(entry)for entry in proven}
   self._uncertain=[entry for entry in self._uncertain if id(entry)not in identities]
   return not self._uncertain
 async def _operation(self,configuration,request,authorize):
  authorize()
  job=json.dumps({"configuration":{k:configuration.get(k)for k in ("url","transport","credential")},"request":request},separators=(",",":"))
  if len(job.encode())>100000:raise Fault("MCP_ARGUMENT_LIMIT",413)
  spawn=asyncio.create_task(self.launcher.launch((NODE,"--max-old-space-size=128",str(self.service_path)),cwd=str(self.service_path.parent),env={"PATH":os.environ.get("PATH",os.defpath),"LANG":"C.UTF-8"},limits={"memoryBytes":268435456,"cpuSeconds":10,"wallSeconds":25,"openFiles":64,"processes":16,"stdoutBytes":1500000}))
  cancelled=False
  while not spawn.done():
   try:await asyncio.shield(spawn)
   except asyncio.CancelledError:cancelled=True
  try:p=await spawn
  except BaseException:raise StopUnconfirmed()from None
  if cancelled:await settle(p);raise asyncio.CancelledError()
  async def exchange():
   p.stdin.write((job+"\n").encode());await p.stdin.drain()
   async def reader():
    while True:
     line=await p.stdout.readline()
     if not line or len(line)>1500000:raise Fault("MCP_REMOTE_FAILED",502)
     try:value=json.loads(line)
     except ValueError:raise Fault("MCP_REMOTE_FAILED",502)from None
     if value.get("type")=="authorize":
      authorize();p.stdin.write(b'{"authorized":true}\n');await p.stdin.drain()
     elif value.get("type")=="result":
      authorize();return value["result"]
     elif value.get("type")=="error":
      code=value.get("code")
      raise Fault(code if isinstance(code,str)and code.startswith("MCP_")and len(code)<80 else "MCP_REMOTE_FAILED",502)
     else:raise Fault("MCP_REMOTE_FAILED",502)
   read=asyncio.create_task(reader())
   try:
    while not read.done():
     done,_=await asyncio.wait([read],timeout=3)
     if not done:authorize()
    result=await read;p.stdin.close();await p.wait()
    if p.returncode!=0:raise Fault("MCP_REMOTE_FAILED",502)
    authorize();return result
   finally:
    if not read.done():read.cancel()
    await asyncio.gather(read,return_exceptions=True)
  try:
   try:return await asyncio.wait_for(exchange(),timeout=25)
   except asyncio.TimeoutError:raise Fault("MCP_REMOTE_TIMEOUT",504)from None
  finally:await settle(p)
 async def discover(self,configuration,authorize):
  if self.firstparty.matches(configuration):return await self.firstparty.discover(configuration,authorize)
  result=await self.operation(configuration,{"action":"discover"},authorize)
  if type(result)is not list:raise Fault("MCP_DISCOVERY_INVALID",502)
  return result
 async def invoke(self,configuration,name,args,authorize):
  if self.firstparty.matches(configuration):return await self.firstparty.invoke(configuration,name,args,authorize)
  return await self.operation(configuration,{"action":"invoke","name":name,"arguments":args},authorize)
