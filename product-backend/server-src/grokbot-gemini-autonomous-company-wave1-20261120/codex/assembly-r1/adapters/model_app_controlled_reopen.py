"""Explicit operator reopening of the exact accepted app; never GET/autorecovery."""
import asyncio,hashlib,hmac,json,os,socket
from pathlib import Path
from contextlib import closing
ROOT=Path(__file__).resolve().parents[2]
BUILD="build-39c34ac2e224c60aa2e5ca3d018f0cab68eed3bc"
ARTIFACT="fffd714263b18337d71256455bf93afb249d8846778fcb016906c30bdf322ffb"
def private_json(path):
 if path.is_symlink() or path.stat().st_uid!=997 or path.stat().st_mode&0o077:raise ValueError("PRIVATE_REOPEN_METADATA_REQUIRED")
 return json.loads(path.read_text())
async def reopen_existing(lifecycle,svc,authority,builds,build_id,context):
 if os.getuid()!=997 or build_id!=BUILD or build_id in lifecycle.apps:raise ValueError("EXACT_CLOSED_APP_REQUIRED")
 snapshot=context.revalidate();directory=Path(svc.p.root).resolve()/"model-app-state"/build_id
 marker=private_json(directory/"app-process.json");config=private_json(directory/"app-runtime.json")
 old_pid=marker["pid"];old_ticks=marker["startTicks"]
 if Path("/proc",str(old_pid)).exists():raise ValueError("PRIOR_APP_PID_NOT_ABSENT")
 if old_pid!=3487637 or old_ticks!="346323337":raise ValueError("EXACT_PRIOR_PROCESS_REQUIRED")
 if config["buildId"]!=BUILD or config["artifactDigest"]!=ARTIFACT or config["port"]!=41079 or config["parentOrigin"]!=lifecycle.parent_origin:raise ValueError("REOPEN_CONFIG_BINDING_MISMATCH")
 if Path(config["build"]).resolve()!=directory/"build-r2" or Path(config["dataRoot"]).resolve()!=lifecycle.data_root:raise ValueError("REOPEN_PATH_MISMATCH")
 if config["instanceNonce"]!=marker["ready"]["instanceNonce"] or marker["ready"]["baseUrl"]!="http://127.0.0.1:41079":raise ValueError("REOPEN_READY_BINDING_MISMATCH")
 def current_authority():
  fresh=context.revalidate()
  with closing(authority.db()) as db:
   row=authority.build(db,BUILD)
   expected={"intent":fresh["intentId"],"binding":fresh["guestBinding"],"company":fresh["companyId"],"project":fresh["projectId"],"artifact":ARTIFACT,"lease":config["leaseId"],"generation":str(config["generation"]),"app_origin":"http://127.0.0.1:41079","parent_origin":lifecycle.parent_origin,"storage_namespace":config["storageNamespace"]}
   if any(row[k]!=v for k,v in expected.items()):raise ValueError("REOPEN_CANONICAL_AUTHORITY_MISMATCH")
   key_path=directory/"authority.key"
   if key_path.is_symlink() or key_path.stat().st_uid!=997 or key_path.stat().st_mode&0o077:raise ValueError("REOPEN_KEY_PERMISSIONS")
   if not hmac.compare_digest(hashlib.sha256(key_path.read_bytes()).hexdigest(),row["key_hash"]):raise ValueError("REOPEN_KEY_MISMATCH")
   authority.actor(db,row,"GUEST_TEMPORARY","guest:"+hashlib.sha256(fresh["guestBinding"].encode()).hexdigest()[:32])
  return fresh
 current_authority()
 verifier=ROOT/"assembly-r1/nov22-controls-r1/verify-existing-reopen.mjs"
 proc=await asyncio.create_subprocess_exec("/opt/starlidigital/node/bin/node","--experimental-transform-types",str(verifier),str(directory/"compile-input-r2.json"),cwd="/tmp",env={"PATH":"/usr/bin:/bin"},stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
 try:out,err=await asyncio.wait_for(proc.communicate(),30)
 except BaseException:
  proc.kill();await proc.wait();raise
 if proc.returncode or json.loads(out)["artifactDigest"]!=ARTIFACT:raise ValueError("REOPEN_ARTIFACT_VERIFICATION_FAILED")
 current_authority()
 for source,name in [(directory/"app-process.json","reopen-prior-app-process.json"),(directory/"app-runtime.json","reopen-prior-app-runtime.json")]:
  with os.fdopen(os.open(directory/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as archive:archive.write(source.read_bytes())
 sock=socket.socket();sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 try:
  sock.bind(("127.0.0.1",41079));sock.listen(128)
  # A new PID/nonce, immutable existing authority generation/lease/storage.
  import secrets
  config={**config,"instanceNonce":secrets.token_hex(16)};config.pop("listenFd",None)
  instance=await lifecycle.start(BUILD,directory,config,directory/"authority.key",sock)
  instance["context"]=context;lifecycle.apps[BUILD]=instance
  try:current_authority()
  except BaseException:
   lifecycle.apps.pop(BUILD,None);await lifecycle.stop_instance(instance);raise
 except BaseException:
  sock.close();raise
 return {"scope":"EXPLICIT_OPERATOR_EXISTING_APP_REOPEN","buildId":BUILD,"artifactDigest":ARTIFACT,"oldPid":old_pid,"oldStartTicks":old_ticks,"oldPidAbsent":True,"newPid":instance["proc"].pid,"newStartTicks":instance["startTicks"],"appOrigin":"http://127.0.0.1:41079","storageNamespaceUnchanged":True,"leaseAndGenerationUnchanged":True,"newModelCalls":0,"newWorkerDispatches":0,"recompiled":False}
