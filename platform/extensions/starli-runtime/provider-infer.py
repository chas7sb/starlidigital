"""Trusted Pi inference helper. Account selection and vault credentials never leave this IPC boundary."""
import asyncio,hashlib,json,os,sqlite3,subprocess,sys,time
from pathlib import Path
from cryptography.fernet import Fernet
import fcntl

def main():
    uid=os.environ.get("STARLI_PROVIDER_OWNER","")
    state=os.environ.get("STARLI_STATE_DIR","")
    raw=sys.stdin.buffer.read(8*1024*1024+1)
    if len(raw)>8*1024*1024:
        print(json.dumps({"error":"PROVIDER_INPUT_TOO_LARGE"}));return
    request=json.loads(raw)
    if request.get("mode")=="managed_fallback":
        managed_fallback(request,state);return
    if not uid or len(uid)>150 or not state:
        print(json.dumps({"configured":False}));return
    root=Path(state)/"providers";database=root/"accounts.sqlite";key=root/"master.key"
    if not database.exists() or not key.exists():
        print(json.dumps({"configured":False}));return
    if root.is_symlink() or key.is_symlink() or key.stat().st_mode&0o077:
        print(json.dumps({"error":"PROVIDER_VAULT_UNAVAILABLE"}));return
    cipher=Fernet(key.read_bytes())
    lockroot=root/"locks";lockroot.mkdir(mode=0o700,exist_ok=True)
    lockpath=lockroot/(hashlib.sha256(uid.encode()).hexdigest()+".lock")
    with open(lockpath,"a+b") as mutex:
        os.chmod(lockpath,0o600);fcntl.flock(mutex,fcntl.LOCK_EX)
        with sqlite3.connect(database,timeout=10) as db:
            row=db.execute("SELECT sealed FROM accounts WHERE owner=?",(uid,)).fetchone()
        if not row:
            print(json.dumps({"configured":False}));return
        data=json.loads(cipher.decrypt(row[0]));selection=data.get("selection")
        if not selection or selection["provider"] not in data.get("credentials",{}):
            print(json.dumps({"configured":False}));return
        home=root/"homes"/hashlib.sha256(uid.encode()).hexdigest();home.mkdir(parents=True,mode=0o700,exist_ok=True)
        bridge=Path(__file__).with_name("provider-runtime.mts")
        payload={"operation":"infer",**selection,"credentials":{selection["provider"]:data["credentials"][selection["provider"]]},"prompt":request.get("prompt",""),"messages":request.get("messages",[]),"images":request.get("images",[])}
        result=subprocess.run(["/opt/starlidigital/node/bin/node","--import","tsx",str(bridge)],input=json.dumps(payload).encode(),
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,cwd=str(bridge.parent),timeout=min(900,max(30,int(request.get("timeoutSeconds",600)))),
            env={"PATH":os.environ.get("PATH","/usr/bin:/bin"),"HOME":str(home),"LANG":"C.UTF-8"})
        if len(result.stdout)>2*1024*1024:raise RuntimeError("PROVIDER_OUTPUT_TOO_LARGE")
        lines=[json.loads(line) for line in result.stdout.splitlines() if line.startswith(b"{")]
        response=lines[-1] if lines else {}
        fresh=response.get("credentials",{}).get(selection["provider"])
        if fresh:
            # Merge refreshed provider credentials into the newest account record.
            with sqlite3.connect(database,timeout=10) as db:
                db.execute("BEGIN IMMEDIATE")
                current=db.execute("SELECT sealed FROM accounts WHERE owner=?",(uid,)).fetchone()
                if current:
                    latest=json.loads(cipher.decrypt(current[0]))
                    # Disconnecting a provider during inference must stay disconnected.
                    if latest.get("credentials",{}).get(selection["provider"])==payload["credentials"][selection["provider"]]:
                        latest["credentials"][selection["provider"]]=fresh
                        db.execute("UPDATE accounts SET sealed=?,updated=? WHERE owner=?",(cipher.encrypt(json.dumps(latest).encode()),time.time(),uid))
        if result.returncode or response.get("type")!="inference":
            print(json.dumps({"configured":True,"error":response.get("code","PROVIDER_INFERENCE_FAILED"),"retryable":response.get("retryable",False)}));return
        print(json.dumps({"configured":True,**{k:response.get(k) for k in ("text","provider","model","usage")}}))
def managed_fallback(request,state):
    # Fixed operator-owned server configuration only. Never accept a credential path from a request.
    from dotenv import dotenv_values
    config=dotenv_values("/etc/starlidigital/production.env")
    key=os.environ.get("OPENAI_API_KEY") or config.get("OPENAI_API_KEY")
    if not key:
        print(json.dumps({"configured":False,"error":"MANAGED_OPENAI_NOT_CONFIGURED"}));return
    hints=[]
    for candidate in (config.get("OPENAI_ENGINEERING_MODEL"),config.get("OPENAI_MODEL"),"gpt-5.4","gpt-5.3-codex","gpt-4.1"):
        if isinstance(candidate,str) and candidate and candidate not in hints:hints.append(candidate)
    home=Path(state or "/var/lib/starlidigital/webui/state")/"providers"/"managed-home";home.mkdir(parents=True,exist_ok=True,mode=0o700)
    bridge=Path(__file__).with_name("provider-runtime.mts")
    payload={"operation":"infer","provider":"openai","modelHints":hints,"credentials":{"openai":{"type":"api_key","key":key}},
             "prompt":request.get("prompt",""),"messages":request.get("messages",[]),"images":request.get("images",[]),
             "maxOutputTokens":request.get("maxOutputTokens",8192)}
    response=subprocess.run(["/opt/starlidigital/node/bin/node","--import","tsx",str(bridge)],input=json.dumps(payload).encode(),
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,cwd=str(bridge.parent),timeout=min(180,max(15,int(request.get("timeoutSeconds",120)))),
            env={"PATH":os.environ.get("PATH","/usr/bin:/bin"),"HOME":str(home),"LANG":"C.UTF-8"})
    if len(response.stdout)>2*1024*1024:raise RuntimeError("PROVIDER_OUTPUT_TOO_LARGE")
    events=[json.loads(line) for line in response.stdout.splitlines() if line.startswith(b"{")]
    result=events[-1] if events else {}
    if response.returncode or result.get("type")!="inference":
        print(json.dumps({"configured":True,"error":result.get("code","MANAGED_OPENAI_INFERENCE_FAILED"),"retryable":result.get("retryable",False)}));return
    print(json.dumps({"configured":True,"fallback":True,"transport":"MANAGED_OPENAI",**{k:result.get(k) for k in ("text","provider","model","usage")}}))
try:main()
except subprocess.TimeoutExpired:print(json.dumps({"configured":True,"error":"PROVIDER_TIMEOUT","retryable":True}))
except Exception:print(json.dumps({"configured":True,"error":"PROVIDER_INFERENCE_FAILED","retryable":False}))
