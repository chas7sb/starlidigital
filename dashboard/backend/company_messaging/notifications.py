"""Durable reference-only notification outbox, fresh authorization on delivery."""
from .authority import require, Denied
from .store import ident


def preferences(store,session,company,room='',values=None):
    with store.access(session,company,room or None) as (db,member,_):
        if values is not None:
            require(set(values)=={'muted','quietStart','quietEnd','sound'},422,'INVALID_PREFERENCES')
            require(type(values['muted']) is bool and type(values['sound']) is bool,422,'INVALID_PREFERENCES')
            for field in ('quietStart','quietEnd'):
                require(values[field] is None or type(values[field]) is int and 0<=values[field]<1440,422,'INVALID_QUIET_HOURS')
            require((values['quietStart'] is None)==(values['quietEnd'] is None),422,'INVALID_QUIET_HOURS')
            db.execute('INSERT INTO cm_preferences VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(company,user,binding,room) DO UPDATE SET muted=excluded.muted,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,sound=excluded.sound',(company,member.user_id,member.binding,room,int(values['muted']),values['quietStart'],values['quietEnd'],int(values['sound'])))
        row=db.execute('SELECT muted,quiet_start,quiet_end,sound FROM cm_preferences WHERE company=? AND user=? AND binding=? AND room=?',(company,member.user_id,member.binding,room)).fetchone()
        return dict(muted=bool(row[0]),quietStart=row[1],quietEnd=row[2],sound=bool(row[3])) if row else dict(muted=False,quietStart=None,quietEnd=None,sound=False)


def catch_up(store,session,company,after='',limit=50):
    require(type(limit) is int and 1<=limit<=100,422,'INVALID_LIMIT')
    # UUID notification IDs aren't time ordered. Cursor uses SQLite monotonically
    # increasing INTEGER rowid. IDs remain stable for cross-device deduplication.
    require(after=='' or str(after).isdigit(),422,'INVALID_CURSOR')
    cursor=int(after or 0)
    with store.access(session,company) as (db,member,_):
        rows=db.execute('SELECT rowid,* FROM cm_notifications WHERE company=? AND user=? AND binding=? AND rowid>? ORDER BY rowid LIMIT ?',(company,member.user_id,member.binding,cursor,limit)).fetchall()
        result=[]
        for row in rows:
            try:
                room=store.room(db,member,row['room'])
                message=store.message_dto(db,row['room'],row['message'])
                if message['deleted']:continue
                for attachment in message['attachments']:
                    store.authority.require_attachment(member,row['room'],attachment['id'])
                prefs=[]
                for scope in ('',row['room']):
                    pref=db.execute('SELECT muted,quiet_start,quiet_end,sound FROM cm_preferences WHERE company=? AND user=? AND binding=? AND room=?',(company,member.user_id,member.binding,scope)).fetchone()
                    if pref:prefs.append({'muted':bool(pref[0]),'quietStart':pref[1],'quietEnd':pref[2],'sound':bool(pref[3])})
                result.append({'id':row['id'],'cursor':row['rowid'],'companyId':company,'roomId':row['room'],'messageId':row['message'],'status':'READ' if row['read'] else 'DELIVERED' if row['delivered'] else 'SAVED','message':message,'preferences':prefs})
            except Denied:continue
        return {'notifications':result,'next':str(rows[-1]['rowid']) if rows else str(cursor),'hasMore':len(rows)==limit}


def acknowledge(store,session,company,notification,kind):
    require(kind in ('delivered','read'),422,'INVALID_ACK')
    with store.access(session,company) as (db,member,_):
        row=db.execute('SELECT * FROM cm_notifications WHERE id=? AND company=? AND user=? AND binding=?',(ident(notification),company,member.user_id,member.binding)).fetchone()
        require(row is not None,404,'NOTIFICATION_NOT_FOUND')
        room=store.room(db,member,row['room'])
        message=store.message_dto(db,row['room'],row['message'])
        # Only recipient can acknowledge; sender receipt queries are not exposed.
        db.execute('UPDATE cm_notifications SET delivered=coalesce(delivered,?),read=CASE WHEN ? THEN coalesce(read,?) ELSE read END WHERE id=?',(store.clock(),kind=='read',store.clock(),notification))
        if kind=='read':
            db.execute('INSERT INTO cm_reads VALUES(?,?,?,?) ON CONFLICT(room,user,binding) DO UPDATE SET seq=max(seq,excluded.seq)',(row['room'],member.user_id,member.binding,message['sequence']))
            store.event(db,row['room'],'read',audience=member)
        return {'id':notification,'status':'READ' if kind=='read' or row['read'] else 'DELIVERED'}
