"""Native internal tool: explicit authorized bot send, atomic outbox, no model."""
import hashlib
import uuid
from dataclasses import dataclass
from .authority import actor, require, Member
from .store import encode, ident, text, unique, VERSION
from .context import RoomContext, revalidate


@dataclass(frozen=True)
class NativeToolScope:
    company_id:str
    room_id:str
    bot_id:str
    run_id:str
    tool_call_id:str
    actor_id:str
    actor_binding:str
    source_context:RoomContext
    assistant_message_id:str|None=None


def tool_send(store,session,scope,recipient_id,content):
    """Production tool entry; scope is constructed by the native run adapter."""
    require(isinstance(scope,NativeToolScope),403,'NATIVE_TOOL_SCOPE_REQUIRED')
    require(scope.actor_id==session.user_id and scope.company_id==scope.source_context.company_id
            and scope.room_id==scope.source_context.room_id and scope.bot_id==scope.source_context.bot_id
            and scope.actor_id==scope.source_context.actor_id and scope.actor_binding==scope.source_context.actor_binding,403,'NATIVE_TOOL_SCOPE_MISMATCH')
    durable_call=hashlib.sha256(encode([scope.run_id,scope.tool_call_id]).encode()).hexdigest()
    return send(store,session,scope.company_id,scope.room_id,scope.bot_id,durable_call,recipient_id,content,native_scope=scope)


def directory(store,session,company,query):
    text(query,100)
    with store.access(session,company) as (db,member,_):
        rows=store.authority.directory(member,query)
        require(isinstance(rows,list) and len(rows)<=50,503,'DIRECTORY_UNAVAILABLE')
        result=[]
        for row in rows:
            current=store.authority.require_member(row['userId'],company)
            require(isinstance(current,Member) and current.company_id==company and current.user_id==row['userId'])
            result.append({'userId':current.user_id,'displayName':row['displayName']})
        return {'matches':result,'requiresDisambiguation':len(result)!=1}


def send(store,session,company,source_room,bot,call_id,recipient,content,attachments=None,native_scope=None):
    """Inputs actor/source/bot/call must come from native runtime, not tool JSON.

    Caller supplies only recipient resolved by directory and new content. No
    private memory is accessed. Recipient must see source by default; explicit
    share grants belong to the authority port. Returning SAVED is not delivery.
    """
    text(content);ident(bot);ident(call_id);ident(recipient)
    attachments=unique(attachments or [],16)
    require(not attachments,422,'INTERNAL_ATTACHMENT_TRANSFER_UNAVAILABLE')
    payload=[source_room,recipient,content,attachments]
    digest=hashlib.sha256(encode(payload).encode()).hexdigest()
    with store.access(session,company,source_room) as (db,member,source):
        if native_scope is not None:
            require(store.authority.require_bot_run(native_scope) is True,403,'BOT_RUN_DENIED')
            # Capture in this same transaction; no nested DB/lock.
            require(source['revision']==native_scope.source_context.room_revision
                    and member.binding==native_scope.actor_binding,403,'SOURCE_CONTEXT_CHANGED')
            if source['visibility']=='private':
                audience=[]
                for current in db.execute('SELECT user,binding FROM cm_members WHERE room=? AND active=1 ORDER BY user',(source_room,)):
                    fresh=store.authority.require_member(current[0],company)
                    if fresh.binding==current[1]:audience.append((fresh.user_id,fresh.binding))
                require(tuple(audience)==native_scope.source_context.audience,403,'SOURCE_CONTEXT_CHANGED')
        store.agent(db,member,source_room,bot)
        target=store.authority.require_member(recipient,company)
        require(isinstance(target,Member) and target.company_id==company and target.user_id==recipient)
        def check_send_policy(recipient_member):
            decision=store.authority.require_internal_send(member,recipient_member,bot,source_room)
            require(decision is True or isinstance(decision,dict) and decision.get('allowed') is True,403,'INTERNAL_SEND_DENIED')
            share=decision.get('sourceShare') if isinstance(decision,dict) else None
            if share is not None:
                # Trusted native policy may authorize specifically composed text
                # using recipient-filtered memory/context. This is an exact
                # content-bound grant, never a blanket source-room exception.
                require(native_scope is not None and isinstance(share,dict)
                        and share.get('recipientId')==recipient_member.user_id
                        and share.get('recipientBinding')==recipient_member.binding
                        and share.get('sourceRoomId')==source_room
                        and share.get('runId')==native_scope.run_id
                        and share.get('toolCallId')==native_scope.tool_call_id
                        and share.get('contentSha256')==hashlib.sha256(content.encode()).hexdigest()
                        and share.get('recipientAudienceFiltered') is True,403,'SOURCE_SHARE_DENIED')
            else:
                # Conservative default: no forwarding inaccessible private facts.
                store.room(db,recipient_member,source_room)
        check_send_policy(target)
        for attachment in attachments:
            store.authority.require_attachment(member,source_room,attachment)
            store.authority.require_attachment(target,source_room,attachment)
        previous=db.execute('SELECT * FROM cm_internal_calls WHERE company=? AND bot=? AND call=?',(company,bot,call_id)).fetchone()
        if previous:
            require(previous['actor']==member.user_id and previous['binding']==member.binding and previous['hash']==digest,409,'TOOL_CALL_CONFLICT')
            store.room(db,target,previous['room'])
            return {'status':'SAVED','roomId':previous['room'],'message':store.message_dto(db,previous['room'],previous['message']),'reused':True}
        # Stable bot-human DM uses current recipient incarnation, independent of
        # the requesting human. A second member cannot read this DM by sending.
        dm_key=hashlib.sha256(encode(['bot-human',company,bot,target.user_id,target.binding]).encode()).hexdigest()
        room=db.execute('SELECT * FROM cm_rooms WHERE dm_key=?',(dm_key,)).fetchone()
        if room is None:
            room_id=str(uuid.uuid4());now=int(store.clock()*1e9)
            db.execute('INSERT INTO channel(id,user_id,type,name,description,data,meta,access_control,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(room_id,target.user_id,'starli_company',f'DM · {bot}','',encode({'companyId':company}),encode({'version':VERSION}),encode({'read':{'user_ids':[],'group_ids':[]},'write':{'user_ids':[],'group_ids':[]}}),now,now))
            db.execute('INSERT INTO cm_rooms(id,company,kind,visibility,creator,creator_binding,dm_key) VALUES(?,?,?,?,?,?,?)',(room_id,company,'dm','private',target.user_id,target.binding,dm_key))
            db.execute('INSERT INTO cm_members VALUES(?,?,?,1)',(room_id,target.user_id,target.binding))
            db.execute('INSERT INTO cm_agents VALUES(?,?)',(room_id,bot))
            room=db.execute('SELECT * FROM cm_rooms WHERE id=?',(room_id,)).fetchone()
        else:room_id=room['id']
        message=str(uuid.uuid4());now=int(store.clock()*1e9);seq=room['seq']+1
        # Attribution is server-derived and remains stable in the canonical row.
        attribution={'requestedBy':member.user_id,'requestedByBinding':member.binding,'sourceRoomId':source_room,'nativeToolCallId':call_id,'nativeRunId':native_scope.run_id if native_scope is not None else None}
        db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',(message,'agent:'+bot,room_id,None,content,encode({'attachments':[{'id':a} for a in attachments]}),encode({'version':VERSION,'attribution':attribution}),now,now))
        db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,?)',(message,room_id,seq,'agent',bot,1,encode([]),encode([{'id':a} for a in attachments]),native_scope.run_id if native_scope is not None else call_id))
        db.execute('UPDATE cm_rooms SET seq=? WHERE id=?',(seq,room_id))
        db.execute('INSERT INTO cm_internal_calls VALUES(?,?,?,?,?,?,?,?)',(company,bot,call_id,member.user_id,member.binding,digest,room_id,message))
        store.event(db,room_id,'message.created',message)
        # One durable outbox record even when requester == recipient.
        db.execute('INSERT INTO cm_notifications(id,company,room,message,user,binding,created) VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),company,room_id,message,target.user_id,target.binding,store.clock()))
        # Recheck target + send policy immediately before committing side effect.
        fresh=store.authority.require_member(recipient,company)
        require(fresh.binding==target.binding,403,'RECIPIENT_CHANGED')
        check_send_policy(fresh)
        if native_scope is not None:require(store.authority.require_bot_run(native_scope) is True,403,'BOT_RUN_DENIED')
        return {'status':'SAVED','roomId':room_id,'message':store.message_dto(db,room_id,message),'reused':False}
