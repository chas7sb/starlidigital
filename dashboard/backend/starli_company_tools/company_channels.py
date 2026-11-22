"""Native explicit cross-channel posting and bounded action proofs. No admission changes."""
import hashlib,inspect,json,uuid
from dataclasses import replace
from company_messaging.authority import Denied
from company_messaging.internal_send import NativeToolScope
from company_messaging.store import encode
from starli_company_tools.core import ToolSpec,obj,ID,require

def install(runtime,registry):
 store=runtime.store
 with store.db() as db:
  db.executescript('''CREATE TABLE IF NOT EXISTS cm_channel_archives(room TEXT PRIMARY KEY);CREATE TABLE IF NOT EXISTS cm_bot_channel_calls(company TEXT NOT NULL,bot TEXT NOT NULL,run TEXT NOT NULL,call TEXT NOT NULL,actor TEXT NOT NULL,binding TEXT NOT NULL,target TEXT NOT NULL,message TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(company,run,call));''')
 def native(bound):
  bound.check();ctx=bound.context;scope=bound.native_scope
  require(isinstance(scope,NativeToolScope),'NATIVE_TOOL_SCOPE_REQUIRED')
  require((scope.company_id,scope.room_id,scope.bot_id,scope.actor_id,scope.run_id,scope.tool_call_id)==(ctx.company_id,ctx.room_id,ctx.bot_id,ctx.actor_id,bound.run_id,bound.call_id),'CHANNEL_SOURCE_SCOPE_CHANGED')
  for who in (ctx.actor_id,ctx.bot_id):runtime.authority.require_member(who,ctx.company_id,permission='messages.send')
  return ctx
 def fence(db,bound,member):
  ctx=bound.context
  require(member.binding==ctx.actor_binding,'CHANNEL_ACTOR_CHANGED')
  require(runtime.authorize_native(db,bound.native_scope)is True,'CHANNEL_RUN_REVOKED')
  store.agent(db,member,ctx.room_id,ctx.bot_id)
  require(store.authority.can_dispatch_agent(member,ctx.bot_id)is True,'CHANNEL_BOT_DISPATCH_DENIED')
  for who in (ctx.actor_id,ctx.bot_id):runtime.authority.require_member(who,ctx.company_id,permission='messages.send')
 def channel(db,member,ident,bot=None):
  row=store.room(db,member,ident)
  require(row['kind']=='channel' and db.execute('SELECT 1 FROM cm_channel_archives WHERE room=?',(ident,)).fetchone()is None,'COMPANY_CHANNEL_NOT_FOUND',404)
  if bot is not None and row['visibility']=='private':store.agent(db,member,ident,bot)
  return row
 def directory(bound,args):
  ctx=native(bound);query=args.get('query','').strip().removeprefix('#')
  with store.access(bound.session,ctx.company_id,ctx.room_id) as (db,member,_):
   fence(db,bound,member)
   rows=db.execute("SELECT r.id,c.name FROM cm_rooms r JOIN channel c ON c.id=r.id WHERE r.company=? AND r.kind='channel' AND NOT EXISTS(SELECT 1 FROM cm_channel_archives a WHERE a.room=r.id) ORDER BY r.id LIMIT 501",(ctx.company_id,)).fetchall()
   require(len(rows)<=500,'CHANNEL_DIRECTORY_PAGINATION_REQUIRED',503)
   if query:
    exact=[row for row in rows if row['id']==query];rows=exact or [row for row in rows if row['name'].strip().removeprefix('#').casefold()==query.casefold()]
   matches=[]
   for row in rows:
    try:target=channel(db,member,row['id'])
    except Denied:continue
    matches.append(dict(channelId=row['id'],displayName=row['name'],kind='channel',visibility=target['visibility'],botAdmitted=db.execute('SELECT 1 FROM cm_agents WHERE room=? AND agent=?',(row['id'],ctx.bot_id)).fetchone()is not None))
   fence(db,bound,member)
   return dict(companyId=ctx.company_id,matches=matches,requiresDisambiguation=len(matches)!=1)
 def send(bound,args):
  ctx=native(bound);content=args['content'];target=args['channelId'];fingerprint=hashlib.sha256(encode([target,content]).encode()).hexdigest()
  with store.access(bound.session,ctx.company_id,ctx.room_id) as (db,member,_):
   fence(db,bound,member);room=channel(db,member,target,ctx.bot_id)
   previous=db.execute('SELECT * FROM cm_bot_channel_calls WHERE company=? AND run=? AND call=?',(ctx.company_id,bound.run_id,bound.call_id)).fetchone()
   if previous:
    require((previous['bot'],previous['actor'],previous['binding'],previous['hash'])==(ctx.bot_id,ctx.actor_id,ctx.actor_binding,fingerprint),'CHANNEL_CALL_CONFLICT',409)
    receipt=dict(status='SAVED',companyId=ctx.company_id,channelId=target,messageId=previous['message'],botId=ctx.bot_id,reused=True)
   else:
    message=str(uuid.uuid4());now=int(store.clock()*1e9)
    attribution=dict(requestedBy=ctx.actor_id,requestedByBinding=ctx.actor_binding,sourceRoomId=ctx.room_id,nativeRunId=bound.run_id,nativeToolCallId=bound.call_id)
    db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',(message,'agent:'+ctx.bot_id,target,None,content,encode({}),encode({'version':'starli.channel-action.v1','attribution':attribution,'done':True}),now,now))
    db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,?)',(message,target,room['seq']+1,'agent',ctx.bot_id,1,'[]','[]',bound.run_id))
    db.execute('UPDATE cm_rooms SET seq=seq+1 WHERE id=?',(target,))
    db.execute('INSERT INTO cm_bot_channel_calls VALUES(?,?,?,?,?,?,?,?,?)',(ctx.company_id,ctx.bot_id,bound.run_id,bound.call_id,ctx.actor_id,ctx.actor_binding,target,message,fingerprint))
    store.event(db,target,'message.created',message);store.notify(db,member,room,message)
    # The requesting human receives the bot's action notification; no public
    # company-wide broadcast or copied source text is generated.
    db.execute('INSERT OR IGNORE INTO cm_notifications(id,company,room,message,user,binding,created) VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),ctx.company_id,target,message,ctx.actor_id,ctx.actor_binding,store.clock()))
    receipt=dict(status='SAVED',companyId=ctx.company_id,channelId=target,messageId=message,botId=ctx.bot_id,reused=False)
   channel(db,member,target,ctx.bot_id);fence(db,bound,member)
  bound.check();return receipt
 def receipt(bound,args):
  ctx=native(bound);ident=args['messageId']
  with store.access(bound.session,ctx.company_id,ctx.room_id) as (db,member,_):
   fence(db,bound,member)
   row=db.execute('SELECT c.*,m.kind,m.speaker,m.deleted FROM cm_bot_channel_calls c JOIN cm_messages m ON m.id=c.message AND m.room=c.target WHERE c.company=? AND c.message=?',(ctx.company_id,ident)).fetchone()
   if row:
    channel(db,member,row['target']);require(row['kind']=='agent' and row['speaker']==row['bot'] and not row['deleted'],'ACTION_MESSAGE_CHANGED')
    result=dict(status='SAVED',companyId=ctx.company_id,type='channel_message',messageId=ident,channelId=row['target'],botId=row['bot'])
   else:
    row=db.execute('SELECT c.*,m.kind,m.speaker,m.deleted FROM cm_internal_calls c JOIN cm_messages m ON m.id=c.message AND m.room=c.room WHERE c.company=? AND c.message=?',(ctx.company_id,ident)).fetchone()
    require(row is not None and row['actor']==member.user_id and row['binding']==member.binding and row['kind']=='agent' and row['speaker']==row['bot'] and not row['deleted'],'ACTION_RECEIPT_NOT_FOUND',404)
    result=dict(status='SAVED',companyId=ctx.company_id,type='human_message',messageId=ident,conversationId=row['room'],botId=row['bot'])
   fence(db,bound,member);return result
 registry.register(ToolSpec('company_channels_directory','Resolve an accessible active company channel by exact name, #name or ID; empty query lists current accessible channels. Never guess ambiguous names. Public posting does not require bot admission; private posting requires bot admission and actor access.',obj({'query':{'type':'string','maxLength':100}},[]),'read','native-company-channels',directory,'messages.send'))
 registry.register(ToolSpec('company_channel_message_send','Post ONLY explicit supplied text as this actual bot to an exact company channel resolved by company_channels_directory. Saves canonical message, event and notification exactly once. No source history copied, no bot admission or channel revision changes. SAVED is not a delivery claim.',obj({'channelId':ID,'content':{'type':'string','minLength':1,'maxLength':16000}}),'write','native-company-channels',send,'messages.send'))
 registry.register(ToolSpec('company_action_receipt','Verify the exact saved native channel message or your outgoing human-message receipt by messageId. Returns bounded status/type/IDs only, never private child text. Cannot claim delivery or read another company.',obj({'messageId':ID}),'read','native-company-channels',receipt,'messages.send'))
 spec=registry.specs.get('company_bot_delegate')
 if spec:
  original=spec.handler
  async def delegate(bound,args):
   result=original(bound,args);result=await result if inspect.isawaitable(result) else result
   ctx=native(bound);proofs=[]
   with store.access(bound.session,ctx.company_id,ctx.room_id) as (db,member,_):
    fence(db,bound,member);child=result.get('runId')
    link=db.execute('SELECT t.bot FROM cr_delegations d JOIN cr_turns t ON t.id=d.child WHERE d.child=? AND d.parent=? AND t.company=?',(child,bound.run_id,ctx.company_id)).fetchone()
    if link and db.execute("SELECT 1 FROM sqlite_master WHERE name='cr_company_tool_calls'").fetchone():
     rows=db.execute("SELECT name,result FROM cr_company_tool_calls WHERE run=? AND state='COMPLETED' AND name IN ('company_channel_message_send','company_human_message_send') ORDER BY rowid LIMIT 20",(child,)).fetchall()
     for row in rows:
      try:action=json.loads(row['result'])
      except (ValueError,TypeError):continue
      if action.get('status')!='SAVED':continue
      message=action.get('messageId') or (action.get('message') or {}).get('id');target=action.get('channelId')or action.get('roomId')
      canonical=db.execute('SELECT 1 FROM cm_messages m JOIN cm_rooms r ON r.id=m.room WHERE m.id=? AND m.room=? AND r.company=? AND m.kind=? AND m.speaker=? AND m.run=? AND m.deleted=0',(message,target,ctx.company_id,'agent',link['bot'],child)).fetchone()
      if canonical:proofs.append(dict(type='channel_message'if row['name']=='company_channel_message_send'else'human_message',status='SAVED',messageId=message,targetId=target,botId=link['bot']))
   return dict(result,actionReceipts=proofs)
  registry.specs['company_bot_delegate']=replace(spec,handler=delegate,description=spec.description+' Completed downstream channel/human actions are returned as bounded actionReceipts IDs; child ANSWERED alone does not prove posting. Verify messageId with company_action_receipt.')
 return registry
