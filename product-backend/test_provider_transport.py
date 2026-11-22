"""No-network boundary tests; transport fixtures are not actual inference evidence."""
import asyncio,json,unittest
from unittest.mock import patch
from local_provider import MODEL,provider_complete,ProviderFailure

class Body:
 def __init__(self,payload):self.payload=payload
 async def iter_chunked(self,size):yield json.dumps(self.payload).encode()
class Response:
 status=200
 def __init__(self,payload):self.content=Body(payload)
 async def __aenter__(self):return self
 async def __aexit__(self,*args):pass
class Session:
 def __init__(self,payload,**options):self.payload=payload;assert options['trust_env']is False
 async def __aenter__(self):return self
 async def __aexit__(self,*args):pass
 def post(self,url,**options):
  assert url=='https://openrouter.ai/api/v1/chat/completions'
  assert options['allow_redirects']is False
  assert options['json']['provider']=={'allow_fallbacks':False,'max_price':{'prompt':0,'completion':0}}
  return Response(self.payload)
class TransportTests(unittest.IsolatedAsyncioTestCase):
 async def invoke(self,payload):
  with patch('aiohttp.ClientSession',lambda **options:Session(payload,**options)):
   return await provider_complete({'provider':'openrouter','model':MODEL,'credential':{'apiKey':'sk-or-v1-synthetic-transport-fixture'}},[{'role':'user','content':'Unit test only'}],'Unit test')
 async def test_bad_payloads_are_sanitized(self):
  for payload in [None,[],{}, {'choices':'not-a-list'}, {'choices':[None]}, {'choices':[{'message':[]}]}]:
   with self.subTest(payload=payload),self.assertRaisesRegex(ProviderFailure,'PROVIDER_RESPONSE_INVALID'):await self.invoke(payload)
 async def test_nonzero_cost_wrong_model_and_missing_receipt_refused(self):
  base={'id':'fixture-id','model':MODEL,'choices':[{'message':{'content':'Transport fixture only'}}],'usage':{'cost':0}}
  for payload,code in [(dict(base,usage={'cost':1}),'PROVIDER_FREE_BILLING_MISMATCH'),(dict(base,model='other'),'PROVIDER_MODEL_MISMATCH'),(dict(base,id=''),'PROVIDER_RECEIPT_REQUIRED')]:
   with self.subTest(code=code),self.assertRaisesRegex(ProviderFailure,code):await self.invoke(payload)
 async def test_valid_fixture_receipt_omits_secret(self):
  result=await self.invoke({'id':'fixture-id','model':MODEL,'choices':[{'message':{'content':'Transport fixture only'}}],'usage':{'cost':0,'total_tokens':10}})
  self.assertEqual(result['receipt']['status'],'completed');self.assertNotIn('apiKey',json.dumps(result));self.assertEqual(result['receipt']['usage']['cost'],0)
if __name__=='__main__':unittest.main()
