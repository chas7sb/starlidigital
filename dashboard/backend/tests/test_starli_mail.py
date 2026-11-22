import asyncio,json,socket,sqlite3
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from open_webui.routers import starli_mail as mail,starli_customer_actions as actions
@pytest.fixture
def setup(monkeypatch,tmp_path):
 path=tmp_path/"records.sqlite";c=sqlite3.connect(path);c.execute("CREATE TABLE records(collection TEXT,id TEXT,owner TEXT,payload TEXT,PRIMARY KEY(collection,id))")
 c.execute("INSERT INTO records VALUES('mailbox-drafts','draft-a','alice',?)",(json.dumps({"id":"draft-a","revision":1,"to":[{"address":"client@example.com"}],"cc":[],"bcc":[{"address":"private@example.com"}],"subject":"Approved subject","textBody":"Approved body","references":[]}),));c.commit();c.close()
 monkeypatch.setattr(mail,"state_dir",lambda:tmp_path)
 monkeypatch.setattr(actions,"source_database",lambda:str(path))
 principal=lambda u:(u["id"],{"v2UserId":u["id"]})
 monkeypatch.setattr(mail,"customer_principal",principal);monkeypatch.setattr(actions,"customer_principal",principal)
 monkeypatch.setenv("WEBUI_SECRET_KEY","unit-test-mail-key")
 monkeypatch.setattr(mail,"resolve_public",lambda host,port:"93.184.216.34")
 user={"id":"alice","role":"user"};request=SimpleNamespace(headers={"authorization":"Bearer unit-test"})
 config=mail.AccountBody(email="alice@example.com",displayName="Alice",imapHost="imap.example.com",smtpHost="smtp.example.com",username="alice@example.com",password="mail-secret")
 asyncio.run(mail.save_account(config,request,user))
 return user,request,path
def test_credential_encryption_and_tenant_isolation(setup):
 user,_,_=setup
 assert mail.public_account("alice")["connected"] is True
 assert mail.public_account("bob")["connected"] is False
 with mail.db() as c:sealed=c.execute("SELECT sealed FROM accounts WHERE owner='alice'").fetchone()[0]
 assert "mail-secret" not in sealed and "mail-secret" not in json.dumps(mail.public_account("alice"))
def test_tls_ports_and_public_host_policy_fail_closed(setup,monkeypatch):
 user,request,_=setup
 with pytest.raises(HTTPException):asyncio.run(mail.save_account(mail.AccountBody(email="alice@example.com",imapHost="imap.example.com",smtpHost="smtp.example.com",username="alice",password="x",smtpPort=25),request,user))
 for host in ["localhost","mail.local","mail.internal","http://example.com","example.com/path"]:
  with pytest.raises(HTTPException):mail._host(host)
 # Exercise real DNS/IP validation without connecting a socket.
 monkeypatch.undo()
 monkeypatch.setattr(socket,"getaddrinfo",lambda *a,**k:[(socket.AF_INET,socket.SOCK_STREAM,6,"",("127.0.0.1",993))])
 with pytest.raises(HTTPException) as e:mail.resolve_public("mail.example.com",993)
 assert e.value.status_code==422
def test_connection_test_has_no_send_and_sync_is_deduplicated(setup,monkeypatch):
 user,request,path=setup;calls=[]
 monkeypatch.setattr(mail,"network_test",lambda c:{"imap":"AUTHENTICATED_TLS","smtp":"AUTHENTICATED_TLS","messageSent":False})
 assert asyncio.run(mail.test_connection(request,user))["messageSent"] is False
 message={"id":"synced-1","subject":"Inbound","textBody":"Test","isRead":False}
 monkeypatch.setattr(mail,"network_sync",lambda c,limit:[message])
 assert asyncio.run(mail.sync_mail(user))["messagesAdded"]==1
 assert asyncio.run(mail.sync_mail(user))["messagesAdded"]==0
 with sqlite3.connect(path) as c:row=c.execute("SELECT owner FROM records WHERE id='synced-1'").fetchone();assert row[0]=="alice"
def test_foreign_send_and_changed_draft_review_are_rejected(setup):
 user,request,path=setup
 action=asyncio.run(mail.prepare_send(user,"draft-a","prepare"))
 decision=mail.Decision(digest=action["digest"],decision="approve")
 with pytest.raises(HTTPException) as e:asyncio.run(mail.decide(action["id"],decision,request,{"id":"bob"}))
 assert e.value.status_code==404
 with sqlite3.connect(path) as c:
  draft=json.loads(c.execute("SELECT payload FROM records WHERE id='draft-a'").fetchone()[0]);draft["revision"]=2;draft["textBody"]="Changed";c.execute("UPDATE records SET payload=? WHERE id='draft-a'",(json.dumps(draft),))
 with pytest.raises(HTTPException) as e:asyncio.run(mail.decide(action["id"],decision,request,user))
 assert e.value.status_code==409
def test_send_executes_exact_snapshot_once_and_does_not_claim_delivery(setup,monkeypatch):
 user,request,path=setup;calls=[]
 def fake(config,snapshot,message_id,preflight):
  calls.append(snapshot)
  return {"smtpAccepted":True,"acceptedRecipients":["client@example.com","private@example.com"],"refusedRecipients":[],"deliveryVerified":False,"messageId":message_id}
 monkeypatch.setattr(mail,"network_send",fake)
 action=asyncio.run(mail.prepare_send(user,"draft-a","prepare"))
 decision=mail.Decision(digest=action["digest"],decision="approve")
 result=asyncio.run(mail.decide(action["id"],decision,request,user))
 assert result["status"]=="SMTP_ACCEPTED" and result["result"]["deliveryVerified"] is False
 assert calls[0]["textBody"]=="Approved body" and calls[0]["from"]=="alice@example.com"
 asyncio.run(mail.decide(action["id"],decision,request,user));assert len(calls)==1
 again=asyncio.run(mail.prepare_send(user,"draft-a","changed-key"))
 assert again["id"]==action["id"]
 with sqlite3.connect(path) as c:row=c.execute("SELECT payload FROM records WHERE collection='mailbox-messages'").fetchone();assert json.loads(row[0])["status"]=="SENT_UNCONFIRMED"
def test_uncertain_outcome_cannot_replay_with_another_key(setup,monkeypatch):
 user,request,_=setup;calls=[]
 def fail(*a):calls.append(1);raise TimeoutError()
 monkeypatch.setattr(mail,"network_send",fail)
 action=asyncio.run(mail.prepare_send(user,"draft-a","prepare"))
 result=asyncio.run(mail.decide(action["id"],mail.Decision(digest=action["digest"],decision="approve"),request,user))
 assert result["status"]=="UNCERTAIN"
 again=asyncio.run(mail.prepare_send(user,"draft-a","another-key"));assert again["id"]==action["id"]
 assert len(calls)==1
def test_smtp_envelope_has_bcc_but_message_header_does_not(setup,monkeypatch):
 user,_,_=setup;seen={}
 class FakeSMTP:
  def send_message(self,message,from_addr,to_addrs):seen.update(message=message,from_addr=from_addr,to_addrs=to_addrs);return {}
  def quit(self):pass
 monkeypatch.setattr(mail,"_smtp",lambda config:FakeSMTP())
 config=mail._load("alice");snapshot=mail._snapshot(user,mail._draft(user,"draft-a"),config)
 result=mail.network_send(config,snapshot,"<test@example.com>",lambda:None)
 assert "Bcc" not in seen["message"] and "private@example.com" in seen["to_addrs"]
 assert result["smtpAccepted"] is True and result["deliveryVerified"] is False
def test_mime_parser_does_not_return_html_scripts_or_attachment_bytes(setup):
 raw=b"From: Client <client@example.com>\r\nTo: alice@example.com\r\nSubject: Example\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello</p><script>secret-script()</script>"
 value=mail._parse_message(raw,"account",1,1)
 assert "Hello" in value["textBody"] and "secret-script" not in value["textBody"]
 assert "sanitizedHtmlBody" not in value

def test_pinned_tls_sockets_keep_original_hostname_without_dns_relookup(setup,monkeypatch):
 calls=[];raw=SimpleNamespace(close=lambda:None)
 monkeypatch.setattr(socket,"create_connection",lambda address,timeout:(calls.append(address) or raw))
 class Context:
  def wrap_socket(self,sock,server_hostname):calls.append(server_hostname);return "tls"
 smtp=object.__new__(mail._PinnedSMTPSSL);smtp._pin="93.184.216.34";smtp.context=Context()
 assert smtp._get_socket("smtp.example.com",465,10)=="tls"
 imap=object.__new__(mail._PinnedIMAP);imap._pin="93.184.216.34";imap.host="imap.example.com";imap.port=993;imap.ssl_context=Context()
 assert imap._create_socket(10)=="tls"
 assert calls==[("93.184.216.34",465),"smtp.example.com",("93.184.216.34",993),"imap.example.com"]
def test_uncertain_draft_is_not_replayed_after_reconnecting_account(setup,monkeypatch):
 user,request,_=setup
 def fail(*a):raise TimeoutError()
 monkeypatch.setattr(mail,"network_send",fail)
 action=asyncio.run(mail.prepare_send(user,"draft-a","prepare"))
 asyncio.run(mail.decide(action["id"],mail.Decision(digest=action["digest"],decision="approve"),request,user))
 with mail.db() as c:c.execute("UPDATE accounts SET version=version+1 WHERE owner='alice'")
 again=asyncio.run(mail.prepare_send(user,"draft-a","new-key-after-reconnect"))
 assert again["id"]==action["id"] and again["status"]=="UNCERTAIN"
def test_remote_mark_read_requires_owned_account_uid_and_updates_local_flag(setup,monkeypatch):
 user,_,path=setup;config=mail._load("alice");calls=[]
 message={"id":"remote-message","accountId":config["accountId"],"folder":"INBOX","uid":42,"uidValidity":5,"isRead":False}
 with actions.db() as c:actions.put(c,"mailbox-messages",message,"alice")
 monkeypatch.setattr(mail,"network_mark_read",lambda config,message,flag:(calls.append((message["uid"],flag)) or {"remoteUpdated":True}))
 result=asyncio.run(mail.mark_remote_read(user,"remote-message",True))
 assert result["remoteUpdated"] is True and calls==[(42,True)]
 with actions.db() as c:assert actions.get(c,"mailbox-messages","remote-message","alice")["isRead"] is True
 with pytest.raises(HTTPException):asyncio.run(mail.mark_remote_read({"id":"bob"},"remote-message",True))
