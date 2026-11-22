"""Native foundation binding. Source only; root includes returned router in staging."""
from contextlib import contextmanager
from pathlib import Path
from .store import MemoryFault
from .registry import BotRegistry
from .directory import BotDirectory
from .directory_mount import DirectoryMount

def request_service_factory(company_path,registry_path,authority_class):
 @contextmanager
 def factory():
  authority=authority_class(str(company_path))
  registry=None
  try:
   registry=BotRegistry(str(registry_path),authority.require_member)
   yield BotDirectory(registry)
  finally:
   if registry is not None:registry.db.close()
   authority.db.close()
 return factory

def build_router(verified_user,capture_fence,service_factory,resolve_personal,mutation_guard,forbidden_errors=()):
 from fastapi import APIRouter,Depends,Request,HTTPException
 from fastapi.responses import Response
 router=APIRouter()
 async def endpoint(request:Request,path:str="",user=Depends(verified_user)):
  if request.method=="POST":mutation_guard(request)
  fence=capture_fence(request,user)
  fence.check()
  async def authenticate(scope):
   try:fresh=fence.check()
   except HTTPException as error:raise MemoryFault("MEMORY_AUTH_REQUIRED",error.status_code) from None
   return fresh.id
  def onboarding(registry,actor):
   if actor!=user.id:raise MemoryFault("MEMORY_AUTH_REQUIRED",401)
   row=resolve_personal(user,fence)
   fence.check()
   return registry.reuse_personal(actor,row["id"],row["name"])
  app=DirectoryMount(authenticate,service_factory,forbidden_errors=forbidden_errors,onboarding=onboarding)
  messages=[]
  async def send(message):messages.append(message)
  # Explicit route-relative ASGI path avoids mounted/root_path version differences.
  scope=dict(request.scope,path="/"+path,root_path="")
  await app(scope,request.receive,send)
  start=messages[0];body=messages[1]["body"]
  return Response(body,status_code=start["status"],headers={k.decode():v.decode() for k,v in start["headers"]})
 router.add_api_route("",endpoint,methods=["GET","POST"])
 router.add_api_route("/{path:path}",endpoint,methods=["GET","POST"])
 return router

def build_native_router(*,company_path=None,registry_path=None):
 import os,sqlite3
 from open_webui.config import DATA_DIR
 from open_webui.utils.auth import get_verified_user
 from open_webui.routers.starli_session_fence import capture_request_fence
 from open_webui.routers import starli_v3_native as native
 from open_webui.company_authority import Authority,Forbidden
 root=Path(DATA_DIR)
 company=Path(company_path or os.getenv("STARLI_COMPANY_DATABASE") or root/"company-authority.sqlite3")
 registry=Path(registry_path or os.getenv("STARLI_COMPANY_BOT_DATABASE") or company)
 # Agent7 v4 defaults to company authority DB as registry; never silently fork it.
 old=root/"bot-directory.sqlite3"
 if old.is_file() and old.resolve()!=registry.resolve():
  with sqlite3.connect("file:"+str(old)+"?mode=ro",uri=True) as check:
   table=check.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bots'").fetchone()
   if table and check.execute("SELECT 1 FROM bots LIMIT 1").fetchone():
    raise MemoryFault("MEMORY_REGISTRY_MIGRATION_REQUIRED",409)
 factory=request_service_factory(company,registry,Authority)
 def resolve(user,fence):
  fence.check();owner=native._owner(user)
  with native._db() as db:
   db.execute("BEGIN IMMEDIATE")
   row=native._boss(db,owner)
   # Archived/malformed or noncanonical identities must not be resurrected.
   if row is None or row["owner"]!=owner or row["id"]!="boss:"+owner or row["kind"]!="boss" or row["archived_at"] is not None:
    raise MemoryFault("MEMORY_PERSONAL_MAPPING_CONFLICT",409)
   fence.check();value={"id":row["id"],"name":row["name"]}
   db.commit()
  return value
 return build_router(get_verified_user,capture_request_fence,factory,resolve,native._mutation_guard,(Forbidden,))
