"""Instance adapter for already registered native graph routes and feedback cards."""
import starli_portable as _portable
import asyncio,json
from . import CompanyWideCompiler,PrivateAdminResolver,freeze,thaw,SCHEMA
from .company import need,digest
from .policy import DeploymentPolicy
from starli_connector_execution.executor import ConnectorExecutor
from starli_company_n8n.gateway import Gateway
from starli_automations.common import encoded

class UniversalGateway(Gateway):
    def compiler(self,resolver):return CompanyWideCompiler(self.client,self.installed,resolver,self.deployment_policy.rules())
    def dto(self,row,can_run=False):
        dto=super().dto(row,can_run);dto['capabilities']['externalConnectors']=True
        return dto
    def propose(self,ctx,graph):
        try:return self._propose(ctx,graph)
        except Exception as error:
            # Safe diagnostics only: never format the exception message, graph,
            # parameters, context/session or credential/engine identifiers.
            import logging,re
            code=getattr(error,'code',None)
            if type(code)is not str or re.fullmatch('[A-Za-z0-9_]{1,96}',code) is None:code='UNCLASSIFIED'
            logging.getLogger('starli_priority_gateway').error('GRAPH_PLAN_FAILURE type=%s code=%s',type(error).__name__,code)
            raise
    def _propose(self,ctx,graph):
        need(ctx.bot is not None and ctx.native_scope is not None,'REQUESTING_NATIVE_BOT_REQUIRED')
        need(type(graph)is dict and set(graph)=={'nodes','edges'},'GRAPH_REQUIRED')
        policy=self.deployment_policy.rules()
        need(all(type(n)is dict and n.get('type') in policy for n in graph['nodes']),'CONNECTOR_POLICY_REQUIRED')
        # Persist on the original native table so native assistant origin/card
        # binding, owner, incarnation, chat and exact public hash are unchanged.
        import secrets
        ident=secrets.token_hex(16);now=self.clock();raw=encoded(graph)
        with self.native.access(ctx) as db:
            db.execute('INSERT INTO sn_graphs VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)',(ident,ctx.company,ctx.room,ctx.actor,ctx.binding,ctx.bot,'DRAFT',raw,digest(graph),None,None,None,now,now))
            if self.bind_feedback:
                from starli_company_n8n.feedback import bind
                bind(self,db,ctx,ident)
            return self.public(ctx,self.row(db,ctx,ident),db)
    def validate(self,ctx,ident,revision):
        need(ctx.bot is not None and ctx.native_scope is not None,'NATIVE_EXECUTION_SCOPE_REQUIRED')
        row=self.claim(ctx,ident,revision,'DRAFT','VALIDATING')
        try:
            bound=asyncio.run(self.compiler(self.connections).compile(ctx,json.loads(row['graph'])))
            self.deployment_policy.check(bound)
            with self.native.access(ctx) as db:
                self.row(db,ctx,ident)
                db.execute('INSERT INTO priority_graphs VALUES(?,?,?,?,?,?,?,?,?,NULL)',(ident,ctx.company,ctx.room,ctx.actor,ctx.binding,ctx.bot,'REVIEW',bound.review_hash,freeze(bound)))
                db.execute('UPDATE sn_graphs SET hash=? WHERE id=?',(bound.review_hash,ident))
            return self.finish(ctx,ident,'VALIDATING','VALIDATED')
        except BaseException as error:
            # Compilation invokes only metadata/schema validation, never engine
            # creation or execution. Its known failures can safely be repaired.
            with self.native.store.db() as db:
                current=db.execute('SELECT state FROM sn_graphs WHERE id=? AND company=?',(ident,ctx.company)).fetchone()
                if current and current['state']=='VALIDATING':
                    db.execute('DELETE FROM priority_graphs WHERE id=? AND company=?',(ident,ctx.company))
                    db.execute("UPDATE sn_graphs SET state='DRAFT',hash=? WHERE id=? AND company=?",(row['hash'],ident,ctx.company))
            from starli_n8n_mcp.client import BridgeError
            from starli_automations.common import Fault
            known=isinstance(error,BridgeError) or isinstance(error,Fault) and error.code in ('COMPANY_CREDENTIAL_CHANGED','ENGINE_CREDENTIAL_OWNERSHIP_CHANGED','COMPANY_CONNECTION_NOT_FOUND')
            if known:
                import re
                code=getattr(error,'code','VALIDATION_REJECTED')
                if type(code)is not str or re.fullmatch('[A-Za-z0-9_]{1,96}',code)is None:code='VALIDATION_REJECTED'
                with self.native.access(ctx) as db:
                    fresh=self.row(db,ctx,ident)
                    if fresh['state']!='DRAFT':raise error
                    return dict(isError=True,status='REJECTED',state='DRAFT',id=ident,revision=fresh['revision'],effectsStarted=False,error={'code':code,'message':'Graph validation failed before execution. Inspect native schemas, repair the graph or company connection, and submit a new plan. This graph remains DRAFT.'})
            raise
    def private_bound(self,ctx,ident):
        with self.native.access(ctx,'integrations.install') as db:
            row=self.row(db,ctx,ident)
            private=db.execute('SELECT * FROM priority_graphs WHERE id=? AND company=?',(ident,ctx.company)).fetchone()
            need(private is not None and private['hash']==row['hash'],'BOUND_GRAPH_REQUIRED')
            return dict(row),thaw(private['private_json'])
    def executor(self,ctx,row,bound):
        resolver=PrivateAdminResolver(self.connections,row['bot'])
        compiler=self.compiler(resolver);policy=self.deployment_policy
        original_client=compiler.client
        class GuardedClient:
            def content(self,value):return original_client.content(value)
            def call(self,name,args):
                policy.check(bound);resolver.fence(ctx)
                return original_client.call(name,args)
        compiler.client=GuardedClient()
        async def fence(*args):resolver.fence(ctx);return policy.check(bound)
        async def worker(*args):return policy.check(bound)
        def journal(event,data):
            # Original executor durable mutation intent, without public IDs.
            with self.native.store.db() as db:
                db.execute('INSERT INTO priority_journal(graph,event,private_json) VALUES(?,?,?)',(row['id'],event,json.dumps(data)))
        return ConnectorExecutor(compiler,fence=fence,worker_ready=worker,journal=journal)
    def run_once(self,ctx,ident,revision,reviewed_hash):
        need(ctx.bot is None and ctx.native_scope is None and ctx.session.kind=='jwt','HUMAN_REVIEW_REQUIRED')
        row,bound=self.private_bound(ctx,ident)
        need(row['hash']==reviewed_hash==bound.review_hash,'WORKFLOW_REVIEW_CHANGED')
        row=self.claim(ctx,ident,revision,'VALIDATED','RUNNING','integrations.install')
        async def run():
            executor=self.executor(ctx,row,bound)
            ref=await executor.prepare(ctx,bound,reviewed_hash)
            started=await executor.run(ctx,bound,ref)
            with self.native.access(ctx,'integrations.install') as db:
                self.row(db,ctx,ident)
                db.execute('UPDATE priority_graphs SET receipt_json=? WHERE id=?',(json.dumps(dict(ref=ref,started=started)),ident))
            return started
        try:
            asyncio.run(run())
            return self.finish(ctx,ident,'RUNNING','RUNNING',receipt=encoded({'status':'STARTED'}))
        except BaseException:
            with self.native.store.db() as db:db.execute("UPDATE sn_graphs SET state='UNKNOWN' WHERE id=? AND state='RUNNING'",(ident,))
            raise
    async def execute_standing(self,bound,graph):
        from starli_agent_wake.principal import is_verified_principal
        need(is_verified_principal(bound.session,self.native.store.authority,bound.context.company_id),'SEALED_AUTOMATION_GRANT_REQUIRED')
        need(bound.native_scope is not None,'NATIVE_EXECUTION_SCOPE_REQUIRED')
        bound.check()
        ctx=self.native.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope)
        def fresh():
            bound.check()
            need(is_verified_principal(bound.session,self.native.store.authority,ctx.company),'SEALED_AUTOMATION_GRANT_REQUIRED')
            with self.native.access(ctx,'integrations.run'):pass
        fresh()
        proposed=await asyncio.to_thread(self.propose,ctx,graph)
        validated=await asyncio.to_thread(self.validate,ctx,proposed['id'],proposed['revision'])
        if validated.get('isError'):return validated
        ident=proposed['id']
        row=self.claim(ctx,ident,validated['revision'],'VALIDATED','RUNNING','integrations.run')
        with self.native.access(ctx) as db:
            private=db.execute('SELECT * FROM priority_graphs WHERE id=? AND company=?',(ident,ctx.company)).fetchone()
            frozen=thaw(private['private_json'])
        compiler=self.compiler(self.connections);original_client=compiler.client;policy=self.deployment_policy
        class StandingClient:
            def content(self,value):return original_client.content(value)
            def call(self,name,args):fresh();policy.check(frozen);return original_client.call(name,args)
        compiler.client=StandingClient()
        async def fence(*args):fresh();return policy.check(frozen)
        async def worker(*args):fresh();return policy.check(frozen)
        def journal(event,data):
            with self.native.store.db() as db:db.execute('INSERT INTO priority_journal VALUES(?,?,?)',(ident,event,json.dumps(data)))
        executor=ConnectorExecutor(compiler,fence=fence,worker_ready=worker,journal=journal)
        try:
            ref=await executor.prepare(ctx,frozen,frozen.review_hash)
            started=await executor.run(ctx,frozen,ref)
            with self.native.access(ctx) as db:
                self.row(db,ctx,ident)
                db.execute('UPDATE priority_graphs SET receipt_json=? WHERE id=?',(json.dumps(dict(ref=ref,started=started)),ident))
                db.execute('UPDATE sn_graphs SET receipt=? WHERE id=?',(encoded({'status':'STARTED'}),ident))
            result={'status':'PENDING'}
            for attempt in range(6):
                fresh();result=await executor.receipt(ctx,frozen,ref,started)
                if result['status']!='PENDING':break
                await asyncio.sleep(1)
            output=await self.result(ctx,ident,publish=result['status']!='PENDING')
            if result['status']!='PENDING':self.finish(ctx,ident,'RUNNING',result['status'],receipt=encoded({'status':result['status']}))
            return output
        except BaseException:
            with self.native.store.db() as db:db.execute("UPDATE sn_graphs SET state='UNKNOWN' WHERE id=? AND state='RUNNING'",(ident,))
            raise

    async def result(self,ctx,ident,publish=False):
        human=ctx.bot is None
        need((human and ctx.session.kind=='jwt' and ctx.native_scope is None) or (ctx.bot is not None and ctx.native_scope is not None),'NATIVE_RESULT_SCOPE_REQUIRED')
        permission='integrations.install' if human else 'integrations.run'
        with self.native.access(ctx,permission) as db:
            row=dict(self.row(db,ctx,ident))
            need(human or row['bot']==ctx.bot,'ORIGINAL_BOT_REQUIRED')
            private=db.execute('SELECT * FROM priority_graphs WHERE id=? AND company=?',(ident,ctx.company)).fetchone()
            need(private is not None and private['hash']==row['hash'] and private['receipt_json'],'EXACT_EXECUTION_REQUIRED')
            bound=thaw(private['private_json']);saved=json.loads(private['receipt_json'])
        resolver=PrivateAdminResolver(self.connections,row['bot']) if human else self.connections
        compiler=self.compiler(resolver)
        async def fence():
            with self.native.access(ctx,permission) as db:self.row(db,ctx,ident)
            if human:resolver.fence(ctx)
            await compiler.refresh_bindings(ctx,bound);self.deployment_policy.check(bound)
        await fence()
        from .company import verify_definition
        ref=saved['ref'];started=saved['started']
        need(ref['companyId']==started['companyId']==ctx.company and ref['reviewHash']==started['reviewHash']==bound.review_hash and started['workflowId']==ref['proof']['workflowId'],'RESULT_SCOPE_CHANGED')
        details=await asyncio.to_thread(self.call,'get_workflow_details',{'workflowId':started['workflowId']})
        verify_definition(details,started['workflowId'],bound,proof=ref['proof'])
        await fence()
        response=await asyncio.to_thread(self.call,'get_workflow_execution',{'workflowId':started['workflowId'],'executionId':started['executionId'],'includeData':True,'nodeNames':list(bound.compiled.node_names.values()),'truncateData':20})
        execution=response.get('execution') if type(response)is dict else None
        need(type(execution)is dict and str(execution.get('id'))==started['executionId'] and execution.get('workflowId')==started['workflowId'] and execution.get('mode')=='manual','RESULT_EXECUTION_CHANGED')
        await fence()
        # Actual MCP contract keeps node data beside execution identity. Normalize
        # only after verifying that identity against the private saved receipt.
        execution=dict(execution)
        if response.get('data') is not None:
            need(type(response['data'])is dict,'RESULT_DATA_INVALID')
            execution['data']=response['data']
        from .results import outputs,safe_failure
        hidden=[started['workflowId'],started['executionId']]
        for lease in bound.bindings.values():hidden.extend([lease['credentialId'],lease['credentialName']])
        result=dict(graphId=ident,status={'success':'COMPLETED','error':'FAILED','canceled':'CANCELED'}.get(execution.get('status'),'PENDING'),outputs=outputs(execution,list(bound.compiled.node_names.values()),hidden),externalBusinessReceiptVerified=False)
        if result['status']=='FAILED':
            failure=safe_failure(execution,hidden)
            if failure:result['failure']=failure
        raw=encoded(result)
        with self.native.access(ctx,permission) as db:
            self.row(db,ctx,ident)
            db.execute('INSERT INTO priority_results VALUES(?,?,?,?) ON CONFLICT(graph) DO UPDATE SET output_json=excluded.output_json',(ident,ctx.company,ctx.room,raw))
            if publish and result['status']!='PENDING':
                import uuid
                message=str(uuid.uuid5(uuid.NAMESPACE_URL,'starli:workflow-result:'+ctx.company+':'+ident))
                self.native.feedback.new_message(db,ctx,row['room'],row['bot'],message,'Workflow result: '+raw)
        return result

    def refresh(self,ctx,ident):
        with self.native.access(ctx) as db:row=dict(self.row(db,ctx,ident))
        if row['state']!='RUNNING':return self.public(ctx,row)
        # Bot status may read bounded state; actual engine polling is human only.
        if ctx.bot is not None:return self.public(ctx,row)
        row,bound=self.private_bound(ctx,ident)
        with self.native.access(ctx,'integrations.install') as db:
            private=db.execute('SELECT receipt_json FROM priority_graphs WHERE id=?',(ident,)).fetchone()
        need(private and private['receipt_json'],'EXECUTION_RECEIPT_REQUIRED')
        saved=json.loads(private['receipt_json'])
        result=asyncio.run(self.executor(ctx,row,bound).receipt(ctx,bound,saved['ref'],saved['started']))
        if result['status']=='PENDING':return self.public(ctx,row)
        asyncio.run(self.result(ctx,ident,publish=True))
        return self.finish(ctx,ident,'RUNNING',result['status'],receipt=encoded({'status':result['status']}))

def install_production(app,runtime,policy_path=_portable.config_file('n8n-execution-policy.json')):
    need(runtime is app.state.company_bot_runtime,'NATIVE_RUNTIME_MISMATCH')
    existing=app.state.starli_company_n8n
    need(type(existing)is Gateway,'EXACT_NATIVE_GATEWAY_REQUIRED')
    connections=app.state.starli_engine_connections
    need(existing.native is connections.gateway,'CONNECTION_GATEWAY_MISMATCH')
    policy=DeploymentPolicy(policy_path);policy.read()
    # Existing route and tool closures retain this single explicitly selected
    # app-owned instance; no class/global compiler methods are monkeypatched.
    existing.connections=connections;existing.deployment_policy=policy
    from pathlib import Path
    metadata=json.loads((Path(__import__('starli_company_n8n').__file__).parent/'connector-catalog.json').read_text())['connectors']
    existing.installed={node['id']:node for node in metadata}
    with existing.native.store.db() as db:
        db.executescript(SCHEMA+'CREATE TABLE IF NOT EXISTS priority_journal(graph TEXT NOT NULL,event TEXT NOT NULL,private_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS priority_results(graph TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,output_json TEXT NOT NULL);')
    existing.__class__=UniversalGateway
    from dataclasses import replace
    graph_example={'nodes':[{'id':'start','type':'n8n-nodes-base.manualTrigger','version':1,'parameters':{}},{'id':'finish','type':'n8n-nodes-base.noOp','version':1,'parameters':{}}],'edges':[{'from':'start','to':'finish'}]}
    graph_guidance='graphJson is a JSON STRING decoding to exactly {"nodes":[...],"edges":[...]}. No graph/workflow wrapper and no connections root key. Each node requires id,type,version,parameters; optional connection is exactly {handle,credentialType,expectedRevision}. Each edge is {from,to,output?}, using node ids and optional integer output 0..15. Exactly one manualTrigger; supported native node types and exact schemas come from discovery. Example: '+json.dumps(graph_example,separators=(',',':'))
    descriptions={
        'company_workflow_graph_plan':'Build a dynamic native nodes/edges graph using discovered schemas and the protected installed-node policy. Use symbolic company connections {handle, credentialType, expectedRevision}; never credentials or engine IDs. External effects require exact human Run review. Literal public HTTPS requests require authentication=none and options.redirect.redirect.followRedirects=false. No code, expressions, files, admin nodes or automatic triggers.',
        'company_workflow_graph_validate':'Compile and validate the exact saved graph and current company connection revisions against native SDK schemas. Saves a private exact binding and returns the review hash. Creates no engine workflow and runs no provider operation; human Run performs one-shot prepare and execution.'}
    for name,description in descriptions.items():
        spec=runtime.company_tools.specs.get(name)
        need(spec is not None,'NATIVE_TOOL_REGISTRATION_REQUIRED')
        runtime.company_tools.specs[name]=replace(spec,description=description+(' '+graph_guidance if name=='company_workflow_graph_plan' else ''))
    # Reject malformed graph input before any proposal transaction. Return a
    # settled tool error so the model can repair its shape in this same run.
    plan_spec=runtime.company_tools.specs['company_workflow_graph_plan']
    original_plan=plan_spec.handler
    def graph_plan(bound,args):
        from .shape import graph_shape_error,rejection
        bound.check()
        try:graph=json.loads(args['graphJson'],parse_constant=lambda value:(_ for _ in ()).throw(ValueError()))
        except (ValueError,TypeError):return rejection('GRAPH_JSON_REQUIRED')
        code=graph_shape_error(graph)
        if code:return rejection(code)
        # Only errors guaranteed before proposal persistence are settled here.
        # Authorization, database and other unknown outcomes still propagate.
        try:return original_plan(bound,args)
        except Exception as error:
            if getattr(error,'code',None) in ('GRAPH_REQUIRED','CONNECTOR_POLICY_REQUIRED','GRAPH_JSON_REQUIRED','INVALID_INPUT','INPUT_LIMIT'):
                return rejection(error.code)
            raise
    parameters=dict(plan_spec.parameters);properties=dict(parameters['properties'])
    properties['graphJson']={**properties['graphJson'],'description':graph_guidance}
    parameters['properties']=properties
    runtime.company_tools.specs['company_workflow_graph_plan']=replace(plan_spec,handler=graph_plan,parameters=parameters)
    from starli_company_tools.core import ToolSpec,obj
    def list_connections(bound,args):
        bound.check()
        ctx=connections.gateway.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope)
        with connections.gateway.access(ctx,'integrations.run') as db:
            rows=db.execute("SELECT id,type,name,revision,state FROM ecc_connections WHERE company=? AND state='STORED_NOT_VERIFIED' ORDER BY id LIMIT 500",(ctx.company,)).fetchall()
            return dict(version='starli.company-connections-list.v1',companyId=ctx.company,items=[dict(handle=row['id'],credentialType=row['type'],displayName=row['name'],expectedRevision=row['revision'],status=row['state'],scopeVerification='NOT_AVAILABLE') for row in rows])
    async def workflow_execute(bound,args):
        from starli_agent_wake.principal import is_verified_principal
        need(is_verified_principal(bound.session,existing.native.store.authority,bound.context.company_id),'SEALED_AUTOMATION_GRANT_REQUIRED')
        try:graph=json.loads(args['graphJson'])
        except (ValueError,TypeError):need(False,'GRAPH_JSON_REQUIRED')
        return await existing.execute_standing(bound,graph)
    runtime.company_tools.register(ToolSpec('company_workflow_execute','Build and execute a dynamic native graph ONLY inside a genuine approved standing automation grant and its current native bot run. Ordinary human-turn bot sessions cannot execute this tool. Returns bounded redacted real outputs; no invented provider completion. Uses current company connections and protected native-node/network policy.',obj({'graphJson':{'type':'string','minLength':2,'maxLength':50000}}),'write','starli-priority-gateway',workflow_execute,'integrations.run'))
    async def workflow_result(bound,args):
        bound.check()
        ctx=existing.native.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope)
        return await existing.result(ctx,args['workflowId'])
    from starli_company_tools.core import ID
    runtime.company_tools.register(ToolSpec('company_workflow_result','Read bounded redacted JSON output from the exact owned execution in this original bot/company/chat. No engine identifiers, secrets, binaries or workflow definitions. Engine completion is not independent provider verification.',obj({'workflowId':ID}),'read','starli-priority-gateway',workflow_result,'integrations.run'))
    runtime.company_tools.register(ToolSpec('company_connections_list','List reusable stored company connection handles, credential types and current revisions for dynamic graphs. Stored means not provider verified. No secrets or engine identifiers. Use connection {handle,credentialType,expectedRevision} on credentialed graph nodes.',obj({}),'read','starli-priority-gateway',list_connections,'integrations.run'))
    return existing
