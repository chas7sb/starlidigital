"""Canonical same-chat feedback. Domain snapshots invalidate; messages persist.

Never creates another conversation. A live origin assistant carries one status
card; future/scheduled executions get exactly one deterministic native message
in the immutable source room, which is updated for all subsequent transitions.
"""
import json,uuid,types
from .common import need,encoded,envelope
from .common import Context

class Feedback:
    def __init__(self,gateway):
        self.gateway=gateway;self.store=gateway.store
        original=self.store.message_dto
        def dto(store,db,room,message):
            result=original(db,room,message)
            if result.get('deleted'):return result
            origin=db.execute('SELECT company,room,bot FROM sa_origins WHERE room=? AND feedback_message=? LIMIT 1',(room,message)).fetchone()
            if origin and result['speaker']=={'kind':'agent','id':origin['bot']}:
                row=db.execute('SELECT data FROM message WHERE id=? AND channel_id=?',(message,room)).fetchone()
                card=json.loads(row['data'] or '{}').get('starliAutomation') if row else None
                if type(card)is dict and card.get('companyId')==origin['company'] and card.get('sourceConversationId')==room and card.get('assistantMessageId')==message:
                    result['data']={'starliAutomation':card}
            return result
        self.store.message_dto=types.MethodType(dto,self.store)
    def origin(self,db,company,kind,resource,version=0):
        return db.execute('SELECT * FROM sa_origins WHERE company=? AND kind=? AND resource=? AND version=?',(company,kind,resource,version)).fetchone()
    def linkage(self,db,company,kind,resource,version=0):
        origin=self.origin(db,company,kind,resource,version)
        return dict(sourceConversationId=origin['room'] if origin else None,requestingBotId=origin['bot'] if origin else None,
                    originAssistantMessageId=origin['source_assistant'] if origin else None,assistantMessageId=origin['feedback_message'] if origin else None)
    def new_message(self,db,ctx,room,bot,message,content,notification=False):
        member=self.store.authority.require_member(ctx.actor,ctx.company)
        native=self.store.room(db,member,room);self.store.agent(db,member,room,bot)
        old=db.execute('SELECT room,speaker,kind FROM cm_messages WHERE id=?',(message,)).fetchone()
        if old:
            need((old['room'],old['speaker'],old['kind'])==(room,bot,'agent'),'AUTOMATION_MESSAGE_BINDING_CHANGED')
            return
        now=int(self.gateway.clock()*1e9)
        db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
                   (message,'agent:'+bot,room,None,content,encoded({}),encoded({'version':'starli.automations.v1','attribution':{'requestedBy':ctx.actor},'done':True}),now,now))
        db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,?)',(message,room,native['seq']+1,'agent',bot,1,'[]','[]',None))
        db.execute('UPDATE cm_rooms SET seq=seq+1 WHERE id=?',(room,));self.store.event(db,room,'message.created',message)
        if notification:
            db.execute('INSERT OR IGNORE INTO cm_notifications(id,company,room,message,user,binding,created) VALUES(?,?,?,?,?,?,?)',
                       (str(uuid.uuid4()),ctx.company,room,message,member.user_id,member.binding,self.gateway.clock()))
    def bind_draft(self,db,ctx,draft):
        row=self.gateway.row(db,ctx,'sa_drafts',draft)
        if not row['bot']:return
        message=getattr(ctx.native_scope,'assistant_message_id',None)
        if message:
            current=db.execute('SELECT room,speaker,kind FROM cm_messages WHERE id=?',(message,)).fetchone()
            need(current is not None and (current['room'],current['speaker'],current['kind'])==(row['room'],row['bot'],'agent'),'AUTOMATION_ORIGIN_DENIED')
        else:
            message=str(uuid.uuid5(uuid.NAMESPACE_URL,'starli:automation:draft:'+ctx.company+':'+draft))
            self.new_message(db,ctx,row['room'],row['bot'],message,'Setting up '+row['name']+'.')
        db.execute('INSERT INTO sa_origins VALUES(?,?,?,?,?,?,?,?)',('draft',draft,0,ctx.company,row['room'],row['bot'],message,message))
    def bind_version(self,db,ctx,workflow,version,draft):
        source=self.origin(db,ctx.company,'draft',draft)
        need(source is not None,'AUTOMATION_ORIGIN_REQUIRED',409)
        db.execute('INSERT INTO sa_origins VALUES(?,?,?,?,?,?,?,?)',('version',workflow,version,ctx.company,source['room'],source['bot'],source['source_assistant'],source['feedback_message']))
    def bind_execution(self,db,ctx,execution,workflow,version):
        source=self.origin(db,ctx.company,'version',workflow,version)
        need(source is not None,'AUTOMATION_ORIGIN_REQUIRED',409)
        active=db.execute("SELECT 1 FROM cr_turns WHERE message=? AND company=? AND room=? AND bot=? AND state IN ('QUEUED','RUNNING')",(source['source_assistant'],ctx.company,source['room'],source['bot'])).fetchone() if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cr_turns'").fetchone() else None
        if active:message=source['source_assistant']
        else:
            message=str(uuid.uuid5(uuid.NAMESPACE_URL,'starli:automation:execution:'+ctx.company+':'+execution))
            self.new_message(db,ctx,source['room'],source['bot'],message,'Automation execution queued.',notification=True)
        db.execute('INSERT INTO sa_origins VALUES(?,?,?,?,?,?,?,?)',('execution',execution,version,ctx.company,source['room'],source['bot'],source['source_assistant'],message))
    def publish(self,db,ctx,resource):
        kind=None;row=None
        for table,candidate in [('sa_drafts','draft'),('sa_workflows','version'),('sa_executions','execution')]:
            row=db.execute('SELECT * FROM '+table+' WHERE id=? AND company=?',(resource,ctx.company)).fetchone()
            if row is not None:kind=candidate;break
        if row is None:
            approval=db.execute('SELECT execution FROM sa_approvals WHERE id=? AND company=?',(resource,ctx.company)).fetchone()
            if approval:return self.publish(db,ctx,approval['execution'])
            return
        version=row['version'] if kind!='draft' else 0
        origin=self.origin(db,ctx.company,kind,resource,version)
        if origin is None:return
        status=row['state'];card={'version':'starli.automations.v1','companyId':ctx.company,'conversationId':origin['room'],'kind':kind,'resourceId':resource,'status':status,'sourceConversationId':origin['room'],
             'requestingBotId':origin['bot'],'originAssistantMessageId':origin['source_assistant'],'assistantMessageId':origin['feedback_message']}
        if kind=='draft':
            card.update(draftId=resource,revision=row['revision'])
            missing=__import__('starli_automations.registry',fromlist=['missing']).missing(json.loads(row['configuration']),lambda p:self.gateway.connected(ctx,p,db))
            card['nextRequirement']=missing[0] if missing else None
            status='Setup needs your answer' if missing and missing[0]['kind']=='question' else 'A company connection is needed' if missing else 'Ready for review'
        if kind=='execution':
            card.update(executionId=resource,workflowId=row['workflow'],workflowVersion=version,approvalId=row['approval'],errorCode=row['error'])
            if row['receipt']:card['receipt']=json.loads(row['receipt'])
            status={'QUEUED':'Queued','RUNNING':'Running','WAITING_FOR_HUMAN':'Waiting for your decision','COMPLETED':'Completed with a verified receipt','FAILED':'Needs attention','UNCERTAIN':'Outcome uncertain; no automatic retry','CANCELLED':'Cancelled'}.get(status,status)
        if kind=='version':card.update(workflowId=resource,workflowVersion=version,draftId=row['draft'])
        current=db.execute('SELECT data,content FROM message WHERE id=?',(origin['feedback_message'],)).fetchone()
        if current is None:return
        data=json.loads(current['data'] or '{}');data['starliAutomation']=card
        # Streaming native response text remains owned by its runtime. Only a
        # dedicated later-execution notification has its short status text edited.
        dedicated=origin['feedback_message']!=origin['source_assistant']
        db.execute('UPDATE message SET data=?,content=?,updated_at=? WHERE id=?',(encoded(data),'Automation: '+status+'.' if dedicated else current['content'],int(self.gateway.clock()*1e9),origin['feedback_message']))
        db.execute('UPDATE cm_messages SET revision=revision+1 WHERE id=?',(origin['feedback_message'],))
        self.store.event(db,origin['room'],'message.updated',origin['feedback_message'])
        db.execute('INSERT INTO sa_feedback_events(company,room,kind,resource,created) VALUES(?,?,?,?,?)',(ctx.company,origin['room'],kind,resource,self.gateway.clock()))
    def snapshot(self,ctx,room):
        with self.gateway.access(ctx,room=room) as db:
            self.gateway._expire(db,ctx.company)
            drafts=[self.gateway.draft_dto(ctx,r,db) for r in db.execute('SELECT * FROM sa_drafts WHERE company=? AND room=? ORDER BY updated DESC LIMIT 100',(ctx.company,room))]
            workflows=[self.gateway.workflow_dto(ctx,r,db) for r in db.execute('SELECT * FROM sa_workflows WHERE company=? AND room=? ORDER BY updated DESC LIMIT 100',(ctx.company,room))]
            approvals=[self.gateway.approval_dto(ctx,r,db) for r in db.execute('SELECT * FROM sa_approvals WHERE company=? AND room=? ORDER BY created DESC LIMIT 100',(ctx.company,room))]
            executions=[self.gateway.execution_dto(ctx,r,db) for r in db.execute('SELECT e.* FROM sa_executions e JOIN sa_workflows w ON w.id=e.workflow AND w.company=e.company WHERE e.company=? AND w.room=? ORDER BY e.created DESC LIMIT 100',(ctx.company,room))]
            cursor=db.execute('SELECT coalesce(max(cursor),0) FROM sa_feedback_events WHERE company=? AND room=?',(ctx.company,room)).fetchone()[0]
            return envelope(ctx.company,conversationId=room,drafts=drafts,workflows=workflows,approvals=approvals,executions=executions,cursor=cursor)
    def cleanup(self,db,company,execution):
        """Private canonical failure/expiry cleanup, like native _set_state.
        No new model/provider authority, no new conversation or source content.
        """
        row=db.execute('SELECT w.* FROM sa_workflows w JOIN sa_executions e ON e.workflow=w.id AND e.company=w.company WHERE e.id=? AND e.company=?',(execution,company)).fetchone()
        if row:self.publish(db,Context(company,row['actor'],row['binding'],None,row['bot'],row['room']),execution)
