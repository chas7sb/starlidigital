"""Native background notifications. No JWT, model turn or private history is read."""
import hashlib,json,re,string,uuid
from dataclasses import dataclass
from company_messaging.authority import require
from company_messaging.store import encode,VERSION

@dataclass(frozen=True)
class Binding:
    company:str; actor:str; bot:str; source_room:str; workflow:str; workflow_version:int

class WorkspaceActions:
    def __init__(self,store,authorize):
        """authorize(db,binding,phase,grant)->True must fence canonical workflow,
        human standing activation, bot permissions, Stop and source access in
        THIS attached native transaction. No permissive default is supplied.
        """
        self.store,self.authorize=store,authorize
        with store.db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS wa_grants(id TEXT PRIMARY KEY,company TEXT NOT NULL,binding TEXT NOT NULL,actor_binding TEXT NOT NULL,source_revision INTEGER NOT NULL,action TEXT NOT NULL,recipient TEXT,recipient_binding TEXT,template TEXT NOT NULL,fields TEXT NOT NULL,expires REAL NOT NULL,state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS wa_events(grant_id TEXT NOT NULL,event_id TEXT NOT NULL,hash TEXT NOT NULL,room TEXT NOT NULL,message TEXT NOT NULL,PRIMARY KEY(grant_id,event_id));''')
    def resolve_human(self,session,company,query):
        # Interactive setup only. Automation events can never choose a recipient.
        with self.store.access(session,company) as (_,member,_):
            matches=self.store.authority.directory(member,query)
            require(type(matches)is list and len(matches)<=50,503,'DIRECTORY_UNAVAILABLE')
            return {'matches':matches,'requiresDisambiguation':len(matches)!=1}
    def issue(self,session,binding,*,action,template,fields,expires,recipient=None):
        require(isinstance(binding,Binding) and session.user_id==binding.actor)
        require(action in ('source_chat','human_dm') and type(template)is str and 0<len(template)<=2000,422,'INVALID_ACTION')
        require(type(fields)is list and len(fields)<=16 and len(set(fields))==len(fields) and all(re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,39}',f) for f in fields),422,'INVALID_FIELDS')
        placeholders=[]
        for _,field,format_spec,conversion in string.Formatter().parse(template):
            if field is not None:
                require(field in fields and not format_spec and not conversion,422,'UNSAFE_TEMPLATE');placeholders.append(field)
        require(set(placeholders)==set(fields),422,'FIELD_TEMPLATE_MISMATCH')
        require(self.store.clock()<expires<=self.store.clock()+366*86400,422,'INVALID_EXPIRY')
        require((action=='human_dm')==(type(recipient)is str),422,'INVALID_RECIPIENT')
        with self.store.access(session,binding.company,binding.source_room) as (db,member,source):
            self.store.agent(db,member,binding.source_room,binding.bot)
            target=self.store.authority.require_member(recipient,binding.company) if recipient else None
            grant={'action':action,'recipient':recipient,'recipient_binding':target.binding if target else None,'template':template,'fields':fields,'expires':expires}
            require(self.authorize(db,binding,'issue',grant) is True,403,'STANDING_ACTIVATION_REQUIRED')
            key=str(uuid.uuid4())
            db.execute('INSERT INTO wa_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(key,binding.company,encode(binding.__dict__),member.binding,source['revision'],action,recipient,target.binding if target else None,template,encode(fields),expires,'ACTIVE'))
            return key
    def _fence(self,db,row):
        b=Binding(**json.loads(row['binding']))
        require(row['state']=='ACTIVE' and row['expires']>self.store.clock(),403,'WORKSPACE_GRANT_REVOKED')
        member=self.store.authority.require_member(b.actor,b.company)
        require(member.binding==row['actor_binding'],403,'WORKSPACE_ACTOR_CHANGED')
        source=self.store.room(db,member,b.source_room)
        require(source['revision']==row['source_revision'],403,'WORKSPACE_SOURCE_CHANGED')
        self.store.agent(db,member,b.source_room,b.bot)
        require(self.authorize(db,b,'execute',dict(row)) is True,403,'WORKSPACE_ACTION_DENIED')
        target=None
        if row['recipient']:
            target=self.store.authority.require_member(row['recipient'],b.company)
            require(target.binding==row['recipient_binding'],403,'WORKSPACE_RECIPIENT_CHANGED')
        return b,member,target,source
    def deliver(self,grant_id,event_id,values):
        require(type(event_id)is str and 0<len(event_id)<=200 and type(values)is dict,422,'INVALID_EVENT')
        with self.store.db() as db:
            row=db.execute('SELECT * FROM wa_grants WHERE id=?',(grant_id,)).fetchone();require(row is not None,404,'WORKSPACE_GRANT_NOT_FOUND')
            b,member,target,source=self._fence(db,row)
            require(set(values)==set(json.loads(row['fields'])),422,'EVENT_FIELDS_MISMATCH')
            require(all(type(v)is str and len(v)<=500 and not any(ord(c)<32 for c in v) for v in values.values()),422,'INVALID_EVENT_VALUE')
            content=row['template'].format_map(values);require(len(content)<=4000,422,'MESSAGE_TOO_LONG')
            digest=hashlib.sha256(encode(values).encode()).hexdigest()
            old=db.execute('SELECT * FROM wa_events WHERE grant_id=? AND event_id=?',(grant_id,event_id)).fetchone()
            if old:
                require(old['hash']==digest,409,'EVENT_ID_CONFLICT')
                return {'status':'SAVED','roomId':old['room'],'messageId':old['message'],'reused':True}
            room=source
            if target:
                dm_key=hashlib.sha256(encode(['bot-human',b.company,b.bot,target.user_id,target.binding]).encode()).hexdigest()
                room=db.execute('SELECT * FROM cm_rooms WHERE dm_key=?',(dm_key,)).fetchone()
                if room is None:
                    rid=str(uuid.uuid4());now=int(self.store.clock()*1e9)
                    db.execute('INSERT INTO channel(id,user_id,type,name,description,data,meta,access_control,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(rid,target.user_id,'starli_company','DM · '+b.bot,'',encode({'companyId':b.company}),encode({'version':VERSION}),encode({'read':{'user_ids':[],'group_ids':[]},'write':{'user_ids':[],'group_ids':[]}}),now,now))
                    db.execute('INSERT INTO cm_rooms(id,company,kind,visibility,creator,creator_binding,dm_key) VALUES(?,?,?,?,?,?,?)',(rid,b.company,'dm','private',target.user_id,target.binding,dm_key))
                    db.execute('INSERT INTO cm_members VALUES(?,?,?,1)',(rid,target.user_id,target.binding));db.execute('INSERT INTO cm_agents VALUES(?,?)',(rid,b.bot))
                    room=db.execute('SELECT * FROM cm_rooms WHERE id=?',(rid,)).fetchone()
                self.store.room(db,target,room['id']);self.store.agent(db,target,room['id'],b.bot)
            mid=str(uuid.uuid5(uuid.NAMESPACE_URL,'starli:workspace-action:'+grant_id+':'+event_id));now=int(self.store.clock()*1e9)
            meta={'version':VERSION,'done':True,'attribution':{'requestedBy':b.actor,'workflowId':b.workflow,'workflowVersion':b.workflow_version,'sourceRoomId':b.source_room,'standingGrantId':grant_id}}
            db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',(mid,'agent:'+b.bot,room['id'],None,content,'{}',encode(meta),now,now))
            db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,?)',(mid,room['id'],room['seq']+1,'agent',b.bot,1,'[]','[]',None))
            db.execute('UPDATE cm_rooms SET seq=seq+1 WHERE id=?',(room['id'],));self.store.event(db,room['id'],'message.created',mid)
            audience=[target] if target else [self.store.authority.require_member(r['user'],b.company) for r in db.execute('SELECT user,binding FROM cm_members WHERE room=? AND active=1',(room['id'],)) if self.store.authority.require_member(r['user'],b.company).binding==r['binding']]
            for human in audience:
                db.execute('INSERT OR IGNORE INTO cm_notifications(id,company,room,message,user,binding,created) VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),b.company,room['id'],mid,human.user_id,human.binding,self.store.clock()))
            db.execute('INSERT INTO wa_events VALUES(?,?,?,?,?)',(grant_id,event_id,digest,room['id'],mid))
            self._fence(db,row) # Revocation/role change before local commit rolls back all writes.
            return {'status':'SAVED','roomId':room['id'],'messageId':mid,'reused':False}
    def revoke(self,session,grant_id):
        with self.store.db() as db:
            row=db.execute('SELECT * FROM wa_grants WHERE id=?',(grant_id,)).fetchone();require(row is not None)
            b=Binding(**json.loads(row['binding']));require(session.user_id==b.actor)
            from company_messaging.authority import actor
            actor(self.store.authority,session,b.company)
            require(self.authorize(db,b,'revoke',dict(row)) is True)
            db.execute("UPDATE wa_grants SET state='REVOKED' WHERE id=?",(grant_id,))
