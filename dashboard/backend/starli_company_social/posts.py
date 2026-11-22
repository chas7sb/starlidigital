"""Exact human-reviewed one-off Facebook text posts; no generated or raw media."""
import json,re,secrets,types,uuid
from .core import Context,VERSION,need,exact,digest,encoded,envelope
class CompanyPosts:
 def __init__(self,social):
  self.social=social;self.store=social.store
  with self.store.db()as db:db.executescript('''CREATE TABLE IF NOT EXISTS cs_posts(id TEXT PRIMARY KEY,company TEXT,room TEXT,bot TEXT,actor TEXT,binding TEXT,delegation TEXT,delegation_revision INTEGER,definition TEXT,hash TEXT,state TEXT,revision INTEGER,request_key TEXT,assistant TEXT,approver TEXT,approver_binding TEXT,activation TEXT,expires REAL,claimed INTEGER,receipt TEXT,UNIQUE(company,request_key));''')
 def row(self,db,ctx,ident,member):
  row=db.execute('SELECT * FROM cs_posts WHERE id=? AND company=?',(ident,ctx.company)).fetchone();need(row is not None,'POST_NOT_FOUND',404);self.store.room(db,member,row['room']);need(ctx.room is None or ctx.room==row['room'],'SOURCE_CONVERSATION_CHANGED',404);return row
 def dto(self,ctx,row,db):
  definition=json.loads(row['definition']);manage=False
  if ctx.bot is None:
   try:self.social.permission(ctx,db,'connections.manage');manage=True
   except Exception:pass
  return envelope(ctx.company,id=row['id'],postId=row['id'],sourceConversationId=row['room'],botId=row['bot'],revision=row['revision'],state=row['state'],reviewHash=row['hash'],definition=definition,receipt=json.loads(row['receipt'])if row['receipt']else None,actions={'canPublish':manage and row['state']=='DRAFT'and definition['platform']=='facebook'and self.social.node.ready},gate='INSTAGRAM_ONE_OFF_MEDIA_ADAPTER_REQUIRED'if definition['platform']=='instagram'else None)
 def propose(self,ctx,args,key):
  need(ctx.bot and ctx.room and ctx.native_scope,'BOT_NATIVE_PROPOSAL_REQUIRED');exact(args,('delegationId','platform','pageId','text'),('instagramAccountId','mediaRef'))
  need(args['platform']in('facebook','instagram')and type(args['text'])is str and 1<=len(args['text'])<=2200,'POST_INVALID',422)
  definition={k:v for k,v in args.items()if k!='delegationId'}
  with self.social.access(ctx,'integrations.run')as(db,member):
   delegation=self.social.delegation(db,ctx.company,args['delegationId']);self.social._page(delegation,definition)
   if definition['platform']=='facebook':need(not definition.get('mediaRef')and not definition.get('instagramAccountId'),'FACEBOOK_TEXT_ONLY_SUPPORTED',422)
   fingerprint=digest(dict(company=ctx.company,room=ctx.room,bot=ctx.bot,delegation=delegation['id'],revision=delegation['revision'],definition=definition))
   previous=db.execute('SELECT * FROM cs_posts WHERE company=? AND request_key=?',(ctx.company,key)).fetchone()
   if previous:need(previous['hash']==fingerprint,'POST_REQUEST_CONFLICT',409);return self.dto(ctx,previous,db)
   assistant=ctx.native_scope.assistant_message_id;origin=db.execute('SELECT * FROM cm_messages WHERE id=? AND room=?',(assistant,ctx.room)).fetchone();need(origin and origin['kind']=='agent'and origin['speaker']==ctx.bot and not origin['deleted'],'ASSISTANT_ORIGIN_CHANGED')
   ident=str(uuid.uuid4());db.execute("INSERT INTO cs_posts VALUES(?,?,?,?,?,?,?,?,?,?,'DRAFT',1,?,?,NULL,NULL,NULL,NULL,0,NULL)",(ident,ctx.company,ctx.room,ctx.bot,ctx.actor,ctx.binding,delegation['id'],delegation['revision'],encoded(definition),fingerprint,key,assistant))
   card=dict(version=VERSION,kind='post',companyId=ctx.company,sourceConversationId=ctx.room,postId=ident,platform=definition['platform'],requestingBotId=ctx.bot,assistantMessageId=assistant)
   raw=db.execute('SELECT data FROM message WHERE id=?',(assistant,)).fetchone();data=json.loads(raw[0]or'{}');data['starliSocialPost']=card;db.execute('UPDATE message SET data=? WHERE id=?',(encoded(data),assistant));db.execute('UPDATE cm_messages SET revision=revision+1 WHERE id=?',(assistant,));self.store.event(db,ctx.room,'message.updated',assistant)
   return self.dto(ctx,self.row(db,ctx,ident,member),db)
 def get(self,ctx,ident):
  with self.social.access(ctx)as(db,member):return self.dto(ctx,self.row(db,ctx,ident,member),db)
 async def publish(self,ctx,ident,form):
  exact(form,('sourceConversationId','expectedRevision','reviewedHash'));need(ctx.bot is None and ctx.native_scope is None and ctx.session.kind=='jwt','HUMAN_POST_REVIEW_REQUIRED')
  with self.social.access(ctx,'connections.manage')as(db,member):
   row=self.row(db,ctx,ident,member);need(row['room']==form['sourceConversationId']and row['revision']==form['expectedRevision']and row['hash']==form['reviewedHash']and row['state']=='DRAFT','POST_REVIEW_CHANGED',409)
   definition=json.loads(row['definition']);need(definition['platform']=='facebook','INSTAGRAM_ONE_OFF_MEDIA_ADAPTER_REQUIRED',409)
   delegation=self.social.delegation(db,ctx.company,row['delegation']);need(delegation['revision']==row['delegation_revision'],'POST_DELEGATION_CHANGED',409);page=self.social._page(delegation,definition)
   actor=Context(ctx.company,ctx.actor,ctx.binding,ctx.session,row['room'],row['bot']);self.social.permission(actor,db,'integrations.run');self.store.agent(db,member,row['room'],row['bot'])
   activation=secrets.token_hex(24);db.execute("UPDATE cs_posts SET state='SENDING',revision=revision+1,approver=?,approver_binding=?,activation=?,expires=?,claimed=0 WHERE id=?",(ctx.actor,ctx.binding,activation,self.social.clock()+90,ident))
   binding=dict(companyId=ctx.company,postId=ident,sourceConversationId=row['room'],ownerBotId=row['bot'],ownerId=delegation['legacy_owner'],delegationId=delegation['id'],delegationRevision=delegation['revision'],pageId=definition['pageId'],reviewHash=row['hash'],activationId=activation)
   ref=delegation['credential_ref'];command=dict(pageConnectionId=page['pageConnectionId'],caption=definition['text'],mediaRefs=[],idempotencyKey='native-post-'+ident+'-'+row['hash'][:16],expectedPageId=definition['pageId'])
   binding['commandDigest']=digest(command)
  try:
   value=await self.social.node.publish(ref,binding,command)
   need(value.get('companyId')==ctx.company and value.get('postId')==ident,'POST_RECEIPT_SCOPE_CHANGED',502)
   receipt=value.get('receipt');need(type(receipt)is dict and receipt.get('state')in('PUBLISHED','NOT_PUBLISHED','UNCERTAIN'),'POST_RECEIPT_INVALID',502)
   safe=dict(state=receipt['state'])
   if receipt.get('state')=='PUBLISHED':need(type(receipt.get('providerPostId'))is str and re.fullmatch('[0-9_]{1,100}',receipt['providerPostId']),'POST_RECEIPT_INVALID',502);safe['providerPostId']=receipt['providerPostId']
   with self.social.access(ctx,'connections.manage')as(db,member):
    current=self.row(db,ctx,ident,member);need(current['state']=='SENDING'and current['activation']==activation,'POST_CHANGED',409);db.execute('UPDATE cs_posts SET state=?,receipt=? WHERE id=?',(safe['state'],encoded(safe),ident));return self.dto(ctx,self.row(db,ctx,ident,member),db)
  except BaseException:
   with self.store.db()as db:db.execute("UPDATE cs_posts SET state='UNCERTAIN' WHERE id=? AND state='SENDING'",(ident,))
   raise
 def authorize(self,payload):
  exact(payload,('version','binding','effect','occurrenceId'));need(payload['effect']=='facebook.publish','POST_EFFECT_DENIED');b=payload['binding']
  with self.store.db()as db:
   row=db.execute('SELECT * FROM cs_posts WHERE id=? AND company=?',(b.get('postId'),b.get('companyId'))).fetchone();need(row and row['state']=='SENDING'and not row['claimed']and row['expires']>self.social.clock(),'POST_APPROVAL_UNAVAILABLE')
   definition=json.loads(row['definition']);delegation=self.social.delegation(db,row['company'],row['delegation'])
   page=self.social._page(delegation,definition)
   command=dict(pageConnectionId=page['pageConnectionId'],caption=definition['text'],mediaRefs=[],idempotencyKey='native-post-'+row['id']+'-'+row['hash'][:16],expectedPageId=definition['pageId'])
   expected=dict(companyId=row['company'],postId=row['id'],sourceConversationId=row['room'],ownerBotId=row['bot'],ownerId=delegation['legacy_owner'],delegationId=delegation['id'],delegationRevision=delegation['revision'],pageId=definition['pageId'],reviewHash=row['hash'],activationId=row['activation'],commandDigest=digest(command))
   need(b==expected and delegation['revision']==row['delegation_revision'],'POST_APPROVAL_CHANGED')
   member=self.store.authority.require_member(row['approver'],row['company']);need(member.binding==row['approver_binding'],'POST_APPROVER_REVOKED');self.store.room(db,member,row['room']);self.store.agent(db,member,row['room'],row['bot'])
   ctx=Context(row['company'],row['approver'],member.binding,None,row['room'],row['bot']);self.social.permission(Context(row['company'],row['approver'],member.binding,None,row['room']),db,'connections.manage');self.social.permission(ctx,db,'integrations.run');self.social._page(delegation,definition)
   db.execute('UPDATE cs_posts SET claimed=1 WHERE id=?',(row['id'],))
  return dict(version='starli.company-social-post-effect.v1',companyId=row['company'],postId=row['id'],reviewHash=row['hash'],allowed=True)

def install(app,runtime,social):
 from fastapi import APIRouter,Depends,Request
 from .http import make_router
 from starli_company_tools.core import ToolSpec,obj,ID
 posts=CompanyPosts(social);original_effect=social.effect_authorize
 def effect(self,payload):return posts.authorize(payload)if payload.get('version')=='starli.company-social-post-effect.v1'else original_effect(payload)
 social.effect_authorize=types.MethodType(effect,social)
 original=social.store.message_dto
 def dto(store,db,room,message):
  value=original(db,room,message)
  if value.get('deleted'):return value
  row=db.execute('SELECT company,bot FROM cs_posts WHERE room=? AND assistant=? ORDER BY rowid DESC LIMIT 1',(room,message)).fetchone()
  if row and value.get('speaker')=={'kind':'agent','id':row['bot']}:
   data=db.execute('SELECT data FROM message WHERE id=?',(message,)).fetchone();card=json.loads(data[0]or'{}').get('starliSocialPost')
   if type(card)is dict and card.get('companyId')==row['company']and card.get('sourceConversationId')==room:value['data']={**(value.get('data')or{}),'starliSocialPost':card}
  return value
 social.store.message_dto=types.MethodType(dto,social.store)
 def propose(bound,args):
  bound.check();ctx=social.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope);return posts.propose(ctx,args,bound.run_id+':'+bound.call_id)
 runtime.company_tools.register(ToolSpec('company_social_post_draft','Draft exact one-off Facebook text for human review; NEVER publishes. Requires active owned company Page delegation. Instagram drafts remain blocked from publishing until its owned-media adapter is verified. No personal-account fallback, tokens or arbitrary media URLs.',obj({'delegationId':ID,'platform':{'type':'string','enum':['facebook','instagram']},'pageId':ID,'text':{'type':'string','minLength':1,'maxLength':2200},'instagramAccountId':ID,'mediaRef':ID},['delegationId','platform','pageId','text']),'write','company-social',propose,'integrations.run'))
 # Reuse the exact same guarded social route class (Bearer/Origin/body limits).
 route_class=type(next(r for r in app.router.routes if getattr(r,'path','').endswith('/social/connections')))
 router=APIRouter(prefix='/api/v1/starli/companies/{company}/social',route_class=route_class);session=app.state.company_messaging_session
 @router.get('/posts/{ident}')
 def get(company:str,ident:str,sourceConversationId:str,principal=Depends(session)):return posts.get(social.context(principal,company,sourceConversationId),ident)
 @router.post('/posts/{ident}/publish')
 async def publish(company:str,ident:str,request:Request,principal=Depends(session)):
  form=await request.json();return await posts.publish(social.context(principal,company,form.get('sourceConversationId')),ident,form)
 index=next((i for i,r in enumerate(app.router.routes)if getattr(r,'path',None)==''),len(app.router.routes));app.router.routes[index:index]=router.routes
 return posts
