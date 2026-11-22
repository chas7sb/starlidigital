import React, { useEffect, useState } from 'react';
import type { MailDraft, MailMessage, MailTab, TransactionalEvent } from './types';
import './mailbox.css';

export interface AdminMailboxProps {
  initialTab?: MailTab;
  initialMessageId?: string;
  focusDraftId?: string;
  busy?: boolean;
  onReply?: (id:string,replyAll:boolean)=>Promise<void>;
  onEditDraft?: (id:string,textBody:string)=>Promise<void>;
  messages?: MailMessage[];
  drafts?: MailDraft[];
  transactionalEvents?: TransactionalEvent[];
  onSync?: () => Promise<void>;
  onSendMessage?: (draft: MailDraft) => Promise<void>;
  onApproveDraft?: (draftId: string) => Promise<void>;
  onMarkRead?: (messageId: string, isRead: boolean) => Promise<void>;
}

export const AdminMailbox: React.FC<AdminMailboxProps> = ({
  initialTab = 'INBOX',
  initialMessageId,
  focusDraftId,
  busy=false,
  onReply,
  onEditDraft,
  messages = [],
  drafts = [],
  transactionalEvents = [],
  onSync,
  onSendMessage,
  onApproveDraft,
  onMarkRead
}) => {
  const [tab, setTab] = useState<MailTab>(initialTab);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(initialMessageId || null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showRemoteImages, setShowRemoteImages] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [draftText,setDraftText]=useState('');
  useEffect(()=>{if(initialMessageId){setSelectedMessageId(initialMessageId);setTab('INBOX');}},[initialMessageId]);
  useEffect(()=>{if(focusDraftId){setSelectedDraftId(focusDraftId);setSelectedMessageId(null);setTab('DRAFTS');}},[focusDraftId]);
  useEffect(()=>{const draft=drafts.find(draft=>draft.id===selectedDraftId);setDraftText(draft?.textBody || '');},[drafts,selectedDraftId]);

  const filteredMessages = messages.filter(m => {
    if (tab === 'INBOX' && m.folder.toLowerCase() !== 'inbox') return false;
    if (tab === 'SENT' && m.folder.toLowerCase() !== 'sent') return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        m.subject.toLowerCase().includes(q) ||
        m.from.address.toLowerCase().includes(q) ||
        m.snippet.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectedMessage = messages.find(m => m.id === selectedMessageId);
  const selectedDraft = drafts.find(d => d.id === selectedDraftId);

  const handleSyncClick = async () => {
    if (!onSync || isSyncing) return;
    try {
      setIsSyncing(true);
      await onSync();
    } finally {
      setIsSyncing(false);
    }
  };

  const getStatusClass = (status: string) => {
    const s = status.toLowerCase().replace(/_/g, '-');
    return `mail-status-pill status-${s}`;
  };

  return (
    <div className="admin-mailbox">
      {/* Sidebar Navigation */}
      <div className="mailbox-sidebar">
        <button
          className={`mailbox-nav-btn ${tab === 'INBOX' ? 'active' : ''}`}
          onClick={() => { setTab('INBOX'); setSelectedDraftId(null); }}
        >
          📥 Inbox
        </button>
        <button
          className={`mailbox-nav-btn ${tab === 'SENT' ? 'active' : ''}`}
          onClick={() => { setTab('SENT'); setSelectedDraftId(null); }}
        >
          📤 Sent
        </button>
        <button
          className={`mailbox-nav-btn ${tab === 'DRAFTS' ? 'active' : ''}`}
          onClick={() => { setTab('DRAFTS'); setSelectedMessageId(null); }}
        >
          📝 Drafts
        </button>
        <button
          className={`mailbox-nav-btn ${tab === 'TRANSACTIONAL' ? 'active' : ''}`}
          onClick={() => { setTab('TRANSACTIONAL'); setSelectedMessageId(null); setSelectedDraftId(null); }}
        >
          ⚡ Transactional events
        </button>

        {onSync && (
          <button className="mailbox-sync-btn" onClick={handleSyncClick} disabled={isSyncing||busy}>
            🔄 {isSyncing ? 'Syncing…' : 'Sync mailbox'}
          </button>
        )}
      </div>

      {/* Main Mailbox Workspace */}
      <div className="mailbox-main">
        <div className="mailbox-header">
          <h2 style={{ fontSize: '16px', margin: 0, fontWeight: 600 }}>
            {tab === 'INBOX' && 'Mailbox — alex@starlidigital.ro'}
            {tab === 'SENT' && 'Sent messages'}
            {tab === 'DRAFTS' && 'Drafts & approvals'}
            {tab === 'TRANSACTIONAL' && 'Transactional delivery log'}
          </h2>
          <input
            type="text"
            className="mailbox-search-input"
            placeholder="Search loaded sender or subject…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="mailbox-content">
          {/* Message List Pane */}
          {tab !== 'TRANSACTIONAL' && tab !== 'DRAFTS' && (
            <div className="mailbox-list-pane">
              {filteredMessages.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  No messages in this folder.
                </div>
              ) : (
                filteredMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`mail-row ${selectedMessageId === msg.id ? 'selected' : ''} ${!msg.isRead ? 'unread' : ''}`}
                    onClick={() => {
                      setSelectedMessageId(msg.id);
                      if (!msg.isRead && onMarkRead) onMarkRead(msg.id, true);
                    }}
                  >
                    <div className="mail-row-header">
                      <span>{msg.from.name || msg.from.address}</span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {new Date(msg.date).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="mail-row-subject">{msg.subject || '(No subject)'}</div>
                    <div className="mail-row-snippet">{msg.snippet}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Drafts List Pane */}
          {tab === 'DRAFTS' && (
            <div className="mailbox-list-pane">
              {drafts.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  No drafts awaiting approval.
                </div>
              ) : (
                drafts.map((d) => (
                  <div
                    key={d.id}
                    className={`mail-row ${selectedDraftId === d.id ? 'selected' : ''}`}
                    onClick={() => setSelectedDraftId(d.id)}
                  >
                    <div className="mail-row-header">
                      <span>To: {d.to.map(t => t.address).join(', ') || '(No recipient)'}</span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>rev {d.revision}</span>
                    </div>
                    <div className="mail-row-subject">{d.subject || '(No subject)'}</div>
                    <div className="mail-row-snippet">{d.textBody.slice(0, 80)}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Message / Draft Detail Pane */}
          {tab !== 'TRANSACTIONAL' && (
            <div className="mailbox-detail-pane">
              {tab === 'DRAFTS' && selectedDraft ? (
                <>
                  <div className="mail-detail-header">
                    <div className="mail-detail-title">{selectedDraft.subject}</div>
                    <div className="mail-detail-meta">
                      <div><strong>Sender:</strong> {selectedDraft.fromAccount}</div>
                      <div><strong>Recipients:</strong> {selectedDraft.to.map(t => `${t.name || ''} <${t.address}>`).join(', ')}</div>
                      <div><strong>Current revision:</strong> {selectedDraft.revision}</div>
                      <div>
                        <strong>Approval status:</strong>{' '}
                        {selectedDraft.approvedBy && selectedDraft.approvalExpiresAt && selectedDraft.approvalExpiresAt>Date.now() ? (
                          <span style={{ color: '#10b981' }}>
                            Approved by {selectedDraft.approvedBy} (expires at {new Date(selectedDraft.approvalExpiresAt || 0).toLocaleTimeString()})
                          </span>
                        ) : (
                          <span style={{ color: '#f59e0b' }}>Awaiting human approval</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mail-body-container">
                    <label style={{display:'block'}}>Message<textarea aria-label="Draft message" value={draftText} disabled={busy||!onEditDraft} onChange={event=>setDraftText(event.target.value)} style={{width:'100%',minHeight:240,marginTop:10,resize:'vertical',padding:12,background:'#0c1018',color:'#e2e8f0',border:'1px solid #ffffff18',borderRadius:8,font:'inherit'}}/></label>
                  </div>

                  <div className="mail-actions">
                    {onEditDraft&&draftText!==selectedDraft.textBody&&<button className="mail-btn mail-btn-primary" disabled={busy||!draftText.trim()} onClick={()=>void onEditDraft(selectedDraft.id,draftText)}>Save changes</button>}
                    {(!selectedDraft.approvedBy||!selectedDraft.approvalExpiresAt||selectedDraft.approvalExpiresAt<=Date.now()) && onApproveDraft && (
                      <button
                        className="mail-btn mail-btn-primary"
                        disabled={busy||draftText!==selectedDraft.textBody}
                        onClick={() => onApproveDraft(selectedDraft.id)}
                      >
                        ✅ Approve draft for sending
                      </button>
                    )}
                    {selectedDraft.approvedBy && selectedDraft.approvalExpiresAt && selectedDraft.approvalExpiresAt>Date.now() && onSendMessage && (
                      <button
                        className="mail-btn mail-btn-primary"
                        disabled={busy||draftText!==selectedDraft.textBody||!selectedDraft.approvalExpiresAt||selectedDraft.approvalExpiresAt<Date.now()}
                        onClick={() => onSendMessage(selectedDraft)}
                      >
                        🚀 Send now
                      </button>
                    )}
                  </div>
                </>
              ) : selectedMessage ? (
                <>
                  <div className="mail-detail-header">
                    <div className="mail-detail-title">{selectedMessage.subject}</div>
                    <div className="mail-detail-meta">
                      <div>
                        <strong>From:</strong> {selectedMessage.from.name ? `${selectedMessage.from.name} <${selectedMessage.from.address}>` : selectedMessage.from.address}
                      </div>
                      <div>
                        <strong>To:</strong> {selectedMessage.to.map(t => t.address).join(', ')}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <strong>Date:</strong> {new Date(selectedMessage.date).toLocaleString()}
                        <span className={getStatusClass(selectedMessage.status)}>{selectedMessage.status}</span>
                      </div>
                    </div>
                  </div>

                  {selectedMessage.hasRemoteImages && !showRemoteImages && (
                    <div className="remote-images-warning">
                      <span>⚠️ External images are blocked to prevent tracking.</span>
                      <button
                        className="mail-btn"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => setShowRemoteImages(true)}
                      >
                        Show images
                      </button>
                    </div>
                  )}

                  {selectedMessage.sourceTruncated&&<div className="remote-images-warning" role="note">This large message is partially loaded. Open the original in your mail client for the full message and attachments.</div>}
                  <div className="mail-body-container">
                    {selectedMessage.sanitizedHtmlBody ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: showRemoteImages
                            ? selectedMessage.sanitizedHtmlBody.replace(/data-original-src="([^"]+)"/g, 'src="$1"')
                            : selectedMessage.sanitizedHtmlBody
                        }}
                      />
                    ) : (
                      <pre style={{ margin: 0, fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}>
                        {selectedMessage.textBody}
                      </pre>
                    )}
                  </div>

                  {onReply&&<div className="mail-actions"><button className="mail-btn mail-btn-primary" disabled={busy} onClick={()=>void onReply(selectedMessage.id,false)}>Reply</button><button className="mail-btn" disabled={busy} onClick={()=>void onReply(selectedMessage.id,true)}>Reply all</button></div>}
                  {selectedMessage.attachments.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <strong style={{ fontSize: '13px' }}>Attachments ({selectedMessage.attachments.length}):</strong>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                        {selectedMessage.attachments.map(att => (
                          <div
                            key={att.id}
                            style={{
                              padding: '6px 10px',
                              background: 'rgba(255,255,255,0.06)',
                              borderRadius: '4px',
                              fontSize: '12px'
                            }}
                          >
                            📎 {att.filename} ({(att.byteSize / 1024).toFixed(1)} KB)
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ margin: 'auto', textAlign: 'center', color: '#64748b' }}>
                  Select a message to read it.
                </div>
              )}
            </div>
          )}

          {/* Transactional Lifecycle Pane */}
          {tab === 'TRANSACTIONAL' && (
            <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e293b', textAlign: 'left', color: '#94a3b8' }}>
                    <th style={{ padding: '8px' }}>Date / time</th>
                    <th style={{ padding: '8px' }}>Email type</th>
                    <th style={{ padding: '8px' }}>Masked recipient</th>
                    <th style={{ padding: '8px' }}>Subject</th>
                    <th style={{ padding: '8px' }}>Delivery status</th>
                    <th style={{ padding: '8px' }}>Details / error</th>
                  </tr>
                </thead>
                <tbody>
                  {transactionalEvents.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                        No transactional events recorded.
                      </td>
                    </tr>
                  ) : (
                    transactionalEvents.map((ev) => (
                      <tr key={ev.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '8px', color: '#94a3b8' }}>
                          {new Date(ev.timestamp).toLocaleString()}
                        </td>
                        <td style={{ padding: '8px', fontWeight: 500 }}>{ev.kind}</td>
                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>{ev.recipientMasked}</td>
                        <td style={{ padding: '8px' }}>{ev.subject}</td>
                        <td style={{ padding: '8px' }}>
                          <span className={getStatusClass(ev.eventType)}>{ev.eventType}</span>
                        </td>
                        <td style={{ padding: '8px', color: ev.error ? '#f87171' : '#64748b' }}>
                          {ev.error || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
