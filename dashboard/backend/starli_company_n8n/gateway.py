"""Durable ownership and one-shot human admission; never a raw MCP proxy.

The native automation gateway supplies real membership/incarnation checks on
every transaction. Engine identifiers and private project metadata never cross
the public DTO boundary. Unknown mutations are held for reconciliation.
"""
import json, secrets, time
from starli_automations.common import need, encoded, digest
from starli_n8n_mcp.compiler import compile_graph, resolve_specs
from starli_n8n_mcp.lifecycle import verify_owned_definition,verify_bound_definition,definition_proof,fixed_settings_operations

SCHEMA='''CREATE TABLE IF NOT EXISTS sn_graphs(
 id TEXT PRIMARY KEY, company TEXT NOT NULL, room TEXT NOT NULL,
 actor TEXT NOT NULL, binding TEXT NOT NULL, bot TEXT NOT NULL,
 revision INTEGER NOT NULL, state TEXT NOT NULL, graph TEXT NOT NULL,
 hash TEXT NOT NULL, engine TEXT, engine_version TEXT, receipt TEXT,
 created REAL NOT NULL, updated REAL NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS sn_engine_owner ON sn_graphs(engine) WHERE engine IS NOT NULL;
'''
PURE=frozenset('manualTrigger set if switch merge noOp'.split())

class Gateway:
    def __init__(self,native,client,installed,clock=time.time):
        self.native,self.client,self.installed,self.clock=native,client,installed,clock
        self.bind_feedback=False
        with native.store.db() as db:db.executescript(SCHEMA)

    def row(self,db,ctx,ident):
        row=db.execute('SELECT * FROM sn_graphs WHERE id=? AND company=? AND room=?',(ident,ctx.company,ctx.room)).fetchone()
        need(row is not None,'WORKFLOW_NOT_FOUND',404)
        need((row['actor'],row['binding'])==(ctx.actor,ctx.binding),'WORKFLOW_OWNER_CHANGED')
        return row

    def dto(self,row,can_run=False):
        return dict(version='starli.company-n8n.v1',id=row['id'],companyId=row['company'],conversationId=row['room'],
                    botId=row['bot'],revision=row['revision'],state=row['state'],graphHash=row['hash'],
                    graph=json.loads(row['graph']),receipt=({'status':json.loads(row['receipt'])['status']} if row['receipt'] else None),
                    capabilities={'externalConnectors':False,'backgroundTriggers':False,'humanRunApproval':True})

    def propose(self,ctx,graph):
        need(ctx.bot and ctx.room and ctx.native_scope is not None,'REQUESTING_NATIVE_BOT_REQUIRED')
        raw=encoded(graph)
        need(type(graph)is dict and type(graph.get('nodes'))is list,'GRAPH_REQUIRED',422)
        # Executable policy is narrower than the discovery catalog. Expanding
        # this requires fresh company credentials and provider-effect fences.
        need(all(type(n)is dict and n.get('type','').startswith('n8n-nodes-base.') and n['type'].rsplit('.',1)[-1] in PURE for n in graph['nodes']),'CONNECTOR_EXECUTION_NOT_ENABLED',409)
        ident=secrets.token_hex(16);now=self.clock()
        with self.native.access(ctx) as db:
            db.execute('INSERT INTO sn_graphs VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)',
                       (ident,ctx.company,ctx.room,ctx.actor,ctx.binding,ctx.bot,'DRAFT',raw,digest(graph),None,None,None,now,now))
            if self.bind_feedback:
                from .feedback import bind
                bind(self,db,ctx,ident)
            return self.public(ctx,self.row(db,ctx,ident),db)

    def public(self,ctx,row,db=None):
        value=self.dto(row)
        allowed=False
        if ctx.bot is None and ctx.native_scope is None:
            try:
                if db is not None:self.native.permission(ctx,db,'integrations.install')
                else:
                    with self.native.access(ctx,'integrations.install'):pass
                allowed=True
            except Exception:pass
        value['actions']={'canRun':allowed}
        return value

    def get(self,ctx,ident):
        with self.native.access(ctx) as db:return self.public(ctx,self.row(db,ctx,ident),db)

    def claim(self,ctx,ident,revision,source,target,permission='integrations.run'):
        with self.native.access(ctx,permission) as db:
            row=self.row(db,ctx,ident)
            need(row['revision']==revision and row['state']==source,'WORKFLOW_REVISION_CHANGED',409)
            changed=db.execute('UPDATE sn_graphs SET state=?,revision=revision+1,updated=? WHERE id=? AND revision=? AND state=?',
                               (target,self.clock(),ident,revision,source)).rowcount
            need(changed==1,'WORKFLOW_REVISION_CHANGED',409)
            return dict(self.row(db,ctx,ident))

    def finish(self,ctx,ident,expected,state,**values):
        need(set(values)<={'engine','engine_version','receipt'},'INTERNAL_FIELDS_REQUIRED',500)
        with self.native.access(ctx) as db:
            row=self.row(db,ctx,ident);need(row['state']==expected,'WORKFLOW_STATE_CHANGED',409)
            fields={'state':state,'updated':self.clock(),**values}
            db.execute('UPDATE sn_graphs SET '+','.join(k+'=?'for k in fields)+' WHERE id=?',(*fields.values(),ident))
            if self.bind_feedback:
                origin=db.execute('SELECT message,room FROM sn_graph_origins WHERE graph=?',(ident,)).fetchone()
                if origin:self.native.store.event(db,origin['room'],'message.updated',origin['message'])
            return self.public(ctx,self.row(db,ctx,ident),db)

    def call(self,name,args):return self.client.content(self.client.call(name,args))

    def validate(self,ctx,ident,revision):
        row=self.claim(ctx,ident,revision,'DRAFT','VALIDATING')
        try:
            graph=json.loads(row['graph']);specs,_=resolve_specs(self.client,self.installed,graph['nodes'])
            compiled=compile_graph(graph,self.installed,specs)
            result=self.call('validate_workflow',{'code':compiled.code})
            need(type(result)is dict and result.get('valid')is True,'WORKFLOW_VALIDATION_FAILED',422)
            # Ownership intent is durable before create; an ambiguous response
            # is never retried automatically or adopted by matching a name.
            with self.native.access(ctx) as db:
                self.row(db,ctx,ident)
                db.execute('UPDATE sn_graphs SET engine_version=? WHERE id=?',(compiled.workflow_nonce,ident))
            created=self.call('create_workflow_from_code',{'code':compiled.code,'versionName':'Starli reviewed draft'})
            need(type(created)is dict and type(created.get('workflowId'))is str,'WORKFLOW_CREATE_UNCONFIRMED',409)
            engine=created['workflowId']
            with self.native.access(ctx) as db:
                self.row(db,ctx,ident);db.execute('UPDATE sn_graphs SET engine=? WHERE id=?',(engine,ident))
            need(created.get('name')==compiled.workflow_name and created.get('autoAssignedCredentials')==[],'WORKFLOW_CREDENTIAL_ASSIGNMENT_DENIED',409)
            details=self.call('get_workflow_details',{'workflowId':engine})
            initial=verify_owned_definition(details,engine,compiled,graph,settings_phase='created',allow_private_mcp_exposure=True)
            node_ids=definition_proof(initial)['nodeIds']
            # Only fixed host constants are allowed through this update method.
            with self.native.access(ctx) as db:self.row(db,ctx,ident)
            self.call('update_workflow',{'workflowId':engine,'operations':fixed_settings_operations()})
            details=self.call('get_workflow_details',{'workflowId':engine})
            workflow=verify_owned_definition(details,engine,compiled,graph,expected_node_ids=node_ids,allow_private_mcp_exposure=True)
            return self.finish(ctx,ident,'VALIDATING','VALIDATED',engine_version=encoded(definition_proof(workflow)))
        except BaseException:
            # Includes cancellation after the engine may have committed.
            with self.native.store.db() as db:
                db.execute("UPDATE sn_graphs SET state='UNKNOWN',updated=? WHERE id=? AND company=? AND state='VALIDATING'",(self.clock(),ident,ctx.company))
            raise

    def recover(self):
        with self.native.store.db() as db:
            db.execute("UPDATE sn_graphs SET state='UNKNOWN',updated=? WHERE state IN ('VALIDATING','RUNNING')",(self.clock(),))

    def refresh(self,ctx,ident):
        with self.native.access(ctx) as db:row=dict(self.row(db,ctx,ident))
        if row['state']!='RUNNING' or not row['receipt']:return self.public(ctx,row)
        execution=json.loads(row['receipt'])['execution']
        result=self.call('get_workflow_execution',{'workflowId':row['engine'],'executionId':execution,'includeData':False})
        record=result.get('execution') if type(result)is dict else None
        # Missing execution history is not success and does not cause a rerun.
        if record is None:return self.get(ctx,ident)
        need(type(record)is dict and str(record.get('id'))==execution,'WORKFLOW_EXECUTION_BINDING_CHANGED',409)
        if 'workflowId'in record:need(record['workflowId']==row['engine'],'WORKFLOW_EXECUTION_BINDING_CHANGED',409)
        state={'success':'COMPLETED','error':'FAILED','canceled':'CANCELED','crashed':'UNKNOWN'}.get(record.get('status'))
        if state:return self.finish(ctx,ident,'RUNNING',state,receipt=encoded({'execution':execution,'status':state}))
        return self.get(ctx,ident)

    def run_once(self,ctx,ident,revision,reviewed_hash):
        # Only a real native human session may approve the exact reviewed graph.
        # The bot cannot synthesize this permission by calling another tool.
        need(ctx.native_scope is None and ctx.bot is None,'HUMAN_REVIEW_REQUIRED')
        with self.native.access(ctx,'integrations.install') as db:
            row=self.row(db,ctx,ident)
            need(row['hash']==reviewed_hash,'WORKFLOW_REVIEW_CHANGED',409)
        row=self.claim(ctx,ident,revision,'VALIDATED','RUNNING','integrations.install')
        try:
            details=self.call('get_workflow_details',{'workflowId':row['engine']})
            verify_bound_definition(details,json.loads(row['engine_version']),json.loads(row['graph']),allow_private_mcp_exposure=True)
            # Fresh native membership/role check immediately before engine effect.
            with self.native.access(ctx,'integrations.install') as db:self.row(db,ctx,ident)
            started=self.call('execute_workflow',{'workflowId':row['engine'],'executionMode':'manual'})
            need(type(started)is dict and type(started.get('executionId'))is str,'WORKFLOW_EXECUTION_UNCONFIRMED',409)
            # This is an admission receipt, never a claimed successful result.
            return self.finish(ctx,ident,'RUNNING','RUNNING',receipt=encoded({'execution':started['executionId'],'status':'STARTED'}))
        except BaseException:
            with self.native.store.db() as db:
                db.execute("UPDATE sn_graphs SET state='UNKNOWN',updated=? WHERE id=? AND company=? AND state='RUNNING'",(self.clock(),ident,ctx.company))
            raise
