"""Per-account IMAPS/SMTP mail. TLS-only, public-host pinned sockets and reviewed sends."""
import asyncio,base64,email,email.policy,hashlib,imaplib,ipaddress,json,re,secrets,smtplib,socket,sqlite3,ssl,time,uuid
from contextlib import contextmanager
from datetime import datetime,timezone
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses,parsedate_to_datetime
from html.parser import HTMLParser
from fastapi import APIRouter,Depends,HTTPException,Request
from pydantic import BaseModel,Field
from cryptography.fernet import Fernet
from open_webui.utils.auth import get_verified_user
from open_webui.routers.starli_platform import customer_principal
from open_webui.routers.starli_state import state_dir
from open_webui.routers import starli_customer_actions as records

router=APIRouter()
MAX_MESSAGE=262144
def uid(user):return customer_principal(user)[0]
def source_owner(user):return customer_principal(user)[1]["v2UserId"]
def guard(request):
 auth=request.headers.get("authorization","")
 if not auth.startswith("Bearer ") or not auth[7:].strip():raise HTTPException(403,"Bearer authentication required")
def cipher():
 import os
 secret=os.getenv("WEBUI_SECRET_KEY")
 if not secret:raise HTTPException(503,"Mailbox encryption is not configured")
 return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("mail-account:"+secret).encode()).digest()))
@contextmanager
def db():
 root=state_dir();root.mkdir(parents=True,exist_ok=True,mode=0o700);path=root/"customer-mail.sqlite"
 c=sqlite3.connect(path,timeout=10);c.row_factory=sqlite3.Row;path.chmod(0o600)
 c.execute("CREATE TABLE IF NOT EXISTS accounts(owner TEXT PRIMARY KEY,sealed TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,updated REAL NOT NULL)")
 c.execute("CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,idem TEXT NOT NULL,fingerprint TEXT NOT NULL,snapshot TEXT NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created REAL NOT NULL,UNIQUE(owner,idem))")
 c.execute("CREATE INDEX IF NOT EXISTS actions_fingerprint ON actions(owner,fingerprint,status)")
 c.execute("CREATE TABLE IF NOT EXISTS sync_locks(owner TEXT PRIMARY KEY,token TEXT NOT NULL,expires REAL NOT NULL)")
 try:
  with c:yield c
 finally:c.close()
def _host(value):
 if not isinstance(value,str) or len(value)>253:raise HTTPException(422,"Invalid mail server hostname")
 value=value.strip().lower().rstrip(".")
 if not re.fullmatch(r"(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?",value) or value.endswith((".localhost",".local",".internal",".home",".invalid",".test",".example")):raise HTTPException(422,"Use a public mail server hostname")
 return value
def resolve_public(host,port):
 host=_host(host)
 try:values=socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)
 except OSError:raise HTTPException(422,"Mail server hostname could not be resolved") from None
 addresses=list(dict.fromkeys(row[4][0] for row in values))
 if not addresses or any(not ipaddress.ip_address(v).is_global or ipaddress.ip_address(v).is_multicast or ipaddress.ip_address(v).is_reserved for v in addresses):raise HTTPException(422,"Private, local and reserved mail server addresses are not allowed")
 return addresses[0]
def clean_address(value):
 return records.addresses([value])[0]["address"]
def _credentials(value,label):
 if not isinstance(value,str) or not 1<=len(value)<=4096 or any(c in value for c in ("\r","\n","\0")):raise HTTPException(422,"Invalid "+label)
 return value
def _load(owner):
 with db() as c:row=c.execute("SELECT * FROM accounts WHERE owner=?",(owner,)).fetchone()
 if not row:raise HTTPException(409,"Connect your own mailbox in account settings first")
 try:config=json.loads(cipher().decrypt(row["sealed"].encode()))
 except Exception:raise HTTPException(503,"Stored mailbox credentials are unavailable") from None
 return {**config,"version":row["version"],"status":row["status"]}
def public_account(owner):
 try:config=_load(owner)
 except HTTPException as e:
  if e.status_code==409:return {"connected":False,"status":"CONNECTION_REQUIRED","settingsPath":"/starli/mailbox"}
  raise
 return {"connected":True,"status":config["status"],"email":config["email"],"displayName":config.get("displayName",""),"imapHost":config["imapHost"],"smtpHost":config["smtpHost"],"smtpPort":config["smtpPort"],"username":config["username"],"smtpUsername":config.get("smtpUsername",config["username"]),"version":config["version"],"settingsPath":"/starli/mailbox"}
class AccountBody(BaseModel):
 email:str=Field(min_length=3,max_length=254)
 displayName:str=Field(default="",max_length=100)
 imapHost:str=Field(min_length=3,max_length=253)
 smtpHost:str=Field(min_length=3,max_length=253)
 smtpPort:int=Field(default=465)
 username:str=Field(min_length=1,max_length=320)
 password:str=Field(default="",max_length=4096)
 smtpUsername:str|None=Field(default=None,max_length=320)
 smtpPassword:str|None=Field(default=None,max_length=4096)
 expectedVersion:int|None=None
class _PinnedIMAP(imaplib.IMAP4_SSL):
 def __init__(self,host,pin):
  self._pin=pin
  super().__init__(host=host,port=993,ssl_context=ssl.create_default_context(),timeout=20)
 def _create_socket(self,timeout):
  raw=socket.create_connection((self._pin,self.port),timeout)
  try:return self.ssl_context.wrap_socket(raw,server_hostname=self.host)
  except BaseException:raw.close();raise
 def read(self,size):
  if size>MAX_MESSAGE:raise imaplib.IMAP4.error("MESSAGE_EXCEEDS_MAILBOX_LIMIT")
  return super().read(size)
class _PinnedSMTP(smtplib.SMTP):
 def __init__(self,host,port,pin):
  self._pin=pin
  super().__init__(host=host,port=port,timeout=20)
 def _get_socket(self,host,port,timeout):return socket.create_connection((self._pin,port),timeout)
class _PinnedSMTPSSL(smtplib.SMTP_SSL):
 def __init__(self,host,port,pin):
  self._pin=pin
  super().__init__(host=host,port=port,timeout=20,context=ssl.create_default_context())
 def _get_socket(self,host,port,timeout):
  raw=socket.create_connection((self._pin,port),timeout)
  try:return self.context.wrap_socket(raw,server_hostname=host)
  except BaseException:raw.close();raise
def _imap(config):
 client=_PinnedIMAP(config["imapHost"],resolve_public(config["imapHost"],993))
 try:client.login(config["username"],config["password"]);return client
 except BaseException:
  try:client.shutdown()
  except Exception:pass
  raise
def _smtp(config):
 host=config["smtpHost"];port=config["smtpPort"];pin=resolve_public(host,port)
 client=_PinnedSMTPSSL(host,port,pin) if port==465 else _PinnedSMTP(host,port,pin)
 try:
  client.ehlo()
  if port==587:client.starttls(context=ssl.create_default_context());client.ehlo()
  client.login(config.get("smtpUsername") or config["username"],config.get("smtpPassword") or config["password"])
  return client
 except BaseException:
  try:client.close()
  except Exception:pass
  raise
def network_test(config):
 imap=None;smtp=None
 try:
  imap=_imap(config);smtp=_smtp(config);return {"imap":"AUTHENTICATED_TLS","smtp":"AUTHENTICATED_TLS","messageSent":False}
 finally:
  if imap:
   try:imap.logout()
   except Exception:pass
  if smtp:
   try:smtp.quit()
   except Exception:smtp.close()
def network_mark_read(config,message,is_read):
 client=_imap(config)
 try:
  typ,_=client.select("INBOX",readonly=False)
  if typ!="OK":raise RuntimeError("INBOX_UNAVAILABLE")
  values=client.response("UIDVALIDITY")[1] or [b"0"];validity=int(values[0] or b"0")
  if validity!=message.get("uidValidity"):raise RuntimeError("MAILBOX_UID_VALIDITY_CHANGED")
  typ,_=client.uid("store",str(message["uid"]),"+FLAGS.SILENT" if is_read else "-FLAGS.SILENT",r"(\Seen)")
  if typ!="OK":raise RuntimeError("MAIL_FLAG_UPDATE_FAILED")
  return {"remoteUpdated":True}
 finally:
  try:client.logout()
  except Exception:pass
async def mark_remote_read(user,message_id,is_read):
 if not isinstance(is_read,bool):raise HTTPException(422,"isRead must be true or false")
 owner=uid(user);config=_load(owner);source=source_owner(user)
 with records.db() as c:message=records.get(c,"mailbox-messages",message_id,source)
 if message.get("folder")!="INBOX" or message.get("accountId")!=config["accountId"] or not isinstance(message.get("uid"),int) or message["uid"]<1 or not isinstance(message.get("uidValidity"),int) or message["uidValidity"]<1:raise HTTPException(409,"This message has no verified UID in the connected inbox")
 try:result=await asyncio.to_thread(network_mark_read,config,message,is_read)
 except Exception as e:raise HTTPException(502,_network_error(e)) from None
 current=_load(owner)
 if current["version"]!=config["version"]:raise HTTPException(409,"Mailbox settings changed during the flag update")
 with records.db() as c:
  c.execute("BEGIN IMMEDIATE");message=records.get(c,"mailbox-messages",message_id,source);message.update(isRead=is_read,updatedAt=records.now());records.put(c,"mailbox-messages",message,source)
 return {"messageId":message_id,"isRead":is_read,**result}

class _PlainHTML(HTMLParser):
 def __init__(self):super().__init__();self.out=[];self.suppressed=0
 def handle_starttag(self,tag,attrs):
  if tag in ("script","style"):self.suppressed+=1
  elif tag in ("p","div","br","li"):self.out.append("\n")
 def handle_endtag(self,tag):
  if tag in ("script","style"):self.suppressed=max(0,self.suppressed-1)
 def handle_data(self,value):
  if not self.suppressed:self.out.append(value)
def _parse_message(raw,account_id,number,validity):
 message=BytesParser(policy=email.policy.default).parsebytes(raw)
 def address_list(value):return [{"name":name[:200],"address":addr[:254]} for name,addr in getaddresses([str(value or "")]) if addr][:100]
 body="";html_body="";attachments=[]
 for index,part in enumerate(message.walk()):
  if index>100:break
  disposition=part.get_content_disposition();typ=part.get_content_type()
  if disposition=="attachment":
   attachments.append({"id":"attachment-"+str(index),"filename":str(part.get_filename() or "attachment")[:200],"mimeType":typ,"byteSize":len(part.get_payload(decode=True) or b"")});continue
  if typ in ("text/plain","text/html"):
   try:value=part.get_content()
   except Exception:value=(part.get_payload(decode=True) or b"").decode("utf8",errors="replace")
   if not isinstance(value,str):continue
   if typ=="text/plain" and not body:body=value[:50000]
   if typ=="text/html" and not html_body:html_body=value[:50000]
 if not body and html_body:
  parser=_PlainHTML()
  try:parser.feed(html_body);body="".join(parser.out)[:50000]
  except Exception:body="HTML message could not be converted to text."
 try:date=parsedate_to_datetime(str(message.get("date"))).astimezone(timezone.utc).isoformat()
 except Exception:date=datetime.now(timezone.utc).isoformat()
 ident="mailmsg-"+hashlib.sha256((account_id+":"+str(validity)+":"+str(number)).encode()).hexdigest()
 message_id=str(message.get("message-id") or ident)[:500];references=str(message.get("references") or "").split()[-30:]
 sender=address_list(message.get("from"))
 return {"id":ident,"accountId":account_id,"folder":"INBOX","uid":int(number),"uidValidity":int(validity),"messageId":message_id,"inReplyTo":str(message.get("in-reply-to") or "")[:500],"references":references,"threadId":(references[0] if references else str(message.get("in-reply-to") or message_id))[:500],"direction":"INBOUND","from":sender[0] if sender else {"address":"","name":""},"to":address_list(message.get("to")),"cc":address_list(message.get("cc")),"subject":str(message.get("subject") or "")[:998],"snippet":" ".join(body.split())[:200],"textBody":body,"hasHtml":bool(html_body),"hasRemoteImages":False,"attachments":attachments[:50],"status":"RECEIVED","isRead":False,"isStarred":False,"date":date,"createdAt":records.now(),"updatedAt":records.now()}
def network_sync(config,limit):
 client=_imap(config)
 try:
  typ,_=client.select("INBOX",readonly=True)
  if typ!="OK":raise RuntimeError("INBOX_UNAVAILABLE")
  validity_response=client.response("UIDVALIDITY")[1] or [b"0"];validity=int(validity_response[0] or b"0")
  typ,data=client.uid("search",None,"ALL")
  if typ!="OK":raise RuntimeError("MAIL_SEARCH_FAILED")
  ids=(data[0] or b"").split()[-limit:]
  out=[]
  for ident in ids:
   if not ident.isdigit():continue
   typ,size_data=client.uid("fetch",ident,"(RFC822.SIZE)")
   summary=b" ".join(v for v in size_data if isinstance(v,bytes))
   match=re.search(rb"RFC822.SIZE\s+(\d+)",summary)
   if typ!="OK" or not match or int(match.group(1))>MAX_MESSAGE:continue
   typ,fetched=client.uid("fetch",ident,"(BODY.PEEK[])")
   if typ!="OK":continue
   raw=next((v[1] for v in fetched if isinstance(v,tuple) and len(v)==2 and isinstance(v[1],bytes)),None)
   if raw and len(raw)<=MAX_MESSAGE:out.append(_parse_message(raw,config["accountId"],ident.decode(),validity))
  return out
 finally:
  try:client.logout()
  except Exception:pass
def recover_sends(c):
 c.execute("UPDATE actions SET status='UNCERTAIN',result=? WHERE status='EXECUTING' AND COALESCE(json_extract(result,'$.startedAt'),created)<?",(json.dumps({"smtpAccepted":None,"deliveryVerified":False,"message":"The worker did not finish its receipt. Inspect your provider before retrying; no automatic replay."}),time.time()-900))
def _action(row):return {k:json.loads(row[k]) if k in ("snapshot","result") and row[k] else row[k] for k in ("id","digest","snapshot","status","result","created")}
def _draft(user,draft_id):
 with records.db() as c:return records.get(c,"mailbox-drafts",draft_id,source_owner(user))
def _snapshot(user,draft,config):
 recipients=records.addresses(draft.get("to") or [])
 cc=records.addresses(draft.get("cc")) if draft.get("cc") else [];bcc=records.addresses(draft.get("bcc")) if draft.get("bcc") else []
 if len({v["address"].lower() for group in (recipients,cc,bcc) for v in group})>100:raise HTTPException(422,"A reviewed email can have at most 100 recipients")
 subject=records.text(draft.get("subject"),"Subject",998);body=records.text(draft.get("textBody"),"Message",50000)
 if "\r" in subject or "\n" in subject:raise HTTPException(422,"Subject cannot contain newlines")
 if draft.get("attachments"):raise HTTPException(422,"Attachment sending is not connected yet; remove attachments or send through your mailbox provider")
 return {"draftId":draft["id"],"revision":draft.get("revision",1),"accountId":config["accountId"],"accountVersion":config["version"],"sourceOwner":source_owner(user),"from":config["email"],"displayName":config.get("displayName",""),"to":recipients,"cc":cc,"bcc":bcc,"subject":subject,"textBody":body,"inReplyTo":str(draft.get("inReplyTo") or "")[:500],"references":draft.get("references") or []}
def _snapshot_hash(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":")).encode()).hexdigest()
async def prepare_send(user,draft_id,key):
 if not isinstance(key,str) or not 1<=len(key)<=256:raise HTTPException(422,"A stable operation key is required")
 owner=uid(user);snapshot=_snapshot(user,_draft(user,draft_id),_load(owner));digest=_snapshot_hash(snapshot)
 with db() as c:
  c.execute("BEGIN IMMEDIATE");row=c.execute("SELECT * FROM actions WHERE owner=? AND idem=?",(owner,key)).fetchone()
  if row:
   if row["fingerprint"]!=digest:raise HTTPException(409,"Operation key was already used for another draft revision")
   return _action(row)
  prior_revision=c.execute("SELECT * FROM actions WHERE owner=? AND json_extract(snapshot,'$.draftId')=? AND json_extract(snapshot,'$.revision')=? AND status IN ('EXECUTING','UNCERTAIN','SMTP_ACCEPTED') ORDER BY created LIMIT 1",(owner,snapshot["draftId"],snapshot["revision"])).fetchone()
  if prior_revision:return {**_action(prior_revision),"reused":True}
  prior=c.execute("SELECT * FROM actions WHERE owner=? AND fingerprint=? AND status IN ('PENDING','EXECUTING','UNCERTAIN','SMTP_ACCEPTED') ORDER BY created LIMIT 1",(owner,digest)).fetchone()
  if prior:return {**_action(prior),"reused":True}
  ident="mail-send-"+uuid.uuid4().hex;c.execute("INSERT INTO actions VALUES(?,?,?,?,?,?,'PENDING',NULL,?)",(ident,owner,key,digest,json.dumps(snapshot),digest,time.time()))
  return _action(c.execute("SELECT * FROM actions WHERE id=?",(ident,)).fetchone())
def network_send(config,snapshot,message_id,preflight):
 client=_smtp(config)
 try:
  preflight()
  message=EmailMessage();message["From"]=email.utils.formataddr((config.get("displayName",""),config["email"]));message["To"]=", ".join(v["address"] for v in snapshot["to"])
  if snapshot["cc"]:message["Cc"]=", ".join(v["address"] for v in snapshot["cc"])
  message["Subject"]=snapshot["subject"];message["Message-ID"]=message_id;message["Date"]=email.utils.format_datetime(datetime.now(timezone.utc))
  if snapshot["inReplyTo"] and not any(c in snapshot["inReplyTo"] for c in "\r\n"):message["In-Reply-To"]=snapshot["inReplyTo"]
  references=" ".join(str(v) for v in snapshot["references"])[-2000:]
  if references and not any(c in references for c in "\r\n"):message["References"]=references
  message.set_content(snapshot["textBody"])
  recipients=list(dict.fromkeys(v["address"] for group in ("to","cc","bcc") for v in snapshot[group]))
  refused=client.send_message(message,from_addr=config["email"],to_addrs=recipients)
  accepted=[v for v in recipients if v not in refused]
  return {"smtpAccepted":bool(accepted),"partialAcceptance":bool(accepted and refused),"acceptedRecipients":accepted,"refusedRecipients":[{"address":k,"code":v[0]} for k,v in refused.items()],"deliveryVerified":False,"messageId":message_id}
 finally:
  try:client.quit()
  except Exception:client.close()
def _live_preflight(user,snapshot):
 from open_webui.models.users import Users
 current=Users.get_user_by_id(uid(user))
 if not current:raise HTTPException(403,"Account is no longer available")
 config=_load(uid(current))
 if config["version"]!=snapshot["accountVersion"] or config["accountId"]!=snapshot["accountId"] or source_owner(current)!=snapshot["sourceOwner"]:raise HTTPException(409,"Mailbox connection changed after review")
 if _snapshot_hash(_snapshot(current,_draft(current,snapshot["draftId"]),config))!=_snapshot_hash(snapshot):raise HTTPException(409,"Draft changed after review")
def _network_error(error):return "Authentication or TLS connection failed. Check server settings and an app password if your provider requires one." if isinstance(error,(imaplib.IMAP4.error,smtplib.SMTPAuthenticationError,ssl.SSLError)) else "Mail server request failed ("+type(error).__name__+"). Credentials were not returned."
@router.get("")
def account(user=Depends(get_verified_user)):return public_account(uid(user))
@router.put("")
async def save_account(body:AccountBody,request:Request,user=Depends(get_verified_user)):
 guard(request);owner=uid(user)
 if body.smtpPort not in (465,587):raise HTTPException(422,"SMTP must use TLS port 465 or STARTTLS port 587")
 imap_host=_host(body.imapHost);smtp_host=_host(body.smtpHost)
 await asyncio.gather(asyncio.to_thread(resolve_public,imap_host,993),asyncio.to_thread(resolve_public,smtp_host,body.smtpPort))
 existing=None
 try:existing=_load(owner)
 except HTTPException as e:
  if e.status_code!=409:raise
 if existing and body.expectedVersion!=existing["version"]:raise HTTPException(409,"Mailbox settings changed; reload before saving")
 password=body.password or (existing.get("password") if existing else "")
 if not password:raise HTTPException(422,"Enter your mailbox password or app password")
 config={"email":clean_address(body.email),"displayName":body.displayName.strip(),"imapHost":imap_host,"smtpHost":smtp_host,"smtpPort":body.smtpPort,"username":_credentials(body.username,"username"),"password":_credentials(password,"password"),"smtpUsername":_credentials(body.smtpUsername,"SMTP username") if body.smtpUsername else body.username,"smtpPassword":_credentials(body.smtpPassword,"SMTP password") if body.smtpPassword else password}
 if any(c in config["displayName"] for c in "\r\n\0"):raise HTTPException(422,"Invalid sender name")
 if config["smtpUsername"]!=config["username"] and not body.smtpPassword and existing:
  config["smtpPassword"]=existing.get("smtpPassword") or config["password"]
 config["accountId"]="mailaccount-"+hashlib.sha256((owner+":"+config["email"].lower()+":"+imap_host).encode()).hexdigest()[:32]
 with db() as c:
  c.execute("BEGIN IMMEDIATE");current=c.execute("SELECT version FROM accounts WHERE owner=?",(owner,)).fetchone()
  if current and (not existing or current["version"]!=existing["version"]):raise HTTPException(409,"Mailbox settings changed; reload before saving")
  version=current["version"]+1 if current else 1
  c.execute("INSERT INTO accounts VALUES(?,?,?,'CONFIGURED',?) ON CONFLICT(owner) DO UPDATE SET sealed=excluded.sealed,version=excluded.version,status=excluded.status,updated=excluded.updated",(owner,cipher().encrypt(json.dumps(config).encode()).decode(),version,time.time()))
 return public_account(owner)
@router.delete("")
def disconnect(request:Request,user=Depends(get_verified_user)):
 guard(request);owner=uid(user)
 with db() as c:
  c.execute("DELETE FROM accounts WHERE owner=?",(owner,))
  c.execute("UPDATE actions SET status='REJECTED' WHERE owner=? AND status='PENDING'",(owner,))
 return {"connected":False,"status":"DISCONNECTED"}
@router.post("/test")
async def test_connection(request:Request,user=Depends(get_verified_user)):
 guard(request);owner=uid(user);config=_load(owner)
 try:result=await asyncio.to_thread(network_test,config)
 except Exception as e:
  with db() as c:c.execute("UPDATE accounts SET status='UNVERIFIED',updated=? WHERE owner=? AND version=?",(time.time(),owner,config["version"]))
  raise HTTPException(502,_network_error(e)) from None
 with db() as c:c.execute("UPDATE accounts SET status='VERIFIED',updated=? WHERE owner=? AND version=?",(time.time(),owner,config["version"]))
 return {**result,"account":public_account(owner)}
async def sync_mail(user,limit=20):
 if not isinstance(limit,int) or isinstance(limit,bool) or not 1<=limit<=30:raise HTTPException(422,"Sync limit must be 1–30")
 owner=uid(user);config=_load(owner);token=secrets.token_hex(16)
 with db() as c:
  c.execute("BEGIN IMMEDIATE");lock=c.execute("SELECT expires FROM sync_locks WHERE owner=?",(owner,)).fetchone()
  if lock and lock["expires"]>time.time():raise HTTPException(409,"Mailbox synchronization is already running")
  c.execute("INSERT INTO sync_locks VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,expires=excluded.expires",(owner,token,time.time()+900))
 try:
  try:incoming=await asyncio.to_thread(network_sync,config,limit)
  except Exception as e:raise HTTPException(502,_network_error(e)) from None
  current=_load(owner)
  if current["version"]!=config["version"]:raise HTTPException(409,"Mailbox connection changed during synchronization")
  source=source_owner(user);added=0
  with records.db() as c:
   c.execute("BEGIN IMMEDIATE")
   for message in incoming:
    old=c.execute("SELECT owner,payload FROM records WHERE collection='mailbox-messages' AND id=?",(message["id"],)).fetchone()
    if old:
     if old["owner"]!=source:raise HTTPException(409,"Mailbox message ownership conflict")
     continue
    records.put(c,"mailbox-messages",message,source);added+=1
  return {"status":"SYNCED","messagesRead":len(incoming),"messagesAdded":added,"remoteMessagesChanged":False}
 finally:
  with db() as c:c.execute("DELETE FROM sync_locks WHERE owner=? AND token=?",(owner,token))
class SyncBody(BaseModel):
 limit:int=Field(default=20,ge=1,le=30)
@router.post("/sync")
async def sync(body:SyncBody,request:Request,user=Depends(get_verified_user)):
 guard(request);return await sync_mail(user,body.limit)
@router.get("/actions")
def actions(user=Depends(get_verified_user)):
 with db() as c:
  recover_sends(c)
  return {"items":[_action(row) for row in c.execute("SELECT * FROM actions WHERE owner=? ORDER BY created DESC LIMIT 100",(uid(user),))]}
class PrepareBody(BaseModel):
 draftId:str=Field(min_length=1,max_length=160)
 operationKey:str=Field(min_length=1,max_length=256)
@router.post("/actions")
async def prepare(body:PrepareBody,request:Request,user=Depends(get_verified_user)):
 guard(request);return await prepare_send(user,body.draftId,body.operationKey)
class Decision(BaseModel):
 digest:str=Field(min_length=64,max_length=64)
 decision:str=Field(pattern="^(approve|reject)$")
@router.post("/actions/{ident}/decision")
async def decide(ident:str,body:Decision,request:Request,user=Depends(get_verified_user)):
 guard(request);owner=uid(user)
 with db() as c:
  c.execute("BEGIN IMMEDIATE");row=c.execute("SELECT * FROM actions WHERE id=? AND owner=?",(ident,owner)).fetchone()
  if not row:raise HTTPException(404,"Mail action not found")
  if row["digest"]!=body.digest:raise HTTPException(409,"Reviewed mail action changed")
  if row["status"]!="PENDING":return _action(row)
  if body.decision=="reject":c.execute("UPDATE actions SET status='REJECTED' WHERE id=?",(ident,))
  else:
   if time.time()-row["created"]>3600:raise HTTPException(409,"Mail review expired; prepare a fresh draft review")
   snapshot=json.loads(row["snapshot"]);config=_load(owner)
   if _snapshot_hash(_snapshot(user,_draft(user,snapshot["draftId"]),config))!=row["digest"]:raise HTTPException(409,"Draft or account changed after review; prepare a new send")
   recover_sends(c)
   active=c.execute("SELECT owner FROM actions WHERE status='EXECUTING'").fetchall()
   if len(active)>=8 or any(v["owner"]==owner for v in active):raise HTTPException(429,"A mail send is already active; wait for its receipt before sending another message")
   recent=c.execute("SELECT count(*) FROM actions WHERE owner=? AND status IN ('SMTP_ACCEPTED','UNCERTAIN') AND COALESCE(json_extract(result,'$.startedAt'),created)>?",(owner,time.time()-3600)).fetchone()[0]
   if recent>=100:raise HTTPException(429,"Your hourly mail-send allowance has been reached")
   started=time.time()
   c.execute("UPDATE actions SET status='EXECUTING',result=? WHERE id=?",(json.dumps({"startedAt":started}),ident))
 if body.decision=="reject":
  with db() as c:return _action(c.execute("SELECT * FROM actions WHERE id=?",(ident,)).fetchone())
 message_id="<"+ident+"@"+config["email"].split("@",1)[1]+">"
 try:
  result=await asyncio.to_thread(network_send,config,snapshot,message_id,lambda:_live_preflight(user,snapshot))
  state="SMTP_ACCEPTED" if result.get("smtpAccepted") else "FAILED"
  if result.get("smtpAccepted"):
   sent={"id":"sent-"+ident,"accountId":config["accountId"],"folder":"Sent","messageId":message_id,"threadId":snapshot.get("inReplyTo") or message_id,"direction":"OUTBOUND","from":{"address":snapshot["from"],"name":snapshot["displayName"]},"to":snapshot["to"],"cc":snapshot["cc"],"subject":snapshot["subject"],"snippet":" ".join(snapshot["textBody"].split())[:200],"textBody":snapshot["textBody"],"attachments":[],"status":"SENT_UNCONFIRMED","isRead":True,"date":records.now(),"createdAt":records.now(),"updatedAt":records.now()}
   with records.db() as c:records.put(c,"mailbox-messages",sent,snapshot["sourceOwner"])
 except Exception:
  state="UNCERTAIN";result={"smtpAccepted":None,"deliveryVerified":False,"messageId":message_id,"message":"The send outcome is uncertain. Check your mailbox provider using this Message-ID before retrying. This action will not be sent again."}
 with db() as c:
  result={**result,"startedAt":started}
  c.execute("UPDATE actions SET status=?,result=? WHERE id=? AND owner=?",(state,json.dumps(result),ident,owner));return _action(c.execute("SELECT * FROM actions WHERE id=?",(ident,)).fetchone())
TOOL_SCHEMAS=[
 {"name":"mail_mark_read","description":"Set read/unread on your connected IMAP inbox and local workspace after verifying the stored account, message UID and UIDVALIDITY.","inputSchema":{"type":"object","properties":{"messageId":{"type":"string"},"isRead":{"type":"boolean"}},"required":["messageId","isRead"]}},

 {"name":"mail_connection","description":"Inspect your own mailbox connection. Passwords are entered only in the native Mailbox connection form, never in chat.","inputSchema":{"type":"object","properties":{}}},
 {"name":"mail_sync","description":"Read a bounded batch from your connected IMAPS inbox into your customer workspace without marking remote mail read.","inputSchema":{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":30}}}},
 {"name":"mail_prepare_send","description":"Prepare an exact saved draft for the user's native send review. Does not send email; only the user can confirm the reviewed recipients, sender and body.","inputSchema":{"type":"object","properties":{"draftId":{"type":"string"},"operationKey":{"type":"string"}},"required":["draftId"]}},
 {"name":"mail_send_actions","description":"List your reviewed sends and truthful SMTP acceptance/uncertain receipts. SMTP acceptance is not proof of delivery.","inputSchema":{"type":"object","properties":{}}}
]
def schema(name):return next((v for v in TOOL_SCHEMAS if v["name"]==name),None)
async def tool(user,name,args,key=None):
 if name=="mail_mark_read":return await mark_remote_read(user,args.get("messageId"),args.get("isRead"))
 if name=="mail_connection":return public_account(uid(user))
 if name=="mail_sync":return await sync_mail(user,args.get("limit",20))
 if name=="mail_prepare_send":return await prepare_send(user,args.get("draftId"),key or args.get("operationKey"))
 if name=="mail_send_actions":return actions(user)
 raise HTTPException(404,"Unknown mailbox tool")
