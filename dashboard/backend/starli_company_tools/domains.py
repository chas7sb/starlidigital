"""Adapters to actual company Drive7, native internal send and public research."""
import base64,hashlib,json,time,uuid
from contextlib import contextmanager
from dataclasses import dataclass
from .core import ToolSpec,ToolFault,require,obj,ID,REV
def commit_fence(d,bound,permission):
 """Drive main=authority, attached native_messaging=room/run DB. No nested txn."""
 ctx=bound.context;runtime=bound.runtime;saved=runtime.scopes.get(bound.run_id)
 require(saved is not None and saved[0]is bound.session and saved[1]==ctx and saved[2]==bound.selection,'COMPANY_TOOL_CONTEXT_CHANGED')
 require(bound.session.expires_at>time.time() and bound.session.revalidate()is True,'COMPANY_TOOL_SESSION_REVOKED')
 authority=d.authority_class.__new__(d.authority_class);authority.db=d.db
 for who in (ctx.actor_id,ctx.bot_id):
  authority.require_member(who,ctx.company_id,permission='bots.run');authority.require_member(who,ctx.company_id,permission='tools.dispatch');authority.require_member(who,ctx.company_id,permission=permission)
 member=d.member(ctx.actor_id,ctx.company_id);require(member['binding']==ctx.actor_binding,'COMPANY_TOOL_MEMBERSHIP_CHANGED')
 room=d.channel(member,ctx.room_id);require(room['revision']==ctx.room_revision and room['visibility']==ctx.visibility,'COMPANY_TOOL_AUDIENCE_CHANGED')
 require(d.db.execute('SELECT 1 FROM native_messaging.cm_agents WHERE room=? AND agent=?',(ctx.room_id,ctx.bot_id)).fetchone()is not None,'COMPANY_TOOL_BOT_REMOVED')
 if ctx.visibility=='private':
  audience=[]
  for row in d.db.execute('SELECT user,binding FROM native_messaging.cm_members WHERE room=? AND active=1 ORDER BY user',(ctx.room_id,)):
   try:person=d.member(row['user'],ctx.company_id)
   except PermissionError:continue
   if person['binding']==row['binding']:audience.append((row['user'],row['binding']))
  require(tuple(audience)==ctx.audience,'COMPANY_TOOL_AUDIENCE_CHANGED')
 turn=d.db.execute('SELECT * FROM native_messaging.cr_turns WHERE id=?',(bound.run_id,)).fetchone()
 require(turn is not None and (turn['company'],turn['room'],turn['bot'],turn['actor'],turn['binding'],turn['message'],turn['state'])==(ctx.company_id,ctx.room_id,ctx.bot_id,ctx.actor_id,ctx.actor_binding,bound.assistant_id,'RUNNING'),'COMPANY_TOOL_RUN_REVOKED')
 require((turn['provider'],turn['model'],turn['configuration_revision'])==(bound.selection['provider'],bound.selection['model'],bound.selection['configurationRevision']),'COMPANY_TOOL_CONFIGURATION_CHANGED')
 runtime.providers.check(bound.selection)
 return True
class DriveTools:
 def __init__(self,factory):self.factory=factory
 @contextmanager
 def drive(self,bound,permission='read'):
  bound.check();d=self.factory();original=d.access
  @contextmanager
  def fenced(*args,**kwargs):
   with original(*args,**kwargs)as member:
    commit_fence(d,bound,permission);yield member;commit_fence(d,bound,permission)
  d.access=fenced
  try:yield d
  finally:d.db.close()
 def visible(self,bound,row):require(row.get('channel')==bound.context.room_id,'COMPANY_TOOL_RESOURCE_AUDIENCE_DENIED');return row
 def listing(self,bound,args,kind=None,query=None):
  with self.drive(bound)as d:rows=d.browse(bound.context.actor_id,bound.context.company_id,recent=True,kind=kind,query=query)
  rows=[r for r in rows if r.get('channel')==bound.context.room_id]
  return {'companyId':bound.context.company_id,'conversationId':bound.context.room_id,'items':[{k:r[k]for k in ('id','kind','title','version','channel')}for r in rows[:100]],'scope':'explicitly-shared-to-current-conversation'}
 def get(self,bound,args,knowledge=False):
  ctx=bound.context
  with self.drive(bound)as d:
   with d.access(ctx.actor_id,ctx.company_id)as member:row=self.visible(bound,d.public(d.row(member,args['resourceId'])))
   require(row['kind']==('knowledge'if knowledge else'file'),'COMPANY_TOOL_RESOURCE_KIND_DENIED')
   if knowledge:return {'ref':ref(ctx,row),'revision':row['version'],'title':row['title'],'content':row['body'],'untrustedData':True}
   require(args['expectedRevision']==row['version'],'COMPANY_TOOL_REVISION_CONFLICT',409);data,mime=d.content(ctx.actor_id,ctx.company_id,row['id'],row['version']);require(len(data)<=65536,'COMPANY_TOOL_FILE_LIMIT',413)
   try:content=data.decode('utf-8')
   except UnicodeError:raise ToolFault('COMPANY_TOOL_UTF8_REQUIRED',415)
   require('\0'not in content,'COMPANY_TOOL_UTF8_REQUIRED',415);return {'ref':ref(ctx,row),'revision':row['version'],'title':row['title'],'mime':mime,'content':content,'untrustedData':True}
 def update(self,bound,args):
  ctx=bound.context
  with self.drive(bound,'files.manage')as d:
   original_row=d.row
   def scoped_row(member,rid,*args,**kwargs):
    row=original_row(member,rid,*args,**kwargs);self.visible(bound,d.public(row));return row
   d.row=scoped_row
   with d.access(ctx.actor_id,ctx.company_id)as member:row=self.visible(bound,d.public(d.row(member,args['resourceId'])))
   require(row['kind']=='knowledge','COMPANY_TOOL_RESOURCE_KIND_DENIED')
   try:changed=d.document(ctx.actor_id,ctx.company_id,row['id'],args['expectedRevision'],args['title'],args['content'])
   except ValueError:raise ToolFault('COMPANY_TOOL_REVISION_CONFLICT',409)from None
  return {'status':'SAVED','ref':ref(ctx,changed),'revision':changed['version']}
 def create(self,bound,args,kind='knowledge'):
  ctx=bound.context
  with self.drive(bound,'files.manage')as d:
   with d.access(ctx.actor_id,ctx.company_id,'write')as member:
    d.channel(member,ctx.room_id,'write');rid=str(uuid.uuid5(uuid.NAMESPACE_URL,ctx.company_id+':'+bound.run_id+':'+bound.call_id));require(d.db.execute('SELECT 1 FROM resource WHERE id=?',(rid,)).fetchone()is None,'COMPANY_TOOL_RESOURCE_COLLISION',409)
    d.db.execute('INSERT INTO resource(id,company,owner,kind,title,body,channel)VALUES(?,?,?,?,?,?,?)',(rid,ctx.company_id,ctx.actor_id,kind,args['title'],args['content'],ctx.room_id));d.db.execute('INSERT INTO drive_meta VALUES(?,NULL,0,?,?)',(rid,time.time(),member['binding']));row=d.row(member,rid);d.emit(row,kind+'.created');d.emit(row,'resource.share');out=d.public(row)
  return {'status':'SAVED','ref':ref(ctx,out),'revision':out['version']}
 def register(self,registry):
  def add(name,description,parameters,handler,effect='read'):registry.register(ToolSpec(name,description,parameters,effect,'company-drive',handler,'files.manage'if effect=='write'else'read'))
  add('company_files_list','List actual company resources explicitly shared to this conversation. Private personal files are excluded.',obj({}),self.listing)
  add('company_files_search','Find current-conversation shared resources by title.',obj({'query':{'type':'string','minLength':1,'maxLength':200}}),lambda b,a:self.listing(b,a,query=a['query']))
  add('company_file_read','Read bounded UTF-8 bytes of the exact company file revision shared to this conversation.',obj({'resourceId':ID,'expectedRevision':REV}),self.get)
  add('company_document_read','Read an actual company knowledge document explicitly shared to this conversation.',obj({'resourceId':ID}),lambda b,a:self.get(b,a,True))
  fields={'title':{'type':'string','minLength':1,'maxLength':240},'content':{'type':'string','maxLength':65536}}
  add('company_document_create','Create a real company knowledge document atomically shared to the current conversation.',obj(fields),self.create,'write')
  add('company_document_update','Save an owned company document shared here with expected-revision CAS. No silent overwrite.',obj({'resourceId':ID,'expectedRevision':REV,**fields}),self.update,'write')
  for name,kind in [('company_tasks_list','task'),('company_projects_list','project')]:add(name,'List actual '+kind+' records shared to this conversation; no account/global project access.',obj({}),lambda b,a,k=kind:self.listing(b,a,k))
  add('company_knowledge_search','Search actual knowledge titles shared to this conversation.',obj({'query':{'type':'string','minLength':1,'maxLength':200}}),lambda b,a:self.listing(b,a,'knowledge',a['query']))
def ref(ctx,row):return {'scope':'company','ownerId':ctx.company_id,'kind':row['kind'],'id':row['id']}
def register_messaging(registry):
 def directory(bound,args):
  from company_messaging.internal_send import directory
  bound.check();return directory(bound.runtime.store,bound.session,bound.context.company_id,args['query'])
 def send(bound,args):
  from company_messaging.internal_send import tool_send
  bound.check();return tool_send(bound.runtime.store,bound.session,bound.native_scope,args['recipientId'],args['content'])
 registry.register(ToolSpec('company_directory','Resolve actual current company members; ambiguity is returned, not guessed.',obj({'query':{'type':'string','minLength':1,'maxLength':100}}),'read','company-messaging',directory))
 registry.register(ToolSpec('company_message_send','Send as the admitted company bot through native recipient/source audience policy. SAVED is not a delivery claim.',obj({'recipientId':ID,'content':{'type':'string','minLength':1,'maxLength':20000}}),'write','company-messaging',send,'messages.send'))
@dataclass(frozen=True)
class CompanyResearchBinding:
 owner_native_id:str
 agent_id:str
 run_id:str
 company_id:str
 conversation_id:str
def register_research(registry,search,user_lookup):
 for schema in search.schemas():
  if schema['name']in registry.specs:continue
  async def execute(bound,args,name=schema['name']):
   def fresh():
    bound.check();user=user_lookup(bound.context.actor_id);require(user is not None and getattr(user,'id',None)==bound.context.actor_id,'COMPANY_RESEARCH_NATIVE_USER_DENIED');return user
   user=fresh();scope=CompanyResearchBinding(bound.context.actor_id,bound.context.bot_id,bound.run_id,bound.context.company_id,bound.context.room_id)
   return await search.dispatch(user,scope,name,args,bound.call_id,fresh)
  registry.register(ToolSpec(schema['name'],schema['description'],schema['inputSchema'],'read','public-research',execute,available=lambda name=schema['name']:any(s['name']==name for s in search.schemas())))
