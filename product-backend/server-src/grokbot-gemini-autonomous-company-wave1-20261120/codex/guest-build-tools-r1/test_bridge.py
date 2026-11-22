import asyncio,json,sys,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"provider-integration-r1"))
from guest_build_tools import GuestBuildTurn,guest_build_turn,conversation_hash,install_guest_build_provider,GuestToolProvider,MODEL,_CURRENT
from fastapi import HTTPException
def svc():
    async def previous(messages,**kwargs):return ("ordinary",kwargs)
    return SimpleNamespace(ns=SimpleNamespace(public=SimpleNamespace(call_provider=previous,PublicReply=lambda text,receipt:{"text":text,"receipt":receipt})))
class FakeProvider:
    calls=0
    def __init__(self,decision):self.decision=decision
    async def decide(self,messages):
        self.calls+=1;await asyncio.sleep(0);return self.decision
TOOL={"tool":{"title":"Clients","description":"A client tracker"},"receipt":{"provider":"openrouter","model":MODEL,"responseId":"fixture-model"},"toolCallId":"tool-1"}
def turn(intent="intent-a",request="request-a"):
    return GuestBuildTurn(intent,"msg-user",conversation_hash([{"id":"msg-user","role":"user","content":"Build clients"}]),request,{"fixtureScope":intent})
class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_scope_fallback_reset(self):
        s=svc();p=FakeProvider(TOOL);install_guest_build_provider(s,None,lambda *args:None,provider=p)
        self.assertEqual((await s.ns.public.call_provider([]))[0],"ordinary")
        with self.assertRaises(ValueError):
            with guest_build_turn(turn()):raise ValueError("test")
        self.assertIsNone(_CURRENT.get());self.assertEqual(p.calls,0)
    async def test_actual_admission_receipt_and_stable_key(self):
        s=svc();seen=[]
        async def gateway(payload,context):seen.append((payload,context));return {"id":"actual-native-fixture-job","status":"QUEUED"}
        p=FakeProvider(TOOL);install_guest_build_provider(s,None,gateway,provider=p)
        for _ in range(2):
            with guest_build_turn(turn()):answer=await s.ns.public.call_provider([{"role":"user","content":"Build clients"}])
        self.assertEqual(seen[0][0]["idempotencyKey"],seen[1][0]["idempotencyKey"])
        self.assertEqual(answer["receipt"]["replyOrigin"],"TOOL_RECEIPT")
        self.assertEqual(answer["receipt"]["sourceMessageId"],"msg-user")
        self.assertNotIn("fixtureScope",json.dumps(answer));self.assertNotIn("finished",answer["text"])
    async def test_context_isolation(self):
        s=svc();seen=[]
        async def gateway(payload,context):seen.append((payload["intentId"],context["fixtureScope"]));return {"id":payload["intentId"],"status":"RUNNING"}
        install_guest_build_provider(s,None,gateway,provider=FakeProvider(TOOL))
        async def one(n):
            with guest_build_turn(turn(n,n)):return await s.ns.public.call_provider([{"role":"user","content":"Build"}])
        await asyncio.gather(one("intent-a"),one("intent-b"))
        self.assertEqual(set(seen),{("intent-a","intent-a"),("intent-b","intent-b")})
    async def test_authority_failure_no_success_reply(self):
        s=svc()
        async def gateway(*args):raise HTTPException(403,"GUEST_RETIRED")
        install_guest_build_provider(s,None,gateway,provider=FakeProvider(TOOL))
        with guest_build_turn(turn()):
            with self.assertRaises(HTTPException) as result:await s.ns.public.call_provider([{"role":"user","content":"Build"}])
        self.assertEqual(result.exception.status_code,403)
    async def test_invalid_job_not_completion(self):
        s=svc();install_guest_build_provider(s,None,lambda *args:{"id":"job","status":"FAILED"},provider=FakeProvider(TOOL))
        with guest_build_turn(turn()):
            with self.assertRaises(HTTPException) as result:await s.ns.public.call_provider([{"role":"user","content":"Build"}])
        self.assertEqual(result.exception.detail,"BUILD_ADMISSION_NOT_ACCEPTED")
    async def test_ordinary_model_reply_no_build(self):
        s=svc();calls=[]
        install_guest_build_provider(s,None,lambda *args:calls.append(args),provider=FakeProvider({"content":"Hello","receipt":{"responseId":"fixture"}}))
        with guest_build_turn(turn()):r=await s.ns.public.call_provider([{"role":"user","content":"Hello"}])
        self.assertEqual(r["text"],"Hello");self.assertEqual(calls,[])
class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def run_decision(self,tool_name="build_app",count=1,model=MODEL):
        data={"model":model,"id":"fixture-response","usage":{"cost":0},"choices":[{"finish_reason":"tool_calls","message":{"tool_calls":[{"id":"call","type":"function","function":{"name":tool_name,"arguments":json.dumps({"title":"Clients","description":"Client tracker"})}}]*count}}]}
        class Content:
            async def iter_chunked(self,n):
                raw=json.dumps(data).encode()
                yield raw[:17];yield raw[17:]
        class Response:
            status=200;content=Content()
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
        class Client:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            def post(self,*args,**kwargs):return Response()
        p=GuestToolProvider.__new__(GuestToolProvider);p._key="fixture-not-a-key";p.calls=0
        with patch("guest_build_tools.aiohttp.ClientSession",return_value=Client()):
            return await p.decide([{"role":"user","content":"Build a client tracker"}])
    async def test_chunked_tool_decision(self):
        self.assertEqual((await self.run_decision())["tool"]["title"],"Clients")
    async def test_other_tools_denied(self):
        with self.assertRaisesRegex(RuntimeError,"GUEST_TOOL_NOT_ALLOWED"):await self.run_decision(tool_name="admin_shell")
    async def test_multiple_tools_denied(self):
        with self.assertRaisesRegex(RuntimeError,"GUEST_SINGLE_BUILD_TOOL_REQUIRED"):await self.run_decision(count=2)
    async def test_other_model_denied(self):
        with self.assertRaisesRegex(RuntimeError,"PROVIDER_MODEL_MISMATCH"):await self.run_decision(model="other")
if __name__=="__main__":unittest.main(verbosity=2)
