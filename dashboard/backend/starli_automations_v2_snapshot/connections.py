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
    def __init__(self,gateway,vault,*,apps=None,oauth_transport=None,verify_identity=None):
        self.gateway,self.store,self.vault=gateway,gateway.store,vault
        self.apps=dict(apps or {});self.transport=oauth_transport;self.verify_identity=verify_identity
        self.clock=gateway.clock
    def app_for(self,ctx,provider):
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
        exact(form,('conversationId',),('draftId','expectedRevision'))
        need(provider in DEFINITIONS,'CONNECTOR_NOT_FOUND',404)
        try:await self.refresh_if_needed(ctx,provider)
        except Fault:pass
        with self.gateway.access(ctx,'integrations.install',form['conversationId']) as db:
            if form.get('draftId'):
                draft=self.gateway.row(db,ctx,'sa_drafts',form['draftId'])
                need(draft['room']==form['conversationId'],'CONVERSATION_SCOPE_CHANGED')
                if form.get('expectedRevision') is not None:need(draft['revision']==form['expectedRevision'],'REVISION_CONFLICT',409)
            # Connecting in another chat reuses the same verified company grant.
            try:
                existing=self.selected(ctx,provider,db)
                return envelope(ctx.company,status='CONNECTED',connectionId=existing['id'])
            except Fault:pass
            if not self.configured(ctx,provider):return envelope(ctx.company,status='SETUP_UNAVAILABLE',reason='PROVIDER_OAUTH_NOT_CONFIGURED')
            app=self.app_for(ctx,provider)
            for url in (app.authorize_url,app.token_url,app.redirect_uri):
                parsed=urllib.parse.urlsplit(url);need(parsed.scheme=='https' and parsed.hostname and not parsed.username,'OAUTH_APP_CONFIGURATION_INVALID',503)
            state=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(48)
            db.execute('INSERT INTO sa_oauth VALUES(?,?,?,?,?,?,?,?,?,?,?)',(hashlib.sha256(state.encode()).hexdigest(),ctx.company,ctx.actor,ctx.binding,provider,form['conversationId'],form.get('draftId'),None,self.vault.seal(ctx.company,state,{'verifier':verifier}),self.clock()+600,'PENDING'))
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
    async def complete(self,ctx,provider,state,code,proof=None):
        text(state,128);text(code,2000)
        need(self.configured(ctx,provider),'PROVIDER_OAUTH_NOT_CONFIGURED',503)
        app=self.app_for(ctx,provider);hashed=hashlib.sha256(state.encode()).hexdigest()
        if provider=='shopify':
            need(type(proof)is dict and type(proof.get('hmac'))is str,'SHOPIFY_CALLBACK_SIGNATURE_REQUIRED')
            supplied=proof['hmac'];canonical=urllib.parse.urlencode(sorted((k,v) for k,v in proof.items() if k not in ('hmac','signature')))
            expected=hmac.new(app.client_secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()
            need(hmac.compare_digest(supplied,expected),'SHOPIFY_CALLBACK_SIGNATURE_INVALID')
        with self.gateway.access(ctx,'integrations.install') as db:
            row=db.execute('SELECT * FROM sa_oauth WHERE state_hash=? AND company=? AND provider=?',(hashed,ctx.company,provider)).fetchone()
            need(row is not None and (row['actor'],row['binding'])==(ctx.actor,ctx.binding) and row['expires']>self.clock() and row['state']=='PENDING','OAUTH_STATE_DENIED')
            self.store.room(db,self.store.authority.require_member(ctx.actor,ctx.company),row['room'])
            verifier=self.vault.open(ctx.company,state,row['verifier'])['verifier']
            db.execute("UPDATE sa_oauth SET state='EXCHANGING' WHERE state_hash=?",(hashed,))
        # Code exchange is once-only. A timeout requires a new authorization.
        fields=dict(grant_type='authorization_code',code=code,client_id=app.client_id,client_secret=app.client_secret,redirect_uri=app.redirect_uri)
        if app.pkce:fields['code_verifier']=verifier
        try:
            tokens=await self.transport.exchange(app.token_url,fields)
            need(type(tokens)is dict and type(tokens.get('access_token'))is str,'OAUTH_TOKEN_INVALID',502)
            identity=await self.verify_identity(ctx,provider,tokens)
            exact(identity,('accountId','displayName','scopes'))
            need(set(app.scopes)<=set(identity['scopes']),'PROVIDER_SCOPES_REQUIRED')
            account=text(identity['accountId'],300);name=text(identity['displayName'],300);now=self.clock()
            expires=now+int(tokens['expires_in']) if tokens.get('expires_in') else None
            with self.gateway.access(ctx,'integrations.install',row['room']) as db:
                current=db.execute('SELECT state FROM sa_oauth WHERE state_hash=? AND company=?',(hashed,ctx.company)).fetchone()
                need(current is not None and current['state']=='EXCHANGING','OAUTH_STATE_CHANGED')
                old=db.execute('SELECT * FROM sa_connections WHERE company=? AND provider=? AND account=?',(ctx.company,provider,account)).fetchone()
                ident=old['id'] if old else identifier()
                sealed=self.vault.seal(ctx.company,ident,{'tokens':tokens,'account':account,'provider':provider})
                if old:
                    db.execute("UPDATE sa_connections SET name=?,scopes=?,state='CONNECTED',revision=revision+1,secret=?,expires=?,created_by=?,updated=? WHERE id=? AND company=?",(name,encoded(identity['scopes']),sealed,expires,ctx.actor,now,ident,ctx.company))
                else:db.execute('INSERT INTO sa_connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,ctx.company,provider,account,name,encoded(identity['scopes']),'CONNECTED',1,sealed,expires,ctx.actor,now,now))
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
