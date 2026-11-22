import hashlib,json,secrets,time,urllib.request,base64
from cryptography.hazmat.primitives.serialization import load_pem_public_key
class PublisherDenied(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
def verify_publisher(token,*,company,computer,worker,purpose,method,path,body_sha256,reply_public_keys):
 """Native backend helper. Service auth only; caller must enforce fresh member/viewer ACL separately.
 Keys map kid->Ed25519 SPKI PEM. Never cache token or log request/body/headers.
 """
 if not isinstance(token,str)or not token.startswith('starli_company_publisher_')or len(token)>150:raise PublisherDenied('PUBLISHER_SERVICE_CREDENTIAL_REQUIRED')
 payload={'companyId':company,'computerId':computer,'workerId':worker,'purpose':purpose,'method':method,'path':path,'bodySha256':body_sha256,'nonce':secrets.token_hex(16)}
 data=json.dumps({'token':token,'request':payload},separators=(',',':')).encode();start=time.monotonic()
 req=urllib.request.Request('http://127.0.0.1:18446/internal/company-note/publisher-identity',data=data,headers={'Content-Type':'application/json'},method='POST')
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(req,timeout=5)as response:
   raw=response.read(16385)
   if response.status!=200 or len(raw)>16384:raise PublisherDenied('PUBLISHER_IDENTITY_DENIED')
  envelope=json.loads(raw)
  if set(envelope)!={'kid','message','signature'}:raise PublisherDenied('PUBLISHER_SIGNATURE_REQUIRED')
  message=envelope['message'];key=reply_public_keys[envelope['kid']]
  if set(message)!={'purpose','payload','issued','nonce'}or message['purpose']!='publisher.identity':raise PublisherDenied('PUBLISHER_PURPOSE_REQUIRED')
  signed=json.dumps(message,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
  signature=base64.urlsafe_b64decode(envelope['signature']+'='*((-len(envelope['signature']))%4))
  load_pem_public_key(key.encode()).verify(signature,signed)
  expected_digest=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
  result=message['payload']
  if set(result)!=set(payload)|{'servicePrincipalId','enrollmentRevision','authorized','requestDigest'}or any(result[k]!=v for k,v in payload.items())or result['authorized']is not True or type(result['enrollmentRevision'])is not int or result['enrollmentRevision']<1 or result['requestDigest']!=expected_digest or time.monotonic()-start>5:raise PublisherDenied('PUBLISHER_BINDING_REQUIRED')
  return {k:result[k]for k in ['companyId','computerId','workerId','servicePrincipalId','enrollmentRevision','purpose','method','path','bodySha256']}
 except PublisherDenied:raise
 except Exception:raise PublisherDenied('PUBLISHER_IDENTITY_DENIED')from None

def publisher_authenticator(EnrolledPublisher,reply_public_keys,*,company,computer,worker):
 """Injection factory for native relay. No JWT/cookie/note-token fallback."""
 import asyncio
 from fastapi import HTTPException
 async def authenticate(request,body_sha256):
  path=request.url.path;method=request.method
  purposes={('GET','/api/v1/company-computer/relay/publisher/work'):'frame.work',('POST','/api/v1/company-computer/relay/publisher/frames'):'frame.publish'}
  purpose=purposes.get((method,path))
  if not purpose or request.url.query:raise HTTPException(403,'Publisher denied')
  try:
   identity=await asyncio.to_thread(verify_publisher,request.headers.get('X-Company-Publisher-Token',''),company=company,computer=computer,worker=worker,purpose=purpose,method=method,path=path,body_sha256=body_sha256,reply_public_keys=reply_public_keys)
   return EnrolledPublisher(company_id=identity['companyId'],computer_id=identity['computerId'],publisher_id=identity['servicePrincipalId'],enrollment_revision=identity['enrollmentRevision'])
  except PublisherDenied:raise HTTPException(403,'Publisher denied')from None
 return authenticate
