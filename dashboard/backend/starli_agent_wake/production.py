"""Opt-in native composition; no engine key is ever exported to n8n/model tools."""
import asyncio,hashlib,inspect,os,stat
from pathlib import Path
from contextlib import asynccontextmanager
from company_messaging.authority import require
from .core import AgentWake
from .principal import authentic,StandingSession
from .patch import RUNTIME_SHA

def install_production(app,runtime,receipt_key_file):
 from starli_automations.native import native_permission
 require(runtime is app.state.company_bot_runtime and not hasattr(app.state,'starli_agent_wake'),503,'WAKE_RUNTIME_MISMATCH')
 # Pin actual base admission implementation, not a caller-supplied queue facsimile.
 from company_bot_runtime.core import Runtime
 from company_messaging.authority import actor
 require(hashlib.sha256(Path(inspect.getfile(actor)).read_bytes()).hexdigest()=='7da7bd8d50de99aff6533f8aa69673b14f2ec7c83921219936a5438e31973a33',503,'WAKE_AUTHORITY_PATCH_REQUIRED')
 require(hashlib.sha256(Path(inspect.getfile(Runtime)).read_bytes()).hexdigest()==RUNTIME_SHA,503,'WAKE_RUNTIME_SOURCE_CHANGED')
 keypath=Path(receipt_key_file);require(keypath.is_absolute() and keypath.is_file(),503,'WAKE_KEY_REQUIRED')
 if os.name!='nt':require(stat.S_IMODE(keypath.stat().st_mode)&0o027==0,503,'WAKE_KEY_PERMISSIONS')
 service=AgentWake(runtime,native_permission(runtime),keypath.read_bytes())
 old_auth=runtime.store.authority._authenticate
 def authenticate(session):
  if isinstance(session,StandingSession):return authentic(session,runtime.store.authority)
  return old_auth(session)
 runtime.store.authority._authenticate=authenticate
 stop=asyncio.Event();task=None
 async def pump():
  while not stop.is_set():
   try:await service.drain_once()
   except Exception:pass # No payload/log leak; queue remains durable.
   try:await asyncio.wait_for(stop.wait(),timeout=.5)
   except TimeoutError:pass
 parent=app.router.lifespan_context
 @asynccontextmanager
 async def lifespan(application):
  nonlocal task
  async with parent(application) as state:
   service.recover();task=asyncio.create_task(pump(),name='native-agent-wake-admission')
   try:yield state
   finally:
    stop.set()
    if task:await task
 app.router.lifespan_context=lifespan
 app.state.starli_agent_wake=service
 return service
