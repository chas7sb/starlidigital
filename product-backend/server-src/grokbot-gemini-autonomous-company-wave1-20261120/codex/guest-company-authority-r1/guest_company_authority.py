"""Restricted provisional workspace and app capabilities; explicit native claim transfer.
No registered guest actor, synthetic native JWT or executable generated backend.
"""
import hashlib,hmac,json,secrets,sqlite3,uuid
from contextlib import closing
from dataclasses import dataclass,field
from urllib.parse import urlsplit
from fastapi import APIRouter,Request,Response,HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,StrictStr,Field

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def digest(value):return hashlib.sha256(canonical(value).encode()).hexdigest()
def opaque_hash(value):return hashlib.sha256(value.encode()).hexdigest()
def guard_guest_write(db,intent_id,binding):
    row=db.execute('SELECT binding,state FROM guest_conversation_transfer WHERE intent=?',(intent_id,)).fetchone()
    if row and (not hmac.compare_digest(row['binding'],binding) or row['state']!='OPEN'):
        raise HTTPException(409,'GUEST_CONVERSATION_CLAIM_FROZEN')

@dataclass(repr=False)
class GuestContext:
    authority:object=field(repr=False)
    request:object=field(repr=False)
    intent_id:str
    initial:dict=field(default_factory=dict,repr=False)
    def revalidate_build(self,snapshot):return self.authority.revalidate_build(self,snapshot)
    def revalidate(self):return self.authority.resolve_guest_request(self.request,self.intent_id).snapshot()
    def snapshot(self):return self.authority.guest_snapshot(self.request,self.intent_id)

class TicketIn(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
class RedeemIn(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    ticket:StrictStr=Field(min_length=20,max_length=160)
    appOrigin:StrictStr=Field(min_length=8,max_length=200)
class AuthorizeIn(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    sessionToken:StrictStr=Field(min_length=20,max_length=160)

class GuestCompanyAuthority:
    def __init__(self,svc,allowed_origins):
        self.svc=svc;self.allowed=set(allowed_origins);self.read_build_status=None
        with closing(self.db()) as db,db:
            db.executescript('''
CREATE TABLE IF NOT EXISTS guest_build_claim_grants(intent TEXT PRIMARY KEY,owner TEXT NOT NULL,claim_id TEXT NOT NULL,native_token TEXT NOT NULL,digest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS guest_workspace_identity(intent TEXT PRIMARY KEY,company_name TEXT NOT NULL,room_name TEXT NOT NULL,coordinator_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS guest_conversation_transfer(intent TEXT PRIMARY KEY,binding TEXT NOT NULL,state TEXT NOT NULL,snapshot TEXT,digest TEXT,owner TEXT,claim_id TEXT,updated REAL NOT NULL);
CREATE TABLE IF NOT EXISTS guest_app_builds(build_id TEXT PRIMARY KEY,intent TEXT NOT NULL,binding TEXT NOT NULL,company TEXT NOT NULL,project TEXT NOT NULL,artifact TEXT NOT NULL,lease TEXT NOT NULL,generation TEXT NOT NULL,app_origin TEXT NOT NULL,parent_origin TEXT NOT NULL,storage_namespace TEXT UNIQUE NOT NULL,key_hash TEXT NOT NULL,key_value TEXT NOT NULL,expires REAL NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS guest_app_tickets(hash TEXT PRIMARY KEY,build TEXT NOT NULL,principal TEXT NOT NULL,subject TEXT NOT NULL,generation TEXT NOT NULL,expires REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0,native_token TEXT);
CREATE TABLE IF NOT EXISTS guest_app_sessions(hash TEXT PRIMARY KEY,build TEXT NOT NULL,principal TEXT NOT NULL,subject TEXT NOT NULL,generation TEXT NOT NULL,expires REAL NOT NULL,csrf TEXT NOT NULL,native_token TEXT);
''')
        with closing(sqlite3.connect(str(svc.p.main))) as db,db:
            db.executescript('''CREATE TABLE IF NOT EXISTS guest_native_message_map(intent TEXT NOT NULL,guest_id TEXT NOT NULL,native_id TEXT UNIQUE NOT NULL,claim_id TEXT NOT NULL,room TEXT NOT NULL,role TEXT NOT NULL,ordinal INTEGER NOT NULL,content_hash TEXT NOT NULL,PRIMARY KEY(intent,guest_id));
CREATE TABLE IF NOT EXISTS guest_native_transfer_watermark(intent TEXT PRIMARY KEY,claim_id TEXT NOT NULL,digest TEXT NOT NULL,count INTEGER NOT NULL,room TEXT NOT NULL,company TEXT NOT NULL,project TEXT NOT NULL);''')
    def db(self):
        db=sqlite3.connect(str(self.svc.p.intake),timeout=5);db.row_factory=sqlite3.Row;db.execute('PRAGMA busy_timeout=5000');return db
    def owned(self,request,intent):
        return self.svc.ns.mini2.resolve_issued_guest_intent(request=request,intent_id=intent,verify_cookie=self.svc.ns.public.verify_cookie,signing_key=self.svc.key,db_path=self.svc.p.intake,now=self.svc.now)
    def transcript(self,db,intent,receipt):
        result=[{'id':'guest-original:'+intent,'role':'user','content':receipt['originalPrompt']}]
        table=db.execute("SELECT 1 FROM sqlite_master WHERE name='staging_guest_workspace_messages'").fetchone()
        if table:result.extend(dict(x) for x in db.execute('SELECT id,role,content FROM staging_guest_workspace_messages WHERE intent=? ORDER BY seq',(intent,)))
        return result
    def provisional(self,db,intent,binding):
        row=db.execute('SELECT * FROM provisional_companies WHERE intent_id=?',(intent,)).fetchone()
        if not row or not hmac.compare_digest(row['guest_binding'],binding):raise HTTPException(404,'PROVISIONAL_WORKSPACE_UNAVAILABLE')
        if row['status']!='PROVISIONAL' or row['expires']<=self.svc.now():raise HTTPException(410,'PROVISIONAL_WORKSPACE_RETIRED')
        return row
    def guest_snapshot(self,request,intent):
        issued=self.owned(request,intent)
        with closing(self.db()) as db:
            p=self.provisional(db,intent,issued.verified_binding)
            guard_guest_write(db,intent,issued.verified_binding)
            messages=self.transcript(db,intent,issued.receipt)
            return {'intentId':intent,'binding':issued.verified_binding,'guestBinding':issued.verified_binding,'requestId':issued.receipt['requestId'],'authorizationRevision':p['revision'],'generation':int(p['revision']),'receipt':issued.receipt,
                    'companyId':str(uuid.UUID(p['company_id'])),'projectId':str(uuid.UUID(p['project_id'])),
                    'roomId':str(uuid.UUID(p['channel_id'])),'principalKind':'GUEST_TEMPORARY',
                    'expiresAt':p['expires'],'messages':messages,'conversationHash':digest(messages)}
    def resolve_guest_request(self,request,intent):
        snapshot=self.guest_snapshot(request,intent)
        return GuestContext(self,request,intent,snapshot)
    def ensure_provisional(self,request,intent):
        self.svc.bootstrap_provisional(request.cookies.get('starli_guest',''),intent)
        with closing(self.db()) as db,db:
            db.execute('INSERT OR IGNORE INTO guest_workspace_identity VALUES(?,?,?,?)',(intent,'Starli workspace','Starli','Starli'))
        context=self.resolve_guest_request(request,intent)
        return self.temporary_workspace(context.snapshot())
    def temporary_workspace(self,snapshot):
        with closing(self.db()) as db:
            names=db.execute('SELECT * FROM guest_workspace_identity WHERE intent=?',(snapshot['intentId'],)).fetchone()
        if not names:raise HTTPException(409,'WORKSPACE_IDENTITY_NOT_CREATED')
        return {k:snapshot[k] for k in ('companyId','projectId','roomId')}|{'companyName':names['company_name'],'roomName':names['room_name'],'coordinatorName':names['coordinator_name'],'principalKind':'restricted_guest','status':'RESTRICTED_PROVISIONAL_ACTIVE'}
    def enrich(self,request,intent,value):
        context=self.resolve_guest_request(request,intent);snapshot=context.snapshot()
        value=dict(value,temporaryWorkspace=self.temporary_workspace(snapshot))
        if self.read_build_status:
            build=self.read_build_status(snapshot)
            if build is not None:value['build']=build
        return value
    def freeze(self,token,cookie,intent):
        session,uid=self.svc.native_session(token)
        # A replay after committed claim is allowed through actual owner proof, not the retired cookie.
        with closing(self.db()) as db:
            committed=db.execute("SELECT * FROM grokbot1_claim_journal WHERE intent_id=? AND owner_user_id=? AND state='COMMITTED'",(intent,uid)).fetchone()
        if committed:return
        self.svc._recent_auth(uid,token)
        issued=self.svc._issued(cookie,intent);binding=issued.verified_binding
        with closing(self.db()) as db,db:
            db.execute('BEGIN IMMEDIATE');self.provisional(db,intent,binding)
            running=db.execute("SELECT 1 FROM sqlite_master WHERE name='staging_guest_workspace_turns'").fetchone()
            if running and db.execute("SELECT 1 FROM staging_guest_workspace_turns WHERE intent=? AND state='RUNNING'",(intent,)).fetchone():raise HTTPException(409,'GUEST_REPLY_IN_PROGRESS')
            messages=self.transcript(db,intent,issued.receipt);sha=digest(messages)
            prior=db.execute('SELECT * FROM guest_conversation_transfer WHERE intent=?',(intent,)).fetchone()
            if prior and prior['state']!='OPEN':
                if prior['owner']!=uid or prior['digest']!=sha:raise HTTPException(409,'TRANSFER_ALREADY_FROZEN')
                return
            db.execute('INSERT OR REPLACE INTO guest_conversation_transfer VALUES(?,?,?,?,?,?,?,?)',(intent,binding,'FROZEN',canonical(messages),sha,uid,None,self.svc.now()))
    def release_failed_freeze(self,intent):
        with closing(self.db()) as db,db:
            live=db.execute("SELECT 1 FROM grokbot1_claim_journal WHERE intent_id=? AND state IN ('PREPARED','COMMITTED')",(intent,)).fetchone()
            if not live:db.execute("UPDATE guest_conversation_transfer SET state='OPEN',updated=? WHERE intent=? AND state='FROZEN'",(self.svc.now(),intent))
    def transfer(self,token,intent):
        session,uid=self.svc.native_session(token);nav=self.svc.owner_navigation(token,intent)
        if nav['stage']!='ROOM_READY':raise HTTPException(409,'NATIVE_ROOM_NOT_READY')
        with closing(self.db()) as db:
            j=db.execute("SELECT * FROM grokbot1_claim_journal WHERE intent_id=? AND owner_user_id=? AND state='COMMITTED'",(intent,uid)).fetchone()
            frozen=db.execute('SELECT * FROM guest_conversation_transfer WHERE intent=?',(intent,)).fetchone()
        if not j or not frozen or frozen['owner']!=uid:raise HTTPException(409,'CONVERSATION_TRANSFER_SNAPSHOT_REQUIRED')
        messages=json.loads(frozen['snapshot']);receipts=json.loads(j['receipts']);room=nav['roomId'];mapping=[]
        with self.svc.store.access(session,nav['companyId'],room) as (db,member,row):
            watermark=db.execute('SELECT * FROM guest_native_transfer_watermark WHERE intent=?',(intent,)).fetchone()
            if watermark and (watermark['digest']!=frozen['digest'] or watermark['claim_id']!=j['txn']):raise HTTPException(409,'TRANSFER_WATERMARK_CONFLICT')
            seq=row['seq']
            for ordinal,m in enumerate(messages):
                mid=receipts['originalPromptMessageId'] if ordinal==0 else str(uuid.uuid5(uuid.NAMESPACE_URL,'starli-guest-transfer:'+j['txn']+':'+m['id']))
                exists=db.execute('SELECT * FROM guest_native_message_map WHERE intent=? AND guest_id=?',(intent,m['id'])).fetchone()
                if exists:
                    if exists['native_id']!=mid or exists['content_hash']!=digest(m['content']):raise HTTPException(409,'TRANSFER_MESSAGE_CONFLICT')
                else:
                    if ordinal:
                        seq+=1;now=int(self.svc.now()*1e9)
                        provenance={'kind':'IMPORTED_GUEST_CONVERSATION','intentId':intent,'guestMessageId':m['id'],'originalRole':m['role'],'authoredBy':'anonymous_guest' if m['role']=='user' else 'guest_ai_assistant','claimedBy':uid,'claimId':j['txn'],'companyId':nav['companyId'],'transcriptDigest':frozen['digest']}
                        provenance['hmac']=hmac.new(self.svc.key,canonical(provenance).encode(),hashlib.sha256).hexdigest()
                        db.execute('INSERT INTO message(id,user_id,channel_id,parent_id,content,data,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',(mid,'starli-guest-intake',room,None,m['content'],self.svc.sm.encode({'attachments':[]}),self.svc.sm.encode({'version':self.svc.sm.VERSION,'starliProvenance':provenance}),now,now))
                        db.execute('INSERT INTO cm_messages VALUES(?,?,?,?,?,?,0,?,?,NULL)',(mid,room,seq,'system','starli-guest-intake',1,'[]','[]'))
                        self.svc.store.event(db,room,'message.created',mid)
                    db.execute('INSERT INTO guest_native_message_map VALUES(?,?,?,?,?,?,?,?)',(intent,m['id'],mid,j['txn'],room,m['role'],ordinal,digest(m['content'])))
                mapping.append({'guestMessageId':m['id'],'nativeMessageId':mid})
            db.execute('UPDATE cm_rooms SET seq=? WHERE id=?',(seq,room))
            db.execute('INSERT OR IGNORE INTO guest_native_transfer_watermark VALUES(?,?,?,?,?,?,?)',(intent,j['txn'],frozen['digest'],len(messages),room,nav['companyId'],nav['projectId']))
        with closing(self.db()) as db,db:
            db.execute("UPDATE guest_conversation_transfer SET state='COMPLETE',claim_id=?,updated=? WHERE intent=?",(j['txn'],self.svc.now(),intent))
            db.execute('INSERT OR REPLACE INTO guest_build_claim_grants VALUES(?,?,?,?,?)',(intent,uid,j['txn'],token,frozen['digest']))
            # Guest sessions deny dynamically even if this cleanup is interrupted.
            db.execute("DELETE FROM guest_app_sessions WHERE principal='GUEST_TEMPORARY' AND build IN (SELECT build_id FROM guest_app_builds WHERE intent=?)",(intent,))
            db.execute("DELETE FROM guest_app_tickets WHERE principal='GUEST_TEMPORARY' AND build IN (SELECT build_id FROM guest_app_builds WHERE intent=?)",(intent,))
        return {'companyId':nav['companyId'],'projectId':nav['projectId'],'roomId':room,'complete':True,'messageMap':mapping,'transcriptDigest':frozen['digest']}
    def owner_workspace(self,token,intent):
        session,uid=self.svc.native_session(token);nav=self.svc.owner_navigation(token,intent)
        if nav['stage']!='ROOM_READY':raise HTTPException(409,'NATIVE_ROOM_NOT_READY')
        with closing(self.db()) as db:
            frozen=db.execute("SELECT * FROM guest_conversation_transfer WHERE intent=? AND owner=? AND state='COMPLETE'",(intent,uid)).fetchone()
            if not frozen:raise HTTPException(409,'CONVERSATION_TRANSFER_NOT_COMPLETE')
        with self.svc.store.access(session,nav['companyId'],nav['roomId']) as (db,member,room):
            mark=db.execute('SELECT * FROM guest_native_transfer_watermark WHERE intent=? AND claim_id=? AND room=?',(intent,nav['claimId'],nav['roomId'])).fetchone()
            if not mark or mark['digest']!=frozen['digest']:raise HTTPException(409,'TRANSFER_READBACK_MISMATCH')
            mapping=[{'guestMessageId':r['guest_id'],'nativeMessageId':r['native_id']} for r in db.execute('SELECT * FROM guest_native_message_map WHERE intent=? ORDER BY ordinal',(intent,))]
        transfer={'companyId':nav['companyId'],'projectId':nav['projectId'],'roomId':nav['roomId'],'complete':True,'messageMap':mapping,'transcriptDigest':frozen['digest']}
        with closing(self.db()) as db:
            row=db.execute('SELECT snapshot FROM guest_conversation_transfer WHERE intent=?',(intent,)).fetchone();messages=json.loads(row['snapshot'])
            receipt=json.loads(db.execute('SELECT receipt FROM guest_intents WHERE intent_id=?',(intent,)).fetchone()['receipt'])
        value={'intentId':intent,'requestId':receipt['requestId'],'originalPrompt':receipt['originalPrompt'],'messages':messages,'replyState':'COMPLETE','claimTransfer':transfer}
        if self.read_build_status:
            source={'intentId':intent,'binding':frozen['binding'],'guestBinding':frozen['binding'],'messages':messages,'conversationHash':frozen['digest'],'companyId':nav['companyId'],'projectId':nav['projectId'],'roomId':nav['roomId'],'principalKind':'VERIFIED_REGISTERED_PERSON'}
            build=self.read_build_status(source)
            if build is not None:
                build=dict(build)
                if isinstance(build.get('preview'),dict):
                    preview=dict(build['preview']);preview['ticketUrl']='/api/v1/starli/grokbot1/claims/'+intent+'/builds/'+build['id']+'/ticket';preview['ticketPrincipalKind']='VERIFIED_REGISTERED_PERSON';build['preview']=preview
                value['build']=build
        return value
    def imported_history(self,session,company,room):
        """Model context only; native imported speakers remain system provenance."""
        result=[]
        with self.svc.store.access(session,company,room) as (db,member,r):
            marks=db.execute('SELECT * FROM guest_native_transfer_watermark WHERE company=? AND room=?',(company,room)).fetchall()
            for mark in marks:
                rows=db.execute('SELECT m.*,n.content,n.meta FROM guest_native_message_map m JOIN message n ON n.id=m.native_id WHERE m.intent=? AND m.room=? ORDER BY m.ordinal',(mark['intent'],room)).fetchall()
                if len(rows)!=mark['count']:raise HTTPException(409,'IMPORTED_HISTORY_COUNT_MISMATCH')
                for item in rows:
                    if digest(item['content'])!=item['content_hash']:raise HTTPException(409,'IMPORTED_HISTORY_CONTENT_MISMATCH')
                    if item['ordinal']:
                        meta=json.loads(item['meta']);p=meta.get('starliProvenance',{});signature=p.pop('hmac','')
                        expected=hmac.new(self.svc.key,canonical(p).encode(),hashlib.sha256).hexdigest()
                        if not hmac.compare_digest(signature,expected) or p.get('claimId')!=mark['claim_id'] or p.get('guestMessageId')!=item['guest_id'] or p.get('transcriptDigest')!=mark['digest']:raise HTTPException(403,'IMPORTED_HISTORY_PROVENANCE_DENIED')
                    result.append({'role':item['role'],'content':item['content']})
        return result
    def revalidate_build(self,context,snapshot):
        """Trusted continuation of an already-admitted guest job; never a browser capability."""
        try:return context.revalidate()
        except Exception:
            if not isinstance(snapshot,dict) or snapshot.get('intentId')!=context.intent_id:raise HTTPException(403,'BUILD_ADOPTION_SOURCE_DENIED')
            with closing(self.db()) as db:
                grant=db.execute('SELECT * FROM guest_build_claim_grants WHERE intent=?',(context.intent_id,)).fetchone()
                frozen=db.execute("SELECT * FROM guest_conversation_transfer WHERE intent=? AND state='COMPLETE'",(context.intent_id,)).fetchone()
                prov=db.execute('SELECT * FROM provisional_companies WHERE intent_id=?',(context.intent_id,)).fetchone()
                if not grant or not frozen or not prov:raise HTTPException(403,'BUILD_ADOPTION_NOT_COMMITTED')
                if snapshot.get('guestBinding',snapshot.get('binding'))!=frozen['binding']:raise HTTPException(403,'BUILD_ADOPTION_BINDING_DENIED')
                original=context.initial
                if not original or snapshot.get('intentId')!=original['intentId'] or digest(snapshot.get('messages'))!=original['conversationHash']:raise HTTPException(403,'BUILD_ADOPTION_PREFIX_DENIED')
                messages=json.loads(frozen['snapshot']);prefix=original['messages']
                if messages[:len(prefix)]!=prefix or not prefix or prefix[-1]['role']!='user':raise HTTPException(403,'BUILD_ADOPTION_PREFIX_CHANGED')
                native_token=grant['native_token']
            _,uid=self.svc.native_session(native_token);nav=self.svc.owner_navigation(native_token,context.intent_id)
            if uid!=grant['owner'] or nav['stage']!='ROOM_READY' or nav['claimId']!=grant['claim_id'] or grant['digest']!=frozen['digest']:raise HTTPException(403,'BUILD_ADOPTION_OWNER_REVOKED')
            # Source namespace is immutable; current company/project authority is reported separately.
            return dict(original,principalKind='VERIFIED_CLAIMED_BUILD_CONTINUATION',currentCompanyId=nav['companyId'],currentProjectId=nav['projectId'],claimId=nav['claimId'])
    def register_build(self,context,build):
        s=context.revalidate_build(context.initial) if hasattr(context,'revalidate_build') else context.revalidate();required={'buildId','artifactDigest','leaseId','generation','appOrigin','parentOrigin','authorityBaseUrl'}
        if not required.issubset(build):raise ValueError('BUILD_BINDING_REQUIRED')
        for o in ('appOrigin','parentOrigin','authorityBaseUrl'):
            p=urlsplit(build[o])
            if not (p.scheme=='https' or (p.scheme=='http' and p.hostname in ('127.0.0.1','localhost','::1'))) or not p.netloc or p.username or p.password or p.path not in ('','/') or p.query or p.fragment:raise ValueError('INSECURE_AUTHORITY_ORIGIN')
        if build['parentOrigin'] not in self.allowed:raise ValueError('PARENT_ORIGIN_DENIED')
        if len(build['artifactDigest'])!=64 or any(c not in '0123456789abcdef' for c in build['artifactDigest']):raise ValueError('ARTIFACT_DIGEST_REQUIRED')
        if not all(isinstance(build[x],str) and 1<=len(build[x])<=180 for x in ('buildId','leaseId')):raise ValueError('BUILD_IDENTITY_REQUIRED')
        if isinstance(build['generation'],bool) or not str(build['generation']).isdigit() or not 1<=int(build['generation'])<=2147483646:raise ValueError('POSITIVE_GENERATION_REQUIRED')
        build=dict(build,generation=str(build['generation']))
        key=secrets.token_urlsafe(32);namespace='guest-build:'+digest([s['companyId'],s['projectId'],build['buildId']])
        with closing(self.db()) as db,db:
            db.execute('BEGIN IMMEDIATE')
            if s['principalKind']=='GUEST_TEMPORARY':guard_guest_write(db,s['intentId'],s['binding'])
            else:
                if not db.execute("SELECT 1 FROM guest_build_claim_grants WHERE intent=? AND claim_id=?",(s['intentId'],s['claimId'])).fetchone():raise HTTPException(403,'BUILD_ADOPTION_GRANT_REVOKED')
            row=db.execute('SELECT * FROM guest_app_builds WHERE build_id=?',(build['buildId'],)).fetchone()
            if row:
                check=(row['intent'],row['artifact'],row['lease'],row['generation'],row['app_origin'],row['parent_origin'])
                if check!=(s['intentId'],build['artifactDigest'],build['leaseId'],build['generation'],build['appOrigin'],build['parentOrigin']):raise ValueError('BUILD_REGISTRATION_CONFLICT')
                key=row['key_value'];namespace=row['storage_namespace']
            else:db.execute('INSERT INTO guest_app_builds VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)',(build['buildId'],s['intentId'],s['binding'],s['companyId'],s['projectId'],build['artifactDigest'],build['leaseId'],build['generation'],build['appOrigin'],build['parentOrigin'],namespace,opaque_hash(key),key,s['expiresAt']))
        return {'authorityURL':build['authorityBaseUrl'].rstrip('/')+'/internal/v1/model-app-authority/'+build['buildId'],'authorityKey':key,'storageNamespace':namespace}
    def revoke_build(self,build):
        with closing(self.db()) as db,db:
            db.execute('UPDATE guest_app_builds SET revoked=1 WHERE build_id=?',(build,))
            db.execute('DELETE FROM guest_app_sessions WHERE build=?',(build,))
            db.execute('DELETE FROM guest_app_tickets WHERE build=?',(build,))
    def build(self,db,build):
        row=db.execute('SELECT * FROM guest_app_builds WHERE build_id=?',(build,)).fetchone()
        if not row or row['revoked']:raise HTTPException(403,'APP_BUILD_REVOKED')
        return row
    def actor(self,db,b,principal,subject,native_token=None):
        if principal=='GUEST_TEMPORARY':
            p=self.provisional(db,b['intent'],b['binding'])
            if b['expires']<=self.svc.now() or db.execute('SELECT 1 FROM revoked_guest_bindings WHERE binding=?',(b['binding'],)).fetchone() or db.execute('SELECT 1 FROM guest_intent_retirements WHERE intent_id=?',(b['intent'],)).fetchone():raise HTTPException(403,'GUEST_APP_RETIRED')
            guard_guest_write(db,b['intent'],b['binding']);company=b['company'];project=b['project'];revision=str(p['revision']);generation=int(b['generation'])
            if subject!='guest:'+opaque_hash(b['binding'])[:32]:raise HTTPException(403,'GUEST_SUBJECT_DENIED')
        else:
            session,uid=self.svc.native_session(native_token);nav=self.svc.owner_navigation(native_token,b['intent'])
            if uid!=subject or nav['stage']!='ROOM_READY':raise HTTPException(403,'OWNER_APP_AUTHORITY_DENIED')
            transfer=db.execute("SELECT * FROM guest_conversation_transfer WHERE intent=? AND owner=? AND state='COMPLETE'",(b['intent'],uid)).fetchone()
            if not transfer:raise HTTPException(403,'OWNER_TRANSFER_REQUIRED')
            company=nav['companyId'];project=nav['projectId'];revision=str(nav['claimRevision']);generation=int(b['generation'])+1
        return {'subjectId':subject,'principalKind':principal,'buildId':b['build_id'],'artifactDigest':b['artifact'],'leaseId':b['lease'],'generation':generation,'authorizationRevision':revision,'scope':['app:read','app:write'],'currentCompanyId':company,'currentProjectId':project,'storageNamespace':b['storage_namespace']}
    def issue_ticket(self,request,intent,build,owner=False):
        token=None
        if owner:
            from grokbot1_routes import _token
            token=_token(request);_,subject=self.svc.native_session(token);self.transfer(token,intent);principal='VERIFIED_REGISTERED_PERSON'
        else:
            s=self.resolve_guest_request(request,intent).snapshot();subject='guest:'+opaque_hash(s['binding'])[:32];principal='GUEST_TEMPORARY'
        ticket=secrets.token_urlsafe(40)
        with closing(self.db()) as db,db:
            db.execute('BEGIN IMMEDIATE');b=self.build(db,build)
            db.execute('DELETE FROM guest_app_tickets WHERE expires<=?',(self.svc.now(),))
            db.execute('DELETE FROM guest_app_sessions WHERE expires<=?',(self.svc.now(),))
            if db.execute('SELECT count(*) FROM guest_app_tickets WHERE build=? AND used=0',(build,)).fetchone()[0]>=100:raise HTTPException(429,'APP_TICKET_LIMIT')
            if b['intent']!=intent or request.headers.get('origin')!=b['parent_origin']:raise HTTPException(403,'APP_TICKET_SCOPE_DENIED')
            actor=self.actor(db,b,principal,subject,token);expires=min(self.svc.now()+45,b['expires']) if not owner else self.svc.now()+45
            db.execute('INSERT INTO guest_app_tickets VALUES(?,?,?,?,?,?,0,?)',(opaque_hash(ticket),build,principal,subject,actor['generation'],expires,token))
        return {'bootstrapTicket':ticket,'expiresAt':expires,'buildId':build,'actor':actor}
    def rpc_key(self,db,build,key):
        b=self.build(db,build)
        if not key or not hmac.compare_digest(b['key_hash'],opaque_hash(key)):raise HTTPException(403,'APP_AUTHORITY_KEY_DENIED')
        return b
    def redeem(self,build,key,ticket,origin):
        session=secrets.token_urlsafe(40);csrf=secrets.token_urlsafe(32)
        with closing(self.db()) as db,db:
            db.execute('BEGIN IMMEDIATE');b=self.rpc_key(db,build,key)
            t=db.execute('SELECT * FROM guest_app_tickets WHERE hash=?',(opaque_hash(ticket),)).fetchone()
            if not t or t['build']!=build or t['used'] or t['expires']<=self.svc.now() or origin!=b['app_origin']:raise HTTPException(403,'APP_TICKET_DENIED')
            actor=self.actor(db,b,t['principal'],t['subject'],t['native_token'])
            if str(actor['generation'])!=str(t['generation']):raise HTTPException(403,'APP_GENERATION_CHANGED')
            expires=min(self.svc.now()+900,b['expires']) if t['principal']=='GUEST_TEMPORARY' else self.svc.now()+900
            db.execute('UPDATE guest_app_tickets SET used=1 WHERE hash=?',(t['hash'],))
            db.execute('INSERT INTO guest_app_sessions VALUES(?,?,?,?,?,?,?,?)',(opaque_hash(session),build,t['principal'],t['subject'],t['generation'],expires,csrf,t['native_token']))
        return {'sessionToken':session,'csrfToken':csrf,'expiresAt':expires,'actor':actor}
    def authorize(self,build,key,token):
        with closing(self.db()) as db:
            b=self.rpc_key(db,build,key);s=db.execute('SELECT * FROM guest_app_sessions WHERE hash=?',(opaque_hash(token),)).fetchone()
            if not s or s['build']!=build or s['expires']<=self.svc.now():raise HTTPException(403,'APP_SESSION_DENIED')
            actor=self.actor(db,b,s['principal'],s['subject'],s['native_token'])
            if str(actor['generation'])!=str(s['generation']):raise HTTPException(403,'APP_GENERATION_CHANGED')
            return {'actor':actor,'csrfToken':s['csrf']}

def install_guest_company_authority(app,svc,*,allowed_origins):
    from grokbot1_routes import _guard,_token
    service=GuestCompanyAuthority(svc,allowed_origins)
    original_claim,original_resume=svc.claim,svc.resume
    def claim(token,cookie,intent,idem,revision):
        service.freeze(token,cookie,intent)
        try:result=original_claim(token,cookie,intent,idem,revision)
        except BaseException:service.release_failed_freeze(intent);raise
        if result.get('state')=='CLAIM_COMMITTED':result=dict(result,claimTransfer=service.transfer(token,intent))
        return result
    def resume(token,intent):
        result=original_resume(token,intent)
        if result.get('state')=='CLAIM_COMMITTED':result=dict(result,claimTransfer=service.transfer(token,intent))
        return result
    svc.claim=claim;svc.resume=resume
    router=APIRouter()
    @router.post('/api/v1/starli/public/grokbot1/intents/{intent}/workspace/setup')
    def setup(intent:str,request:Request,body:TicketIn):
        _guard(request,service.allowed,'x-starli-guest-intent');return {'temporaryWorkspace':service.ensure_provisional(request,intent)}
    @router.get('/api/v1/starli/grokbot1/claims/{intent}/conversation')
    def owner_read(intent:str,request:Request):return JSONResponse(service.owner_workspace(_token(request),intent),headers={'Cache-Control':'no-store'})
    @router.post('/api/v1/starli/public/grokbot1/intents/{intent}/builds/{build}/ticket')
    def guest_ticket(intent:str,build:str,request:Request,body:TicketIn):
        _guard(request,service.allowed,'x-starli-guest-intent');return JSONResponse(service.issue_ticket(request,intent,build),headers={'Cache-Control':'no-store'})
    @router.post('/api/v1/starli/grokbot1/claims/{intent}/builds/{build}/ticket')
    def owner_ticket(intent:str,build:str,request:Request,body:TicketIn):
        _guard(request,service.allowed,'x-starli-claim');return JSONResponse(service.issue_ticket(request,intent,build,True),headers={'Cache-Control':'no-store'})
    @router.post('/internal/v1/model-app-authority/{build}/redeem')
    def redeem(build:str,body:RedeemIn,request:Request):return JSONResponse(service.redeem(build,request.headers.get('x-starli-app-authority'),body.ticket,body.appOrigin),headers={'Cache-Control':'no-store'})
    @router.post('/internal/v1/model-app-authority/{build}/authorize')
    def authorize(build:str,body:AuthorizeIn,request:Request):return JSONResponse(service.authorize(build,request.headers.get('x-starli-app-authority'),body.sessionToken),headers={'Cache-Control':'no-store'})
    app.include_router(router);app.state.guest_company_authority=service
    # Wrap only explicit native issuer POST; do not mutate any frozen function/module.
    issuer=next(r for r in app.routes if getattr(r,'path','')=='/api/v1/starli/public/grokbot1/intents' and 'POST' in (getattr(r,'methods',set()) or set()))
    previous=issuer.dependant.call
    def issued(body,request:Request,response:Response):
        value=previous(body,request,response);service.ensure_provisional(request,value['intentId']);return value
    issuer.dependant.call=issued
    return service
