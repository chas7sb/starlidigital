"""Trusted model app compiler/process lifecycle. Generated server code is never imported."""
import asyncio,hashlib,json,os,secrets,signal,socket,time
from pathlib import Path
NODE="/opt/starlidigital/node/bin/node"
ROOT=Path(__file__).resolve().parent
def write_private(path,value):
    path=Path(path);path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+".tmp");temp.write_text(json.dumps(value));temp.chmod(0o600);temp.replace(path)
def process_start(pid):
    try:return Path("/proc/"+str(pid)+"/stat").read_text().split(") ",1)[1].split()[19]
    except FileNotFoundError:return None
class ModelAppLifecycle:
    def __init__(self,authority,*,parent_origin,authority_base_url,state_root,data_root):
        self.authority=authority;self.parent_origin=parent_origin;self.authority_base_url=authority_base_url
        self.state_root=Path(state_root).resolve();self.data_root=Path(data_root).resolve()
        self.state_root.mkdir(mode=0o700,parents=True,exist_ok=True);self.data_root.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.apps={}
        if os.getuid()!=997:raise ValueError("APP_HOST_UID997_REQUIRED")
    async def on_built(self,result,context):
        build_id=result["buildId"];directory=self.state_root/build_id;directory.mkdir(mode=0o700,exist_ok=True)
        compiler_input={**result,"execution":result,"outputDir":str(directory/"build")}
        write_private(directory/"compile-input.json",compiler_input)
        proc=await asyncio.create_subprocess_exec(NODE,"--max-old-space-size=256","--experimental-transform-types",str(ROOT/"native-build.mjs"),str(directory/"compile-input.json"),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,env={"PATH":"/usr/bin:/bin","TZ":"UTC"},start_new_session=True)
        try:output,error=await asyncio.wait_for(proc.communicate(),60)
        except BaseException:
            if proc.returncode is None:proc.kill();await proc.wait()
            raise
        if proc.returncode:
            error_path=directory/"compile.stderr";error_path.write_bytes(error);error_path.chmod(0o600)
            raise ValueError("MODEL_APP_COMPILE_FAILED")
        compiled=json.loads(output);receipt=compiled["receipt"]
        sock=socket.socket();sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);sock.bind(("127.0.0.1",0));sock.listen(128);port=sock.getsockname()[1];app_origin="http://127.0.0.1:"+str(port)
        lease="model-app:"+hashlib.sha256(build_id.encode()).hexdigest()[:40]
        registration=await asyncio.to_thread(self.authority.register_build,context,{"buildId":build_id,"artifactDigest":receipt["artifactDigest"],"leaseId":lease,"generation":1,"appOrigin":app_origin,"parentOrigin":self.parent_origin,"authorityBaseUrl":self.authority_base_url})
        key_path=directory/"authority.key";key_path.write_text(registration["authorityKey"]);key_path.chmod(0o600)
        config={"build":compiled["buildDir"],"buildId":build_id,"artifactDigest":receipt["artifactDigest"],"leaseId":lease,"generation":1,"authorityURL":registration["authorityURL"],"storageNamespace":registration["storageNamespace"],"parentOrigin":self.parent_origin,"dataRoot":str(self.data_root),"port":port,"instanceNonce":secrets.token_hex(16)}
        instance=await self.start(build_id,directory,config,key_path,sock)
        instance["context"]=context
        self.apps[build_id]=instance
        return {"artifactDigest":receipt["artifactDigest"],"modelCalls":2,"phase":"PRIVATE_APP_RUNNING","preview":self.preview(result["intentId"],instance),"sourceProvenance":{"graphId":result["graphId"],"sourceMessageId":result["sourceMessageId"],"workerOutputs":receipt["nativeProvenance"]["outputs"],"modelCalls":2,"generatedServerCodeExecuted":False}}
    async def start(self,build_id,directory,config,key_path,sock):
        config={**config,"listenFd":sock.fileno()};write_private(directory/"app-runtime.json",config)
        log=(directory/("app-"+config["instanceNonce"]+".stderr")).open("wb")
        proc=await asyncio.create_subprocess_exec(NODE,"--max-old-space-size=256","--experimental-transform-types",str(ROOT/"native-start.mjs"),"--config",str(directory/"app-runtime.json"),stdout=asyncio.subprocess.PIPE,stderr=log,env={"PATH":"/usr/bin:/bin","TZ":"UTC","STARLI_APP_AUTHORITY_KEY":key_path.read_text()},pass_fds=(sock.fileno(),),start_new_session=True)
        identity=process_start(proc.pid)
        try:
            line=await asyncio.wait_for(proc.stdout.readline(),15)
            if not line or proc.returncode is not None:raise ValueError("MODEL_APP_PROCESS_START_FAILED")
            ready=json.loads(line)
            if ready.get("pid")!=proc.pid or ready.get("instanceNonce")!=config["instanceNonce"] or ready.get("buildId")!=build_id or ready.get("artifactDigest")!=config["artifactDigest"]:raise ValueError("MODEL_APP_READY_IDENTITY_INVALID")
            instance={"proc":proc,"startTicks":identity,"ready":ready,"config":{k:v for k,v in config.items() if k!="listenFd"},"directory":directory,"keyPath":key_path,"log":log}
            write_private(directory/"app-process.json",{"pid":proc.pid,"startTicks":identity,"ready":ready,"config":instance["config"]})
            return instance
        except BaseException:
            if proc.returncode is None:proc.kill();await proc.wait()
            log.close();raise
        finally:sock.close()
    def preview(self,intent,instance):
        base=instance["ready"]["baseUrl"]
        return {"previewId":instance["config"]["buildId"],"previewUrl":base+"/","bootstrapUrl":base+"/api/app/session/bootstrap","ticketUrl":"/api/v1/starli/public/grokbot1/intents/"+intent+"/builds/"+instance["config"]["buildId"]+"/ticket","status":"READY","artifactDigest":instance["config"]["artifactDigest"],"leaseId":instance["config"]["leaseId"],"generation":instance["config"]["generation"]}
    async def stop_instance(self,instance):
        proc=instance["proc"];same=process_start(proc.pid)==instance["startTicks"]
        if same and proc.returncode is None:proc.terminate()
        try:await asyncio.wait_for(proc.wait(),5)
        except asyncio.TimeoutError:
            if process_start(proc.pid)==instance["startTicks"]:proc.kill()
            await proc.wait()
        instance["log"].close()
        return {"oldPid":proc.pid,"oldStartTicks":instance["startTicks"],"exitConfirmed":proc.returncode is not None,"pidIdentityGone":process_start(proc.pid)!=instance["startTicks"]}
    async def restart(self,build_id,context=None):
        instance=self.apps[build_id];context=context or instance.get("context")
        context.revalidate();config=instance["config"]
        before=instance["ready"];stopped=await self.stop_instance(instance)
        if not stopped["exitConfirmed"]:raise ValueError("APP_STOP_UNCONFIRMED")
        sock=socket.socket();sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);sock.bind(("127.0.0.1",config["port"]));sock.listen(128)
        config={**config,"instanceNonce":secrets.token_hex(16)}
        after=await self.start(build_id,instance["directory"],config,instance["keyPath"],sock);after["context"]=context;self.apps[build_id]=after
        return {"before":before,"after":after["ready"],"stop":stopped,"storageNamespaceUnchanged":before["storageNamespace"]==after["ready"]["storageNamespace"]}
    async def close(self):
        return await asyncio.gather(*(self.stop_instance(i) for i in self.apps.values()),return_exceptions=True)
