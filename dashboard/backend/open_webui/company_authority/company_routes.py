"""Native route factory; inject get_verified_user, never accept actor IDs from request bodies."""
import sqlite3
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict
from .company_rbac import Authority, CATALOG, Forbidden
class StrictForm(BaseModel):
 model_config=ConfigDict(extra='forbid')
class CompanyForm(StrictForm):
 name: str=Field(min_length=1,max_length=100)
class InviteForm(StrictForm):
 user_id: str
 role: str='member'
 ttl: int=Field(default=86400,gt=0,le=604800)
class AcceptForm(StrictForm):
 token: str
class RoleForm(StrictForm):
 name: str=Field(min_length=1,max_length=100)
 kind: Literal['person','bot']
 grants: list[str]
class UpdateRoleForm(StrictForm):
 name: str=Field(min_length=1,max_length=100)
 grants: list[str]
class BuiltinForm(StrictForm):
 role: Literal['owner','admin','member']
def build_router(verified_user,db_path):
 router=APIRouter()
 def authority():
  a=Authority(db_path)
  try: yield a
  finally: a.db.close()
 def invoke(fn):
  try: return fn()
  except Forbidden as e: raise HTTPException(403,str(e))
  except (ValueError,sqlite3.IntegrityError) as e: raise HTTPException(400,str(e))
 @router.get('')
 def companies(user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.list_companies(user.id))
 @router.post('')
 def create(f:CompanyForm,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:dict(company_id=a.create(user.id,f.name,getattr(user,'name',user.id))))
 @router.post('/invites/accept')
 def accept(f:AcceptForm,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.accept(user.id,f.token,getattr(user,'name',user.id)))
 @router.get('/{c}/permissions')
 def catalog(c:str,user=Depends(verified_user),a=Depends(authority)):
  invoke(lambda:a.require_member(user.id,c))
  return dict(contract_version=2,permissions=[dict(name=k,delegable=v) for k,v in CATALOG.items()])
 @router.post('/{c}/switch')
 async def switch(c:str,request:Request,user=Depends(verified_user),a=Depends(authority)):
  result=invoke(lambda:a.switch(user.id,c))
  from .pilot_switch import initialize_company_pilot
  await initialize_company_pilot(request,user,c,db_path)
  return result
 @router.get('/{c}/capabilities')
 def capabilities(c:str,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.effective(user.id,c))
 @router.get('/{c}/members/{target}/capabilities')
 def subject_caps(c:str,target:str,user=Depends(verified_user),a=Depends(authority)):
  def run():
   a._admin(user.id,c); return a.effective(target,c)
  return invoke(run)
 @router.get('/{c}/directory')
 def directory(c:str,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.directory(user.id,c))
 @router.get('/{c}/directory/resolve')
 def resolve(c:str,query:str,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.resolve_recipient(user.id,c,query))
 @router.post('/{c}/invites')
 def invite(c:str,f:InviteForm,user=Depends(verified_user),a=Depends(authority)):
  def run():
   i,t=a.invite(user.id,c,f.user_id,f.role,f.ttl); return dict(invite_id=i,token=t)
  return invoke(run)
 @router.delete('/{c}/invites/{i}')
 def revoke_invite(c:str,i:str,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.revoke(user.id,c,i))
 @router.put('/{c}/members/{target}/role')
 def builtin(c:str,target:str,f:BuiltinForm,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.set_role(user.id,c,target,f.role))
 @router.delete('/{c}/members/{target}')
 def remove(c:str,target:str,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.remove(user.id,c,target))
 @router.get('/{c}/roles')
 def roles(c:str,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.list_custom_roles(user.id,c))
 @router.post('/{c}/roles')
 def create_role(c:str,f:RoleForm,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:dict(role_id=a.create_custom_role(user.id,c,f.name,f.kind,f.grants)))
 @router.put('/{c}/roles/{rid}')
 def update_role(c:str,rid:str,f:UpdateRoleForm,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.update_custom_role(user.id,c,rid,f.name,f.grants))
 @router.delete('/{c}/roles/{rid}')
 def revoke_role(c:str,rid:str,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.revoke_custom_role(user.id,c,rid))
 @router.put('/{c}/roles/{rid}/members/{target}')
 def assign(c:str,rid:str,target:str,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.assign_custom_role(user.id,c,rid,target))
 @router.delete('/{c}/roles/{rid}/members/{target}')
 def unassign(c:str,rid:str,target:str,user=Depends(verified_user),a=Depends(authority)):
  return invoke(lambda:a.assign_custom_role(user.id,c,rid,target,False))
 return router
