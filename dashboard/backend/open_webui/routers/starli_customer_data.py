"""Owner-scoped read models for native CRM and mailbox UI; writes use audited chat tools."""
import json,sqlite3
from contextlib import contextmanager
from fastapi import APIRouter,Depends,HTTPException,Query
from open_webui.utils.auth import get_verified_user
from open_webui.routers.starli_state import source_database
from open_webui.routers.starli_platform import customer_principal
router=APIRouter()
@contextmanager
def db():
 c=sqlite3.connect("file:"+source_database()+"?mode=ro",uri=True,timeout=5)
 try:yield c
 finally:c.close()
def owned(c,collection,owner):
 return [json.loads(row[0]) for row in c.execute("SELECT payload FROM records WHERE collection=? AND owner=?",(collection,owner))]
def public_company(row):return {**{k:row.get(k) for k in ("id","name","domain","industry","email","phone","website","locality","country","version","updatedAt","notes")},"status":row.get("qualificationStatus","UNQUALIFIED")}
@router.get("/crm")
def crm(q:str=Query("",max_length=200),limit:int=Query(50,ge=1,le=200),offset:int=Query(0,ge=0),user=Depends(get_verified_user)):
 owner=customer_principal(user)[1]["v2UserId"]
 with db() as c:rows=owned(c,"crm_companies",owner)
 rows=[r for r in rows if q.casefold() in " ".join(str(r.get(k,"")) for k in ("name","domain","email","industry","locality")).casefold()]
 rows.sort(key=lambda r:str(r.get("name","")).casefold())
 return {"items":[public_company(r) for r in rows[offset:offset+limit]],"total":len(rows),"offset":offset,"limit":limit}
@router.get("/crm/{ident}")
def company(ident:str,user=Depends(get_verified_user)):
 owner=customer_principal(user)[1]["v2UserId"]
 with db() as c:
  record=c.execute("SELECT payload FROM records WHERE collection='crm_companies' AND owner=? AND id=?",(owner,ident)).fetchone()
  if not record:raise HTTPException(404,"Company not found")
  row=json.loads(record[0])
  contacts=[r for r in owned(c,"crm_contacts",owner) if r.get("companyId")==ident]
  activities=[r for r in owned(c,"crm_activities",owner) if r.get("companyId")==ident]
  tasks=[r for r in owned(c,"crm_tasks",owner) if r.get("companyId")==ident]
  opportunities=[r for r in owned(c,"crm_opportunities",owner) if r.get("companyId")==ident]
 return {"company":public_company(row),"contacts":[{**{k:r.get(k) for k in ("id","email","phone","isPrimary","version")},"name":r.get("fullName") or r.get("name"),"role":r.get("roleTitle") or r.get("role")} for r in contacts],
  "tasks":[{**{k:r.get(k) for k in ("id","title","summary","status","priority","version")},"dueAt":r.get("dueDate") or r.get("dueAt")} for r in tasks],
  "interactions":[{k:r.get(k) for k in ("id","kind","type","title","summary","details","createdAt","occurredAt")} for r in activities[-100:]],"opportunities":[{k:r.get(k) for k in ("id","title","stageId","status","expectedValue","winProbability","amount","currency","version")} for r in opportunities]}


@router.get("/mailbox/drafts")
def drafts(user=Depends(get_verified_user)):
 owner=customer_principal(user)[1]["v2UserId"]
 with db() as c:rows=owned(c,"mailbox-drafts",owner)
 rows.sort(key=lambda r:str(r.get("updatedAt","")),reverse=True)
 fields=("id","fromAccount","to","subject","textBody","status","revision","createdAt","updatedAt","companyId","projectId")
 return {"items":[{k:r.get(k) for k in fields} for r in rows[:100]],"total":len(rows)}


@router.get("/mailbox/messages/{ident}")
def message(ident:str,user=Depends(get_verified_user)):
 owner=customer_principal(user)[1]["v2UserId"]
 with db() as c:
  row=c.execute("SELECT payload FROM records WHERE collection='mailbox-messages' AND id=? AND owner=?",(ident,owner)).fetchone()
 if not row:raise HTTPException(404,"Message not found")
 value=json.loads(row[0]);fields=("id","threadId","accountId","folder","uid","uidValidity","from","to","cc","subject","date","textBody","status","isRead","attachments")
 return {k:value.get(k) for k in fields}
