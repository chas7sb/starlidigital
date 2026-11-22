"""Dependency-free ASGI mount; host supplies verified identity and request-scoped service."""
import json,re
from urllib.parse import parse_qs
from .store import MemoryFault
class DirectoryMount:
 def __init__(self,authenticate,service_factory,*,forbidden_errors=(),onboarding=None):
  self.authenticate=authenticate;self.service_factory=service_factory;self.forbidden_errors=forbidden_errors;self.onboarding=onboarding
 async def __call__(self,scope,receive,send):
  status=200
  try:
   if scope["type"]!="http":raise MemoryFault("MEMORY_INVALID_REQUEST",400)
   actor=await self.authenticate(scope)
   if not isinstance(actor,str) or not actor:raise MemoryFault("MEMORY_AUTH_REQUIRED",401)
   method=scope["method"];path=scope["path"]
   root=scope.get("root_path","").rstrip("/")
   if root and path.startswith(root+"/"):path=path[len(root):]
   path=path.rstrip("/") or "/"
   query=parse_qs(scope.get("query_string",b"").decode("utf-8"),max_num_fields=8)
   body={}
   if method=="POST":
    raw=bytearray()
    while True:
     event=await receive()
     if event["type"]=="http.disconnect":raise MemoryFault("MEMORY_REQUEST_ABORTED",400)
     raw.extend(event.get("body",b""))
     if len(raw)>32768:raise MemoryFault("MEMORY_REQUEST_TOO_LARGE",413)
     if not event.get("more_body"):break
    body=json.loads(raw or b"{}")
    if not isinstance(body,dict):raise MemoryFault("MEMORY_INVALID_REQUEST",422)
   with self.service_factory() as service:
    registry=service.registry
    if method=="GET" and path=="/templates":result={"templates":service.browse(query.get("q",[""])[0])}
    elif method=="GET" and re.fullmatch("/templates/[a-z0-9-]+",path):result=service.preview(path.split("/")[-1])
    elif method=="GET" and path=="/bots":
     kind=query.get("scope",["personal"])[0]
     if kind=="personal":
      result={"bots":[registry._get(r[0]) for r in registry.db.execute("SELECT id FROM bots WHERE kind='personal' AND owner=? AND active=1 ORDER BY id",(actor,))]}
     elif kind=="company":
      company=query.get("companyId",[""])[0]
      result={"bots":registry.directory(actor,company)}
     else:raise MemoryFault("MEMORY_INVALID_SCOPE",422)
    elif method=="POST" and path=="/personal/onboarding":
     self._fields(body,set());result=self.onboarding(registry,actor) if self.onboarding else registry.provision_personal(actor)
    elif method=="POST" and path=="/installs":
     self._fields(body,{"templateId","scope","installKey"},{"companyId"})
     kind=body["scope"]
     if kind=="personal" and "companyId" in body:raise MemoryFault("MEMORY_INVALID_SCOPE",422)
     owner=actor if kind=="personal" else body.get("companyId","")
     result=service.install(actor,body["templateId"],kind,owner,body["installKey"])
    elif method=="GET" and re.fullmatch("/bots/[a-zA-Z0-9:_-]+",path):result=service.instance(actor,path.split("/")[-1])
    elif method=="POST" and re.fullmatch("/bots/[a-zA-Z0-9:_-]+/first-draft",path):
     self._fields(body,{"brand","requestKey"});result=service.email_draft(actor,path.split("/")[2],body["brand"],body["requestKey"])
    else:raise MemoryFault("MEMORY_ROUTE_NOT_FOUND",404)
   # Recheck native session after service work before any response bytes.
   if await self.authenticate(scope)!=actor:raise MemoryFault("MEMORY_AUTH_REQUIRED",401)
  except MemoryFault as error:status=error.status;result={"error":error.code}
  except self.forbidden_errors:status=403;result={"error":"MEMORY_ACCESS_DENIED"}
  except (ValueError,TypeError,KeyError,UnicodeError):status=422;result={"error":"MEMORY_INVALID_REQUEST"}
  except Exception:status=503;result={"error":"MEMORY_SERVICE_UNAVAILABLE"}
  raw=json.dumps(result,separators=(",",":")).encode()
  await send({"type":"http.response.start","status":status,"headers":[(b"content-type",b"application/json"),(b"cache-control",b"no-store"),(b"x-content-type-options",b"nosniff")]})
  await send({"type":"http.response.body","body":raw})
 @staticmethod
 def _fields(body,required,optional=frozenset()):
  if set(body)-required-optional or required-set(body):raise MemoryFault("MEMORY_INVALID_REQUEST",422)
