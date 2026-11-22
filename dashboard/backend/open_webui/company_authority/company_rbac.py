"""Version 2 company capability authority. All mutations serialize on SQLite."""
import json, uuid, secrets, hashlib, time
from .company_authority_base import Authority as BaseAuthority, Forbidden
CATALOG = {
 "read":False, "write":False, "shared_bot.choose_provider":False,
 "bots.install":True, "bots.run":True, "integrations.install":False, "integrations.run":True,
 "messages.send":True, "files.manage":True, "computer.view":True,
 "computer.control":True, "tools.dispatch":True, "dns.propose":True,
 "connections.manage":False, "invites.manage":False, "members.remove":False,
 "owners.manage":False, "roles.manage":False, "dns.commit":False,
 "nameservers.commit":False,
}
BASE = {"read","write","shared_bot.choose_provider"}
ADMIN = {"connections.manage","invites.manage","members.remove","roles.manage","dns.commit","nameservers.commit","integrations.install"}
class Authority(BaseAuthority):
 def __init__(self,path):
  super().__init__(path)
  self.db.executescript("""
  CREATE TABLE IF NOT EXISTS invite_roles(invite_id TEXT PRIMARY KEY,role_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS custom_roles(id TEXT PRIMARY KEY,company_id TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,grants TEXT NOT NULL,active INTEGER NOT NULL,UNIQUE(company_id,name,kind));
  CREATE TABLE IF NOT EXISTS role_assignments(company_id TEXT,subject_id TEXT,role_id TEXT,PRIMARY KEY(company_id,subject_id,role_id));
  """)
 def _member(self,u,c):
  row=self.db.execute("SELECT role,active,revision,kind FROM members WHERE company_id=? AND user_id=?",(c,u)).fetchone()
  if not row or not row[1]: raise Forbidden("membership")
  return row
 def effective(self,u,c):
  role,active,rev,kind=self._member(u,c)
  caps=set(BASE) if kind=='person' else {"read"}
  if kind=='person' and role in {'owner','admin','member'}: caps.add("messages.send")
  if kind=='person' and role in {'owner','admin'}: caps|=ADMIN | {k for k,v in CATALOG.items() if v}
  if kind=='person' and role=='owner': caps.add('owners.manage')
  for grants, in self.db.execute("SELECT r.grants FROM custom_roles r JOIN role_assignments a ON r.id=a.role_id AND r.company_id=a.company_id WHERE a.company_id=? AND a.subject_id=? AND r.kind=? AND r.active=1",(c,u,kind)):
   caps.update(json.loads(grants))
  return dict(company_id=c,user_id=u,role=role,kind=kind,membership_revision=rev,contract_version=2,capabilities=sorted(caps))
 def require_member(self,user_id,company_id,expected_revision=None,permission='read'):
  scope=self.effective(user_id,company_id)
  if expected_revision is not None and scope['membership_revision']!=expected_revision: raise Forbidden("stale grant")
  if permission not in CATALOG or permission not in scope['capabilities']: raise Forbidden("permission")
  return scope
 def _admin(self,u,c):
  r=self._member(u,c)
  if r[3]!='person' or r[0] not in {'owner','admin'}: raise Forbidden("company admin required")
 def _invalidate(self,c):
  self.db.execute("UPDATE members SET revision=revision+1 WHERE company_id=?",(c,))
 def _grants(self,grants):
  if not isinstance(grants,list) or any(not isinstance(g,str) or not CATALOG.get(g,False) for g in grants): raise ValueError("unknown or nondelegable permission")
  return sorted(set(grants))
 def create_custom_role(self,u,c,name,kind,grants):
  if kind not in {'person','bot'} or not name.strip() or len(name)>100: raise ValueError("role")
  grants=self._grants(grants)
  def run():
   self._admin(u,c); rid=str(uuid.uuid4())
   self.db.execute("INSERT INTO custom_roles VALUES(?,?,?,?,?,1)",(rid,c,name.strip(),kind,json.dumps(grants)))
   self._invalidate(c); self.log(c,u,'custom_role.create',json.dumps(dict(id=rid,name=name.strip(),kind=kind,grants=grants))); return rid
  return self.tx(run)
 def _custom(self,c,rid):
  row=self.db.execute("SELECT name,kind,grants,active FROM custom_roles WHERE id=? AND company_id=?",(rid,c)).fetchone()
  if not row or not row[3]: raise Forbidden("role unavailable")
  return row
 def update_custom_role(self,u,c,rid,name,grants):
  if not name.strip() or len(name)>100: raise ValueError("role")
  grants=self._grants(grants)
  def run():
   self._admin(u,c); self._custom(c,rid)
   self.db.execute("UPDATE custom_roles SET name=?,grants=? WHERE id=? AND company_id=?",(name.strip(),json.dumps(grants),rid,c))
   self._invalidate(c); self.log(c,u,'custom_role.update',json.dumps(dict(id=rid,name=name.strip(),grants=grants)))
  return self.tx(run)
 def assign_custom_role(self,u,c,rid,target,assign=True):
  def run():
   self._admin(u,c); role=self._custom(c,rid); member=self._member(target,c)
   if member[3]!=role[1]: raise Forbidden("subject kind mismatch")
   if assign: self.db.execute("INSERT OR IGNORE INTO role_assignments VALUES(?,?,?)",(c,target,rid))
   else: self.db.execute("DELETE FROM role_assignments WHERE company_id=? AND subject_id=? AND role_id=?",(c,target,rid))
   self._invalidate(c); self.log(c,u,'custom_role.assign' if assign else 'custom_role.unassign',json.dumps({'role_id':rid,'subject_id':target}))
  return self.tx(run)
 def revoke_custom_role(self,u,c,rid):
  def run():
   self._admin(u,c); self._custom(c,rid)
   self.db.execute("UPDATE custom_roles SET active=0 WHERE id=? AND company_id=?",(rid,c))
   self._invalidate(c); self.log(c,u,'custom_role.revoke',rid)
  return self.tx(run)
 def list_custom_roles(self,u,c):
  self.require_member(u,c)
  return [dict(id=r[0],name=r[1],kind=r[2],grants=json.loads(r[3]),active=bool(r[4])) for r in self.db.execute("SELECT id,name,kind,grants,active FROM custom_roles WHERE company_id=? ORDER BY id",(c,))]
 def register_bot(self,u,c,bot_id,name):
  # Internal agent2 adapter; never trust a client-provided kind or create a human login.
  def run():
   self._admin(u,c)
   self.db.execute("INSERT INTO members VALUES(?,?,?,1,1,?,?)",(c,bot_id,'member',name,'bot'))
   self.log(c,u,'bot.register',bot_id)
  return self.tx(run)
 def set_role(self,u,c,target,role):
  if self._member(target,c)[3]!='person' and role is not None: raise Forbidden("bot cannot hold human role")
  return super().set_role(u,c,target,role)
 def remove(self,u,c,target):
  self.set_role(u,c,target,None)
 def commit_authorized(self,u,c,revision,permission,operation):
  def run():
   self.require_member(u,c,revision,permission)
   return operation(self.db)
  return self.tx(run)
 def commit_dns(self,authorizing_admin,c,revision,operation):
  def run():
   self._admin(authorizing_admin,c)
   self.require_member(authorizing_admin,c,revision,'dns.commit')
   self.log(c,authorizing_admin,'dns.commit.authorized',c)
   return operation(self.db)
  return self.tx(run)

 def directory(self,u,c):
  def run():
   self.require_member(u,c)
   return [dict(id=r[0],name=r[1],kind=r[2]) for r in self.db.execute("SELECT user_id,name,kind FROM members WHERE company_id=? AND active=1 ORDER BY user_id",(c,))]
  return self.tx(run)
 
 def invite(self,u,c,target,role='member',ttl=86400):
  if ttl<=0 or ttl>604800: raise ValueError("invite ttl")
  def run():
   self.require_member(u,c,permission='invites.manage')
   old=self.db.execute("SELECT kind FROM members WHERE company_id=? AND user_id=?",(c,target)).fetchone()
   if old and old[0]!='person': raise Forbidden("bots cannot accept human invitations")
   rid=None
   if role not in {'admin','member'}:
    r=self.db.execute("SELECT id FROM custom_roles WHERE company_id=? AND (id=? OR name=?) AND kind='person' AND active=1",(c,role,role)).fetchall()
    if len(r)!=1: raise ValueError("custom human role unavailable or ambiguous")
    rid=r[0][0]
   token=secrets.token_urlsafe(32); i=str(uuid.uuid4())
   self.db.execute("INSERT INTO invites VALUES(?,?,?,?,?,?,?)",(i,c,target,'member' if rid else role,hashlib.sha256(token.encode()).hexdigest(),time.time()+ttl,'pending'))
   if rid: self.db.execute("INSERT INTO invite_roles VALUES(?,?)",(i,rid))
   self.log(c,u,'invite',i); return i,token
  return self.tx(run)
 def accept(self,u,token,name):
  def run():
   r=self.db.execute("SELECT id,company_id,user_id,role,expires,state FROM invites WHERE hash=?",(hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
   if not r or r[2]!=u or r[4]<=time.time() or r[5]!='pending': raise Forbidden('invite unavailable')
   old=self.db.execute("SELECT active,kind FROM members WHERE company_id=? AND user_id=?",(r[1],u)).fetchone()
   if old and (old[0] or old[1]!='person'): raise Forbidden('invalid invite subject')
   custom=self.db.execute("SELECT role_id FROM invite_roles WHERE invite_id=?",(r[0],)).fetchone()
   if custom: self._custom(r[1],custom[0])
   self.db.execute("INSERT INTO members VALUES(?,?,?,1,1,?,?) ON CONFLICT(company_id,user_id) DO UPDATE SET role=excluded.role,active=1,revision=members.revision+1,name=excluded.name",(r[1],u,r[3],name,'person'))
   self.db.execute("DELETE FROM role_assignments WHERE company_id=? AND subject_id=?",(r[1],u))
   if custom: self.db.execute("INSERT INTO role_assignments VALUES(?,?,?)",(r[1],u,custom[0]))
   self.db.execute("UPDATE invites SET state='accepted' WHERE id=?",(r[0],))
   self.log(r[1],u,'accept',r[0]); return self.effective(u,r[1])
  return self.tx(run)
