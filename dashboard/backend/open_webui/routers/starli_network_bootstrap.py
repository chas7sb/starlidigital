"""Fixed reviewed broker startup. No env/user overrides, fallback spawn or model calls."""
import starli_portable as _portable
import hashlib,os,stat,types
from pathlib import Path
CLIENT=Path(_portable.runtime_file('network-child/releases/v1/client.py'))
CLIENT_SHA256='47c3104a94839361ee5ae863e99715dd206b426f82ee5ab00772a717c269e916'
GATEWAY=Path(_portable.runtime_file('search-gateway/releases/research-v2-r1/gateway/research_gateway.py'))
GATEWAY_SHA256='56cd430542f729c8719648ace401cd9d9670b8413790f8d2c3ec7fdebe20e50a'
SCHEMAS=GATEWAY.with_name('tool-schemas.v1.json')
SCHEMAS_SHA256='8005220a1aea9d1aeeb61890a1f5e65f17ae71be3dee79bc3952453da1a0ce07'
MCP_SERVICE=Path(_portable.runtime_file('account-mcp/releases/profile-v1/remote/service.mjs'))
SEARCH_PROFILE='starli.research.public-https.v1'
MCP_PROFILE='starli.account-mcp.public-https.v1'

def _read_reviewed(path,expected):
    # Resolve each fixed directory through no-follow descriptors; root owned/nonwritable.
    descriptor=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in path.parts[1:-1]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=descriptor)
            os.close(descriptor);descriptor=child;info=os.fstat(descriptor)
            if info.st_uid!=0 or info.st_mode&0o022:raise RuntimeError('NETWORK_PROFILE_CODE_UNTRUSTED')
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=descriptor)
        try:
            info=os.fstat(fd)
            if info.st_uid!=0 or not stat.S_ISREG(info.st_mode) or info.st_mode&0o022 or info.st_nlink!=1 or info.st_size>262144:raise RuntimeError('NETWORK_PROFILE_CODE_UNTRUSTED')
            data=bytearray()
            while chunk:=os.read(fd,8192):
                data.extend(chunk)
                if len(data)>262144:raise RuntimeError('NETWORK_PROFILE_CODE_UNTRUSTED')
            if hashlib.sha256(data).hexdigest()!=expected:raise RuntimeError('NETWORK_PROFILE_CODE_MISMATCH')
            return bytes(data)
        finally:os.close(fd)
    finally:os.close(descriptor)

def _client_module():
    data=_read_reviewed(CLIENT,CLIENT_SHA256)
    module=types.ModuleType('_starli_reviewed_network_broker_client_v1')
    module.__file__=str(CLIENT)
    exec(compile(data,str(CLIENT),'exec'),module.__dict__)
    return module

async def start(app):
    from open_webui.routers import starli_search
    starli_search.disable()
    adapter=getattr(app.state,'starli_account_mcp_adapter',None)
    if adapter is not None:
        adapter.launcher=None;adapter.service_path=MCP_SERVICE
    state={'clientVerified':False,'webReady':False,'mcpReady':False,'webTools':[],'codes':{}}
    app.state.starli_network_readiness=state
    try:client=_client_module();state['clientVerified']=True
    except Exception:
        state['codes']['client']='NETWORK_PROFILE_CLIENT_UNAVAILABLE';return state
    search=client.Launcher(SEARCH_PROFILE);mcp=client.Launcher(MCP_PROFILE)
    try:search_ready=await search.ready()
    except Exception:search_ready=False
    if search_ready is True and search.available is True:
        try:
            _read_reviewed(GATEWAY,GATEWAY_SHA256);_read_reviewed(SCHEMAS,SCHEMAS_SHA256)
            starli_search.install(search,gateway_path=GATEWAY,schema_path=SCHEMAS,protected_addresses=('135.125.159.42',))
            state['webTools']=[item['name'] for item in starli_search.schemas()]
            state['webReady']=state['webTools']==['web_search','web_fetch']
            if not state['webReady']:starli_search.disable();state['codes']['web']='SEARCH_PROFILE_UNAVAILABLE'
        except Exception:state['codes']['web']='SEARCH_PROFILE_UNAVAILABLE'
    else:state['codes']['web']='SEARCH_PROFILE_UNAVAILABLE'
    try:mcp_ready=await mcp.ready()
    except Exception:mcp_ready=False
    if adapter is not None and mcp_ready is True and mcp.available is True:
        adapter.service_path=MCP_SERVICE;adapter.launcher=mcp
        state['mcpReady']=adapter.available is True
        if not state['mcpReady']:state['codes']['mcp']='MCP_PROFILE_UNAVAILABLE'
    else:state['codes']['mcp']='MCP_PROFILE_UNAVAILABLE'
    return state
