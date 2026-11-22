"""Fixed private n8n PublicAPI adapter; no generic admin proxy or ambient keys."""
import re
from starli_automations.common import need
class CredentialAPI:
 def __init__(self,engine):self.engine=engine
 def ident(self,x):need(type(x)is str and re.fullmatch('[A-Za-z0-9_-]{1,128}',x),'ENGINE_CREDENTIAL_REFERENCE_INVALID',503);return x
 async def schema(self,t):return await self.engine.api('GET','/credentials/schema/'+self.ident(t))
 async def create(self,t,name,data):return await self.engine.api('POST','/credentials',dict(type=t,name=name,data=data))
 async def metadata(self,ident):return await self.engine.api('GET','/credentials/'+self.ident(ident))
