"""Starli AI: customer inference; bound administrator Pi tools."""
class Pipe:
 def __init__(self):
  self.name="Starli AI"
 async def pipe(self,body:dict,__user__:dict=None,__event_emitter__=None,__request__=None,__message_id__=None,__chat_id__=None,__task__=None):
  from fastapi import HTTPException,BackgroundTasks
  from fastapi.security import HTTPAuthorizationCredentials
  from fastapi.security.utils import get_authorization_scheme_param
  from open_webui.utils.auth import get_current_user
  from open_webui.routers.starli_pi_master import pi_chat
  if __request__ is None:raise HTTPException(403,"Authenticated request required")
  scheme,token=get_authorization_scheme_param(__request__.headers.get("Authorization"))
  credential=HTTPAuthorizationCredentials(scheme=scheme,credentials=token) if scheme.lower()=="bearer" and token else None
  principal=get_current_user(__request__,BackgroundTasks(),credential)
  if not __user__ or __user__.get("id")!=principal.id:raise HTTPException(403,"Authenticated identity mismatch")
  request_id=None
  if __message_id__:
   import hashlib
   request_id=hashlib.sha256((str(__chat_id__ or "local")+":"+str(__message_id__)+":"+str(__task__ or "chat")).encode()).hexdigest()
  if __request__.headers.get("X-Starli-Tool-Events")=="v1":
   if body.get("stream") is not True:raise HTTPException(422,"Tool events require streaming")
   from open_webui.routers.starli_chat_stream import stream_response
   return await stream_response(__request__,principal,body,__chat_id__,__message_id__,request_id)
  return await pi_chat(principal.id,body.get("messages",[]),__event_emitter__,request_id,__chat_id__)
