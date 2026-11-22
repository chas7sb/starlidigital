"""Actual native ToolSpec registration; host supplies canonical bound context."""
from .kernel import Execution
from .data import parse_json, WorkflowFault


def register_tools(registry, kernel, context_for):
    from starli_company_tools.core import ToolSpec
    names=[]
    for operation in kernel.operations.values():
        name='company_workflow_'+operation.name.replace('.','_')
        async def handler(bound,args,_operation=operation):
            bound.check()
            ctx=context_for(bound)
            if not isinstance(ctx,Execution):raise WorkflowFault('CANONICAL_NATIVE_SCOPE_REQUIRED')
            parameters=parse_json({'text':args['argumentsJson']})
            result=await kernel.execute(ctx,_operation.name,parameters)
            bound.check()
            return result
        # Current host validator has no free-JSON/union support. The bounded
        # JSON string is parsed+strictly checked against the operation's actual
        # inputSchema inside Kernel; no expressions/raw API/workflow JSON.
        schema={'type':'object','properties':{'argumentsJson':{'type':'string','minLength':2,'maxLength':262144}},
                'required':['argumentsJson'],'additionalProperties':False}
        registry.register(ToolSpec(name,'Execute bounded account-free '+operation.name+
            '. argumentsJson must match company_workflow_describe inputSchema. No eval/exec or raw engine workflow.',
            schema,operation.effect,'starli-local-workflows',handler,operation.permission))
        names.append(name)
    all_names=sorted(set(kernel.operations)|set(kernel.unavailable))
    def describe(bound,args):
        bound.check()
        return kernel.detail(args['operationId'])
    registry.register(ToolSpec('company_workflow_describe','Read exact input schema, bounds and backing-adapter availability. Unavailable is not installed.',
        {'type':'object','properties':{'operationId':{'type':'string','enum':all_names}},'required':['operationId'],'additionalProperties':False},
        'read','starli-local-workflows',describe,'tools.dispatch'))
    return dict(registered=names+['company_workflow_describe'],unavailable=dict(kernel.unavailable),externalActions=False)
