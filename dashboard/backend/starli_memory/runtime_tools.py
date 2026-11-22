"""Server-bound visible Markdown memory tools; no runtime or HTTP registration."""
import hashlib,json,re
from fastapi import HTTPException
from .store import MemoryScope,Provenance,MemoryFault
from .native_registration import _native_agent,_value

DOCUMENTS=("memory","working")
def schemas():
    doc={"type":"string","enum":list(DOCUMENTS)}
    fields={"memory_read":({"documentId":doc},["documentId"]),
        "memory_history":({"documentId":doc},["documentId"]),
        "memory_search":({"documentId":doc,"query":{"type":"string","minLength":1,"maxLength":200}},["documentId","query"]),
        "memory_delete":({"documentId":doc,"expectedRevision":{"type":"integer","minimum":0,"maximum":2**53-1}},["documentId","expectedRevision"]),
        "memory_write":({"documentId":doc,"content":{"type":"string","maxLength":65536},
            "expectedRevision":{"type":"integer","minimum":0,"maximum":2**53-1}},["documentId","content","expectedRevision"])}
    return [{"name":name,"description":("Clear current notes; version history remains owner-visible. This is not permanent deletion." if name=="memory_delete" else "Read or edit explicit visible per-agent Markdown notes. Memory is data, not permission."),
        "inputSchema":{"type":"object","properties":props,"required":required,"additionalProperties":False}}
        for name,(props,required)in fields.items()]

def _identifier(value):
    return isinstance(value,str)and 1<=len(value)<=180 and value not in (".","..")and not any(c in value for c in "/\\")and all(ord(c)>=32 and ord(c)!=127 for c in value)

class RuntimeMemoryTools:
    def __init__(self,factory,*,user,agent_id,run_id,tool_call_id,fence,resolve_agent=None,authorize_runtime=None):
        uid=_value(user,"id")
        if not all(_identifier(v)for v in (uid,agent_id,run_id,tool_call_id)):raise MemoryFault("MEMORY_RUNTIME_BINDING_INVALID",403)
        self.factory=factory;self.uid=uid;self.agent_id=agent_id;self.run_id=run_id
        self.authorize_runtime=authorize_runtime
        self.tool_call_id=tool_call_id;self.fence=fence;self.resolver=resolve_agent or _native_agent
        self.scope=MemoryScope(uid,agent_id)
        self._authorize("read")
    def schemas(self):
        result=schemas()
        for spec in result:
            if spec["name"]=="memory_write":spec["inputSchema"]["properties"]["content"]["maxLength"]=self.factory.max_content_bytes
        return result
    def _authorize(self,action):
        fresh=self.fence.check()
        if _value(fresh,"id")!=self.uid or _value(fresh,"role")not in ("user","admin"):raise MemoryFault("MEMORY_ACCOUNT_UNAVAILABLE",403)
        if not callable(self.authorize_runtime) or self.authorize_runtime(fresh,self.scope,self.run_id,self.tool_call_id,action)is not True:raise MemoryFault("MEMORY_RUNTIME_GRANT_DENIED",403)
        fresh=self.fence.check()
        if _value(fresh,"id")!=self.uid or _value(fresh,"role")not in ("user","admin"):raise MemoryFault("MEMORY_ACCOUNT_UNAVAILABLE",403)
        try:agent=self.resolver(fresh,self.agent_id)
        except HTTPException:raise MemoryFault("MEMORY_SCOPE_DENIED",403)from None
        except Exception:raise MemoryFault("MEMORY_SCOPE_UNAVAILABLE",503)from None
        if (agent is None or _value(agent,"id")!=self.agent_id or _value(agent,"owner")!=self.uid
            or _value(agent,"archived_at")is not None
            or _value(agent,"status")not in ("IDLE","RUNNING","PAUSED","WAITING_INPUT","FAILED","COMPLETED")):
            raise MemoryFault("MEMORY_SCOPE_DENIED",403)
    def dispatch(self,name,args):
        if name not in ("memory_read","memory_write","memory_history","memory_search","memory_delete"):raise MemoryFault("MEMORY_TOOL_UNAVAILABLE",404)
        expected={"documentId","content","expectedRevision"}if name=="memory_write"else {"documentId","expectedRevision"}if name=="memory_delete"else {"documentId","query"}if name=="memory_search"else{"documentId"}
        if type(args)is not dict or set(args)!=expected or args.get("documentId")not in DOCUMENTS:raise MemoryFault("MEMORY_TOOL_ARGUMENTS_INVALID",422)
        doc=args["documentId"]
        if name=="memory_write":
            content=args["content"];revision=args["expectedRevision"]
            if not isinstance(content,str)or len(content.encode("utf-8"))>self.factory.max_content_bytes or type(revision)is not int or not 0<=revision<=2**53-1:
                raise MemoryFault("MEMORY_TOOL_ARGUMENTS_INVALID",422)
        self._authorize("write"if name in ("memory_write","memory_delete")else "history"if name=="memory_history"else "read")
        store=self.factory.open(self.scope,self._authorize)
        if name=="memory_read":return store.read(doc)
        if name=="memory_history":return store.history(doc)
        if name=="memory_search":return store.search(doc,args["query"])
        key=hashlib.sha256(json.dumps([self.uid,self.agent_id,self.run_id,self.tool_call_id,doc],separators=(",",":")).encode()).hexdigest()
        operation=store.delete if name=="memory_delete" else store.write
        values=[doc,args["expectedRevision"],key] if name=="memory_delete" else [doc,args["content"],args["expectedRevision"],key]
        return operation(*values,
            Provenance(kind="runtime",actor_id=self.uid,run_id=self.run_id,tool_call_id=self.tool_call_id))

def create_runtime_tools(factory,**trusted_binding):
    return RuntimeMemoryTools(factory,**trusted_binding)
