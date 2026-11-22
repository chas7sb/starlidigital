"""Company-scoped native credential requests, encrypted intent and owned engine mapping."""
import hashlib,json,re,secrets,time,types
from types import SimpleNamespace
from starli_automations.common import need,Fault,encoded,digest
from .schema import VERSION,sha
class CompanyConnections:
 def __init__(self,gateway,catalog,api,vault,clock=time.time):
  self.gateway=gateway;self.store=gateway.store;self.catalog=catalog;self.api=api;self.vault=vault;self.clock=clock
  need(vault is not None,'BUSINESS_VAULT_KEY_REQUIRED',503)
  with self.store.db()as db:db.executescript('''CREATE TABLE IF NOT EXISTS ecc_connections(
   id TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,actor TEXT NOT NULL,binding TEXT NOT NULL,bot TEXT NOT NULL,assistant TEXT NOT NULL,
   run TEXT NOT NULL,call TEXT NOT NULL,type TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,name TEXT NOT NULL,
   schema_hash TEXT,secret BLOB,secret_revision INTEGER,engine_id TEXT,engine_name TEXT,created REAL NOT NULL,updated REAL NOT NULL,
   UNIQUE(company,run,call));
   CREATE UNIQUE INDEX IF NOT EXISTS ecc_owned_engine_id ON ecc_connections(engine_id) WHERE engine_id IS NOT NULL;''')
 def envelope(self,company,**data):return dict(version=VERSION,companyId=company,**data)
 def dto(self,row):return self.envelope(row['company'],id=row['id'],revision=row['revision'],status=row['state'],credentialType=row['type'],displayName=row['name'],schemaHash=row['schema_hash'],requestedByBotId=row['bot'],sourceConversationId=row['room'],conversationId=row['room'],assistantMessageId=row['assistant'],executionStatus='POLICY_REQUIRED')
 def row(self,db,ctx,ident):
  row=db.execute('SELECT * FROM ecc_connections WHERE id=? AND company=? AND room=?',(ident,ctx.company,ctx.room)).fetchone();need(row is not None,'COMPANY_CONNECTION_NOT_FOUND',404);return row
 def origin_fence(self,db,row):
  member=self.store.authority.require_member(row['actor'],row['company']);need(member.binding==row['binding'],'CONNECTION_ORIGIN_REVOKED')
  self.store.room(db,member,row['room']);self.store.agent(db,member,row['room'],row['bot'])
  self.gateway.permission(SimpleNamespace(company=row['company'],actor=row['actor'],bot=row['bot'],native_scope=None),db,'integrations.run')
 def types(self,ctx):
  with self.gateway.access(ctx,'integrations.install'):return self.envelope(ctx.company,items=self.catalog.listing())
 async def schema(self,ctx,kind):
  self.catalog.get(kind)
  with self.gateway.access(ctx,'integrations.install'):pass
  schema=await self.api.schema(kind)
  with self.gateway.access(ctx,'integrations.install'):
   return self.envelope(ctx.company,sourceConversationId=ctx.room,**self.catalog.form(kind,schema))
 def request(self,ctx,kind):
  meta=self.catalog.get(kind);scope=ctx.native_scope
  need(ctx.bot and ctx.room and scope is not None,'REQUESTING_NATIVE_BOT_REQUIRED')
  need(scope.assistant_message_id,'NATIVE_ASSISTANT_ORIGIN_REQUIRED')
  with self.gateway.access(ctx)as db:
   origin=db.execute('SELECT * FROM cm_messages WHERE id=? AND room=?',(scope.assistant_message_id,ctx.room)).fetchone()
   need(origin and origin['kind']=='agent'and origin['speaker']==ctx.bot and origin['run']==scope.run_id and not origin['deleted'],'NATIVE_ASSISTANT_ORIGIN_DENIED')
   old=db.execute('SELECT * FROM ecc_connections WHERE company=? AND run=? AND call=?',(ctx.company,scope.run_id,scope.tool_call_id)).fetchone()
   if old:need(old['type']==kind,'CONNECTION_REQUEST_IDEMPOTENCY_CONFLICT',409);return self.dto(old)
   ident=secrets.token_hex(16);now=self.clock();state='NEEDS_PLATFORM_APP'if self.catalog.oauth(kind)else'REQUESTED'
   db.execute('INSERT INTO ecc_connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,ctx.company,ctx.room,ctx.actor,ctx.binding,ctx.bot,scope.assistant_message_id,scope.run_id,scope.tool_call_id,kind,state,1,'',None,None,None,None,None,now,now))
   self.store.event(db,ctx.room,'message.updated',scope.assistant_message_id)
   return self.dto(self.row(db,ctx,ident))
 def get(self,ctx,ident):
  with self.gateway.access(ctx,'integrations.install')as db:
   row=self.row(db,ctx,ident);self.origin_fence(db,row);return self.dto(row)
 async def submit(self,ctx,ident,payload):
  need(ctx.bot is None and ctx.native_scope is None and ctx.session.kind=='jwt','HUMAN_CONNECTION_FORM_REQUIRED')
  need(type(payload)is dict and set(payload)=={'expectedRevision','schemaHash','displayName','data'},'CONNECTION_FORM_INVALID',422)
  need(type(payload['expectedRevision'])is int and type(payload['schemaHash'])is str and re.fullmatch('[a-f0-9]{64}',payload['schemaHash'])and type(payload['displayName'])is str and 1<=len(payload['displayName'].strip())<=160,'CONNECTION_FORM_INVALID',422)
  with self.gateway.access(ctx,'integrations.install')as db:
   row=dict(self.row(db,ctx,ident));self.origin_fence(db,row)
   need(row['state']=='REQUESTED'and row['revision']==payload['expectedRevision'],'CONNECTION_REVISION_OR_STATE_CHANGED',409)
  schema=await self.api.schema(row['type']);need(sha(schema)==payload['schemaHash'],'CREDENTIAL_SCHEMA_CHANGED',409)
  data=self.catalog.validate(row['type'],schema,payload['data']);revision=row['revision']+1;engine_name='Starli '+digest(ctx.company)[:12]+' '+ident+' r'+str(revision)
  sealed=self.vault.seal(ctx.company,ident+':'+str(revision),dict(type=row['type'],schemaHash=sha(schema),data=data))
  with self.gateway.access(ctx,'integrations.install')as db:
   fresh=self.row(db,ctx,ident);self.origin_fence(db,fresh);need(fresh['revision']==row['revision']and fresh['state']=='REQUESTED','CONNECTION_REVISION_OR_STATE_CHANGED',409)
   db.execute("UPDATE ecc_connections SET state='PROVISIONING',secret=?,secret_revision=?,schema_hash=?,engine_name=?,name=?,updated=? WHERE id=?",(sealed,revision,sha(schema),engine_name,payload['displayName'].strip(),self.clock(),ident))
  result=None
  try:
   # Exactly one POST after durable intent. Unknown outcome is never auto-retried.
   result=await self.api.create(row['type'],engine_name,data)
   need(type(result)is dict and type(result.get('id'))is str and re.fullmatch('[A-Za-z0-9_-]{1,128}',result['id'])and result.get('type')==row['type']and result.get('name')==engine_name,'ENGINE_CREDENTIAL_RECEIPT_INVALID',502)
   with self.gateway.access(ctx,'integrations.install')as db:
    fresh=self.row(db,ctx,ident);self.origin_fence(db,fresh);need(fresh['state']=='PROVISIONING'and fresh['revision']==row['revision'],'CONNECTION_CHANGED_DURING_PROVISION',409)
    db.execute("UPDATE ecc_connections SET state='STORED_NOT_VERIFIED',revision=?,engine_id=?,updated=? WHERE id=?",(revision,result['id'],self.clock(),ident));return self.dto(self.row(db,ctx,ident))
  except BaseException:
   with self.store.db()as db:
    # Preserve evidence even after authorization changes. Never restore a revoked state.
    private_id=result.get('id')if type(result)is dict and type(result.get('id'))is str and re.fullmatch('[A-Za-z0-9_-]{1,128}',result['id'])else None
    db.execute("UPDATE ecc_connections SET state=CASE WHEN state='PROVISIONING' THEN 'UNCERTAIN' ELSE state END,engine_id=COALESCE(engine_id,?),updated=? WHERE id=? AND company=?",(private_id,self.clock(),ident,ctx.company))
   raise Fault('CREDENTIAL_PROVISION_OUTCOME_UNCERTAIN',409)from None
 def revoke(self,ctx,ident,revision):
  need(ctx.bot is None and ctx.native_scope is None,'HUMAN_CONNECTION_FORM_REQUIRED')
  with self.gateway.access(ctx,'integrations.install')as db:
   row=self.row(db,ctx,ident);need(type(revision)is int and row['revision']==revision,'CONNECTION_REVISION_CONFLICT',409)
   db.execute("UPDATE ecc_connections SET state='REVOKED',revision=revision+1,updated=? WHERE id=?",(self.clock(),ident));return self.dto(self.row(db,ctx,ident))
 async def resolve(self,ctx,handle,credential_type,expected_revision):
  need(ctx.bot is not None and ctx.native_scope is not None,'NATIVE_EXECUTION_SCOPE_REQUIRED')
  with self.gateway.access(ctx)as db:
   row=db.execute('SELECT * FROM ecc_connections WHERE id=? AND company=?',(handle,ctx.company)).fetchone()
   need(row is not None,'COMPANY_CONNECTION_NOT_FOUND',404);row=dict(row)
   need(row['state']=='STORED_NOT_VERIFIED'and row['revision']==expected_revision and row['type']==credential_type,'COMPANY_CREDENTIAL_CHANGED',409)
  metadata=await self.api.metadata(row['engine_id'])
  need(type(metadata)is dict and metadata.get('id')==row['engine_id']and metadata.get('name')==row['engine_name']and metadata.get('type')==credential_type,'ENGINE_CREDENTIAL_OWNERSHIP_CHANGED',409)
  with self.gateway.access(ctx)as db:
   current=db.execute('SELECT * FROM ecc_connections WHERE id=? AND company=?',(handle,ctx.company)).fetchone()
   need(current is not None and current['state']=='STORED_NOT_VERIFIED'and current['revision']==expected_revision and current['engine_id']==row['engine_id'],'COMPANY_CREDENTIAL_CHANGED',409)
   return dict(credentialId=row['engine_id'],credentialName=row['engine_name'],credentialType=row['type'],companyId=ctx.company,connectionId=handle,revision=row['revision'],status=row['state'],schemaHash=row['schema_hash'],requestedByBotId=row['bot'],sourceConversationId=row['room'],scopes=[],scopeVerification='NOT_AVAILABLE')
 def recover(self):
  with self.store.db()as db:db.execute("UPDATE ecc_connections SET state='UNCERTAIN' WHERE state='PROVISIONING'")
 def install_projection(self):
  original=self.store.message_dto
  def project(store,db,room,message):
   dto=original(db,room,message);row=db.execute('SELECT * FROM ecc_connections WHERE room=? AND assistant=? ORDER BY created DESC LIMIT 1',(room,message)).fetchone()
   if row and not dto.get('deleted'):
    origin=db.execute('SELECT * FROM cm_messages WHERE id=? AND room=?',(message,room)).fetchone()
    if origin and origin['kind']=='agent'and origin['speaker']==row['bot']and origin['run']==row['run']and not origin['deleted']:
     dto['data']={**dto.get('data',{}),'starliCompanyConnection':dict(version=VERSION,kind='connection',companyId=row['company'],sourceConversationId=room,conversationId=room,requestingBotId=row['bot'],assistantMessageId=message,requestId=row['id'],credentialType=row['type'])}
   return dto
  self.store.message_dto=types.MethodType(project,self.store)
