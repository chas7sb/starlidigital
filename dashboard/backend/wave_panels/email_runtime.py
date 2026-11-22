"""Native-only Email mixin. No public context, credentials, approval or send tool."""
import hashlib,json,re
from dataclasses import dataclass
from company_messaging.authority import require
from company_messaging.internal_send import NativeToolScope

TOOLS=('email.draft','email.review')
@dataclass(frozen=True)
class EmailCall:
 native_scope:NativeToolScope
 operation_id:str
 tool_name:str

def native_email_panel_receipt(native,operation,result):
 """Same canonical DTO as nativeEmailPanelReceipt; admitted/committed by this mixin."""
 ref=dict(scope='company',ownerId=native.company_id,kind='email',id=result['resourceId'])
 receipt=dict(version='starli.panel.receipt.v1',id=operation,ref=ref,revision=result['revision'],companyId=native.company_id,actorUserId=native.actor_id,botId=native.bot_id,conversationId=native.room_id,assistantMessageId=native.assistant_message_id,runId=native.run_id,toolCallId=native.tool_call_id)
 return dict(version='starli.panel.v1',action='open',type='resource.email',ref=ref,mode='docked',receipt=receipt)

class EmailRuntimeMixin:
 def __init__(self,*args,email_draft=None,email_review=None,**kwargs):
  self.email_draft=email_draft;self.email_review=email_review
  super().__init__(*args,**kwargs)
  with self.store.db() as db:
   db.execute('CREATE TABLE IF NOT EXISTS cr_email_calls(run TEXT,call TEXT,operation TEXT UNIQUE,fingerprint TEXT NOT NULL,state TEXT NOT NULL,assistant TEXT NOT NULL,receipt TEXT,PRIMARY KEY(run,call))')
 def email_fence(self,session,ctx,selection,turn):
  require(self.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,turn),403,'NATIVE_EMAIL_RUN_DENIED')
  for actor in (ctx.actor_id,ctx.bot_id):self.authority.require_member(actor,ctx.company_id,permission='tools.dispatch')
  return True
 def email_local(self,db,ctx):
  self.local_fence(db,ctx);authority=object.__new__(type(self.authority));authority.db=db
  for actor in (ctx.actor_id,ctx.bot_id):authority.require_member(actor,ctx.company_id,permission='tools.dispatch')
 async def tool_catalogue(self,session,ctx,selection,turn):
  tools=await super().tool_catalogue(session,ctx,selection,turn)
  try:
   self.email_fence(session,ctx,selection,turn)
   if self.email_draft:tools.append(dict(name='email.draft',description='Create or revise a structured company email draft. This never approves or sends email. Return the native Email Studio panel for human editing and review.',parameters={'type':'object','properties':{'resourceId':{'type':'string'},'expectedRevision':{'type':'integer','minimum':0},'document':{'type':'object'}},'required':['expectedRevision','document'],'additionalProperties':False},effect='write'))
   if self.email_review:tools.append(dict(name='email.review',description='Open the saved company email version for human review. This never approves or sends.',parameters={'type':'object','properties':{'resourceId':{'type':'string'},'expectedRevision':{'type':'integer','minimum':1}},'required':['resourceId','expectedRevision'],'additionalProperties':False},effect='read'))
  except Exception:pass
  return tools
 async def execute_tool(self,session,ctx,selection,turn,value):
  if not isinstance(value,dict) or value.get('name') not in TOOLS:return await super().execute_tool(session,ctx,selection,turn,value)
  require(set(value)=={'toolCallId','name','args'},403,'EMAIL_TOOL_ARGUMENTS_DENIED');name=value['name'];args=value['args'];call=value['toolCallId']
  require(isinstance(call,str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,180}',call),422,'INVALID_TOOL_CALL_ID')
  require(isinstance(args,dict) and type(args.get('expectedRevision')) is int,422,'EMAIL_REVISION_REQUIRED')
  if name=='email.draft':
   require(self.email_draft is not None and set(args)<= {'resourceId','expectedRevision','document'} and {'expectedRevision','document'}<=set(args) and isinstance(args['document'],dict),422,'EMAIL_DRAFT_ARGUMENTS_DENIED')
   require((args['expectedRevision']==0 and 'resourceId' not in args) or (args['expectedRevision']>=1 and isinstance(args.get('resourceId'),str)),422,'EMAIL_RESOURCE_REVISION_MISMATCH')
  else:require(self.email_review is not None and set(args)=={'resourceId','expectedRevision'} and args['expectedRevision']>=1 and isinstance(args['resourceId'],str),422,'EMAIL_REVIEW_ARGUMENTS_DENIED')
  self.email_fence(session,ctx,selection,turn);fingerprint=hashlib.sha256(json.dumps([name,args],sort_keys=True).encode()).hexdigest();operation=hashlib.sha256(json.dumps([ctx.company_id,turn,call]).encode()).hexdigest()
  with self.store.access(session,ctx.company_id,ctx.room_id) as (db,_,_):
   self.email_local(db,ctx);row=db.execute('SELECT message FROM cr_turns WHERE id=?',(turn,)).fetchone();require(row is not None,403,'EMAIL_RUN_UNAVAILABLE')
   native=NativeToolScope(ctx.company_id,ctx.room_id,ctx.bot_id,turn,call,ctx.actor_id,ctx.actor_binding,ctx,row['message']);require(self.authorize_native(db,native),403,'EMAIL_NATIVE_BINDING_DENIED')
   old=db.execute('SELECT * FROM cr_email_calls WHERE run=? AND call=?',(turn,call)).fetchone()
   if old:
    require(old['fingerprint']==fingerprint,409,'EMAIL_OPERATION_COLLISION');require(old['state']=='COMPLETED',409,'EMAIL_CALL_UNCERTAIN_NO_RETRY');return self.email_result(json.loads(old['receipt']))
   db.execute('INSERT INTO cr_email_calls VALUES(?,?,?,?,?,?,NULL)',(turn,call,operation,fingerprint,'INTENT',native.assistant_message_id))
  async def authorize():return self.email_fence(session,ctx,selection,turn)
  try:
   adapter=self.email_draft if name=='email.draft' else self.email_review
   result=await adapter(EmailCall(native,operation,name),args,authorize);await authorize()
   require(isinstance(result,dict) and result.get('companyId')==ctx.company_id and isinstance(result.get('resourceId'),str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}',result['resourceId']) and type(result.get('revision')) is int,503,'EMAIL_DOMAIN_RESULT_INVALID')
   require(result['revision']==args['expectedRevision']+(1 if name=='email.draft' else 0),503,'EMAIL_DOMAIN_REVISION_MISMATCH')
   panel=native_email_panel_receipt(native,operation,result)
   with self.store.access(session,ctx.company_id,ctx.room_id) as (db,_,_):
    self.email_local(db,ctx);require(self.authorize_native(db,native),403,'EMAIL_NATIVE_BINDING_DENIED')
    db.execute("UPDATE cr_email_calls SET state='COMPLETED',receipt=? WHERE run=? AND call=?",(json.dumps(panel),turn,call));self.store.event(db,ctx.room_id,'message.updated',native.assistant_message_id)
   return self.email_result(panel)
  except BaseException:
   with self.store.db() as db:db.execute("UPDATE cr_email_calls SET state='UNKNOWN' WHERE run=? AND call=? AND state='INTENT'",(turn,call))
   raise
 @staticmethod
 def email_result(panel):return {'outcome':'settled','result':{'content':[{'type':'text','text':json.dumps({'status':'COMPLETED','panel':panel})}],'panel':panel}}
 def tool_event(self,session,ctx,selection,turn,value):
  if value.get('name') not in TOOLS:return super().tool_event(session,ctx,selection,turn,value)
  self.email_fence(session,ctx,selection,turn);require(value.get('status') in ('started','succeeded','failed','uncertain'),403,'EMAIL_EVENT_INVALID');call=value.get('toolCallId');require(isinstance(call,str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,180}',call),422,'INVALID_TOOL_CALL_ID')
  with self.store.access(session,ctx.company_id,ctx.room_id) as (db,_,_):
   self.email_local(db,ctx);safe=dict(version='starli.tool.v1',toolCallId=call,publicToolName=value['name'],status={'started':'RUNNING','succeeded':'COMPLETED','failed':'FAILED','uncertain':'UNCERTAIN'}[value['status']])
   if value['status']=='succeeded':
    row=db.execute('SELECT state,receipt FROM cr_email_calls WHERE run=? AND call=?',(turn,call)).fetchone();require(row is not None and row['state']=='COMPLETED',503,'EMAIL_SUCCESS_WITHOUT_RECEIPT');safe['panel']=json.loads(row['receipt'])
   db.execute("INSERT INTO cr_events(turn,type,state)VALUES(?,'tool.lifecycle',?)",(turn,json.dumps(safe)))
 def project_email_panels(self,db,dto):
  if dto.get('deleted'):return {**dto,'panels':[]}
  panels=[json.loads(r['receipt']) for r in db.execute("SELECT receipt FROM cr_email_calls WHERE assistant=? AND state='COMPLETED' ORDER BY run,call",(dto['id'],))]
  existing=list(dto.get('panels') or []);keys={(p.get('type'),json.dumps(p.get('ref'),sort_keys=True),p.get('receipt',{}).get('id')) for p in existing}
  for panel in panels:
   key=(panel.get('type'),json.dumps(panel.get('ref'),sort_keys=True),panel.get('receipt',{}).get('id'))
   if key not in keys:existing.append(panel);keys.add(key)
  return {**dto,'panels':existing}

def bind_email_message_projection(store,runtime):
 """Install once after runtime admission. Existing message ACL runs before projection."""
 require(not getattr(store,'_email_projection_installed',False),409,'EMAIL_PROJECTION_ALREADY_INSTALLED')
 original=store.message_dto
 def projected(db,room,message):return runtime.project_email_panels(db,original(db,room,message))
 store.message_dto=projected;store._email_projection_installed=True
