import starli_portable as _portable
import asyncio,json,threading
from pathlib import Path
from contextlib import asynccontextmanager
from dataclasses import asdict
from starli_automations.production import private_json
from starli_automations.common import need,encoded
from .core import Triggers

def install_production(app,runtime,config_path=_portable.config_file('n8n-mcp.json'),key_path=_portable.config_file('agent-wake-broker.key')):
    from .native import install
    from starli_agent_schedule_engine import ScheduleClient,ScheduleEngine,OwnedSchedule,TOOLS
    config=private_json(config_path)
    tools=json.loads((Path(__file__).parent/'mcp-tools.json').read_text())['tools']
    client=ScheduleClient(config['baseUrl'],config['token'],{t['name']:t['inputSchema']for t in tools},allowed_tools=TOOLS)
    lock=threading.Lock();ready=False
    native=app.state.starli_automations
    with native.store.db()as db:db.execute('CREATE TABLE IF NOT EXISTS sat_engine_journal(kind TEXT NOT NULL,detail TEXT NOT NULL,created REAL NOT NULL)')
    def journal(kind,detail):
        # Adapter journal payloads are fixed metadata, never callback tokens.
        import time
        with native.store.db()as db:db.execute('INSERT INTO sat_engine_journal VALUES(?,?,?)',(kind,encoded(detail),time.time()))
    engine=ScheduleEngine(client,journal)
    class JsonEngine:
        def ensure(self):
            nonlocal ready
            with lock:
                if not ready:client.initialize();ready=True
        def prepare(self,*args):self.ensure();return asdict(engine.prepare(*args))
        def activate(self,ref):self.ensure();return asdict(engine.activate(OwnedSchedule(**ref)))
        def pause(self,ref):self.ensure();return asdict(engine.pause(OwnedSchedule(**ref)))
        def run_test(self,ref):self.ensure();return engine.run_test(OwnedSchedule(**ref))
        def verify_event(self,ref,event,**kwargs):self.ensure();return engine.verify_event(OwnedSchedule(**ref),event,**kwargs)
    key=Path(key_path).read_bytes();need(len(key)==32,'WAKE_KEY_REQUIRED',503)
    triggers=install(app,Triggers(native,JsonEngine(),app.state.starli_agent_wake,key))
    stop=asyncio.Event();task=None;parent=app.router.lifespan_context
    async def pump():
        while not stop.is_set():
            try:await asyncio.to_thread(triggers.drain_once)
            except Exception:pass
            try:await asyncio.wait_for(stop.wait(),timeout=2)
            except TimeoutError:pass
    @asynccontextmanager
    async def lifespan(application):
        nonlocal task
        async with parent(application)as state:
            triggers.recover();task=asyncio.create_task(pump(),name='starli-agent-event-verifier')
            try:yield state
            finally:
                stop.set()
                if task:await task
    app.router.lifespan_context=lifespan
    return triggers
