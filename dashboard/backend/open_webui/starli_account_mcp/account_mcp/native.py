"""Reviewed native service binding factory. No mount or import-time live state."""
from pathlib import Path
from fastapi import HTTPException
from .registry import Registry,Fault
from .api import create_router
from .remote import NodeRemoteAdapter

def value(obj,key):return obj.get(key)if isinstance(obj,dict)else getattr(obj,key,None)
def native_user(ident):
 from open_webui.models.users import Users
 return Users.get_user_by_id(ident)
def native_agent(owner,ident):
 from open_webui.routers.starli_v3_native import _db
 with _db()as c:
  row=c.execute("SELECT id,owner,status,archived_at FROM agents WHERE id=?AND owner=?AND archived_at IS NULL",(ident,owner)).fetchone()
 return dict(row)if row else None

class NativeAccountMCP:
 def __init__(self,root,*,cipher_loader,user_lookup=native_user,agent_lookup=native_agent):
  self.root=Path(root);self.cipher_loader=cipher_loader;self.user_lookup=user_lookup;self.agent_lookup=agent_lookup
 def registry_for(self,user,fence):
  owner=value(user,"id")
  if getattr(fence,"kind",None)!="jwt":raise Fault("MCP_NATIVE_SESSION_REQUIRED",403)
  def fresh():
   current=fence.check()
   if value(current,"id")!=owner:raise Fault("MCP_ACCOUNT_DENIED",403)
   canonical=self.user_lookup(owner)
   if not canonical or value(canonical,"id")!=owner or value(canonical,"role")not in ("user","admin"):raise Fault("MCP_ACCOUNT_DENIED",403)
   return canonical
  def authorize(ident):
   fresh();return ident==owner
  def agent_owned(ident,agent_id):
   fresh()
   if ident!=owner:return False
   row=self.agent_lookup(owner,agent_id)
   return row is not None and value(row,"id")==agent_id and value(row,"owner")==owner and value(row,"archived_at")is None and value(row,"status")=="IDLE"
  fresh()
  return Registry(self.root/"accounts.sqlite",cipher=self.cipher_loader(),authorize=authorize,owned_agent=agent_owned)

def create_native_router(*,service=None,authenticate=None,capture_fence=None,remote_adapter=None):
 # Imports below are the existing native session/fresh-account/Fernet mechanisms.
 # No provider credentials/configuration or alternate master key is copied.
 if authenticate is None:
  from open_webui.utils.auth import get_verified_user
  authenticate=get_verified_user
 if capture_fence is None:
  from open_webui.routers.starli_session_fence import capture_request_fence
  capture_fence=capture_request_fence
 if service is None:
  from open_webui.routers.starli_state import state_dir
  from open_webui.routers.starli_providers import cipher
  service=NativeAccountMCP(state_dir()/"account-mcp",cipher_loader=cipher)
 return create_router(service.registry_for,authenticate,capture_fence,remote_adapter or NodeRemoteAdapter())
