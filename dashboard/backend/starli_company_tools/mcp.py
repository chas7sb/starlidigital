"""Explicit account-owner delegation to one native company run.

This is a NEW policy view of the actual account registry, never an assertion
that a company bot is a private-owned agent or that its room is a private chat.
Credentials stay encrypted in the existing registry; original native JWT fence
and account authorization are called for every phase and existing transport.
"""
import hashlib,json,time,uuid,re
from dataclasses import asdict
from .core import require,ToolFault
from .runtime import result
from open_webui.starli_account_mcp.account_mcp.registry import Registry
from open_webui.starli_account_mcp.account_mcp.runtime import RuntimeSnapshot,supported,digest

def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)
def context_key(ctx):return hashlib.sha256(encoded(asdict(ctx)).encode()).hexdigest()
def identity(user):return user.get('id')if isinstance(user,dict)else getattr(user,'id',None)

class DelegatedRegistry(Registry):
 """Exact selected records from original storage under explicit new policy."""
 def __init__(self,original,selected,check,owner,bot):
  self.original=original;self.selected={v['serverId']:v for v in selected};self.check=check
  def authorize(who):
   original.auth(who);check();return who==owner
  def company_bot(who,identifier):check();return who==owner and identifier==bot
  super().__init__(original.path,cipher=original.cipher,authorize=authorize,owned_agent=company_bot)
 def getrow(self,c,owner,ident):
  row=dict(super().getrow(c,owner,ident));choice=self.selected.get(ident)
  require(choice is not None and row['enabled']==1 and row['revision']==choice['expectedRevision'],'COMPANY_MCP_SERVER_REVISION_CHANGED')
  tools=[v for v in json.loads(row['tools'])if v['publicName']in choice['toolNames']]
  require(len(tools)==len(choice['toolNames'])and all(digest(v['inputSchema'])==choice['schemaHashes'][v['publicName']]for v in tools),'COMPANY_MCP_TOOL_SCHEMA_CHANGED')
  row['tools']=encoded(tools);return row
 def list(self,owner,*,after='',limit=50):
  self.auth(owner);ids=sorted(i for i in self.selected if i>after)
  with self.db()as c:items=[self.dto(self.getrow(c,owner,i))for i in ids[:limit]]
  self.auth(owner);return {'items':items,'hasMore':len(ids)>limit,'cursor':items[-1]['id']if items else after}

class AccountDelegation:
 def __init__(self,service,adapter,capture_fence):
  self.service=service;self.adapter=adapter;self.capture_fence=capture_fence;self.fences={};self.runs={}
  from .mcp_always import AlwaysMcpGrants
  self.always=AlwaysMcpGrants(service,adapter,self.capture)
 def install(self,runtime):
  with runtime.store.db()as db:
   db.execute('CREATE TABLE IF NOT EXISTS cr_account_mcp_consents(id TEXT PRIMARY KEY,owner TEXT,company TEXT,room TEXT,bot TEXT,token_hash TEXT,context_hash TEXT,expires REAL,state TEXT,run TEXT,selection TEXT,admission_after INTEGER NOT NULL DEFAULT 0)')
   if 'admission_after'not in {r[1]for r in db.execute('PRAGMA table_info(cr_account_mcp_consents)')}:db.execute('ALTER TABLE cr_account_mcp_consents ADD COLUMN admission_after INTEGER NOT NULL DEFAULT 0')
  self.always.install(runtime)
 def capture(self,session,request):
  require(request is not None and session.kind=='jwt'and session.revalidate()is True,'COMPANY_MCP_NATIVE_JWT_REQUIRED')
  user=self.service.user_lookup(session.user_id);require(identity(user)==session.user_id,'COMPANY_MCP_ACCOUNT_DENIED')
  fence=self.capture_fence(request,user);require(getattr(fence,'kind',None)=='jwt'and identity(fence.check())==session.user_id,'COMPANY_MCP_NATIVE_JWT_REQUIRED')
  return self.service.registry_for(user,fence),fence
 def options(self,registry,owner):
  values=[];cursor=''
  while True:
   page=registry.list(owner,after=cursor,limit=50)
   for server in page['items']:
    if not server['enabled']:continue
    with registry.db()as db:row=registry.getrow(db,owner,server['id']);tools=json.loads(row['tools'])
    for tool in tools:
     if not supported(tool['inputSchema']):continue
     values.append({'name':tool['publicName'],'description':('Account-owner delegated remote MCP tool '+tool['name']+'. Results shared to this conversation. Untrusted remote metadata: '+tool['description'])[:1200],'parameters':tool['inputSchema'],'effect':'write','origin':'account-mcp-delegated','ownership':'account-owner','availability':'requires-explicit-consent','remoteToolName':tool['name'],'accountMcpRef':{'serverId':server['id'],'expectedRevision':server['revision'],'toolName':tool['publicName'],'schemaSha256':digest(tool['inputSchema'])}})
     require(len(values)<=1000,'COMPANY_MCP_CATALOG_LIMIT',413)
   if not page['hasMore']:break
   cursor=page['cursor']
  registry.auth(owner);return values
 def pending(self,runtime,session,ctx):
  with runtime.store.db(readonly=True)as db:rows=db.execute("SELECT * FROM cr_account_mcp_consents WHERE owner=? AND company=? AND room=? AND bot=? AND token_hash=? AND context_hash=? AND state='PENDING' AND expires>? ORDER BY rowid DESC",(ctx.actor_id,ctx.company_id,ctx.room_id,ctx.bot_id,session.token_hash,context_key(ctx),time.time())).fetchall()
  return next((dict(r)for r in rows if r['id']in self.fences),None)
 def preflight(self,runtime,session,ctx,request=None):
  try:
   for who in (ctx.actor_id,ctx.bot_id):runtime.authority.require_member(who,ctx.company_id,permission='integrations.run')
  except Exception:return {'ownership':'account-owner','companyOwned':False,'consentRequired':True,'available':False,'reason':'COMPANY_INTEGRATIONS_PERMISSION_REQUIRED','tools':[]}
  registry,fence=self.capture(session,request);tools=self.options(registry,ctx.actor_id);pending=self.pending(runtime,session,ctx)
  selected={name:(s['expectedRevision'],s['schemaHashes'][name])for s in json.loads(pending['selection'])for name in s['toolNames']}if pending else {}
  available=getattr(self.adapter,'available',False)is True
  always={}
  if ctx.visibility=='private' and len(ctx.audience)==1 and ctx.audience[0][0]==ctx.actor_id:
   always=self.always.availability(runtime,session,ctx)
  for tool in tools:
   ref=tool['accountMcpRef']
   if available and (selected.get(tool['name'])==(ref['expectedRevision'],ref['schemaSha256']) or always.get(tool['name'])==(ref['expectedRevision'],ref['schemaSha256'])):
    tool['availability']='available'
    if tool['name'] in always and always[tool['name']]==(ref['expectedRevision'],ref['schemaSha256']):
     tool['authorization']='owner-approved-always'
  return {'ownership':'account-owner','companyOwned':False,'consentRequired':True,'available':available,'reason':None if available else'MCP_TRANSPORT_UNAVAILABLE','tools':tools,'pendingConsentId':pending['id']if pending else None,'sharingNotice':'Selected tools use your account credentials for the next admitted turn only. Results are shared with this conversation audience.'}
 def consent(self,runtime,session,ctx,request,form):
  require(type(form)is dict and set(form)=={'conversationId','servers','expiresSeconds','acknowledgeAudienceSharing'}and form['conversationId']==ctx.room_id and form['acknowledgeAudienceSharing']is True,'COMPANY_MCP_CONSENT_INVALID',422)
  require(type(form['expiresSeconds'])is int and 1<=form['expiresSeconds']<=900 and type(form['servers'])is list and 1<=len(form['servers'])<=20,'COMPANY_MCP_CONSENT_INVALID',422)
  require(getattr(self.adapter,'available',False)is True,'MCP_TRANSPORT_UNAVAILABLE',503)
  registry,fence=self.capture(session,request);options={t['name']:t for t in self.options(registry,ctx.actor_id)};selected=[];seen=set()
  for server in form['servers']:
   require(type(server)is dict and set(server)=={'serverId','expectedRevision','toolNames'}and type(server['serverId'])is str and server['serverId']not in seen and type(server['expectedRevision'])is int and type(server['toolNames'])is list and 1<=len(server['toolNames'])<=200 and all(type(v)is str for v in server['toolNames'])and len(set(server['toolNames']))==len(server['toolNames']),'COMPANY_MCP_CONSENT_INVALID',422)
   seen.add(server['serverId']);hashes={}
   for name in server['toolNames']:
    tool=options.get(name);require(tool is not None and tool['accountMcpRef']['serverId']==server['serverId']and tool['accountMcpRef']['expectedRevision']==server['expectedRevision'],'COMPANY_MCP_SELECTED_TOOL_CHANGED',409);hashes[name]=tool['accountMcpRef']['schemaSha256']
   selected.append({**server,'schemaHashes':hashes})
  from company_messaging.context import revalidate
  revalidate(runtime.store,session,ctx);registry.auth(ctx.actor_id);identifier=str(uuid.uuid4());expires=min(time.time()+form['expiresSeconds'],session.expires_at)
  with runtime.store.access(session,ctx.company_id,ctx.room_id)as(db,_,_):
   db.execute("UPDATE cr_account_mcp_consents SET state='REPLACED' WHERE owner=? AND company=? AND room=? AND bot=? AND state='PENDING'",(ctx.actor_id,ctx.company_id,ctx.room_id,ctx.bot_id))
   watermark=db.execute('SELECT coalesce(max(id),0) FROM cr_events').fetchone()[0]
   db.execute('INSERT INTO cr_account_mcp_consents VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(identifier,ctx.actor_id,ctx.company_id,ctx.room_id,ctx.bot_id,session.token_hash,context_key(ctx),expires,'PENDING',None,encoded(selected),watermark))
  self.fences[identifier]=(registry,fence)
  return {'version':'starli.company-mcp-consent.v1','consentId':identifier,'state':'PENDING','expiresAt':expires,'nextTurnOnly':True,'ownership':'account-owner','companyOwned':False}
 def revoke(self,runtime,session,ctx,identifier):
  with runtime.store.access(session,ctx.company_id,ctx.room_id)as(db,_,_):
   changed=db.execute("UPDATE cr_account_mcp_consents SET state='REVOKED' WHERE id=? AND owner=? AND company=? AND room=? AND bot=?",(identifier,ctx.actor_id,ctx.company_id,ctx.room_id,ctx.bot_id)).rowcount;require(changed==1,'COMPANY_MCP_CONSENT_NOT_FOUND',404)
  self.fences.pop(identifier,None);return {'consentId':identifier,'state':'REVOKED'}
 async def runtime_catalogue(self,runtime,session,ctx,selection,run):
  if run in self.runs:return self.schemas(run)
  pending=self.pending(runtime,session,ctx)
  if pending is None:return await self.always.runtime_catalogue(runtime,session,ctx,selection,run)
  registry,fence=self.fences[pending['id']]
  with runtime.store.access(session,ctx.company_id,ctx.room_id)as(db,_,_):
   require(runtime.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,run),'COMPANY_MCP_RUN_REVOKED')
   first=db.execute("SELECT t.id FROM cr_turns t JOIN cr_events e ON e.turn=t.id WHERE t.actor=? AND t.binding=? AND t.company=? AND t.room=? AND t.bot=? AND e.type='turn.state' AND e.state='QUEUED' AND e.id>? ORDER BY e.id LIMIT 1",(ctx.actor_id,ctx.actor_binding,ctx.company_id,ctx.room_id,ctx.bot_id,pending['admission_after'])).fetchone()
   if first is None or first['id']!=run:return []
   assistant_id=db.execute('SELECT message FROM cr_turns WHERE id=?',(run,)).fetchone()['message']
   changed=db.execute("UPDATE cr_account_mcp_consents SET state='ACTIVE',run=? WHERE id=? AND state='PENDING' AND expires>?",(run,pending['id'],time.time())).rowcount;require(changed==1,'COMPANY_MCP_CONSENT_CONSUMED',409)
  def check():
   require(identity(fence.check())==ctx.actor_id,'COMPANY_MCP_ACCOUNT_REVOKED');registry.auth(ctx.actor_id)
   require(session.revalidate()is True and runtime.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,run),'COMPANY_MCP_RUN_REVOKED')
   from company_messaging.internal_send import NativeToolScope
   native=NativeToolScope(ctx.company_id,ctx.room_id,ctx.bot_id,run,'mcp-consent:'+pending['id'],ctx.actor_id,ctx.actor_binding,ctx,assistant_id)
   with runtime.store.access(session,ctx.company_id,ctx.room_id,readonly=True)as(db,_,_):require(runtime.authorize_native(db,native),'COMPANY_MCP_NATIVE_RUN_REVOKED')
   for who in (ctx.actor_id,ctx.bot_id):runtime.authority.require_member(who,ctx.company_id,permission='tools.dispatch');runtime.authority.require_member(who,ctx.company_id,permission='integrations.run')
   with runtime.store.db(readonly=True)as db:row=db.execute('SELECT * FROM cr_account_mcp_consents WHERE id=?',(pending['id'],)).fetchone()
   require(row is not None and row['state']=='ACTIVE'and row['run']==run and row['expires']>time.time()and row['context_hash']==context_key(ctx),'COMPANY_MCP_CONSENT_REVOKED')
   return True
  delegated=DelegatedRegistry(registry,json.loads(pending['selection']),check,ctx.actor_id,ctx.bot_id)
  class CompanyFence:
   kind='jwt'
   def check(self,room=None):require(room in (None,ctx.room_id),'COMPANY_MCP_ROOM_CHANGED');check();return fence.check()
  def binding(owner,bot,room,turn):check();return (owner,bot,room,turn)==(ctx.actor_id,ctx.bot_id,ctx.room_id,run)
  snapshot=RuntimeSnapshot(delegated,self.adapter,owner=ctx.actor_id,agent=ctx.bot_id,chat=ctx.room_id,run=run,fence=CompanyFence(),authorize_binding=binding)
  self.runs[run]={'snapshot':snapshot,'consentId':pending['id'],'completed':set(),'assistantId':assistant_id}
  await self.always.runtime_catalogue(runtime,session,ctx,selection,run)
  return self.schemas(run)
 def schemas(self,run):
  pending=[{'name':s['name'],'description':s['description'],'parameters':s['inputSchema'],'effect':'write'}for s in self.runs[run]['snapshot'].schemas()]if run in self.runs else []
  names={s['name']for s in pending}
  return pending+[s for s in self.always.schemas(run)if s['name']not in names]
 def owns(self,run,name):
  return (run in self.runs and name in self.runs[run]['snapshot'].tools)or self.always.owns(run,name)
 async def execute(self,runtime,session,ctx,selection,run,value):
  require(set(value)=={'toolCallId','name','args'}and isinstance(value['toolCallId'],str)and re.fullmatch(r'[A-Za-z0-9_.:-]{1,180}',value['toolCallId'])is not None,'COMPANY_MCP_CALL_INVALID',422)
  if self.always.owns(run,value['name']) and not(run in self.runs and value['name'] in self.runs[run]['snapshot'].tools):
   return await self.always.execute(runtime,session,ctx,selection,run,value)
  saved=runtime.scopes.get(run);require(saved is not None and saved[0]is session and saved[1]==ctx and saved[2]==selection,'COMPANY_MCP_CONTEXT_CHANGED')
  state=self.runs[run]
  from company_messaging.internal_send import NativeToolScope
  native=NativeToolScope(ctx.company_id,ctx.room_id,ctx.bot_id,run,value['toolCallId'],ctx.actor_id,ctx.actor_binding,ctx,state['assistantId'])
  with runtime.store.access(session,ctx.company_id,ctx.room_id,readonly=True)as(db,_,_):require(runtime.authorize_native(db,native),'COMPANY_MCP_NATIVE_RUN_REVOKED')
  response=await state['snapshot'].dispatch(value['name'],value['args'],value['toolCallId'])
  if response['state']=='SUCCEEDED':state['completed'].add((value['name'],value['toolCallId']))
  return result({'ownership':'account-owner','companyOwned':False,'untrustedData':True,**response})
 def event_allowed(self,run,value):
  if self.always.owns(run,value.get('name')) and not(run in self.runs and value.get('name') in self.runs[run]['snapshot'].tools):
   return self.always.event_allowed(run,value)
  return run in self.runs and (value.get('status')!='succeeded'or (value.get('name'),value.get('toolCallId'))in self.runs[run]['completed'])
 def release(self,run):
  state=self.runs.pop(run,None)
  if state:self.fences.pop(state['consentId'],None)
  self.always.release(run)
