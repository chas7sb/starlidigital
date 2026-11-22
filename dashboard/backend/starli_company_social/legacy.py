"""Actual legacy customer OAuth vault and fixed customer service, no admin MCP."""
import starli_portable as _portable
import asyncio,base64,hashlib,hmac,json,secrets,time,uuid
from .core import need,SocialFault,VERSION,envelope,encoded,string,digest

ISSUER=_portable.platform_public_url('')
RETURN=_portable.public_url('/api/v1/starli/social/oauth/return')

class LegacySocial:
    def __init__(self,store,legacy,user_loader,config):
        self.store,self.legacy,self.user_loader,self.config=store,legacy,user_loader,config
    def oauth_configured(self):return self.config.get('clientId')=='starli-openwebui-company'and self.config.get('redirectUri')==RETURN
    def owner(self,actor):
        user=self.user_loader(actor);need(user is not None and user.id==actor,'NATIVE_OWNER_UNAVAILABLE')
        return self.legacy.uid(user)
    def reference(self,actor):
        with self.store.db(readonly=True)as db:row=db.execute('SELECT * FROM cs_accounts WHERE actor=?',(actor,)).fetchone()
        need(row is not None,'COMPANY_SOCIAL_CONNECTION_REQUIRED',409)
        owner=self.owner(actor)
        need(row['legacy_owner']==owner and row['client_id']=='starli-openwebui-company','SOCIAL_ACCOUNT_OWNER_CHANGED');ref=row['credential_ref']
        need(self.reference_live(ref),'SOCIAL_CONNECTION_REQUIRED',409)
        return dict(ownerId=owner,credentialRef=ref)
    def reference_live(self,ref):
        with self.legacy.db()as db:return db.execute('SELECT 1 FROM connections WHERE owner=?',(ref,)).fetchone()is not None
    def account(self,actor):
        try:self.reference(actor);connected=True
        except Exception:connected=False
        return dict(status='CONNECTED'if connected else'CONNECTION_REQUIRED'if self.oauth_configured()else'CLIENT_NOT_CONFIGURED',ownedByCurrentUser=connected,ownerUserId=actor if connected else None)
    async def token(self,ref):
        with self.store.db(readonly=True)as db:binding=db.execute('SELECT * FROM cs_accounts WHERE credential_ref=?',(ref,)).fetchone()
        need(binding is not None,'COMPANY_SOCIAL_CREDENTIAL_BINDING_REQUIRED')
        need(binding['client_id']=='starli-openwebui-company'and self.oauth_configured(),'SOCIAL_CLIENT_CHANGED',409)
        async with self.legacy.LOCKS.setdefault(ref,asyncio.Lock()):
            with self.legacy.db()as db:row=db.execute('SELECT * FROM connections WHERE owner=?',(ref,)).fetchone()
            need(row is not None,'SOCIAL_CONNECTION_REVOKED')
            tokens=json.loads(self.legacy.cipher().decrypt(row['sealed'].encode()))
            if row['expires']>time.time()+60:return tokens['access']
            renewed=await self.legacy.request_json('/customer/oauth/token',dict(grant_type='refresh_token',client_id=binding['client_id'],refresh_token=tokens['refresh']))
            self.legacy.save_tokens(ref,renewed);return renewed['access_token']
    def seal(self,company,resource,value):return self.legacy.cipher().encrypt(encoded(dict(company=company,resource=resource,value=value)).encode()).decode()
    def open(self,company,resource,secret):
        value=json.loads(self.legacy.cipher().decrypt(secret.encode()))
        need(value.get('company')==company and value.get('resource')==resource,'OAUTH_HANDOFF_BINDING_INVALID');return value['value']
    async def json(self,path,*,ref=None,body=None,key=None,method='POST'):
        import aiohttp
        need(path in('/customer/company-social/assets','/customer/company-social/selection','/customer/company-social/loops','/customer/company-social/loops/read','/customer/company-social/loops/control','/customer/company-social/posts'),'CUSTOMER_ENDPOINT_DENIED')
        need(isinstance(key,bytes)and len(key)==32,'SOCIAL_FACTORY_UNCONFIGURED',503)
        raw=b''if body is None else json.dumps(body,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
        need(len(raw)<=65536,'INPUT_LIMIT',413)
        stamp=str(int(time.time()));nonce=secrets.token_hex(16)
        headers={'Content-Type':'application/json','X-Starli-Social-Timestamp':stamp,'X-Starli-Social-Nonce':nonce,
                 'X-Starli-Social-Signature':hmac.new(key,stamp.encode()+b'\n'+nonce.encode()+b'\n'+raw,hashlib.sha256).hexdigest()}
        headers['Authorization']='Bearer '+await self.token(ref)
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20),trust_env=False)as client:
            async with client.request(method,_portable.platform_url(path),headers=headers,data=raw or None,allow_redirects=False)as response:
                result=await response.content.read(65537)
                need(response.status==200 and len(result)<=65536,'SOCIAL_SERVICE_UNAVAILABLE',502)
                try:value=json.loads(result)
                except ValueError:raise SocialFault('SOCIAL_RESPONSE_INVALID',502)from None
        need(type(value)is dict,'SOCIAL_RESPONSE_INVALID',502);return value
    async def assets(self,actor):
        ref=self.reference(actor);value=await self.json('/customer/company-social/assets',ref=ref['credentialRef'],key=self.config.get('_fenceKey'),method='GET')
        need(value.get('version')=='starli.company-social-assets.v1'and value.get('ownerId')==ref['ownerId'],'SOCIAL_ASSET_OWNER_MISMATCH',502)
        pages=value.get('pages');need(type(pages)is list and len(pages)<=100,'SOCIAL_ASSETS_INVALID',502)
        safe=[]
        for page in pages:
            need(type(page)is dict and all(type(page.get(k))is str for k in('id','name','pageConnectionId','accountConnectionId'))and type(page.get('canPublish'))is bool,'SOCIAL_ASSETS_INVALID',502)
            ig=page.get('instagramAccounts',[]);need(type(ig)is list and len(ig)<=4,'SOCIAL_ASSETS_INVALID',502)
            safe.append({k:page[k]for k in('id','name','pageConnectionId','accountConnectionId','canPublish')}|{'instagramAccounts':[dict(id=string(a['id']),name=string(a.get('name',a['id'])),canPublish=a.get('canPublish')is True)for a in ig]})
        return dict(ownerId=ref['ownerId'],pages=safe)
    async def select(self,actor,page):
        ref=self.reference(actor)
        return await self.json('/customer/company-social/selection',ref=ref['credentialRef'],key=self.config.get('_fenceKey'),body=dict(accountConnectionId=page['accountConnectionId'],pageId=page['id']))

class NodeFactory:
    def __init__(self,legacy,config):
        self.legacy=legacy;self.key=config.get('_fenceKey');self.ready=config.get('companyFactoryVersion')=='starli.company-social-create.v1'and isinstance(self.key,bytes)and len(self.key)==32
    async def create(self,ref,binding,plan,activation,command):
        need(self.ready,'COMPANY_FACTORY_UNAVAILABLE',503)
        return await self.legacy.json('/customer/company-social/loops',ref=ref,key=self.key,body=dict(version='starli.company-social-create.v1',binding=binding,plan=plan,activationId=activation))
    async def publish(self,ref,binding,command):
        need(self.ready,'COMPANY_FACTORY_UNAVAILABLE',503)
        return await self.legacy.json('/customer/company-social/posts',ref=ref,key=self.key,body=dict(version='starli.company-social-post.v1',binding=binding,command=command))
    async def control(self,ref,binding,expected,action):
        return await self.legacy.json('/customer/company-social/loops/control',ref=ref,key=self.key,body=dict(binding=binding,expectedNodeRevision=expected,action=action))
    async def read(self,ref,binding):
        return await self.legacy.json('/customer/company-social/loops/read',ref=ref,key=self.key,body=dict(binding=binding,includeHistory=True))

class OAuth:
    def __init__(self,social):self.social=social;self.legacy=social.legacy
    async def begin(self,ctx,request,response):
        legacy=self.legacy;need(legacy.oauth_configured(),'COMPANY_SOCIAL_CLIENT_NOT_CONFIGURED',503)
        with self.social.access(ctx,'connections.manage'):pass
        state=secrets.token_urlsafe(32);hashed=hashlib.sha256(state.encode()).hexdigest();verifier=secrets.token_urlsafe(48)
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        owner=legacy.owner(ctx.actor);client=legacy.config['clientId']
        cookie=await legacy.legacy.native_consent_cookie(request,(client,RETURN),state,challenge)
        with self.social.access(ctx,'connections.manage')as(db,_):
            db.execute('INSERT INTO cs_oauth_states VALUES(?,?,?,?,?,?,?,?,?,?)',(hashed,ctx.company,ctx.actor,ctx.binding,ctx.room,owner,client,legacy.seal(ctx.company,hashed,dict(verifier=verifier)),self.social.clock()+600,'PENDING'))
        response.headers.append('Set-Cookie',cookie)
        from urllib.parse import urlencode
        scopes=await legacy.legacy.available_scopes()
        with self.social.access(ctx,'connections.manage'):pass
        url=ISSUER+'/customer/oauth/authorize?'+urlencode(dict(response_type='code',client_id=client,redirect_uri=RETURN,scope=' '.join(scopes),state=state,code_challenge=challenge,code_challenge_method='S256',resource=ISSUER+'/customer/mcp'))
        return envelope(ctx.company,status='AUTHORIZATION_REQUIRED',authorizationUrl=url,sourceConversationId=ctx.room)
    def receive(self,query):
        need(type(query)is dict and set(query)>={'state','code'}and all(type(v)is str and len(v)<=2000 for v in query.values()),'OAUTH_RETURN_INVALID',422)
        state=string(query['state'],128);code=string(query['code'],256);hashed=hashlib.sha256(state.encode()).hexdigest()
        handle=secrets.token_urlsafe(32);key=hashlib.sha256(handle.encode()).hexdigest()
        with self.social.store.db()as db:
            row=db.execute('SELECT * FROM cs_oauth_states WHERE hash=?',(hashed,)).fetchone()
            need(row and row['state']=='PENDING'and row['expires']>self.social.clock(),'OAUTH_STATE_DENIED')
            need(not db.execute('SELECT 1 FROM cs_oauth_handoffs WHERE state_hash=?',(hashed,)).fetchone(),'OAUTH_HANDOFF_ALREADY_CREATED',409)
            db.execute('INSERT INTO cs_oauth_handoffs VALUES(?,?,?,?,?)',(key,hashed,self.legacy.seal(row['company'],key,dict(code=code)),min(row['expires'],self.social.clock()+300),'PENDING'))
        base=self.legacy.config.get('frontendBaseUrl',_portable.public_url(''))
        need(base in _portable.allowed_origins(),'OAUTH_FRONTEND_INVALID',503)
        return base+'/app/integrations/social/callback#handoff='+handle
    async def complete(self,session,handle):
        key=hashlib.sha256(string(handle,128).encode()).hexdigest()
        with self.social.store.db(readonly=True)as db:
            row=db.execute('SELECT s.*,h.hash AS handoff_hash,h.secret AS handoff_secret,h.expires AS handoff_expires,h.state AS handoff_state FROM cs_oauth_handoffs h JOIN cs_oauth_states s ON s.hash=h.state_hash WHERE h.hash=?',(key,)).fetchone()
            need(row and row['state']=='PENDING'and row['handoff_state']=='PENDING'and min(row['expires'],row['handoff_expires'])>self.social.clock(),'OAUTH_HANDOFF_DENIED')
        ctx=self.social.context(session,row['company'],row['room']);need((ctx.actor,ctx.binding)==(row['actor'],row['binding']),'OAUTH_HANDOFF_OWNER_DENIED')
        need(self.legacy.oauth_configured()and row['client']==self.legacy.config['clientId'],'OAUTH_CLIENT_CHANGED')
        with self.social.access(ctx,'connections.manage')as(db,_):
            need(db.execute("UPDATE cs_oauth_states SET state='EXCHANGING' WHERE hash=? AND state='PENDING'",(row['hash'],)).rowcount==1,'OAUTH_ALREADY_USED')
            need(db.execute("UPDATE cs_oauth_handoffs SET state='EXCHANGING' WHERE hash=? AND state='PENDING'",(key,)).rowcount==1,'OAUTH_ALREADY_USED')
            verifier=self.legacy.open(ctx.company,row['hash'],row['secret'])['verifier'];code=self.legacy.open(ctx.company,key,row['handoff_secret'])['code']
        try:
            tokens=await self.legacy.legacy.request_json('/customer/oauth/token',dict(grant_type='authorization_code',client_id=row['client'],redirect_uri=RETURN,code=code,code_verifier=verifier))
            # New client has a separate opaque row in the EXISTING encrypted
            # legacy vault. Never overwrite the old frontend owner's token row.
            ref='company-social-'+str(uuid.uuid4())
            with self.social.access(ctx,'connections.manage')as(db,_):
                self.legacy.legacy.save_tokens(ref,tokens)
                db.execute('INSERT INTO cs_accounts VALUES(?,?,?,?,1) ON CONFLICT(actor) DO UPDATE SET legacy_owner=excluded.legacy_owner,credential_ref=excluded.credential_ref,client_id=excluded.client_id,revision=cs_accounts.revision+1',(ctx.actor,row['owner'],ref,row['client']))
                db.execute("UPDATE cs_oauth_states SET state='COMPLETED',secret=NULL WHERE hash=?",(row['hash'],));db.execute("UPDATE cs_oauth_handoffs SET state='COMPLETED',secret=NULL WHERE hash=?",(key,))
            return envelope(ctx.company,status='CONNECTED',sourceConversationId=ctx.room,account=self.legacy.account(ctx.actor),companyDelegationRequired=True)
        except BaseException:
            with self.social.store.db()as db:
                db.execute("UPDATE cs_oauth_states SET state='FAILED',secret=NULL WHERE hash=?",(row['hash'],));db.execute("UPDATE cs_oauth_handoffs SET state='FAILED',secret=NULL WHERE hash=?",(key,))
            raise
