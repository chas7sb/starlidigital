"""Native personal BOSS memory: server-bound scope, same editor factory/keys."""
from .context import NativeMemorySession
from .runtime_tools import schemas
from .store import MemoryFault

IDS=('memory_read','memory_write','memory_search','memory_history','memory_delete')
_FACTORY=None

def install_factory(factory):
    global _FACTORY
    if _FACTORY is not None and _FACTORY.root!=factory.root:raise RuntimeError('MEMORY_ROOT_MISMATCH')
    _FACTORY=factory

def available_schemas(factory=None):return schemas()if (factory or _FACTORY)is not None else[]

def for_scope(scope,*,activity=None,budget=None,resolve_agent=None):
    factory=getattr(scope,'memory_factory',_FACTORY)if scope is not None else None
    if factory is None or scope is None or scope.mode not in ('projects','admin'):return None
    fields=('runId','agentId','conversationId');expected=tuple(scope.binding.get(k)for k in fields)
    if not all(isinstance(x,str)and x for x in expected):raise MemoryFault('MEMORY_NATIVE_BINDING_REQUIRED',403)
    if activity is None:
        from open_webui.routers.starli_public_activity import get_run
        activity=get_run
    if budget is None:
        from open_webui.routers.starli_runtime_adapter import ensure_run_budget
        budget=ensure_run_budget
    def authorize():
        user=scope.authorize()
        if tuple(scope.binding.get(k)for k in fields)!=expected or user.id!=scope.fence.user_id or scope.state!='RUNNING':
            raise MemoryFault('MEMORY_RUN_SCOPE_CHANGED',403)
        current=activity(user.id,expected[0])
        if not current or current.get('status')!='RUNNING':raise MemoryFault('MEMORY_RUN_UNAVAILABLE',403)
        live=budget(user.id,scope.binding.get('budgetRootRunId')or expected[0])
        if live.get('cancelRequested')or live.get('remainingSeconds',0)<=0:raise MemoryFault('MEMORY_RUN_UNAVAILABLE',403)
        return user
    user=authorize()
    class Fence:
        def check(self):return authorize()
    def grant(fresh,identity,run,call,action):
        checked=authorize()
        return checked.id==fresh.id==identity.account_id==user.id and identity.agent_id==expected[1]and run==expected[0]
    return NativeMemorySession(factory,user=user,agent_id=expected[1],run_id=expected[0],fence=Fence(),authorize_runtime=grant,resolve_agent=resolve_agent)

def current():
    from open_webui.routers.starli_chat_stream import _CURRENT
    return for_scope(_CURRENT.get())

def current_schemas():
    from open_webui.routers.starli_chat_stream import _CURRENT
    scope=_CURRENT.get()
    if scope is None or scope.mode not in ('projects','admin'):return[]
    return available_schemas()

def model_context(phase='model'):
    bound=current()
    return bound.context(phase)if bound else None

def dispatch(name,args,call_id):
    from fastapi import HTTPException
    from open_webui.routers.starli_chat_stream import current_capability_scope
    if name not in (current_capability_scope()or{}).get('memoryTools',[]):raise HTTPException(403,'MEMORY_NATIVE_SCOPE_REQUIRED')
    bound=current()
    if bound is None:raise HTTPException(403,'MEMORY_NATIVE_SCOPE_REQUIRED')
    try:return {'status':'COMPLETED','memory':bound.tool(name,args,tool_call_id=call_id)}
    except (MemoryFault,HTTPException) as error:
        status=getattr(error,'status',getattr(error,'status_code',503))
        code=getattr(error,'code','MEMORY_AUTHORITY_CHANGED')
        if name in ('memory_write','memory_delete')and status in (401,403):
            # Authority may have changed immediately after canonical commit.
            # Never claim a denied write definitely had no effect or retry it.
            return {'ok':False,'status':'INTERRUPTED','error':code,'requiresReview':True,'unknownEffect':True,'automaticRetryAllowed':False}
        raise HTTPException(status,code)from None

def is_memory_call(op,args):return op=='platform.call'and isinstance(args,dict)and args.get('tool')in IDS
