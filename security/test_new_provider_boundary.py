"""No-network tests of the new local provider adapter's credential boundary."""
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / 'product-backend/local_provider.py'
spec = importlib.util.spec_from_file_location('new_local_provider', PATH)
provider = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provider)

class ProviderBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def test_rejects_other_provider_credentials(self):
        for value in [None, {}, {'apiKey': 'sk-' + 'x'*40}, {'apiKey':'sk-or-v1-'+'x'*32,'extra':'unexpected'}]:
            with self.assertRaises(provider.ProviderFailure):
                provider.validate_credential('openrouter', value)
        with self.assertRaises(provider.ProviderFailure):
            provider.validate_credential('openai', {'apiKey':'sk-or-v1-'+'x'*32})

    async def test_fixed_destination_no_proxy_redirect_or_secret_receipt(self):
        calls = {}
        sentinel = 'sk-or-v1-' + 'x'*32
        payload = {'model':provider.MODEL,'choices':[{'message':{'content':'Bounded test reply'},'finish_reason':'stop'}],'usage':{'cost':0},'id':'synthetic-response'}
        class Body:
            async def iter_chunked(self, size):
                yield json.dumps(payload).encode()
        class Response:
            status = 200
            content = Body()
            async def __aenter__(self):return self
            async def __aexit__(self,*args):return False
        class Session:
            def __init__(self,**kwargs):calls['session']=kwargs
            async def __aenter__(self):return self
            async def __aexit__(self,*args):return False
            def post(self,url,**kwargs):calls.update(url=url,request=kwargs);return Response()
        fake = SimpleNamespace(ClientSession=Session,ClientTimeout=lambda **x:x,ClientError=RuntimeError)
        with patch.dict(sys.modules, {'aiohttp':fake}):
            result = await provider.provider_complete({'provider':'openrouter','model':provider.MODEL,'credential':{'apiKey':sentinel}},[{'role':'user','content':'test message'}],'test instructions')
        self.assertEqual(calls['url'],'https://openrouter.ai/api/v1/chat/completions')
        self.assertFalse(calls['session']['trust_env'])
        self.assertFalse(calls['request']['allow_redirects'])
        self.assertEqual(calls['request']['headers']['Authorization'],'Bearer '+sentinel)
        self.assertNotIn(sentinel,json.dumps(result))
        self.assertFalse(calls['request']['json']['provider']['allow_fallbacks'])
        self.assertEqual(calls['request']['json']['provider']['max_price'],{'prompt':0,'completion':0})

if __name__ == '__main__':
    unittest.main()
