"""Native Pi integration boundary, schema starli.research.v1.

Import from trusted backend only. serverScope MUST derive from captured native
run identity; authorize is the host's fresh principal/bot/run capability check.
The backend owns durable cross-worker concurrency leases and existing safe events.
No guest registration is provided. No model call or additional agent loop.
"""
import asyncio
import inspect
import json
import os
import signal as signals
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NODE = "/usr/bin/node"
SCHEMA_VERSION = "starli.research.v1"


class ResearchError(Exception):
    pass


async def _settle(task, propagate=False):
    """Complete physical cleanup even if Stop is requested repeatedly."""
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
            continue
    result = task.result()
    if cancelled and propagate:
        raise asyncio.CancelledError()
    return result


async def dispatch(user, serverScope, name, args, callId, authorize, cancel=None, *, child_setup=None, launcher=None):
    """cancel: optional asyncio.Event; task cancellation also kills/reaps the child.

    serverScope fields: accountId, botId, runId, origin, protectedAddresses.
    authorize(user, serverScope, name, callId) must return literal True.
    Returns private tool evidence, never a public activity DTO.
    """
    async def admitted():
        if cancel is not None and cancel.is_set():
            raise asyncio.CancelledError()
        allowed = authorize(user, serverScope, name, callId)
        if inspect.isawaitable(allowed):
            allowed = await allowed
        if allowed is not True:
            raise ResearchError("SCOPE_DENIED")

    if name not in ("web_search", "web_fetch") or not isinstance(callId, str) or not callId:
        raise ResearchError("TOOL_INVALID")
    uid = user.get("id") if isinstance(user, dict) else getattr(user, "id", None)
    if not uid or str(uid) != serverScope.get("accountId"):
        raise ResearchError("SCOPE_DENIED")
    if not all(isinstance(serverScope.get(k), str) and serverScope[k] for k in ("accountId", "botId", "runId")):
        raise ResearchError("SCOPE_REQUIRED")
    await admitted()
    if not callable(child_setup):
        raise ResearchError("SEARCH_CHILD_PROFILE_UNAVAILABLE")
    launch = child_setup()
    if inspect.isawaitable(launch):
        launch = await launch
    await admitted()  # Async profile preparation cannot preserve an old Stop/session grant.
    if not isinstance(launch, dict) or set(launch) not in ({"preexec_fn","env"},{"argv_prefix","env"},{"env"}):
        raise ResearchError("SEARCH_CHILD_PROFILE_INVALID")
    child_kwargs={}
    prefix=[]
    broker=launcher is not None
    if broker:
        if getattr(launcher,"available",False) is not True or not callable(getattr(launcher,"launch",None)):raise ResearchError("SEARCH_CHILD_PROFILE_UNAVAILABLE")
    elif "preexec_fn" in launch:
        if not callable(launch["preexec_fn"]):raise ResearchError("SEARCH_CHILD_PROFILE_INVALID")
        child_kwargs["preexec_fn"]=launch["preexec_fn"]
    else:
        prefix=launch.get("argv_prefix")
        if not isinstance(prefix,(list,tuple)) or not prefix or len(prefix)>12 or not all(isinstance(x,str) and x and len(x)<=2048 and "\n" not in x and "\x00" not in x for x in prefix) or not Path(prefix[0]).is_absolute():
            raise ResearchError("SEARCH_CHILD_PROFILE_INVALID")
    env=launch["env"]
    if not isinstance(env, dict) or set(env)-{"PATH","LANG","HOME","NODE_OPTIONS","STARLI_SEARCH_PROTECTED_IPV4"} or env.get("PATH")!="/usr/bin:/bin" or env.get("HOME")!="/nonexistent":
        raise ResearchError("SEARCH_CHILD_PROFILE_INVALID")
    envelope = json.dumps({"origin":serverScope["origin"], "protectedAddresses":serverScope["protectedAddresses"],
                           "name":name, "args":args, "scope":{k:serverScope[k] for k in ("accountId","botId","runId")}}).encode()
    if len(envelope) > 16384:
        raise ResearchError("ARGUMENTS_TOO_LARGE")
    proc = None
    communication = watcher = None
    try:
        await admitted()
        argv=(NODE,"--max-old-space-size=96",str(ROOT/"research-cli.mjs"))
        if broker:
            spawning=asyncio.create_task(launcher.launch(argv,cwd=str(ROOT),env=env,limits={"memoryBytes":268435456,"cpuSeconds":10,"wallSeconds":18,"openFiles":64,"processes":16,"stdoutBytes":131072}))
        else:
            spawning=asyncio.create_task(asyncio.create_subprocess_exec(*prefix,*argv,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,env=env,**child_kwargs,cwd=ROOT,start_new_session=True,limit=131072))
        try:
            proc = await asyncio.shield(spawning)
        except asyncio.CancelledError:
            proc = await _settle(spawning)
            raise
        async def communicate():
            if broker and (not callable(getattr(proc,"terminate_group",None)) or not callable(getattr(proc,"kill_group",None))):raise ResearchError("SEARCH_BROKER_PROCESS_INVALID")
            proc.stdin.write(envelope);await proc.stdin.drain();proc.stdin.close()
            raw=bytearray()
            while True:
                chunk=await proc.stdout.read(8192)
                if not chunk:break
                if len(raw)+len(chunk)>131072:raise ResearchError("OUTPUT_LIMIT")
                raw.extend(chunk)
            await proc.wait() # Broker wait means physical root-owned cgroup ACK, not bridge exit.
            return bytes(raw),None
        communication = asyncio.create_task(communicate())
        watcher = asyncio.create_task(cancel.wait()) if cancel is not None else None
        done, _ = await asyncio.wait([communication] + ([watcher] if watcher else []), timeout=18, return_when=asyncio.FIRST_COMPLETED)
        if watcher and watcher in done:
            raise asyncio.CancelledError()
        if communication not in done:
            raise ResearchError("RESEARCH_TIMEOUT")
        raw, _ = await communication
        if len(raw) > 131072:
            raise ResearchError("OUTPUT_LIMIT")
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeError):
            raise ResearchError("RESEARCH_RESPONSE_INVALID") from None
        if proc.returncode != 0 or data.get("ok") is not True:
            code = data.get("code", "RESEARCH_FAILED")
            raise ResearchError(code if isinstance(code, str) and code.isupper() and len(code) <= 64 else "RESEARCH_FAILED")
        await admitted()
        return data["result"]
    finally:
        # Physically settle the whole process group before returning/raising.
        async def terminate():
            if proc is None:return
            if broker:
                if not callable(getattr(proc,"terminate_group",None)) or not callable(getattr(proc,"kill_group",None)):raise ResearchError("SEARCH_STOP_UNCONFIRMED")
                if proc.returncode is None:
                    result=proc.terminate_group()
                    if inspect.isawaitable(result):await result
                    try:await asyncio.wait_for(proc.wait(),2)
                    except asyncio.TimeoutError:
                        result=proc.kill_group()
                        if inspect.isawaitable(result):await result
                        await proc.wait()
                else:await proc.wait()
                if proc.returncode is None:raise ResearchError("SEARCH_STOP_UNCONFIRMED")
            elif proc.returncode is None:
                try:os.killpg(proc.pid,signals.SIGTERM)
                except ProcessLookupError:pass
                try:await asyncio.wait_for(proc.wait(),2)
                except asyncio.TimeoutError:
                    try:os.killpg(proc.pid,signals.SIGKILL)
                    except ProcessLookupError:pass
                    await proc.wait()
        try:
            try:await _settle(asyncio.create_task(terminate()), propagate=True)
            except asyncio.CancelledError:raise
            except Exception:raise ResearchError("SEARCH_STOP_UNCONFIRMED") from None
        finally:
            for task in (communication,watcher):
                if task is not None and not task.done():
                    task.cancel()
                    try:await task
                    except BaseException:pass
