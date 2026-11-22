"""Admin-only operator tool events. Never store secrets or raw outputs."""
import json,sqlite3,time,uuid
from open_webui.routers.starli_state import state_dir
def _db():
 root=state_dir();root.mkdir(parents=True,exist_ok=True,mode=0o700)
 c=sqlite3.connect(str(root/'operator-traces.sqlite'),timeout=5)
 c.execute("CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,owner TEXT,chat_id TEXT,task_id TEXT,created REAL,tool TEXT,status TEXT,arguments TEXT)")
 c.execute("CREATE INDEX IF NOT EXISTS owner_time ON events(owner,created)")
 return c
def _safe(args):
 if not isinstance(args,dict):return {}
 return {str(k)[:60]:('[redacted]' if any(x in str(k).lower() for x in ('token','password','secret','key','content','prompt','body','authorization')) else (str(v)[:180] if isinstance(v,(str,int,float,bool)) else '[structured]')) for k,v in list(args.items())[:12]}
def record(owner,tool,status,chat_id='',task_id='',args=None):
 try:
  ident=uuid.uuid4().hex
  with _db() as c:c.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",(ident,str(owner),str(chat_id or '')[:100],str(task_id or '')[:100],time.time(),str(tool)[:100],str(status)[:32],json.dumps(_safe(args))))
  return ident
 except Exception:return None
def recent(owner,chat_id=None,task_id=None,limit=100):
 where=['owner=?'];params=[str(owner)]
 if chat_id is not None:where.append('chat_id=?');params.append(str(chat_id))
 if task_id is not None:where.append('task_id=?');params.append(str(task_id))
 params.append(min(max(int(limit),1),200))
 with _db() as c:
  rows=c.execute("SELECT id,chat_id,task_id,created,tool,status,arguments FROM events WHERE "+' AND '.join(where)+" ORDER BY created DESC LIMIT ?",params).fetchall()
 return [dict(id=r[0],chatId=r[1],taskId=r[2],timestamp=r[3],tool=r[4],status=r[5],args=json.loads(r[6])) for r in rows]
