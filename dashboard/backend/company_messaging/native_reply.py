"""Canonical ordinary DM/channel assistant publication for native runtime."""
import uuid
from .authority import require
from .store import text,ident,encode,VERSION


def publish(store,run,assistant_message_id,content,expected_revision=0):
    text(content,empty=True);ident(assistant_message_id)
    with store.db() as db:
        require(store.authority.require_bot_run(run) is True,403,'BOT_RUN_DENIED')
        require(getattr(run,'assistant_message_id',None)==assistant_message_id,403,'ASSISTANT_ID_MISMATCH')
        member=store.authority.require_member(run.actor_id,run.company_id)
        require(member.binding==run.actor_binding,403,'MEMBERSHIP_CHANGED')
        room=store.room(db,member,run.room_id);store.agent(db,member,run.room_id,run.bot_id)
        require(room['kind']!='work_session',403,'USE_WORK_TURN_ADMISSION')
        source=getattr(run,'source_context',None)
        require(source is not None and source.room_revision==room['revision'],403,'SOURCE_CONTEXT_CHANGED')
        if room['visibility']=='private':
            audience=[]
            for r in db.execute('SELECT user,binding FROM cm_members WHERE room=? AND active=1 ORDER BY user',(run.room_id,)):
                current=store.authority.require_member(r[0],run.company_id)
                if current.binding==r[1]:audience.append((current.user_id,current.binding))
            require(tuple(audience)==source.audience,403,'SOURCE_CONTEXT_CHANGED')
        existing=db.execute('SELECT * FROM cm_messages WHERE id=?',(assistant_message_id,)).fetchone()
        now=int(store.clock()*1e9)
        if existing:
            require(existing['room']==run.room_id and existing['speaker']==run.bot_id and existing['kind']=='agent' and existing['run']==run.run_id and not existing['deleted'],403,'ASSISTANT_ID_MISMATCH')
            current=store.message_dto(db,run.room_id,assistant_message_id)
            if current['content']==content:return current
            require(existing['revision']==expected_revision,409,'REVISION_CONFLICT')
            db.execute('UPDATE message SET content=?,updated_at=? WHERE id=?',(content,now,assistant_message_id))
            db.execute('UPDATE cm_messages SET revision=revision+1 WHERE id=?',(assistant_message_id,))
            store.event(db,run.room_id,'message.updated',assistant_message_id)
        else:
            require(expected_revision==0,409,'REVISION_CONFLICT')
            db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',(assistant_message_id,'agent:'+run.bot_id,run.room_id,None,content,encode({}),encode({'version':VERSION}),now,now))
            db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,?)',(assistant_message_id,run.room_id,room['seq']+1,'agent',run.bot_id,1,'[]','[]',run.run_id))
            db.execute('UPDATE cm_rooms SET seq=seq+1 WHERE id=?',(run.room_id,))
            store.event(db,run.room_id,'message.created',assistant_message_id)
            store.notify(db,member,room,assistant_message_id)
        require(store.authority.require_bot_run(run) is True,403,'BOT_RUN_DENIED')
        return store.message_dto(db,run.room_id,assistant_message_id)
