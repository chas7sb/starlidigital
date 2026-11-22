"""Loopback private coordinator process controls; never user/browser authorization."""
import asyncio,hmac,os,secrets,stat
from pathlib import Path
from fastapi import Request,HTTPException
from model_app_lifecycle import process_start
def install_model_app_control(app,svc,lifecycle):
    key_file=Path(svc.p.root)/".model-app-control.key"
    if not key_file.exists():
        fd=os.open(key_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,"w") as f:f.write(secrets.token_urlsafe(40))
    info=key_file.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=997 or info.st_mode&0o077:raise ValueError("PRIVATE_CONTROL_KEY_PERMISSIONS")
    key=key_file.read_text();nonce=secrets.token_hex(16);locks={}
    def auth(request,mutation=False):
        if request.client is None or request.client.host not in {"127.0.0.1","::1"} or not hmac.compare_digest(request.headers.get("x-starli-model-control",""),key):raise HTTPException(403,"PRIVATE_CONTROL_DENIED")
        if mutation and request.headers.get("x-starli-control-instance")!=nonce:raise HTTPException(409,"CONTROL_INSTANCE_CHANGED")
    @app.get("/internal/v1/model-app-control/instance")
    def instance(request:Request):
        auth(request);return {"pid":os.getpid(),"instanceNonce":nonce,"scope":"PRIVATE_COORDINATOR_ONLY"}
    @app.get("/internal/v1/model-app-control/{build}/snapshot")
    def snapshot(build:str,request:Request):
        auth(request);i=lifecycle.apps.get(build)
        if not i:raise HTTPException(404,"APP_INSTANCE_NOT_FOUND")
        return {"buildId":build,"appPid":i["proc"].pid,"startTicks":i["startTicks"],"available":i["proc"].returncode is None and process_start(i["proc"].pid)==i["startTicks"],"ready":i["ready"],"artifactDigest":i["config"]["artifactDigest"]}
    @app.post("/internal/v1/model-app-control/{build}/restart")
    async def restart(build:str,request:Request):
        auth(request,True)
        if await request.json()!={}:raise HTTPException(422,"EMPTY_CONTROL_BODY_REQUIRED")
        if build not in lifecycle.apps:raise HTTPException(404,"APP_INSTANCE_NOT_FOUND")
        async with locks.setdefault(build,asyncio.Lock()):
            return {"controlScope":"INDEPENDENT_COORDINATOR_APP_PROCESS_RESTART","result":await lifecycle.restart(build)}
    return {"keyFile":str(key_file),"instance":"/internal/v1/model-app-control/instance","snapshot":"/internal/v1/model-app-control/{build}/snapshot","restart":"/internal/v1/model-app-control/{build}/restart"}
