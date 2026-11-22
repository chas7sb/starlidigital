"""Business OAuth HTTP and identity verification using reviewed fixed endpoints."""
import asyncio,json,re,urllib.parse,urllib.request
from .common import need,Fault
from .n8n import NoRedirect

class OAuthTransport:
    def __init__(self,apps):
        self.allowed=frozenset(app.token_url for app in apps.values())
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    async def exchange(self,url,fields):
        need(url in self.allowed and urllib.parse.urlsplit(url).scheme=='https','OAUTH_ENDPOINT_DENIED')
        def send():
            request=urllib.request.Request(url,data=urllib.parse.urlencode(fields).encode(),method='POST',headers={'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'})
            try:
                with self.opener.open(request,timeout=20) as response:
                    data=response.read(65537);need(len(data)<=65536,'OAUTH_RESPONSE_LIMIT',502)
                    result=json.loads(data)
                    need(not result.get('error') and result.get('ok',True) is True,'OAUTH_EXCHANGE_REJECTED',502)
                    return result
            except (OSError,ValueError):raise Fault('OAUTH_EXCHANGE_UNCERTAIN',502) from None
        return await asyncio.to_thread(send)

class AccountVerifier:
    """The host configures expected account domains outside the model/chat.

    Implemented account proofs: Slack auth.test, Shopify shop query, Zendesk
    current-user API, Google userinfo and GitHub current-user API. Other providers
    must inject their actual account proof before becoming configured.
    """
    def __init__(self,transport_for,expected_accounts=None):
        self.transport_for=transport_for;self.expected=dict(expected_accounts or {})
    async def __call__(self,ctx,provider,tokens):
        token=tokens.get('access_token');need(type(token)is str and 0<len(token)<=16384,'OAUTH_TOKEN_INVALID')
        scopes=tokens.get('scope','');scopes=scopes.replace(',',' ').split() if isinstance(scopes,str) else scopes
        auth={'Authorization':'Bearer '+token}
        if provider=='slack':
            _,response=await self.transport_for('https://slack.com').request('POST','/api/auth.test',headers=auth,body={})
            need(response.get('ok') is True and response.get('team_id'),'PROVIDER_IDENTITY_REJECTED')
            return dict(accountId=response['team_id'],displayName=response.get('team',response['team_id']),scopes=scopes)
        if provider=='shopify':
            account=self.expected.get((ctx.company,provider),'');need(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com',account),'SHOPIFY_ACCOUNT_SETUP_REQUIRED',409)
            _,response=await self.transport_for('https://'+account).request('POST','/admin/api/2026-10/graphql.json',headers={'X-Shopify-Access-Token':token},body={'query':'query StarliAccount { shop { id name myshopifyDomain } }'})
            shop=response.get('data',{}).get('shop',{})
            need(not response.get('errors') and shop.get('myshopifyDomain')==account,'PROVIDER_ACCOUNT_CHANGED')
            return dict(accountId=account,displayName=shop.get('name',account),scopes=scopes)
        if provider=='zendesk':
            account=self.expected.get((ctx.company,provider),'');need(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,61}\.zendesk\.com',account),'ZENDESK_ACCOUNT_SETUP_REQUIRED',409)
            _,response=await self.transport_for('https://'+account).request('GET','/api/v2/users/me.json',headers=auth)
            need(response.get('user',{}).get('id'),'PROVIDER_IDENTITY_REJECTED')
            return dict(accountId=account,displayName=account,scopes=scopes)
        if provider in ('gmail','google-calendar','google-drive'):
            _,response=await self.transport_for('https://openidconnect.googleapis.com').request('GET','/v1/userinfo',headers=auth)
            need(response.get('sub') and response.get('email_verified') is True,'PROVIDER_IDENTITY_REJECTED')
            return dict(accountId=response['sub'],displayName=response.get('email',response['sub']),scopes=scopes)
        if provider=='github':
            _,response=await self.transport_for('https://api.github.com').request('GET','/user',headers={**auth,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'StarliDigital-Automations'})
            need(type(response.get('id'))is int,'PROVIDER_IDENTITY_REJECTED')
            return dict(accountId=str(response['id']),displayName=response.get('login',str(response['id'])),scopes=scopes)
        raise Fault('PROVIDER_IDENTITY_VERIFIER_UNAVAILABLE',503)
