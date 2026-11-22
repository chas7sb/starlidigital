"""Native SQLite automation kernel. All rows and transitions are company-bound.

The host owns authentication/authorization, credential verification and provider
transport. Missing dependencies fail closed; no demo connection becomes active.
"""
import asyncio
import json
import pathlib
import secrets
import time
from contextlib import contextmanager
from .common import Context, WorkerContext, Fault, need, exact, text, identifier, digest, encoded, envelope, public_error
from . import registry
from .n8n import EngineWorkflow

class Gateway:
    def __init__(self,store,*,permission,engine=None,connections=None,providers=None,clock=time.time,internal_companies=(),customer_entitlement=None):
        self.store,self.permission,self.engine,self.connections,self.providers,self.clock=store,permission,engine,connections,providers,clock
        self.engine_available=False
        self.shopify_orders=None
        self.internal_companies=frozenset(internal_companies)
        self.customer_entitlement=customer_entitlement
        with store.db() as db:
            db.executescript(pathlib.Path(__file__).with_name('schema.sql').read_text())
        from .feedback import Feedback
        self.feedback=Feedback(self)

    def context(self,session,company,room=None,bot=None,native_scope=None):
        from starli_agent_wake.principal import is_verified_principal
        need(session.kind=='jwt' or (native_scope is not None and is_verified_principal(session,self.store.authority,company)),'NATIVE_JWT_REQUIRED',401)
        with self.store.access(session,company,room) as (db,member,_):
            ctx=Context(member.company_id,member.user_id,member.binding,session,bot,room,native_scope)
            self.permission(ctx,db,'read')
            return ctx

    @contextmanager
    def access(self,ctx,permission='integrations.run',room=None):
        need(isinstance(ctx,Context),'SERVER_CONTEXT_REQUIRED')
        if isinstance(ctx,WorkerContext):
            with self.store.db() as db:
                workflow=db.execute("SELECT w.*,g.hash,g.state AS grant_state,g.version AS grant_version FROM sa_workflows w JOIN sa_grants g ON g.workflow=w.id AND g.company=w.company WHERE w.id=? AND w.company=?",(ctx.workflow,ctx.company)).fetchone()
                need(workflow is not None and workflow['state']=='ACTIVE' and workflow['grant_state']=='ACTIVE' and workflow['version']==workflow['grant_version']==ctx.workflow_version,'WORKFLOW_GRANT_REVOKED')
                need((workflow['actor'],workflow['binding'],workflow['room'],workflow['bot'])==(ctx.actor,ctx.binding,ctx.room,ctx.bot),'WORKFLOW_GRANT_CHANGED')
                member=self.store.authority.require_member(ctx.actor,ctx.company)
                need(member.binding==ctx.binding,'WORKFLOW_GRANT_REVOKED')
                self.store.room(db,member,ctx.room)
                need(ctx.bot is not None,'REQUESTING_NATIVE_BOT_REQUIRED')
                self.store.agent(db,member,ctx.room,ctx.bot)
                self.permission(ctx,db,permission)
                tenant=db.execute('SELECT enabled FROM sa_tenants WHERE company=?',(ctx.company,)).fetchone()
                need(tenant is not None and tenant['enabled']==1,'COMPANY_AUTOMATIONS_DISABLED')
                yield db
                self.permission(ctx,db,permission)
            return
        with self.store.access(ctx.session,ctx.company,room if room is not None else ctx.room) as (db,member,_):
            need((member.user_id,member.binding)==(ctx.actor,ctx.binding),'MEMBERSHIP_CHANGED')
            self.permission(ctx,db,permission)
            tenant=db.execute('SELECT * FROM sa_tenants WHERE company=?',(ctx.company,)).fetchone()
            if tenant is None:
                db.execute('INSERT INTO sa_tenants(company,namespace) VALUES(?,?)',(ctx.company,identifier()))
            else: need(tenant['enabled']==1,'COMPANY_AUTOMATIONS_DISABLED')
            yield db
            self.permission(ctx,db,permission)

    def worker_context(self,workflow):
        """Host-only worker admission from durable activation grant, no JWT clone."""
        with self.store.db(readonly=True) as db:
            row=db.execute('SELECT * FROM sa_workflows WHERE id=?',(workflow,)).fetchone()
            need(row is not None,'WORKFLOW_NOT_FOUND',404)
            ctx=WorkerContext(row['company'],row['actor'],row['binding'],None,row['bot'],row['room'],None,row['id'],row['version'])
        with self.access(ctx):pass
        return ctx

    def audit(self,db,ctx,kind,resource,detail=None):
        db.execute('INSERT INTO sa_audit VALUES(?,?,?,?,?,?,?)',(identifier(),ctx.company,ctx.actor,kind,resource,encoded(detail or {}),self.clock()))
        self.feedback.publish(db,ctx,resource)

    def row(self,db,ctx,table,ident):
        need(table in ('sa_drafts','sa_workflows','sa_executions','sa_approvals'),'INTERNAL_TABLE_DENIED',500)
        row=db.execute('SELECT * FROM '+table+' WHERE id=? AND company=?',(text(ident,128),ctx.company)).fetchone()
        need(row is not None,'RESOURCE_NOT_FOUND',404)
        room=row['room'] if 'room' in row.keys() else db.execute('SELECT room FROM sa_workflows WHERE id=? AND company=?',(row['workflow'],ctx.company)).fetchone()[0]
        need(ctx.room is None or ctx.room==room,'CONVERSATION_SCOPE_CHANGED')
        member=self.store.authority.require_member(ctx.actor,ctx.company)
        self.store.room(db,member,room)
        return row

    def can_manage(self,ctx):
        try:
            with self.access(ctx,'integrations.install'): pass
            return True
        except Exception: return False

    def connected(self,ctx,provider,db=None):
        if self.connections is None: return False
        return self.connections.ready(ctx,provider,db=db) is True

    async def health(self):
        try:
            self.engine_available=self.engine is not None and (await self.engine.health()).get('available') is True
        except Exception: self.engine_available=False
        return self.engine_available

    def catalog(self,ctx):
        with self.access(ctx): pass
        return envelope(ctx.company,connectors=registry.catalog(lambda p:self.connected(ctx,p)),engine={'available':self.engine_available},actions={'canManage':self.can_manage(ctx)},supportedIntents=['refund_request','shopify_order_slack_review','shopify_new_order_chat']+(['internal_approval_test'] if ctx.company in self.internal_companies else []))

    def draft_dto(self,ctx,row,db=None):
        config=json.loads(row['configuration']);missing=registry.missing(config,lambda p:self.connected(ctx,p,db))
        if db is not None:
            for item in missing:
                if item['id']=='approverId':item['options']=self.approver_options(ctx,db,row['room'])
        status='NEEDS_CONNECTION' if any(m['kind']=='connection' for m in missing) else 'DRAFT' if missing else 'READY'
        manage=self.can_manage(ctx) if db is None else self._permitted(ctx,db,'integrations.run')
        return envelope(ctx.company,id=row['id'],conversationId=row['room'],name=row['name'],revision=row['revision'],status=status,
                        intent=config.get('__kind','refund_request'),configuration={k:v for k,v in config.items() if not k.startswith('__')},summary=registry.summary(config),missing=missing,
                        **(self.feedback.linkage(db,ctx.company,'draft',row['id']) if db is not None else dict(requestingBotId=row['bot'])),
                        actions=dict(canManage=manage,canTest=bool(manage and row['bot'] and not missing and self.engine_available),
                                     canActivate=bool(manage and self._permitted(__import__('dataclasses').replace(ctx,bot=None),db,'integrations.install') and row['bot'] and not missing and self.engine_available and row['test_hash']==self.test_fingerprint(ctx,config,db)),canPause=False))

    def test_fingerprint(self,ctx,config,db):
        binding=[]
        if callable(getattr(self.connections,'fingerprint',None)):
            binding=self.connections.fingerprint(ctx,registry.required_providers(config),db)
        return digest([config,binding])

    def approval_fingerprint(self,ctx,event,config,db):
        bindings=[]
        if callable(getattr(self.connections,'action_bindings',None)):
            bindings=self.connections.action_bindings(ctx,registry.required_providers(config),db)
        return digest([event,bindings])

    def approver_options(self,ctx,db,room):
        schema=getattr(self.store.authority,'schema',None)
        if not isinstance(schema,str) or not __import__('re').fullmatch('[a-z][a-z_]{0,40}',schema):return []
        rows=db.execute('SELECT user_id,name FROM '+schema+".members WHERE company_id=? AND kind='person' AND active=1 ORDER BY name,user_id LIMIT 1001",(ctx.company,)).fetchall()
        need(len(rows)<=1000,'APPROVER_DIRECTORY_LIMIT',503)
        options=[]
        for row in rows:
            try:
                member=self.store.authority.require_member(row['user_id'],ctx.company);self.store.room(db,member,room)
                self.permission(Context(ctx.company,member.user_id,member.binding,ctx.session,None,room),db,'integrations.run')
                options.append(dict(value=member.user_id,label=row['name']))
            except Exception:continue
        return options

    def _permitted(self,ctx,db,permission):
        try: self.permission(ctx,db,permission);return True
        except Exception:return False

    def create_draft(self,ctx,form):
        exact(form,('conversationId','name','intent','configuration'),('botId',))
        if form.get('botId'):
            need(ctx.bot is None or ctx.bot==form['botId'],'BOT_SCOPE_CHANGED')
            ctx=__import__('dataclasses').replace(ctx,bot=text(form['botId'],128))
        need(form['intent'] in ('refund_request','internal_approval_test','shopify_order_slack_review','shopify_new_order_chat'),'UNSUPPORTED_INTENT',422)
        need(ctx.room is None or ctx.room==form['conversationId'],'CONVERSATION_SCOPE_CHANGED')
        config=registry.validate_configuration(form['configuration']);name=text(form['name'],160);now=self.clock();ident=identifier()
        if form['intent']=='shopify_new_order_chat':
            need(set(config)<={'requestSource','orderPlatform','notifySlack'} and config.get('requestSource','shopify')=='shopify' and config.get('orderPlatform','shopify')=='shopify' and config.get('notifySlack',False) is False,'INVALID_ORDER_NOTIFICATION_CONFIGURATION',422)
            config.update(__kind='shopify_new_order_chat',requestSource='shopify',orderPlatform='shopify',notifySlack=False)
        if form['intent']=='shopify_order_slack_review':
            need(set(config)<= {'approverId','slackChannelId','requestSource','orderPlatform','notifySlack'},'INVALID_ORDER_REVIEW_CONFIGURATION',422)
            config.update(__kind='shopify_order_slack_review',requestSource='starli',orderPlatform='shopify',notifySlack=False)
        if form['intent']=='internal_approval_test':
            need(ctx.company in self.internal_companies,'INTERNAL_TEST_UNAVAILABLE')
            need(set(config)<= {'approverId','requestSource','notifySlack'} and config.get('requestSource','starli')=='starli' and config.get('notifySlack',False) is False,'INVALID_INTERNAL_TEST_CONFIGURATION',422)
            config.update(__kind='internal_approval_test',requestSource='starli',notifySlack=False)
        with self.access(ctx,'integrations.run',form['conversationId']) as db:
            if ctx.bot:
                member=self.store.authority.require_member(ctx.actor,ctx.company)
                self.store.agent(db,member,form['conversationId'],ctx.bot)
            limit=db.execute('SELECT workflow_limit FROM sa_tenants WHERE company=?',(ctx.company,)).fetchone()[0]
            need(db.execute('SELECT count(*) FROM sa_drafts WHERE company=?',(ctx.company,)).fetchone()[0]<limit,'AUTOMATION_QUOTA_EXCEEDED',429)
            self._validate_approver(db,ctx,form['conversationId'],config)
            db.execute('INSERT INTO sa_drafts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,ctx.company,form['conversationId'],ctx.bot,ctx.actor,ctx.binding,name,1,encoded(config),None,'DRAFT',now,now))
            self.feedback.bind_draft(db,ctx,ident)
            self.audit(db,ctx,'draft.created',ident)
            return self.draft_dto(ctx,self.row(db,ctx,'sa_drafts',ident),db)

    def _validate_approver(self,db,ctx,room,config):
        if config.get('approverId'):
            person=self.store.authority.require_member(config['approverId'],ctx.company)
            self.store.room(db,person,room)
            self.permission(Context(ctx.company,person.user_id,person.binding,ctx.session,None,room),db,'integrations.run')

    def update_draft(self,ctx,ident,form):
        exact(form,('expectedRevision','configuration'))
        patch=registry.validate_configuration(form['configuration'])
        with self.access(ctx,'integrations.run') as db:
            old=self.row(db,ctx,'sa_drafts',ident);need(old['revision']==form['expectedRevision'],'REVISION_CONFLICT',409)
            config={**json.loads(old['configuration']),**patch};self._validate_approver(db,ctx,old['room'],config)
            if config.get('__kind')=='shopify_new_order_chat':need(not patch or set(patch)<={'requestSource','orderPlatform','notifySlack'} and config['requestSource']=='shopify' and config['orderPlatform']=='shopify' and config['notifySlack'] is False,'INVALID_ORDER_NOTIFICATION_CONFIGURATION',422)
            if config.get('__kind')=='internal_approval_test':
                need(set(patch)<={'approverId','requestSource','notifySlack'} and config['requestSource']=='starli' and config['notifySlack'] is False,'INVALID_INTERNAL_TEST_CONFIGURATION',422)
            if config.get('__kind')=='shopify_order_slack_review':need(set(patch)<={'approverId','slackChannelId'},'INVALID_ORDER_REVIEW_CONFIGURATION',422)
            db.execute("UPDATE sa_drafts SET configuration=?,revision=revision+1,test_hash=NULL,state='DRAFT',updated=? WHERE id=? AND company=?",(encoded(config),self.clock(),ident,ctx.company))
            self.audit(db,ctx,'draft.updated',ident)
            return self.draft_dto(ctx,self.row(db,ctx,'sa_drafts',ident),db)

    def list_drafts(self,ctx,room):
        with self.access(ctx,room=room) as db:
            rows=db.execute('SELECT * FROM sa_drafts WHERE company=? AND room=? ORDER BY updated DESC LIMIT 100',(ctx.company,room)).fetchall()
            return envelope(ctx.company,items=[self.draft_dto(ctx,row,db) for row in rows])

    async def test_draft(self,ctx,ident,form):
        exact(form,('expectedRevision',))
        with self.access(ctx,'integrations.run') as db:
            row=self.row(db,ctx,'sa_drafts',ident);need(row['revision']==form['expectedRevision'],'REVISION_CONFLICT',409)
            config=json.loads(row['configuration']);missing=registry.missing(config,lambda p:self.connected(ctx,p,db))
        available=await self.health()
        checks=[dict(id='configuration',status='PASSED' if not missing else 'BLOCKED'),dict(id='engine',status='PASSED' if available else 'BLOCKED')]
        checks.append(dict(id='requesting_bot',status='PASSED' if row['bot'] else 'BLOCKED',**({} if row['bot'] else {'reason':'REQUESTING_NATIVE_BOT_REQUIRED'})))
        supported=callable(getattr(self.providers,'supports',None))
        operations=[(config.get('orderPlatform'),'orders.get'),(config.get('orderPlatform'),'orders.refund'),(config.get('ticketPlatform'),'support.ticket.create')]
        if config.get('__kind')=='internal_approval_test':operations=[]
        if config.get('__kind')=='shopify_order_slack_review':operations=[('shopify','orders.get'),('slack','slack.message.send')]
        if config.get('__kind')=='shopify_new_order_chat':operations=[('shopify','orders.get'),('shopify','orders.subscribe')]
        if config.get('notifySlack'):operations.append(('slack','slack.approval.notify'))
        for provider,operation in operations:
            ok=supported and self.providers.supports(provider,operation) is True
            checks.append(dict(id=operation,status='PASSED' if ok else 'BLOCKED',**({} if ok else {'reason':'REVIEWED_CONNECTOR_UNAVAILABLE'})))
        trigger=config.get('requestSource')=='starli' or config.get('__kind')=='shopify_new_order_chat'
        checks.append(dict(id='trigger',status='PASSED' if trigger else 'BLOCKED',**({} if trigger else {'reason':'TRIGGER_NOT_CONFIGURED'})))
        # Non-destructive test verifies identity/scopes/account reachability only.
        if not missing and self.connections:
            for provider in registry.required_providers(config):
                try:
                    await self.connections.verify(ctx,provider,registry.workflow_scopes(config,provider))
                    checks.append(dict(id=provider,status='PASSED'))
                except Exception as error:checks.append(dict(id=provider,status='BLOCKED',reason=public_error(error)))
        if config.get('__kind')=='shopify_new_order_chat':
            try:
                need(self.shopify_orders is not None,'SHOPIFY_ORDER_NOTIFICATIONS_UNAVAILABLE',503)
                await self.shopify_orders.readiness(ctx)
                checks.append(dict(id='orders_create_access',status='PASSED'))
            except Exception as error:checks.append(dict(id='orders_create_access',status='BLOCKED',reason=public_error(error)))
        passed=all(c['status']=='PASSED' for c in checks)
        with self.access(ctx,'integrations.run') as db:
            row=self.row(db,ctx,'sa_drafts',ident);need(row['revision']==form['expectedRevision'],'REVISION_CONFLICT',409)
            if passed:db.execute('UPDATE sa_drafts SET test_hash=? WHERE id=? AND company=?',(self.test_fingerprint(ctx,config,db),ident,ctx.company))
            self.audit(db,ctx,'draft.tested',ident,{'passed':passed})
        return envelope(ctx.company,draftId=ident,revision=form['expectedRevision'],status='PASSED' if passed else 'BLOCKED',checks=checks,sideEffects=False)

    def workflow_dto(self,ctx,row,db):
        version=db.execute('SELECT ir FROM sa_versions WHERE workflow=? AND version=? AND company=?',(row['id'],row['version'],ctx.company)).fetchone()
        manage=self._permitted(ctx,db,'integrations.install')
        intent=json.loads(version['ir'])['kind']
        can_resume=intent=='shopify_new_order_chat' and row['state'] in ('PAUSED','UNCERTAIN') and (row['actor'],row['binding'])==(ctx.actor,ctx.binding) and manage
        return envelope(ctx.company,id=row['id'],draftId=row['draft'],conversationId=row['room'],name=row['name'],revision=row['revision'],workflowVersion=row['version'],status=row['state'],
                        intent=intent,triggerStatus=self.shopify_orders.status(db,ctx,row['id'],row['version']) if intent=='shopify_new_order_chat' and self.shopify_orders else None,summary=registry.summary(json.loads(version['ir'])['configuration']),actions=dict(canManage=manage,canTest=False,canActivate=False,canPause=manage and row['state']=='ACTIVE',canResume=can_resume,canRun=row['state']=='ACTIVE' and intent=='internal_approval_test' and ctx.company in self.internal_companies and self._permitted(ctx,db,'integrations.run')),**self.feedback.linkage(db,ctx.company,'version',row['id'],row['version']))

    async def run_internal_test(self,ctx,workflow,key,label):
        with self.access(ctx) as db:
            row=self.row(db,ctx,'sa_workflows',workflow)
            ir=json.loads(db.execute('SELECT ir FROM sa_versions WHERE workflow=? AND version=? AND company=?',(workflow,row['version'],ctx.company)).fetchone()[0])
            need(ir['kind']=='internal_approval_test' and ctx.company in self.internal_companies,'INTERNAL_TEST_UNAVAILABLE')
        return await self.ingest(ctx,workflow,key,{'label':text(label,200)})

    async def activate(self,ctx,ident,form):
        exact(form,('expectedRevision','authorizeActivation'))
        need(form['authorizeActivation'] is True,'ACTIVATION_AUTHORIZATION_REQUIRED')
        need(ctx.company in self.internal_companies or callable(self.customer_entitlement) and self.customer_entitlement(ctx.company) is True,'ACTIVATION_UNAVAILABLE',409)
        need(self.engine_available and self.engine is not None,'ENGINE_UNAVAILABLE',503)
        now=self.clock();workflow=identifier();path=secrets.token_hex(24);prior_mapping=None
        with self.access(ctx,'integrations.install') as db:
            draft=self.row(db,ctx,'sa_drafts',ident);need(draft['revision']==form['expectedRevision'],'REVISION_CONFLICT',409)
            config=json.loads(draft['configuration']);need(not registry.missing(config,lambda p:self.connected(ctx,p,db)),'AUTOMATION_SETUP_INCOMPLETE',409)
            need(draft['test_hash']==self.test_fingerprint(ctx,config,db),'NON_DESTRUCTIVE_TEST_REQUIRED',409)
            need(draft['bot'],'REQUESTING_NATIVE_BOT_REQUIRED',409)
            # Management API context may omit bot; the recorded exact bot is
            # checked at activation and every durable worker admission.
            botctx=__import__('dataclasses').replace(ctx,bot=draft['bot'])
            self.permission(botctx,db,'integrations.run')
            self.store.agent(db,self.store.authority.require_member(ctx.actor,ctx.company),draft['room'],draft['bot'])
            ir=registry.compile_ir(config)
            prior=db.execute('SELECT * FROM sa_workflows WHERE company=? AND draft=?',(ctx.company,ident)).fetchone()
            version=1
            if prior:
                need(prior['state'] in ('ACTIVE','PAUSED'),'WORKFLOW_TRANSITION_PENDING',409)
                need(not db.execute("SELECT 1 FROM sa_executions WHERE company=? AND workflow=? AND state IN ('QUEUED','RUNNING','WAITING_FOR_HUMAN')",(ctx.company,prior['id'])).fetchone(),'WORKFLOW_EXECUTIONS_PENDING',409)
                workflow=prior['id'];version=prior['version']+1
                if prior['engine_id']:prior_mapping=EngineWorkflow(prior['engine_id'],prior['engine_path'])
                db.execute("UPDATE sa_workflows SET version=?,state='PROVISIONING',engine_id=NULL,engine_path=?,revision=revision+1,actor=?,binding=?,updated=? WHERE id=? AND company=?",(version,path,ctx.actor,ctx.binding,now,workflow,ctx.company))
                db.execute("UPDATE sa_engine_resources SET state='PAUSED' WHERE company=? AND workflow=?",(ctx.company,workflow))
            else:db.execute('INSERT INTO sa_workflows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(workflow,ctx.company,ident,draft['room'],draft['bot'],ctx.actor,ctx.binding,draft['name'],version,'PROVISIONING',None,path,1,now,now))
            db.execute('INSERT INTO sa_versions VALUES(?,?,?,?,?,?)',(workflow,version,ctx.company,encoded(ir),digest(ir),now))
            self.feedback.bind_version(db,ctx,workflow,version,ident)
            db.execute('INSERT INTO sa_grants VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workflow) DO UPDATE SET version=excluded.version,actor=excluded.actor,binding=excluded.binding,hash=excluded.hash,state=excluded.state,created=excluded.created',(workflow,ctx.company,version,ctx.actor,ctx.binding,digest(ir),'ACTIVE',now))
            self.audit(db,ctx,'workflow.activation.authorized',workflow,{'draftRevision':draft['revision']})
        mapped=None
        try:
            if prior_mapping:await self.engine.pause_workflow(prior_mapping)
            mapped=await self.engine.create_workflow(workflow,version,path)
            with self.access(ctx,'integrations.install') as db:
                current=self.row(db,ctx,'sa_workflows',workflow)
                need(current['state']=='PROVISIONING','WORKFLOW_CHANGED',409)
                db.execute('UPDATE sa_workflows SET engine_id=? WHERE id=? AND company=?',(mapped.id,workflow,ctx.company))
                db.execute('INSERT INTO sa_engine_resources VALUES(?,?,?,?,?,?)',(ctx.company,workflow,version,mapped.id,mapped.path,'PROVISIONING'))
            await self.engine.activate_workflow(mapped)
            if ir['kind']=='shopify_new_order_chat':
                need(self.shopify_orders is not None,'SHOPIFY_ORDER_NOTIFICATIONS_UNAVAILABLE',503)
                await self.shopify_orders.activate(ctx,workflow,version)
            with self.access(ctx,'integrations.install') as db:
                current=self.row(db,ctx,'sa_workflows',workflow)
                need(current['state']=='PROVISIONING','WORKFLOW_CHANGED',409)
                # Refresh connection validity before making Starli ingress active.
                need(not registry.missing(config,lambda p:self.connected(ctx,p,db)),'CONNECTION_CHANGED')
                db.execute("UPDATE sa_workflows SET state='ACTIVE',updated=? WHERE id=? AND company=?",(self.clock(),workflow,ctx.company))
                db.execute("UPDATE sa_engine_resources SET state='ACTIVE' WHERE company=? AND workflow=? AND version=?",(ctx.company,workflow,version))
                self.audit(db,ctx,'workflow.activated',workflow)
                return self.workflow_dto(ctx,self.row(db,ctx,'sa_workflows',workflow),db)
        except BaseException:
            with self.store.db() as db:
                db.execute("UPDATE sa_workflows SET state='UNCERTAIN',updated=? WHERE id=? AND company=?",(self.clock(),workflow,ctx.company))
                if ir['kind']=='shopify_new_order_chat' and self.shopify_orders:self.shopify_orders.close_local(db,ctx.company,workflow,'DISABLED')
                self.feedback.publish(db,ctx,workflow)
            if mapped:
                try:await self.engine.pause_workflow(mapped)
                except Exception:pass
            raise

    def list_workflows(self,ctx):
        with self.access(ctx) as db:
            items=[]
            for row in db.execute('SELECT * FROM sa_workflows WHERE company=? ORDER BY updated DESC LIMIT 100',(ctx.company,)):
                try:self.row(db,ctx,'sa_workflows',row['id']);items.append(self.workflow_dto(ctx,row,db))
                except Exception:continue
            return envelope(ctx.company,items=items)

    async def pause(self,ctx,ident,form):
        exact(form,('expectedRevision',))
        with self.access(ctx,'integrations.install') as db:
            row=self.row(db,ctx,'sa_workflows',ident);need(row['revision']==form['expectedRevision'],'REVISION_CONFLICT',409)
            db.execute("UPDATE sa_workflows SET state='PAUSED',revision=revision+1,updated=? WHERE id=? AND company=?",(self.clock(),ident,ctx.company))
            db.execute("UPDATE sa_schedules SET state='PAUSED' WHERE company=? AND workflow=?",(ctx.company,ident))
            db.execute("UPDATE sa_grants SET state='REVOKED' WHERE company=? AND workflow=?",(ctx.company,ident))
            if self.shopify_orders:self.shopify_orders.close_local(db,ctx.company,ident)
            self.audit(db,ctx,'workflow.paused',ident)
            mapped=EngineWorkflow(row['engine_id'],row['engine_path']) if row['engine_id'] else None
        if mapped:
            try:await self.engine.pause_workflow(mapped)
            except Exception:pass  # Starli ingress is already closed durably.
        if self.shopify_orders:
            try:await self.shopify_orders.remove(ctx,ident)
            except Exception:pass
        with self.access(ctx) as db:return self.workflow_dto(ctx,self.row(db,ctx,'sa_workflows',ident),db)

    async def resume(self,ctx,ident,form):
        exact(form,('expectedRevision','authorizeActivation'))
        need(form['authorizeActivation'] is True,'ACTIVATION_AUTHORIZATION_REQUIRED')
        need(self.shopify_orders is not None and self.engine is not None,'SHOPIFY_ORDER_NOTIFICATIONS_UNAVAILABLE',503)
        with self.access(ctx,'integrations.install') as db:
            row=self.row(db,ctx,'sa_workflows',ident);need(row['revision']==form['expectedRevision'],'REVISION_CONFLICT',409)
            need(row['state'] in ('PAUSED','UNCERTAIN') and (row['actor'],row['binding'])==(ctx.actor,ctx.binding),'WORKFLOW_RESUME_DENIED')
            ir=json.loads(db.execute('SELECT ir FROM sa_versions WHERE workflow=? AND version=? AND company=?',(ident,row['version'],ctx.company)).fetchone()[0])
            need(ir['kind']=='shopify_new_order_chat','WORKFLOW_RESUME_UNSUPPORTED',409)
            self.permission(__import__('dataclasses').replace(ctx,bot=row['bot']),db,'integrations.run')
            self.store.agent(db,self.store.authority.require_member(ctx.actor,ctx.company),row['room'],row['bot'])
            mapped=EngineWorkflow(row['engine_id'],row['engine_path']);version=row['version']
        await self.shopify_orders.readiness(ctx)
        with self.access(ctx,'integrations.install') as db:
            current=self.row(db,ctx,'sa_workflows',ident);need(current['revision']==form['expectedRevision'] and current['state'] in ('PAUSED','UNCERTAIN'),'REVISION_CONFLICT',409)
            db.execute("UPDATE sa_workflows SET state='PROVISIONING',revision=revision+1,updated=? WHERE id=? AND company=?",(self.clock(),ident,ctx.company))
            self.audit(db,ctx,'workflow.resume.authorized',ident)
        try:
            await self.engine.activate_workflow(mapped)
            await self.shopify_orders.activate(ctx,ident,version)
            with self.access(ctx,'integrations.install') as db:
                current=self.row(db,ctx,'sa_workflows',ident);need(current['state']=='PROVISIONING','WORKFLOW_CHANGED',409)
                db.execute("UPDATE sa_workflows SET state='ACTIVE',updated=? WHERE id=? AND company=?",(self.clock(),ident,ctx.company))
                db.execute("UPDATE sa_grants SET state='ACTIVE' WHERE workflow=? AND company=? AND version=?",(ident,ctx.company,version))
                self.audit(db,ctx,'workflow.resumed',ident)
                return self.workflow_dto(ctx,self.row(db,ctx,'sa_workflows',ident),db)
        except BaseException:
            with self.store.db() as db:
                db.execute("UPDATE sa_workflows SET state='UNCERTAIN' WHERE id=? AND company=?",(ident,ctx.company))
                self.shopify_orders.close_local(db,ctx.company,ident,'DISABLED');self.feedback.publish(db,ctx,ident)
            try:await self.engine.pause_workflow(mapped)
            except Exception:pass
            raise

    def execution_dto(self,ctx,row,db):
        fields=dict(id=row['id'],workflowId=row['workflow'],workflowVersion=row['version'],status=row['state'],createdAt=row['created'],updatedAt=row['updated'])
        if row['approval']:fields['approvalId']=row['approval']
        if row['receipt']:fields['receipt']=json.loads(row['receipt'])
        if row['receipt'] and 'orderSummary' in json.loads(row['receipt']):fields['orderSummary']=json.loads(row['receipt'])['orderSummary']
        if row['error']:fields['errorCode']=row['error']
        return envelope(ctx.company,**fields,**self.feedback.linkage(db,ctx.company,'execution',row['id'],row['version']))

    def history(self,ctx,workflow):
        with self.access(ctx) as db:
            self.row(db,ctx,'sa_workflows',workflow)
            rows=db.execute('SELECT * FROM sa_executions WHERE company=? AND workflow=? ORDER BY created DESC LIMIT 100',(ctx.company,workflow)).fetchall()
            return envelope(ctx.company,items=[self.execution_dto(ctx,row,db) for row in rows])

    async def ingest(self,ctx,workflow,key,event):
        text(key,180)
        now=self.clock();ident=identifier()
        with self.access(ctx) as db:
            row=self.row(db,ctx,'sa_workflows',workflow);need(row['state']=='ACTIVE','WORKFLOW_NOT_ACTIVE',409)
            definition=json.loads(db.execute('SELECT ir FROM sa_versions WHERE workflow=? AND version=? AND company=?',(workflow,row['version'],ctx.company)).fetchone()[0])
            if definition['kind']=='shopify_new_order_chat':
                exact(event,('orderId',));text(event['orderId'],200)
                need(isinstance(ctx,WorkerContext),'VERIFIED_SHOPIFY_EVENT_REQUIRED')
            elif definition['kind']=='shopify_order_slack_review':
                exact(event,('orderId','content'));text(event['orderId'],200);text(event['content'],3000)
            elif definition['kind']=='internal_approval_test':
                need(ctx.company in self.internal_companies,'INTERNAL_TEST_UNAVAILABLE')
                exact(event,('label',));text(event['label'],200)
            else:
                exact(event,('orderId','amount','currency','paymentProvider','store'))
                for value in event.values():text(value,200)
                need(__import__('re').fullmatch(r'[0-9]+\.[0-9]{2}',event['amount']) and __import__('decimal').Decimal(event['amount'])>0,'INVALID_AMOUNT',422)
                need(__import__('re').fullmatch('[A-Z]{3}',event['currency']),'INVALID_CURRENCY',422)
            old=db.execute('SELECT * FROM sa_executions WHERE company=? AND workflow=? AND event_key=?',(ctx.company,workflow,key)).fetchone()
            if old:
                need(old['input_hash']==digest(event),'WEBHOOK_REPLAY_CONFLICT',409)
                return self.execution_dto(ctx,old,db)
            quota=db.execute('SELECT active_limit FROM sa_tenants WHERE company=?',(ctx.company,)).fetchone()[0]
            need(db.execute("SELECT count(*) FROM sa_executions WHERE company=? AND state IN ('RUNNING','WAITING_FOR_HUMAN','QUEUED')",(ctx.company,)).fetchone()[0]<quota,'EXECUTION_QUOTA_EXCEEDED',429)
            db.execute('INSERT INTO sa_executions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,ctx.company,workflow,row['version'],key,digest(event),encoded(event),'QUEUED',None,None,None,None,now,now))
            db.execute('INSERT INTO sa_jobs(id,company,execution,kind,state,next) VALUES(?,?,?,?,?,?)',(identifier(),ctx.company,ident,'lookup','PENDING',now))
            self.feedback.bind_execution(db,ctx,ident,workflow,row['version'],force_notification=definition['kind']=='shopify_new_order_chat')
            self.audit(db,ctx,'execution.ingested',ident)
            return self.execution_dto(ctx,self.row(db,ctx,'sa_executions',ident),db)

    def approval_dto(self,ctx,row,db):
        pending=row['state']=='PENDING' and row['expires']>self.clock()
        decide=pending and row['approver']==ctx.actor and row['binding']==ctx.binding and self._permitted(ctx,db,'integrations.run')
        return envelope(ctx.company,id=row['id'],conversationId=row['room'],workflowId=row['workflow'],workflowVersion=row['version'],executionId=row['execution'],status='EXPIRED' if row['state']=='PENDING' and not pending else row['state'],action='internal_test_receipt' if set(json.loads(row['parameters']))=={'label'} else 'slack_message_send' if 'slackWorkspaceId' in json.loads(row['parameters']) else 'refund_or_ticket',parameters=json.loads(row['parameters']),approverId=row['approver'],expiresAt=row['expires'],createdAt=row['created'],decisionAt=row['decided'],decisionOrigin=row['origin'],canDecide=decide,**self.feedback.linkage(db,ctx.company,'execution',row['execution'],row['version']))

    def list_approvals(self,ctx,room):
        with self.access(ctx,room=room) as db:
            self._expire(db,ctx.company)
            rows=db.execute('SELECT * FROM sa_approvals WHERE company=? AND room=? ORDER BY created DESC LIMIT 100',(ctx.company,room)).fetchall()
            return envelope(ctx.company,items=[self.approval_dto(ctx,row,db) for row in rows])

    def _expire(self,db,company):
        expired=[r[0] for r in db.execute("SELECT execution FROM sa_approvals WHERE company=? AND state='PENDING' AND expires<=?",(company,self.clock()))]
        db.execute("UPDATE sa_approvals SET state='EXPIRED' WHERE company=? AND state='PENDING' AND expires<=?",(company,self.clock()))
        db.execute("UPDATE sa_executions SET state='FAILED',error='APPROVAL_EXPIRED',updated=? WHERE company=? AND state='WAITING_FOR_HUMAN' AND approval IN (SELECT id FROM sa_approvals WHERE company=? AND state='EXPIRED')",(self.clock(),company,company))
        for execution in expired:self.feedback.cleanup(db,company,execution)

    def decide(self,ctx,ident,form,origin='starli'):
        exact(form,('decision','expectedStatus'))
        need(form['expectedStatus']=='PENDING' and form['decision'] in ('refund','ticket','reject','approve'),'INVALID_DECISION',422)
        need(origin in ('starli','slack'),'INVALID_DECISION_ORIGIN',422)
        with self.access(ctx) as db:
            self._expire(db,ctx.company)
            row=self.row(db,ctx,'sa_approvals',ident)
            parameters=json.loads(row['parameters']);approval_only=set(parameters)=={'label'} or 'slackWorkspaceId' in parameters
            need(form['decision'] in (('approve','reject') if approval_only else ('refund','ticket','reject')),'INVALID_DECISION',422)
            need(row['state']=='PENDING' and row['expires']>self.clock(),'APPROVAL_NOT_PENDING',409)
            need((row['approver'],row['binding'])==(ctx.actor,ctx.binding),'APPROVER_DENIED')
            execution=self.row(db,ctx,'sa_executions',row['execution']);need(execution['state']=='WAITING_FOR_HUMAN','EXECUTION_NOT_WAITING',409)
            workflow=self.row(db,ctx,'sa_workflows',row['workflow']);need(workflow['state']=='ACTIVE','WORKFLOW_NOT_ACTIVE',409)
            state='REJECTED' if form['decision']=='reject' else 'APPROVED'
            db.execute('UPDATE sa_approvals SET state=?,decision=?,origin=?,decided=? WHERE id=? AND company=? AND state=?',(state,form['decision'],origin,self.clock(),ident,ctx.company,'PENDING'))
            if state=='APPROVED':
                db.execute('INSERT INTO sa_authorizations VALUES(?,?,?,?,?,?,?,NULL)',(identifier(),ctx.company,row['execution'],ident,row['hash'],form['decision'],min(row['expires'],self.clock()+120)))
                db.execute('INSERT INTO sa_jobs(id,company,execution,kind,state,next) VALUES(?,?,?,?,?,?)',(identifier(),ctx.company,row['execution'],'decision','PENDING',self.clock()))
            else:db.execute("UPDATE sa_executions SET state='CANCELLED',updated=? WHERE id=? AND company=?",(self.clock(),row['execution'],ctx.company))
            self.audit(db,ctx,'approval.decided',ident,{'decision':form['decision'],'origin':origin})
            return self.approval_dto(ctx,self.row(db,ctx,'sa_approvals',ident),db)

    def recover(self):
        """Crash recovery never repeats attempted external operations."""
        with self.store.db() as db:
            # Notifications perform only safe reads/opaque engine coordination
            # before one atomic idempotent native message settlement.
            db.execute("UPDATE sa_operations SET state='RETRY_SAFE' WHERE kind='notify' AND state='INTENT'")
            db.execute("UPDATE sa_executions SET state='QUEUED' WHERE id IN (SELECT execution FROM sa_operations WHERE kind='notify' AND state='RETRY_SAFE')")
            db.execute("UPDATE sa_operations SET state='UNKNOWN',error='PROCESS_RESTARTED',updated=? WHERE state='INTENT'",(self.clock(),))
            db.execute("UPDATE sa_executions SET state='UNCERTAIN',error='EXTERNAL_OUTCOME_UNKNOWN',updated=? WHERE id IN (SELECT execution FROM sa_operations WHERE state='UNKNOWN')",(self.clock(),))
            db.execute("UPDATE sa_jobs SET state='DEAD',error='EXTERNAL_OUTCOME_UNKNOWN' WHERE execution IN (SELECT id FROM sa_executions WHERE state='UNCERTAIN')")
            db.execute("UPDATE sa_jobs SET state='PENDING' WHERE state='RUNNING' AND execution NOT IN (SELECT id FROM sa_executions WHERE state='UNCERTAIN')")
            db.execute("UPDATE sa_workflows SET state='UNCERTAIN' WHERE state='PROVISIONING'")
            db.execute("UPDATE sa_notifications SET state='UNKNOWN' WHERE state='INTENT'")
            db.execute("UPDATE sa_jobs SET state='PENDING' WHERE state='CLAIMED'")
            db.execute("UPDATE sa_connections SET state='REAUTH_REQUIRED' WHERE state='REFRESHING'")
            db.execute("UPDATE sa_oauth SET state='FAILED',verifier=NULL WHERE state='EXCHANGING'")
            for row in db.execute("SELECT id,company FROM sa_executions WHERE state='UNCERTAIN'").fetchall():self.feedback.cleanup(db,row['company'],row['id'])

    async def reconcile(self,ctx,execution_id):
        need(callable(getattr(self.providers,'reconcile',None)),'RECONCILIATION_UNAVAILABLE',503)
        with self.access(ctx,'integrations.install') as db:
            execution=self.row(db,ctx,'sa_executions',execution_id)
            need(execution['state']=='UNCERTAIN','EXECUTION_NOT_UNCERTAIN',409)
            operation=db.execute("SELECT * FROM sa_operations WHERE company=? AND execution=? AND kind='decision' AND state='UNKNOWN'",(ctx.company,execution_id)).fetchone()
            need(operation is not None,'RECONCILIATION_UNAVAILABLE',409)
            approval=self.row(db,ctx,'sa_approvals',execution['approval'])
            version=db.execute('SELECT ir FROM sa_versions WHERE workflow=? AND version=? AND company=?',(execution['workflow'],execution['version'],ctx.company)).fetchone()
            config=json.loads(version['ir'])['configuration'];event=json.loads(execution['input'])
        result=await self.providers.reconcile(ctx,config,event,approval['decision'],operation['id'])
        need(result.get('verified') is True and result.get('resourceId'),'EXTERNAL_OUTCOME_UNRESOLVED',409)
        receipt=dict(status='VERIFIED',operation=approval['decision'],resourceId=str(result['resourceId']),verifiedAt=self.clock())
        with self.access(ctx,'integrations.install') as db:
            current=self.row(db,ctx,'sa_executions',execution_id);need(current['state']=='UNCERTAIN','EXECUTION_CHANGED',409)
            db.execute("UPDATE sa_executions SET state='COMPLETED',receipt=?,error=NULL,updated=? WHERE id=? AND company=?",(encoded(receipt),self.clock(),execution_id,ctx.company))
            db.execute("UPDATE sa_operations SET state='SUCCEEDED',result=?,error=NULL,updated=? WHERE id=? AND company=?",(encoded(receipt),self.clock(),operation['id'],ctx.company))
            self.audit(db,ctx,'execution.reconciled',execution_id,receipt)
            return self.execution_dto(ctx,self.row(db,ctx,'sa_executions',execution_id),db)

    async def cancel(self,ctx,execution_id):
        with self.access(ctx,'integrations.install') as db:
            execution=self.row(db,ctx,'sa_executions',execution_id)
            need(execution['state'] in ('QUEUED','WAITING_FOR_HUMAN','RUNNING'),'EXECUTION_NOT_CANCELLABLE',409)
            attempted=db.execute("SELECT 1 FROM sa_operations WHERE company=? AND execution=? AND kind='decision' AND state IN ('INTENT','UNKNOWN')",(ctx.company,execution_id)).fetchone()
            state='UNCERTAIN' if attempted else 'CANCELLED'
            db.execute('UPDATE sa_executions SET state=?,error=?,updated=? WHERE id=? AND company=?',(state,'STOP_OUTCOME_UNKNOWN' if attempted else None,self.clock(),execution_id,ctx.company))
            db.execute("UPDATE sa_approvals SET state='CANCELLED' WHERE company=? AND execution=? AND state='PENDING'",(ctx.company,execution_id))
            db.execute('UPDATE sa_authorizations SET expires=? WHERE company=? AND execution=?',(self.clock(),ctx.company,execution_id))
            db.execute("UPDATE sa_jobs SET state='DEAD',error='EXECUTION_CANCELLED' WHERE company=? AND execution=? AND state NOT IN ('DONE','DEAD')",(ctx.company,execution_id))
            self.audit(db,ctx,'execution.cancelled',execution_id,{'confirmedStopped':not bool(attempted)})
            return {**self.execution_dto(ctx,self.row(db,ctx,'sa_executions',execution_id),db),'confirmedStopped':not bool(attempted)}

    async def advance(self,ctx,execution_id):
        """Worker context must be freshly reconstructed by the native host.

        OAuth never creates this authority. Host must recheck current company,
        creator incarnation, bot permissions and authorized workflow on each run.
        """
        if self.shopify_orders and self.shopify_orders.is_notification(ctx,execution_id):return await self.shopify_orders.advance(ctx,execution_id)
        with self.access(ctx) as db:
            execution=self.row(db,ctx,'sa_executions',execution_id);workflow=self.row(db,ctx,'sa_workflows',execution['workflow'])
            need(workflow['state']=='ACTIVE','WORKFLOW_NOT_ACTIVE',409)
            need((workflow['actor'],workflow['binding'])==(ctx.actor,ctx.binding),'WORKFLOW_GRANT_REVOKED')
            need(execution['state'] in ('QUEUED','WAITING_FOR_HUMAN'),'EXECUTION_NOT_RUNNABLE',409)
            ir=json.loads(db.execute('SELECT ir FROM sa_versions WHERE workflow=? AND version=? AND company=?',(workflow['id'],execution['version'],ctx.company)).fetchone()[0])
            config=ir['configuration'];event=json.loads(execution['input'])
            internal=ir['kind']=='internal_approval_test'
            order_review=ir['kind']=='shopify_order_slack_review'
            need(not internal or ctx.company in self.internal_companies,'INTERNAL_TEST_UNAVAILABLE')
            need(internal or self.providers is not None and self.connections is not None,'CONNECTOR_UNAVAILABLE',503)
            need(not registry.missing(config,lambda p:self.connected(ctx,p,db)),'CONNECTION_CHANGED')
            kind='lookup' if execution['state']=='QUEUED' else 'decision'
            decision=None
            if kind=='decision':
                grant=db.execute('SELECT * FROM sa_authorizations WHERE company=? AND execution=?',(ctx.company,execution_id)).fetchone()
                need(grant is not None and grant['expires']>self.clock() and grant['consumed'] is None,'ACTION_AUTHORIZATION_UNAVAILABLE',409)
                approval=self.row(db,ctx,'sa_approvals',grant['approval'])
                action_parameters=json.loads(approval['parameters']) if order_review else event
                need(approval['state']=='APPROVED' and approval['expires']>self.clock() and approval['hash']==grant['hash']==self.approval_fingerprint(ctx,action_parameters,config,db),'ACTION_AUTHORIZATION_CHANGED')
                current=self.store.authority.require_member(approval['approver'],ctx.company)
                need(current.binding==approval['binding'],'APPROVER_MEMBERSHIP_REVOKED')
                approver_ctx=Context(ctx.company,current.user_id,current.binding,ctx.session,None,ctx.room)
                # Permission callback must authorize the named member, not use
                # session.user_id as a substitute for this fresh permission read.
                self.permission(approver_ctx,db,'integrations.run')
                decision=grant['decision']
            operation=identifier();fingerprint=digest([kind,event,decision,execution['version']])
            old=db.execute('SELECT * FROM sa_operations WHERE company=? AND execution=? AND kind=?',(ctx.company,execution_id,kind)).fetchone()
            need(old is None,'OPERATION_ALREADY_ATTEMPTED',409)
            db.execute('INSERT INTO sa_operations VALUES(?,?,?,?,?,?,?,?,?,?)',(operation,ctx.company,execution_id,kind,fingerprint,'INTENT',None,None,self.clock(),self.clock()))
            if kind=='decision':db.execute('UPDATE sa_authorizations SET consumed=? WHERE id=? AND company=? AND consumed IS NULL',(self.clock(),grant['id'],ctx.company))
            db.execute("UPDATE sa_executions SET state='RUNNING',updated=? WHERE id=? AND company=?",(self.clock(),execution_id,ctx.company))
            self.feedback.publish(db,ctx,execution_id)
            db.execute("UPDATE sa_jobs SET state='RUNNING',attempts=attempts+1 WHERE company=? AND execution=? AND kind=?",(ctx.company,execution_id,kind))
            mapped=EngineWorkflow(workflow['engine_id'],workflow['engine_path'])
        attempted=False
        try:
            if kind=='lookup':
                receipt=await self.engine.execute_workflow(mapped,execution_id)
                if internal:
                    proof=await self.engine.get_execution(mapped,receipt['id'])
                    need(proof.get('status') in ('success','COMPLETED'),'INTERNAL_ENGINE_RECEIPT_UNVERIFIED',502)
                with self.access(ctx) as db:
                    current=self.row(db,ctx,'sa_executions',execution_id);need(current['state']=='RUNNING','EXECUTION_CANCELLED')
                    db.execute('UPDATE sa_executions SET engine_execution=? WHERE id=? AND company=?',(receipt['id'],execution_id,ctx.company))
                if order_review:
                    reviewed=await self.providers.review_order(ctx,event)
                    action_parameters={**reviewed,'slackChannelId':config['slackChannelId'],'content':event['content']}
                elif not internal:
                    result=await self.providers.lookup(ctx,config,event)
                    need(type(result)is dict and result.get('orderId')==event['orderId'] and result.get('store')==event['store'],'ORDER_NOT_FOUND',404)
                    need(result.get('currency')==event['currency'] and result.get('paymentProvider')==event['paymentProvider'],'ORDER_BINDING_CHANGED')
                    need(result.get('eligible') is True,'REFUND_NOT_ELIGIBLE',409)
                if not order_review:action_parameters=event
                with self.access(ctx) as db:
                    current=self.row(db,ctx,'sa_executions',execution_id);need(current['state']=='RUNNING','EXECUTION_CANCELLED')
                    person=self.store.authority.require_member(config['approverId'],ctx.company);self.store.room(db,person,workflow['room'])
                    approval=identifier();now=self.clock()
                    db.execute('INSERT INTO sa_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(approval,ctx.company,workflow['room'],workflow['id'],execution['version'],execution_id,workflow['bot'],person.user_id,person.binding,encoded(action_parameters),self.approval_fingerprint(ctx,action_parameters,config,db),'PENDING',None,None,now,now+3600,None))
                    db.execute("UPDATE sa_executions SET state='WAITING_FOR_HUMAN',approval=?,updated=? WHERE id=? AND company=?",(approval,now,execution_id,ctx.company))
                    for channel in (['starli','slack'] if config.get('notifySlack') else ['starli']):
                        db.execute('INSERT INTO sa_notifications VALUES(?,?,?,?,?,?,?,?,?)',(identifier(),ctx.company,workflow['room'],person.user_id,person.binding,approval,channel,'PENDING',now))
                    self.audit(db,ctx,'approval.requested',approval)
            else:
                # Provider adapter receives a reauthorization callback and exact
                # immutable event, never arbitrary n8n JSON or source history.
                def fence():
                    with self.access(ctx) as db:
                        current=self.row(db,ctx,'sa_executions',execution_id);active=self.row(db,ctx,'sa_workflows',workflow['id'])
                        need(current['state']=='RUNNING' and active['state']=='ACTIVE','EXECUTION_CANCELLED')
                        p=self.row(db,ctx,'sa_approvals',approval['id'])
                        need(p['state']=='APPROVED' and p['hash']==self.approval_fingerprint(ctx,action_parameters,config,db) and p['expires']>self.clock() and grant['expires']>self.clock(),'ACTION_AUTHORIZATION_EXPIRED')
                        member=self.store.authority.require_member(p['approver'],ctx.company);need(member.binding==p['binding'],'APPROVER_MEMBERSHIP_REVOKED')
                        self.permission(Context(ctx.company,member.user_id,member.binding,ctx.session,None,ctx.room),db,'integrations.run')
                fence();attempted=not internal
                if internal:
                    need(decision=='approve','INVALID_DECISION')
                    with self.access(ctx) as db:
                        db.execute('INSERT INTO sa_internal_receipts VALUES(?,?,?,?,?,?,?)',(operation,ctx.company,execution_id,execution['version'],approval['id'],execution['engine_execution'],self.clock()))
                        need(db.execute('SELECT 1 FROM sa_internal_receipts WHERE id=? AND company=?',(operation,ctx.company)).fetchone(),'INTERNAL_RECEIPT_UNVERIFIED')
                    result={'verified':True,'resourceId':'internal-test:'+operation}
                else:result=await self.providers.perform(ctx,config,action_parameters,decision,operation,fence)
                need(type(result)is dict and result.get('verified') is True and result.get('resourceId'),'PROVIDER_RECEIPT_UNVERIFIED',502)
                safe=dict(status='VERIFIED',operation='internal_test_receipt' if internal else 'slack_message_send' if order_review else decision,resourceId=str(result['resourceId']),verifiedAt=self.clock())
                with self.access(ctx) as db:
                    db.execute("UPDATE sa_executions SET state='COMPLETED',receipt=?,updated=? WHERE id=? AND company=?",(encoded(safe),self.clock(),execution_id,ctx.company))
                    self.audit(db,ctx,'execution.completed',execution_id,safe)
            with self.access(ctx) as db:
                db.execute("UPDATE sa_operations SET state='SUCCEEDED',result=?,updated=? WHERE id=? AND company=?",(encoded({'verified':True}),self.clock(),operation,ctx.company))
                db.execute("UPDATE sa_jobs SET state='DONE' WHERE company=? AND execution=? AND kind=?",(ctx.company,execution_id,kind))
                return self.execution_dto(ctx,self.row(db,ctx,'sa_executions',execution_id),db)
        except BaseException as error:
            unknown=attempted
            with self.store.db() as db:
                db.execute('UPDATE sa_operations SET state=?,error=?,updated=? WHERE id=? AND company=?',('UNKNOWN' if unknown else 'FAILED',public_error(error),self.clock(),operation,ctx.company))
                db.execute('UPDATE sa_executions SET state=?,error=?,updated=? WHERE id=? AND company=?',('UNCERTAIN' if unknown else 'FAILED','EXTERNAL_OUTCOME_UNKNOWN' if unknown else public_error(error),self.clock(),execution_id,ctx.company))
                db.execute("UPDATE sa_jobs SET state='DEAD',error=? WHERE company=? AND execution=? AND kind=?",(public_error(error),ctx.company,execution_id,kind))
                self.feedback.publish(db,ctx,execution_id)
            raise
