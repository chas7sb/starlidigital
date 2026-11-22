"""Opaque panel/artifact references; fresh audience resolution at open."""
import json
import uuid
from .authority import require
from .store import ident


def add_native(store,run,message_id,refs):
    """Native publisher only. Never accept URLs or hrefs from model/client JSON."""
    require(isinstance(refs,list) and len(refs)<=16,422,'INVALID_LINKS')
    with store.db() as db:
        require(store.authority.require_bot_run(run) is True,403,'BOT_RUN_DENIED')
        member=store.authority.require_member(run.actor_id,run.company_id)
        require(member.binding==run.actor_binding,403,'MEMBERSHIP_CHANGED')
        row=db.execute('SELECT m.*,n.meta FROM cm_messages m JOIN message n ON n.id=m.id WHERE m.id=?',(ident(message_id),)).fetchone()
        require(row is not None and row['kind']=='agent' and row['speaker']==run.bot_id and row['run']==run.run_id,403,'ASSISTANT_MESSAGE_MISMATCH')
        require(not row['deleted'],409,'MESSAGE_DELETED')
        room=db.execute('SELECT * FROM cm_rooms WHERE id=? AND company=?',(row['room'],run.company_id)).fetchone()
        require(room is not None,404,'ROOM_NOT_FOUND')
        source=getattr(run,'room_id',None)
        store.room(db,member,source)
        for ref in refs:
            require(isinstance(ref,dict) and set(ref)=={'kind','resourceId'} and ref['kind'] in ('panel','artifact'),422,'INVALID_LINK')
            resource=ident(ref['resourceId'])
            store.authority.resolve_link(member,source,ref['kind'],resource)
            if room['visibility']=='private':
                for target in db.execute('SELECT user,binding FROM cm_members WHERE room=? AND active=1',(room['id'],)):
                    current=store.human(db,room['id'],run.company_id,target[0])
                    require(current.binding==target[1],403,'AUDIENCE_CHANGED')
                    store.authority.resolve_link(current,room['id'],ref['kind'],resource)
            else:
                # Resolver must validate resource visibility against the entire
                # public company audience, not just the publishing human.
                store.authority.resolve_link(member,room['id'],ref['kind'],resource)
            existing=db.execute('SELECT id FROM cm_links WHERE room=? AND message=? AND kind=? AND resource=?',(room['id'],message_id,ref['kind'],resource)).fetchone()
            if not existing:db.execute('INSERT INTO cm_links VALUES(?,?,?,?,?)',(str(uuid.uuid4()),room['id'],message_id,ref['kind'],resource))
        store.event(db,room['id'],'message.updated',message_id)
        require(store.authority.require_bot_run(run) is True,403,'BOT_RUN_DENIED')
        return {'assistantMessageId':message_id,'links':store.message_dto(db,room['id'],message_id)['links']}


def open_link(store,session,company,room,message_id,link_id):
    with store.access(session,company,room) as (db,member,_):
        message=store.message_dto(db,room,ident(message_id))
        require(not message['deleted'],404,'LINK_NOT_FOUND')
        row=db.execute('SELECT kind,resource FROM cm_links WHERE id=? AND room=? AND message=?',(ident(link_id),room,message_id)).fetchone()
        require(row is not None,404,'LINK_NOT_FOUND')
        resolved=store.authority.resolve_link(member,room,row[0],row[1])
        require(isinstance(resolved,dict) and isinstance(resolved.get('route'),str) and resolved['route'].startswith('/') and not resolved['route'].startswith('//') and '\\' not in resolved['route'],403,'LINK_DENIED')
        return {'id':link_id,'kind':row[0],'route':resolved['route']}


def draft_receipt(store,run,receipt_id,assistant_message_id):
    """Idempotent native draft-result correlation to canonical assistant row."""
    ident(receipt_id);ident(assistant_message_id)
    with store.db() as db:
        require(store.authority.require_bot_run(run) is True,403,'BOT_RUN_DENIED')
        member=store.authority.require_member(run.actor_id,run.company_id)
        require(member.binding==run.actor_binding,403,'MEMBERSHIP_CHANGED')
        store.room(db,member,run.room_id)
        row=db.execute('SELECT m.*,r.company FROM cm_messages m JOIN cm_rooms r ON r.id=m.room WHERE m.id=?',(assistant_message_id,)).fetchone()
        require(row is not None and row['company']==run.company_id and row['kind']=='agent' and row['speaker']==run.bot_id and row['run']==run.run_id and not row['deleted'],403,'ASSISTANT_MESSAGE_MISMATCH')
        old=db.execute('SELECT message FROM cm_draft_receipts WHERE company=? AND bot=? AND run=? AND receipt=?',(run.company_id,run.bot_id,run.run_id,receipt_id)).fetchone()
        if old:require(old[0]==assistant_message_id,409,'DRAFT_RECEIPT_CONFLICT')
        else:
            db.execute('INSERT INTO cm_draft_receipts VALUES(?,?,?,?,?,?)',(run.company_id,run.bot_id,run.run_id,receipt_id,row['room'],assistant_message_id))
            store.event(db,row['room'],'message.updated',assistant_message_id)
        require(store.authority.require_bot_run(run) is True,403,'BOT_RUN_DENIED')
        return {'receiptId':receipt_id,'runId':run.run_id,'assistantMessageId':assistant_message_id,'roomId':row['room']}
