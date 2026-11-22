"""Server-bound audience memory adapter over durable V2 storage."""
from dataclasses import dataclass
import hashlib,json
from .store import MemoryScope,MemoryFault,Provenance

@dataclass(frozen=True)
class BotIdentity:
    kind: str
    owner: str
    bot: str
    def __post_init__(self):
        if self.kind not in ("personal","company") or any(not isinstance(x,str) or not x or len(x)>180 for x in (self.owner,self.bot)):
            raise MemoryFault("MEMORY_INVALID_SCOPE",422)
    def key(self):
        return json.dumps([self.kind,self.owner,self.bot],separators=(",",":"))

@dataclass(frozen=True)
class Audience:
    kind: str
    id: str
    def __post_init__(self):
        if self.kind not in ("personal","company","restricted") or not isinstance(self.id,str) or not self.id or len(self.id)>180:
            raise MemoryFault("MEMORY_INVALID_AUDIENCE",422)
    def key(self):
        return json.dumps([self.kind,self.id],separators=(",",":"))

class AudienceMemorySession:
    """resolve() is trusted host code: refresh session, membership, bot grant,
    conversation audience and configuration revision on EVERY invocation.
    It returns the exact frozenset of audience partitions safe for this request.
    It must raise on revoked membership, stopped run or company/config switch.
    Never construct it from model/client supplied audience assertions.
    """
    def __init__(self,factory,identity,*,actor_id,run_id,conversation_id,resolve):
        self.factory=factory; self.identity=identity; self.actor_id=actor_id
        self.run_id=run_id; self.conversation_id=conversation_id; self.resolve=resolve
    def _check(self,action,audience):
        permitted=self.resolve(self.identity,self.conversation_id,action)
        if not isinstance(permitted,frozenset) or audience not in permitted:
            raise MemoryFault("MEMORY_AUDIENCE_DENIED",403)
        if self.identity.kind=="personal" and audience.kind=="company":
            raise MemoryFault("MEMORY_AUDIENCE_DENIED",403)
        if audience.kind in ("personal","company") and (audience.kind!=self.identity.kind or audience.id!=self.identity.owner):
            raise MemoryFault("MEMORY_AUDIENCE_DENIED",403)
    def _store(self,audience):
        self._check("read",audience)
        # Keep legacy personal MEMORY.md and its full history at the original key.
        if self.identity.kind=="personal" and audience==Audience("personal",self.identity.owner):
            scope=MemoryScope(self.identity.owner,self.identity.bot)
        else:
            digest=hashlib.sha256(json.dumps([self.identity.key(),audience.key()],separators=(",",":")).encode()).hexdigest()
            scope=MemoryScope("audience-v1-"+digest,self.identity.bot)
        return self.factory.open(scope,lambda action:self._check(action,audience))
    def write(self,audience,document,content,expected_revision,write_id,tool_call_id):
        self._check("write",audience)
        # Conversation is provenance, never the company memory identity.
        call=hashlib.sha256(json.dumps([self.conversation_id,tool_call_id],separators=(",",":")).encode()).hexdigest()
        return self._store(audience).write(document,content,expected_revision,write_id,
            Provenance("runtime",self.actor_id,self.run_id,call))
    def clear(self,audience,document,expected_revision,write_id,tool_call_id):
        self._check("write",audience)
        call=hashlib.sha256(json.dumps([self.conversation_id,tool_call_id],separators=(",",":")).encode()).hexdigest()
        return self._store(audience).delete(document,expected_revision,write_id,Provenance("runtime",self.actor_id,self.run_id,call))
    def search(self,audience,document,query,limit=10):
        return self._store(audience).search(document,query,limit)
    def context(self,phase="model",max_chars=8000):
        if phase not in ("model","compaction") or type(max_chars)is not int or not 1<=max_chars<=8000:
            raise MemoryFault("MEMORY_INVALID_CONTEXT",422)
        audiences=self.resolve(self.identity,self.conversation_id,"read")
        if not isinstance(audiences,frozenset):raise MemoryFault("MEMORY_AUDIENCE_DENIED",403)
        docs=[]; remaining=max_chars
        for audience in sorted(audiences,key=lambda a:a.key()):
            for name in ("memory","working"):
                doc=self._store(audience).read(name)
                content=doc["content"][:remaining];remaining-=len(content)
                docs.append({"audience":json.loads(audience.key()),"documentId":name,
                    "revision":doc["revision"],"contentSha256":doc["contentSha256"],
                    "deleted":doc["deleted"],"content":content,"truncated":len(content)<len(doc["content"])})
        for audience in audiences:self._check("read",audience)
        return {"version":"starli.memory.audience-context.v1","identity":json.loads(self.identity.key()),
                "phase":phase,"untrusted":True,"documents":docs}
    def model_message(self,phase="model"):
        # Host replaces previous synthetic memory message before every model request.
        return {"role":"user","content":"UNTRUSTED BOT MEMORY DATA\n"+json.dumps(self.context(phase),ensure_ascii=True)}
