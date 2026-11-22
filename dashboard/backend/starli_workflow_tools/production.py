"""Concrete pure-tool install for the existing native CompanyRuntime."""
import time
from .data import need
from .kernel import Kernel, Execution
from .native import register_tools


def install_production(app, runtime):
    need(getattr(app.state,'company_bot_runtime',None) is runtime,'NATIVE_RUNTIME_MISMATCH')
    need(not hasattr(app.state,'starli_workflow_kernel'),'WORKFLOW_TOOLS_ALREADY_INSTALLED')
    registry=getattr(runtime,'company_tools',None)
    need(registry is not None and callable(getattr(registry,'register',None)),'NATIVE_COMPANY_TOOLS_REQUIRED')

    def fields(bound):
        need(bound.runtime is runtime,'NATIVE_RUNTIME_MISMATCH')
        ctx,scope=bound.context,bound.native_scope
        need(scope is not None and scope.assistant_message_id==bound.assistant_id
             and scope.tool_call_id==bound.call_id and scope.run_id==bound.run_id,'NATIVE_TOOL_SCOPE_MISMATCH')
        actual=(ctx.company_id,ctx.actor_id,ctx.actor_binding,ctx.room_id,ctx.bot_id,bound.run_id,
                scope.assistant_message_id,bound.call_id)
        need(actual[:5]==(scope.company_id,scope.actor_id,scope.actor_binding,scope.room_id,scope.bot_id),
             'NATIVE_TOOL_SCOPE_MISMATCH')
        return actual

    def authorize(execution):
        bound=execution.native
        need(fields(bound)==(execution.company,execution.actor,execution.binding,execution.room,execution.bot,
                            execution.run,execution.assistant,execution.call),'NATIVE_TOOL_SCOPE_CHANGED')
        need(bound.check() is True,'NATIVE_GRANT_REVOKED')
        return True

    def context_for(bound):
        bound.check()
        actual=fields(bound)
        # Local per-operation cap only. Existing native run authorization and
        # outer SDK/runtime retain their admitted cumulative deadlines/budgets.
        return Execution(*actual,deadline=time.monotonic()+15,native=bound)

    async def native_outer_lifecycle(execution,event):
        # Existing company_tools runtime emits actual tool started/result after
        # its durable cr_company_tool_calls receipt. Do not emit succeeded early
        # from inside a handler, or invent another assistant/progress log.
        authorize(execution)

    kernel=Kernel(authorize,native_outer_lifecycle)
    report=register_tools(registry,kernel,context_for)
    report.update(progressMode='existing-native-tool-lifecycle',customProgressPersisted=False,
                  accountFree=True,optionalAdaptersInstalled=False)
    app.state.starli_workflow_kernel=kernel
    app.state.starli_workflow_tools=report
    return kernel
