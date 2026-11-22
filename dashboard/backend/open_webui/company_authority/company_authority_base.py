import sqlite3, uuid, hashlib, secrets, time, json
class Forbidden(Exception): pass
class Authority:
 def __init__(self,path):
  self.db=sqlite3.connect(path,isolation_level=None,check_same_thread=False)
  self.db.executescript("""
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS members(company_id TEXT,user_id TEXT,role TEXT,active INTEGER,revision INTEGER,name TEXT,kind TEXT DEFAULT 'person',PRIMARY KEY(company_id,user_id));
  CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,company_id TEXT,user_id TEXT,role TEXT,hash TEXT UNIQUE,expires REAL,state TEXT);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,company_id TEXT,actor TEXT,action TEXT,target TEXT,at REAL);
  """)
 def tx(self,fn):
  self.db.execute("BEGIN IMMEDIATE")
  try:
   result=fn(); self.db.execute("COMMIT"); return result
  except BaseException:
   self.db.execute("ROLLBACK"); raise
 def log(self,c,u,a,t):
  self.db.execute("INSERT INTO audit(company_id,actor,action,target,at) VALUES(?,?,?,?,?)",(c,u,a,t,time.time()))
 def require_member(self,user_id,company_id,expected_revision=None,permission='read'):
  row=self.db.execute("SELECT role,active,revision FROM members WHERE company_id=? AND user_id=?",(company_id,user_id)).fetchone()
  allowed={'read','write','shared_bot.choose_provider'}
  if not row or not row[1] or (expected_revision is not None and row[2]!=expected_revision): raise Forbidden('membership')
  if permission not in allowed and not (permission in {'connections.manage','invites.manage','members.remove'} and row[0] in {'owner','admin'}) and not (permission=='owners.manage' and row[0]=='owner'): raise Forbidden('permission')
  return dict(company_id=company_id,user_id=user_id,role=row[0],membership_revision=row[2],contract_version=1)
 def create(self,u,name,display_name):
  def run():
   c=str(uuid.uuid4()); self.db.execute("INSERT INTO companies VALUES(?,?)",(c,name))
   self.db.execute("INSERT INTO members VALUES(?,?,?,1,1,?,?)",(c,u,'owner',display_name,'person')); self.log(c,u,'create',c); return c
  return self.tx(run)
 def list_companies(self,u):
  return self.db.execute("SELECT c.id,c.name,m.role,m.revision FROM companies c JOIN members m ON c.id=m.company_id WHERE m.user_id=? AND m.active=1",(u,)).fetchall()
 def switch(self,u,c): return self.require_member(u,c)
 def invite(self,u,c,target,role='member',ttl=86400):
  if role not in {'admin','member'} or ttl<=0: raise ValueError('invite')
  def run():
   self.require_member(u,c,permission='invites.manage')
   token=secrets.token_urlsafe(32); i=str(uuid.uuid4())
   self.db.execute("INSERT INTO invites VALUES(?,?,?,?,?,?,?)",(i,c,target,role,hashlib.sha256(token.encode()).hexdigest(),time.time()+ttl,'pending')); self.log(c,u,'invite',i); return i,token
  return self.tx(run)
 def accept(self,u,token,name):
  def run():
   r=self.db.execute("SELECT id,company_id,user_id,role,expires,state FROM invites WHERE hash=?",(hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
   if not r or r[2]!=u or r[4]<=time.time() or r[5]!='pending': raise Forbidden('invite unavailable')
   old=self.db.execute("SELECT active FROM members WHERE company_id=? AND user_id=?",(r[1],u)).fetchone()
   if old and old[0]: raise Forbidden('already member')
   self.db.execute("INSERT INTO members VALUES(?,?,?,1,1,?,?) ON CONFLICT(company_id,user_id) DO UPDATE SET role=excluded.role,active=1,revision=members.revision+1,name=excluded.name",(r[1],u,r[3],name,'person'))
   self.db.execute("UPDATE invites SET state='accepted' WHERE id=?",(r[0],)); self.log(r[1],u,'accept',r[0]); return self.require_member(u,r[1])
  return self.tx(run)
 def revoke(self,u,c,i):
  def run():
   self.require_member(u,c,permission='invites.manage'); self.db.execute("UPDATE invites SET state='revoked' WHERE id=? AND company_id=? AND state='pending'",(i,c)); self.log(c,u,'revoke',i)
  return self.tx(run)
 def set_role(self,u,c,target,role):
  if role not in {'owner','admin','member',None}: raise ValueError('role')
  def run():
   current=self.db.execute("SELECT role FROM members WHERE company_id=? AND user_id=? AND active=1",(c,target)).fetchone()
   if not current: raise Forbidden('target')
   self.require_member(u,c,permission='owners.manage' if current[0] in {'owner','admin'} or role in {'owner','admin'} else 'members.remove')
   owners=self.db.execute("SELECT count(*) FROM members WHERE company_id=? AND active=1 AND role='owner'",(c,)).fetchone()[0]
   if current[0]=='owner' and role!='owner' and owners<=1: raise Forbidden('last owner')
   self.db.execute("UPDATE members SET role=?,active=?,revision=revision+1 WHERE company_id=? AND user_id=?",(role or current[0],int(role is not None),c,target)); self.log(c,u,'role' if role else 'remove',target)
   if role is None and self.db.execute("SELECT 1 FROM sqlite_master WHERE name='role_assignments'").fetchone(): self.db.execute("DELETE FROM role_assignments WHERE company_id=? AND subject_id=?",(c,target))
  return self.tx(run)
 def directory(self,u,c):
  self.require_member(u,c)
  return [dict(id=r[0],name=r[1],kind=r[2]) for r in self.db.execute("SELECT user_id,name,kind FROM members WHERE company_id=? AND active=1 ORDER BY user_id",(c,))]
 def resolve_recipient(self,u,c,query):
  rows=self.directory(u,c)
  exact=[r for r in rows if r['id']==query]
  found=exact or [r for r in rows if r['name'].strip().casefold()==query.strip().casefold()]
  return dict(status='resolved' if len(found)==1 else 'ambiguous' if found else 'not_found',candidates=found,contract_version=1)
 def commit_as_member(self,u,c,revision,operation):
  # operation must use this same database transaction for durable side effects.
  def run():
   self.require_member(u,c,revision); return operation(self.db)
  return self.tx(run)
