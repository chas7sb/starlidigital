"""Company-owned schedules wake the existing bot, never fabricate user turns."""
import hashlib,hmac,json,secrets,time
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from starli_automations.common import need,encoded,digest,text

SCHEMA='''CREATE TABLE IF NOT EXISTS sat_triggers(
 id TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,actor TEXT NOT NULL,binding TEXT NOT NULL,
 bot TEXT NOT NULL,message TEXT NOT NULL,revision INTEGER NOT NULL,version INTEGER NOT NULL,
 state TEXT NOT NULL,configuration TEXT NOT NULL,hash TEXT NOT NULL,expires REAL NOT NULL,
 engine TEXT,grant_id TEXT,token_hash TEXT,active_since REAL,created REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS sat_events(
 id TEXT PRIMARY KEY,trigger_id TEXT NOT NULL,execution TEXT NOT NULL,state TEXT NOT NULL,
 created REAL NOT NULL,test INTEGER NOT NULL DEFAULT 0,UNIQUE(trigger_id,execution));
 CREATE TABLE IF NOT EXISTS sat_tests(trigger_id TEXT NOT NULL,execution TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(trigger_id,execution));'''

class Triggers:
    def __init__(self,native,engine,wake,key,clock=time.time):
        need(type(key)is bytes and len(key)==32,'WAKE_RECEIPT_KEY_REQUIRED',503)
        self.native,self.store,self.engine,self.wake,self.key,self.clock=native,native.store,engine,wake,key,clock
        with self.store.db()as db:db.executescript(SCHEMA)
    def row(self,db,ctx,ident):
        value=db.execute('SELECT * FROM sat_triggers WHERE id=? AND company=? AND room=?',(ident,ctx.company,ctx.room)).fetchone()
        need(value is not None,'TRIGGER_NOT_FOUND',404)
        need(value['actor']==ctx.actor and value['binding']==ctx.binding,'TRIGGER_OWNER_CHANGED')
        return value
    def dto(self,db,ctx,row):
        can=False
        if ctx.bot is None and ctx.native_scope is None:
            try:self.native.permission(ctx,db,'integrations.install');can=True
            except Exception:pass
        config=json.loads(row['configuration'])
        last=db.execute('SELECT id,state FROM sat_events WHERE trigger_id=? ORDER BY created DESC LIMIT 1',(row['id'],)).fetchone()
        last_state=last['state']if last else None
        if last:
            wake_event=db.execute('SELECT state FROM aw_events WHERE event_id=?',(last['id'],)).fetchone()
            if wake_event:last_state=wake_event['state']
        return dict(version='starli.agent-trigger.v1',id=row['id'],companyId=row['company'],conversationId=row['room'],botId=row['bot'],
                    **config,revision=row['revision'],reviewedHash=row['hash'],state=row['state'],expiresAt=row['expires'],
                    actions=dict(canActivate=can and row['state']=='DRAFT',canPause=can and row['state']=='ACTIVE',canResume=can and row['state']=='PAUSED',canTest=can and row['state']=='ACTIVE'),lastEvent=dict(state=last_state) if last else None)
    def propose(self,ctx,data):
        need(ctx.bot and ctx.native_scope and ctx.room,'REQUESTING_NATIVE_BOT_REQUIRED')
        need(type(data)is dict and set(data)=={'name','prompt','dailyTime','timeZone'},'INVALID_TRIGGER_FIELDS',422)
        name=text(data['name'],160);prompt=text(data['prompt'],4000);when=data['dailyTime'];zone=data['timeZone']
        import re
        need(type(when)is str and re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]',when),'INVALID_DAILY_TIME',422)
        need(type(zone)is str and len(zone)<=80,'INVALID_TIME_ZONE',422)
        try:ZoneInfo(zone)
        except (ZoneInfoNotFoundError,ValueError):need(False,'INVALID_TIME_ZONE',422)
        ident=secrets.token_hex(16);now=self.clock();message=getattr(ctx.native_scope,'assistant_message_id',None)
        need(message,'NATIVE_ASSISTANT_ORIGIN_REQUIRED')
        config=dict(name=name,prompt=prompt,dailyTime=when,timeZone=zone)
        with self.native.access(ctx)as db:
            origin=db.execute('SELECT * FROM cm_messages WHERE id=? AND room=?',(message,ctx.room)).fetchone()
            need(origin and origin['speaker']==ctx.bot and origin['kind']=='agent' and not origin['deleted'],'NATIVE_ASSISTANT_ORIGIN_DENIED')
            need(db.execute("SELECT count(*) FROM sat_triggers WHERE company=? AND state IN ('ACTIVE','ACTIVATING')",(ctx.company,)).fetchone()[0]<100,'COMPANY_TRIGGER_LIMIT',409)
            db.execute('INSERT INTO sat_triggers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,ctx.company,ctx.room,ctx.actor,ctx.binding,ctx.bot,message,1,1,'DRAFT',encoded(config),digest(config),now+30*86400,None,None,None,None,now))
            self.store.event(db,ctx.room,'message.updated',message)
            return self.dto(db,ctx,self.row(db,ctx,ident))
    def get(self,ctx,ident):
        with self.native.access(ctx)as db:return self.dto(db,ctx,self.row(db,ctx,ident))
    def claim(self,ctx,ident,revision,reviewed_hash,source,target):
        need(ctx.bot is None and ctx.native_scope is None,'HUMAN_REVIEW_REQUIRED')
        with self.native.access(ctx,'integrations.install')as db:
            row=self.row(db,ctx,ident)
            need(row['revision']==revision and row['hash']==reviewed_hash and row['state']==source,'TRIGGER_REVIEW_CHANGED',409)
            need(row['expires']>self.clock(),'TRIGGER_EXPIRED',409)
            db.execute('UPDATE sat_triggers SET state=?,revision=revision+1 WHERE id=?',(target,ident))
            return dict(row)
    def activate(self,ctx,ident,revision,reviewed_hash,resume=False):
        row=self.claim(ctx,ident,revision,reviewed_hash,'PAUSED'if resume else'DRAFT','ACTIVATING');config=json.loads(row['configuration']);grant=None
        try:
            grant=self.wake.activate(ctx.session,ctx.company,ctx.room,row['bot'],config['prompt'],row['version'],source_id=ident,expires_at=row['expires'])
            if resume:ref=json.loads(row['engine'])
            else:
                token=secrets.token_urlsafe(32)
                with self.native.access(ctx,'integrations.install')as db:db.execute('UPDATE sat_triggers SET token_hash=? WHERE id=?',(hashlib.sha256(token.encode()).hexdigest(),ident))
                ref=self.engine.prepare(ident,row['version'],config['dailyTime'],config['timeZone'],token)
                with self.native.access(ctx,'integrations.install')as db:db.execute('UPDATE sat_triggers SET engine=? WHERE id=?',(encoded(ref),ident))
            with self.native.access(ctx,'integrations.install')as db:self.row(db,ctx,ident)
            published=self.engine.activate(ref)
            if type(published)is dict:ref=published
            with self.native.access(ctx,'integrations.install')as db:
                current=self.row(db,ctx,ident);need(current['state']=='ACTIVATING','TRIGGER_STATE_CHANGED',409)
                db.execute("UPDATE sat_triggers SET state='ACTIVE',engine=?,grant_id=?,active_since=? WHERE id=?",(encoded(ref),grant,self.clock(),ident))
                self.store.event(db,ctx.room,'message.updated',row['message'])
                return self.dto(db,ctx,self.row(db,ctx,ident))
        except BaseException:
            if grant:
                try:self.wake.revoke(ctx.session,grant)
                except Exception:pass
            with self.store.db()as db:db.execute("UPDATE sat_triggers SET state='UNKNOWN' WHERE id=?",(ident,))
            raise
    def pause(self,ctx,ident,revision,reviewed_hash):
        row=self.claim(ctx,ident,revision,reviewed_hash,'ACTIVE','PAUSING')
        # Close native authority before attempting a remote unsubscribe.
        self.wake.revoke(ctx.session,row['grant_id'])
        try:self.engine.pause(json.loads(row['engine']))
        except BaseException:
            with self.store.db()as db:db.execute("UPDATE sat_triggers SET state='UNKNOWN' WHERE id=?",(ident,))
            raise
        with self.native.access(ctx,'integrations.install')as db:
            db.execute("UPDATE sat_triggers SET state='PAUSED' WHERE id=?",(ident,));self.store.event(db,ctx.room,'message.updated',row['message'])
            return self.dto(db,ctx,self.row(db,ctx,ident))
    def test(self,ctx,ident,revision,reviewed_hash):
        need(ctx.bot is None and ctx.native_scope is None,'HUMAN_REVIEW_REQUIRED')
        with self.native.access(ctx,'integrations.install')as db:
            row=dict(self.row(db,ctx,ident));need(row['state']=='ACTIVE' and row['revision']==revision and row['hash']==reviewed_hash,'TRIGGER_REVIEW_CHANGED',409)
            need(not db.execute('SELECT 1 FROM sat_tests WHERE trigger_id=? AND created>?',(ident,self.clock()-60)).fetchone(),'TRIGGER_TEST_RATE_LIMIT',429)
            intent='intent-'+secrets.token_hex(16)
            db.execute('INSERT INTO sat_tests VALUES(?,?,?)',(ident,intent,self.clock()))
        result=self.engine.run_test(json.loads(row['engine']))
        execution=result['executionId']
        with self.native.access(ctx,'integrations.install')as db:
            self.row(db,ctx,ident);db.execute('UPDATE sat_tests SET execution=? WHERE trigger_id=? AND execution=?',(execution,ident,intent))
            return self.dto(db,ctx,self.row(db,ctx,ident))
    def callback(self,token,data):
        need(type(token)is str and 20<=len(token)<=200 and type(data)is dict and set(data)=={'triggerId','version','eventId'},'TRIGGER_EVENT_DENIED')
        need(type(data['triggerId'])is str and type(data['eventId'])is str and 1<=len(data['eventId'])<=128 and type(data['version'])is int,'TRIGGER_EVENT_DENIED')
        with self.store.db()as db:
            row=db.execute('SELECT * FROM sat_triggers WHERE id=?',(data['triggerId'],)).fetchone()
            need(row and row['state']=='ACTIVE' and row['version']==data['version'] and row['expires']>self.clock() and row['token_hash'] and hmac.compare_digest(row['token_hash'],hashlib.sha256(token.encode()).hexdigest()),'TRIGGER_EVENT_DENIED')
            ident=digest([row['id'],row['version'],data['eventId']])
            db.execute("INSERT OR IGNORE INTO sat_events(id,trigger_id,execution,state,created)VALUES(?,?,?,'QUEUED',?)",(ident,row['id'],data['eventId'],self.clock()))
        return {'accepted':True}
    def drain_once(self):
        with self.store.db()as db:
            event=db.execute("SELECT * FROM sat_events WHERE state='QUEUED' ORDER BY created LIMIT 1").fetchone()
            if not event:return False
            row=db.execute('SELECT * FROM sat_triggers WHERE id=?',(event['trigger_id'],)).fetchone()
            if row is None or row['state']!='ACTIVE' or row['expires']<=self.clock():
                db.execute("UPDATE sat_events SET state='DENIED' WHERE id=?",(event['id'],));return True
            row,event=dict(row),dict(event)
            test=db.execute('SELECT execution FROM sat_tests WHERE trigger_id=? AND execution=?',(row['id'],event['execution'])).fetchone()
            db.execute("UPDATE sat_events SET state='VERIFYING' WHERE id=?",(event['id'],))
        try:
            proof=self.engine.verify_event(json.loads(row['engine']),event['execution'],approved_test_execution_id=test['execution']if test else None,minimum_started_at=row['active_since'],max_age_seconds=300)
            # The engine adapter rejects mismatched workflow/mode/age/version.
            if proof.get('verified')is not True:
                with self.store.db()as db:db.execute("UPDATE sat_events SET state=? WHERE id=?",('QUEUED'if self.clock()-event['created']<300 else'UNKNOWN',event['id']))
                return True
            now=self.clock();claims=dict(version='starli.agent-wake-receipt.v1',grantId=row['grant_id'],eventId=event['id'],sourceId=row['id'],workflowVersion=row['version'],issuedAt=now,expiresAt=now+30)
            signature=hmac.new(self.key,encoded(claims).encode(),hashlib.sha256).hexdigest()
            result=self.wake.wake(row['grant_id'],event['id'],{'claims':claims,'signature':signature})
            with self.store.db()as db:db.execute("UPDATE sat_events SET state='WAKE_QUEUED' WHERE id=?",(event['id'],))
        except BaseException as error:
            with self.store.db()as db:
                waiting_for_test_id=getattr(error,'code',None)=='schedule_execution_mode_not_approved' and db.execute("SELECT 1 FROM sat_tests WHERE trigger_id=? AND execution LIKE 'intent-%' AND created>?",(row['id'],self.clock()-60)).fetchone()
                pending=getattr(error,'code',None)=='schedule_execution_pending' or waiting_for_test_id
                state='QUEUED'if pending and self.clock()-event['created']<300 else'UNKNOWN'
                db.execute('UPDATE sat_events SET state=? WHERE id=?',(state,event['id']))
            raise
        return True
    def recover(self):
        with self.store.db()as db:
            db.execute("UPDATE sat_events SET state='UNKNOWN' WHERE state='VERIFYING'")
            db.execute("UPDATE sat_triggers SET state='UNKNOWN' WHERE state IN ('ACTIVATING','PAUSING')")
