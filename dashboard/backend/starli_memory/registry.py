"""Durable bot ownership registry; host supplies fresh company authority."""
import sqlite3,uuid,json
from .store import MemoryFault
class BotRegistry:
 def __init__(self,path,require_member):
  self.db=sqlite3.connect(path,isolation_level=None);self.require_member=require_member
  self.db.execute("PRAGMA journal_mode=WAL")
  self.db.executescript("""
  CREATE TABLE IF NOT EXISTS bots(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner TEXT NOT NULL,name TEXT NOT NULL,avatar TEXT,revision INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1);

  CREATE TABLE IF NOT EXISTS bot_grants(bot TEXT,permission TEXT,enabled INTEGER NOT NULL,PRIMARY KEY(bot,permission));
  """)
  if "purpose" not in {r[1] for r in self.db.execute("PRAGMA table_info(bots)")}:
   self.db.execute("ALTER TABLE bots ADD COLUMN purpose TEXT NOT NULL DEFAULT 'onboarding'")
  self.db.execute("DROP INDEX IF EXISTS one_personal_bot")
  self.db.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_personal_onboarding_bot ON bots(owner) WHERE kind='personal' AND purpose='onboarding'")
 def _tx(self,fn):
  self.db.execute("BEGIN IMMEDIATE")
  try:
   result=fn();self.db.execute("COMMIT");return result
  except BaseException:self.db.execute("ROLLBACK");raise
 def provision_personal(self,person):
  if not isinstance(person,str) or not person:raise MemoryFault("MEMORY_INVALID_SCOPE",422)
  def run():
   row=self.db.execute("SELECT id FROM bots WHERE kind='personal' AND purpose='onboarding' AND owner=?",(person,)).fetchone()
   if row:return self._get(row[0])
   bot=str(uuid.uuid4())
   self.db.execute("INSERT INTO bots(id,kind,owner,name) VALUES(?,'personal',?,'Personal AI AGENT BOT')",(bot,person))
   return self._get(bot)
  return self._tx(run)
 def _get(self,bot):
  row=self.db.execute("SELECT id,kind,owner,name,avatar,revision,active FROM bots WHERE id=?",(bot,)).fetchone()
  if not row or not row[6]:raise MemoryFault("MEMORY_BOT_UNAVAILABLE",404)
  return dict(zip(("id","kind","owner","name","avatar","revision","active"),row))
 def _manage(self,user,company):
  member=self.require_member(user,company)
  if member["role"] not in ("owner","admin"):raise MemoryFault("MEMORY_BOT_MANAGEMENT_DENIED",403)
 def create_shared(self,user,company,name):
  def run():
   self._manage(user,company)
   bot=str(uuid.uuid4())
   self.db.execute("INSERT INTO bots(id,kind,owner,name) VALUES(?,'company',?,?)",(bot,company,name))
   self._manage(user,company)
   return self._get(bot)
  return self._tx(run)
 def require_bot(self,company,bot):
  value=self._get(bot)
  if value["kind"]!="company" or value["owner"]!=company:raise MemoryFault("MEMORY_BOT_UNAVAILABLE",404)
  return value
 def directory(self,user,company):
  self.require_member(user,company)
  result=[self._get(r[0]) for r in self.db.execute("SELECT id FROM bots WHERE kind='company' AND owner=? AND active=1 ORDER BY id",(company,))]
  self.require_member(user,company);return result
 def configure(self,user,company,bot,expected_revision,*,name=None,avatar=None,grants=None,resolve_asset=None):
  def run():
   self._manage(user,company);value=self.require_bot(company,bot)
   if value["revision"]!=expected_revision:raise MemoryFault("MEMORY_BOT_REVISION_CONFLICT",409)
   if avatar is not None and (resolve_asset is None or resolve_asset(company,avatar) is not True):raise MemoryFault("MEMORY_AVATAR_DENIED",403)
   if grants is not None and (not isinstance(grants,dict) or any(not isinstance(k,str) or type(v)is not bool for k,v in grants.items())):raise MemoryFault("MEMORY_INVALID_GRANTS",422)
   self.db.execute("UPDATE bots SET name=?,avatar=?,revision=revision+1 WHERE id=?",(name if name is not None else value["name"],avatar if avatar is not None else value["avatar"],bot))
   for permission,enabled in (grants or {}).items():
    self.db.execute("INSERT INTO bot_grants VALUES(?,?,?) ON CONFLICT(bot,permission) DO UPDATE SET enabled=excluded.enabled",(bot,permission,int(enabled)))
   self._manage(user,company);return self.require_bot(company,bot)
  return self._tx(run)
 def require_grant(self,user,company,bot,permission,expected_revision=None):
  self.require_member(user,company);value=self.require_bot(company,bot)
  row=self.db.execute("SELECT enabled FROM bot_grants WHERE bot=? AND permission=?",(bot,permission)).fetchone()
  if not row or row[0]!=1 or expected_revision is not None and value["revision"]!=expected_revision:raise MemoryFault("MEMORY_BOT_GRANT_DENIED",403)
  self.require_member(user,company);return value

 def reuse_personal(self,person,native_id,name):
  """Map verified native boss identity; never rename IDs or copy private history."""
  if not all(isinstance(x,str) and x for x in (person,native_id,name)):raise MemoryFault("MEMORY_INVALID_SCOPE",422)
  def run():
   old=self.db.execute("SELECT id FROM bots WHERE owner=? AND kind='personal' AND purpose='onboarding'",(person,)).fetchone()
   if old:
    if old[0]!=native_id:raise MemoryFault("MEMORY_PERSONAL_MAPPING_CONFLICT",409)
    return self._get(native_id)
   collision=self.db.execute("SELECT id FROM bots WHERE id=?",(native_id,)).fetchone()
   if collision:raise MemoryFault("MEMORY_PERSONAL_MAPPING_CONFLICT",409)
   self.db.execute("INSERT INTO bots(id,kind,owner,name,purpose) VALUES(?,'personal',?,?,'onboarding')",(native_id,person,name))
   return self._get(native_id)
  return self._tx(run)
