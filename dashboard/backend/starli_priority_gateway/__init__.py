"""Private generic integration; no per-flow handlers and no public readiness flags."""
import starli_portable as _portable
import json,secrets
from dataclasses import asdict
from types import SimpleNamespace
from starli_n8n_mcp.compiler import CompiledGraph
from .company import CompanyCompiler,BoundGraph,need,public_review

class CompanyWideCompiler(CompanyCompiler):
    """Origin bot/chat are audit provenance; the resolver supplies current authority."""
    @staticmethod
    def check_lease(ctx,lease,connection,rule):
        # Retain every upstream ownership/revision/schema/scope check. Replace only
        # the obsolete equality to credential request provenance, on a copy.
        checked=dict(lease)
        checked.update(requestedByBotId=ctx.bot,sourceConversationId=ctx.room)
        CompanyCompiler.check_lease(ctx,checked,connection,rule)

class PrivateAdminResolver:
    """Resolve under genuine human authority, then independently fence acting bot."""
    def __init__(self,connections,acting_bot):
        self.connections=connections;self.native=connections.gateway;self.acting_bot=acting_bot
    def fence(self,ctx):
        need(ctx.bot is None and ctx.native_scope is None and ctx.session.kind=='jwt','genuine_human_run_required')
        with self.native.access(ctx,'integrations.install') as db:
            member=self.native.store.authority.require_member(ctx.actor,ctx.company)
            need(member.binding==ctx.binding,'human_membership_changed')
            self.native.store.room(db,member,ctx.room)
            self.native.store.agent(db,member,ctx.room,self.acting_bot)
            # Permission uses the real admin session, current bot, and actual room.
            # This is a private permission check, never a fabricated native scope.
            actor=SimpleNamespace(**vars(ctx));actor.bot=self.acting_bot
            self.native.permission(actor,db,'integrations.run')
    async def resolve(self,ctx,handle,credential_type,expected_revision):
        self.fence(ctx)
        if hasattr(self.connections,'source_fence'):self.connections.source_fence(ctx,handle)
        with self.native.access(ctx,'integrations.install') as db:
            row=db.execute('SELECT * FROM ecc_connections WHERE id=? AND company=?',(handle,ctx.company)).fetchone()
            need(row is not None,'company_connection_not_found');row=dict(row)
            need(row['state']=='STORED_NOT_VERIFIED' and row['revision']==expected_revision and row['type']==credential_type,'company_credential_changed')
        metadata=await self.connections.api.metadata(row['engine_id'])
        need(type(metadata)is dict and (metadata.get('id'),metadata.get('name'),metadata.get('type'))==(row['engine_id'],row['engine_name'],credential_type),'engine_credential_ownership_changed')
        self.fence(ctx)
        if hasattr(self.connections,'source_fence'):self.connections.source_fence(ctx,handle)
        with self.native.access(ctx,'integrations.install') as db:
            fresh=db.execute('SELECT * FROM ecc_connections WHERE id=? AND company=?',(handle,ctx.company)).fetchone()
            need(fresh is not None and dict(fresh)==row,'company_credential_changed')
        return dict(credentialId=row['engine_id'],credentialName=row['engine_name'],credentialType=row['type'],companyId=ctx.company,connectionId=handle,revision=row['revision'],status=row['state'],schemaHash=row['schema_hash'],requestedByBotId=row['bot'],sourceConversationId=row['room'],scopes=[],scopeVerification='NOT_AVAILABLE')

SCHEMA='''CREATE TABLE IF NOT EXISTS priority_graphs(
 id TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,actor TEXT NOT NULL,
 binding TEXT NOT NULL,bot TEXT NOT NULL,state TEXT NOT NULL,hash TEXT NOT NULL,
 private_json TEXT NOT NULL,receipt_json TEXT);'''

def freeze(bound):return json.dumps(asdict(bound),sort_keys=True,separators=(',',':'),allow_nan=False)
def thaw(raw):
    data=json.loads(raw);compiled=data.pop('compiled');compiled['types']=tuple(compiled['types'])
    data['compiled']=CompiledGraph(**compiled)
    for effect in data['effects']:effect['operation']=tuple(effect['operation'])
    data['effects']=tuple(data['effects'])
    return BoundGraph(**data)

class GenericGateway:
    def __init__(self,native,compiler,connections,executor_factory):
        self.native=native;self.compiler=compiler;self.connections=connections;self.executor_factory=executor_factory
        with native.store.db() as db:db.executescript(SCHEMA)
    def row(self,db,ctx,ident):
        row=db.execute('SELECT * FROM priority_graphs WHERE id=? AND company=? AND room=?',(ident,ctx.company,ctx.room)).fetchone()
        need(row is not None and (row['actor'],row['binding'])==(ctx.actor,ctx.binding),'graph_owner_changed')
        return row
    def dto(self,ctx,row):
        return dict(id=row['id'],state=row['state'],**public_review(ctx,thaw(row['private_json'])))
    async def propose(self,ctx,graph):
        need(ctx.bot is not None and ctx.native_scope is not None,'native_execution_scope_required')
        with self.native.access(ctx,'integrations.run'):pass
        bound=await self.compiler.compile(ctx,graph)
        with self.native.access(ctx,'integrations.run') as db:
            ident=secrets.token_hex(16)
            db.execute('INSERT INTO priority_graphs VALUES(?,?,?,?,?,?,?,?,?,NULL)',(ident,ctx.company,ctx.room,ctx.actor,ctx.binding,ctx.bot,'REVIEW',bound.review_hash,freeze(bound)))
            return self.dto(ctx,self.row(db,ctx,ident))
    def get(self,ctx,ident):
        with self.native.access(ctx) as db:return self.dto(ctx,self.row(db,ctx,ident))
    async def refresh(self,ctx,ident):
        need(ctx.bot is None and ctx.native_scope is None and ctx.session.kind=='jwt','genuine_human_run_required')
        with self.native.access(ctx,'integrations.install') as db:
            row=dict(self.row(db,ctx,ident))
        if row['state']!='STARTED':return self.get(ctx,ident)
        resolver=PrivateAdminResolver(self.connections,row['bot']);resolver.fence(ctx)
        compiler=CompanyWideCompiler(self.compiler.client,self.compiler.installed,resolver,self.compiler.policy)
        receipt=json.loads(row['receipt_json']);bound=thaw(row['private_json'])
        result=await self.executor_factory(compiler).receipt(ctx,bound,receipt['ref'],receipt['started'])
        # Only bounded status leaves this private gateway, never engine IDs/data.
        if result['status']!='PENDING':
            with self.native.access(ctx,'integrations.install') as db:
                self.row(db,ctx,ident)
                db.execute("UPDATE priority_graphs SET state=? WHERE id=? AND state='STARTED'",(result['status'],ident))
        return dict(id=ident,state=result['status'],reviewHash=bound.review_hash,engineProcessingVerified=result.get('engineProcessingVerified',False),externalBusinessReceiptVerified=False)
    async def run_once(self,ctx,ident,reviewed_hash):
        need(ctx.bot is None and ctx.native_scope is None and ctx.session.kind=='jwt','genuine_human_run_required')
        with self.native.access(ctx,'integrations.install') as db:
            row=dict(self.row(db,ctx,ident));need(row['state']=='REVIEW' and row['hash']==reviewed_hash,'exact_review_required')
            need(db.execute("UPDATE priority_graphs SET state='RUNNING' WHERE id=? AND state='REVIEW'",(ident,)).rowcount==1,'run_already_claimed')
        resolver=PrivateAdminResolver(self.connections,row['bot'])
        compiler=CompanyWideCompiler(self.compiler.client,self.compiler.installed,resolver,self.compiler.policy)
        executor=self.executor_factory(compiler)
        bound=thaw(row['private_json'])
        try:
            resolver.fence(ctx)
            ref=await executor.prepare(ctx,bound,reviewed_hash)
            started=await executor.run(ctx,bound,ref)
            receipt=dict(ref=ref,started=started)
            # Private receipt persists exact engine identity for later polling.
            with self.native.access(ctx,'integrations.install') as db:
                self.row(db,ctx,ident)
                db.execute("UPDATE priority_graphs SET state='STARTED',receipt_json=? WHERE id=?",(json.dumps(receipt),ident))
            return dict(id=ident,state='STARTED',reviewHash=reviewed_hash)
        except BaseException:
            with self.native.store.db() as db:db.execute("UPDATE priority_graphs SET state='UNCERTAIN' WHERE id=?",(ident,))
            raise


def install_production(app,runtime,policy_path=_portable.config_file('n8n-execution-policy.json')):
    from .universal import install_production as install
    return install(app,runtime,policy_path)
