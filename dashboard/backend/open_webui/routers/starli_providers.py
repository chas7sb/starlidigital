"""Per-account Pi providers. Credentials are encrypted at rest and never returned to browsers."""
from __future__ import annotations
import starli_portable as _portable
import asyncio,hashlib,json,os,secrets,sqlite3,time,uuid
from contextlib import contextmanager
from pathlib import Path
from fastapi import APIRouter,Depends,HTTPException,Request,Query
from pydantic import BaseModel,Field
from cryptography.fernet import Fernet,InvalidToken
from open_webui.utils.auth import get_verified_user
from open_webui.routers.starli_state import state_dir,runtime_code_dir

router=APIRouter()
NODE=_portable.node_binary()
_SESSIONS={}
_LOCKS={}
_CATALOG=None
_CATALOG_LOCK=asyncio.Lock()

def owner(user):
    uid=user.get("id") if isinstance(user,dict) else getattr(user,"id",None)
    role=user.get("role") if isinstance(user,dict) else getattr(user,"role",None)
    if not isinstance(uid,str) or not uid or role not in ("user","admin"):raise HTTPException(403,"An active account is required")
    return uid

def root():
    p=state_dir()/"providers";p.mkdir(parents=True,exist_ok=True,mode=0o700)
    if p.is_symlink():raise HTTPException(503,"Provider storage unavailable")
    p.chmod(0o700);return p

def cipher():
    p=root()/"master.key"
    if not p.exists():
        try:
            fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,"wb") as f:f.write(Fernet.generate_key())
        except FileExistsError:pass
    info=p.lstat()
    if p.is_symlink() or info.st_mode&0o077 or info.st_size!=44:raise HTTPException(503,"Provider vault unavailable")
    return Fernet(p.read_bytes())

@contextmanager
def database():
    p=root()/"accounts.sqlite";c=sqlite3.connect(p,timeout=10)
    p.chmod(0o600);c.execute("PRAGMA busy_timeout=10000")
    c.execute("CREATE TABLE IF NOT EXISTS accounts(owner TEXT PRIMARY KEY,sealed BLOB NOT NULL,updated REAL NOT NULL)")
    try:
        with c:yield c
    finally:c.close()

def account(uid):
    with database() as c:row=c.execute("SELECT sealed FROM accounts WHERE owner=?",(uid,)).fetchone()
    if not row:return {"credentials":{},"selection":None,"catalogs":{},"deviceId":str(uuid.uuid4())}
    try:return json.loads(cipher().decrypt(row[0]))
    except (ValueError,InvalidToken):raise HTTPException(503,"Provider vault cannot be opened") from None

def persist(uid,data):
    sealed=cipher().encrypt(json.dumps(data).encode())
    with database() as c:c.execute("INSERT INTO accounts VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET sealed=excluded.sealed,updated=excluded.updated",(uid,sealed,time.time()))

def lock(uid):
    if uid not in _LOCKS:_LOCKS[uid]=asyncio.Lock()
    return _LOCKS[uid]

def environment(uid):
    home=root()/"homes"/hashlib.sha256(uid.encode()).hexdigest();home.mkdir(parents=True,exist_ok=True,mode=0o700)
    # Do not inherit operator API keys, cloud credentials, proxies or Pi auth files.
    return {"PATH":os.environ.get("PATH",os.defpath),"LANG":"C.UTF-8","HOME":str(home)}

async def process(uid):
    return await asyncio.create_subprocess_exec(NODE,"--import","tsx",str(runtime_code_dir()/"provider-runtime.mts"),
        cwd=str(runtime_code_dir()),env=environment(uid),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,limit=8*1024*1024)

async def run(uid,payload,timeout=45):
    proc=await process(uid)
    try:
        output,_=await asyncio.wait_for(proc.communicate((json.dumps(payload)+"\n").encode()),timeout)
        if len(output)>8*1024*1024:raise HTTPException(502,"Provider catalog exceeds its limit")
        lines=[json.loads(l) for l in output.splitlines() if l.startswith(b"{")]
        result=lines[-1] if lines else {}
        if result.get("type")=="error" or proc.returncode:
            provider=payload.get("provider")
            fresh=result.get("credentials",{}).get(provider) if provider else None
            if fresh and provider in payload.get("credentials",{}):
                current=account(uid)
                if current.get("credentials",{}).get(provider)==payload["credentials"][provider]:
                    current["credentials"][provider]=fresh;persist(uid,current)
            raise HTTPException(502,result.get("code","Provider operation failed"))
        return result
    except asyncio.TimeoutError:raise HTTPException(504,"Provider operation timed out") from None
    finally:
        if proc.returncode is None:proc.kill();await proc.wait()

async def catalog():
    global _CATALOG
    if _CATALOG is None:
        async with _CATALOG_LOCK:
            if _CATALOG is None:_CATALOG=await run("catalog",{"operation":"catalog","credentials":{}},60)
    return _CATALOG

def bearer(request):
    if not request.headers.get("authorization","").startswith("Bearer "):raise HTTPException(403,"Bearer authentication is required")

def public_session(session):
    return {k:session.get(k) for k in ("id","provider","authType","status","events","prompt","error")}

async def login_reader(session):
    proc=session["process"];uid=session["owner"];start=time.monotonic()
    try:
        async with asyncio.timeout(600):
            while True:
                line=await proc.stdout.readline()
                if not line:raise RuntimeError("LOGIN_DISCONNECTED")
                if len(line)>2*1024*1024:raise RuntimeError("LOGIN_RESPONSE_TOO_LARGE")
                event=json.loads(line)
                kind=event.get("type")
                if kind=="authenticated":
                    fresh=event.get("credentials",{}).get(session["provider"])
                    if not isinstance(fresh,dict) or fresh.get("type") not in ("api_key","oauth"):raise RuntimeError("INVALID_CREDENTIAL")
                    async with lock(uid):
                        data=account(uid);data["credentials"][session["provider"]]=fresh
                        if (data.get("selection") or {}).get("provider")==session["provider"]:
                            data["selectionRevision"]=uuid.uuid4().hex
                        persist(uid,data)
                    session.update(status="CONNECTED",prompt=None);break
                if kind=="error":session.update(status="FAILED",error=event.get("code","Provider authentication failed"),prompt=None);break
                if kind=="prompt":session.update(status="INPUT_REQUIRED",prompt={"id":event["id"],**event["prompt"]})
                elif kind=="event":
                    # Provider-emitted login links/device codes are intentional user-facing OAuth instructions.
                    item=event.get("event",{})
                    if item.get("type") in ("info","auth_url","device_code","progress"):
                        session["events"]=[*session["events"][-19:],item]
    except (asyncio.TimeoutError,asyncio.CancelledError):
        session.update(status="EXPIRED" if time.monotonic()-start>=590 else "CANCELLED",prompt=None)
    except Exception:
        session.update(status="FAILED",error="Provider login ended before authentication completed",prompt=None)
    finally:
        session["finishedAt"]=time.time()
        if proc.returncode is None:proc.kill();await proc.wait()

def prune_sessions():
    now=time.time()
    for ident,s in list(_SESSIONS.items()):
        if s.get("finishedAt") and now-s["finishedAt"]>300:_SESSIONS.pop(ident,None)

@router.get("")
async def list_providers(user=Depends(get_verified_user)):
    uid=owner(user);data=account(uid);items=[]
    for provider in (await catalog()).get("providers",[]):
        credential=data["credentials"].get(provider["id"])
        items.append({**provider,"connected":bool(credential),"credentialType":credential.get("type") if credential else None})
    return {"items":items,"selection":data.get("selection"),"catalogSource":"installed-pi-runtime","credentialsVisible":False}

@router.get("/{provider}/models")
async def list_models(provider:str,q:str=Query("",max_length=200),offset:int=Query(0,ge=0),limit:int=Query(100,ge=1,le=250),user=Depends(get_verified_user)):
    uid=owner(user);data=account(uid)
    known=await catalog()
    if not any(p["id"]==provider for p in known.get("providers",[])):raise HTTPException(404,"Provider not found")
    models=data.get("catalogs",{}).get(provider) or [m for m in known.get("models",[]) if m["provider"]==provider]
    if q:models=[m for m in models if q.casefold() in (m["id"]+" "+m["name"]).casefold()]
    return {"items":models[offset:offset+limit],"total":len(models),"offset":offset,"selection":data.get("selection"),"connected":provider in data["credentials"]}

class LoginBody(BaseModel):
    authType:str=Field(pattern="^(api_key|oauth)$")
    class Config:extra="forbid"

@router.post("/{provider}/login")
async def start_login(provider:str,body:LoginBody,request:Request,user=Depends(get_verified_user)):
    bearer(request);uid=owner(user);prune_sessions()
    known=next((p for p in (await catalog()).get("providers",[]) if p["id"]==provider),None)
    method=next((m for m in (known or {}).get("authMethods",[]) if m["type"]==body.authType),None)
    if not method or not method["interactive"]:raise HTTPException(422,"This provider requires operator-managed ambient credentials; interactive connection is unavailable")
    if any(s["owner"]==uid and s["status"] in ("CONNECTING","INPUT_REQUIRED") for s in _SESSIONS.values()):raise HTTPException(409,"Finish or cancel your current provider connection")
    if sum(s["status"] in ("CONNECTING","INPUT_REQUIRED") for s in _SESSIONS.values())>=20:raise HTTPException(429,"Provider login capacity reached")
    async with lock(uid):
        data=account(uid)
        if not data.get("deviceId"):
            data["deviceId"]=str(uuid.uuid4())
            persist(uid,data)
    proc=await process(uid);ident=secrets.token_urlsafe(24)
    session={"id":ident,"owner":uid,"provider":provider,"authType":body.authType,"status":"CONNECTING","events":[],"prompt":None,"error":"","process":proc,"created":time.time()}
    _SESSIONS[ident]=session
    proc.stdin.write((json.dumps({"operation":"login","provider":provider,"authType":body.authType,"credentials":data["credentials"],"deviceId":data["deviceId"]})+"\n").encode());await proc.stdin.drain()
    session["reader"]=asyncio.create_task(login_reader(session))
    return public_session(session)

def own_session(uid,ident):
    session=_SESSIONS.get(ident)
    if not session or session["owner"]!=uid:raise HTTPException(404,"Provider login not found")
    return session

@router.get("/sessions/{ident}/status")
async def login_status(ident:str,user=Depends(get_verified_user)):
    return public_session(own_session(owner(user),ident))

class AnswerBody(BaseModel):
    promptId:str=Field(min_length=8,max_length=100)
    value:str=Field(min_length=1,max_length=20000)
    class Config:extra="forbid"

@router.post("/sessions/{ident}/answer")
async def answer_login(ident:str,body:AnswerBody,request:Request,user=Depends(get_verified_user)):
    bearer(request);s=own_session(owner(user),ident)
    if s["status"]!="INPUT_REQUIRED" or s.get("prompt",{}).get("id")!=body.promptId:raise HTTPException(409,"The connection step has changed")
    s["process"].stdin.write((json.dumps(body.model_dump())+"\n").encode());await s["process"].stdin.drain()
    s.update(status="CONNECTING",prompt=None)
    return public_session(s)

@router.delete("/sessions/{ident}")
async def cancel_login(ident:str,request:Request,user=Depends(get_verified_user)):
    bearer(request);s=own_session(owner(user),ident)
    s["reader"].cancel();s.update(status="CANCELLED",prompt=None)
    return public_session(s)

class SelectionBody(BaseModel):
    provider:str=Field(min_length=1,max_length=100)
    model:str=Field(min_length=1,max_length=300)
    class Config:extra="forbid"

@router.put("/selection/default")
async def choose_model(body:SelectionBody,request:Request,user=Depends(get_verified_user)):
    bearer(request);uid=owner(user)
    async with lock(uid):
        data=account(uid)
        if body.provider not in data["credentials"]:raise HTTPException(409,"Connect this provider before selecting its model")
        models=data.get("catalogs",{}).get(body.provider) or [m for m in (await catalog()).get("models",[]) if m["provider"]==body.provider]
        if not any(m["id"]==body.model and m.get("type","chat")=="chat" for m in models):raise HTTPException(422,"Choose a chat model from the installed provider catalog")
        selected={"provider":body.provider,"model":body.model}
        if selected!=data.get("selection"):
            data["selectionRevision"]=uuid.uuid4().hex
        data["selection"]=selected;persist(uid,data)
    return {"selection":data["selection"]}

@router.post("/{provider}/refresh")
async def refresh_models(provider:str,request:Request,user=Depends(get_verified_user)):
    bearer(request);uid=owner(user)
    async with lock(uid):
        data=account(uid)
        if provider not in data["credentials"]:raise HTTPException(409,"Connect this provider first")
        result=await run(uid,{"operation":"refresh","provider":provider,"credentials":data["credentials"]},60)
        data.setdefault("catalogs",{})[provider]=result.get("models",[])
        data["credentials"]=result.get("credentials",data["credentials"]);persist(uid,data)
    return {"modelCount":len(result.get("models",[]))}

@router.delete("/{provider}")
async def disconnect(provider:str,request:Request,user=Depends(get_verified_user)):
    bearer(request);uid=owner(user)
    async with lock(uid):
        data=account(uid);data["credentials"].pop(provider,None);data.get("catalogs",{}).pop(provider,None)
        if (data.get("selection") or {}).get("provider")==provider:
            data["selection"]=None
            data["selectionRevision"]=uuid.uuid4().hex
        persist(uid,data)
    return {"disconnected":True}

def runtime_configuration(uid):
    """Internal only: pass directly to the isolated Pi process stdin, never browser/logs."""
    data=account(uid);selection=data.get("selection")
    if not selection:return None
    credential=data["credentials"].get(selection["provider"])
    if not credential:return None
    return {**selection,"credentials":{selection["provider"]:credential}}

def _native_account_binding(data):
    selected=data.get("selection") or {}
    provider,model=selected.get("provider"),selected.get("model")
    if not (isinstance(provider,str) and provider and isinstance(model,str) and model
            and isinstance(data.get("credentials",{}).get(provider),dict)):
        raise HTTPException(409,"ACCOUNT_PROVIDER_NOT_CONNECTED")
    return (provider,model,data.get("selectionRevision","initial"))

def native_account_binding(uid,agent_model):
    binding=_native_account_binding(account(uid))
    if agent_model not in (None,"","account-default",binding[1]):
        raise HTTPException(409,"ACCOUNT_MODEL_SELECTION_CHANGED")
    return binding

def native_account_configuration(uid,expected):
    data=account(uid)
    binding=_native_account_binding(data)
    if binding!=expected:
        raise HTTPException(409,"ACCOUNT_PROVIDER_SELECTION_CHANGED")
    provider,model,_=binding
    return {"provider":provider,"model":model,"credentials":{provider:data["credentials"][provider]}}

async def refresh_native_credential(uid,expected,previous,replacement,*,authorize):
    provider=expected[0]
    if not isinstance(previous,dict) or previous.get("type")!="oauth" or not isinstance(replacement,dict) or replacement.get("type")!="oauth":
        raise HTTPException(409,"ACCOUNT_PROVIDER_REFRESH_INVALID")
    async with lock(uid):
        authorize()
        with database() as db:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT sealed FROM accounts WHERE owner=?",(uid,)).fetchone()
            if row is None:
                raise HTTPException(409,"ACCOUNT_PROVIDER_NOT_CONNECTED")
            vault=cipher()
            data=json.loads(vault.decrypt(row[0]))
            if _native_account_binding(data)!=expected or data["credentials"][provider]!=previous:
                raise HTTPException(409,"ACCOUNT_PROVIDER_CREDENTIAL_CHANGED")
            data["credentials"][provider]=replacement
            authorize()
            db.execute("UPDATE accounts SET sealed=?,updated=? WHERE owner=?",
                       (vault.encrypt(json.dumps(data).encode()),time.time(),uid))

async def infer(uid,prompt,messages=None,timeout=600):
    """Internal customer-selected model inference, with OAuth refresh persisted safely."""
    async with lock(uid):
        config=runtime_configuration(uid)
        if not config:return None
        result=await run(uid,{"operation":"infer",**config,"prompt":prompt,"messages":messages or []},timeout)
        data=account(uid);fresh=result.get("credentials",{}).get(config["provider"])
        if fresh:data["credentials"][config["provider"]]=fresh;persist(uid,data)
        return {k:result.get(k) for k in ("text","model","provider","usage")}

@router.on_event("shutdown")
async def stop_provider_logins():
    for session in _SESSIONS.values():
        if session["status"] in ("CONNECTING","INPUT_REQUIRED") and session.get("reader"):session["reader"].cancel()
