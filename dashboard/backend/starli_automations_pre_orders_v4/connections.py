"""Durable COMPANY-wide business OAuth/vault facade, separate from model auth.

OAuth applications and identity verifier are host-owned configuration. No secrets
are accepted from chat or returned through DTOs. Cipher keys live outside DB.
"""
import base64
import hashlib
import hmac
import json
import secrets
import time
import urllib.parse
from dataclasses import dataclass, field
from .common import need, Fault, identifier, encoded, envelope, exact, text
from .registry import DEFINITIONS

@dataclass(frozen=True)
class OAuthApp:
    provider: str
    client_id: str
    client_secret: str = field(repr=False)
    redirect_uri: str = ''
    # Exact server-reviewed provider endpoints, never frontend/model URLs.
    authorize_url: str = ''
    token_url: str = ''
    scopes: tuple = ()
    pkce: bool = True

class Vault:
    def __init__(self,key):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        need(isinstance(key,bytes) and len(key)==32,'VAULT_MASTER_KEY_REQUIRED',503)
        self.cipher=AESGCM(key)
    def seal(self,company,resource,value):
        nonce=secrets.token_bytes(12)
        return nonce+self.cipher.encrypt(nonce,encoded(value).encode(),(company+'\0'+resource).encode())
    def open(self,company,resource,value):
        try:return json.loads(self.cipher.decrypt(value[:12],value[12:],(company+'\0'+resource).encode()))
        except Exception:raise Fault('CREDENTIAL_BINDING_INVALID') from None

class Connections:
    def __init__(self,gateway,vault,*,apps=None,oauth_transport=None,verify_identity=None,app_resolver=None):
        self.gateway,self.store,self.vault=gateway,gateway.store,vault
        self.apps=dict(apps or {});self.transport=oauth_transport;self.verify_identity=verify_identity
        self.clock=gateway.clock
        self.app_resolver=app_resolver
    def app_for(self,ctx,provider):
        if self.app_resolver is not None:return self.app_resolver(ctx,provider)
        # Store-specific OAuth endpoints may contain private company account
        # identity. Never reuse those URLs across unrelated tenants.
        app=self.apps.get((ctx.company,provider))
        if app is None and provider not in ('shopify','zendesk','woocommerce'):
            app=self.apps.get(provider)
        return app
    def configured(self,ctx,provider):
        app=self.app_for(ctx,provider)
        return app is not None and app.provider==provider and self.vault is not None and self.transport is not None and callable(self.verify_identity)
    def dto(self,ctx,row):
        status=row['state']
        if status=='CONNECTED' and row['expires'] and row['expires']<=self.clock():status='EXPIRED'
        return envelope(ctx.company,id=row['id'],providerId=row['provider'],displayName=row['name'],accountIdentity=row['account'],status=status,scopes=json.loads(row['scopes']),revision=row['revision'],authOwnerUserId=row['created_by'],credentialScope='COMPANY')
    def list(self,ctx):
        with self.gateway.access(ctx) as db:
            return envelope(ctx.company,items=[self.dto(ctx,r) for r in db.execute('SELECT * FROM sa_connections WHERE company=? ORDER BY provider,account',(ctx.company,))])
    def selected(self,ctx,provider,db):
        rows=db.execute("SELECT * FROM sa_connections WHERE company=? AND provider=? AND state='CONNECTED'",(ctx.company,provider)).fetchall()
        need(len(rows)==1,'CONNECTION_REQUIRED' if not rows else 'CONNECTION_SELECTION_REQUIRED',409)
        row=rows[0]
        need(row['secret'] is not None,'CREDENTIAL_UNAVAILABLE',409)
        need(row['expires'] is None or row['expires']>self.clock(),'REAUTH_REQUIRED',409)
        return row
    def fingerprint(self,ctx,providers,db):
        result=[]
        for provider in providers:
            row=self.selected(ctx,provider,db)
            result.append(dict(id=row['id'],provider=provider,account=row['account'],revision=row['revision'],scopes=json.loads(row['scopes'])))
        return result
    def action_bindings(self,ctx,providers,db):
        result=[]
        for provider in providers:
            rows=db.execute("SELECT id,account FROM sa_connections WHERE company=? AND provider=? AND state='CONNECTED'",(ctx.company,provider)).fetchall()
            need(len(rows)==1,'CONNECTION_CHANGED')
            result.append(dict(provider=provider,id=rows[0]['id'],account=rows[0]['account']))
        return result
    def ready(self,ctx,provider,db=None):
        try:
            if db is not None:
                rows=db.execute("SELECT * FROM sa_connections WHERE company=? AND provider=? AND state='CONNECTED'",(ctx.company,provider)).fetchall()
                need(len(rows)==1,'CONNECTION_REQUIRED');row=rows[0]
                need(row['secret'] is not None,'CREDENTIAL_UNAVAILABLE')
                if row['expires'] and row['expires']<=self.clock():
                    saved=self.vault.open(ctx.company,row['id'],row['secret'])
                    need(self.configured(ctx,provider) and saved['tokens'].get('refresh_token'),'REAUTH_REQUIRED')
            else:
                with self.gateway.access(ctx) as current:return self.ready(ctx,provider,current)
            return True
        except Fault:return False
    async def authorize(self,ctx,provider,form):
        exact(form,('conversationId',),('draftId','expectedRevision','shopDomain','expectedSetupRevision'))
        need(provider in DEFINITIONS,'CONNECTOR_NOT_FOUND',404)
        try:await self.refresh_if_needed(ctx,provider)
        except Fault:pass
        with self.gateway.access(ctx,'integrations.install',form['conversationId']) as db:
            if 'shopDomain' in form:
                from .business_config import shop_domain
                need(provider=='shopify','SHOP_DOMAIN_PROVIDER_MISMATCH',422)
                shop=shop_domain(form['shopDomain'])
                active=db.execute("SELECT account FROM sa_connections WHERE company=? AND provider='shopify' AND state='CONNECTED'",(ctx.company,)).fetchall()
                need(not active or all(r['account']==shop for r in active),'SHOPIFY_ACCOUNT_ALREADY_CONNECTED',409)
                setting=db.execute("SELECT * FROM sa_provider_settings WHERE company=? AND provider='shopify'",(ctx.company,)).fetchone()
                if setting and setting['account']!=shop:need(form.get('expectedSetupRevision')==setting['revision'],'SETUP_REVISION_CONFLICT',409)
                if not setting:db.execute("INSERT INTO sa_provider_settings VALUES(?,'shopify',?,1,?,?)",(ctx.company,shop,ctx.actor,self.clock()))
                elif setting['account']!=shop:db.execute("UPDATE sa_provider_settings SET account=?,revision=revision+1,created_by=?,updated=? WHERE company=? AND provider='shopify'",(shop,ctx.actor,self.clock(),ctx.company))
            if form.get('draftId'):
                draft=self.gateway.row(db,ctx,'sa_drafts',form['draftId'])
                need(draft['room']==form['conversationId'],'CONVERSATION_SCOPE_CHANGED')
                if form.get('expectedRevision') is not None:need(draft['revision']==form['expectedRevision'],'REVISION_CONFLICT',409)
            # Connecting in another chat reuses the same verified company grant.
            try:
                existing=self.selected(ctx,provider,db)
                requested=self.app_for(ctx,provider)
                need(requested is None or set(requested.scopes)<=set(json.loads(existing['scopes'])),'CONNECTION_SCOPE_UPGRADE_REQUIRED',409)
                return envelope(ctx.company,status='CONNECTED',connectionId=existing['id'])
            except Fault:pass
            # Resolve current setting using this same transaction before the
            # external resolver reads it; no uncommitted cross-connection read.
            account_hint=None
            if provider=='shopify':
                current=db.execute("SELECT account FROM sa_provider_settings WHERE company=? AND provider='shopify'",(ctx.company,)).fetchone()
                account_hint=current['account'] if current else None
                if self.app_resolver is not None and not account_hint:return envelope(ctx.company,status='SETUP_UNAVAILABLE',reason='SHOP_DOMAIN_REQUIRED')
            if self.app_resolver is not None:
                app=self.app_resolver(ctx,provider,account_hint=account_hint)
                configured=app is not None and self.vault is not None and self.transport is not None and callable(self.verify_identity)
            else:app=self.app_for(ctx,provider);configured=self.configured(ctx,provider)
            if not configured:return envelope(ctx.company,status='SETUP_UNAVAILABLE',reason='PROVIDER_OAUTH_NOT_CONFIGURED')
            for url in (app.authorize_url,app.token_url,app.redirect_uri):
                parsed=urllib.parse.urlsplit(url);need(parsed.scheme=='https' and parsed.hostname and not parsed.username,'OAUTH_APP_CONFIGURATION_INVALID',503)
            state=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(48)
            app_hash=hashlib.sha256(encoded([app.client_id,app.redirect_uri,list(app.scopes),app.token_url]).encode()).hexdigest()
            db.execute('INSERT INTO sa_oauth VALUES(?,?,?,?,?,?,?,?,?,?,?)',(hashlib.sha256(state.encode()).hexdigest(),ctx.company,ctx.actor,ctx.binding,provider,form['conversationId'],form.get('draftId'),account_hint,self.vault.seal(ctx.company,state,{'verifier':verifier,'appHash':app_hash}),self.clock()+600,'PENDING'))
            query=dict(response_type='code',client_id=app.client_id,redirect_uri=app.redirect_uri,scope=','.join(app.scopes) if provider in ('slack','shopify') else ' '.join(app.scopes),state=state)
            if app.pkce:query.update(code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='),code_challenge_method='S256')
            if provider in ('gmail','google-calendar','google-drive'):query.update(access_type='offline',prompt='consent')
            return envelope(ctx.company,status='AUTHORIZATION_REQUIRED',authorizationUrl=app.authorize_url+'?'+urllib.parse.urlencode(query))
    def callback_context(self,session,state):
        """Tenant derives from authenticated, single-use OAuth state, not URL/body."""
        text(state,128)
        with self.store.db(readonly=True) as db:
            row=db.execute('SELECT company,room FROM sa_oauth WHERE state_hash=?',(hashlib.sha256(state.encode()).hexdigest(),)).fetchone()
            need(row is not None,'OAUTH_STATE_DENIED')
        return self.gateway.context(session,row['company'],row['room'])
    def validate_shopify_callback(self,app,row,state,code,proof):
        from .business_config import shop_domain
        need(type(proof)is dict and all(type(k)is str and type(v)is str and len(v)<=2000 for k,v in proof.items()) and type(proof.get('hmac'))is str,'SHOPIFY_CALLBACK_SIGNATURE_REQUIRED')
        need(proof.get('state')==state and proof.get('code')==code,'SHOPIFY_CALLBACK_BINDING_INVALID')
        shop=shop_domain(proof.get('shop'))
        need(row['account_hint'] is not None and shop==row['account_hint'] and urllib.parse.urlsplit(app.token_url).hostname==shop,'SHOPIFY_CALLBACK_SHOP_CHANGED')
        try:timestamp=int(proof.get('timestamp',''))
        except ValueError:raise Fault('SHOPIFY_CALLBACK_TIMESTAMP_INVALID') from None
        need(abs(self.clock()-timestamp)<=300,'SHOPIFY_CALLBACK_EXPIRED')
        # Match official Shopify JS SDK ProcessedQuery/URLSearchParams encoding,
        # including its treatment of '~' and '*', and deprecated signature key.
        canonical=urllib.parse.urlencode(sorted((k,v) for k,v in proof.items() if k not in ('hmac','signature'))).replace('~','%7E').replace('%2A','*')
        expected=hmac.new(app.client_secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()
        need(hmac.compare_digest(proof['hmac'],expected),'SHOPIFY_CALLBACK_SIGNATURE_INVALID')
    def receive_handoff(self,provider,query):
        """Unauthenticated provider return: verify state/proof, seal temporary
        code, then redirect only to the host-configured frontend with opaque ID.
        Redemption still requires the exact real native user incarnation.
        """
        from .common import Context
        need(provider in ('slack','shopify') and self.vault is not None and self.app_resolver is not None,'OAUTH_HANDOFF_UNAVAILABLE',503)
        need(type(query)is dict and all(type(k)is str and type(v)is str and len(v)<=2000 for k,v in query.items()),'OAUTH_CALLBACK_INVALID',422)
        state=text(query.get('state'),128);code=text(query.get('code'),2000);hashed=hashlib.sha256(state.encode()).hexdigest()
        handoff=secrets.token_urlsafe(32);handoff_hash=hashlib.sha256(handoff.encode()).hexdigest()
        with self.store.db() as db:
            row=db.execute('SELECT * FROM sa_oauth WHERE state_hash=? AND provider=?',(hashed,provider)).fetchone()
            need(row is not None and row['state']=='PENDING' and row['expires']>self.clock(),'OAUTH_STATE_DENIED')
            ctx=Context(row['company'],row['actor'],row['binding'],None,room=row['room'])
            app=self.app_resolver(ctx,provider,account_hint=row['account_hint']);need(app is not None,'OAUTH_APPLICATION_UNAVAILABLE',503)
            if provider=='shopify':self.validate_shopify_callback(app,row,state,code,query)
            sealed=self.vault.seal(row['company'],handoff_hash,{'state':state,'code':code,'proof':query})
            need(not db.execute('SELECT 1 FROM sa_oauth_handoffs WHERE state_hash=?',(hashed,)).fetchone(),'OAUTH_HANDOFF_ALREADY_CREATED',409)
            db.execute('INSERT INTO sa_oauth_handoffs VALUES(?,?,?,?,?,?,?,?,?)',(handoff_hash,hashed,row['company'],row['actor'],row['binding'],provider,sealed,min(row['expires'],self.clock()+300),'PENDING'))
        # Return URL cannot come from query, model, company settings or frontend.
        return self.app_resolver.frontend(provider)+'#'+urllib.parse.urlencode({'handoff':handoff})
    async def complete_handoff(self,session,provider,handoff):
        text(handoff,128);hashed=hashlib.sha256(handoff.encode()).hexdigest()
        with self.store.db(readonly=True) as db:
            row=db.execute('SELECT * FROM sa_oauth_handoffs WHERE hash=? AND provider=?',(hashed,provider)).fetchone()
            need(row is not None and row['state']=='PENDING' and row['expires']>self.clock(),'OAUTH_HANDOFF_DENIED')
            source=db.execute('SELECT room FROM sa_oauth WHERE state_hash=? AND company=?',(row['state_hash'],row['company'])).fetchone()
            need(source is not None,'OAUTH_STATE_DENIED')
        ctx=self.gateway.context(session,row['company'],source['room'])
        need((ctx.actor,ctx.binding)==(row['actor'],row['binding']),'OAUTH_HANDOFF_OWNER_DENIED')
        with self.gateway.access(ctx,'integrations.install') as db:
            current=db.execute('SELECT * FROM sa_oauth_handoffs WHERE hash=? AND company=?',(hashed,ctx.company)).fetchone()
            need(current['state']=='PENDING' and current['expires']>self.clock(),'OAUTH_HANDOFF_DENIED')
            payload=self.vault.open(ctx.company,hashed,current['secret'])
            db.execute("UPDATE sa_oauth_handoffs SET state='REDEEMING' WHERE hash=? AND company=?",(hashed,ctx.company))
        try:
            result=await self.complete(ctx,provider,payload['state'],payload['code'],payload['proof'])
            with self.store.db() as db:db.execute("UPDATE sa_oauth_handoffs SET state='COMPLETED',secret=NULL WHERE hash=? AND company=?",(hashed,ctx.company))
            return result
        except BaseException:
            with self.store.db() as db:db.execute("UPDATE sa_oauth_handoffs SET state='FAILED',secret=NULL WHERE hash=? AND company=?",(hashed,ctx.company))
            raise
    async def complete(self,ctx,provider,state,code,proof=None):
        text(state,128);text(code,2000)
        need(self.configured(ctx,provider),'PROVIDER_OAUTH_NOT_CONFIGURED',503)
        app=self.app_for(ctx,provider);hashed=hashlib.sha256(state.encode()).hexdigest()
        with self.gateway.access(ctx,'integrations.install') as db:
            row=db.execute('SELECT * FROM sa_oauth WHERE state_hash=? AND company=? AND provider=?',(hashed,ctx.company,provider)).fetchone()
            need(row is not None and (row['actor'],row['binding'])==(ctx.actor,ctx.binding) and row['expires']>self.clock() and row['state']=='PENDING','OAUTH_STATE_DENIED')
            self.store.room(db,self.store.authority.require_member(ctx.actor,ctx.company),row['room'])
            if provider=='shopify':self.validate_shopify_callback(app,row,state,code,proof)
            saved=self.vault.open(ctx.company,state,row['verifier']);verifier=saved['verifier']
            current_hash=hashlib.sha256(encoded([app.client_id,app.redirect_uri,list(app.scopes),app.token_url]).encode()).hexdigest()
            need(saved.get('appHash',current_hash)==current_hash,'OAUTH_APPLICATION_CHANGED')
            db.execute("UPDATE sa_oauth SET state='EXCHANGING' WHERE state_hash=?",(hashed,))
        # Code exchange is once-only. A timeout requires a new authorization.
        fields=dict(grant_type='authorization_code',code=code,client_id=app.client_id,client_secret=app.client_secret,redirect_uri=app.redirect_uri)
        if app.pkce:fields['code_verifier']=verifier
        try:
            tokens=await self.transport.exchange(app.token_url,fields)
            if provider=='slack':
                from .business_config import normalize_tokens
                tokens=normalize_tokens(provider,tokens)
            need(type(tokens)is dict and type(tokens.get('access_token'))is str,'OAUTH_TOKEN_INVALID',502)
            identity=await self.verify_identity(ctx,provider,tokens)
            exact(identity,('accountId','displayName','scopes'))
            need(set(app.scopes)<=set(identity['scopes']),'PROVIDER_SCOPES_REQUIRED')
            # The provider may return a pre-existing wider grant. Public/effective
            # capability policy stays at exactly this reviewed consent request.
            effective_scopes=list(app.scopes)
            account=text(identity['accountId'],300);name=text(identity['displayName'],300);now=self.clock()
            expires=now+int(tokens['expires_in']) if tokens.get('expires_in') else None
            with self.gateway.access(ctx,'integrations.install',row['room']) as db:
                current=db.execute('SELECT state FROM sa_oauth WHERE state_hash=? AND company=?',(hashed,ctx.company)).fetchone()
                need(current is not None and current['state']=='EXCHANGING','OAUTH_STATE_CHANGED')
                old=db.execute('SELECT * FROM sa_connections WHERE company=? AND provider=? AND account=?',(ctx.company,provider,account)).fetchone()
                ident=old['id'] if old else identifier()
                sealed=self.vault.seal(ctx.company,ident,{'tokens':tokens,'account':account,'provider':provider})
                if old:
                    db.execute("UPDATE sa_connections SET name=?,scopes=?,state='CONNECTED',revision=revision+1,secret=?,expires=?,created_by=?,updated=? WHERE id=? AND company=?",(name,encoded(effective_scopes),sealed,expires,ctx.actor,now,ident,ctx.company))
                else:db.execute('INSERT INTO sa_connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,ctx.company,provider,account,name,encoded(effective_scopes),'CONNECTED',1,sealed,expires,ctx.actor,now,now))
                if provider=='slack':
                    installer=tokens['installation'].get('installerSlackUserId')
                    if installer:
                        oldmap=db.execute('SELECT user FROM sa_slack_members WHERE company=? AND workspace=? AND slack_user=?',(ctx.company,account,installer)).fetchone()
                        need(oldmap is None or oldmap['user']==ctx.actor,'SLACK_MEMBER_MAPPING_CONFLICT')
                        db.execute('INSERT INTO sa_slack_members VALUES(?,?,?,?,?) ON CONFLICT(company,workspace,slack_user) DO UPDATE SET binding=excluded.binding',(ctx.company,account,installer,ctx.actor,ctx.binding))
                db.execute("UPDATE sa_oauth SET state='COMPLETED',verifier=NULL WHERE state_hash=?",(hashed,))
                self.gateway.audit(db,ctx,'connection.connected',ident,{'provider':provider})
                if row['draft']:self.gateway.feedback.publish(db,ctx,row['draft'])
                return envelope(ctx.company,status='CONNECTED',connectionId=ident,conversationId=row['room'],draftId=row['draft'])
        except BaseException:
            with self.store.db() as db:db.execute("UPDATE sa_oauth SET state='FAILED',verifier=NULL WHERE state_hash=? AND company=?",(hashed,ctx.company))
            raise
    async def lease(self,ctx,provider):
        await self.refresh_if_needed(ctx,provider)
        with self.gateway.access(ctx) as db:
            row=self.selected(ctx,provider,db)
            lease=self.vault.open(ctx.company,row['id'],row['secret'])
            need(lease['account']==row['account'] and lease['provider']==provider,'CREDENTIAL_BINDING_INVALID')
            return row['id'],row['revision'],row['account'],lease['tokens']['access_token']
    async def refresh_if_needed(self,ctx,provider):
        with self.gateway.access(ctx) as db:
            rows=db.execute("SELECT * FROM sa_connections WHERE company=? AND provider=? AND state='CONNECTED'",(ctx.company,provider)).fetchall()
            need(len(rows)==1,'CONNECTION_REQUIRED',409);row=rows[0]
            if not row['expires'] or row['expires']>self.clock()+60:return
            need(self.configured(ctx,provider),'REAUTH_REQUIRED',409)
            saved=self.vault.open(ctx.company,row['id'],row['secret'])
            refresh=saved['tokens'].get('refresh_token');need(refresh,'REAUTH_REQUIRED',409)
            # SQLite BEGIN IMMEDIATE and revision/state CAS are cross-worker.
            db.execute("UPDATE sa_connections SET state='REFRESHING' WHERE id=? AND company=? AND revision=? AND state='CONNECTED'",(row['id'],ctx.company,row['revision']))
        app=self.app_for(ctx,provider)
        try:
            tokens=await self.transport.exchange(app.token_url,dict(grant_type='refresh_token',refresh_token=refresh,client_id=app.client_id,client_secret=app.client_secret))
            if provider=='slack':
                from .business_config import normalize_tokens
                tokens=normalize_tokens(provider,tokens,saved['tokens'])
            need(type(tokens.get('access_token'))is str,'OAUTH_TOKEN_INVALID',502)
            tokens.setdefault('refresh_token',refresh)
            if 'scope' not in tokens and 'scope' in saved['tokens']:tokens['scope']=saved['tokens']['scope']
            identity=await self.verify_identity(ctx,provider,tokens)
            need(identity['accountId']==row['account'] and set(json.loads(row['scopes']))<=set(identity['scopes']),'PROVIDER_ACCOUNT_CHANGED')
            need(tokens.get('expires_in') and int(tokens['expires_in'])>60,'OAUTH_EXPIRY_INVALID',502)
            with self.gateway.access(ctx) as db:
                current=db.execute('SELECT * FROM sa_connections WHERE id=? AND company=?',(row['id'],ctx.company)).fetchone()
                need(current is not None and current['state']=='REFRESHING' and current['revision']==row['revision'],'CONNECTION_REVOKED')
                sealed=self.vault.seal(ctx.company,row['id'],dict(tokens=tokens,account=row['account'],provider=provider))
                db.execute("UPDATE sa_connections SET state='CONNECTED',secret=?,expires=?,revision=revision+1,updated=? WHERE id=? AND company=?",(sealed,self.clock()+int(tokens['expires_in']),self.clock(),row['id'],ctx.company))
        except BaseException:
            with self.store.db() as db:
                db.execute("UPDATE sa_connections SET state='REAUTH_REQUIRED',updated=? WHERE id=? AND company=? AND state='REFRESHING' AND revision=?",(self.clock(),row['id'],ctx.company,row['revision']))
            raise
    async def verify(self,ctx,provider,required_scopes=()):
        ident,revision,account,token=await self.lease(ctx,provider)
        need(callable(self.verify_identity),'PROVIDER_IDENTITY_VERIFIER_UNAVAILABLE',503)
        identity=await self.verify_identity(ctx,provider,{'access_token':token})
        need(identity['accountId']==account,'PROVIDER_ACCOUNT_CHANGED')
        with self.gateway.access(ctx) as db:
            current=self.selected(ctx,provider,db)
            need(current['id']==ident and current['revision']==revision,'CONNECTION_CHANGED')
            need(set(required_scopes)<=set(json.loads(current['scopes'])),'PROVIDER_SCOPES_REQUIRED')
        return True
    def disconnect(self,ctx,ident,revision):
        with self.gateway.access(ctx,'integrations.install') as db:
            row=db.execute('SELECT * FROM sa_connections WHERE id=? AND company=?',(ident,ctx.company)).fetchone()
            need(row is not None,'CONNECTION_NOT_FOUND',404);need(row['revision']==revision,'REVISION_CONFLICT',409)
            db.execute("UPDATE sa_connections SET state='REVOKED',secret=NULL,revision=revision+1,updated=? WHERE id=? AND company=?",(self.clock(),ident,ctx.company))
            # Every bot/chat rechecks this shared grant before provider calls.
            self.gateway.audit(db,ctx,'connection.revoked',ident)
            return envelope(ctx.company,id=ident,status='REVOKED',revision=revision+1)
