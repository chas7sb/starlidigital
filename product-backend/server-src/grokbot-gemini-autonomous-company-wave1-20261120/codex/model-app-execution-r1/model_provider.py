"""Explicit private staging provider. No production config mutation or fallback."""
import json,re
from pathlib import Path
import aiohttp

MODEL='nvidia/nemotron-3-ultra-550b-a55b:free'

class OpenRouterProvider:
    def __init__(self,key_file):
        p=Path(key_file)
        if p.stat().st_mode & 0o077:raise RuntimeError('PRIVATE_PROVIDER_KEY_PERMISSIONS')
        self._key=p.read_text().strip()
        if not self._key:raise RuntimeError('PRIVATE_PROVIDER_KEY_MISSING')
        self.calls=0
    async def complete(self,messages,*,instructions,max_tokens=512):
        if len(messages)>24 or sum(len(m.get('content','')) for m in messages)>40000:raise RuntimeError('PROVIDER_CONTEXT_LIMIT')
        if any(m.get('role') not in ('user','assistant') or not isinstance(m.get('content'),str) for m in messages):raise RuntimeError('PROVIDER_HISTORY_INVALID')
        body={'model':MODEL,'messages':[{'role':'system','content':instructions[:12000]}]+messages,'max_tokens':min(max_tokens,4096),'temperature':0.4,'reasoning':{'enabled':False,'exclude':True},'provider':{'allow_fallbacks':True,'max_price':{'prompt':0,'completion':0}}}
        self.calls+=1
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=65),trust_env=False) as client:
            async with client.post('https://openrouter.ai/api/v1/chat/completions',headers={'Authorization':'Bearer '+self._key,'Content-Type':'application/json','HTTP-Referer':'https://starlidigital.ro','X-Title':'Starli private workspace'},json=body,allow_redirects=False) as response:
                if response.status!=200:raise RuntimeError('OPENROUTER_HTTP_'+str(response.status))
                chunks=[];size=0
                async for chunk in response.content.iter_chunked(16384):
                    size+=len(chunk)
                    if size>262144:raise RuntimeError('PROVIDER_OUTPUT_LIMIT')
                    chunks.append(chunk)
                data=json.loads(b''.join(chunks))
        if data.get('error'):raise RuntimeError('OPENROUTER_RESPONSE_ERROR')
        if (data.get('choices') or [{}])[0].get('finish_reason')=='length':raise RuntimeError('PROVIDER_OUTPUT_LIMIT')
        answer=data.get('choices',[{}])[0].get('message',{}).get('content')
        if not isinstance(answer,str) or not answer.strip():raise RuntimeError('PROVIDER_EMPTY_RESPONSE')
        if str(data.get('model','')).removesuffix(':free')!=MODEL.removesuffix(':free'):raise RuntimeError('PROVIDER_MODEL_MISMATCH')
        if data.get('usage',{}).get('cost',0)>0:raise RuntimeError('PROVIDER_FREE_BILLING_MISMATCH')
        return answer.strip(),{'provider':'openrouter','model':MODEL,'providerModel':data.get('model'),'responseId':data.get('id'),'paidFallback':False,'usage':data.get('usage',{}),'status':'completed'}

