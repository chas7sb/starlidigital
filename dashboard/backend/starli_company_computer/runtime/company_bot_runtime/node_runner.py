import asyncio,hashlib,json,os
from pathlib import Path

SAFE_RPC_EXC_NAMES = frozenset({
    'Denied', 'ToolFault', 'MemoryFault', 'SocialFault',
    'ProfileError', 'GrantDenied', 'RelayError', 'PublisherDenied',
    'AttachmentStorageError',
})

SAFE_RPC_CODES = frozenset({
    'ACCESS_DENIED',
    'NATIVE_AUTHORITY_DENIED',
    'NATIVE_RUN_DENIED',
    'RUNTIME_RPC_UNAVAILABLE',
    'TURN_STOPPED',
    'TURN_CANCELLED',
    'ROOM_CONTEXT_CHANGED',
    'ROOM_NOT_FOUND',
    'ROOM_REVISION_CHANGED',
    'ROOM_TURN_ACTIVE',
    'AGENT_NOT_IN_ROOM',
    'AGENT_NOT_FOUND',
    'AGENT_DISPATCH_DENIED',
    'COMPANY_BOT_NOT_FOUND',
    'COMPANY_PERMISSION_DENIED',
    'COMPANY_AUTHORIZATION_DENIED',
    'COMPANY_CAPABILITY_DENIED',
    'COMPANY_BOT_DENIED',
    'COMPANY_SCOPE_INVALID',
    'COMPANY_SELECTION_REQUIRED',
    'COMPANY_SELECTION_CHANGED',
    'COMPANY_CONNECTION_UNAVAILABLE',
    'COMPANY_CREDENTIAL_REFRESH_DENIED',
    'COMPANY_CREDENTIAL_REFRESH_CONFLICT',
    'COMPANY_MODEL_UNSUPPORTED',
    'MODEL_UNSUPPORTED',
    'MEMBERSHIP_CHANGED',
    'AUDIENCE_CHANGED',
    'SESSION_EXPIRED',
    'SESSION_REVOKED',
    'NATIVE_JWT_REQUIRED',
    'NATIVE_JWT_INVALID',
    'REQUESTING_HUMAN_NOT_CURRENT',
    'SOURCE_MESSAGE_DENIED',
    'MODEL_OUTPUT_INVALID',
    'MODEL_OUTPUT_LIMIT',
    'VISION_RUN_REQUIRED',
    'VISION_SOURCE_DENIED',
    'VISION_ATTACHMENT_UNSUPPORTED',
    'VISION_ACCESS_DENIED',
    'VISION_BOTS_REQUIRED',
    'MODEL_DOES_NOT_SUPPORT_IMAGES',
    'IMAGE_ATTACHMENT_LIMIT',
    'IMAGE_ATTACHMENT_UNSUPPORTED',
    'IMAGE_ATTACHMENT_INVALID',
    'COMPANY_ATTACHMENT_DENIED',
    'COMPANY_ATTACHMENT_BINDING_REQUIRED',
    'COMPANY_ATTACHMENT_TRANSACTION_REQUIRED',
    'COMPANY_ATTACHMENT_DATABASE_MISMATCH',
    'ATTACHMENT_DENIED',
    'MEMORY_SCOPE_CHANGED',
    'MEMORY_RUN_SCOPE_CHANGED',
    'MEMORY_RUN_UNAVAILABLE',
    'MEMORY_AUDIENCE_DENIED',
    'MEMORY_PRIVATE_AUDIENCE_REQUIRED',
    'MEMORY_INVALID_CONTEXT',
    'MEMORY_STORAGE_UNAVAILABLE',
    'MEMORY_STORAGE_FULL',
    'MEMORY_NOT_FOUND',
    'MEMORY_CONFLICT',
    'MEMORY_CONTENT_INVALID',
    'MEMORY_PATH_INVALID',
    'MEMORY_UNSAFE_PATH',
    'MEMORY_TOOL_UNAVAILABLE',
    'MEMORY_TOOL_ARGUMENTS_INVALID',
    'MEMORY_TOOL_BINDING_INVALID',
    'MEMORY_TOOL_ID_REUSED',
    'AGENT_PROFILE_CHANGED',
    'AGENT_PROFILE_INVALID',
    'AGENT_PROFILE_UNAVAILABLE',
    'DELEGATION_PARENT_STOPPED',
    'DELEGATION_RUN_REVOKED',
    'DELEGATION_DEPTH_LIMIT',
    'DELEGATION_TURN_LIMIT',
    'DELEGATION_NO_REPLAY',
    'DELEGATION_DISPATCH_DENIED',
    'DELEGATION_BOT_IDENTITY_CHANGED',
    'DELEGATION_ROOM_CHANGED',
    'DELEGATION_BOT_BUSY',
    'DELEGATION_SELF_DENIED',
    'OUTREACH_NATIVE_JWT_REQUIRED',
    'OUTREACH_SCOPE_CHANGED',
    'OUTREACH_POLICY_DENIED',
    'OUTREACH_RUN_REVOKED',
    'CHANNEL_SOURCE_SCOPE_CHANGED',
    'CHANNEL_ACTOR_CHANGED',
    'CHANNEL_RUN_REVOKED',
    'CHANNEL_BOT_DISPATCH_DENIED',
    'COMPANY_CHANNEL_NOT_FOUND',
    'CHANNEL_CALL_CONFLICT',
    'CHANNEL_DIRECTORY_PAGINATION_REQUIRED',
    'ACTION_MESSAGE_CHANGED',
    'ACTION_RECEIPT_NOT_FOUND',
    'RECIPIENT_AMBIGUOUS',
    'RECIPIENT_CHANGED',
    'DIRECTORY_PAGINATION_REQUIRED',
    'NATIVE_AUTHORITY_SCHEMA_REQUIRED',
    'NATIVE_HUMAN_DIRECTORY_REQUIRED',
    'COMPANY_TOOL_UNAVAILABLE',
    'COMPANY_TOOL_ACCESS_DENIED',
    'COMPANY_TOOL_ARGUMENTS_INVALID',
    'COMPANY_TOOL_AUDIENCE_CHANGED',
    'COMPANY_TOOL_BACKING_SERVICE_UNAVAILABLE',
    'COMPANY_TOOL_BINDING_INVALID',
    'COMPANY_TOOL_BOT_REMOVED',
    'COMPANY_TOOL_CALL_COLLISION',
    'COMPANY_TOOL_CONFIGURATION_CHANGED',
    'COMPANY_TOOL_CONTEXT_CHANGED',
    'COMPANY_TOOL_EVENT_INVALID',
    'COMPANY_TOOL_FILE_LIMIT',
    'COMPANY_TOOL_MEMBERSHIP_CHANGED',
    'COMPANY_TOOL_REGISTRATION_INVALID',
    'COMPANY_TOOL_RESOURCE_AUDIENCE_DENIED',
    'COMPANY_TOOL_RESOURCE_COLLISION',
    'COMPANY_TOOL_RESOURCE_KIND_DENIED',
    'COMPANY_TOOL_RESULT_LIMIT',
    'COMPANY_TOOL_REVISION_CONFLICT',
    'COMPANY_TOOL_RUN_REVOKED',
    'COMPANY_TOOL_SESSION_REVOKED',
    'COMPANY_TOOL_SUCCESS_WITHOUT_RECEIPT',
    'COMPANY_TOOL_UNCERTAIN_NO_RETRY',
    'NATIVE_TOOL_SCOPE_REQUIRED',
    'NATIVE_TOOL_SCOPE_MISMATCH',
})


def safe_rpc_code(exc, default='NATIVE_AUTHORITY_DENIED'):
    if isinstance(exc, str):
        return exc if exc in SAFE_RPC_CODES else default
    if exc.__class__.__name__ not in SAFE_RPC_EXC_NAMES:
        return default
    code = getattr(exc, 'code', None)
    if not isinstance(code, str) and len(getattr(exc, 'args', ())) == 1 and isinstance(exc.args[0], str):
        code = exc.args[0]
    return code if isinstance(code, str) and code in SAFE_RPC_CODES else default


class NodeRunner:
    def __init__(self,node,worker,profile,profile_sha256, *, timeout_seconds=30, child_environment=None):
        self.node=node;self.worker=str(worker);self.profile=str(profile);self.pin=profile_sha256
        self.timeout_seconds = timeout_seconds
        self.child_environment = None if child_environment is None else dict(child_environment)

    async def run(self,selection,prompt,history,rpc,event):
        if hashlib.sha256(Path(self.profile).read_bytes()).hexdigest()!=self.pin:raise RuntimeError('PROVIDER_PROFILE_CHANGED')
        if self.child_environment is None:
            environment = dict(os.environ)
        else:
            environment = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SSL_CERT_FILE') if k in os.environ}
            environment.update(self.child_environment)
        environment['STARLI_COMPANY_TURN_MILLIS'] = str(max(1, self.timeout_seconds - 5) * 1000)
        process=await asyncio.create_subprocess_exec(self.node,self.worker,self.profile,env=environment,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,limit=262144)
        async def send(value):
            process.stdin.write((json.dumps(value,allow_nan=False)+'\n').encode());await process.stdin.drain()
        try:
            await send({'selection':selection,'prompt':prompt,'history':history})
            async with asyncio.timeout(self.timeout_seconds):
                while True:
                    line=await process.stdout.readline()
                    if not line:raise RuntimeError('NATIVE_WORKER_DISCONNECTED')
                    item=json.loads(line)
                    if item.get('type')=='rpc':
                        try:await send({'id':item['id'],'ok':True,'result':await rpc(item['operation'],item.get('value',{}))})
                        except asyncio.CancelledError:raise
                        except Exception as exc:await send({'id':item['id'],'ok':False,'code':safe_rpc_code(exc)})
                    elif item.get('type')=='event':await event(item['event'])
                    elif item.get('type')=='done':return item['result']
                    elif item.get('type')=='error':raise RuntimeError(item.get('code','NATIVE_WORKER_FAILED'))
                    else:raise RuntimeError('NATIVE_WORKER_PROTOCOL_INVALID')
        finally:
            if process.returncode is None:
                process.terminate()
                try:await asyncio.wait_for(process.wait(),2)
                except asyncio.TimeoutError:process.kill();await process.wait()
