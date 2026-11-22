"""Native company panel API. Uses agent3 Drive and agent1 authority, no shadow resources."""
import json
import sqlite3

VERSION = 'starli.panel.v1'
POLICY = {
 'knowledge': ('resource.document', 'Documents', True),
 'task': ('resource.tasks', 'Tasks', False),
 'project': ('resource.project', 'Projects', False),
 'file': ('resource.file', 'Files', False),
}

class PanelError(Exception):
 def __init__(self, status, code, message):
  self.status,self.code,self.message=status,code,message

def ref(company,kind,rid):
 return dict(scope='company',ownerId=company,kind=kind,id=rid)

def manifests():
 return [dict(version=VERSION,type=t,title=title,scopes=['company'],capabilities=['read'],resourceKinds=[kind],editable=editable) for kind,(t,title,editable) in POLICY.items()]

class PanelService:
 def __init__(self,drive): self.drive=drive
 def _policy(self,kind):
  if kind not in POLICY: raise PanelError(404,'NOT_FOUND','Panel type unavailable.')
  return POLICY[kind]
 def _row(self,member,kind,rid):
  row=self.drive.row(member,rid)
  if row['kind']!=kind: raise PermissionError('resource unavailable')
  return row
 def snapshot(self,actor,company,kind,rid):
  self._policy(kind)
  with self.drive.access(actor,company) as member:
   row=self._row(member,kind,rid)
   value=self.drive.public(row)
   r=ref(company,kind,rid)
   return dict(version=VERSION,scope='company',ownerId=company,ref=r,revision=row['version'],value=value,receipt=dict(version='starli.panel.receipt.v1',ref=r,revision=row['version']))
 def edit(self,actor,company,kind,rid,payload):
  _,_,editable=self._policy(kind)
  if not editable: raise PanelError(405,'NOT_EDITABLE','This resource is read-only in panels.')
  if not isinstance(payload,dict) or set(payload)!={'expectedRevision','value'}: raise ValueError('invalid edit')
  value=payload['value']; revision=payload['expectedRevision']
  if type(revision) is not int or revision<1 or not isinstance(value,dict) or set(value)!={'title','body'}: raise ValueError('invalid edit')
  # Actual Drive.document transaction verifies files.manage and owner binding,
  # compares version, changes resource and writes domain event atomically.
  self.drive.document(actor,company,rid,revision,value['title'],value['body'])
  return self.snapshot(actor,company,kind,rid)
 def events(self,actor,company,kind,rid,after):
  self._policy(kind)
  if type(after) is not int or after<0: raise ValueError('invalid cursor')
  with self.drive.access(actor,company) as member:
   self._row(member,kind,rid)
   rows=self.drive.db.execute('SELECT cursor,version FROM event WHERE company=? AND resource=? AND cursor>? ORDER BY cursor LIMIT 200',(company,rid,after)).fetchall()
   r=ref(company,kind,rid)
   return dict(version=VERSION,scope='company',ownerId=company,ref=r,reset=True,cursor=rows[-1]['cursor'] if rows else after,events=[dict(version='starli.panel.event.v1',type='resource.changed',ref=r,revision=e['version'],cursor=e['cursor']) for e in rows])

def create_router(drive_factory,get_verified_user,domain_adapters=None):
 from fastapi import APIRouter, Depends, Request
 from fastapi.responses import JSONResponse
 from starlette.concurrency import run_in_threadpool
 # Trusted assembly-only adapters; each owns fresh ACL/CAS/events. Never loaded
 # from request data. Adapter exposes manifest and authorize/snapshot/edit/events.
 adapters=dict(domain_adapters or {})
 for kind,adapter in adapters.items():
  if kind in POLICY or adapter.manifest.get('resourceKinds')!=[kind] or adapter.manifest.get('version')!=VERSION:raise ValueError('invalid domain adapter')
 router=APIRouter()
 def response(value,status=200):return JSONResponse(value,status_code=status,headers={'Cache-Control':'no-store'})
 @router.get('/api/v1/panels/manifests')
 def catalog(user=Depends(get_verified_user)):
  return response(dict(version=VERSION,manifests=manifests()+[a.manifest for a in adapters.values()]))
 @router.api_route('/api/v1/panels/{scope}/{company}/{kind}/{rid}/{operation}',methods=['GET','POST'])
 async def dispatch(request:Request,scope:str,company:str,kind:str,rid:str,operation:str,user=Depends(get_verified_user)):
  try:
   if scope!='company':raise PanelError(403,'FORBIDDEN','Resource unavailable.')
   if operation not in ('authorize','snapshot','edit','events'):raise PanelError(404,'NOT_FOUND','Panel operation unavailable.')
   if request.method!=('GET' if operation in ('snapshot','events') else 'POST'):raise PanelError(405,'INVALID_REQUEST','Method unavailable.')
   chunks=[];size=0
   async for chunk in request.stream():
    size+=len(chunk)
    if size>131072:raise PanelError(400,'INVALID_REQUEST','Request exceeds 128 KiB.')
    chunks.append(chunk)
   payload=json.loads(b''.join(chunks)) if chunks and b''.join(chunks) else {}
   after=int(request.query_params.get('after','0'))
   def execute():
    if kind in adapters:
     adapter=adapters[kind]
     if operation=='authorize':return adapter.authorize(user.id,company,rid)
     if operation=='snapshot':return adapter.snapshot(user.id,company,rid)
     if operation=='edit':return adapter.edit(user.id,company,rid,payload)
     return adapter.events(user.id,company,rid,after)
    drive=drive_factory()
    try:
     service=PanelService(drive)
     if operation=='edit':return service.edit(user.id,company,kind,rid,payload)
     if operation=='events':return service.events(user.id,company,kind,rid,after)
     result=service.snapshot(user.id,company,kind,rid)
     return dict(version=VERSION,scope=scope,ownerId=company,allowed=True) if operation=='authorize' else result
    finally:drive.db.close()
   return response(await run_in_threadpool(execute))
  except PanelError as error:return response(dict(version=VERSION,error=dict(code=error.code,message=error.message,retryable=error.status==503)),error.status)
  except PermissionError:return response(dict(version=VERSION,error=dict(code='FORBIDDEN',message='Resource unavailable.',retryable=False)),403)
  except sqlite3.OperationalError:return response(dict(version=VERSION,error=dict(code='UNAVAILABLE',message='Panel service temporarily unavailable.',retryable=True)),503)
  except (ValueError,TypeError,KeyError) as error:
   conflict=str(error)=='version conflict'
   return response(dict(version=VERSION,error=dict(code='REVISION_CONFLICT' if conflict else 'INVALID_REQUEST',message='Resource changed. Reload before saving.' if conflict else 'Invalid panel request.',retryable=False)),409 if conflict else 400)
 return router
