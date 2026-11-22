"""Server-private Slack/Shopify registrations; reviewed endpoint templates only."""
import starli_portable as _portable
import json,re,urllib.parse
from pathlib import Path
from .common import need,envelope
from .connections import OAuthApp

SHOP=re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com')
def shop_domain(value):
    need(type(value)is str,'SHOP_DOMAIN_INVALID',422)
    value=value.strip().lower()
    need(SHOP.fullmatch(value),'SHOP_DOMAIN_INVALID',422)
    return value

class BusinessApps:
    def __init__(self,gateway,load):self.gateway,self.load=gateway,load
    def configuration(self):return self.load() or {}
    def registration(self,provider):return self.configuration().get('providers',{}).get(provider,{})
    def callback(self,provider):
        need(provider in ('slack','shopify'),'CONNECTOR_NOT_FOUND',404)
        return _portable.public_url('/api/v1/starli/automations/oauth/')+provider+'/return'
    def frontend(self,provider):
        config=self.configuration();value=config.get('frontendBaseUrl',_portable.public_url(''))
        parsed=urllib.parse.urlsplit(value)
        need(not parsed.username and not parsed.password and parsed.path in ('','/') and not parsed.query and not parsed.fragment,'OAUTH_FRONTEND_INVALID',503)
        need(value.rstrip('/') in _portable.allowed_origins(),'OAUTH_FRONTEND_INVALID',503)
        return value.rstrip('/')+'/app/integrations/'+provider+'/callback'
    def selected_shop(self,ctx):
        with self.gateway.store.db(readonly=True) as db:
            row=db.execute("SELECT account FROM sa_provider_settings WHERE company=? AND provider='shopify'",(ctx.company,)).fetchone()
        return row['account'] if row else None
    def __call__(self,ctx,provider,account_hint=None):
        if provider not in ('slack','shopify'):return None
        config=self.registration(provider)
        if not config.get('clientId') or not config.get('clientSecret'):return None
        if provider=='slack':
            scopes=tuple(config.get('scopes',['chat:write','channels:read','channels:history']))
            allowed={'chat:write','channels:read','channels:history','groups:read','groups:history'}
            need(set(scopes)<=allowed and 'chat:write' in scopes,'SLACK_SCOPE_CONFIGURATION_INVALID',503)
            return OAuthApp(provider,config['clientId'],config['clientSecret'],self.callback(provider),'https://slack.com/oauth/v2/authorize','https://slack.com/api/oauth.v2.access',scopes,False)
        shop=account_hint or self.selected_shop(ctx)
        if not shop:return None
        shop=shop_domain(shop)
        # V3 is deliberately read-only Shopify. Refund permissions are not
        # silently requested as part of the order-to-Slack review journey.
        scopes=tuple(config.get('scopes',['read_orders']))
        need(set(scopes)=={'read_orders'},'SHOPIFY_READ_ONLY_SCOPE_REQUIRED',503)
        return OAuthApp(provider,config['clientId'],config['clientSecret'],self.callback(provider),'https://'+shop+'/admin/oauth/authorize','https://'+shop+'/admin/oauth/access_token',scopes,False)
    def metadata(self,ctx):
        result=[]
        for provider,prefix in [('slack','SLACK'),('shopify','SHOPIFY')]:
            cfg=self.registration(provider);missing=[]
            if not cfg.get('clientId'):missing.append(prefix+'_CLIENT_ID')
            if not cfg.get('clientSecret'):missing.append(prefix+'_CLIENT_SECRET')
            if self.gateway.connections.vault is None:missing.append('BUSINESS_VAULT_KEY')
            if provider=='slack' and not cfg.get('signingSecret'):missing.append('SLACK_SIGNING_SECRET')
            with self.gateway.store.db(readonly=True) as db:
                row=db.execute('SELECT account,revision FROM sa_provider_settings WHERE company=? AND provider=?',(ctx.company,provider)).fetchone()
            if provider=='shopify' and not row:missing.append('SHOPIFY_SHOP_DOMAIN')
            registration_missing=any(x not in ('SHOPIFY_SHOP_DOMAIN','SLACK_SIGNING_SECRET') for x in missing)
            status='APP_CONFIGURATION_REQUIRED' if registration_missing else 'SHOP_DOMAIN_REQUIRED' if 'SHOPIFY_SHOP_DOMAIN' in missing else 'READY'
            item=dict(providerId=provider,status=status,missingFields=missing,callbackUrl=self.callback(provider))
            if provider=='shopify':item['ordersCreatePublicApproved']=cfg.get('ordersCreatePublicApproved') is True
            if row:item.update(shopDomain=row['account'],setupRevision=row['revision'])
            result.append(item)
        return envelope(ctx.company,providers=result,actions={'canManage':self.gateway.can_manage(ctx)})

def normalize_tokens(provider,raw,previous=None):
    """Slack bot and user scopes/tokens are distinct; never union or substitute."""
    if provider!='slack':return raw
    need(type(raw)is dict and raw.get('ok',True) is True and raw.get('token_type')=='bot' and type(raw.get('access_token'))is str,'SLACK_BOT_TOKEN_REQUIRED',502)
    installation=dict((previous or {}).get('installation',{}))
    team=raw.get('team') or {}
    if team.get('id'):installation['teamId']=team['id']
    if raw.get('bot_user_id'):installation['botUserId']=raw['bot_user_id']
    if raw.get('app_id'):installation['appId']=raw['app_id']
    # This is the explicit OAuth-installing Slack identity, not an email guess.
    if type(raw.get('authed_user'))is dict and raw['authed_user'].get('id'):installation['installerSlackUserId']=raw['authed_user']['id']
    need(installation.get('teamId') and installation.get('botUserId') and installation.get('appId'),'SLACK_WORKSPACE_INSTALL_REQUIRED',502)
    result={k:raw[k] for k in ('access_token','scope','refresh_token','expires_in') if k in raw}
    if 'scope' not in result and previous:result['scope']=previous.get('scope','')
    result.update(token_type='bot',installation=installation)
    return result
