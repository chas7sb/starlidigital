"""Agent6 entry points: server-bound context only. Not HTTP client-callable."""
import json
import uuid
from panel_api import PanelService, POLICY, VERSION, PanelError, ref

CONTEXT_KEYS={'companyId','actorUserId','botId','conversationId','assistantMessageId','runId','toolCallId'}

def open_resource(drive,context,resource_kind,resource_id,final_authorize,proposed_edit=None,expected_revision=None):
 """final_authorize(db,context,ref) must enforce fresh bot/conversation audience ACL.
 Called within Drive's transaction immediately before durable receipt commit.
 Client arguments MUST NOT supply or override context. A proposal is an unsent
 draft; document mutation still passes native human /edit authorization + CAS.
 """
 if set(context)!=CONTEXT_KEYS or any(not isinstance(v,str) or not v for v in context.values()):raise ValueError('invalid bound context')
 if not callable(final_authorize):raise ValueError('final authorization required')
 service=PanelService(drive);service._policy(resource_kind)
 actor,company=context['actorUserId'],context['companyId'];r=ref(company,resource_kind,resource_id)
 if proposed_edit is not None:
  if resource_kind!='knowledge' or not isinstance(proposed_edit,dict) or set(proposed_edit)!={'title','body'}:raise ValueError('invalid document proposal')
  if not isinstance(proposed_edit['title'],str) or not 0<len(proposed_edit['title'])<=240 or not isinstance(proposed_edit['body'],str) or len(proposed_edit['body'])>100000:raise ValueError('invalid proposal')
 drive.db.execute('CREATE TABLE IF NOT EXISTS panel_receipts(id TEXT PRIMARY KEY,company TEXT NOT NULL,actor TEXT NOT NULL,run TEXT NOT NULL,tool_call TEXT NOT NULL,context TEXT NOT NULL,ref TEXT NOT NULL,revision INTEGER NOT NULL,proposal TEXT,UNIQUE(company,run,tool_call))');drive.db.commit()
 with drive.access(actor,company) as member:
  row=service._row(member,resource_kind,resource_id)
  if expected_revision is not None and (type(expected_revision) is not int or expected_revision!=row['version']):raise PanelError(409,'REVISION_CONFLICT','Resource changed before proposal admission.')
  if final_authorize(drive.db,dict(context),dict(r)) is not True:raise PermissionError('panel audience unavailable')
  old=drive.db.execute('SELECT * FROM panel_receipts WHERE company=? AND run=? AND tool_call=?',(company,context['runId'],context['toolCallId'])).fetchone()
  if old:
   if json.loads(old['context'])!=context or json.loads(old['ref'])!=r or json.loads(old['proposal'])!=proposed_edit:raise PanelError(409,'REVISION_CONFLICT','Tool receipt already bound to another request.')
   receipt_id,revision=old['id'],old['revision']
  else:
   receipt_id,revision=str(uuid.uuid4()),row['version']
   drive.db.execute('INSERT INTO panel_receipts VALUES(?,?,?,?,?,?,?,?,?)',(receipt_id,company,actor,context['runId'],context['toolCallId'],json.dumps(context,sort_keys=True),json.dumps(r,sort_keys=True),revision,json.dumps(proposed_edit)))
  receipt=dict(version='starli.panel.receipt.v1',id=receipt_id,ref=r,revision=revision,**context)
  output=dict(version=VERSION,action='open',type=POLICY[resource_kind][0],ref=r,mode='docked',receipt=receipt)
  if proposed_edit is not None:output['draft']=proposed_edit
  return output

def propose_edit(drive,context,resource_id,value,final_authorize,expected_revision=None):
 return open_resource(drive,context,'knowledge',resource_id,final_authorize,proposed_edit=value,expected_revision=expected_revision)
