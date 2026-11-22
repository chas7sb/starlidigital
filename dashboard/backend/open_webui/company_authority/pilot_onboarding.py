"""Explicit admin-selected pilot setup. Never selects a company implicitly."""
import hashlib,json,uuid
from . import Authority,Forbidden
class Conflict(Exception):pass
class Pilot:
 def __init__(self,path):self.path=path
 def _run(self,actor,key,payload,operation):
  if not isinstance(key,str) or not 1<=len(key)<=128:raise ValueError('idempotency key')
  a=Authority(self.path)
  try:
   a.db.execute("CREATE TABLE IF NOT EXISTS pilot_setup(actor TEXT,key TEXT,hash TEXT,company TEXT,result TEXT,PRIMARY KEY(actor,key))")
   digest=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
   def run():
    row=a.db.execute("SELECT hash,company,result FROM pilot_setup WHERE actor=? AND key=?",(actor,key)).fetchone()
    if row:
     if row[0]!=digest:raise Conflict('idempotency key reused')
     a._admin(actor,row[1])
     result=json.loads(row[2])
     if 'bot_id' in result:
      a.require_member(result['bot_id'],row[1],permission='bots.run')
      a.require_member(result['bot_id'],row[1],permission='messages.send')
      bot=a.db.execute("SELECT active FROM bots WHERE id=? AND kind='company' AND owner=?",(result['bot_id'],row[1])).fetchone()
      if not bot or bot[0]!=1:raise Forbidden('bot no longer available')
     return result
    result=operation(a)
    a.db.execute("INSERT INTO pilot_setup VALUES(?,?,?,?,?)",(actor,key,digest,result['company_id'],json.dumps(result)))
    return result
   return a.tx(run)
  finally:a.db.close()
 def company(self,actor,key,company_id=None,name=None):
  if bool(company_id)==bool(name):raise ValueError('select company OR explicitly create by name')
  def operation(a):
   if company_id:
    a._admin(actor,company_id);return dict(company_id=company_id)
   if not name.strip() or len(name)>100:raise ValueError('company name')
   company=str(uuid.uuid4())
   a.db.execute("INSERT INTO companies VALUES(?,?)",(company,name.strip()))
   a.db.execute("INSERT INTO members VALUES(?,?,?,1,1,?,?)",(company,actor,'owner',actor,'person'))
   a.log(company,actor,'create',company)
   return dict(company_id=company)
  return self._run(actor,key,dict(company_id=company_id,name=name),operation)
 def admit_bot(self,actor,company,bot,key):
  def operation(a):
   a._admin(actor,company)
   row=a.db.execute("SELECT name,active FROM bots WHERE id=? AND kind='company' AND owner=?",(bot,company)).fetchone()
   if not row or row[1]!=1:raise Forbidden('installed shared bot required')
   member=a.db.execute("SELECT kind,active FROM members WHERE company_id=? AND user_id=?",(company,bot)).fetchone()
   if member and (member[0]!='bot' or not member[1]):raise Forbidden('bot identity conflict or revoked membership')
   if not member:a.db.execute("INSERT INTO members VALUES(?,?,?,1,1,?,?)",(company,bot,'member',row[0],'bot'))
   rid=str(uuid.uuid4())
   a.db.execute("INSERT INTO custom_roles VALUES(?,?,?,?,?,1)",(rid,company,'Pilot admission '+rid,'bot',json.dumps(['bots.run','messages.send'])))
   a.db.execute("INSERT INTO role_assignments VALUES(?,?,?)",(company,bot,rid))
   for permission in ['bots.run','messages.send']:
    a.db.execute("INSERT INTO bot_grants VALUES(?,?,1) ON CONFLICT(bot,permission) DO UPDATE SET enabled=1",(bot,permission))
   a.db.execute("UPDATE bots SET revision=revision+1 WHERE id=?",(bot,))
   a._invalidate(company);a.log(company,actor,'pilot.bot.admit',bot)
   return dict(company_id=company,bot_id=bot)
  return self._run(actor,key,dict(company=company,bot=bot),operation)
