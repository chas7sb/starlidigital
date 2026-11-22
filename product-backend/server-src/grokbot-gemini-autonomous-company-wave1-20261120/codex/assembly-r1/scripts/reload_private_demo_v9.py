"""Bounded companion reload of native/static only; private controller/app retained."""
import fcntl,hashlib,importlib.util,json,os,signal,subprocess,time,urllib.request,uuid
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]
ASSEMBLY=BASE/"assembly-r1"
DEMO=BASE/"runtime-private-demo-r2"
def read(p):return json.loads(Path(p).read_text())
def write(p,value):
    p=Path(p);temp=p.with_suffix(p.suffix+".tmp");temp.write_text(json.dumps(value,indent=2));temp.chmod(0o600);temp.replace(p)
def interrupted(signum,frame):raise InterruptedError("SCOPED_RELOAD_SHUTDOWN")
def main():
    signal.signal(signal.SIGTERM,interrupted)
    signal.signal(signal.SIGINT,interrupted)
    if os.getuid()!=997:raise RuntimeError("UID997_REQUIRED")
    lock=(DEMO/"reload.lock").open("a+");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    spec=importlib.util.spec_from_file_location("demo_supervisor",DEMO/"demo_supervisor.py");s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
    owner=read(DEMO/"ownership.json");supervisor=owner["supervisor"]
    if s.start_identity(supervisor["pid"])!=supervisor["startTicks"]:raise RuntimeError("DEMO_OWNER_CHANGED")
    if time.time()>=owner["expiresAtEpoch"]-120:raise RuntimeError("DEMO_EXPIRY_TOO_NEAR")
    config=read(DEMO/"supervisor.private.json")
    receipt=read(ASSEMBLY/"next-v9/BUILD-V9-RECEIPT.json")
    build=Path(receipt["output"])
    for name,sha in receipt["artifacts"].items():
        if hashlib.sha256((build/name).read_bytes()).hexdigest()!=sha:raise RuntimeError("V9_BUILD_HASH_CHANGED")
    startup=open(config["lockFile"],"a+");fcntl.flock(startup,fcntl.LOCK_EX|fcntl.LOCK_NB)
    replacements=[];logs=[]
    try:
        for name in ("native","frontend"):
            service=config["services"][name]
            pin=read(DEMO/"output"/"private"/("service-"+name+".json"))
            pid=pin["pid"]
            identity=s.start_identity(pid)
            # Previous orderly companion shutdown may already have reaped the owned child.
            # No process is signalled without a live nonce+UID match.
            if identity is not None:
                with urllib.request.urlopen(service["healthUrl"],timeout=3) as response:actual=json.load(response)
                if any(actual.get(k)!=v for k,v in pin.items()):raise RuntimeError("SERVICE_NONCE_CHANGED")
                if Path("/proc/"+str(pid)).stat().st_uid!=997:raise RuntimeError("SERVICE_UID_CHANGED")
                class Existing:
                    def __init__(self,pid):self.pid=pid
                    def wait(self,timeout=1):return None
                stopped=s.cleanup([(Existing(pid),identity)])
            if name=="native":
                service["argv"][1]=str(ASSEMBLY/"scripts/start_native_chat.py")
                service.setdefault("env",{})["STARLI_PRIVATE_OPENROUTER_KEY_FILE"]="/run/starlidigital-private-demo-r2/openrouter.key"
            else:
                service["argv"][service["argv"].index("--build")+1]=str(build)
            nonce=uuid.uuid4().hex;env=dict(service.get("env",{}));env["STARLI_INSTANCE_NONCE"]=nonce
            log=(DEMO/("reload-v9-"+name+".log")).open("wb");logs.append(log)
            proc=subprocess.Popen(service["argv"],cwd=service["cwd"],env=s.minimal_env(env,name=="frontend"),stdout=log,stderr=log,start_new_session=True)
            replacements.append((proc,s.start_identity(proc.pid)))
            expected={**service.get("healthBinding",{}),"instanceNonce":nonce,"pid":proc.pid}
            s.ready(service["healthUrl"],time.monotonic()+45,proc,expected)
            write(DEMO/"output"/"private"/("service-"+name+".json"),expected)
        write(DEMO/"supervisor-v8.private.json",config)
        write(DEMO/"RELOAD-V9-RECEIPT.json",dict(status="READY",supervisor=supervisor,
             replacements=[dict(pid=p.pid,startTicks=st) for p,st in replacements],
             expiresAtEpoch=owner["expiresAtEpoch"],controllerAndAppPreserved=True,nativeRoot=owner["nativeRoot"],
             frontendArtifactCount=len(receipt["artifacts"]),productionChanged=False))
        fcntl.flock(startup,fcntl.LOCK_UN)
        while time.time()<owner["expiresAtEpoch"] and s.start_identity(supervisor["pid"])==supervisor["startTicks"]:
            if any(p.poll() is not None for p,_ in replacements):raise RuntimeError("REPLACEMENT_EXITED")
            time.sleep(.5)
    finally:
        write(DEMO/"RELOAD-V9-CLEANUP.json",{"services":s.cleanup(replacements),"observedAt":time.time()})
        for log in logs:log.close()
        startup.close();lock.close()
if __name__=="__main__":main()
