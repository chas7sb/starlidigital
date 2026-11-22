import asyncio,json,sqlite3
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_customer_actions as actions
@pytest.fixture
def setup(monkeypatch,tmp_path):
 path=tmp_path/"records.sqlite";c=sqlite3.connect(path);c.execute("CREATE TABLE records(collection TEXT,id TEXT,owner TEXT,payload TEXT,PRIMARY KEY(collection,id))")
 for ident,owner in [("company-a","alice"),("company-b","bob")]:c.execute("INSERT INTO records VALUES('crm_companies',?,?,?)",(ident,owner,json.dumps({"id":ident,"name":ident,"version":1,"ownerId":owner})))
 c.execute("INSERT INTO records VALUES('mailbox-drafts','draft-a','alice',?)",(json.dumps({"id":"draft-a","revision":1,"to":[{"address":"client@example.com"}],"subject":"Old subject","textBody":"Old body","approvalHash":"old-approval"}),))
 c.execute("INSERT INTO records VALUES('mailbox-messages','message-a','alice',?)",(json.dumps({"id":"message-a","isRead":False}),))
 c.commit();c.close();monkeypatch.setattr(actions,"source_database",lambda:str(path));monkeypatch.setattr(actions,"customer_principal",lambda u:(u["id"],{"v2UserId":u["id"]}))
 return {"id":"alice"},path
def call(user,name,args,key="key"):return asyncio.run(actions.tool(user,name,args,key))
def test_opportunity_create_idempotent_and_stage_transition(setup):
 user,_=setup
 a=call(user,"crm_opportunity_create",{"companyId":"company-a","title":"Website","amount":1200},"create-1")
 b=call(user,"crm_opportunity_create",{"companyId":"company-a","title":"Website","amount":1200},"create-1")
 assert a["id"]==b["id"] and a["version"]==1
 changed=call(user,"crm_opportunity_update",{"opportunityId":a["id"],"expectedVersion":1,"stageId":"closed_won"},"move-1")
 assert changed["status"]=="WON" and changed["probability"]==100 and changed["version"]==2
 with pytest.raises(HTTPException) as e:call(user,"crm_opportunity_update",{"opportunityId":a["id"],"expectedVersion":1,"title":"stale"},"move-2")
 assert e.value.status_code==409
def test_foreign_company_cannot_be_linked(setup):
 user,_=setup
 with pytest.raises(HTTPException) as e:call(user,"crm_opportunity_create",{"companyId":"company-b","title":"Foreign"},"foreign")
 assert e.value.status_code==404
def test_task_lifecycle_and_key_fingerprint(setup):
 user,_=setup
 task=call(user,"crm_task_create",{"title":"Call client","companyId":"company-a","priority":"HIGH"},"task-create")
 done=call(user,"crm_task_update",{"taskId":task["id"],"expectedVersion":1,"status":"COMPLETED"},"task-complete")
 assert done["status"]=="COMPLETED" and done["completedAt"]
 assert call(user,"crm_task_list",{})["total"]==1
 with pytest.raises(HTTPException) as e:call(user,"crm_task_create",{"title":"Different task"},"task-create")
 assert e.value.status_code==409
 assert call({"id":"bob"},"crm_task_list",{})["total"]==0
def test_pipeline_rejects_removing_in_use_stage(setup):
 user,_=setup
 call(user,"crm_opportunity_create",{"companyId":"company-a","title":"Website"},"opp")
 pipeline=call(user,"crm_pipeline_get",{})
 with pytest.raises(HTTPException) as e:call(user,"crm_pipeline_update",{"expectedVersion":pipeline["version"],"stages":[{"id":"new","name":"New","probability":10},{"id":"done","name":"Done","probability":100}]},"pipeline")
 assert e.value.status_code==409
def test_draft_edit_invalidates_approval_and_mark_read(setup):
 user,path=setup
 draft=call(user,"mailbox_draft_update",{"draftId":"draft-a","expectedRevision":1,"subject":"Updated","textBody":"New body"},"edit")
 assert draft["revision"]==2 and draft["subject"]=="Updated" and "approvalHash" not in draft
 with sqlite3.connect(path) as c:value=json.loads(c.execute("SELECT payload FROM records WHERE id='draft-a'").fetchone()[0]);assert "approvalHash" not in value
 assert call(user,"mailbox_mark_read",{"messageId":"message-a","isRead":True},"read")["isRead"] is True
 with pytest.raises(HTTPException) as e:call({"id":"bob"},"mailbox_draft_read",{"draftId":"draft-a"})
 assert e.value.status_code==404
def test_contact_primary_and_foreign_update_denied(setup):
 user,_=setup
 first=call(user,"crm_contact_save",{"companyId":"company-a","firstName":"Alex","email":"alex@example.com","isPrimary":True},"contact1")
 second=call(user,"crm_contact_save",{"companyId":"company-a","firstName":"Other","isPrimary":True},"contact2")
 with actions.db() as c:assert actions.get(c,"crm_contacts",first["id"],"alice")["isPrimary"] is False
 with pytest.raises(HTTPException) as e:call({"id":"bob"},"crm_contact_save",{"contactId":second["id"],"expectedVersion":1,"companyId":"company-b","firstName":"Hijack"},"foreign")
 assert e.value.status_code==404
