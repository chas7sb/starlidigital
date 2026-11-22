import sys,json,base64,hashlib
sys.path[:0]=[sys.argv[1],sys.argv[2]]
from company_authority import Authority
from drive import Drive,LocalBlobs
q=json.load(sys.stdin);a=Authority(sys.argv[3]);a.db.execute('PRAGMA busy_timeout=250')
try:
 scope=a.require_member(q['actorId'],q['companyId'],permission=q.get('permission','read'))
 action=q['action']
 if action=='scope':result=scope
 elif action=='identity':
  row=a.db.execute('SELECT id,company,address,name,verified,active FROM email_identities WHERE id=? AND company=?',(q['id'],q['companyId'])).fetchone()
  if not row or not row[4] or not row[5]:raise ValueError('identity unavailable')
  result=dict(id=row[0],companyId=row[1],address=row[2],name=row[3],verified=True)
 elif action=='asset':
  a.db.close();a=None;blobs=LocalBlobs(sys.argv[4]);drive=Drive(sys.argv[3],Authority,blobs.write,blobs.read)
  try:
   with drive.access(q['actorId'],q['companyId']) as member:row=dict(drive.row(member,q['id']))
   data,mime=drive.content(q['actorId'],q['companyId'],q['id'],row['version'])
   if len(data)>512*1024:raise ValueError('preview asset exceeds limit')
   result=dict(companyId=q['companyId'],bytes=base64.b64encode(data).decode(),sha256=hashlib.sha256(data).hexdigest(),mimeType=mime,filename=row['title'])
  finally:drive.db.close()
 else:raise ValueError('operation')
 print(json.dumps({'ok':True,'result':result}))
except Exception:print(json.dumps({'ok':False}))
finally:
 if a:a.db.close()
