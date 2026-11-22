"""Server-owned free OpenRouter inference for guests; no personal credentials or paid fallback."""
from __future__ import annotations
import starli_portable as _portable
import asyncio,json,logging,os
from dataclasses import dataclass
from pathlib import Path
import aiohttp
from fastapi import HTTPException

MODEL="nvidia/nemotron-3-ultra-550b-a55b:free"
ENDPOINT="https://openrouter.ai/api/v1/chat/completions"
CONFIG=Path(_portable.config_file('production.env'))
logger=logging.getLogger(__name__)

def server_key():
    # Fixed protected platform config only. No browser input, account vault, or user-selected provider.
    try:
        from dotenv import dotenv_values
        value=os.environ.get("OPENROUTER_API_KEY") or dotenv_values(CONFIG).get("OPENROUTER_API_KEY")
    except (OSError,ValueError,ImportError):return None
    return value.strip() if isinstance(value,str) and 16<=len(value.strip())<=512 else None

def availability():
    return {"configured":bool(server_key()),"provider":"openrouter","model":MODEL,"paidFallback":False}

@dataclass
class GuestReply:
    text:str
    receipt:dict

def public_usage(raw):
    if not isinstance(raw,dict):return {}
    fields=("prompt_tokens","completion_tokens","total_tokens","cost","is_byok")
    return {k:v for k,v in raw.items() if k in fields and isinstance(v,(int,float,bool))}

async def generate(messages,instructions,*,audience="guest"):
    key=server_key()
    if not key:raise HTTPException(503,"Guest AI is not connected. The operator needs to configure the OpenRouter provider.")
    builder=audience=="builder";limit=8192 if builder else 512;deadline=85 if builder else 25
    body={"model":MODEL,"messages":[{"role":"system","content":instructions}]+messages,
          "max_tokens":limit,"stream":False,"reasoning":{"enabled":False,"exclude":True},
          "provider":{"allow_fallbacks":True,"max_price":{"prompt":0,"completion":0}}}
    if builder:body["response_format"]={"type":"json_object"}
    headers={"Authorization":"Bearer "+key,"Content-Type":"application/json","Accept":"application/json",
             "HTTP-Referer":_portable.public_url(''),"X-Title":"StarliDigital guest workspace"}
    try:
        async with asyncio.timeout(deadline):
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=deadline,connect=8,sock_read=deadline-2),trust_env=False) as client:
                async with client.post(ENDPOINT,headers=headers,json=body,allow_redirects=False) as response:
                    if response.status==429:
                        retry=response.headers.get("Retry-After","60")
                        retry=str(max(1,min(300,int(retry)))) if retry.isdigit() else "60"
                        raise HTTPException(429,"The free guest model is busy. Try again shortly.",headers={"Retry-After":retry})
                    if response.status!=200:
                        logger.warning("Guest OpenRouter model HTTP status %s",response.status)
                        raise HTTPException(503,"The free guest model is temporarily unavailable. No paid provider was used.")
                    chunks=[];size=0
                    async for chunk in response.content.iter_chunked(16384):
                        size+=len(chunk)
                        if size>524288:raise HTTPException(502,"The guest model response exceeded its limit.")
                        chunks.append(chunk)
                    data=json.loads(b"".join(chunks))
        if data.get("error"):raise HTTPException(503,"The free guest model could not complete this reply. No paid provider was used.")
        choice=(data.get("choices") or [{}])[0]
        if choice.get("finish_reason")=="length":raise HTTPException(503,"The free guest model reached its output limit. Refine the request and try again.")
        answer=choice.get("message",{}).get("content")
        if not isinstance(answer,str) or not answer.strip():raise HTTPException(503,"The free guest model returned no reply. Try again shortly.")
        if len(answer)>(200000 if builder else 12000):raise HTTPException(502,"The guest model response exceeded its text limit.")
        actual=str(data.get("model") or MODEL)
        if actual.removesuffix(":free")!=MODEL.removesuffix(":free"):
            raise HTTPException(502,"The guest provider returned an unexpected model.")
        usage=public_usage(data.get("usage"))
        if isinstance(usage.get("cost"),(int,float)) and usage["cost"]>0:
            raise HTTPException(502,"The guest provider did not confirm a free-model response.")
        ident=data.get("id")
        return GuestReply(answer.strip(),{"provider":"openrouter","model":MODEL,"providerModel":actual,
                 "responseId":ident[:160] if isinstance(ident,str) else None,"usage":usage,"status":"completed","paidFallback":False})
    except HTTPException:raise
    except (asyncio.TimeoutError,aiohttp.ClientError):
        logger.warning("Guest OpenRouter model connection unavailable")
        raise HTTPException(503,"The free guest model could not be reached. No paid provider was used.") from None
    except (ValueError,TypeError,KeyError):
        raise HTTPException(502,"The guest provider returned an unreadable reply.") from None
