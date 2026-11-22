"""Explicit source-guarded additive patch for candidate authority.py only."""
import hashlib,pathlib,os,tempfile
AUTHORITY_SHA='97594ca4d478bbd36581b99b9503ee722933a22a42356dfcbef73820c9eee0a5'
RUNTIME_SHA='b64308b9961da3aa6e83e6b6c8c2f79694faae7d8173ea4f3172b16bc6575ed1'
def patched(raw):
 if hashlib.sha256(raw).hexdigest()!=AUTHORITY_SHA:raise RuntimeError('AUTHORITY_SOURCE_PIN_MISMATCH')
 text=raw.decode();old="    require(isinstance(session, Session) and (session.kind == 'jwt' or customer), 401, 'NATIVE_JWT_REQUIRED')"
 new="    standing=False\n    if isinstance(session,Session) and session.kind=='automation-grant':\n        from starli_agent_wake.principal import authentic\n        standing=authentic(session,authority,company)\n    require(isinstance(session, Session) and (session.kind == 'jwt' or customer or standing), 401, 'NATIVE_JWT_REQUIRED')"
 if text.count(old)!=1:raise RuntimeError('AUTHORITY_PATCH_ANCHOR_CHANGED')
 return text.replace(old,new).encode()
GATEWAY_SHA='9f60592c9c09ba7d985580b48d6a69740c649939c01fead4e557680e8a8be4b0'
def patched_gateway(raw):
 if hashlib.sha256(raw).hexdigest()!=GATEWAY_SHA:raise RuntimeError('GATEWAY_SOURCE_PIN_MISMATCH')
 text=raw.decode();old="        need(session.kind=='jwt','NATIVE_JWT_REQUIRED',401)"
 new="        from starli_agent_wake.principal import is_verified_principal\n        need(session.kind=='jwt' or (native_scope is not None and is_verified_principal(session,self.store.authority,company)),'NATIVE_JWT_REQUIRED',401)"
 if text.count(old)!=1:raise RuntimeError('GATEWAY_PATCH_ANCHOR_CHANGED')
 return text.replace(old,new).encode()
def apply(candidate_backend):
 p=pathlib.Path(candidate_backend)/'company_messaging/authority.py';out=patched(p.read_bytes())
 # Fresh inode: candidate may be hardlinked to immutable/live source.
 fd,tmp=tempfile.mkstemp(dir=p.parent,prefix='.wake-authority-')
 try:
  with os.fdopen(fd,'wb')as f:f.write(out)
  os.chmod(tmp,p.stat().st_mode);os.replace(tmp,p)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
 return hashlib.sha256(out).hexdigest()
if __name__=='__main__':
 import sys
 if len(sys.argv)>2 and sys.argv[2]=='--gateway':
  p=pathlib.Path(sys.argv[1])/'starli_automations/gateway.py';out=patched_gateway(p.read_bytes());fd,tmp=tempfile.mkstemp(dir=p.parent,prefix='.wake-gateway-')
  try:
   with os.fdopen(fd,'wb')as f:f.write(out)
   os.chmod(tmp,p.stat().st_mode);os.replace(tmp,p)
  finally:
   if os.path.exists(tmp):os.unlink(tmp)
  print(hashlib.sha256(out).hexdigest())
 else:print(apply(sys.argv[1]))
