"""Bounded synchronous local Studio RPC. Config is supplied by native startup.
No network address, principal override, retries, email send or approval methods.
"""
import http.client
import json
import os
import socket
import stat
from pathlib import Path
from panel_api import PanelError

class UnixHTTPConnection(http.client.HTTPConnection):
 def __init__(self,path,timeout):super().__init__('localhost',timeout=timeout);self.path=path
 def connect(self):
  self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
  self.sock.settimeout(self.timeout)
  try:self.sock.connect(self.path)
  except BaseException:self.sock.close();raise

class EmailStudioSocketRPC:
 def __init__(self,socket_path,secret_path,timeout=6):
  if not Path(socket_path).is_absolute() or not Path(secret_path).is_absolute():raise ValueError('Absolute operator-configured paths required')
  if not 0<timeout<=10:raise ValueError('Invalid local RPC timeout')
  self.socket_path=str(socket_path);self.secret_path=str(secret_path);self.timeout=timeout
 def _secret(self):
  # Refuse symlink/world/group-readable credentials; re-read to allow rotation.
  flags=os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)
  fd=os.open(self.secret_path,flags)
  with os.fdopen(fd,'rb') as stream:
   info=os.fstat(stream.fileno())
   if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077 or info.st_uid not in (0,os.geteuid()):raise OSError('Unsafe local credential permissions')
   raw=stream.read(4097)
  token=raw.strip().decode('ascii')
  if not 16<=len(token)<=4096 or any(ord(c)<33 or ord(c)>126 for c in token):raise ValueError('Invalid local credential')
  return token
 def __call__(self,operation,ctx,resource_id,payload=None):
  if operation not in ('get','save'):raise ValueError('Unsupported email panel operation')
  if not isinstance(ctx,dict) or set(ctx)!={'actorId','companyId'} or any(not isinstance(v,str) or not v for v in ctx.values()) or not isinstance(resource_id,str) or not resource_id:raise ValueError('Invalid native email context')
  params=dict(ctx,resourceId=resource_id)
  if operation=='save':
   if not isinstance(payload,dict) or set(payload)!={'head','document'} or type(payload['head']) is not int or payload['head']<1:raise ValueError('Invalid email edit')
   params.update(expectedRevision=payload['head'],document=payload['document'])
  raw=json.dumps({'method':'email.read' if operation=='get' else 'email.edit','params':params},allow_nan=False,separators=(',',':')).encode()
  if len(raw)>256*1024:raise ValueError('Email RPC request exceeds 256 KiB')
  connection=None
  try:
   token=self._secret();info=os.lstat(self.socket_path)
   if not stat.S_ISSOCK(info.st_mode) or info.st_mode&0o077 or info.st_uid not in (0,os.geteuid()):raise OSError('Unsafe local socket permissions')
   connection=UnixHTTPConnection(self.socket_path,self.timeout)
   connection.request('POST','/rpc',body=raw,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json'})
   response=connection.getresponse();body=response.read(512*1024+1)
   if len(body)>512*1024:raise OSError('Oversized local response')
   if response.status==403:raise PanelError(403,'FORBIDDEN','Email unavailable.')
   if response.status==409:raise PanelError(409,'REVISION_CONFLICT','Email changed. Reload before saving.')
   if response.status==404:raise PanelError(404,'NOT_FOUND','Email unavailable.')
   if response.status==400:raise ValueError('Email service rejected the request.')
   if response.status==413:raise PanelError(413,'INVALID_REQUEST','Email request exceeds the service limit.')
   if response.status!=200 or 'application/json' not in response.getheader('Content-Type',''):raise OSError('Local email service unavailable')
   result=json.loads(body)
   if isinstance(result,dict) and result.get('ok') is True:result=result.get('result')
   # Accept Studio DTO or canonical panel snapshot from the Node adapter.
   if isinstance(result,dict) and result.get('ref'):
    r=result['ref']
    if r!={'scope':'company','ownerId':ctx['companyId'],'kind':'email','id':resource_id}:raise PanelError(403,'FORBIDDEN','Email scope could not be verified.')
    result=dict(id=resource_id,companyId=ctx['companyId'],revision=result.get('revision'),document=result.get('value'))
   if not isinstance(result,dict) or result.get('companyId')!=ctx['companyId'] or result.get('id')!=resource_id or type(result.get('revision')) is not int or result['revision']<1 or not isinstance(result.get('document'),dict):raise OSError('Invalid local email response')
   return result
  except (OSError,UnicodeError,json.JSONDecodeError) as error:
   raise PanelError(503,'UNAVAILABLE','Local Email Studio unavailable. Reopen before retrying an edit.') from error
  finally:
   if connection:connection.close()

