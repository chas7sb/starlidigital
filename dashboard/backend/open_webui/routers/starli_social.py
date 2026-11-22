"""Customer-owned social OAuth and MCP transport. Credentials never reach chat or browser."""
import starli_portable as _portable
import asyncio,base64,hashlib,json,os,secrets,sqlite3,time,uuid
from contextlib import contextmanager
from urllib.parse import urlencode,urlsplit
import aiohttp
from cryptography.fernet import Fernet,InvalidToken
from fastapi import APIRouter,Depends,HTTPException,Request,Response
from pydantic import BaseModel,Field
from open_webui.utils.auth import get_verified_user
from open_webui.routers.starli_state import state_dir
from open_webui.routers.starli_platform import customer_principal

router=APIRouter()
ISSUER=_portable.platform_public_url('')
SCOPES="facebook.pages.read facebook.pages.publish facebook.media.write facebook.social_loop.read facebook.social_loop.manage facebook.image.generate instagram.read instagram.publish"
READ_TOOLS=frozenset("facebook_pages_list facebook_pages_list_managed facebook_pages_current social_loop_list social_loop_get social_loop_history facebook_reel_render_status facebook_reel_status instagram_status instagram_loop_history instagram_mirror_loops".split())
LOCKS={}
def uid(user):return customer_principal(user)[0]
def configured():
    client=os.getenv("STARLI_SOCIAL_CLIENT_ID","")
    redirect=os.getenv("STARLI_SOCIAL_REDIRECT_URI",_portable.public_url('/starli/social'))
    parsed=urlsplit(redirect)
    if not client:return None
    if redirect != _portable.public_url("/starli/social"):raise HTTPException(503,"Invalid social OAuth callback configuration")
    return client,redirect
def cipher():
    secret=os.getenv("WEBUI_SECRET_KEY")
    if not secret:raise HTTPException(503,"Social credential encryption is not configured")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("social-oauth:"+secret).encode()).digest()))
@contextmanager
def db():
    root=state_dir();root.mkdir(parents=True,exist_ok=True,mode=0o700)
    path=root/"social-oauth.sqlite";c=sqlite3.connect(path,timeout=10);c.row_factory=sqlite3.Row
    path.chmod(0o600)
    c.execute("CREATE TABLE IF NOT EXISTS connections(owner TEXT PRIMARY KEY,sealed TEXT NOT NULL,expires REAL NOT NULL,scope TEXT NOT NULL)")
    c.execute("CREATE TABLE IF NOT EXISTS oauth_states(hash TEXT PRIMARY KEY,owner TEXT NOT NULL,sealed TEXT NOT NULL,expires REAL NOT NULL)")
    c.execute("CREATE TABLE IF NOT EXISTS social_actions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,idem TEXT NOT NULL,digest TEXT NOT NULL,tool TEXT NOT NULL,args TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created REAL NOT NULL,UNIQUE(owner,idem))")
    try:
        with c:yield c
    finally:c.close()
def guard(request):
    if not request.headers.get("authorization","").startswith("Bearer ") or not request.headers.get("authorization","")[7:].strip():raise HTTPException(403,"Bearer authentication required")
def public_action(row):return {k:json.loads(row[k]) if k in ("args","result") and row[k] else row[k] for k in ("id","digest","tool","args","status","result","created")}
def status(user):
    owner=uid(user)
    with db() as c:row=c.execute("SELECT expires,scope FROM connections WHERE owner=?",(owner,)).fetchone()
    return {"connected":bool(row),"state":"CONNECTED" if row else "CONNECTION_REQUIRED" if configured() else "CLIENT_NOT_CONFIGURED",
            "scope":row["scope"].split() if row else [],"expiresAt":row["expires"] if row else None,
            "reason":None if row else "Connect your Facebook and Instagram publishing account." if configured() else "The native Open WebUI OAuth client must be registered with the social service."}
async def request_json(path,data=None,token=None,rpc=False):
    # Fixed trusted origin; models cannot choose an endpoint or redirect.
    headers={"Content-Type":"application/json" if rpc else "application/x-www-form-urlencoded"}
    if token:headers["Authorization"]="Bearer "+token
    if rpc:headers["Accept"]="application/json, text/event-stream"
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60),trust_env=False) as client:
        async with client.post(_portable.platform_url(path),headers=headers,json=data if rpc else None,data=data if not rpc else None,allow_redirects=False) as response:
            raw=await response.content.read(262145)
            if len(raw)>262144:raise HTTPException(502,"Social response exceeds limit")
            if response.status!=200:raise HTTPException(401 if response.status in (401,403) else 502,"Social authorization expired or the service rejected this request" if response.status in (401,403) else "Social service unavailable ("+str(response.status)+")")
            try:
                text=raw.decode()
                if response.headers.get("content-type","").startswith("text/event-stream"):
                    values=[json.loads(line[5:].strip()) for line in text.splitlines() if line.startswith("data:") and line[5:].strip() not in ("","[DONE]")]
                    return next(v for v in reversed(values) if isinstance(v,dict) and ("result" in v or "error" in v))
                return json.loads(text)
            except (ValueError,StopIteration,UnicodeError):raise HTTPException(502,"Invalid social response") from None
def save_tokens(owner,tokens):
    if tokens.get("token_type","").lower()!="bearer" or not isinstance(tokens.get("access_token"),str) or not isinstance(tokens.get("refresh_token"),str):raise HTTPException(502,"Social service returned invalid credentials")
    expires=time.time()+max(1,min(int(tokens.get("expires_in",3600)),86400))
    sealed=cipher().encrypt(json.dumps({"access":tokens["access_token"],"refresh":tokens["refresh_token"]}).encode()).decode()
    with db() as c:c.execute("INSERT INTO connections VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET sealed=excluded.sealed,expires=excluded.expires,scope=excluded.scope",(owner,sealed,expires,str(tokens.get("scope",""))))
async def access(owner):
    async with LOCKS.setdefault(owner,asyncio.Lock()):
        with db() as c:row=c.execute("SELECT * FROM connections WHERE owner=?",(owner,)).fetchone()
        if not row:raise HTTPException(409,"Connect your social publishing account first")
        try:tokens=json.loads(cipher().decrypt(row["sealed"].encode()))
        except (ValueError,InvalidToken):raise HTTPException(503,"Stored social connection is unavailable") from None
        if row["expires"]>time.time()+60:return tokens["access"]
        config=configured()
        if not config:raise HTTPException(503,"Social OAuth client is not configured")
        renewed=await request_json("/customer/oauth/token",{"grant_type":"refresh_token","client_id":config[0],"refresh_token":tokens["refresh"]})
        save_tokens(owner,renewed);return renewed["access_token"]
async def rpc(user,method,params=None):
    data=await request_json("/customer/mcp",{"jsonrpc":"2.0","id":str(uuid.uuid4()),"method":method,**({"params":params} if params else {})},await access(uid(user)),True)
    if data.get("error"):raise HTTPException(502,"Social operation was rejected")
    return data.get("result",{})
async def catalog(user):
    if not status(user)["connected"]:return {"tools":[],"connection":status(user)}
    result=await rpc(user,"tools/list")
    return {**result,"connection":status(user)}
async def invoke_read(user,name,args):
    if name not in READ_TOOLS:raise HTTPException(403,"Prepare this social action for review before execution")
    return await rpc(user,"tools/call",{"name":name,"arguments":args})
async def prepare(user,name,args,key):
    if not isinstance(key,str) or not 1<=len(key)<=160:raise HTTPException(422,"A stable operation key is required")
    tools=await catalog(user)
    if not any(t.get("name")==name for t in tools.get("tools",[])):raise HTTPException(404,"Social tool unavailable for this connection")
    encoded=json.dumps(args,sort_keys=True,separators=(",",":"))
    if len(encoded)>32000:raise HTTPException(422,"Social action is too large")
    digest=hashlib.sha256((name+":"+encoded).encode()).hexdigest();owner=uid(user)
    with db() as c:
        c.execute("BEGIN IMMEDIATE");row=c.execute("SELECT * FROM social_actions WHERE owner=? AND idem=?",(owner,key)).fetchone()
        if row:
            if row["digest"]!=digest:raise HTTPException(409,"Operation key already used with different arguments")
            return public_action(row)
        ident="social-"+uuid.uuid4().hex
        c.execute("INSERT INTO social_actions VALUES(?,?,?,?,?,?,?,NULL,?)",(ident,owner,key,digest,name,encoded,"PENDING",time.time()))
        return public_action(c.execute("SELECT * FROM social_actions WHERE id=?",(ident,)).fetchone())
@router.get("")
def connection_status(user=Depends(get_verified_user)):return status(user)
async def available_scopes():
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10),trust_env=False) as client:
        async with client.get(_portable.platform_url("/.well-known/oauth-authorization-server/customer"),allow_redirects=False) as response:
            raw=await response.content.read(32769)
            if response.status!=200 or len(raw)>32768:raise HTTPException(503,"Social authorization metadata is unavailable")
            try:data=json.loads(raw)
            except ValueError:raise HTTPException(502,"Invalid social authorization metadata") from None
    if data.get("issuer")!=ISSUER or data.get("authorization_endpoint")!=ISSUER+"/customer/oauth/authorize":
        raise HTTPException(502,"Social authorization metadata has an unexpected issuer")
    offered=data.get("scopes_supported",[])
    scopes=[v for v in SCOPES.split() if v in offered]
    if not scopes:raise HTTPException(503,"No social capabilities are available")
    return scopes
async def native_consent_cookie(request,config,state,challenge):
    # Forward the already verified native bearer only to the fixed customer SSO endpoint.
    authorization=request.headers.get("authorization","")
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15),trust_env=False) as client:
        async with client.post(_portable.platform_url("/customer/native-session"),headers={"Authorization":authorization,"Content-Type":"application/json"},
            json={"clientId":config[0],"redirectUri":config[1],"state":state,"challenge":challenge},allow_redirects=False) as response:
            raw=await response.content.read(4097)
            if response.status!=200 or len(raw)>4096:raise HTTPException(503,"Native social sign-in is unavailable. The social service may need its native customer bridge activated.")
            cookie=response.headers.get("Set-Cookie","")
    from http.cookies import SimpleCookie
    parsed=SimpleCookie()
    try:parsed.load(cookie)
    except Exception:raise HTTPException(502,"Invalid native consent cookie") from None
    name="starli_native_customer_consent"
    value=parsed.get(name)
    if len(parsed)!=1 or value is None or not __import__("re").fullmatch(r"starli_native_consent_[A-Za-z0-9_-]{43}",value.value) or value["domain"].lstrip(".") != urlsplit(ISSUER).hostname or value["path"]!="/customer" or not value["httponly"] or not value["secure"] or value["samesite"].lower()!="lax":
        raise HTTPException(502,"Native consent cookie has invalid security attributes")
    return cookie

@router.post("/connect")
async def connect(request:Request,response:Response,user=Depends(get_verified_user)):
    guard(request);config=configured()
    if not config:raise HTTPException(503,"Register the native OAuth client before connecting accounts")
    scopes=await available_scopes()
    owner=uid(user);state=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(48);challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    cookie=await native_consent_cookie(request,config,state,challenge)
    response.headers.append("Set-Cookie",cookie)
    with db() as c:
        c.execute("DELETE FROM oauth_states WHERE expires<?",(time.time(),))
        c.execute("INSERT INTO oauth_states VALUES(?,?,?,?)",(hashlib.sha256(state.encode()).hexdigest(),owner,cipher().encrypt(verifier.encode()).decode(),time.time()+600))
    authorization_url=ISSUER+"/customer/oauth/authorize?"+urlencode({"response_type":"code","client_id":config[0],"redirect_uri":config[1],"scope":" ".join(scopes),"state":state,"code_challenge":challenge,"code_challenge_method":"S256","resource":ISSUER+"/customer/mcp"})
    return {"url":authorization_url,"authorizationUrl":authorization_url}
class Callback(BaseModel):
    code:str=Field(min_length=8,max_length=256)
    state:str=Field(min_length=32,max_length=128)
@router.post("/callback")
async def callback(body:Callback,request:Request,user=Depends(get_verified_user)):
    guard(request);owner=uid(user);hashed=hashlib.sha256(body.state.encode()).hexdigest()
    with db() as c:
        c.execute("BEGIN IMMEDIATE");row=c.execute("SELECT * FROM oauth_states WHERE hash=? AND owner=? AND expires>?",(hashed,owner,time.time())).fetchone()
        if not row:raise HTTPException(403,"Social connection request expired or belongs to another account")
        c.execute("DELETE FROM oauth_states WHERE hash=?",(hashed,))
    config=configured()
    if not config:raise HTTPException(503,"Social OAuth client is unavailable")
    verifier=cipher().decrypt(row["sealed"].encode()).decode()
    tokens=await request_json("/customer/oauth/token",{"grant_type":"authorization_code","client_id":config[0],"redirect_uri":config[1],"code":body.code,"code_verifier":verifier})
    save_tokens(owner,tokens);return status(user)
@router.delete("")
def disconnect(request:Request,user=Depends(get_verified_user)):
    guard(request)
    with db() as c:c.execute("DELETE FROM connections WHERE owner=?",(uid(user),))
    return {"connected":False,"state":"DISCONNECTED","remoteGrant":"Use provider account settings to revoke the OAuth grant if required."}
@router.get("/tools")
async def list_tools(user=Depends(get_verified_user)):return await catalog(user)
@router.get("/actions")
def actions(user=Depends(get_verified_user)):
    with db() as c:return {"items":[public_action(r) for r in c.execute("SELECT * FROM social_actions WHERE owner=? ORDER BY created DESC LIMIT 100",(uid(user),))]}
class Prepare(BaseModel):
    tool:str=Field(min_length=1,max_length=100)
    args:dict=Field(default_factory=dict)
    operationKey:str=Field(min_length=1,max_length=160)
@router.post("/actions")
async def prepare_action(body:Prepare,request:Request,user=Depends(get_verified_user)):
    guard(request);return await prepare(user,body.tool,body.args,body.operationKey)
class Decision(BaseModel):
    digest:str=Field(min_length=64,max_length=64)
    decision:str=Field(pattern="^(approve|reject)$")
@router.post("/actions/{ident}/decision")
async def decide(ident:str,body:Decision,request:Request,user=Depends(get_verified_user)):
    guard(request);owner=uid(user)
    with db() as c:
        c.execute("BEGIN IMMEDIATE");row=c.execute("SELECT * FROM social_actions WHERE id=? AND owner=?",(ident,owner)).fetchone()
        if not row:raise HTTPException(404,"Action not found")
        if row["digest"]!=body.digest:raise HTTPException(409,"The reviewed action has changed")
        if row["status"]!="PENDING":return public_action(row)
        c.execute("UPDATE social_actions SET status=? WHERE id=?",("REJECTED" if body.decision=="reject" else "EXECUTING",ident))
    if body.decision=="reject":
        with db() as c:return public_action(c.execute("SELECT * FROM social_actions WHERE id=?",(ident,)).fetchone())
    try:
        result=await rpc(user,"tools/call",{"name":row["tool"],"arguments":json.loads(row["args"])})
        status_value="FAILED" if result.get("isError") else "COMPLETED"
    except Exception:
        # Never replay an action after an uncertain transport/provider result.
        result={"isError":True,"message":"The outcome is uncertain. Inspect provider status before preparing another action."};status_value="UNCERTAIN"
    with db() as c:
        c.execute("UPDATE social_actions SET status=?,result=? WHERE id=? AND owner=?",(status_value,json.dumps(result),ident,owner))
        return public_action(c.execute("SELECT * FROM social_actions WHERE id=?",(ident,)).fetchone())
TOOL_SCHEMAS=[
 {"name":"social_connection","description":"Inspect the current customer's social publishing connection. Connect through the native Social publishing panel at /starli/social.","inputSchema":{"type":"object","properties":{}}},
 {"name":"social_tools","description":"Discover the real Facebook, Instagram, image, video and recurring publishing tools authorized by the current customer's social connection.","inputSchema":{"type":"object","properties":{}}},
 {"name":"social_read","description":"Run a connected read-only social tool, such as page selection/status, scheduled posts, video render status or automation history.","inputSchema":{"type":"object","properties":{"tool":{"type":"string"},"args":{"type":"object"}},"required":["tool"]}},
 {"name":"social_prepare","description":"Prepare a concrete Facebook/Instagram post, image/video generation, schedule or recurring automation using the connected tool's exact schema. User reviews and confirms in the native chat side panel; preparing never publishes.","inputSchema":{"type":"object","properties":{"tool":{"type":"string"},"args":{"type":"object"},"operationKey":{"type":"string"}},"required":["tool","args","operationKey"]}},
 {"name":"social_actions","description":"Read the current customer's prepared social actions and truthful execution receipts.","inputSchema":{"type":"object","properties":{}}}
]
def schema(name):return next((v for v in TOOL_SCHEMAS if v["name"]==name),None)
async def tool(user,name,args):
    if name=="social_connection":return status(user)
    if name=="social_tools":return await catalog(user)
    if name=="social_read":return await invoke_read(user,str(args.get("tool","")),args.get("args") or {})
    if name=="social_prepare":return await prepare(user,str(args.get("tool","")),args.get("args") or {},args.get("operationKey"))
    if name=="social_actions":return actions(user)
    raise HTTPException(404,"Unknown social tool")
