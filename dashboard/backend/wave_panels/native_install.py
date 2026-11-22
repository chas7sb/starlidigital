"""Native FastAPI assembly. No server startup, network calls or production writes."""
import inspect
from panel_api import create_router, VERSION, PanelError, ref

def snapshot(company,kind,rid,revision,value):
 r=ref(company,kind,rid)
 return dict(version=VERSION,scope='company',ownerId=company,ref=r,revision=revision,value=value,receipt=dict(version='starli.panel.receipt.v1',ref=r,revision=revision))

class SheetsPanelAdapter:
 manifest=dict(version=VERSION,type='resource.sheet',title='Sheets',scopes=['company'],capabilities=['read'],resourceKinds=['sheet'],editable=True)
 def __init__(self,factory):self.factory=factory
 def _call(self,method,actor,company,rid,*args):
  service=self.factory()
  try:return getattr(service,method)(actor,company,rid,*args)
  except Exception as error:
   # Keep actual domain exception types without importing a second sheets module.
   if type(error).__name__=='Denied':raise PermissionError('Workbook unavailable.') from error
   if type(error).__name__=='Conflict':raise PanelError(409,'REVISION_CONFLICT','Workbook changed. Reload before saving.') from error
   raise
  finally:service.db.close()
 def snapshot(self,actor,company,rid):
  result=self._call('get',actor,company,rid)
  return snapshot(company,'sheet',rid,result['revision'],result['snapshot'])
 def authorize(self,actor,company,rid):
  self.snapshot(actor,company,rid)
  return dict(version=VERSION,scope='company',ownerId=company,allowed=True)
 def edit(self,actor,company,rid,payload):
  if not isinstance(payload,dict) or set(payload)!={'expectedRevision','value'}:raise ValueError('invalid sheet edit')
  result=self._call('save',actor,company,rid,payload['expectedRevision'],payload['value'])
  # Return exactly the revision this request committed, not a racing later read.
  return snapshot(company,'sheet',rid,result['revision'],payload['value'])
 def events(self,actor,company,rid,after):
  current=self.snapshot(actor,company,rid);revision=current['revision'];r=current['ref']
  return dict(version=VERSION,scope='company',ownerId=company,ref=r,reset=True,cursor=revision,events=[dict(version='starli.panel.event.v1',type='resource.changed',ref=r,revision=revision,cursor=revision)] if revision>after else [])

class EmailPanelAdapter:
 """Trusted host RPC to existing Node Studio; no user-selected URL or credentials.
 rpc(operation, {actorId,companyId}, draft_id, payload) must synchronously invoke
 Studio.get/save using verified ctx and return its result; it must enforce its
 own fresh native authority too. No render/send/approve operation is exposed.
 """
 manifest=dict(version=VERSION,type='resource.email',title='Email Studio',scopes=['company'],capabilities=['read'],resourceKinds=['email'],editable=True)
 def __init__(self,rpc,authority_factory):self.rpc=rpc;self.authority_factory=authority_factory
 def _call(self,operation,actor,company,rid,payload=None):
  authority=self.authority_factory()
  try:
   authority.require_member(actor,company,permission='write' if operation=='save' else 'read')
   result=self.rpc(operation,dict(actorId=actor,companyId=company),rid,payload)
   if inspect.isawaitable(result):
    if hasattr(result,'close'):result.close()
    raise PanelError(503,'UNAVAILABLE','Synchronous email service binding required.')
   authority.require_member(actor,company,permission='write' if operation=='save' else 'read')
   if not isinstance(result,dict) or result.get('companyId')!=company or result.get('id')!=rid:raise PermissionError('Email scope could not be verified.')
   return result
  except Exception as error:
   if type(error).__name__=='Forbidden':raise PermissionError('Email unavailable.') from error
   raise
  finally:authority.db.close()
 def snapshot(self,actor,company,rid):
  result=self._call('get',actor,company,rid)
  return snapshot(company,'email',rid,result['revision'],result['document'])
 def authorize(self,actor,company,rid):
  self.snapshot(actor,company,rid)
  return dict(version=VERSION,scope='company',ownerId=company,allowed=True)
 def edit(self,actor,company,rid,payload):
  if not isinstance(payload,dict) or set(payload)!={'expectedRevision','value'}:raise ValueError('invalid email edit')
  result=self._call('save',actor,company,rid,dict(head=payload['expectedRevision'],document=payload['value']))
  return snapshot(company,'email',rid,result['revision'],result['document'])
 def events(self,actor,company,rid,after):
  current=self.snapshot(actor,company,rid);revision=current['revision'];r=current['ref']
  return dict(version=VERSION,scope='company',ownerId=company,ref=r,reset=True,cursor=revision,events=[dict(version='starli.panel.event.v1',type='resource.changed',ref=r,revision=revision,cursor=revision)] if revision>after else [])

def install_panels(app,*,verified_user,db_path,authority_class,drive_class,blob_write,blob_read,sheets_class=None,email_rpc=None,email_adapter=None,email_socket_path=None,email_secret_path=None,drive_factory=None):
 """Call once from native startup, with current native Authority and shared DB.
 Only creates factories/routes; schema init happens per domain request.
 Return mount/capability report so unavailable domains cannot be advertised.
 """
 if getattr(app.state,'starli_panels_installed',False):raise ValueError('Panels already installed')
 if (email_socket_path is None)!=(email_secret_path is None):raise ValueError('Email socket and secret paths are both required')
 if sum([email_rpc is not None,email_adapter is not None,email_socket_path is not None])>1:raise ValueError('Choose one email binding')
 if email_socket_path is not None:
  from email_socket_client import EmailStudioSocketRPC
  email_rpc=EmailStudioSocketRPC(email_socket_path,email_secret_path)
 adapters={}
 if sheets_class is not None:adapters['sheet']=SheetsPanelAdapter(lambda:sheets_class(db_path,authority_class))
 if email_adapter is not None:adapters['email']=email_adapter
 elif email_rpc is not None:adapters['email']=EmailPanelAdapter(email_rpc,lambda:authority_class(db_path))
 if drive_factory is not None and not callable(drive_factory):raise ValueError('Invalid native Drive factory')
 factory=drive_factory if drive_factory is not None else lambda:drive_class(db_path,authority_class,blob_write,blob_read)
 app.include_router(create_router(factory,verified_user,adapters))
 report=dict(version=VERSION,installed=['knowledge','task','project','file']+list(adapters),unavailable=[kind for kind in ['sheet','email'] if kind not in adapters],mounts=['/api/v1/panels/manifests','/api/v1/panels/company/{company}/{kind}/{rid}/{authorize|snapshot|edit|events}'])
 app.state.starli_panels_installed=report
 return report
