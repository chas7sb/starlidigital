"""Trusted receipt policy on ephemeral native profile instructions only."""
import json,re,types
MARKER='[Native action receipt policy]'
POLICY='''[Native action receipt policy]
For requests to post, send, delegate, generate or save, perform the real authorized tool action. Never say the action happened or invent a message/receipt UUID without an actual tool result from this run. Resolve real channel/bot/human IDs through native directory tools. For channel/human sends, use the native send tool and verify its exact messageId using company_action_receipt before reporting SAVED. SAVED means persisted, not delivered/read. For delegated work, actually call company_bot_delegate and inspect actionReceipts; child ANSWERED alone does not prove a post or send. Verify each returned action messageId when reporting completion. Prior history, earlier receipt IDs and another bot's prose are not evidence of a new action. If there is no real action receipt, state that the action was not performed or remains unverified; do not fill in plausible IDs, successful outcomes or messages. A receipt lookup for an earlier action proves only that earlier action, not a new send. Never ask the user for secrets in chat.'''
UUID=r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
def action_request(prompt):
 if not isinstance(prompt,str):return False
 # App/site publication has its own verified PUBLISHED receipt and URL. It is
 # not a native channel send, so this message-only boundary must not replace it.
 if re.search(r'\b(publish|deploy)\b',prompt,re.I)and re.search(r'\b(website|web site|site|app|application|landing page)\b',prompt,re.I)and not re.search(r'\b(message|channel|social|dm|send|post)\b|#\w+',prompt,re.I):return False
 import unicodedata
 prompt=unicodedata.normalize('NFKD',prompt).encode('ascii','ignore').decode()
 draft=re.search(r'\b(draft|compose|rewrite|example|sample|suggest|how to|write (?:a |an |the )?(?:message|email|post))\b',prompt,re.I)
 execute=re.search(r'\b(?:actually|then|and)\s+(?:send|post|publish)\b',prompt,re.I)
 if draft and not execute:return False
 if re.match(r'\s*(what|how|why|when|explain|describe|can you explain)\b',prompt,re.I)and not re.search(r'\b(?:please|actually|then|now)\s+(?:send|post|publish)\b',prompt,re.I):return False
 return re.search(r'\b(send|post|dm|forward|trimite|posteaza)\b',prompt,re.I)is not None or (re.search(r'\bpublish\b',prompt,re.I)is not None and re.search(r'\b(message|channel|social|tweet|announcement)\b|#\w+',prompt,re.I)is not None) or re.search(r'^(?:please |can you )?(?:message|tell|ask|ping|spune)\s+',prompt.strip(),re.I)is not None

def tool_payloads(value,depth=0):
 if depth>4:return []
 if isinstance(value,dict):
  if value.get('isError')or value.get('outcome')not in (None,'settled'):return []
  if 'status'in value:return [value]
  if 'result'in value:return tool_payloads(value['result'],depth+1)
  result=[]
  for block in value.get('content',[])[:8]:
   if isinstance(block,dict)and block.get('type')=='text'and isinstance(block.get('text'),str)and len(block['text'])<=262144:
    try:result+=tool_payloads(json.loads(block['text']),depth+1)
    except (ValueError,TypeError):pass
  return result
 return []

def invalid_confirmation(answer,saved,delegations):
 if not isinstance(answer,str):return False
 if not saved and not delegations and re.match(r'\s*(?:done|completed|successfully completed)[.!\s]*$',answer,re.I):return True
 positive=[]
 for sentence in re.split(r'[\n.!?]+',answer):
  if re.search(r'\b(not|never|cannot|unable|unverified|unconfirmed|no receipt|not confirmed|not performed)\b',sentence,re.I):continue
  if re.search(r"\b(sent|posted|published|delivered|saved|messaged|delegated|asked|trimis|postat|salvat)\b",sentence,re.I):positive.append(sentence)
 for sentence in positive:
  message_claim=re.search(r'\b(sent|posted|published|delivered|saved|messaged|trimis|postat|salvat)\b',sentence,re.I)
  if message_claim and not saved:return True
  if not message_claim and not delegations:return True
 # Explicit saved-message IDs must match canonical current action results,
 # including IDs on following Markdown lines. Prior history is never proof.
 claimed=re.findall(r'(?:message[ _-]*(?:id)?|receipt[ _-]*(?:id)?|saved[ _-]*(?:message[ _-]*)?(?:id)?)\s*[:=#-]?\s*[`*\"]*('+UUID+')',answer,re.I)
 if claimed and any(ident.lower()not in saved for ident in claimed):return True
 return False

def install(runtime):
 runner=runtime.runner
 if getattr(runner,'_native_receipt_policy_installed',False):return runtime
 original=runner.run
 async def run(self,selection,prompt,history,rpc,event,*args,**kwargs):
  profile=selection.get('agentProfile')
  if isinstance(profile,dict):
   profile=dict(profile);instructions=profile.get('instructions','')
   if isinstance(instructions,str)and MARKER not in instructions:profile['instructions']=instructions+'\n\n'+POLICY
   selection['agentProfile']=profile
  guarded=action_request(prompt);saved=set();delegations=set()
  async def checked_rpc(operation,value):
   result=await rpc(operation,value)
   if operation=='tool.execute'and isinstance(value,dict):
    name=value.get('name')
    for payload in tool_payloads(result):
     if name in ('company_channel_message_send','company_human_message_send','company_message_send')and payload.get('status')=='SAVED':
      ident=payload.get('messageId')or(payload.get('message')or{}).get('id')
      if isinstance(ident,str)and re.fullmatch(UUID,ident,re.I):saved.add(ident.lower())
     elif name=='company_bot_delegate':
      ident=payload.get('runId')
      if payload.get('status')in ('ANSWERED','COMPLETED')and isinstance(ident,str):delegations.add(ident)
      for receipt in payload.get('actionReceipts',[])[:20]:
       ident=receipt.get('messageId')if isinstance(receipt,dict)else None
       if isinstance(receipt,dict)and receipt.get('status')=='SAVED'and receipt.get('type')in ('channel_message','human_message')and isinstance(ident,str)and re.fullmatch(UUID,ident,re.I):saved.add(ident.lower())
   return result
  async def checked_event(value):
   if guarded and isinstance(value,dict)and value.get('type')=='text_delta':return
   return await event(value)
  result=await original(selection,prompt,history,checked_rpc,checked_event,*args,**kwargs)
  if guarded and isinstance(result,dict)and result.get('status')=='ANSWERED':
   answer=result.get('answer','')
   if invalid_confirmation(answer,saved,delegations):
    answer=('A native action returned a receipt, but the generated confirmation contained an unverified message ID. I cannot confirm that ID as saved.'if saved else'I did not receive a verified native send/post receipt in this run. I cannot confirm that the message was sent or saved.')
    result=dict(result,answer=answer)
   if isinstance(answer,str)and answer:await event({'type':'text_delta','text':answer})
  return result
 runner.run=types.MethodType(run,runner);runner._native_receipt_policy_installed=True
 return runtime
