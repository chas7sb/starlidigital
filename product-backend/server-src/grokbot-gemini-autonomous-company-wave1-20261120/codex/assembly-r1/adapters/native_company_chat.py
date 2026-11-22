"""Private staged actual native chat. Reuses canonical runtime and native RBAC."""
import asyncio,json,re,sys
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]
NATIVE=Path("/srv/starlidigital/webui-releases/native-company-mcp-always-v33-20261119/backend")
sys.path.insert(0,str(NATIVE/"starli_company_computer"/"runtime"))
sys.path.insert(0,str(BASE/"provider-integration-r1"))
from company_bot_runtime.core import Runtime
from company_bot_runtime.router import mount
from company_messaging.authority import require
from openrouter_provider import OpenRouterProvider,MODEL

class ScopedProvider:
    def __init__(self,authority): self.authority=authority
    def capture(self,actor,company,bot):
        self.authority.require_member(actor,company,permission="bots.run")
        scope=self.authority.require_member(bot,company,permission="bots.run")
        self.authority.require_member(bot,company,permission="messages.send")
        return dict(provider="openrouter",model=MODEL,configurationRevision=scope["membership_revision"],
                    companyId=company,actorId=actor,botId=bot)
    def check(self,value):
        current=self.capture(value["actorId"],value["companyId"],value["botId"])
        require(current==value,403,"COMPANY_PROVIDER_SELECTION_CHANGED")

class NativeChat(Runtime):
    def __init__(self,store,authority,provider):
        super().__init__(store,ScopedProvider(authority),None,authority,None,None)
        self.provider=provider
        with store.db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS demo_chat_provider_receipts(turn TEXT PRIMARY KEY,receipt TEXT NOT NULL)")
    async def start_turn(self,session,audience,source,key):
        return await self.start_from_message(session,audience.company_id,audience.room_id,
                                             audience.bot_id,key,source["id"])
    def authorize_native(self,db,value):
        return self.authorize_run({"id":value.actor_id},value.company_id,value.bot_id,value.room_id,value.run_id)
    async def _run(self,session,ctx,selection,turn,prompt,history):
        try:
            self._state(session,ctx,selection,turn,"RUNNING")
            with self.store.access(session,ctx.company_id,ctx.room_id,readonly=True) as (db,_,_):
                name=db.execute("SELECT name FROM company_authority.members WHERE company_id=? AND user_id=?",
                                (ctx.company_id,ctx.bot_id)).fetchone()
                name=name[0] if name else "Starli"
            self.fence(session,ctx,selection)
            answer,receipt=await self.provider.complete([*history,{"role":"user","content":prompt}],
                instructions="You are "+name+", an AI teammate in this company. Answer the user's request honestly. "
                "This private chat currently supports conversation only. Do not claim to have executed tools, "
                "built apps, browsed, sent messages or changed accounts. Keep replies helpful and concise.",
                max_tokens=1024)
            self.fence(session,ctx,selection)
            self._delta(session,ctx,selection,turn,answer)
            with self.store.access(session,ctx.company_id,ctx.room_id) as (db,_,_):
                self.local_fence(db,ctx)
                db.execute("INSERT INTO demo_chat_provider_receipts VALUES(?,?)",(turn,json.dumps(receipt)))
            self._state(session,ctx,selection,turn,"ANSWERED")
        except BaseException as exc:
            state="CANCELLED" if isinstance(exc,asyncio.CancelledError) else "FAILED"
            code="TURN_CANCELLED" if state=="CANCELLED" else str(exc) if re.fullmatch(r"[A-Z][A-Z0-9_]{1,79}",str(exc)) else "COMPANY_TURN_FAILED"
            with self.store.db() as db:self._set_state(db,turn,state,code)

def install_native_chat(app,svc,key_file):
    root=Path(svc.p.root).resolve()
    require(str(root).startswith("/tmp/grokbot1-w1-") and root.stat().st_uid==997,503,"PRIVATE_DISPOSABLE_ROOT_REQUIRED")
    authority=svc.ns.RbacAuthority(str(svc.p.authority))
    runtime=NativeChat(app.state.company_messaging,authority,OpenRouterProvider(key_file))
    runtime.recover()
    app.state.company_messaging_start_turn=runtime.start_turn
    app.state.company_messaging_authorize_run=runtime.authorize_native
    mount(app,runtime,app.state.company_messaging_session)
    return runtime
