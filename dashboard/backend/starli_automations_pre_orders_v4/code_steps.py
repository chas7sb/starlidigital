"""Queued isolated code-step contract. Disabled until a real sandbox is ready.

Neither JavaScript nor Python runs inside the gateway, n8n, subprocesses, or
shared host. Reviewed inputs/outputs only; credentials are never code inputs.
"""
from dataclasses import dataclass
from typing import Protocol
from .common import need,exact,digest,encoded

@dataclass(frozen=True)
class SandboxPolicy:
    timeout_seconds:int=10
    memory_mb:int=128
    output_bytes:int=32768
    filesystem:str='ephemeral-no-host-mounts'
    network:str='disabled'
    credentials:str='none'

class IsolatedCodeWorker(Protocol):
    available:bool
    async def execute(self,*,company,workflow,version,operation,language,source,input,policy):...

def review(step):
    exact(step,('kind','language','source','input'))
    need(step['kind']=='code' and step['language'] in ('javascript','python'),'CODE_LANGUAGE_UNSUPPORTED',422)
    need(type(step['source'])is str and 0<len(step['source'].encode())<=16000,'CODE_SOURCE_LIMIT',422)
    need(type(step['input'])is dict,'CODE_INPUT_INVALID',422)
    encoded(step['input'])
    # Review hash is persisted with the immutable workflow version by the host
    # when this separate feature becomes available; no arbitrary IR passthrough.
    return {'hash':digest(step),'policy':SandboxPolicy(),'status':'REQUIRES_ISOLATED_WORKER'}

async def execute(worker,*,company,workflow,version,operation,step):
    review(step)
    need(worker is not None and getattr(worker,'available',False) is True,'ISOLATED_CODE_WORKER_UNAVAILABLE',503)
    result=await worker.execute(company=company,workflow=workflow,version=version,operation=operation,
                                language=step['language'],source=step['source'],input=step['input'],policy=SandboxPolicy())
    encoded(result)
    return result
