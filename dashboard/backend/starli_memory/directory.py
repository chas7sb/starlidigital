"""Curated directory entry points; actor identity must be host-authenticated."""
import copy,hashlib,json,uuid,html
from pathlib import Path
from .store import MemoryFault
class BotDirectory:
 def __init__(self,registry,catalog=None):
  self.registry=registry;self.db=registry.db
  self.catalog=catalog or json.loads((Path(__file__).resolve().parent.parent/"bot-templates.v1.json").read_text())["templates"]
  self.db.executescript("""
  CREATE TABLE IF NOT EXISTS template_installs(bot TEXT PRIMARY KEY,actor TEXT,install_key TEXT,request_hash TEXT,template TEXT,version INTEGER,base TEXT,config TEXT,UNIQUE(actor,install_key));
  CREATE TABLE IF NOT EXISTS bot_artifacts(id TEXT PRIMARY KEY,bot TEXT,request_key TEXT,request_hash TEXT,content TEXT,UNIQUE(bot,request_key));
  """)
 def browse(self,query=""):
  words=query.casefold().split()
  return [copy.deepcopy(t) for t in self.catalog if all(w in json.dumps(t).casefold() for w in words)]
 def preview(self,template):
  found=[t for t in self.catalog if t["id"]==template]
  if len(found)!=1:raise MemoryFault("MEMORY_TEMPLATE_NOT_FOUND",404)
  return copy.deepcopy(found[0])
 def _authorize(self,actor,bot):
  value=self.registry._get(bot)
  if value["kind"]=="personal":
   if value["owner"]!=actor:raise MemoryFault("MEMORY_BOT_UNAVAILABLE",404)
  else:self.registry.require_member(actor,value["owner"])
  return value
 def install(self,actor,template,kind,owner,install_key,avatar=None,resolve_asset=None):
  if kind not in ("personal","company") or not isinstance(install_key,str) or not 1<=len(install_key)<=128:raise MemoryFault("MEMORY_INVALID_INSTALL",422)
  t=self.preview(template)
  def run():
   if kind=="personal":
    if owner!=actor:raise MemoryFault("MEMORY_BOT_UNAVAILABLE",404)
   else:self.registry._manage(actor,owner)
   fingerprint=hashlib.sha256(json.dumps([template,kind,owner,avatar],sort_keys=True).encode()).hexdigest()
   old=self.db.execute("SELECT bot,request_hash FROM template_installs WHERE actor=? AND install_key=?",(actor,install_key)).fetchone()
   if old:
    if old[1]!=fingerprint:raise MemoryFault("MEMORY_INSTALL_KEY_REUSED",409)
    return self.instance(actor,old[0])
   if avatar is not None and (resolve_asset is None or resolve_asset(kind,owner,avatar) is not True):raise MemoryFault("MEMORY_AVATAR_DENIED",403)
   bot=str(uuid.uuid4())
   self.db.execute("INSERT INTO bots(id,kind,owner,name,avatar,purpose) VALUES(?,?,?,?,?,'template')",(bot,kind,owner,t["name"],avatar))
   config={k:t[k] for k in ("name","instructions","avatar")}
   if avatar is not None:config["avatar"]={"type":"asset","id":avatar}
   self.db.execute("INSERT INTO template_installs VALUES(?,?,?,?,?,?,?,?)",(bot,actor,install_key,fingerprint,template,t["version"],json.dumps({k:t[k] for k in ("name","instructions","avatar")}),json.dumps(config)))
   # New stable bot ID means empty memory; no template memory, grants or connections copied.
   return self.instance(actor,bot)
  return self.registry._tx(run)
 def instance(self,actor,bot):
  value=self._authorize(actor,bot)
  row=self.db.execute("SELECT template,version,config FROM template_installs WHERE bot=?",(bot,)).fetchone()
  if not row:raise MemoryFault("MEMORY_TEMPLATE_NOT_FOUND",404)
  return {"version":"starli.bot-directory.v1","bot":value,"templateId":row[0],"templateVersion":row[1],"config":json.loads(row[2]),"memoryIdentity":[value["kind"],value["owner"],bot]}
 def edit(self,actor,bot,expected_revision,patch):
  if set(patch)-{"name","instructions"} or any(not isinstance(v,str) or len(v)>16000 for v in patch.values()):raise MemoryFault("MEMORY_INVALID_CONFIGURATION",422)
  def run():
   value=self.instance(actor,bot)
   if value["bot"]["kind"]=="company":self.registry._manage(actor,value["bot"]["owner"])
   if value["bot"]["revision"]!=expected_revision:raise MemoryFault("MEMORY_BOT_REVISION_CONFLICT",409)
   config=value["config"]|patch
   self.db.execute("UPDATE template_installs SET config=? WHERE bot=?",(json.dumps(config),bot))
   self.db.execute("UPDATE bots SET name=?,revision=revision+1 WHERE id=?",(config["name"],bot))
   return self.instance(actor,bot)
  return self.registry._tx(run)
 def update(self,actor,bot,expected_revision):
  def run():
   value=self.instance(actor,bot);t=self.preview(value["templateId"])
   if value["bot"]["kind"]=="company":self.registry._manage(actor,value["bot"]["owner"])
   if value["bot"]["revision"]!=expected_revision:raise MemoryFault("MEMORY_BOT_REVISION_CONFLICT",409)
   if t["version"]<=value["templateVersion"]:return value
   base=json.loads(self.db.execute("SELECT base FROM template_installs WHERE bot=?",(bot,)).fetchone()[0])
   target={k:t[k] for k in ("name","instructions","avatar")}
   config={k:target[k] if value["config"][k]==base[k] else value["config"][k] for k in target}
   self.db.execute("UPDATE template_installs SET version=?,base=?,config=? WHERE bot=?",(t["version"],json.dumps(target),json.dumps(config),bot))
   self.db.execute("UPDATE bots SET name=?,revision=revision+1 WHERE id=?",(config["name"],bot))
   return self.instance(actor,bot)
  return self.registry._tx(run)
 def first_draft(self,actor,bot,brand,request_key):
  """Email Studio handoff: review-only artifact; no recipient, connection or send operation."""
  required={"name","audience","offer","cta"}
  if set(brand)!=required or any(not isinstance(v,str) or not 1<=len(v)<=2000 for v in brand.values()):raise MemoryFault("MEMORY_INVALID_DRAFT",422)
  if not isinstance(request_key,str) or not 1<=len(request_key)<=128:raise MemoryFault("MEMORY_INVALID_WRITE_ID",422)
  def run():
   instance=self.instance(actor,bot)
   if instance["templateId"]!="agata":raise MemoryFault("MEMORY_TEMPLATE_NOT_SUPPORTED",422)
   fingerprint=hashlib.sha256(json.dumps(brand,sort_keys=True).encode()).hexdigest()
   old=self.db.execute("SELECT request_hash,content FROM bot_artifacts WHERE bot=? AND request_key=?",(bot,request_key)).fetchone()
   if old:
    if old[0]!=fingerprint:raise MemoryFault("MEMORY_WRITE_ID_REUSED",409)
    return json.loads(old[1])
   text=f'{brand["name"]}: {brand["offer"]}\n\nHello,\n\nFor {brand["audience"]}, we are introducing {brand["offer"]}.\n\n{brand["cta"]}\n\nThe {brand["name"]} team'
   artifact={"version":"starli.email-studio.draft.v1","id":str(uuid.uuid4()),"botId":bot,"status":"draft","requiresReview":True,"brand":brand["name"],"audienceBrief":brand["audience"],"subjectOptions":[f'{brand["name"]}: {brand["offer"]}',f'A new offer from {brand["name"]}'],"preheader":brand["offer"],"text":text,"html":"<div>"+html.escape(text).replace("\n","<br>")+"</div>","reviewChecklist":["Verify offer and all claims","Select opted-in recipients in Email Studio","Add sender identity and unsubscribe footer before approval"],"recipients":[],"sendAuthorized":False}
   artifact["document"]=self.email_document(artifact)
   self.db.execute("INSERT INTO bot_artifacts VALUES(?,?,?,?,?)",(artifact["id"],bot,request_key,fingerprint,json.dumps(artifact)))
   self._authorize(actor,bot)
   return artifact
  return self.registry._tx(run)

 @staticmethod
 def email_document(artifact):
  """Frozen Email Studio DTO. No identity selected until human review.
  Block text is escaped; no raw HTML, URLs, assets or recipients are inferred.
  """
  prefix=artifact["id"]
  return {"schema":"starli.email/1","identityId":"","to":[],"cc":[],"bcc":[],
   "subject":artifact["subjectOptions"][0],"preheader":artifact["preheader"],
   "brand":{"color":"#334155"},"attachments":[],
   "blocks":[{"id":prefix+"-heading","type":"heading","text":html.escape(artifact["brand"])},
             {"id":prefix+"-body","type":"text","text":html.escape(artifact["text"])}]}
 def email_draft(self,actor,bot,brand,request_key):
  """Normal integration entry: frozen structured document inside persisted draft envelope."""
  artifact=self.first_draft(actor,bot,brand,request_key)
  # Preserve old durable receipt payloads; expose the new DTO on read without rewriting history.
  if "document" not in artifact:artifact["document"]=self.email_document(artifact)
  return artifact
