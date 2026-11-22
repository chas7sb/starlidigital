"""Server-owned per-administrator execution mode. Models cannot switch this mode."""
import sqlite3,time
from pathlib import Path
from fastapi import APIRouter,Depends
from pydantic import BaseModel,StrictBool
from open_webui.utils.auth import get_verified_user
from open_webui.routers.starli_platform import principal
router=APIRouter()
from open_webui.routers.starli_state import state_dir
HOME=state_dir()
def db():
 HOME.mkdir(parents=True,exist_ok=True)
 c=sqlite3.connect(str(HOME/'access.sqlite'),timeout=5)
 c.execute('CREATE TABLE IF NOT EXISTS execution_modes(owner TEXT PRIMARY KEY,enabled INTEGER NOT NULL,updated REAL NOT NULL)')
 c.execute('CREATE TABLE IF NOT EXISTS execution_mode_audit(owner TEXT,enabled INTEGER,changed REAL)')
 return c
def full_access(user):
 from open_webui.routers.starli_execution_context import platform_enabled
 return platform_enabled(user)
@router.get('')
def status(user=Depends(get_verified_user)):
 enabled=full_access(user)
 return {'mode':'FULL_ACCESS' if enabled else 'APPROVAL','fullAccess':enabled}
class ModeBody(BaseModel):
 fullAccess:StrictBool
 class Config:extra='forbid'
@router.put('')
def set_mode(body:ModeBody,user=Depends(get_verified_user)):
 uid,_=principal(user);now=time.time()
 with db() as c:
  c.execute('INSERT INTO execution_modes VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled,updated=excluded.updated',(uid,int(body.fullAccess),now))
  c.execute('INSERT INTO execution_mode_audit VALUES(?,?,?)',(uid,int(body.fullAccess),now))
 return {'mode':'FULL_ACCESS' if body.fullAccess else 'APPROVAL','fullAccess':body.fullAccess}
