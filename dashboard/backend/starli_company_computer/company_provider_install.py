"""Install one company vault instance for API and runtime; no personal vault lookup."""
import starli_portable as _portable
import hashlib,json,os,subprocess
from pathlib import Path
from cryptography.fernet import Fernet
from company_personal_reference import PersonalReferenceProviders as CompanyProviders
from company_bot_runtime.company_provider_api import create_router
from company_bot_runtime import NodeRunner

class ProviderSDK:
    def __init__(self,node,sdk,script):
        self.node,self.sdk,self.script=str(node),str(sdk),str(script)
        result=self.call('catalog')
        self.models={row['id']:row['models'] for row in result['providers']}
    def call(self,operation,**values):
        env={k:os.environ[k] for k in ('PATH','LANG','LC_ALL','TZ','TMPDIR','SSL_CERT_FILE','SystemRoot','WINDIR','TEMP','TMP') if k in os.environ}
        env.update(STARLI_COMPANY_PI_SDK=self.sdk,HOME='/nonexistent')
        result=subprocess.run([self.node,self.script],input=json.dumps({'operation':operation,**values}).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=_portable.child_environment(env),timeout=25)
        if result.returncode or len(result.stdout)>8388608:raise RuntimeError('COMPANY_PROVIDER_METADATA_FAILED')
        response=json.loads(result.stdout)
        if response.get('ok') is not True:raise RuntimeError('COMPANY_PROVIDER_METADATA_FAILED')
        return response
    def authenticate(self,provider,credential):
        return self.call('probe',provider=provider,credential=credential).get('configured') is True
    def refresh(self,provider,credential):
        return self.call('refresh',provider=provider,credential=credential)

class SelectedRunner:
    def __init__(self,hosted,external):self.hosted,self.external=hosted,external
    async def run(self,selection,*args):
        runner=self.hosted if selection['provider']=='hosted' else self.external
        return await runner.run(selection,*args)

def build_company_providers(config,private,authority,bots,enrolled_company):
    root=Path(__file__).parent
    sdk=ProviderSDK(config['node'],config['sdk'],root/'company_provider_sdk.mts')
    catalog=lambda provider:['gpt-oss-120b'] if provider=='hosted' else sdk.models.get(provider,[])
    providers=CompanyProviders(config['providerDatabase'],Fernet((private/'vault.key').read_bytes()),authority,bots.require_bot,catalog,sdk.authenticate,
        refresh_models=sdk.refresh,hosted_available=lambda company:company==enrolled_company)
    providers.initialize()
    return providers

def selected_runner(config,hosted):
    root=Path(__file__).parent;profile=root/'company-selected-profile.mts'
    external=NodeRunner(config['node'],root/'runtime/company_bot_runtime/sdk/turn-worker.mts',profile,hashlib.sha256(profile.read_bytes()).hexdigest(),
        timeout_seconds=21605,child_environment={'STARLI_COMPANY_PI_SDK':config['sdk']})
    return SelectedRunner(hosted,external)

def mount_company_providers(app,providers,verified_user):
    from starlette.routing import Mount
    if getattr(app.state,'company_providers',None) is not None:raise RuntimeError('COMPANY_PROVIDERS_ALREADY_MOUNTED')
    app.state.company_providers=providers
    start=len(app.router.routes);app.include_router(create_router(providers,verified_user))
    added=app.router.routes[start:];del app.router.routes[start:]
    index=next((n for n,r in enumerate(app.router.routes) if isinstance(r,Mount) and r.path==''),len(app.router.routes))
    app.router.routes[index:index]=added
