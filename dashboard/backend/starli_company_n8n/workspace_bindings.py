"""Opt-in verified-event -> canonical workspace action integration.

No routes mount by import. Existing pure/manual graph capabilities stay false.
Only a real provider admission port may register a background event source.
"""
import contextvars,hashlib,json,re,secrets
from dataclasses import dataclass
from starli_automations.common import Context,need,encoded,digest
from ._workspace_actions import WorkspaceActions,Binding

SCHEMA='''CREATE TABLE IF NOT EXISTS sn_workspace_sources(
 id TEXT PRIMARY KEY,graph TEXT NOT NULL,company TEXT NOT NULL,revision INTEGER NOT NULL,graph_hash TEXT NOT NULL,
 kind TEXT NOT NULL,provider_ref TEXT NOT NULL UNIQUE,state TEXT NOT NULL,proof_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sn_workspace_standing(
 id TEXT PRIMARY KEY,source TEXT NOT NULL,graph TEXT NOT NULL,company TEXT NOT NULL,revision INTEGER NOT NULL,
 graph_hash TEXT NOT NULL,action TEXT NOT NULL,configuration TEXT NOT NULL,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sn_workspace_events(
 id TEXT PRIMARY KEY,source TEXT NOT NULL,graph TEXT NOT NULL,company TEXT NOT NULL,revision INTEGER NOT NULL,
 graph_hash TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,
 proof_hash TEXT NOT NULL,state TEXT NOT NULL,UNIQUE(source,event_key));'''

@dataclass(frozen=True)
class VerifiedAdmission:
    fields:dict
    proof_hash:str # Hash of verified provider evidence/receipt; never raw credentials.

class WorkspaceBindings:
    def __init__(self,gateway,*,source_verifier,event_verifier):
        self.gateway=gateway;self.native=gateway.native;self.store=self.native.store
        self.source_verifier,self.event_verifier=source_verifier,event_verifier
        self.pending=contextvars.ContextVar('workspace_activation',default=None)
        self.current=contextvars.ContextVar('workspace_verified_event',default=None)
        with self.store.db() as db:db.executescript(SCHEMA)
        self.actions=WorkspaceActions(self.store,self._authorize)
    def _graph(self,db,source):
        graph=db.execute('SELECT * FROM sn_graphs WHERE id=? AND company=?',(source['graph'],source['company'])).fetchone()
        need(graph is not None and graph['revision']==source['revision'] and graph['hash']==source['graph_hash'],'WORKSPACE_GRAPH_VERSION_CHANGED')
        need(graph['state']=='ACTIVE' and source['state']=='READY','BACKGROUND_SOURCE_NOT_ACTIVE',409)
        return graph
    def _permissions(self,db,graph,phase):
        actor=self.store.authority.require_member(graph['actor'],graph['company'])
        need(actor.binding==graph['binding'],'WORKSPACE_ACTOR_CHANGED')
        human=Context(graph['company'],graph['actor'],actor.binding,None,None,graph['room'])
        if phase in ('issue','revoke'):self.native.permission(human,db,'integrations.install')
        bot=Context(graph['company'],graph['actor'],actor.binding,None,graph['bot'],graph['room'])
        for cap in ('integrations.run','tools.dispatch','messages.send'):self.native.permission(bot,db,cap)
        self.store.room(db,actor,graph['room']);self.store.agent(db,actor,graph['room'],graph['bot'])
        return actor
    def register_source(self,ctx,graph_id,*,expected_revision,reviewed_hash,kind,provider_ref,proof):
        """Host-only after real provider subscription/readback, never model JSON.
        source_verifier checks exact registered callback/provider/company/store,
        current Stop + native standing activation and true background support.
        """
        need(ctx.bot is None and ctx.native_scope is None,'HUMAN_REVIEW_REQUIRED')
        with self.native.access(ctx,'integrations.install') as db:
            graph=self.gateway.row(db,ctx,graph_id)
            need(graph['revision']==expected_revision and graph['hash']==reviewed_hash,'WORKSPACE_GRAPH_VERSION_CHANGED')
            need(graph['state']=='ACTIVE','BACKGROUND_SOURCE_NOT_ACTIVE',409)
            result=self.source_verifier(db,dict(graph),kind,provider_ref,proof)
            need(type(result)is str and re.fullmatch('[a-f0-9]{64}',result),'VERIFIED_BACKGROUND_SOURCE_REQUIRED')
            self._permissions(db,graph,'issue')
            key=secrets.token_hex(16)
            db.execute('INSERT INTO sn_workspace_sources VALUES(?,?,?,?,?,?,?,?,?)',(key,graph_id,ctx.company,expected_revision,reviewed_hash,kind,provider_ref,'READY',result))
            return key
    def activate(self,ctx,source_id,*,action,template,fields,expires,recipient=None):
        need(ctx.bot is None and ctx.native_scope is None,'HUMAN_REVIEW_REQUIRED')
        with self.native.access(ctx,'integrations.install') as db:
            source=db.execute('SELECT * FROM sn_workspace_sources WHERE id=? AND company=?',(source_id,ctx.company)).fetchone();need(source is not None,'SOURCE_NOT_FOUND',404)
            graph=self._graph(db,source);self.gateway.row(db,ctx,graph['id']);self._permissions(db,graph,'issue')
            binding=Binding(graph['company'],graph['actor'],graph['bot'],graph['room'],graph['id'],graph['revision'])
            saved=dict(source)
        config=dict(action=action,template=template,fields=fields,expires=expires,recipient=recipient)
        token=self.pending.set((saved,config))
        try:grant=self.actions.issue(ctx.session,binding,**config)
        finally:self.pending.reset(token)
        # A crash before this link leaves an inert core grant: _authorize denies.
        with self.native.access(ctx,'integrations.install') as db:
            source=db.execute('SELECT * FROM sn_workspace_sources WHERE id=?',(source_id,)).fetchone();self._graph(db,source)
            db.execute('INSERT INTO sn_workspace_standing VALUES(?,?,?,?,?,?,?,?,?)',(grant,source_id,graph['id'],ctx.company,graph['revision'],graph['hash'],action,encoded(config),'ACTIVE'))
        return grant
    def _authorize(self,db,binding,phase,grant):
        pending=self.pending.get()
        if phase=='issue':
            need(pending is not None,'STANDING_ACTIVATION_REQUIRED');source,config=pending
            need(all(grant[k]==config[k] for k in ('action','recipient','template','fields','expires')),'STANDING_ACTION_CHANGED')
        else:
            standing=db.execute('SELECT * FROM sn_workspace_standing WHERE id=?',(grant['id'],)).fetchone()
            need(standing is not None and standing['state']=='ACTIVE','WORKSPACE_STANDING_GRANT_REVOKED')
            source=db.execute('SELECT * FROM sn_workspace_sources WHERE id=?',(standing['source'],)).fetchone()
            config=json.loads(standing['configuration'])
            need((standing['company'],standing['graph'],standing['revision'],standing['graph_hash'])==(source['company'],source['graph'],source['revision'],source['graph_hash']),'WORKSPACE_STANDING_SCOPE_CHANGED')
        graph=self._graph(db,source);self._permissions(db,graph,phase)
        need((binding.company,binding.actor,binding.bot,binding.source_room,binding.workflow,binding.workflow_version)==(graph['company'],graph['actor'],graph['bot'],graph['room'],graph['id'],graph['revision']),'WORKSPACE_STANDING_SCOPE_CHANGED')
        if phase=='execute':
            event=self.current.get();need(event is not None,'VERIFIED_EVENT_REQUIRED')
            row=db.execute('SELECT * FROM sn_workspace_events WHERE id=?',(event,)).fetchone()
            need(row is not None and row['state'] in ('VERIFIED','DELIVERED') and (row['source'],row['graph'],row['company'],row['revision'],row['graph_hash'])==(source['id'],graph['id'],graph['company'],graph['revision'],graph['hash']),'EVENT_PROVENANCE_DENIED')
            # Called again after canonical message/outbox insertion: project status
            # in that SAME transaction. No private DM content copied into source.
            receipt=db.execute('SELECT * FROM wa_events WHERE grant_id=? AND event_id=?',(grant['id'],event)).fetchone()
            if receipt:self._project(db,graph,event,receipt)
        return True
    def admit(self,provider_ref,event_key,evidence):
        """Private verified provider ingress; no caller company/room/recipient.
        event_verifier performs raw-signature/store readback/dedup checks and
        returns ONLY approved minimal fields + evidence hash, or denies.
        """
        need(type(event_key)is str and 0<len(event_key)<=200,'INVALID_EVENT_KEY',422)
        with self.store.db() as db:
            source=db.execute('SELECT * FROM sn_workspace_sources WHERE provider_ref=?',(provider_ref,)).fetchone();need(source is not None,'SOURCE_NOT_FOUND',404)
            graph=self._graph(db,source);self._permissions(db,graph,'execute')
            verified=self.event_verifier(db,dict(source),event_key,evidence)
            need(isinstance(verified,VerifiedAdmission) and re.fullmatch('[a-f0-9]{64}',verified.proof_hash),'VERIFIED_EVENT_REQUIRED')
            values=verified.fields;need(type(values)is dict and len(values)<=16 and all(type(k)is str and type(v)is str and len(v)<=500 for k,v in values.items()),'INVALID_VERIFIED_FIELDS',422)
            raw=encoded(values);fingerprint=digest(values)
            old=db.execute('SELECT * FROM sn_workspace_events WHERE source=? AND event_key=?',(source['id'],event_key)).fetchone()
            if old:
                need(old['payload_hash']==fingerprint and old['proof_hash']==verified.proof_hash,'EVENT_ID_CONFLICT',409);return old['id']
            key=secrets.token_hex(16)
            db.execute('INSERT INTO sn_workspace_events VALUES(?,?,?,?,?,?,?,?,?,?,?)',(key,source['id'],graph['id'],graph['company'],graph['revision'],graph['hash'],event_key,raw,fingerprint,verified.proof_hash,'VERIFIED'))
            return key
    def deliver(self,admission_id):
        with self.store.db(readonly=True) as db:
            event=db.execute('SELECT * FROM sn_workspace_events WHERE id=?',(admission_id,)).fetchone();need(event is not None,'EVENT_NOT_FOUND',404)
            grants=[dict(r) for r in db.execute("SELECT id,configuration FROM sn_workspace_standing WHERE source=? AND state='ACTIVE'",(event['source'],))]
            values=json.loads(event['payload'])
            need(bool(grants),'WORKSPACE_ACTIONS_NOT_CONFIGURED',409)
        receipts=[];token=self.current.set(admission_id)
        try:
            for grant in grants:
                fields=json.loads(grant['configuration'])['fields']
                need(all(key in values for key in fields),'VERIFIED_EVENT_FIELDS_MISSING',409)
                receipts.append(self.actions.deliver(grant['id'],admission_id,{key:values[key] for key in fields}))
        finally:self.current.reset(token)
        with self.store.db() as db:db.execute("UPDATE sn_workspace_events SET state='DELIVERED' WHERE id=?",(admission_id,))
        return receipts
    def revoke(self,ctx,grant_id):
        need(ctx.bot is None and ctx.native_scope is None,'HUMAN_REVIEW_REQUIRED')
        with self.native.access(ctx,'integrations.install') as db:
            row=db.execute('SELECT * FROM sn_workspace_standing WHERE id=? AND company=?',(grant_id,ctx.company)).fetchone();need(row is not None,'GRANT_NOT_FOUND',404)
            self.gateway.row(db,ctx,row['graph'])
            db.execute("UPDATE sn_workspace_standing SET state='REVOKED' WHERE id=?",(grant_id,));db.execute("UPDATE wa_grants SET state='REVOKED' WHERE id=?",(grant_id,))
    def status(self,ctx,graph_id):
        with self.native.access(ctx) as db:
            graph=self.gateway.row(db,ctx,graph_id)
            sources=db.execute('SELECT id,state FROM sn_workspace_sources WHERE graph=? AND company=? AND revision=? AND graph_hash=?',(graph_id,ctx.company,graph['revision'],graph['hash'])).fetchall()
            return {'version':'starli.workspace-actions.v1','companyId':ctx.company,'workflowId':graph_id,'workflowVersion':graph['revision'],'sourceConversationId':graph['room'],'backgroundReady':graph['state']=='ACTIVE' and any(r['state']=='READY' for r in sources),'status':'READY' if graph['state']=='ACTIVE' and any(r['state']=='READY' for r in sources) else 'BACKGROUND_NOT_CONFIGURED'}
    def _project(self,db,graph,event,receipt):
        if receipt['room']==graph['room']:return
        import uuid
        mid=str(uuid.uuid5(uuid.NAMESPACE_URL,'starli:workspace-status:'+graph['id']+':'+event))
        if db.execute('SELECT 1 FROM cm_messages WHERE id=?',(mid,)).fetchone():return
        room=db.execute('SELECT * FROM cm_rooms WHERE id=?',(graph['room'],)).fetchone();now=int(self.store.clock()*1e9)
        data=encoded({'starliWorkspaceAction':{'version':'starli.workspace-actions.v1','companyId':graph['company'],'workflowId':graph['id'],'workflowVersion':graph['revision'],'sourceConversationId':graph['room'],'eventId':event,'status':'SAVED'}})
        db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',(mid,'agent:'+graph['bot'],graph['room'],None,'Automation message saved to the approved destination.',data,'{}',now,now))
        db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,?)',(mid,graph['room'],room['seq']+1,'agent',graph['bot'],1,'[]','[]',None));db.execute('UPDATE cm_rooms SET seq=seq+1 WHERE id=?',(graph['room'],));self.store.event(db,graph['room'],'message.created',mid)
