"""Native tools and authenticated human review API. Explicit opt-in install."""
import asyncio,json
from starli_automations.common import need,Fault,exact
from starli_n8n_mcp.client import BridgeError

def install(app,gateway):
    from starli_company_tools.core import ToolSpec,obj,ID
    from fastapi import APIRouter,Depends,Request
    from fastapi.responses import JSONResponse
    from fastapi.routing import APIRoute
    runtime=app.state.company_bot_runtime
    need(gateway.native is app.state.starli_automations,'NATIVE_GATEWAY_MISMATCH',503)
    from .feedback import install as install_feedback
    install_feedback(gateway);gateway.bind_feedback=True
    def context(bound):
        bound.check()
        return gateway.native.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope)
    def propose(bound,args):
        try:graph=json.loads(args['graphJson'])
        except (ValueError,TypeError):raise Fault('GRAPH_JSON_REQUIRED',422)from None
        return gateway.propose(context(bound),graph)
    async def validate(bound,args):
        ctx=context(bound)
        return await asyncio.to_thread(gateway.validate,ctx,args['workflowId'],args['expectedRevision'])
    async def status(bound,args):return await asyncio.to_thread(gateway.refresh,context(bound),args['workflowId'])
    async def nodes_search(bound,args):
        ctx=context(bound)
        with gateway.native.access(ctx):pass
        value=await asyncio.to_thread(gateway.call,'search_nodes',{'queries':[args['query']],'usage':'workflow'})
        bound.check()
        return {'version':'starli.workflow-discovery.v1','results':value,'notice':'Discovery metadata only; execution requires a supported company credential binding and approved graph. Never claim a connector is active merely because it is found.'}
    async def node_schema(bound,args):
        ctx=context(bound)
        with gateway.native.access(ctx):pass
        request={k:v for k,v in args.items()if k in ('nodeId','version','resource','operation')}
        value=await asyncio.to_thread(gateway.call,'get_node_types',{'nodeIds':[request]})
        bound.check()
        if type(value)is dict and type(value.get('definitions'))is str:
            value={**value,'definitions':value['definitions'][:30000]}
        return {'version':'starli.workflow-node-schema.v1','schema':value,'notice':'Native node schema, not permission to run. Bind only company-owned connections; never put secrets in chat. Use company_connection_request for private setup.'}
    registry=runtime.company_tools
    registry.register(ToolSpec('company_workflow_node_schema','Inspect a native connector node/action schema for dynamic workflow construction. Accepts node type ID and optional exact version/resource/operation discovered from node search. No engine credentials or other company workflows are returned.',obj({'nodeId':{'type':'string','minLength':1,'maxLength':160},'version':{'type':'string','maxLength':20},'resource':{'type':'string','maxLength':100},'operation':{'type':'string','maxLength':100}},['nodeId']),'read','starli-n8n-mcp',node_schema,'integrations.run'))
    registry.register(ToolSpec('company_workflow_nodes_search','Discover native automation nodes by service, trigger or task through the private automation engine. Returns node metadata, not credentials or workflows of other companies. Discovery does not mean an executable company connection exists.',obj({'query':{'type':'string','minLength':1,'maxLength':160}}),'read','starli-n8n-mcp',nodes_search,'integrations.run'))
    registry.register(ToolSpec('company_workflow_graph_plan','Propose a native company workflow graph in this exact chat. JSON nodes/edges, never code or secrets. Currently executable nodes: manualTrigger,set,if,switch,merge,noOp. External connectors and automatic triggers require separate reviewed bindings and are not enabled by this tool. Does not activate or execute.',obj({'graphJson':{'type':'string','minLength':2,'maxLength':50000}}),'write','starli-n8n-mcp',propose,'integrations.run'))
    registry.register(ToolSpec('company_workflow_graph_validate','Validate and create the owned inactive draft through the private n8n MCP engine. Does not execute; a real human must separately review the exact graph. An uncertain create is held and never automatically retried.',obj({'workflowId':ID,'expectedRevision':{'type':'integer','minimum':1}}),'write','starli-n8n-mcp',validate,'integrations.run'))
    registry.register(ToolSpec('company_workflow_graph_status','Read the saved graph and true status in this current company and chat. A validation or execution start is not completion.',obj({'workflowId':ID}),'read','starli-n8n-mcp',status,'integrations.run'))
    class SafeRoute(APIRoute):
        def get_route_handler(self):
            handler=super().get_route_handler()
            async def safe(request):
                try:
                    body=bytearray()
                    async for chunk in request.stream():
                        body.extend(chunk);need(len(body)<=65536,'INPUT_LIMIT',413)
                    request._body=bytes(body)
                    return await handler(request)
                except Fault as error:return JSONResponse(status_code=error.status,content={'detail':{'code':error.code}})
                except BridgeError:return JSONResponse(status_code=503,content={'detail':{'code':'PRIVATE_WORKFLOW_ENGINE_UNAVAILABLE'}})
            return safe
    router=APIRouter(prefix='/api/v1/starli/companies/{company}/automations/graphs',route_class=SafeRoute)
    dependency=app.state.company_messaging_session
    @router.get('/{ident}')
    async def get(company:str,ident:str,conversationId:str,principal=Depends(dependency)):
        ctx=gateway.native.context(principal,company,conversationId)
        return await asyncio.to_thread(gateway.refresh,ctx,ident)
    @router.post('/{ident}/run-once')
    async def run_once(company:str,ident:str,request:Request,principal=Depends(dependency)):
        data=await request.json();exact(data,['conversationId','expectedRevision','reviewedHash'])
        need(type(data['expectedRevision'])is int and data['expectedRevision']>0,'INVALID_REVISION',422)
        ctx=gateway.native.context(principal,company,data['conversationId'])
        return await asyncio.to_thread(gateway.run_once,ctx,ident,data['expectedRevision'],data['reviewedHash'])
    app.include_router(router)
    app.state.starli_company_n8n=gateway
    return gateway
