import json,sqlite3
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_customer_data as data
@pytest.fixture
def fixture(monkeypatch,tmp_path):
 path=tmp_path/"source.sqlite";c=sqlite3.connect(path);c.execute("CREATE TABLE records(collection TEXT,id TEXT,owner TEXT,payload TEXT,PRIMARY KEY(collection,id))")
 for collection,ident,owner,payload in [
  ("crm_companies","a","alice",{"id":"a","name":"Alpha","qualificationStatus":"QUALIFIED"}),
  ("crm_companies","b","bob",{"id":"b","name":"Beta"}),
  ("crm_contacts","ca","alice",{"id":"ca","companyId":"a","email":"client@example.com"}),
  ("crm_tasks","ta","alice",{"id":"ta","companyId":"a","title":"Call customer","status":"OPEN"}),
  ("mailbox-drafts","da","alice",{"id":"da","subject":"Alice draft","textBody":"private Alice text","approvalHash":"not-public"}),
  ("mailbox-drafts","db","bob",{"id":"db","subject":"Bob draft","textBody":"private Bob text"})]:
  c.execute("INSERT INTO records VALUES(?,?,?,?)",(collection,ident,owner,json.dumps(payload)))
 c.commit();c.close()
 monkeypatch.setattr(data,"source_database",lambda:str(path))
 monkeypatch.setattr(data,"customer_principal",lambda u:(u["id"],{"v2UserId":u["id"]}))
 return {"id":"alice"}
def test_crm_only_lists_current_owner(fixture):
 result=data.crm(q="",limit=50,offset=0,user=fixture)
 assert result["total"]==1 and result["items"][0]["name"]=="Alpha"
def test_foreign_company_detail_is_hidden(fixture):
 with pytest.raises(HTTPException) as error:data.company("b",fixture)
 assert error.value.status_code==404
def test_contact_and_task_details_are_owner_scoped(fixture):
 result=data.company("a",fixture)
 assert result["contacts"][0]["email"]=="client@example.com"
 assert result["tasks"][0]["title"]=="Call customer"
def test_drafts_are_owner_scoped_and_omit_approval_secret(fixture):
 result=data.drafts(fixture)
 assert result["total"]==1 and result["items"][0]["subject"]=="Alice draft"
 assert "approvalHash" not in json.dumps(result)
