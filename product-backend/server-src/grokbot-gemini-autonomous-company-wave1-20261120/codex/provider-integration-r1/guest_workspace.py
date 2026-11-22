"""Cookie-owned durable guest messages using native public/chat budget/idempotency."""
import asyncio,hashlib,hmac,json,sqlite3,time,uuid
from contextlib import closing
from fastapi import APIRouter,Request,Response,HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,StrictStr,Field,model_validator

class GuestMessage(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    requestId:StrictStr=Field(min_length=8,max_length=128,pattern=r'^[A-Za-z0-9._:-]+$')
    content:StrictStr|None=Field(default=None,min_length=1,max_length=4000)
    replyToMessageId:StrictStr|None=Field(default=None,min_length=1,max_length=100)
    @model_validator(mode='after')
    def exact(self):
        if (self.content is None)==(self.replyToMessageId is None):raise ValueError('Exactly one content or reply target required')
        if self.content is not None and not self.content.strip():raise ValueError('Message is empty')
        return self

def install_guest_workspace(app,svc,*,allowed_origins):
    from grokbot1_routes import _guard
    router=APIRouter(prefix='/api/v1/starli/public/grokbot1/intents')
    path=svc.p.intake
    def connect():
        c=sqlite3.connect(str(path),timeout=5);c.row_factory=sqlite3.Row;c.execute('PRAGMA busy_timeout=5000');return c
    with closing(connect()) as db,db:
        db.executescript('''CREATE TABLE IF NOT EXISTS staging_guest_workspace_turns(intent TEXT NOT NULL,binding TEXT NOT NULL,request TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,user_id TEXT NOT NULL,assistant_id TEXT NOT NULL,reply TEXT,receipt TEXT,created REAL NOT NULL,PRIMARY KEY(intent,request));
CREATE TABLE IF NOT EXISTS staging_guest_workspace_messages(id TEXT PRIMARY KEY,intent TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,turn_request TEXT NOT NULL,seq INTEGER NOT NULL,UNIQUE(intent,seq));''')
        db.execute("UPDATE staging_guest_workspace_turns SET state='UNCERTAIN' WHERE state='RUNNING'")
    def owned(request,intent):
        value=svc.ns.mini2.resolve_issued_guest_intent(request=request,intent_id=intent,verify_cookie=svc.ns.public.verify_cookie,signing_key=svc.key,db_path=path,now=svc.now)
        return value.receipt,value.verified_binding
    def original_id(intent):return 'guest-original:'+intent
    def envelope(db,receipt,binding):
        intent=receipt['intentId']
        messages=[{'id':original_id(intent),'role':'user','content':receipt['originalPrompt']}]
        messages += [dict(r) for r in db.execute('SELECT id,role,content FROM staging_guest_workspace_messages WHERE intent=? ORDER BY seq',(intent,))]
        last=db.execute('SELECT state FROM staging_guest_workspace_turns WHERE intent=? AND binding=? ORDER BY created DESC LIMIT 1',(intent,binding)).fetchone()
        return {'intentId':intent,'requestId':receipt['requestId'],'originalPrompt':receipt['originalPrompt'],'messages':messages,'replyState':('COMPLETE' if last['state']=='COMPLETED' else last['state']) if last else 'NOT_REQUESTED','provider':'openrouter','model':'nvidia/nemotron-3-ultra-550b-a55b:free'}
    @router.get('/{intent_id}/workspace')
    def read(intent_id:str,request:Request):
        receipt,binding=owned(request,intent_id)
        with closing(connect()) as db:return JSONResponse(envelope(db,receipt,binding),headers={'Cache-Control':'no-store'})
    @router.post('/{intent_id}/workspace/messages')
    async def post(intent_id:str,body:GuestMessage,request:Request):
        _guard(request,set(allowed_origins),'x-starli-guest-intent')
        receipt,binding=owned(request,intent_id)
        fingerprint=hashlib.sha256(json.dumps(body.model_dump(),sort_keys=True).encode()).hexdigest()
        with closing(connect()) as db,db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT * FROM staging_guest_workspace_turns WHERE intent=? AND request=?',(intent_id,body.requestId)).fetchone()
            if prior:
                if not hmac.compare_digest(prior['binding'],binding) or not hmac.compare_digest(prior['fingerprint'],fingerprint):raise HTTPException(409,'GUEST_MESSAGE_IDEMPOTENCY_CONFLICT')
                if prior['state']=='COMPLETED':return JSONResponse(envelope(db,receipt,binding),headers={'Cache-Control':'no-store'})
                if prior['state']=='RUNNING':return JSONResponse(envelope(db,receipt,binding),status_code=202,headers={'Cache-Control':'no-store'})
                raise HTTPException(409,'GUEST_REPLY_UNCERTAIN_NO_AUTOMATIC_RETRY')
            if db.execute("SELECT 1 FROM staging_guest_workspace_turns WHERE intent=? AND state='RUNNING'",(intent_id,)).fetchone():raise HTTPException(409,'GUEST_REPLY_IN_PROGRESS')
            if db.execute('SELECT count(*) FROM staging_guest_workspace_turns WHERE intent=?',(intent_id,)).fetchone()[0]>=10:raise HTTPException(429,'GUEST_CONVERSATION_TURN_LIMIT')
            current=envelope(db,receipt,binding)['messages']
            if body.replyToMessageId is not None:
                if body.replyToMessageId!=original_id(intent_id) or body.requestId!=receipt['requestId'] or len(current)!=1:raise HTTPException(409,'ORIGINAL_GUEST_REPLY_BINDING_MISMATCH')
                user_id=original_id(intent_id)
            else:
                if not db.execute("SELECT 1 FROM staging_guest_workspace_turns WHERE intent=? AND state='COMPLETED'",(intent_id,)).fetchone():raise HTTPException(409,'ORIGINAL_GUEST_REPLY_REQUIRED')
                user_id='guest-user:'+str(uuid.uuid4());current.append({'id':user_id,'role':'user','content':body.content})
            if len(current)>19 or sum(len(m['content']) for m in current)>20000:raise HTTPException(422,'GUEST_HISTORY_LIMIT')
            assistant_id='guest-assistant:'+str(uuid.uuid4())
            if body.content is not None:
                seq=db.execute('SELECT COALESCE(MAX(seq),0)+1 FROM staging_guest_workspace_messages WHERE intent=?',(intent_id,)).fetchone()[0]
                db.execute('INSERT INTO staging_guest_workspace_messages VALUES(?,?,?,?,?,?)',(user_id,intent_id,'user',body.content,body.requestId,seq))
            db.execute('INSERT INTO staging_guest_workspace_turns VALUES(?,?,?,?,?,?,?,?,?,?)',(intent_id,binding,body.requestId,fingerprint,'RUNNING',user_id,assistant_id,None,None,svc.now()))
        native_id='guest-workspace:'+hashlib.sha256((intent_id+'\0'+body.requestId).encode()).hexdigest()
        native_body=svc.ns.public.Chat(requestId=native_id,messages=[{'role':m['role'],'content':m['content']} for m in current])
        try:
            response=Response()
            result=await svc.ns.public.chat(native_body,request,response)
            # Guest capability must still be current before publishing the result.
            owned(request,intent_id)
            with closing(connect()) as db,db:
                row=db.execute('SELECT state FROM staging_guest_workspace_turns WHERE intent=? AND request=?',(intent_id,body.requestId)).fetchone()
                if not row or row['state']!='RUNNING':raise HTTPException(409,'GUEST_REPLY_STATE_CHANGED')
                seq=db.execute('SELECT COALESCE(MAX(seq),0)+1 FROM staging_guest_workspace_messages WHERE intent=?',(intent_id,)).fetchone()[0]
                db.execute('INSERT INTO staging_guest_workspace_messages VALUES(?,?,?,?,?,?)',(assistant_id,intent_id,'assistant',result['reply'],body.requestId,seq))
                db.execute("UPDATE staging_guest_workspace_turns SET state='COMPLETED',reply=? WHERE intent=? AND request=?",(result['reply'],intent_id,body.requestId))
                value=envelope(db,receipt,binding)
            return JSONResponse(value,headers={'Cache-Control':'no-store'})
        except BaseException:
            with closing(connect()) as db,db:db.execute("UPDATE staging_guest_workspace_turns SET state='UNCERTAIN' WHERE intent=? AND request=? AND state='RUNNING'",(intent_id,body.requestId))
            raise
    app.include_router(router)
    return {'workspaceGet':'/api/v1/starli/public/grokbot1/intents/{intentId}/workspace','workspacePost':'/api/v1/starli/public/grokbot1/intents/{intentId}/workspace/messages'}
