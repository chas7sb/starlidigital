#!/usr/bin/env python3
"""Bounded staged service composition. Never substitutes fixture services."""
import uuid
import argparse,contextlib,fcntl,http.client,http.server,json,os,signal,socket,subprocess,threading,time,urllib.request
from pathlib import Path
def start_identity(pid):
 try:return Path(f"/proc/{pid}/stat").read_text().split(") ",1)[1].split()[19]
 except FileNotFoundError:return None
def group_members(group):
 result=[]
 for entry in Path("/proc").iterdir():
  if not entry.name.isdigit():continue
  try:
   fields=(entry/"stat").read_text().split(") ",1)[1].split()
   if int(fields[2])==group:result.append((int(entry.name),fields[19]))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
 return result
def descendants(root):
 parents={};identities={}
 for entry in Path("/proc").iterdir():
  if not entry.name.isdigit():continue
  try:
   f=(entry/"stat").read_text().split(") ",1)[1].split()
   parents.setdefault(int(f[1]),[]).append(int(entry.name));identities[int(entry.name)]=f[19]
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
 found=[];pending=[root]
 while pending:
  for pid in parents.get(pending.pop(),[]):found.append((pid,identities[pid]));pending.append(pid)
 return found
def cleanup(children):
 receipts=[]
 for proc,identity in reversed(children):
  members=list(set(group_members(proc.pid)+descendants(proc.pid)))
  if start_identity(proc.pid) not in (None,identity):continue
  for pid,st in members:
   if start_identity(pid)==st:
    try:os.kill(pid,signal.SIGTERM)
    except ProcessLookupError:pass
  deadline=time.monotonic()+2
  while time.monotonic()<deadline and any(start_identity(pid)==st for pid,st in members):time.sleep(.05)
  for pid,st in members:
   if start_identity(pid)==st:
    try:os.kill(pid,signal.SIGKILL)
    except ProcessLookupError:pass
  try:proc.wait(timeout=1)
  except subprocess.TimeoutExpired:pass
  receipts.append({"group":proc.pid,"trackedMembers":len(members)})
 return receipts
def minimal_env(extra=None, app=False):
 allowed=("PATH","LANG","LC_ALL","TZ","TMPDIR")
 env={k:os.environ[k] for k in allowed if k in os.environ}
 env.setdefault("PATH","/usr/local/bin:/usr/bin:/bin")
 extra=extra or {}
 if app and any(any(w in k.upper() for w in ("JWT","MASTER","WEBUI","NATIVE","PLATFORM")) for k in extra):
  raise ValueError("PRIVILEGED_APP_ENVIRONMENT")
 env.update(extra)
 return env
def ready(url,deadline,proc=None,expected=None):
 while time.monotonic()<deadline:
  if proc is not None and proc.poll() is not None:raise RuntimeError("SERVICE_EXITED_BEFORE_READY")
  try:
   with urllib.request.urlopen(url,timeout=1) as r:
    data=json.load(r)
    if r.status==200 and (not expected or all(data.get(k)==v for k,v in expected.items())):
     if proc is not None and proc.poll() is not None:raise RuntimeError("SERVICE_EXITED_BEFORE_READY")
     return
  except RuntimeError:raise
  except Exception:pass
  time.sleep(.1)
 raise RuntimeError("SERVICE_STARTUP_TIMEOUT")
def run(config,output,total=180):
 out=Path(output).resolve()
 for frozen in config.get("frozenInputs",[]):
  source=Path(frozen).resolve()
  if out==source or source in out.parents:raise ValueError("OUTPUT_INSIDE_FROZEN_SOURCE")
 out.mkdir(parents=True,exist_ok=True)
 children=[];logs=[];started=time.monotonic();deadline=started+total
 lock=open(config["lockFile"],"a+");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 try:
  for name,s in config["services"].items():
   if s.get("executionClass") not in ("NATIVE_NONPRODUCTION","ACTUAL_APP_PROCESS"):raise ValueError("FIXTURE_OR_UNCLASSIFIED_SERVICE")
   log=open(out/(name+".log"),"w");logs.append(log)
   service_env=dict(s.get("env",{}))
   nonce=uuid.uuid4().hex
   service_env["STARLI_INSTANCE_NONCE"]=nonce
   proc=subprocess.Popen(s["argv"],cwd=s["cwd"],env=minimal_env(service_env,s.get("executionClass")=="ACTUAL_APP_PROCESS"),stdout=log,stderr=log,start_new_session=True)
   children.append((proc,start_identity(proc.pid)))
   expected={**s.get("healthBinding",{}),"instanceNonce":nonce,"pid":proc.pid}
   if not expected:raise ValueError("UNIQUE_HEALTH_BINDING_REQUIRED")
   ready(s["healthUrl"],min(deadline,time.monotonic()+s.get("startupSeconds",20)),proc,expected)
   private=out/"private";private.mkdir(mode=0o700,exist_ok=True)
   pin=private/("service-"+name+".json");pin.write_text(json.dumps(expected));pin.chmod(0o600)
  routes=sorted(config["routes"],key=lambda x:len(x["prefix"]),reverse=True)
  class Proxy(http.server.BaseHTTPRequestHandler):
   def route(self):
    route=next((x for x in routes if self.path.startswith(x["prefix"])),None)
    if not route:self.send_error(404);return
    target=config["services"][route["service"]]
    from urllib.parse import urlsplit
    u=urlsplit(target["origin"]);conn=http.client.HTTPConnection(u.hostname,u.port,timeout=15)
    headers={k:v for k,v in self.headers.items() if k.lower() not in ("host","connection","transfer-encoding")}
    body=self.rfile.read(int(self.headers.get("Content-Length","0")))
    try:
     conn.request(self.command,self.path,body,headers);r=conn.getresponse();data=r.read()
     self.send_response(r.status)
     for k,v in r.getheaders():
      if k.lower() not in ("connection","transfer-encoding","content-length"):self.send_header(k,v)
     self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data)
    finally:conn.close()
   do_GET=do_POST=do_PATCH=do_DELETE=do_PUT=do_OPTIONS=route
   def log_message(self,*args):pass
  server=http.server.ThreadingHTTPServer(("127.0.0.1",config.get("proxyPort",0)),Proxy)
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   env=minimal_env({**config.get("acceptanceEnv",{}),"STARLI_JOINED_ORIGIN":f"http://127.0.0.1:{server.server_port}","STARLI_JOINED_OUTPUT":str(out),"STARLI_JOINED_SUPERVISOR_CONFIG":config.get("_privateSourcePath",""),"STARLI_BROWSER_OBSERVATIONS_FILE":str(out/"private/browser-observations.json"),"STARLI_BROWSER_SESSION_CAPABILITIES_FILE":str(out/"private/browser-session-capabilities.json")})
   accept=subprocess.Popen(config["acceptanceArgv"],env=env,cwd=config["acceptanceCwd"],start_new_session=True)
   children.append((accept,start_identity(accept.pid)))
   accept.wait(timeout=max(1,deadline-time.monotonic()))
   result=accept
   if result.returncode:raise RuntimeError("ACCEPTANCE_FAILED")
  finally:server.shutdown();server.server_close()
  receipt={"executionClass":"JOINED_STAGED_SERVICES","acceptanceExitCode":0,"services":list(config["services"]),"productionReady":False}
  (out/"supervisor-receipt.json").write_text(json.dumps(receipt,indent=2))
 finally:
  receipt=cleanup(children)
  (out/"cleanup-receipt.json").write_text(json.dumps(receipt))
  for log in logs:log.close()
  lock.close()
if __name__=="__main__":
 a=argparse.ArgumentParser();a.add_argument("--config",required=True);a.add_argument("--output",required=True);a.add_argument("--timeout",type=int,default=180);v=a.parse_args()
 configuration=json.loads(Path(v.config).read_text());configuration["_privateSourcePath"]=str(Path(v.config).resolve())
 run(configuration,v.output,v.timeout)
