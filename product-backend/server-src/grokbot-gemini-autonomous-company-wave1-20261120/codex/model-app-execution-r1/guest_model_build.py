"""Durable scoped guest model-app admission. Only explicit model tool invocation writes."""
import asyncio,hashlib,json,os,re,sqlite3,time,uuid
from pathlib import Path
from contextlib import contextmanager
from model_node_dispatcher import NativeNodeDispatcher
def canonical_hash(messages):
    return hashlib.sha256(json.dumps(messages,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
def fail(code):raise ValueError(code)
class BuildContext:
    def __init__(self,original,snapshot):self.original=original;self.initial=snapshot;self.source_snapshot=snapshot
    def revalidate(self):
        method=getattr(self.original,"revalidate_build",None)
        return method(self.initial) if callable(method) else self.original.revalidate()
class GuestModelBuildService:
    def __init__(self,svc,*,on_built=None):
        if not callable(on_built):fail("COMPILED_APP_LIFECYCLE_REQUIRED")
        self.svc=svc;self.on_built=on_built;self.tasks={};self.contexts={}
        self.path=Path(svc.p.intake);self.root=Path("/tmp/grokbot1-w1-mb-"+hashlib.sha256(str(Path(svc.p.root).resolve()).encode()).hexdigest()[:10])
        self.root.mkdir(mode=0o700,exist_ok=True)
        with self.db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS guest_model_app_jobs(id TEXT PRIMARY KEY,intent TEXT NOT NULL,binding TEXT NOT NULL,source TEXT NOT NULL,conversation_hash TEXT NOT NULL,idem_key TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,admission TEXT NOT NULL,result TEXT,error TEXT,created REAL NOT NULL,UNIQUE(intent,idem_key),UNIQUE(intent,source,conversation_hash))")
            db.execute("UPDATE guest_model_app_jobs SET state='INTERRUPTED',error='PROCESS_RESTART_REVIEW_REQUIRED' WHERE state IN ('QUEUED','RUNNING')")
    @contextmanager
    def db(self):
        db=sqlite3.connect(str(self.path),timeout=5);db.row_factory=sqlite3.Row
        try:
            with db:yield db
        finally:db.close()
    def fresh(self,ctx):
        if not callable(getattr(ctx,"revalidate",None)):fail("TRUSTED_GUEST_CONTEXT_REQUIRED")
        value=ctx.revalidate()
        if not isinstance(value,dict):fail("GUEST_SCOPE_REQUIRED")
        for name in ["intentId","guestBinding","companyId","projectId","roomId","requestId"]:
            if not isinstance(value.get(name),str) or not value[name]:fail("GUEST_SCOPE_REQUIRED_"+name)
        if value.get("expiresAt",0)<=time.time():fail("GUEST_SCOPE_EXPIRED")
        return value
    def receipt(self,row):
        value={"id":row["id"],"buildId":row["id"],"intentId":row["intent"],"status":row["state"],
               "sourceMessageId":row["source"],"conversationHash":row["conversation_hash"],
               "principalKind":"GUEST_TEMPORARY","provider":"openrouter","model":"nvidia/nemotron-3-ultra-550b-a55b:free"}
        if row["result"]:
            result=json.loads(row["result"])
            for name in ["graphId","modelCalls","preview","artifactDigest","sourceProvenance","phase"]: 
                if name in result:value[name]=result[name]
        if row["error"]:value["errorCode"]=row["error"]
        return value
    async def build_gateway(self,payload,authority_context):
        if not isinstance(payload,dict) or set(payload)-{"intentId","userMessageId","conversationHash","idempotencyKey","title","description"}:fail("BUILD_PAYLOAD_INVALID")
        scope=self.fresh(authority_context)
        if scope.get("principalKind")!="GUEST_TEMPORARY":fail("GUEST_BUILD_PRINCIPAL_REQUIRED")
        if payload.get("intentId")!=scope["intentId"]:fail("BUILD_INTENT_MISMATCH")
        messages=scope.get("messages")
        if not isinstance(messages,list) or not messages or any(set(m)!={"id","role","content"} or m["role"] not in ("user","assistant") for m in messages):fail("CANONICAL_GUEST_MESSAGES_REQUIRED")
        source=next((m for m in reversed(messages) if m["role"]=="user"),None)
        if not source or source["id"]!=payload.get("userMessageId"):fail("LATEST_CANONICAL_USER_REQUIRED")
        prefix=messages[:messages.index(source)+1]
        if canonical_hash(prefix)!=payload.get("conversationHash"):fail("BUILD_CONVERSATION_HASH_MISMATCH")
        key=payload.get("idempotencyKey")
        if not isinstance(key,str) or not re.fullmatch(r"[A-Za-z0-9._:-]{8,128}",key):fail("BUILD_IDEMPOTENCY_REQUIRED")
        fingerprint=canonical_hash({k:payload[k] for k in ["intentId","userMessageId","conversationHash"]})
        build_id="build-"+hashlib.sha256((scope["guestBinding"]+"|"+scope["intentId"]+"|"+source["id"]+"|"+payload["conversationHash"]).encode()).hexdigest()[:40]
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            prior=db.execute("SELECT * FROM guest_model_app_jobs WHERE intent=? AND (idem_key=? OR (source=? AND conversation_hash=?))",(scope["intentId"],key,source["id"],payload["conversationHash"])).fetchone()
            if prior:
                if prior["binding"]!=scope["guestBinding"] or prior["fingerprint"]!=fingerprint:fail("BUILD_IDEMPOTENCY_CONFLICT")
                return self.receipt(prior)
            if db.execute("SELECT count(*) FROM guest_model_app_jobs WHERE intent=?",(scope["intentId"],)).fetchone()[0]>=3:fail("GUEST_BUILD_QUOTA")
            principal=scope.get("guestPrincipalId") or "guest:"+hashlib.sha256(scope["guestBinding"].encode()).hexdigest()[:32]
            workers=[{"botId":"guest-worker:"+build_id+":"+kind.lower(),"roomId":"guest-room:"+build_id+":"+kind.lower(),"kind":kind,"companyId":scope["companyId"],"providerKind":"OPENROUTER_MODEL"} for kind in ["FRONTEND","BACKEND"]]
            admission={"actor":{"userId":principal,"workspaceTenantId":scope["companyId"],"role":"CUSTOMER"},"principalKind":"GUEST_TEMPORARY","companyId":scope["companyId"],"projectId":scope["projectId"],"requestId":scope["requestId"],"intentId":scope["intentId"],"sourceMessageId":source["id"],"originalPromptMessageId":messages[0]["id"],"parentRunId":"guest-parent:"+build_id,"parentRoomId":scope["roomId"],"authorizationRevision":scope.get("authorizationRevision",1),"generation":scope.get("generation",1),"objective":source["content"][:4000],"canonicalConversation":prefix,"idempotencyKey":key,"workers":workers}
            db.execute("INSERT INTO guest_model_app_jobs VALUES(?,?,?,?,?,?,?,'QUEUED',?,NULL,NULL,?)",(build_id,scope["intentId"],scope["guestBinding"],source["id"],payload["conversationHash"],key,fingerprint,json.dumps(admission),time.time()))
            row=db.execute("SELECT * FROM guest_model_app_jobs WHERE id=?",(build_id,)).fetchone()
        frozen={**scope,"messages":prefix,"conversationHash":payload["conversationHash"],"userMessageId":source["id"]}
        build_context=BuildContext(authority_context,frozen)
        task=asyncio.create_task(self.run(build_id,scope,prefix,build_context,admission))
        self.tasks[build_id]=task;self.contexts[build_id]=authority_context
        task.add_done_callback(lambda _:self.tasks.pop(build_id,None))
        return self.receipt(row)
    async def run(self,build_id,scope,prefix,ctx,admission):
        job_root=self.root/hashlib.sha256(build_id.encode()).hexdigest()[:20]
        dispatcher=NativeNodeDispatcher(str(job_root))
        def current(candidate=None):
            try:
                now=self.fresh(ctx)
                if any(now[k]!=scope[k] for k in ["intentId","guestBinding","companyId","projectId","roomId"]):return False
                current_messages=now["messages"]
                if current_messages[:len(prefix)]!=prefix:return False
                if candidate and (candidate.get("actor")!=admission["actor"] or any(candidate.get(k)!=admission[k] for k in ["companyId","projectId","requestId","sourceMessageId","originalPromptMessageId"])):return False
                return True
            except Exception:return False
        try:
            if not current():fail("GUEST_AUTHORITY_REVOKED")
            with self.db() as db:db.execute("UPDATE guest_model_app_jobs SET state='RUNNING' WHERE id=?",(build_id,))
            prepared=await dispatcher.prepare(admission,current)
            with self.db() as db:db.execute("UPDATE guest_model_app_jobs SET result=? WHERE id=?",(json.dumps({"graphId":prepared["graph"]["graphId"],"phase":"GENERATING_MODEL_SOURCE","modelCalls":0}),build_id))
            execution=await dispatcher.request(admission,current,operation="execute",graph_id=prepared["graph"]["graphId"])
            if not current():fail("GUEST_AUTHORITY_REVOKED")
            result={**execution,"buildId":build_id,"intentId":scope["intentId"],"companyId":scope["companyId"],"projectId":scope["projectId"],"requestId":scope["requestId"],"sourceMessageId":admission["sourceMessageId"],"nativeRoot":str(job_root),"taskIds":[o["receipt"]["taskId"] for o in execution["outputs"]],"principalKind":"GUEST_TEMPORARY"}
            if self.on_built:result.update(await self.on_built(result,ctx))
            if not current():fail("GUEST_AUTHORITY_REVOKED")
            with self.db() as db:db.execute("UPDATE guest_model_app_jobs SET state='READY',result=? WHERE id=?",(json.dumps(result),build_id))
        except BaseException as error:
            code=str(error) if re.fullmatch(r"[A-Z][A-Z0-9_:]{1,100}",str(error)) else "MODEL_APP_BUILD_FAILED"
            with self.db() as db:db.execute("UPDATE guest_model_app_jobs SET state='INTERRUPTED',error=? WHERE id=?",(code,build_id))
    def read(self,build_id,authority_context):
        scope=self.fresh(authority_context)
        with self.db() as db:row=db.execute("SELECT * FROM guest_model_app_jobs WHERE id=? AND intent=? AND binding=?",(build_id,scope["intentId"],scope["guestBinding"])).fetchone()
        if row is None:fail("BUILD_NOT_FOUND")
        return self.receipt(row)
    def status_for_snapshot(self,snapshot):
        # Only the authority service invokes this after fresh guest/native-owner validation.
        binding=snapshot.get("guestBinding") or snapshot.get("binding")
        with self.db() as db:row=db.execute("SELECT * FROM guest_model_app_jobs WHERE intent=? AND binding=? ORDER BY created DESC LIMIT 1",(snapshot["intentId"],binding)).fetchone()
        if row is None:return None
        value=self.receipt(row)
        if snapshot.get("principalKind")=="VERIFIED_REGISTERED_PERSON" and isinstance(value.get("preview"),dict):
            value["preview"]={**value["preview"],"generation":int(value["preview"]["generation"])+1}
        return value
    async def close(self):
        pending=list(self.tasks.values())
        for task in pending:task.cancel()
        await asyncio.gather(*pending,return_exceptions=True)
