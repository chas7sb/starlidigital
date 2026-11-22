import starli_portable as _portable
import json,logging,os,stat
from pathlib import Path
from .core import CompanySocial,need
from .legacy import LegacySocial,NodeFactory
from .http import make_router,OAuthLogFilter

def register_tools(runtime,service):
    from starli_company_tools.core import ToolSpec,obj,ID
    def context(bound):
        bound.check();return service.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope)
    def card(bound,args):return service.connect_card(context(bound),args['platform'])
    def propose(bound,args):
        ctx=context(bound);definition={k:args[k]for k in('name','text','pageId','localTime','mediaKind')}
        if args.get('instagramAccountId'):definition['instagramAccountId']=args['instagramAccountId']
        return service.propose(ctx,dict(delegationId=args['delegationId'],definition=definition),bound.run_id+':'+bound.call_id)
    def status(bound,args):return service.snapshot(context(bound))
    runtime.company_tools.register(ToolSpec('company_social_connect','Show a Facebook/Instagram connection and explicit selected-Page delegation card on this exact native assistant. No secret access, OAuth start or account/company grant without human Connect/Delegate.',obj({'platform':{'type':'string','enum':['facebook','instagram']}}),'write','starli-company-social',card,'integrations.run'))
    schema=obj({'delegationId':ID,'name':{'type':'string','minLength':1,'maxLength':160},'text':{'type':'string','minLength':12,'maxLength':1200},'pageId':ID,
                'localTime':{'type':'string','minLength':5,'maxLength':5},'mediaKind':{'type':'string','enum':['IMAGE','REEL']},'instagramAccountId':ID},['delegationId','name','text','pageId','localTime','mediaKind'])
    runtime.company_tools.register(ToolSpec('company_social_loop_propose','Create a DRAFT daily Europe/Bucharest company loop in this exact source conversation. Requires explicit company Page/Instagram delegation. Does not generate paid content or publish; human must approve exact ongoing rules once.',schema,'write','starli-company-social',propose,'integrations.run'))
    runtime.company_tools.register(ToolSpec('company_social_loop_status','Read this bot/source-conversation company loop proposals and standing-rule state; never account-wide personal loops.',obj({}),'read','starli-company-social',status,'integrations.run'))

def install_production(app,runtime,config_path=_portable.config_file('company-social.json')):
    need(runtime is getattr(app.state,'company_bot_runtime',None),'NATIVE_RUNTIME_MISMATCH',503)
    need(not hasattr(app.state,'starli_company_social'),'SOCIAL_ALREADY_INSTALLED',409)
    from starli_automations.native import native_permission
    from open_webui.routers import starli_social as legacy
    from open_webui.models.users import Users
    config={};path=Path(config_path)
    if path.exists():
        need(path.is_absolute()and path.is_file(),'SOCIAL_PRIVATE_CONFIG_REQUIRED',503)
        if os.name!='nt':need(stat.S_IMODE(path.stat().st_mode)&0o027==0,'SOCIAL_CONFIG_PERMISSIONS',503)
        config=json.loads(path.read_text())
    key=None
    if config.get('fenceKeyFile'):
        key_path=Path(config['fenceKeyFile']);need(key_path.is_absolute()and key_path.is_file(),'SOCIAL_FENCE_KEY_REQUIRED',503)
        if os.name!='nt':need(stat.S_IMODE(key_path.stat().st_mode)&0o027==0,'SOCIAL_KEY_PERMISSIONS',503)
        key=key_path.read_bytes();need(len(key)==32,'SOCIAL_KEY_INVALID',503)
    config['_fenceKey']=key
    bridge=LegacySocial(runtime.store,legacy,Users.get_user_by_id,config);node=NodeFactory(bridge,config)
    service=CompanySocial(runtime.store,native_permission(runtime),bridge,node)
    service.install_card_projection();register_tools(runtime,service)
    router=make_router(service,app.state.company_messaging_session,key)
    index=next((i for i,r in enumerate(app.router.routes)if getattr(r,'path',None)==''),len(app.router.routes));app.router.routes[index:index]=router.routes
    logger=logging.getLogger('uvicorn.access')
    if not any(isinstance(f,OAuthLogFilter)for f in logger.filters):logger.addFilter(OAuthLogFilter())
    from .posts import install as install_posts
    app.state.starli_company_social_posts=install_posts(app,runtime,service)
    app.state.starli_company_social=service
    return service
