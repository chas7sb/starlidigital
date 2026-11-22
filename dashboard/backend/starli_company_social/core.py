"""Canonical native company social delegation/proposals, never account fallback."""
import hashlib,hmac,json,re,secrets,time,uuid
from contextlib import contextmanager
from dataclasses import dataclass

VERSION='starli.company-social.v1'
LOOPS='starli.company-scheduled-loops.v1'
EFFECTS={'caption.generate','image.generate','video.render','facebook.publish','instagram.container','instagram.publish','loop.activate','loop.pause','loop.resume','loop.cancel'}

class SocialFault(Exception):
    def __init__(self,code,status=403):self.code,self.status=code,status;super().__init__(code)
def need(value,code='SOCIAL_SCOPE_DENIED',status=403):
    if not value:raise SocialFault(code,status)
def encoded(value):
    raw=json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
    need(len(raw.encode())<=65536,'INPUT_LIMIT',413);return raw
def digest(value):return hashlib.sha256(encoded(value).encode()).hexdigest()
def exact(value,required,optional=()):
    need(type(value)is dict and set(required)<=set(value)<=set(required)|set(optional),'INVALID_INPUT',422)
def string(value,limit=160):need(type(value)is str and 0<len(value)<=limit and '\x00'not in value,'INVALID_INPUT',422);return value
def envelope(company,**values):return dict(version=VERSION,companyId=company,**values)

@dataclass(frozen=True)
class Context:
    company:str;actor:str;binding:str;session:object;room:str|None=None;bot:str|None=None;native_scope:object=None

SCHEMA='''
CREATE TABLE IF NOT EXISTS cs_accounts(actor TEXT PRIMARY KEY,legacy_owner TEXT NOT NULL,credential_ref TEXT NOT NULL,client_id TEXT,revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cs_delegations(id TEXT PRIMARY KEY,company TEXT,actor TEXT,binding TEXT,legacy_owner TEXT,credential_ref TEXT,room TEXT,pages TEXT,state TEXT,revision INTEGER,created REAL,updated REAL);
CREATE TABLE IF NOT EXISTS cs_loops(id TEXT PRIMARY KEY,company TEXT,delegation TEXT,bot TEXT,room TEXT,creator TEXT,creator_binding TEXT,definition TEXT,revision INTEGER,state TEXT,digest TEXT,approver TEXT,approver_binding TEXT,expires REAL,node_id TEXT,node_revision INTEGER,request_key TEXT,fingerprint TEXT,created REAL,updated REAL,UNIQUE(company,request_key));
CREATE TABLE IF NOT EXISTS cs_cards(company TEXT,room TEXT,message TEXT,bot TEXT,platform TEXT,updated REAL,PRIMARY KEY(company,message,platform));
CREATE TABLE IF NOT EXISTS cs_effect_nonces(nonce TEXT PRIMARY KEY,expires REAL);
CREATE TABLE IF NOT EXISTS cs_activations(id TEXT PRIMARY KEY,company TEXT,loop TEXT,revision INTEGER,command_digest TEXT,expires REAL,state TEXT);
CREATE TABLE IF NOT EXISTS cs_controls(company TEXT,loop TEXT,revision INTEGER,node TEXT,action TEXT,binding TEXT,actor TEXT,actor_binding TEXT,room TEXT,expires REAL,state TEXT,PRIMARY KEY(company,loop,revision,node,action));
CREATE TABLE IF NOT EXISTS cs_node_history(company TEXT,loop TEXT,node TEXT,binding TEXT,created REAL,PRIMARY KEY(company,loop,node));
CREATE TABLE IF NOT EXISTS cs_day_claims(company TEXT,loop TEXT,day TEXT,node TEXT,PRIMARY KEY(company,loop,day));
CREATE TABLE IF NOT EXISTS cs_oauth_states(hash TEXT PRIMARY KEY,company TEXT,actor TEXT,binding TEXT,room TEXT,owner TEXT,client TEXT,secret TEXT,expires REAL,state TEXT);
CREATE TABLE IF NOT EXISTS cs_oauth_handoffs(hash TEXT PRIMARY KEY,state_hash TEXT UNIQUE,secret TEXT,expires REAL,state TEXT);
'''

class CompanySocial:
    def __init__(self,store,permission,legacy,node,*,clock=time.time,calendar_day=None):
        self.store,self.permission,self.legacy,self.node,self.clock=store,permission,legacy,node,clock
        if calendar_day:self.calendar_day=calendar_day
        else:
            def local_day(stamp):
                from datetime import datetime
                from zoneinfo import ZoneInfo
                return datetime.fromtimestamp(stamp,ZoneInfo('Europe/Bucharest')).date().isoformat()
            self.calendar_day=local_day
        with store.db()as db:db.executescript(SCHEMA)
    def context(self,session,company,room=None,bot=None,native_scope=None):
        need(getattr(session,'kind',None)=='jwt','NATIVE_JWT_REQUIRED',401)
        with self.store.access(session,company,room)as(db,member,_):
            ctx=Context(member.company_id,member.user_id,member.binding,session,room,bot,native_scope)
            self.permission(ctx,db,'read');return ctx
    @contextmanager
    def access(self,ctx,permission='read',room=None):
        with self.store.access(ctx.session,ctx.company,room or ctx.room)as(db,member,_):
            need((member.user_id,member.binding)==(ctx.actor,ctx.binding),'MEMBERSHIP_CHANGED')
            self.permission(ctx,db,permission)
            if ctx.bot:self.store.agent(db,member,room or ctx.room,ctx.bot)
            yield db,member
            self.permission(ctx,db,permission)
    def can(self,ctx,permission):
        try:
            with self.access(ctx,permission):return True
        except Exception:return False
    def delegation(self,db,company,ident):
        row=db.execute('SELECT * FROM cs_delegations WHERE id=? AND company=?',(ident,company)).fetchone()
        need(row is not None and row['state']=='ACTIVE','DELEGATION_UNAVAILABLE',409)
        owner=self.store.authority.require_member(row['actor'],company)
        need(owner.binding==row['binding'],'DELEGATION_OWNER_REVOKED')
        self.permission(Context(company,row['actor'],row['binding'],None),db,'connections.manage')
        return row
    def delegation_dto(self,row):
        return dict(id=row['id'],revision=row['revision'],ownerUserId=row['actor'],status=row['state'],pages=json.loads(row['pages']),rulesDigest=digest(json.loads(row['pages'])))
    async def connections(self,ctx):
        with self.access(ctx)as(db,_):
            rows=db.execute('SELECT * FROM cs_delegations WHERE company=? ORDER BY created',(ctx.company,)).fetchall()
            values=[self.delegation_dto(r)for r in rows]
        account=self.legacy.account(ctx.actor)
        manage=self.can(ctx,'connections.manage')
        return envelope(ctx.company,account=account,delegations=values,
            actions=dict(canConnect=manage and self.legacy.oauth_configured(),canDelegate=manage and account['status']=='CONNECTED'and self.node.ready,canRevoke=manage),
            capabilities=dict(oauthConfigured=self.legacy.oauth_configured(),nodeCompanyFactoryReady=self.node.ready,publishingReady=False,metaPermissionsVerified=False,facebookTextPostReview=True,instagramOneOffPublishing=False,
                              maxPagesPerDelegation=1,selectionPolicy='PRESERVE_EXISTING_LEGACY_SELECTION'))
    async def assets(self,ctx):
        with self.access(ctx,'connections.manage'):pass
        value=await self.legacy.assets(ctx.actor)
        with self.access(ctx,'connections.manage'):pass
        return envelope(ctx.company,pages=value['pages'])
    async def delegate(self,ctx,form):
        exact(form,('sourceConversationId','pages'),('expectedRevision',))
        need(ctx.room==form['sourceConversationId'],'SOURCE_CONVERSATION_CHANGED')
        need(type(form['pages'])is list and len(form['pages'])==1,'ONE_PAGE_PER_DELEGATION_SUPPORTED',422)
        available=await self.assets(ctx);selected=[];seen=set()
        for wanted in form['pages']:
            exact(wanted,('pageId','pageConnectionId','instagramAccountIds'))
            matches=[p for p in available['pages']if p['id']==wanted['pageId']and p['pageConnectionId']==wanted['pageConnectionId']and p['canPublish']is True]
            need(len(matches)==1 and wanted['pageId']not in seen,'OWNED_PAGE_REQUIRED');page=matches[0];seen.add(page['id'])
            ids=wanted['instagramAccountIds'];need(type(ids)is list and len(ids)==len(set(ids))and len(ids)<=4,'INSTAGRAM_ALLOWLIST_INVALID',422)
            allowed={v['id']for v in page['instagramAccounts']if v['canPublish']is True}
            need(set(ids)<=allowed,'OWNED_INSTAGRAM_REQUIRED')
            selected.append(dict(pageId=page['id'],pageConnectionId=page['pageConnectionId'],name=page['name'],instagramAccountIds=sorted(ids)))
        # ONLY the guarded owner endpoint; it must no-op for same current page
        # and refuse changing a selection used by existing personal loops.
        await self.legacy.select(ctx.actor,matches[0])
        ref=self.legacy.reference(ctx.actor)
        with self.access(ctx,'connections.manage')as(db,_):
            old=db.execute("SELECT * FROM cs_delegations WHERE company=? AND actor=? AND state='ACTIVE'",(ctx.company,ctx.actor)).fetchone()
            if old:
                need(form.get('expectedRevision')==old['revision'],'REVISION_CONFLICT',409)
                ident=old['id'];db.execute('UPDATE cs_delegations SET pages=?,revision=revision+1,updated=? WHERE id=?',(encoded(selected),self.clock(),ident))
                # Native effect fence stops old rules even if provider pause RPC fails.
                db.execute("UPDATE cs_loops SET state='REVIEW_REQUIRED',revision=revision+1,approver=NULL,updated=? WHERE delegation=? AND state!='DELETED'",(self.clock(),ident))
            else:
                ident=str(uuid.uuid4());db.execute('INSERT INTO cs_delegations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(ident,ctx.company,ctx.actor,ctx.binding,ref['ownerId'],ref['credentialRef'],ctx.room,encoded(selected),'ACTIVE',1,self.clock(),self.clock()))
            row=db.execute('SELECT * FROM cs_delegations WHERE id=?',(ident,)).fetchone()
            if old:
                for loop in db.execute("SELECT * FROM cs_loops WHERE delegation=? AND state='REVIEW_REQUIRED'",(ident,)).fetchall():
                    try:self._page(row,json.loads(loop['definition']))
                    except SocialFault:continue
                    db.execute('UPDATE cs_loops SET digest=? WHERE id=?',(self._rules(loop,row),loop['id']))
            return envelope(ctx.company,sourceConversationId=ctx.room,delegation=self.delegation_dto(row))
    def revoke(self,ctx,ident,revision):
        with self.access(ctx,'connections.manage')as(db,_):
            row=db.execute('SELECT * FROM cs_delegations WHERE id=? AND company=?',(ident,ctx.company)).fetchone()
            need(row is not None,'DELEGATION_NOT_FOUND',404);need(row['revision']==revision,'REVISION_CONFLICT',409)
            db.execute("UPDATE cs_delegations SET state='REVOKED',revision=revision+1,updated=? WHERE id=?",(self.clock(),ident))
            db.execute("UPDATE cs_loops SET state='REVOKED',revision=revision+1,approver=NULL,updated=? WHERE delegation=? AND state!='DELETED'",(self.clock(),ident))
            return envelope(ctx.company,id=ident,revision=revision+1,status='REVOKED',sourceConversationId=row['room'])
    def _loop(self,db,ctx,ident,member):
        row=db.execute('SELECT * FROM cs_loops WHERE id=? AND company=?',(ident,ctx.company)).fetchone()
        need(row is not None and row['state']!='DELETED','LOOP_NOT_FOUND',404)
        self.store.room(db,member,row['room']);return row
    def _definition(self,definition):
        exact(definition,('name','text','pageId','localTime','mediaKind'),('instagramAccountId',))
        for k,n in [('name',160),('text',1200),('pageId',160)]:string(definition[k],n)
        need(len(definition['text'].strip())>=12,'STANDING_PROMPT_TOO_SHORT',422)
        need(re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',definition['localTime'])is not None,'DAILY_TIME_REQUIRED',422)
        need(definition['mediaKind']in('IMAGE','REEL'),'MEDIA_KIND_INVALID',422)
        if 'instagramAccountId'in definition:string(definition['instagramAccountId'])
        return dict(definition,text=definition['text'].strip())
    def _rules(self,row,delegation):
        definition=json.loads(row['definition'])
        value=dict(companyId=row['company'],delegationId=delegation['id'],delegationRevision=delegation['revision'],loopId=row['id'],
            ownerId=delegation['legacy_owner'],sourceConversationId=row['room'],ownerBotId=row['bot'],definition=definition,
            timezone='Europe/Bucharest',maxPostsPerLocalDay=1,paidCaptionGeneration=True,paidImageGeneration=True,
            paidVideoRendering=definition['mediaKind']=='REEL',expiresAt=row['expires'])
        return digest(value)
    def propose(self,ctx,form,key):
        need(ctx.bot and ctx.room and ctx.native_scope is not None,'BOT_NATIVE_PROPOSAL_REQUIRED')
        exact(form,('delegationId','definition'));definition=self._definition(form['definition']);string(key,220)
        with self.access(ctx,'integrations.run')as(db,member):
            delegation=self.delegation(db,ctx.company,form['delegationId']);self._page(delegation,definition)
            fingerprint=digest([ctx.actor,ctx.binding,ctx.bot,ctx.room,form])
            prior=db.execute('SELECT * FROM cs_loops WHERE company=? AND request_key=?',(ctx.company,key)).fetchone()
            if prior:need(prior['fingerprint']==fingerprint,'OPERATION_KEY_CONFLICT',409);return self.dto(ctx,prior,db,member)
            ident=str(uuid.uuid4());now=self.clock();expires=now+30*86400
            db.execute('INSERT INTO cs_loops VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,ctx.company,delegation['id'],ctx.bot,ctx.room,ctx.actor,ctx.binding,encoded(definition),1,'DRAFT','',None,None,expires,None,None,key,fingerprint,now,now))
            row=db.execute('SELECT * FROM cs_loops WHERE id=?',(ident,)).fetchone();rules=self._rules(row,delegation)
            db.execute('UPDATE cs_loops SET digest=? WHERE id=?',(rules,ident))
            return self.dto(ctx,db.execute('SELECT * FROM cs_loops WHERE id=?',(ident,)).fetchone(),db,member)
    def _page(self,delegation,definition):
        pages=[p for p in json.loads(delegation['pages'])if p['pageId']==definition['pageId']]
        need(len(pages)==1,'PAGE_NOT_DELEGATED')
        if definition.get('instagramAccountId'):need(definition['instagramAccountId']in pages[0]['instagramAccountIds'],'INSTAGRAM_NOT_DELEGATED')
        return pages[0]
    def dto(self,ctx,row,db,member):
        self.store.room(db,member,row['room']);definition=json.loads(row['definition'])
        delegation=db.execute('SELECT * FROM cs_delegations WHERE id=?',(row['delegation'],)).fetchone()
        pages=json.loads(delegation['pages'])if delegation else[];page=next((p for p in pages if p['pageId']==definition['pageId']),None)
        destinations=[dict(id='fb:'+definition['pageId'],platform='facebook',label=page['name']if page else'Facebook Page')]
        if definition.get('instagramAccountId'):destinations.append(dict(id='ig:'+definition['instagramAccountId'],platform='instagram',label='Instagram'))
        manage=False
        if ctx.bot is None:
            try:self.permission(ctx,db,'connections.manage');manage=True
            except Exception:pass
        active=row['state']=='ACTIVE';review=row['state']in('DRAFT','REVIEW_REQUIRED','PAUSED')
        valid_rules=False
        try:
            current=self.delegation(db,ctx.company,row['delegation']);self._page(current,definition)
            valid_rules=row['digest']==self._rules(row,current)and row['expires']>self.clock()
        except Exception:pass
        return dict(version=LOOPS,contractVersion=VERSION,companyId=ctx.company,id=row['id'],revision=row['revision'],name=definition['name'],status=row['state'],
            ownerBot=dict(id=row['bot'],name=row['bot']),sourceConversationId=row['room'],destinations=destinations,text=definition['text'],media=[],
            mediaKind=definition['mediaKind'],schedule=dict(expression=definition['localTime'],timezone='Europe/Bucharest'),nextDueAt=None,
            rules=dict(digest=row['digest'],summary=['One daily post at '+definition['localTime']+' Europe/Bucharest.','Publish only to the selected delegated Page'+(' and linked Instagram.'if definition.get('instagramAccountId')else'.'),'Includes paid caption/image generation'+(' and video rendering.'if definition['mediaKind']=='REEL'else'.'),'No per-post approval while these exact standing rules remain active.'],requiresActivation=not active,expiresAt=row['expires']),
            actions=dict(canEdit=manage,canDelete=manage,canPause=manage and active,canResume=manage and valid_rules and row['state']=='PAUSED'and bool(row['approver'])and self.node.ready,canActivate=manage and valid_rules and review and self.node.ready))
    def snapshot(self,ctx):
        with self.access(ctx)as(db,member):
            items=[]
            for row in db.execute("SELECT * FROM cs_loops WHERE company=? AND state!='DELETED' ORDER BY created DESC LIMIT 100",(ctx.company,)):
                if ctx.bot and (row['room']!=ctx.room or row['bot']!=ctx.bot):continue
                try:items.append(self.dto(ctx,row,db,member))
                except Exception:continue
            destinations=[]
            for delegation in db.execute("SELECT * FROM cs_delegations WHERE company=? AND state='ACTIVE'",(ctx.company,)):
                try:self.delegation(db,ctx.company,delegation['id'])
                except Exception:continue
                for page in json.loads(delegation['pages']):
                    destinations.append(dict(id='fb:'+page['pageId'],platform='facebook',label=page['name'],canUse=True))
                    destinations.extend(dict(id='ig:'+ig,platform='instagram',label='Instagram',canUse=True)for ig in page['instagramAccountIds'])
            destinations=list({d['id']:d for d in destinations}.values())
            return dict(version=LOOPS,contractVersion=VERSION,companyId=ctx.company,scheduleCapabilities=dict(kind='daily',timezone='Europe/Bucharest'),items=items,destinations=destinations,media=[])
    def update(self,ctx,ident,form):
        exact(form,('expectedRevision','patch'));patch=form['patch']
        exact(patch,('name','text','destinationIds','mediaIds','schedule'))
        exact(patch['schedule'],('expression','timezone'));need(patch['schedule']['timezone']=='Europe/Bucharest','DAILY_BUCHAREST_REQUIRED',422)
        need(patch['mediaIds']==[],'MEDIA_ASSET_ADAPTER_UNAVAILABLE',409)
        with self.access(ctx,'connections.manage')as(db,member):
            row=self._loop(db,ctx,ident,member);need(row['revision']==form['expectedRevision'],'REVISION_CONFLICT',409)
            old=json.loads(row['definition']);dest=patch['destinationIds'];need(type(dest)is list and len(dest)==len(set(dest))and 1<=len(dest)<=2,'DESTINATIONS_INVALID',422)
            fb=[d[3:]for d in dest if type(d)is str and d.startswith('fb:')];ig=[d[3:]for d in dest if type(d)is str and d.startswith('ig:')]
            need(len(fb)==1 and len(fb)+len(ig)==len(dest),'FACEBOOK_SOURCE_REQUIRED',422)
            definition=dict(name=patch['name'],text=patch['text'],pageId=fb[0],localTime=patch['schedule']['expression'],mediaKind=old['mediaKind'])
            if ig:definition['instagramAccountId']=ig[0]
            definition=self._definition(definition);delegation=self.delegation(db,ctx.company,row['delegation']);self._page(delegation,definition)
            db.execute("UPDATE cs_loops SET definition=?,revision=revision+1,state='REVIEW_REQUIRED',approver=NULL,updated=? WHERE id=?",(encoded(definition),self.clock(),ident))
            changed=db.execute('SELECT * FROM cs_loops WHERE id=?',(ident,)).fetchone();db.execute('UPDATE cs_loops SET digest=? WHERE id=?',(self._rules(changed,delegation),ident))
            return self.dto(ctx,db.execute('SELECT * FROM cs_loops WHERE id=?',(ident,)).fetchone(),db,member)
    def local_transition(self,ctx,ident,revision,action):
        need(action in('pause','remove'),'INVALID_ACTION',422)
        with self.access(ctx,'connections.manage')as(db,member):
            row=self._loop(db,ctx,ident,member);need(row['revision']==revision,'REVISION_CONFLICT',409)
            state='PAUSED'if action=='pause'else'DELETED'
            db.execute('UPDATE cs_loops SET state=?,revision=revision+1,updated=? WHERE id=?',(state,self.clock(),ident))
            if action=='remove':return dict(version=LOOPS,contractVersion=VERSION,companyId=ctx.company,id=ident,deleted=True)
            return self.dto(ctx,db.execute('SELECT * FROM cs_loops WHERE id=?',(ident,)).fetchone(),db,member)
    def binding(self,row,delegation,node_id,node_revision):
        definition=json.loads(row['definition'])
        return dict(companyId=row['company'],delegationId=delegation['id'],loopId=row['id'],nodeLoopId=node_id,loopRevision=row['revision'],nodeLoopRevision=node_revision,
            rulesDigest=row['digest'],ownerId=delegation['legacy_owner'],sourceConversationId=row['room'],ownerBotId=row['bot'],pageId=definition['pageId'],
            **({'instagramAccountId':definition['instagramAccountId']}if definition.get('instagramAccountId')else{}))

    async def activate(self,ctx,ident,form,resume=False):
        exact(form,('expectedRevision',)if resume else('expectedRevision','rulesDigest','authorizePublishing'))
        need(ctx.bot is None,'HUMAN_STANDING_APPROVAL_REQUIRED')
        need(self.node.ready,'COMPANY_NODE_FACTORY_UNAVAILABLE',503)
        with self.access(ctx,'connections.manage')as(db,member):
            row=self._loop(db,ctx,ident,member);need(row['revision']==form['expectedRevision'],'REVISION_CONFLICT',409)
            need(row['state']in(('PAUSED',)if resume else('DRAFT','REVIEW_REQUIRED','PAUSED')),'LOOP_NOT_ACTIVATABLE',409)
            delegation=self.delegation(db,ctx.company,row['delegation']);definition=json.loads(row['definition']);page=self._page(delegation,definition)
            need(row['digest']==self._rules(row,delegation)and row['expires']>self.clock(),'STANDING_RULES_CHANGED',409)
            if resume:need(row['approver']and row['approver_binding'],'STANDING_ACTIVATION_REQUIRED',409)
            else:need(form['authorizePublishing']is True and form['rulesDigest']==row['digest'],'EXACT_STANDING_APPROVAL_REQUIRED',409)
            history=db.execute('SELECT binding FROM cs_node_history WHERE company=? AND loop=? AND node=?',(ctx.company,ident,row['node_id'])).fetchone()if row['node_id']else None
            old_binding=json.loads(history['binding'])if history else self.binding(row,delegation,row['node_id'],row['node_revision'])if row['node_id']else None
            revision=row['revision']+1;request_key='native-company-'+ident+'-'+row['digest'][:16]
            owner=delegation['legacy_owner'];request_id='loop-request-'+hashlib.sha256(json.dumps([owner,request_key],separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
            node_id='fbl-'+hashlib.sha256((owner+'\0'+owner+'\0'+request_id).encode()).hexdigest()
            # JSON insertion order matches the reviewed Node zod plan fields.
            from datetime import datetime,timezone
            plan=dict(requestKey=request_key,pageConnectionId=page['pageConnectionId'],localTime=definition['localTime'],mediaKind=definition['mediaKind'],standingPrompt=definition['text'],captionBrief=definition['text'])
            if definition.get('instagramAccountId'):plan['instagramMirror']=True
            plan['expiresAt']=datetime.fromtimestamp(row['expires'],timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
            activation=str(uuid.uuid4());command=hashlib.sha256(json.dumps(plan,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
            db.execute("UPDATE cs_loops SET state='ACTIVATING',revision=?,approver=?,approver_binding=?,node_id=?,node_revision=1,updated=? WHERE id=?",(revision,ctx.actor,ctx.binding,node_id,self.clock(),ident))
            db.execute('INSERT INTO cs_activations VALUES(?,?,?,?,?,?,?)',(activation,ctx.company,ident,revision,command,self.clock()+60,'PENDING'))
            current=db.execute('SELECT * FROM cs_loops WHERE id=?',(ident,)).fetchone();binding=self.binding(current,delegation,node_id,1)
            credential_ref=delegation['credential_ref']
            if old_binding and old_binding['nodeLoopId']!=node_id:
                cancel=dict(old_binding,loopRevision=revision,nodeLoopRevision=old_binding['nodeLoopRevision']+1)
                self._control_claim(db,ctx,cancel,'cancel')
            else:cancel=None
        try:
            if cancel:
                try:await self.node.control(credential_ref,cancel,old_binding['nodeLoopRevision'],'cancel')
                except Exception:pass # Old native rules already fail closed; never replay an unknown cancel.
            result=await self.node.create(credential_ref,binding,plan,activation,command)
            with self.access(ctx,'connections.manage')as(db,member):
                current=self._loop(db,ctx,ident,member)
                need(current['revision']==revision and current['state']=='ACTIVATING','LOOP_CHANGED_DURING_ACTIVATION',409)
                proof=db.execute('SELECT state FROM cs_activations WHERE id=?',(activation,)).fetchone()
                need(proof and proof['state']=='USED','NODE_STANDING_FENCE_NOT_ACKNOWLEDGED',502)
                need(result.get('nodeLoopId')==node_id and result.get('nodeLoopRevision')==1 and result.get('status')=='ACTIVE','NODE_LOOP_BINDING_MISMATCH',502)
                self.delegation(db,ctx.company,current['delegation'])
                db.execute('INSERT OR REPLACE INTO cs_node_history VALUES(?,?,?,?,?)',(ctx.company,ident,node_id,encoded(binding),self.clock()))
                db.execute("UPDATE cs_loops SET state='ACTIVE',updated=? WHERE id=?",(self.clock(),ident))
                return self.dto(ctx,db.execute('SELECT * FROM cs_loops WHERE id=?',(ident,)).fetchone(),db,member)
        except BaseException:
            with self.store.db()as db:
                db.execute("UPDATE cs_loops SET state='UNCERTAIN',updated=? WHERE id=? AND company=? AND revision=? AND state='ACTIVATING'",(self.clock(),ident,ctx.company,revision))
            raise

    def effect_authorize(self,payload):
        exact(payload,('version','binding','effect','occurrenceId'),('activationId','commandDigest','action'))
        need(payload['version']=='starli.company-social-effect.v1'and payload['effect']in EFFECTS,'EFFECT_NOT_ALLOWED')
        binding=payload['binding'];need(type(binding)is dict,'BINDING_REQUIRED')
        keys={'companyId','delegationId','loopId','nodeLoopId','loopRevision','nodeLoopRevision','rulesDigest','ownerId','sourceConversationId','ownerBotId','pageId'}
        exact(binding,keys,('instagramAccountId',));string(payload['occurrenceId'],220)
        with self.store.db()as db:
            row=db.execute('SELECT * FROM cs_loops WHERE id=? AND company=?',(binding['loopId'],binding['companyId'])).fetchone()
            need(row is not None,'LOOP_UNAVAILABLE')
            if payload['effect']in('loop.pause','loop.cancel','loop.resume'):
                action=payload.get('action');need(action==payload['effect'].split('.')[1],'CONTROL_ACTION_MISMATCH')
                control=db.execute('SELECT * FROM cs_controls WHERE company=? AND loop=? AND revision=? AND node=? AND action=?',(row['company'],row['id'],binding['loopRevision'],binding['nodeLoopId'],action)).fetchone()
                need(control and control['binding']==encoded(binding)and control['expires']>self.clock()and control['state']=='PENDING','CONTROL_PROOF_DENIED')
                current=self.store.authority.require_member(control['actor'],row['company']);need(current.binding==control['actor_binding'],'CONTROLLER_REVOKED')
                self.store.room(db,current,row['room']);self.permission(Context(row['company'],current.user_id,current.binding,None),db,'connections.manage')
                if action!='resume':
                    db.execute("UPDATE cs_controls SET state='USED' WHERE company=? AND loop=? AND revision=? AND node=? AND action=?",(row['company'],row['id'],binding['loopRevision'],binding['nodeLoopId'],action))
                    return dict(version='starli.company-social-effect.v1',companyId=row['company'],allowed=True,rulesDigest=binding['rulesDigest'],loopRevision=binding['loopRevision'])
            delegation=self.delegation(db,row['company'],row['delegation'])
            need(binding==self.binding(row,delegation,row['node_id'],row['node_revision']),'EFFECT_BINDING_CHANGED')
            need(row['digest']==self._rules(row,delegation)and row['expires']>self.clock(),'STANDING_RULES_EXPIRED')
            need(row['approver']and row['approver_binding'],'STANDING_APPROVAL_REQUIRED')
            approver=self.store.authority.require_member(row['approver'],row['company'])
            need(approver.binding==row['approver_binding'],'STANDING_APPROVER_REVOKED')
            self.store.room(db,approver,row['room']);self.store.agent(db,approver,row['room'],row['bot'])
            context=Context(row['company'],row['approver'],row['approver_binding'],None,row['room'],row['bot'])
            self.permission(Context(row['company'],row['approver'],row['approver_binding'],None),db,'connections.manage')
            self.permission(context,db,'integrations.run')
            need(self.legacy.reference_live(delegation['credential_ref']),'SOCIAL_ACCOUNT_REVOKED')
            definition=json.loads(row['definition']);self._page(delegation,definition)
            effect=payload['effect']
            if effect=='loop.activate':
                need(row['state']=='ACTIVATING','ACTIVATION_NOT_PENDING')
                activation=db.execute('SELECT * FROM cs_activations WHERE id=? AND company=? AND loop=?',(payload.get('activationId'),row['company'],row['id'])).fetchone()
                need(activation and activation['revision']==row['revision']and activation['command_digest']==payload.get('commandDigest')and activation['expires']>self.clock()and activation['state']=='PENDING','ACTIVATION_PROOF_DENIED')
                db.execute("UPDATE cs_activations SET state='USED' WHERE id=?",(activation['id'],))
            elif effect.startswith('loop.'):
                expected={'loop.pause':('PAUSING','pause'),'loop.resume':('RESUMING','resume'),'loop.cancel':('DELETING','cancel')}[effect]
                need(row['state']==expected[0]and payload.get('action')==expected[1],'CONTROL_NOT_PENDING')
                db.execute("UPDATE cs_controls SET state='USED' WHERE company=? AND loop=? AND revision=? AND node=? AND action=?",(row['company'],row['id'],binding['loopRevision'],binding['nodeLoopId'],payload['action']))
            else:
                need(row['state']=='ACTIVE','LOOP_NOT_ACTIVE')
                if effect.startswith('instagram.'):need(definition.get('instagramAccountId'),'INSTAGRAM_NOT_APPROVED')
                if effect=='video.render':need(definition['mediaKind']=='REEL','VIDEO_NOT_APPROVED')
                day=self.calendar_day(self.clock())
                claim=db.execute('SELECT node FROM cs_day_claims WHERE company=? AND loop=? AND day=?',(row['company'],row['id'],day)).fetchone()
                need(claim is None or claim['node']==row['node_id'],'DAILY_COMPANY_LOOP_LIMIT')
                if claim is None:db.execute('INSERT INTO cs_day_claims VALUES(?,?,?,?)',(row['company'],row['id'],day,row['node_id']))
            return dict(version='starli.company-social-effect.v1',companyId=row['company'],allowed=True,rulesDigest=row['digest'],loopRevision=row['revision'])

    def verify_effect(self,raw,headers,key):
        need(isinstance(key,bytes)and len(key)==32,'SOCIAL_FENCE_UNCONFIGURED',503)
        need(type(raw)is bytes and len(raw)<=16384,'INPUT_LIMIT',413)
        stamp=headers.get('x-starli-social-timestamp','');nonce=headers.get('x-starli-social-nonce','');signature=headers.get('x-starli-social-signature','')
        need(re.fullmatch(r'\d{10,12}',stamp or'')and abs(self.clock()-int(stamp))<=30 and re.fullmatch(r'[a-f0-9]{32}',nonce or'')and re.fullmatch(r'[a-f0-9]{64}',signature or''),'EFFECT_PROOF_INVALID')
        expected=hmac.new(key,stamp.encode()+b'\n'+nonce.encode()+b'\n'+raw,hashlib.sha256).hexdigest();need(hmac.compare_digest(expected,signature),'EFFECT_SIGNATURE_INVALID')
        with self.store.db()as db:
            db.execute('DELETE FROM cs_effect_nonces WHERE expires<?',(self.clock(),))
            need(not db.execute('SELECT 1 FROM cs_effect_nonces WHERE nonce=?',(nonce,)).fetchone(),'EFFECT_REPLAY_DENIED')
            db.execute('INSERT INTO cs_effect_nonces VALUES(?,?)',(nonce,self.clock()+60))
        try:return self.effect_authorize(json.loads(raw))
        except (ValueError,TypeError):raise SocialFault('EFFECT_INVALID')from None

    async def transition(self,ctx,ident,revision,action):
        need(ctx.bot is None and action in('pause','resume','remove'),'HUMAN_CONTROL_REQUIRED')
        with self.access(ctx,'connections.manage')as(db,member):
            row=self._loop(db,ctx,ident,member);need(row['revision']==revision,'REVISION_CONFLICT',409)
            if action=='remove'and row['state']=='REVOKED':
                db.execute("UPDATE cs_loops SET state='DELETED',revision=revision+1,updated=? WHERE id=?",(self.clock(),ident))
                return dict(version=LOOPS,contractVersion=VERSION,companyId=ctx.company,id=ident,deleted=True)
            if action=='pause':need(row['state']=='ACTIVE','LOOP_NOT_ACTIVE',409)
            if action=='resume':need(row['state']=='PAUSED'and row['approver'],'STANDING_ACTIVATION_REQUIRED',409)
            if not row['node_id']:
                need(action=='remove','NODE_LOOP_UNAVAILABLE',409)
                db.execute("UPDATE cs_loops SET state='DELETED',revision=revision+1,updated=? WHERE id=?",(self.clock(),ident))
                return dict(version=LOOPS,contractVersion=VERSION,companyId=ctx.company,id=ident,deleted=True)
            need(self.node.ready,'COMPANY_NODE_FACTORY_UNAVAILABLE',503)
            delegation=self.delegation(db,ctx.company,row['delegation'])
            expected_node=row['node_revision'];new_revision=row['revision']+1;new_node=expected_node+1
            interim={'pause':'PAUSING','resume':'RESUMING','remove':'DELETING'}[action]
            db.execute('UPDATE cs_loops SET state=?,revision=?,node_revision=?,updated=? WHERE id=?',(interim,new_revision,new_node,self.clock(),ident))
            changed=db.execute('SELECT * FROM cs_loops WHERE id=?',(ident,)).fetchone();binding=self.binding(changed,delegation,row['node_id'],new_node)
            self._control_claim(db,ctx,binding,'cancel'if action=='remove'else action)
            ref=delegation['credential_ref']
        try:
            result=await self.node.control(ref,binding,expected_node,'cancel'if action=='remove'else action)
            target={'pause':'PAUSED','resume':'ACTIVE','remove':'CANCELLED'}[action]
            need(result.get('nodeLoopId')==binding['nodeLoopId']and result.get('nodeLoopRevision')==new_node and result.get('status')==target,'NODE_CONTROL_UNVERIFIED',502)
            with self.access(ctx,'connections.manage')as(db,member):
                current=self._loop(db,ctx,ident,member);need(current['revision']==new_revision and current['state']==interim,'LOOP_CHANGED_DURING_CONTROL',409)
                db.execute('UPDATE cs_loops SET state=?,updated=? WHERE id=?',('DELETED'if action=='remove'else target,self.clock(),ident))
                db.execute('INSERT OR REPLACE INTO cs_node_history VALUES(?,?,?,?,?)',(ctx.company,ident,binding['nodeLoopId'],encoded(binding),self.clock()))
                if action=='remove':return dict(version=LOOPS,contractVersion=VERSION,companyId=ctx.company,id=ident,deleted=True)
                return self.dto(ctx,db.execute('SELECT * FROM cs_loops WHERE id=?',(ident,)).fetchone(),db,member)
        except BaseException:
            with self.store.db()as db:db.execute("UPDATE cs_loops SET state='UNCERTAIN',updated=? WHERE id=? AND revision=? AND state=?",(self.clock(),ident,new_revision,interim))
            raise

    def _control_claim(self,db,ctx,binding,action):
        db.execute('INSERT INTO cs_controls VALUES(?,?,?,?,?,?,?,?,?,?,?)',(ctx.company,binding['loopId'],binding['loopRevision'],binding['nodeLoopId'],action,encoded(binding),ctx.actor,ctx.binding,ctx.room or binding['sourceConversationId'],self.clock()+60,'PENDING'))

    def connect_card(self,ctx,platform):
        need(platform in('facebook','instagram')and ctx.bot and ctx.room and ctx.native_scope,'NATIVE_CARD_SCOPE_REQUIRED')
        message=ctx.native_scope.assistant_message_id
        with self.access(ctx,'integrations.run')as(db,_):
            row=db.execute('SELECT * FROM cm_messages WHERE id=? AND room=?',(message,ctx.room)).fetchone()
            need(row and row['kind']=='agent'and row['speaker']==ctx.bot and not row['deleted'],'ASSISTANT_ORIGIN_CHANGED')
            card=envelope(ctx.company,kind='connection',providerId=platform,conversationId=ctx.room,sourceConversationId=ctx.room,requestingBotId=ctx.bot,originAssistantMessageId=message,assistantMessageId=message,status='SETUP_REQUESTED')
            db.execute('INSERT INTO cs_cards VALUES(?,?,?,?,?,?) ON CONFLICT(company,message,platform) DO UPDATE SET updated=excluded.updated',(ctx.company,ctx.room,message,ctx.bot,platform,self.clock()))
            original=db.execute('SELECT data FROM message WHERE id=?',(message,)).fetchone();values=json.loads(original[0]or'{}');values['starliSocial']=card
            db.execute('UPDATE message SET data=? WHERE id=?',(encoded(values),message));db.execute('UPDATE cm_messages SET revision=revision+1 WHERE id=?',(message,))
            self.store.event(db,ctx.room,'message.updated',message)
            return card

    def install_card_projection(self):
        import types
        original=self.store.message_dto
        def dto(store,db,room,message):
            result=original(db,room,message)
            if result.get('deleted'):return result
            origin=db.execute('SELECT * FROM cs_cards WHERE room=? AND message=? ORDER BY updated DESC LIMIT 1',(room,message)).fetchone()
            if origin and result.get('speaker')=={'kind':'agent','id':origin['bot']}:
                row=db.execute('SELECT data FROM message WHERE id=? AND channel_id=?',(message,room)).fetchone()
                value=json.loads(row['data']or'{}').get('starliSocial')if row else None
                if type(value)is dict and (value.get('version'),value.get('companyId'),value.get('sourceConversationId'),value.get('assistantMessageId'),value.get('providerId'))==(VERSION,origin['company'],room,message,origin['platform']):
                    result['data']={**(result.get('data')or{}),'starliSocial':value}
            return result
        self.store.message_dto=types.MethodType(dto,self.store)

    async def history(self,ctx,ident):
        with self.access(ctx)as(db,member):
            row=self._loop(db,ctx,ident,member)
            if not row['node_id']:return dict(version=LOOPS,contractVersion=VERSION,companyId=ctx.company,loopId=ident,items=[])
            delegation=self.delegation(db,ctx.company,row['delegation']);binding=self.binding(row,delegation,row['node_id'],row['node_revision']);ref=delegation['credential_ref'];revision=row['revision']
        result=await self.node.read(ref,binding)
        with self.access(ctx)as(db,member):
            current=self._loop(db,ctx,ident,member);need(current['revision']==revision,'LOOP_CHANGED',409)
        need(result.get('companyId')==ctx.company and result.get('loopId')==ident and result.get('nodeLoopId')==binding['nodeLoopId'],'NODE_HISTORY_SCOPE_CHANGED',502)
        items=[]
        for entry in result.get('history',[])[:100]:
            if type(entry)is not dict:continue
            state=entry.get('state',entry.get('status','UNKNOWN'))
            stamp=entry.get('createdAt',entry.get('startedAt',0))
            if type(stamp)is str:
                try:
                    from datetime import datetime
                    stamp=datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()
                except ValueError:stamp=0
            if type(stamp)not in(int,float):stamp=0
            # Never fabricate a verified provider receipt from CLAIMED/scheduled state.
            items.append(dict(id=str(entry.get('id',''))[:160],loopId=ident,loopRevision=revision,status=str(state)[:40],startedAt=max(0,stamp/1000 if stamp>1e12 else stamp),finishedAt=None,
                              **({'failure':str(entry['errorCode'])[:100]}if entry.get('errorCode')else{})))
        return dict(version=LOOPS,contractVersion=VERSION,companyId=ctx.company,loopId=ident,items=items)
