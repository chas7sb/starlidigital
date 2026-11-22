"""Bounded bot work transcripts, admin floor commands and readonly observers.

This module never schedules inference or executes external actions. A durable
pause fences subsequent appends; stopping an in-flight external action remains
the native runtime's explicit Stop responsibility.
"""
import hashlib
import json
import uuid
from dataclasses import dataclass
from .authority import actor, require, Member
from .store import text, ident, unique, encode, VERSION


@dataclass(frozen=True)
class BotRun:
    company_id:str
    room_id:str
    bot_id:str
    run_id:str
    actor_id:str
    actor_binding:str
    session_revision:int
    expected_turn:int


def permission(store,member,action,room):
    require(store.authority.require_work_permission(member,action,room) is True,403,'WORK_PERMISSION_DENIED')


def dto(db,room,store=None,member=None):
    row=db.execute('SELECT * FROM cm_work_sessions WHERE room=?',(room,)).fetchone()
    require(row is not None,404,'WORK_SESSION_NOT_FOUND')
    allowed=bool(store is not None and member is not None and member.user_id==row['admin'] and member.binding==row['admin_binding'] and store.authority.require_work_permission(member,'intervene',room) is True)
    active=row['state']!='CLOSED'
    capabilities={'takeFloor':allowed and active and row['state']=='RUNNING','pause':allowed and active and row['state']=='RUNNING','sendDirection':allowed and row['state'] in ('PAUSED','HUMAN_FLOOR'),'resume':allowed and row['state'] in ('PAUSED','HUMAN_FLOOR') and row['turn']<row['max_turns'],'end':allowed and active}
    return dict(id=room,administratorId=row['admin'],botIds=json.loads(row['bots']),state=row['state'],revision=row['revision'],turn=row['turn'],maxTurns=row['max_turns'],nextBotId=json.loads(row['bots'])[row['turn']%len(json.loads(row['bots']))] if row['state']=='RUNNING' and row['turn']<row['max_turns'] else None,capabilities=capabilities)


def create(store,session,company,key,name,admin,bots,visibility='private',observers=None,max_turns=16):
    ident(admin);unique(bots,4);unique(observers or [],32);text(name,100)
    require(len(bots)>=2 and type(max_turns) is int and 1<=max_turns<=64 and visibility in ('public','private'),422,'INVALID_WORK_SESSION')
    with store.access(session,company) as (db,member,_):
        permission(store,member,'create',None)
        administrator=store.authority.require_member(admin,company)
        require(isinstance(administrator,Member) and administrator.company_id==company and administrator.user_id==admin)
        for bot in bots:store.authority.require_agent(member,bot)
        humans={member.user_id:member,admin:administrator}
        for user in observers or []:humans[user]=store.authority.require_member(user,company)
        args,digest,previous=store.replay_key(db,member,'work',key,[name,admin,bots,visibility,observers,max_turns])
        if previous:
            store.room(db,member,previous['id']);return dto(db,previous['id'],store,member)
        room=str(uuid.uuid4());now=int(store.clock()*1e9)
        db.execute('INSERT INTO channel(id,user_id,type,name,description,data,meta,access_control,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(room,member.user_id,'starli_company',name,'',encode({'companyId':company}),encode({'version':VERSION}),encode({'read':{'user_ids':[],'group_ids':[]},'write':{'user_ids':[],'group_ids':[]}}),now,now))
        db.execute('INSERT INTO cm_rooms(id,company,kind,visibility,creator,creator_binding) VALUES(?,?,?,?,?,?)',(room,company,'work_session',visibility,member.user_id,member.binding))
        for human in humans.values():
            require(isinstance(human,Member) and human.company_id==company)
            db.execute('INSERT INTO cm_members VALUES(?,?,?,1)',(room,human.user_id,human.binding))
        for bot in bots:db.execute('INSERT INTO cm_agents VALUES(?,?)',(room,bot))
        db.execute('INSERT INTO cm_work_sessions VALUES(?,?,?,?,?,?,?,?)',(room,admin,administrator.binding,encode(bots),'RUNNING',1,0,max_turns))
        store.event(db,room,'work.created')
        store.save_key(db,args,digest,{'id':room})
        return dto(db,room,store,member)


def recent(store,session,company,after='',limit=50):
    # Apply both discover and visibility; generic rooms list additionally fences
    # work-session discovery below in Store.rooms.
    page=store.rooms(session,company,after,limit)
    result=[]
    with store.access(session,company) as (db,member,_):
        for room in page['rooms']:
            if room['kind']=='work_session':
                permission(store,member,'discover',room['id'])
                result.append({**room,**dto(db,room['id'],store,member)})
    return {'sessions':result,'next':page['next'],'hasMore':page['hasMore']}


def key_check(db,room,actor_id,binding,key,payload):
    ident(key);digest=hashlib.sha256(encode(payload).encode()).hexdigest()
    args=(room,actor_id,binding,key)
    old=db.execute('SELECT hash,result FROM cm_work_keys WHERE room=? AND actor=? AND binding=? AND key=?',args).fetchone()
    if old:
        require(old[0]==digest,409,'COMMAND_KEY_CONFLICT')
        return args,digest,json.loads(old[1])
    return args,digest,None


def append(db,store,room,kind,speaker,content,meta,run=None):
    row=db.execute('SELECT seq FROM cm_rooms WHERE id=?',(room,)).fetchone()
    message=str(uuid.uuid4());now=int(store.clock()*1e9);seq=row[0]+1
    db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',(message,speaker if kind=='human' else 'agent:'+speaker,room,None,content,encode({}),encode({'version':VERSION,**meta}),now,now))
    db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,?)',(message,room,seq,kind,speaker,1,encode([]),encode([]),run))
    db.execute('UPDATE cm_rooms SET seq=? WHERE id=?',(seq,room))
    store.event(db,room,'message.created',message)
    return message


def command(store,session,company,room,key,action,revision,content=None):
    require(action in ('take_floor','pause','intervene','resume','close'),422,'INVALID_COMMAND')
    if action=='intervene':text(content)
    else:require(content is None,422,'COMMAND_TEXT_UNEXPECTED')
    with store.access(session,company,room) as (db,member,_):
        permission(store,member,'intervene',room)
        row=db.execute('SELECT * FROM cm_work_sessions WHERE room=?',(room,)).fetchone()
        require(row is not None,404,'WORK_SESSION_NOT_FOUND')
        require(member.user_id==row['admin'] and member.binding==row['admin_binding'],403,'ASSIGNED_ADMIN_REQUIRED')
        args,digest,old=key_check(db,room,member.user_id,member.binding,key,[action,revision,content])
        if old:return {**dto(db,room,store,member),'messageId':old.get('messageId'),'replayed':True}
        require(type(revision) is int and revision==row['revision'],409,'REVISION_CONFLICT')
        require(row['state']!='CLOSED',409,'SESSION_CLOSED')
        if action in ('take_floor','pause'):require(row['state']=='RUNNING',409,'NOT_RUNNING')
        if action=='intervene':require(row['state'] in ('PAUSED','HUMAN_FLOOR'),409,'TAKE_FLOOR_FIRST')
        if action=='resume':require(row['state'] in ('PAUSED','HUMAN_FLOOR') and row['turn']<row['max_turns'],409,'CANNOT_RESUME')
        state={'take_floor':'HUMAN_FLOOR','pause':'PAUSED','resume':'RUNNING','close':'CLOSED','intervene':row['state']}[action]
        message=append(db,store,room,'human',member.user_id,content,{'intervention':True,'command':action}) if action=='intervene' else None
        db.execute('UPDATE cm_work_sessions SET state=?,revision=revision+1 WHERE room=?',(state,room))
        db.execute('UPDATE cm_rooms SET revision=revision+1 WHERE id=?',(room,))
        store.event(db,room,'work.'+action)
        result={**dto(db,room,store,member),'messageId':message,'externalActionsUndone':False}
        db.execute('INSERT INTO cm_work_keys VALUES(?,?,?,?,?,?)',(*args,digest,encode(result)))
        return result


def append_bot(store,run,key,content):
    require(isinstance(run,BotRun),403,'NATIVE_BOT_RUN_REQUIRED');text(content)
    with store.db() as db:
        require(store.authority.require_bot_run(run) is True,403,'BOT_RUN_DENIED')
        member=store.authority.require_member(run.actor_id,run.company_id)
        require(member.binding==run.actor_binding,403,'MEMBERSHIP_CHANGED')
        store.room(db,member,run.room_id);store.agent(db,member,run.room_id,run.bot_id)
        permission(store,member,'participate-as-bot',run.room_id)
        row=db.execute('SELECT * FROM cm_work_sessions WHERE room=?',(run.room_id,)).fetchone()
        require(row is not None,404,'WORK_SESSION_NOT_FOUND')
        args,digest,old=key_check(db,run.room_id,'agent:'+run.bot_id,run.run_id,key,[run.expected_turn,run.session_revision,content])
        if old:return {**dto(db,run.room_id),'message':store.message_dto(db,run.room_id,old['messageId']),'replayed':True}
        require(row['state']=='RUNNING' and row['turn']<row['max_turns'],409,'BOT_REPLIES_PAUSED')
        require(row['revision']==run.session_revision and row['turn']==run.expected_turn,409,'STALE_BOT_TURN')
        bots=json.loads(row['bots'])
        require(bots[row['turn']%len(bots)]==run.bot_id,409,'BOT_OUT_OF_TURN')
        message=append(db,store,run.room_id,'agent',run.bot_id,content,{'workSession':True},run.run_id)
        db.execute('UPDATE cm_work_sessions SET turn=turn+1,revision=revision+1,state=CASE WHEN turn+1>=max_turns THEN ? ELSE state END WHERE room=?',('PAUSED',run.room_id))
        db.execute('INSERT INTO cm_work_keys VALUES(?,?,?,?,?,?)',(*args,digest,encode({'messageId':message})))
        require(store.authority.require_bot_run(run) is True,403,'BOT_RUN_DENIED')
        require(store.authority.require_member(run.actor_id,run.company_id).binding==member.binding,403,'MEMBERSHIP_CHANGED')
        return {**dto(db,run.room_id),'message':store.message_dto(db,run.room_id,message),'replayed':False}
