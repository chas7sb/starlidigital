"""Customer CRM lifecycle and mailbox metadata tools, atomically tenant scoped."""
import hashlib,json,math,re,sqlite3,time,uuid
from contextlib import contextmanager
from fastapi import HTTPException
from open_webui.routers.starli_platform import customer_principal
from open_webui.routers.starli_state import source_database
def now():return time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
def owner(user):return customer_principal(user)[1]["v2UserId"]
@contextmanager
def db():
 c=sqlite3.connect(source_database(),timeout=10);c.row_factory=sqlite3.Row
 try:
  with c:yield c
 finally:c.close()
def storage(collection,ident,uid):return uid+":"+ident if collection=="crm_pipelines" and ident=="default-pipeline" else ident
def get(c,collection,ident,uid):
 if not isinstance(ident,str) or not ident:raise HTTPException(422,"A resource ID is required")
 row=c.execute("SELECT payload FROM records WHERE collection=? AND id=? AND owner=?",(collection,storage(collection,ident,uid),uid)).fetchone()
 if not row:raise HTTPException(404,"Resource not found")
 return json.loads(row["payload"])
def put(c,collection,value,uid):
 value={**value,"ownerId":uid};ident=storage(collection,value["id"],uid)
 row=c.execute("SELECT owner FROM records WHERE collection=? AND id=?",(collection,ident)).fetchone()
 if row and row["owner"]!=uid:raise HTTPException(404,"Resource not found")
 c.execute("INSERT INTO records(collection,id,owner,payload) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET payload=excluded.payload WHERE owner=excluded.owner",(collection,ident,uid,json.dumps(value)))
 return value
def rows(c,collection,uid):return [json.loads(r[0]) for r in c.execute("SELECT payload FROM records WHERE collection=? AND owner=?",(collection,uid))]
def text(v,label,limit=200,required=True):
 if not isinstance(v,str) or len(v)>limit or (required and not v.strip()):raise HTTPException(422,label+" is invalid")
 return v.strip()
def version(record,expected,field="version"):
 if not isinstance(expected,int) or isinstance(expected,bool) or expected!=int(record.get(field,1)):raise HTTPException(409,"The record changed. Read its current "+field+" before updating.")
def link(c,a,field,collection,uid):
 if a.get(field):get(c,collection,a[field],uid)
def audit(c,uid,kind,summary,**links):
 return put(c,"crm_activities",{"id":"activity-"+uuid.uuid4().hex,"kind":kind,"actorPrincipal":uid,"occurredAt":now(),"summary":summary,"visibility":"INTERNAL_ONLY","version":1,"createdAt":now(),**links},uid)
STAGES=[{"id":i,"name":n,"order":k,"probability":p,**({"isTerminalWon":True} if i=="closed_won" else {"isTerminalLost":True} if i=="closed_lost" else {})} for k,(i,n,p) in enumerate([("lead","Lead",10),("discovery","Discovery",25),("proposal","Proposal",50),("negotiation","Negotiation",75),("closed_won","Won",100),("closed_lost","Lost",0)])]
def pipeline(c,uid,ident="default-pipeline"):
 try:return get(c,"crm_pipelines",ident,uid)
 except HTTPException as e:
  if e.status_code!=404 or ident!="default-pipeline":raise
  return put(c,"crm_pipelines",{"id":ident,"name":"Sales pipeline","stages":STAGES,"version":1,"updatedAt":now()},uid)
def addresses(value):
 if not isinstance(value,list) or not 1<=len(value)<=100:raise HTTPException(422,"Use between 1 and 100 recipients")
 out=[]
 for item in value:
  addr=item.get("address") if isinstance(item,dict) else item
  if not isinstance(addr,str) or len(addr)>254 or not re.fullmatch(r"[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+",addr):raise HTTPException(422,"Invalid email recipient")
  if addr.lower() not in [v["address"].lower() for v in out]:out.append({"address":addr})
 return out
READ={"crm_opportunity_get","crm_opportunity_list","crm_contact_list","crm_task_get","crm_task_list","crm_pipeline_get","mailbox_drafts","mailbox_draft_read"}
def _run(c,uid,name,a):
 if name in ("crm_opportunity_get","crm_task_get"):
  return get(c,"crm_opportunities" if name=="crm_opportunity_get" else "crm_tasks",a.get("opportunityId" if name=="crm_opportunity_get" else "taskId"),uid)
 if name in ("crm_opportunity_list","crm_contact_list"):
  out=rows(c,"crm_opportunities" if name=="crm_opportunity_list" else "crm_contacts",uid)
  if a.get("companyId"):out=[v for v in out if v.get("companyId")==a["companyId"]]
  if a.get("status"):out=[v for v in out if v.get("status")==a["status"]]
  return {"items":out[:100],"total":len(out)}
 if name=="crm_pipeline_get":return pipeline(c,uid,a.get("pipelineId") or "default-pipeline")
 if name=="crm_pipeline_update":
  p=pipeline(c,uid,a.get("pipelineId") or "default-pipeline");version(p,a.get("expectedVersion"))
  stages=a.get("stages")
  if not isinstance(stages,list) or not 2<=len(stages)<=20:raise HTTPException(422,"A pipeline needs 2–20 stages")
  cleaned=[]
  for index,stage in enumerate(stages):
   if not isinstance(stage,dict):raise HTTPException(422,"Invalid pipeline stage")
   ident=text(stage.get("id"),"Stage ID",64)
   if not re.fullmatch(r"[A-Za-z0-9_-]+",ident) or ident in [s["id"] for s in cleaned]:raise HTTPException(422,"Stage IDs must be unique")
   probability=stage.get("probability",0)
   if not isinstance(probability,(int,float)) or isinstance(probability,bool) or not math.isfinite(probability) or not 0<=probability<=100:raise HTTPException(422,"Stage probability must be 0–100")
   cleaned.append({"id":ident,"name":text(stage.get("name"),"Stage name",100),"order":index,"probability":probability,"isTerminalWon":stage.get("isTerminalWon") is True,"isTerminalLost":stage.get("isTerminalLost") is True})
  if any(s["isTerminalWon"] and s["isTerminalLost"] for s in cleaned):raise HTTPException(422,"A stage cannot be both won and lost")
  used={o.get("stageId") for o in rows(c,"crm_opportunities",uid) if o.get("pipelineId","default-pipeline")==p["id"]}
  if not used.issubset({s["id"] for s in cleaned}):raise HTTPException(409,"Move opportunities out of stages before removing those stages")
  p.update(name=text(a.get("name",p["name"]),"Pipeline name",120),stages=cleaned,version=p["version"]+1,updatedAt=now());return put(c,"crm_pipelines",p,uid)
 if name in ("crm_opportunity_create","crm_opportunity_update"):
  updating=name.endswith("update")
  o=get(c,"crm_opportunities",a.get("opportunityId"),uid) if updating else {"id":"opp-"+uuid.uuid4().hex,"createdAt":now(),"version":0,"status":"OPEN"}
  if updating:version(o,a.get("expectedVersion"))
  company=a.get("companyId",o.get("companyId"));get(c,"crm_companies",company,uid)
  values={**o,**{k:v for k,v in a.items() if k in ("title","amount","currency","stageId","closeDate","primaryContactId","projectId","pipelineId","wonReason","lostReason")},"companyId":company}
  values["title"]=text(values.get("title"),"Opportunity title",300)
  amount=values.get("amount",0)
  if not isinstance(amount,(int,float)) or isinstance(amount,bool) or not math.isfinite(amount) or not 0<=amount<=1000000000:raise HTTPException(422,"Invalid opportunity amount")
  values["amount"]=amount;currency=values.get("currency","EUR")
  if currency not in ("EUR","RON","USD","GBP"):raise HTTPException(422,"Unsupported currency")
  values["currency"]=currency
  p=pipeline(c,uid,values.get("pipelineId") or "default-pipeline");stage_id=values.get("stageId") or p["stages"][0]["id"]
  stage=next((s for s in p["stages"] if s["id"]==stage_id),None)
  if not stage:raise HTTPException(422,"Select an existing pipeline stage")
  link(c,values,"primaryContactId","crm_contacts",uid);link(c,values,"projectId","projects",uid)
  if values.get("primaryContactId") and get(c,"crm_contacts",values["primaryContactId"],uid).get("companyId")!=company:raise HTTPException(422,"Contact belongs to another company")
  values.update(stageId=stage_id,pipelineId=p["id"],probability=stage.get("probability",0),status="WON" if stage.get("isTerminalWon") else "LOST" if stage.get("isTerminalLost") else "OPEN",version=o.get("version",0)+1,updatedAt=now())
  put(c,"crm_opportunities",values,uid);audit(c,uid,"STAGE_CHANGE" if updating and o.get("stageId")!=stage_id else "SYSTEM","Updated opportunity" if updating else "Created opportunity",companyId=company,opportunityId=values["id"]);return values
 if name=="crm_task_list":
  out=rows(c,"crm_tasks",uid)
  for field in ("companyId","opportunityId","status"):
   if a.get(field):out=[v for v in out if v.get(field)==a[field]]
  out.sort(key=lambda v:(v.get("dueDate") or "9999",v.get("createdAt","")))
  return {"items":out[:100],"total":len(out)}
 if name in ("crm_task_create","crm_task_update"):
  updating=name.endswith("update");t=get(c,"crm_tasks",a.get("taskId"),uid) if updating else {"id":"task-"+uuid.uuid4().hex,"createdAt":now(),"version":0,"priority":"MEDIUM","status":"PENDING"}
  if updating:version(t,a.get("expectedVersion"))
  t={**t,**{k:v for k,v in a.items() if k in ("title","description","companyId","opportunityId","contactId","dueDate","priority","status")}}
  t["title"]=text(t.get("title"),"Task title",300)
  if t.get("priority") not in ("LOW","MEDIUM","HIGH","URGENT") or t.get("status") not in ("PENDING","IN_PROGRESS","COMPLETED","CANCELLED"):raise HTTPException(422,"Invalid task priority or status")
  if t.get("description"):t["description"]=text(t["description"],"Task description",10000)
  for field,collection in (("companyId","crm_companies"),("opportunityId","crm_opportunities"),("contactId","crm_contacts")):link(c,t,field,collection,uid)
  if t.get("opportunityId") and t.get("companyId") and get(c,"crm_opportunities",t["opportunityId"],uid).get("companyId")!=t["companyId"]:raise HTTPException(422,"Opportunity belongs to another company")
  if t.get("contactId") and t.get("companyId") and get(c,"crm_contacts",t["contactId"],uid).get("companyId")!=t["companyId"]:raise HTTPException(422,"Contact belongs to another company")
  if t.get("dueDate"):
   from datetime import datetime
   try:datetime.fromisoformat(t["dueDate"].replace("Z","+00:00"))
   except (ValueError,AttributeError):raise HTTPException(422,"Use an ISO due date") from None
  t.update(version=t.get("version",0)+1,updatedAt=now(),completedAt=now() if t["status"]=="COMPLETED" else None);put(c,"crm_tasks",t,uid);audit(c,uid,"TASK","Updated task: "+t["title"],companyId=t.get("companyId"),opportunityId=t.get("opportunityId"));return t
 if name=="crm_contact_save":
  updating=bool(a.get("contactId"));v=get(c,"crm_contacts",a["contactId"],uid) if updating else {"id":"contact-"+uuid.uuid4().hex,"createdAt":now(),"version":0}
  if updating:version(v,a.get("expectedVersion"))
  v={**v,**{k:value for k,value in a.items() if k in ("companyId","firstName","lastName","email","phone","roleTitle","isPrimary")}}
  get(c,"crm_companies",v.get("companyId"),uid);v["firstName"]=text(v.get("firstName",""),"First name",100,False);v["lastName"]=text(v.get("lastName",""),"Last name",100,False)
  if not (v["firstName"] or v["lastName"]):raise HTTPException(422,"Contact name is required")
  if v.get("email"):addresses([v["email"]])
  v.update(fullName=(v["firstName"]+" "+v["lastName"]).strip(),version=v.get("version",0)+1,updatedAt=now(),isPrimary=v.get("isPrimary") is True)
  if v["isPrimary"]:
   for old in rows(c,"crm_contacts",uid):
    if old.get("companyId")==v["companyId"] and old.get("isPrimary") and old["id"]!=v["id"]:old.update(isPrimary=False,version=old.get("version",1)+1,updatedAt=now());put(c,"crm_contacts",old,uid)
  return put(c,"crm_contacts",v,uid)
 if name=="mailbox_drafts":
  out=rows(c,"mailbox-drafts",uid);out.sort(key=lambda v:v.get("updatedAt",""),reverse=True)
  return {"items":[{k:v.get(k) for k in ("id","revision","fromAccount","to","subject","textBody","createdAt","updatedAt")} for v in out[:100]],"total":len(out)}
 if name in ("mailbox_draft_read","mailbox_draft_update"):
  v=get(c,"mailbox-drafts",a.get("draftId"),uid)
  if name.endswith("update"):
   version(v,a.get("expectedRevision"),"revision")
   if a.get("to") is not None:v["to"]=addresses(a["to"])
   for field in ("cc","bcc"):
    if field in a:v[field]=addresses(a[field]) if a[field] else []
   if "subject" in a:v["subject"]=text(a["subject"],"Subject",998)
   if "textBody" in a:v["textBody"]=text(a["textBody"],"Message",50000)
   for field in ("approvalHash","approvalExpiresAt","approvedBy","approvedAt"):v.pop(field,None)
   v.update(revision=v.get("revision",1)+1,updatedAt=now());put(c,"mailbox-drafts",v,uid)
  return {k:value for k,value in v.items() if k not in ("approvalHash","approvalExpiresAt","approvedBy","approvedAt","htmlBody")}
 if name=="mailbox_mark_read":
  v=get(c,"mailbox-messages",a.get("messageId"),uid)
  if not isinstance(a.get("isRead"),bool):raise HTTPException(422,"isRead must be true or false")
  v.update(isRead=a["isRead"],updatedAt=now());put(c,"mailbox-messages",v,uid)
  return {"messageId":v["id"],"isRead":v["isRead"],"remoteSync":False}
 raise HTTPException(404,"Unknown customer action")
def schema_object(properties,required=()):
 return {"type":"object","properties":properties,"required":list(required),"additionalProperties":False}
S={"type":"string"};I={"type":"integer","minimum":1};B={"type":"boolean"}
DEFINITIONS=[
("crm_opportunity_get","Read your sales opportunity including the current version needed for updates.",{"opportunityId":S},("opportunityId",)),
("crm_opportunity_list","List your sales opportunities with current versions and stages.",{"companyId":S,"status":S},()),
("crm_contact_list","List your company contacts with current versions needed for safe editing.",{"companyId":S},()),
("crm_task_get","Read your CRM task and its current version.",{"taskId":S},("taskId",)),

("crm_pipeline_get","Read your current sales stages and version.",{"pipelineId":S},()),
("crm_pipeline_update","Update your own pipeline stages. Existing opportunities must keep valid stages.",{"pipelineId":S,"name":S,"expectedVersion":I,"stages":{"type":"array","items":{"type":"object"}}},("expectedVersion","stages")),
("crm_opportunity_create","Create a real customer sales opportunity linked to one of your CRM companies.",{"companyId":S,"title":S,"amount":{"type":"number"},"currency":S,"stageId":S,"pipelineId":S,"projectId":S,"primaryContactId":S,"closeDate":S},("companyId","title")),
("crm_opportunity_update","Update opportunity details or move it to another sales stage, with version protection.",{"opportunityId":S,"expectedVersion":I,"title":S,"amount":{"type":"number"},"currency":S,"stageId":S,"pipelineId":S,"projectId":S,"primaryContactId":S,"closeDate":S,"wonReason":S,"lostReason":S},("opportunityId","expectedVersion")),
("crm_task_list","List your CRM tasks, optionally by company, opportunity or status.",{"companyId":S,"opportunityId":S,"status":S},()),
("crm_task_create","Create a persistent customer task with priority, due date and CRM links.",{"title":S,"description":S,"companyId":S,"opportunityId":S,"contactId":S,"dueDate":S,"priority":S},("title",)),
("crm_task_update","Update or complete your CRM task. Read current version first.",{"taskId":S,"expectedVersion":I,"title":S,"description":S,"companyId":S,"opportunityId":S,"contactId":S,"dueDate":S,"priority":S,"status":S},("taskId","expectedVersion")),
("crm_contact_save","Create or update a contact linked to your company; editing requires expectedVersion.",{"contactId":S,"expectedVersion":I,"companyId":S,"firstName":S,"lastName":S,"email":S,"phone":S,"roleTitle":S,"isPrimary":B},("companyId",)),
("mailbox_drafts","List your saved email drafts; never sends mail.",{},()),
("mailbox_draft_read","Read your saved draft and its current revision.",{"draftId":S},("draftId",)),
("mailbox_draft_update","Edit your saved draft, invalidating previous send approvals.",{"draftId":S,"expectedRevision":I,"to":{"type":"array","items":S},"cc":{"type":"array","items":S},"bcc":{"type":"array","items":S},"subject":S,"textBody":S},("draftId","expectedRevision")),
("mailbox_mark_read","Mark a synchronized message read or unread in your workspace; no external send.",{"messageId":S,"isRead":B},("messageId","isRead"))]
TOOL_SCHEMAS=[{"name":name,"description":description,"inputSchema":schema_object({**properties,**({} if name in READ else {"operationKey":S})},required)} for name,description,properties,required in DEFINITIONS]
def schema(name):return next((v for v in TOOL_SCHEMAS if v["name"]==name),None)
async def tool(user,name,args,key=None):
 if not schema(name):raise HTTPException(404,"Unknown customer tool")
 uid=owner(user);a=dict(args or {})
 with db() as c:
  c.execute("BEGIN IMMEDIATE")
  if name in READ:return _run(c,uid,name,a)
  operation_key=key or a.pop("operationKey",None)
  if not isinstance(operation_key,str) or not 1<=len(operation_key)<=256:raise HTTPException(422,"A stable operation key is required")
  a.pop("operationKey",None);fingerprint=hashlib.sha256(json.dumps({"name":name,"args":a},sort_keys=True,separators=(",",":")).encode()).hexdigest()
  ident="nativeop-"+hashlib.sha256((uid+":"+operation_key).encode()).hexdigest()
  old=c.execute("SELECT payload FROM records WHERE collection='native-tool-operations' AND id=? AND owner=?",(ident,uid)).fetchone()
  if old:
   prior=json.loads(old[0])
   if prior["fingerprint"]!=fingerprint:raise HTTPException(409,"Operation key reused with different arguments")
   return prior["result"]
  result=_run(c,uid,name,a);put(c,"native-tool-operations",{"id":ident,"fingerprint":fingerprint,"result":result,"createdAt":now()},uid);return result
