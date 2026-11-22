"""Offline router authorization and discovery contract; no external services."""
import unittest
from types import SimpleNamespace
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from product_router import create_router
class RouterTests(unittest.TestCase):
 def test_discovery(self):
  calls=[]
  async def user(request:Request):
   if request.headers.get('Authorization')!='Bearer native':raise HTTPException(401)
   return SimpleNamespace(id='actor')
  class RPC:
   def call(self,op,actor,company,rid,payload):
    calls.append((op,actor,company,rid,payload))
    if company!='allowed':raise HTTPException(403)
    return {'drafts':[{'id':'draft','revision':2}]} if op=='list' else {'id':rid,'revision':2}
  app=FastAPI();app.include_router(create_router(RPC(),user,lambda req:None,lambda req,u:SimpleNamespace(check=lambda:None)))
  client=TestClient(app);base='/api/v1/companies/allowed/email-studio'
  self.assertEqual(client.get(base).status_code,401)
  headers={'Authorization':'Bearer native'}
  result=client.get(base,headers=headers);self.assertEqual(result.status_code,200);self.assertEqual(result.headers['Cache-Control'],'no-store')
  self.assertEqual(calls[-1],('list','actor','allowed','',{}))
  self.assertEqual(client.get(base+'/draft',headers=headers).json()['revision'],2)
  self.assertEqual(client.get('/api/v1/companies/other/email-studio',headers=headers).status_code,403)
if __name__=='__main__':unittest.main()
