"""Additive binding to the existing verified native session and tool runtime."""
from .common import need
import re

class CanonicalAuthorityReads:
    """Qualify trusted RBAC SELECTs on the SAME attached native transaction.

    Never opens a second connection or falls back to a possibly stale main DB.
    AuthorityPort delegates these reads to the canonical company RBAC class.
    """
    def __init__(self,db,schema):self.db,self.schema=db,schema
    def execute(self,sql,args=()):
        need(type(sql)is str and sql.lstrip().upper().startswith('SELECT '),'AUTOMATION_AUTHORITY_READ_REQUIRED',500)
        tables='members|companies|audit|custom_roles|role_assignments'
        qualified=re.sub(r'\b(FROM|JOIN)\s+('+tables+r')\b',lambda m:m.group(1)+' '+self.schema+'.'+m.group(2),sql,flags=re.I)
        return self.db.execute(qualified,args)

def native_permission(runtime):
    schema=runtime.store.authority.schema
    need(type(schema)is str and re.fullmatch('[a-z][a-z_]{0,40}',schema),'AUTOMATION_AUTHORITY_MAPPING_REQUIRED',503)
    need(schema=='main' or schema in runtime.store.attached_databases,'AUTOMATION_AUTHORITY_MAPPING_REQUIRED',503)
    def permission(ctx,db,capability):
        # Same supplied native transaction, like NativeRuntime.local_fence.
        need(runtime.store.authority.schema==schema,'AUTOMATION_AUTHORITY_MAPPING_CHANGED',503)
        authority=object.__new__(type(runtime.authority));authority.db=CanonicalAuthorityReads(db,schema)
        actor=authority.require_member(ctx.actor,ctx.company,permission=capability)
        for who in ([ctx.bot] if ctx.bot else []):
            authority.require_member(ctx.actor,ctx.company,permission='bots.run')
            authority.require_member(who,ctx.company,permission='bots.run')
            authority.require_member(who,ctx.company,permission=capability)
            authority.require_member(who,ctx.company,permission='tools.dispatch')
        if ctx.native_scope is not None:
            need(runtime.authorize_native(db,ctx.native_scope) is True,'NATIVE_AUTOMATION_RUN_REVOKED')
            authority.require_member(ctx.actor,ctx.company,permission='tools.dispatch')
        return actor
    return permission

def register_tools(registry,gateway):
    from starli_company_tools.core import ToolSpec,obj,ID
    configuration=obj({
        'requestSource':{'type':'string','enum':['starli','gmail','shopify','woocommerce']},
        'orderPlatform':{'type':'string','enum':['shopify','woocommerce']},
        'ticketPlatform':{'type':'string','enum':['zendesk','hubspot']},
        'notifySlack':{'type':'boolean'},'approverId':ID,'slackChannelId':ID},[])
    def context(bound):
        bound.check()
        return gateway.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope)
    def plan(bound,args):
        ctx=context(bound)
        return gateway.create_draft(ctx,dict(conversationId=ctx.room,name=args['name'],intent='refund_request',configuration=args['configuration']))
    def update(bound,args):return gateway.update_draft(context(bound),args['draftId'],dict(expectedRevision=args['expectedRevision'],configuration=args['configuration']))
    def status(bound,args):
        ctx=context(bound)
        return gateway.list_drafts(ctx,ctx.room)
    def discover(bound,args):
        from .registry import discover
        ctx=context(bound);catalog=gateway.catalog(ctx)
        matches=set(discover(args['intent']))
        catalog['connectors']=[item for item in catalog['connectors'] if item['id'] in matches]
        return catalog
    async def internal_test(bound,args):
        ctx=context(bound)
        draft=gateway.create_draft(ctx,dict(conversationId=ctx.room,name=args['name'],intent='internal_approval_test',configuration={'approverId':args.get('approverId',ctx.actor)}))
        await gateway.test_draft(ctx,draft['id'],{'expectedRevision':draft['revision']})
        with gateway.access(ctx) as db:return gateway.draft_dto(ctx,gateway.row(db,ctx,'sa_drafts',draft['id']),db)
    async def run_test(bound,args):
        ctx=context(bound)
        return await gateway.run_internal_test(ctx,args['workflowId'],bound.run_id+':'+bound.call_id,'Controlled internal approval test; no external action')
    def connect(bound,args):
        ctx=context(bound)
        return gateway.feedback.integration_card(ctx,args['providerId'])
    def order_plan(bound,args):
        ctx=context(bound)
        config={'approverId':args.get('approverId',ctx.actor)}
        if args.get('slackChannelId'):config['slackChannelId']=args['slackChannelId']
        return gateway.create_draft(ctx,dict(conversationId=ctx.room,name=args['name'],intent='shopify_order_slack_review',configuration=config))
    async def order_run(bound,args):
        ctx=context(bound)
        with gateway.access(ctx) as db:
            row=gateway.row(db,ctx,'sa_workflows',args['workflowId'])
            definition=__import__('json').loads(db.execute('SELECT ir FROM sa_versions WHERE workflow=? AND version=? AND company=?',(row['id'],row['version'],ctx.company)).fetchone()[0])
            need(definition['kind']=='shopify_order_slack_review','ORDER_REVIEW_WORKFLOW_REQUIRED')
        return await gateway.ingest(ctx,row['id'],bound.run_id+':'+bound.call_id,{'orderId':args['orderId'],'content':args['content']})
    def new_orders_plan(bound,args):
        ctx=context(bound)
        return gateway.create_draft(ctx,dict(conversationId=ctx.room,name=args['name'],intent='shopify_new_order_chat',configuration={}))
    registry.register(ToolSpec('company_automation_plan','Create a durable Starli refund-request automation draft in this native conversation. Ask only its next missing question or show its connection card. Never accepts secrets or raw workflow nodes. Activation requires human review.',obj({'name':{'type':'string','minLength':1,'maxLength':160},'configuration':configuration}),'write','starli-automations',plan,'integrations.run'))
    registry.register(ToolSpec('company_automation_update','Update the current-company automation draft with explicit answers and expected revision. Does not silently modify an active automation.',obj({'draftId':ID,'expectedRevision':{'type':'integer','minimum':1},'configuration':configuration}),'write','starli-automations',update,'integrations.run'))
    registry.register(ToolSpec('company_automation_status','Read persisted automation setup drafts visible in this exact native conversation, with next questions and missing company connections.',obj({}),'read','starli-automations',status,'integrations.run'))
    registry.register(ToolSpec('company_integrations_discover','Find reviewed business connectors by intent, capability and service names. Availability reflects actual company connections; metadata never grants external action authorization.',obj({'intent':{'type':'string','minLength':1,'maxLength':1000}}),'read','starli-automations',discover,'integrations.run'))
    registry.register(ToolSpec('company_automation_internal_test','Prepare and non-destructively check an explicitly labelled internal approval test in this exact chat. Only the enrolled internal company can use it. Runs no refund or other external business action. Human must authorize activation separately.',obj({'name':{'type':'string','minLength':1,'maxLength':160},'approverId':ID},['name']),'write','starli-automations',internal_test,'integrations.run'))
    registry.register(ToolSpec('company_automation_internal_test_run','Run an already human-activated internal test. Real private processing leads to a canonical human approval in this same chat, then only an internal test receipt. No external business action.',obj({'workflowId':ID}),'write','starli-automations',run_test,'integrations.run'))
    registry.register(ToolSpec('company_integration_connect','Show a native company-wide Slack or Shopify connection consent card on this exact current assistant message. Does not start OAuth, receive secrets, or install an app. The authorized human chooses Connect; Shopify shop domain is entered only in the native admin card.',obj({'providerId':{'type':'string','enum':['slack','shopify']}}),'write','starli-integrations',connect,'integrations.run'))
    registry.register(ToolSpec('company_automation_order_slack_plan','Propose a read-only Shopify order review followed by exact human approval of a Slack message. Never refunds or modifies Shopify. Ask only missing company connections/channel and present separate human activation.',obj({'name':{'type':'string','minLength':1,'maxLength':160},'approverId':ID,'slackChannelId':ID},['name']),'write','starli-automations',order_plan,'integrations.run'))
    registry.register(ToolSpec('company_automation_order_slack_run','Run an already human-activated Shopify-to-Slack review using an exact order ID and explicit message text. Reads the order, then asks the authorized human to approve the exact workspace/channel/content before any Slack post.',obj({'workflowId':ID,'orderId':ID,'content':{'type':'string','minLength':1,'maxLength':3000}}),'write','starli-automations',order_run,'integrations.run'))
    registry.register(ToolSpec('company_automation_shopify_orders_plan','Prepare Shopify new-order notifications in THIS original native conversation. Requires only company Shopify read_orders connection, no Slack or ticket system. Human tests and activates once; each verified new order produces one informational native notification without per-order approvals. Never claims active merely because this draft tool completes.',obj({'name':{'type':'string','minLength':1,'maxLength':160}}),'write','starli-automations',new_orders_plan,'integrations.run'))

def install(app,*,engine=None,vault=None,apps=None,oauth_transport=None,verify_identity=None,providers=None,internal_companies=(),customer_entitlement=None):
    """Explicit opt-in host hook; does not mount itself or change live services."""
    from .gateway import Gateway
    from .connections import Connections
    from .http import make_router
    runtime=app.state.company_bot_runtime
    gateway=Gateway(runtime.store,permission=native_permission(runtime),engine=engine,internal_companies=internal_companies,customer_entitlement=customer_entitlement)
    gateway.connections=Connections(gateway,vault,apps=apps,oauth_transport=oauth_transport,verify_identity=verify_identity)
    gateway.providers=providers
    register_tools(runtime.company_tools,gateway)
    router=make_router(gateway,app.state.company_messaging_session)
    app.state.starli_automations=gateway
    # Caller owns route ordering before the existing catch-all static Mount.
    return gateway,router
