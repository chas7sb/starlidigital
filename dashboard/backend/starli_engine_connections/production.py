"""Uses actual current private engine API and existing AES-GCM company vault."""
import starli_portable as _portable
import ipaddress
from pathlib import Path
from urllib.parse import urlsplit
from starli_automations.common import need
from .core import CompanyConnections
from .schema import Catalog
from .engine import CredentialAPI
from .native import install

DEFAULT_CREDENTIAL_CONFIG=_portable.config_file('n8n-credentials-engine.json')
def credential_engine(gateway,config_path=DEFAULT_CREDENTIAL_CONFIG):
 from starli_automations.n8n import N8nEngine,JsonTransport
 from starli_automations.production import private_json
 need(isinstance(gateway.engine,N8nEngine),'ACTUAL_N8N_PUBLIC_API_REQUIRED',503)
 path=Path(config_path)
 # A missing dedicated config preserves existing private engine/scopes. No key
 # escalation or ambient fallback; credential operations still require upstream scopes.
 if not path.exists():return gateway.engine
 config=private_json(path);need(type(config)is dict and set(config)=={'baseUrl','apiKey'},'CREDENTIAL_ENGINE_CONFIG_INVALID',503)
 origin=config.get('baseUrl');need(type(origin)is str and origin.rstrip('/')==gateway.engine.transport.origin,'CREDENTIAL_ENGINE_ORIGIN_MISMATCH',503)
 parsed=urlsplit(origin)
 try:loopback=ipaddress.ip_address(parsed.hostname).is_loopback
 except ValueError:loopback=False
 need(parsed.scheme=='http'and loopback,'CREDENTIAL_ENGINE_LOOPBACK_REQUIRED',503)
 transport=JsonTransport(origin,allow_loopback_http=True,timeout=15)
 def key():
  fresh=private_json(path)
  need(type(fresh)is dict and set(fresh)=={'baseUrl','apiKey'}and fresh['baseUrl']==origin,'CREDENTIAL_ENGINE_CONFIG_CHANGED',503)
  need(type(fresh['apiKey'])is str and len(fresh['apiKey'])>10,'CREDENTIAL_ENGINE_KEY_REQUIRED',503)
  return fresh['apiKey']
 key() # Validate protected key configuration before installing any forms.
 return N8nEngine(transport,key)

def configured_origins(gateway):
 return _portable.allowed_origins()

def install_production(app,runtime,credential_config_path=DEFAULT_CREDENTIAL_CONFIG):
 need(runtime is getattr(app.state,'company_bot_runtime',None),'NATIVE_RUNTIME_REQUIRED',503)
 gateway=app.state.starli_automations
 need(gateway.store is runtime.store and gateway.connections.vault is not None,'NATIVE_COMPANY_VAULT_REQUIRED',503)
 engine=credential_engine(gateway,credential_config_path)
 service=CompanyConnections(gateway,Catalog(),CredentialAPI(engine),gateway.connections.vault)
 service.recover();return install(app,runtime,service,allowed_origins=configured_origins(gateway))
