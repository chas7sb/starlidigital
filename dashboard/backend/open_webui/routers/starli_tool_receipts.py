"""Durable execution receipts without approval prompts."""
import asyncio,hashlib,json,sqlite3,time
from pathlib import Path
from fastapi import HTTPException
from open_webui.routers.starli_state import state_dir
HOME=state_dir()
def db():
 HOME.mkdir(parents=True,exist_ok=True)
 c=sqlite3.connect(str(HOME/'tool-operations.sqlite'),timeout=5)
 c.execute('CREATE TABLE IF NOT EXISTS operations(owner TEXT,key TEXT,fingerprint TEXT,status TEXT,result TEXT,created REAL,PRIMARY KEY(owner,key))')
 return c
async def execute(owner,key,tool,args,call):
 if not isinstance(key,str) or not 1<=len(key)<=256:raise HTTPException(400,'An operation key is required for Full Access actions')
 fp=hashlib.sha256(json.dumps({'tool':tool,'args':args},sort_keys=True,separators=(',',':')).encode()).hexdigest()
 with db() as c:
  c.execute('BEGIN IMMEDIATE')
  prior=c.execute('SELECT fingerprint,status,result FROM operations WHERE owner=? AND key=?',(owner,key)).fetchone()
  if prior:
   if prior[0]!=fp:raise HTTPException(409,'Operation key reused with different arguments')
   if prior[2]:return json.loads(prior[2])
   return {'isError':True,'status':prior[1],'operationKey':key,'content':[{'type':'text','text':'Execution is pending or uncertain; inspect existing receipts. This action was not replayed.'}]}
  c.execute('INSERT INTO operations VALUES(?,?,?,?,NULL,?)',(owner,key,fp,'EXECUTING',time.time()))
 try:
  result=await call();status='FAILED' if result.get('isError') else 'COMPLETED'
 except asyncio.CancelledError:
  result={'isError':True,'status':'UNCERTAIN','operationKey':key,'content':[{'type':'text','text':'Execution was interrupted. Inspect backend receipts; this action will not be replayed.'}]}
  with db() as c:c.execute('UPDATE operations SET status=?,result=? WHERE owner=? AND key=?',('UNCERTAIN',json.dumps(result),owner,key))
  raise
 except Exception:
  result={'isError':True,'status':'UNCERTAIN','operationKey':key,'content':[{'type':'text','text':'Action outcome is uncertain. Inspect backend receipts; no automatic retry.'}]};status='UNCERTAIN'
 with db() as c:c.execute('UPDATE operations SET status=?,result=? WHERE owner=? AND key=?',(status,json.dumps(result),owner,key))
 return result
