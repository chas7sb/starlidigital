"""Native channel/message persistence with company ACL side tables.

No private chat, agent_conversations, bot registry, or inference writes. All
canonical text is stored in native `message`, never copied into the event log.
"""
import hashlib
import json
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager, nullcontext
from .authority import actor, require, Denied, Member

VERSION = 'starli.company-messaging.v1'


def encode(value):
    return json.dumps(value, separators=(',', ':'), sort_keys=True, ensure_ascii=False)


def ident(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', value), 422, 'INVALID_ID')
    return value


def text(value, maximum=32768, empty=False):
    require(isinstance(value, str) and len(value.encode('utf-8')) <= maximum and (empty or bool(value.strip())), 422, 'INVALID_TEXT')
    return value


def unique(values, maximum=32):
    require(isinstance(values, list) and len(values) <= maximum, 422, 'INVALID_LIST')
    require(len(set(ident(v) for v in values)) == len(values), 422, 'DUPLICATE_ID')
    return values


class Store:
    def __init__(self, path, authority, clock=time.time, attached_databases=None):
        self.path, self.authority, self.clock = str(path), authority, clock
        self.attached_databases=dict(attached_databases or {})
        require(all(re.fullmatch(r'[a-z][a-z_]{0,40}',s) for s in self.attached_databases),503,'INVALID_DATABASE_MAPPING')
        with self.db() as db:
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            require({'channel', 'message'} <= tables, 503, 'NATIVE_DATABASE_REQUIRED')
            db.executescript('''
            CREATE TABLE IF NOT EXISTS cm_channel_archives(room TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS cm_rooms(
              id TEXT PRIMARY KEY, company TEXT NOT NULL, kind TEXT NOT NULL,
              visibility TEXT NOT NULL, creator TEXT NOT NULL, creator_binding TEXT NOT NULL,
              revision INTEGER NOT NULL DEFAULT 1, seq INTEGER NOT NULL DEFAULT 0,
              cursor INTEGER NOT NULL DEFAULT 0, dm_key TEXT UNIQUE);
            CREATE INDEX IF NOT EXISTS cm_company_rooms ON cm_rooms(company,id);
            CREATE TABLE IF NOT EXISTS cm_members(
              room TEXT NOT NULL, user TEXT NOT NULL, binding TEXT NOT NULL,
              active INTEGER NOT NULL, PRIMARY KEY(room,user));
            CREATE TABLE IF NOT EXISTS cm_agents(
              room TEXT NOT NULL, agent TEXT NOT NULL, PRIMARY KEY(room,agent));
            CREATE TABLE IF NOT EXISTS cm_invites(
              id TEXT PRIMARY KEY,room TEXT NOT NULL,user TEXT NOT NULL,binding TEXT NOT NULL,
              expires REAL NOT NULL,accepted INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS cm_messages(
              id TEXT PRIMARY KEY, room TEXT NOT NULL,seq INTEGER NOT NULL,
              kind TEXT NOT NULL,speaker TEXT NOT NULL,revision INTEGER NOT NULL,
              deleted INTEGER NOT NULL DEFAULT 0,mentions TEXT NOT NULL,attachments TEXT NOT NULL,
              run TEXT, UNIQUE(room,seq));
            CREATE TABLE IF NOT EXISTS cm_events(
              room TEXT NOT NULL,cursor INTEGER NOT NULL,type TEXT NOT NULL,
              message TEXT, audience TEXT, audience_binding TEXT,
              PRIMARY KEY(room,cursor));
            CREATE TABLE IF NOT EXISTS cm_keys(
              company TEXT NOT NULL,user TEXT NOT NULL,binding TEXT NOT NULL,
              room TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,result TEXT NOT NULL,
              PRIMARY KEY(company,user,binding,room,key));
            CREATE TABLE IF NOT EXISTS cm_reads(
              room TEXT NOT NULL,user TEXT NOT NULL,binding TEXT NOT NULL,seq INTEGER NOT NULL,
              PRIMARY KEY(room,user,binding));
            CREATE TABLE IF NOT EXISTS cm_drafts(
              room TEXT NOT NULL,user TEXT NOT NULL,binding TEXT NOT NULL,
              content TEXT NOT NULL,revision INTEGER NOT NULL,device TEXT NOT NULL,
              PRIMARY KEY(room,user,binding));
            CREATE TABLE IF NOT EXISTS cm_typing(
              room TEXT NOT NULL,user TEXT NOT NULL,binding TEXT NOT NULL,expires REAL NOT NULL,
              PRIMARY KEY(room,user,binding));
            CREATE TABLE IF NOT EXISTS cm_internal_calls(
              company TEXT NOT NULL,bot TEXT NOT NULL,call TEXT NOT NULL,
              actor TEXT NOT NULL,binding TEXT NOT NULL,hash TEXT NOT NULL,
              room TEXT NOT NULL,message TEXT NOT NULL,PRIMARY KEY(company,bot,call));
            CREATE TABLE IF NOT EXISTS cm_notifications(
              id TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,
              message TEXT NOT NULL,user TEXT NOT NULL,binding TEXT NOT NULL,
              created REAL NOT NULL,delivered REAL,read REAL,
              UNIQUE(user,binding,message));
            CREATE TABLE IF NOT EXISTS cm_preferences(
              company TEXT NOT NULL,user TEXT NOT NULL,binding TEXT NOT NULL,
              room TEXT NOT NULL,muted INTEGER NOT NULL,quiet_start INTEGER,
              quiet_end INTEGER,sound INTEGER NOT NULL,
              PRIMARY KEY(company,user,binding,room));
            CREATE TABLE IF NOT EXISTS cm_work_sessions(
              room TEXT PRIMARY KEY,admin TEXT NOT NULL,admin_binding TEXT NOT NULL,
              bots TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,
              turn INTEGER NOT NULL,max_turns INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS cm_work_keys(
              room TEXT NOT NULL,actor TEXT NOT NULL,binding TEXT NOT NULL,
              key TEXT NOT NULL,hash TEXT NOT NULL,result TEXT NOT NULL,
              PRIMARY KEY(room,actor,binding,key));
            CREATE TABLE IF NOT EXISTS cm_links(
              id TEXT PRIMARY KEY,room TEXT NOT NULL,message TEXT NOT NULL,
              kind TEXT NOT NULL,resource TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS cm_draft_receipts(
              company TEXT NOT NULL,bot TEXT NOT NULL,run TEXT NOT NULL,
              receipt TEXT NOT NULL,room TEXT NOT NULL,message TEXT NOT NULL,
              PRIMARY KEY(company,bot,run,receipt));
            ''')

    @contextmanager
    def db(self, *, readonly=False):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            for schema,path in self.attached_databases.items():
                db.execute('ATTACH DATABASE ? AS '+schema,(str(path),))
            if readonly:
                db.execute('PRAGMA query_only=ON')
            db.execute('BEGIN' if readonly else 'BEGIN IMMEDIATE')
            binding=self.authority.bind_connection(db) if hasattr(self.authority,'bind_connection') else nullcontext()
            with binding:yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @contextmanager
    def access(self, session, company, room=None, *, readonly=False):
        ident(company)
        with self.db(readonly=readonly) as db:
            member = actor(self.authority, session, company)
            row = self.room(db, member, room) if room else None
            yield db, member, row
            # Recheck immediately before commit. Production must share the native
            # membership transaction or install the authority guard in mount.py.
            fresh = actor(self.authority, session, company)
            require(fresh.binding == member.binding, 403, 'MEMBERSHIP_CHANGED')
            if room:
                self.room(db, fresh, room)

    def room(self, db, member, room):
        row = db.execute('SELECT * FROM cm_rooms WHERE id=? AND company=?', (ident(room), member.company_id)).fetchone()
        require(row is not None, 404, 'ROOM_NOT_FOUND')
        require(db.execute('SELECT 1 FROM cm_channel_archives WHERE room=?',(room,)).fetchone() is None,404,'ROOM_NOT_FOUND')
        if row['visibility'] == 'private':
            found = db.execute('SELECT 1 FROM cm_members WHERE room=? AND user=? AND binding=? AND active=1', (room, member.user_id, member.binding)).fetchone()
            require(found is not None, 404, 'ROOM_NOT_FOUND')
        if row['kind']=='work_session':
            require(self.authority.require_work_permission(member,'observe',room) is True,404,'ROOM_NOT_FOUND')
        return row

    def human(self, db, room, company, user):
        target = self.authority.require_member(ident(user), company)
        require(isinstance(target, Member) and target.company_id == company and target.user_id == user)
        self.room(db, target, room)
        return target

    def manager(self, room, member):
        require(room['creator'] == member.user_id and room['creator_binding'] == member.binding)

    def event(self, db, room, kind, message=None, audience=None):
        db.execute('UPDATE cm_rooms SET cursor=cursor+1 WHERE id=?', (room,))
        cursor = db.execute('SELECT cursor FROM cm_rooms WHERE id=?', (room,)).fetchone()[0]
        db.execute('INSERT INTO cm_events VALUES(?,?,?,?,?,?)', (room, cursor, kind, message, audience.user_id if audience else None, audience.binding if audience else None))
        db.execute('DELETE FROM cm_events WHERE room=? AND cursor<=?', (room, cursor-2000))

    def room_dto(self, db, member, row):
        channel = db.execute('SELECT name FROM channel WHERE id=?', (row['id'],)).fetchone()
        require(channel is not None, 503, 'CANONICAL_CHANNEL_MISSING')
        read = db.execute('SELECT seq FROM cm_reads WHERE room=? AND user=? AND binding=?', (row['id'], member.user_id, member.binding)).fetchone()
        unread = db.execute('SELECT count(*) FROM cm_messages WHERE room=? AND seq>? AND deleted=0 AND NOT(kind=? AND speaker=?)', (row['id'], read[0] if read else 0, 'human', member.user_id)).fetchone()[0]
        agents=[]
        if row['kind']!='work_session':
            for joined in db.execute('SELECT agent FROM cm_agents WHERE room=? ORDER BY agent',(row['id'],)):
                try:
                    self.authority.require_agent(member,joined[0])
                    if self.authority.can_dispatch_agent(member,joined[0]) is True:agents.append(joined[0])
                except Denied:continue
        return dict(id=row['id'], companyId=row['company'], kind=row['kind'], visibility=row['visibility'], name=channel[0], revision=row['revision'], createdBy=row['creator'], lastMessageSequence=row['seq'], cursor=row['cursor'], unread=unread,agentIds=agents)

    def snapshot(self, session, company, room):
        with self.access(session, company, room) as (db, member, row):
            return self.room_dto(db, member, row)

    def rooms(self, session, company, after='', limit=50):
        require(type(limit) is int and 1 <= limit <= 100, 422, 'INVALID_LIMIT')
        with self.access(session, company) as (db, member, _):
            # Visibility filter is in SQL; a page never leaks hidden room IDs.
            rows = db.execute('''SELECT r.* FROM cm_rooms r WHERE company=? AND id>? AND NOT EXISTS(SELECT 1 FROM cm_channel_archives a WHERE a.room=r.id)
              AND (visibility='public' OR EXISTS(SELECT 1 FROM cm_members m WHERE m.room=r.id
              AND m.user=? AND m.binding=? AND m.active=1)) ORDER BY id LIMIT ?''', (company, after, member.user_id, member.binding, limit+1)).fetchall()
            page = rows[:limit];visible=[]
            for row in page:
                if row['kind']=='work_session':
                    try:
                        require(self.authority.require_work_permission(member,'discover',row['id']) is True)
                        self.room(db,member,row['id'])
                    except Denied:continue
                visible.append(self.room_dto(db,member,row))
            return {'rooms': visible, 'hasMore': len(rows)>limit, 'next': page[-1]['id'] if page else after}

    def replay_key(self, db, member, room, key, payload):
        require(isinstance(key, str) and re.fullmatch(r'[!-~]{1,128}', key), 422, 'IDEMPOTENCY_KEY_REQUIRED')
        digest = hashlib.sha256(encode(payload).encode()).hexdigest()
        args = (member.company_id, member.user_id, member.binding, room, key)
        row = db.execute('SELECT hash,result FROM cm_keys WHERE company=? AND user=? AND binding=? AND room=? AND key=?', args).fetchone()
        if row:
            require(row[0] == digest, 409, 'IDEMPOTENCY_CONFLICT')
            return args, digest, json.loads(row[1])
        return args, digest, None

    def save_key(self, db, args, digest, result):
        db.execute('INSERT INTO cm_keys VALUES(?,?,?,?,?,?,?)', (*args, digest, encode(result)))

    def create(self, session, company, key, kind, visibility, name, humans=None, agents=None):
        humans, agents = unique(humans or []), unique(agents or [], 16)
        text(name, 100)
        require(kind in ('dm','group','channel') and visibility in ('public','private'), 422, 'INVALID_ROOM_KIND')
        require(kind == 'channel' or visibility == 'private', 422, 'PRIVATE_ROOM_REQUIRED')
        require(kind != 'dm' or len(humans)+len(agents) == 1, 422, 'DM_REQUIRES_ONE_RECIPIENT')
        require(session.user_id not in humans, 422, 'CREATOR_ALREADY_JOINED')
        with self.access(session, company) as (db, member, _):
            return self.create_in_transaction(db, member, company, key, kind, visibility, name, humans, agents)

    def create_in_transaction(self, db, member, company, key, kind, visibility, name, humans, agents):
        """Create or replay a validated room request inside an authorized transaction."""
        payload = [kind, visibility, name, sorted(humans), sorted(agents)]
        args, digest, previous = self.replay_key(db, member, '', key, payload)
        if previous:
            return self.room_dto(db, member, self.room(db, member, previous['id']))
        targets = [self.authority.require_member(u, company) for u in humans]
        require(all(isinstance(t, Member) and t.company_id == company and t.user_id == u for t,u in zip(targets,humans)))
        for agent in agents:
            self.authority.require_agent(member, agent)
        dm_key = hashlib.sha256(encode([company, sorted([(member.user_id,member.binding)]+[(t.user_id,t.binding) for t in targets]), sorted(agents)]).encode()).hexdigest() if kind == 'dm' else None
        if kind=='dm' and len(agents)==1 and not targets:
            dm_key=hashlib.sha256(encode(['bot-human',company,agents[0],member.user_id,member.binding]).encode()).hexdigest()
        existing = db.execute('SELECT * FROM cm_rooms WHERE dm_key=?', (dm_key,)).fetchone() if dm_key else None
        if existing:
            self.room(db, member, existing['id'])
            result = self.room_dto(db, member, existing)
        else:
            room = str(uuid.uuid4()); now = int(self.clock()*1e9)
            db.execute('INSERT INTO channel(id,user_id,type,name,description,data,meta,access_control,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', (room,member.user_id,'starli_company',name,'',encode({'companyId':company}),encode({'version':VERSION}),encode({'read':{'user_ids':[],'group_ids':[]},'write':{'user_ids':[],'group_ids':[]}}),now,now))
            db.execute('INSERT INTO cm_rooms(id,company,kind,visibility,creator,creator_binding,dm_key) VALUES(?,?,?,?,?,?,?)', (room,company,kind,visibility,member.user_id,member.binding,dm_key))
            db.execute('INSERT INTO cm_members VALUES(?,?,?,1)', (room,member.user_id,member.binding))
            for target in targets:
                db.execute('INSERT INTO cm_invites VALUES(?,?,?,?,?,0)', (str(uuid.uuid4()),room,target.user_id,target.binding,self.clock()+86400))
            for agent in agents:
                db.execute('INSERT INTO cm_agents VALUES(?,?)', (room,agent))
            self.event(db,room,'room.created')
            result = self.room_dto(db,member,self.room(db,member,room))
        self.save_key(db,args,digest,{'id':result['id']})
        return result

    def invite(self, session, company, room, user):
        with self.access(session,company,room) as (db,member,row):
            self.manager(row,member)
            require(row['visibility']=='private',422,'PRIVATE_ROOM_REQUIRED')
            target = self.authority.require_member(ident(user),company)
            require(isinstance(target,Member) and target.company_id==company and target.user_id==user)
            require(user!=member.user_id,422,'CREATOR_ALREADY_JOINED')
            invitation = str(uuid.uuid4())
            db.execute('INSERT INTO cm_invites VALUES(?,?,?,?,?,0)', (invitation,room,user,target.binding,self.clock()+86400))
            return {'id':invitation,'roomId':room,'expiresAt':int((self.clock()+86400)*1000)}

    def invites(self, session,company):
        with self.access(session,company) as (db,member,_):
            rows=db.execute('''SELECT i.id,i.room,i.expires,c.name FROM cm_invites i
              JOIN cm_rooms r ON r.id=i.room JOIN channel c ON c.id=r.id
              WHERE r.company=? AND i.user=? AND i.binding=? AND i.accepted=0 AND i.expires>?''', (company,member.user_id,member.binding,self.clock())).fetchall()
            return {'invites':[dict(id=r[0],roomId=r[1],expiresAt=int(r[2]*1000),name=r[3]) for r in rows]}

    def accept(self,session,company,invitation):
        with self.access(session,company) as (db,member,_):
            row=db.execute('''SELECT i.*,r.company FROM cm_invites i JOIN cm_rooms r ON r.id=i.room
              WHERE i.id=? AND r.company=? AND i.user=? AND i.binding=? AND i.accepted=0 AND i.expires>?''', (ident(invitation),company,member.user_id,member.binding,self.clock())).fetchone()
            require(row is not None,404,'INVITE_NOT_FOUND')
            db.execute('INSERT INTO cm_members VALUES(?,?,?,1) ON CONFLICT(room,user) DO UPDATE SET binding=excluded.binding,active=1',(row['room'],member.user_id,member.binding))
            db.execute('UPDATE cm_invites SET accepted=1 WHERE id=?',(invitation,))
            self.event(db,row['room'],'room.membership')
            return self.room_dto(db,member,self.room(db,member,row['room']))

    def remove(self,session,company,room,user):
        with self.access(session,company,room) as (db,member,row):
            self.manager(row,member)
            require(user!=row['creator'],422,'CREATOR_CANNOT_BE_REMOVED')
            db.execute('UPDATE cm_members SET active=0 WHERE room=? AND user=?',(room,ident(user)))
            db.execute('UPDATE cm_invites SET accepted=1 WHERE room=? AND user=?',(room,user))
            db.execute('DELETE FROM cm_typing WHERE room=? AND user=?',(room,user))
            self.event(db,room,'room.membership')
            return {'removed':True}

    def message_dto(self,db,room,message):
        row=db.execute('''SELECT m.*,n.content,n.parent_id,n.created_at,n.updated_at,n.meta FROM cm_messages m
          JOIN message n ON n.id=m.id AND n.channel_id=m.room WHERE m.room=? AND m.id=?''',(room,message)).fetchone()
        require(row is not None,404,'MESSAGE_NOT_FOUND')
        meta=json.loads(row['meta'] or '{}')
        attribution=meta.get('attribution')
        attribution={'requestedBy':attribution['requestedBy']} if attribution else None
        links=[] if row['deleted'] else [{'id':r[0],'kind':r[1]} for r in db.execute('SELECT id,kind FROM cm_links WHERE room=? AND message=? ORDER BY id',(room,message))]
        receipts=[] if row['deleted'] else [{'receiptId':r[0],'runId':r[1],'assistantMessageId':message} for r in db.execute('SELECT receipt,run FROM cm_draft_receipts WHERE room=? AND message=? ORDER BY receipt',(room,message))]
        return dict(id=row['id'],roomId=room,sequence=row['seq'],revision=row['revision'],speaker={'kind':row['kind'],'id':row['speaker']},content='' if row['deleted'] else row['content'],parentId=row['parent_id'],mentions=[] if row['deleted'] else json.loads(row['mentions']),attachments=[] if row['deleted'] else json.loads(row['attachments']),createdAt=row['created_at']//1000000,updatedAt=row['updated_at']//1000000,deleted=bool(row['deleted']),runId=row['run'],attribution=attribution,intervention=bool(meta.get('intervention')),links=links,draftReceipts=receipts)

    def send(self,session,company,room,key,content,parent=None,mentions=None,dispatch=None,attachments=None):
        text(content); mentions=mentions or []; dispatch=unique(dispatch or [],16); attachments=unique(attachments or [],16)
        require(isinstance(mentions,list) and len(mentions)<=32,422,'INVALID_MENTIONS')
        with self.access(session,company,room) as (db,member,row):
            require(row['kind']!='work_session',403,'USE_SESSION_COMMANDS')
            args,digest,previous=self.replay_key(db,member,room,key,[content,parent,mentions,dispatch,attachments])
            if previous:
                return {'message':self.message_dto(db,room,previous['id']),'botDispatch':[{'agentId':a,'status':'UNAVAILABLE','started':False} for a in dispatch]}
            if parent:
                root=self.message_dto(db,room,ident(parent))
                require(not root['deleted'] and root['parentId'] is None,422,'THREAD_ROOT_REQUIRED')
            # Explicit authenticated human dispatch authorizes these active
            # company bots to join this room, only before any run is active.
            missing=[agent for agent in dispatch if db.execute('SELECT 1 FROM cm_agents WHERE room=? AND agent=?',(room,agent)).fetchone() is None]
            if missing:
                require(db.execute("SELECT 1 FROM cr_turns WHERE room=? AND state IN ('QUEUED','RUNNING')",(room,)).fetchone() is None,409,'ROOM_BUSY_BOT_ADMISSION_REQUIRED')
                for agent in missing:
                    require({'kind':'agent','id':agent} in mentions,422,'EXPLICIT_AGENT_MENTION_REQUIRED')
                    self.authority.require_agent(member,agent)
                    require(self.authority.can_dispatch_agent(member,agent) is True,403,'AGENT_DISPATCH_UNAVAILABLE')
                for agent in missing:db.execute('INSERT INTO cm_agents VALUES(?,?)',(room,agent))
                db.execute('UPDATE cm_rooms SET revision=revision+1 WHERE id=?',(room,))
                self.event(db,room,'room.membership')
            normalized=[];seen=set()
            for mention in mentions:
                require(isinstance(mention,dict) and set(mention)=={'kind','id'} and mention['kind'] in ('human','agent'),422,'INVALID_MENTION')
                target=ident(mention['id']);kind=mention['kind']
                require((kind,target) not in seen,422,'DUPLICATE_MENTION');seen.add((kind,target))
                if kind=='human':self.human(db,room,company,target)
                else:self.agent(db,member,room,target)
                normalized.append({'kind':kind,'id':target})
            for agent in dispatch:
                require(('agent',agent) in seen,422,'EXPLICIT_AGENT_MENTION_REQUIRED')
                self.agent(db,member,room,agent)
            safe_attachments=[]
            for attachment in attachments:
                safe=self.authority.require_attachment(member,room,attachment)
                require(isinstance(safe,dict) and safe.get('id')==attachment,403,'ATTACHMENT_DENIED')
                safe_attachments.append({'id':attachment})
            message=str(uuid.uuid4());now=int(self.clock()*1e9);seq=row['seq']+1
            db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',(message,member.user_id,room,parent,content,encode({'attachments':safe_attachments}),encode({'version':VERSION}),now,now))
            db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,NULL)',(message,room,seq,'human',member.user_id,1,encode(normalized),encode(safe_attachments)))
            db.execute('UPDATE cm_rooms SET seq=? WHERE id=?',(seq,room))
            self.event(db,room,'message.created',message)
            self.notify(db,member,row,message)
            self.save_key(db,args,digest,{'id':message})
            return {'message':self.message_dto(db,room,message),'botDispatch':[{'agentId':a,'status':'UNAVAILABLE','started':False} for a in dispatch]}

    def notify(self,db,actor_member,room_row,message,only=None):
        # Notification records contain references, never copied private text.
        # Public channel targets are supplied by a fresh authoritative bounded
        # membership enumerator; no directory search guesses or global broadcast.
        if only is not None:targets=only
        elif room_row['visibility']=='private':
            targets=[]
            for row in db.execute('SELECT user,binding FROM cm_members WHERE room=? AND active=1',(room_row['id'],)):
                try:
                    target=self.human(db,room_row['id'],actor_member.company_id,row[0])
                    if target.binding==row[1]:targets.append(target)
                except Denied:pass
        else:
            # Public channel unread is canonical; fanout is optional and only
            # explicit mentions are notified, validated earlier in send().
            mentions=json.loads(db.execute('SELECT mentions FROM cm_messages WHERE id=?',(message,)).fetchone()[0])
            targets=[self.human(db,room_row['id'],actor_member.company_id,m['id']) for m in mentions if m['kind']=='human']
        for target in targets:
            if target.user_id==actor_member.user_id:continue
            db.execute('INSERT OR IGNORE INTO cm_notifications(id,company,room,message,user,binding,created) VALUES(?,?,?,?,?,?,?)', (str(uuid.uuid4()),target.company_id,room_row['id'],message,target.user_id,target.binding,self.clock()))

    def agent(self,db,member,room,agent):
        require(db.execute('SELECT 1 FROM cm_agents WHERE room=? AND agent=?',(room,ident(agent))).fetchone() is not None,404,'AGENT_NOT_IN_ROOM')
        return self.authority.require_agent(member,agent)

    def messages(self,session,company,room,after=0,limit=50,thread=None):
        require(type(after) is int and after>=0 and type(limit) is int and 1<=limit<=100,422,'INVALID_CURSOR')
        with self.access(session,company,room) as (db,member,row):
            if thread:
                require(self.message_dto(db,room,ident(thread))['parentId'] is None,422,'THREAD_ROOT_REQUIRED')
            rows=db.execute('SELECT id FROM cm_messages WHERE room=? AND seq>? AND (? IS NULL OR id IN (SELECT id FROM message WHERE channel_id=? AND parent_id=?)) ORDER BY seq LIMIT ?',(room,after,thread,room,thread,limit+1)).fetchall()
            page=[self.message_dto(db,room,r[0]) for r in rows[:limit]]
            # Validate attachment access again at delivery; never return public URLs.
            for message in page:
                for attachment in message['attachments']:
                    self.authority.require_attachment(member,room,attachment['id'])
            return {'messages':page,'hasMore':len(rows)>limit,'next':page[-1]['sequence'] if page else after}

    def edit(self,session,company,room,message,content=None,revision=None,delete=False):
        if not delete:text(content)
        with self.access(session,company,room) as (db,member,row):
            require(row['kind']!='work_session',403,'SESSION_TRANSCRIPT_IMMUTABLE')
            old=self.message_dto(db,room,ident(message))
            require(old['speaker']=={'kind':'human','id':member.user_id})
            require(delete or old['revision']==revision,409,'REVISION_CONFLICT')
            if old['deleted']:
                require(delete,409,'MESSAGE_DELETED');return old
            db.execute('UPDATE message SET content=?,data=?,updated_at=? WHERE id=? AND channel_id=?',('' if delete else content,encode({}) if delete else encode({'attachments':old['attachments']}),int(self.clock()*1e9),message,room))
            db.execute('UPDATE cm_messages SET revision=revision+1,deleted=? WHERE id=?',(int(delete),message))
            self.event(db,room,'message.deleted' if delete else 'message.updated',message)
            return self.message_dto(db,room,message)

    def read(self,session,company,room,through):
        with self.access(session,company,room) as (db,member,row):
            require(type(through) is int and 0<=through<=row['seq'],422,'INVALID_CURSOR')
            db.execute('INSERT INTO cm_reads VALUES(?,?,?,?) ON CONFLICT(room,user,binding) DO UPDATE SET seq=max(seq,excluded.seq)',(room,member.user_id,member.binding,through))
            db.execute('''UPDATE cm_notifications SET delivered=coalesce(delivered,?),read=coalesce(read,?)
              WHERE room=? AND user=? AND binding=? AND message IN
              (SELECT id FROM cm_messages WHERE room=? AND seq<=?)''',(self.clock(),self.clock(),room,member.user_id,member.binding,room,through))
            self.event(db,room,'read',audience=member)
            return self.room_dto(db,member,row)

    def draft(self,session,company,room,content=None,revision=None,device=None):
        with self.access(session,company,room) as (db,member,row):
            old=db.execute('SELECT content,revision,device FROM cm_drafts WHERE room=? AND user=? AND binding=?',(room,member.user_id,member.binding)).fetchone()
            current={'content':old[0],'revision':old[1],'deviceId':old[2]} if old else {'content':'','revision':0,'deviceId':None}
            if content is None:return current
            text(content,empty=True);ident(device)
            require(type(revision) is int and revision==current['revision'],409,'REVISION_CONFLICT')
            db.execute('INSERT INTO cm_drafts VALUES(?,?,?,?,?,?) ON CONFLICT(room,user,binding) DO UPDATE SET content=excluded.content,revision=excluded.revision,device=excluded.device',(room,member.user_id,member.binding,content,revision+1,device))
            self.event(db,room,'draft',audience=member)
            return {'content':content,'revision':revision+1,'deviceId':device}

    def typing(self,session,company,room,active):
        require(type(active) is bool,422,'INVALID_TYPING')
        with self.access(session,company,room) as (db,member,row):
            expires=self.clock()+10 if active else 0
            db.execute('INSERT INTO cm_typing VALUES(?,?,?,?) ON CONFLICT(room,user,binding) DO UPDATE SET expires=excluded.expires',(room,member.user_id,member.binding,expires))
            self.event(db,room,'typing')
            return {'expiresAt':int(expires*1000)}

    def typing_dto(self,db,member,room):
        result=[]
        for row in db.execute('SELECT user,binding,expires FROM cm_typing WHERE room=? AND expires>?',(room,self.clock())):
            try:
                current=self.human(db,room,member.company_id,row[0])
                if current.binding==row[1]:result.append({'userId':row[0],'expiresAt':int(row[2]*1000)})
            except Denied:pass
        return result

    def events(self,session,company,room,after=0,limit=100):
        require(type(after) is int and after>=0 and type(limit) is int and 1<=limit<=100,422,'INVALID_CURSOR')
        with self.access(session,company,room) as (db,member,row):
            require(after<=row['cursor'],409,'FUTURE_CURSOR')
            minimum=db.execute('SELECT min(cursor) FROM cm_events WHERE room=?',(room,)).fetchone()[0]
            truncated=minimum is not None and after<minimum-1
            if truncated:return {'events':[],'next':row['cursor'],'resync':True,'hasMore':False}
            rows=db.execute('SELECT * FROM cm_events WHERE room=? AND cursor>? ORDER BY cursor LIMIT ?',(room,after,limit)).fetchall()
            events=[]
            for event in rows:
                if event['audience'] and (event['audience']!=member.user_id or event['audience_binding']!=member.binding):continue
                dto={'version':VERSION,'roomId':room,'cursor':event['cursor'],'type':event['type']}
                if event['message']:
                    dto['message']=self.message_dto(db,room,event['message'])
                    for attachment in dto['message']['attachments']:
                        self.authority.require_attachment(member,room,attachment['id'])
                if event['type']=='typing':dto['actors']=self.typing_dto(db,member,room)
                if event['type']=='draft':dto['reloadDraft']=True
                if event['type']=='read':dto['reloadUnread']=True
                if event['type'].startswith('work.'):
                    from .work_sessions import dto as work_dto
                    dto['session']=work_dto(db,room,self,member)
                events.append(dto)
            return {'events':events,'next':rows[-1]['cursor'] if rows else after,'resync':False,'hasMore':bool(rows) and rows[-1]['cursor']<row['cursor']}
