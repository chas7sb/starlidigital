import {useCallback,useEffect,useState} from 'react';
import {gql} from '../api';
import {AdminMailbox} from './AdminMailbox';
import type {MailDraft,MailMessage,TransactionalEvent} from './types';

export const MAIL_DRAFT_FIELDS='id revision fromAccount to{address name} cc{address name} bcc{address name} subject textBody htmlBody inReplyTo references threadId attachments{id filename mimeType byteSize} createdAt updatedAt approvalExpiresAt approvedBy';
export const MAIL_MESSAGE_FIELDS='id accountId folder messageId inReplyTo references threadId direction from{address name} to{address name} cc{address name} bcc{address name} subject snippet date textBody sourceTruncated sanitizedHtmlBody hasHtml hasRemoteImages status isRead isStarred attachments{id filename mimeType byteSize} companyId projectId';
export function MailboxWorkspace({initialMessageId}:{initialMessageId?:string}){
  const[messages,setMessages]=useState<MailMessage[]>([]),[drafts,setDrafts]=useState<MailDraft[]>([]),[events,setEvents]=useState<TransactionalEvent[]>([]);
  const[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[focusDraftId,setFocusDraftId]=useState<string>();
  const[limit,setLimit]=useState(50),[total,setTotal]=useState(0);
  const load=useCallback(async()=>{
    const data=await gql<{inbox:{messages:MailMessage[];total:number};sent:{messages:MailMessage[];total:number};mailboxDrafts:MailDraft[];mailboxTransactionalEvents:TransactionalEvent[]}>(`query($limit:Int!){inbox:mailboxMessages(folder:"INBOX",limit:$limit){total messages{${MAIL_MESSAGE_FIELDS}}} sent:mailboxMessages(folder:"Sent",limit:$limit){total messages{${MAIL_MESSAGE_FIELDS}}} mailboxDrafts{${MAIL_DRAFT_FIELDS}} mailboxTransactionalEvents(limit:50){id outboxId providerId kind eventType recipientMasked subject error timestamp relatedEntityId}}`,{limit});
    let list=[...data.inbox.messages,...data.sent.messages];setTotal(data.inbox.total+data.sent.total);
    if(initialMessageId&&!list.some(message=>message.id===initialMessageId)){
      const result=await gql<{mailboxMessage:MailMessage|null}>(`query($id:String!){mailboxMessage(id:$id){${MAIL_MESSAGE_FIELDS}}}`,{id:initialMessageId});
      if(result.mailboxMessage)list=[result.mailboxMessage,...list];
    }
    setMessages(list);setDrafts(data.mailboxDrafts);setEvents(data.mailboxTransactionalEvents);
  },[initialMessageId,limit]);
  useEffect(()=>{let live=true;void load().catch(error=>{if(live)setError(error.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[load]);
  async function action(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work();await load();}catch(error){setError(error instanceof Error?error.message:'Mailbox action failed');}finally{setBusy(false);}}
  return <>{error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice" role="status">{notice}</div>}{loading&&<p role="status" style={{color:'#9298ac'}}>Loading your mailbox…</p>}
    <div className="agency-today-footer" style={{marginBottom:16}}><span>{messages.length} of {total} synchronized messages loaded across Inbox and Sent.</span>{total>messages.length&&limit<250&&<button className="text-link" disabled={busy} onClick={()=>setLimit(value=>Math.min(250,value+50))}>Load older messages</button>}{limit>=250&&total>messages.length&&<span>Use MCP inbox_search to search older history.</span>}</div>
    <AdminMailbox initialMessageId={initialMessageId} focusDraftId={focusDraftId} busy={busy} messages={messages} drafts={drafts} transactionalEvents={events}
      onSync={()=>action(async()=>{const result=await gql<{mailboxSync:{newMessagesCount:number;hasMore:boolean}}>('mutation{mailboxSync(folder:"INBOX"){newMessagesCount hasMore}}');setNotice(`${result.mailboxSync.newMessagesCount} new messages synchronized.${result.mailboxSync.hasMore?' More history will load in the background.':' Inbox is up to date.'}`);})}
      onApproveDraft={id=>action(async()=>{await gql('mutation($id:String!){mailboxApproveDraft(id:$id){id}}',{id});})}
      onSendMessage={draft=>action(async()=>{const result=await gql<{mailboxSendApprovedDraft:{status:string}}>('mutation($draftId:String!,$key:String!){mailboxSendApprovedDraft(draftId:$draftId,idempotencyKey:$key){id status}}',{draftId:draft.id,key:`admin:${draft.id}:revision:${draft.revision}`});setNotice(`Message status: ${result.mailboxSendApprovedDraft.status}. Recipient delivery is not yet confirmed.`);})}
      onReply={(id,replyAll)=>action(async()=>{const result=await gql<{mailboxPrepareReply:MailDraft}>(`mutation($id:String!,$all:Boolean!){mailboxPrepareReply(originalMsgId:$id,replyAll:$all){${MAIL_DRAFT_FIELDS}}}`,{id,all:replyAll});setFocusDraftId(result.mailboxPrepareReply.id);})}
      onEditDraft={(id,textBody)=>action(async()=>{await gql('mutation($id:String!,$text:String!){mailboxUpdateDraft(id:$id,textBody:$text){id revision}}',{id,text:textBody});setNotice('Draft saved. Review and approve the new revision before sending.');})}
    />
  </>;
}
