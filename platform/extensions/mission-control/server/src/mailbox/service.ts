import { createHash, randomUUID } from 'node:crypto';
import type { Store } from '../store.js';
import type { Events } from '../events.js';
import { parseSmtpConfig, sendSmtpMail, type SmtpSendResult, type SmtpSendArgs } from '../smtp.js';
import type { SmtpSender } from '../email.js';
import { computeDraftApprovalHash, validateDraftApproval } from './drafts.js';
import { syncFolder } from './sync.js';
import type { ImapClientFactory } from './imap-client.js';
import {ManagedImapClient} from './imapflow-client.js';
import type {
  CrmMailActivity,
  MailAddress,
  MailAttachmentMeta,
  MailDraftRecord,
  MailMessageRecord,
  MailboxAccountConfig,
  TransactionalEmailLifecycleEvent
} from './types.js';

export interface CreateMailboxServicesOptions {
  store: Store;
  events: Events;
  transport?: SmtpSender;
  imapClientFactory?: ImapClientFactory;
  crmActivitySink?: (activity: CrmMailActivity) => void | Promise<void>;
  accountConfig?: MailboxAccountConfig;
}

export interface SendDraftOptions {
  draftId: string;
  actor: string;
  idempotencyKey?: string;
}

export interface MailboxFilter {
  accountId?: string;
  folder?: string;
  threadId?: string;
  search?: string;
  direction?: 'INBOUND' | 'OUTBOUND';
  prospectId?: string;
  companyId?: string;
  opportunityId?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}

export class MailboxServices {
  private store: Store;
  private events: Events;
  private transport?: SmtpSender;
  private imapClientFactory: ImapClientFactory;
  private crmActivitySink?: (activity: CrmMailActivity) => void | Promise<void>;
  private defaultAccount: MailboxAccountConfig;

  constructor(options: CreateMailboxServicesOptions) {
    this.store = options.store;
    this.events = options.events;
    this.transport = options.transport;
    this.imapClientFactory = options.imapClientFactory || ((cfg) => new ManagedImapClient(cfg));
    this.crmActivitySink = options.crmActivitySink;

    const smtpConfig = parseSmtpConfig();
    this.defaultAccount = options.accountConfig || {
      id: process.env.MAILBOX_ACCOUNT_ID || 'local-mailbox',
      email: process.env.MAILBOX_EMAIL || '',
      displayName: process.env.MAILBOX_DISPLAY_NAME || 'Local mailbox',
      imapHost: process.env.IMAP_HOST || '',
      imapPort: Number(process.env.IMAP_PORT) || 993,
      imapSecure: String(process.env.IMAP_SECURE || 'true').toLowerCase() === 'true',
      imapUser: process.env.IMAP_USER || '',
      imapPass: process.env.IMAP_PASS || '',
      smtpHost: smtpConfig.host,
      smtpPort: smtpConfig.port,
      smtpSecure: smtpConfig.secure,
      smtpUser: smtpConfig.user,
      smtpPass: smtpConfig.pass
    };
  }

  public getAccount(): MailboxAccountConfig & {imapConfigured:boolean} {
    return {
      id: this.defaultAccount.id,
      email: this.defaultAccount.email,
      displayName: this.defaultAccount.displayName,
      imapConfigured:!!(this.defaultAccount.email&&this.defaultAccount.imapHost&&this.defaultAccount.imapUser&&this.defaultAccount.imapPass),
      imapHost: this.defaultAccount.imapHost,
      imapPort: this.defaultAccount.imapPort,
      imapSecure: this.defaultAccount.imapSecure,
      smtpHost: this.defaultAccount.smtpHost,
      smtpPort: this.defaultAccount.smtpPort,
      smtpSecure: this.defaultAccount.smtpSecure
      // imapPass and smtpPass are NEVER exposed to consumers
    };
  }

  // --- Messages & Threads ---

  public listMessages(filter: MailboxFilter = {}): { messages: MailMessageRecord[]; total: number } {
    const all = (this.store.list('mailbox-messages') as MailMessageRecord[]) || [];
    let filtered = all;

    if (filter.accountId) {
      filtered = filtered.filter(m => m.accountId === filter.accountId);
    }
    if (filter.folder) {
      const targetFolder = filter.folder.toLowerCase();
      filtered = filtered.filter(m => m.folder.toLowerCase() === targetFolder);
    }
    if (filter.threadId) {
      filtered = filtered.filter(m => m.threadId === filter.threadId);
    }
    if (filter.direction) {
      filtered = filtered.filter(m => m.direction === filter.direction);
    }
    if (filter.prospectId) {
      filtered = filtered.filter(m => m.prospectId === filter.prospectId);
    }
    if (filter.companyId) {
      filtered = filtered.filter(m => m.companyId === filter.companyId);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      filtered = filtered.filter(
        m =>
          m.subject.toLowerCase().includes(q) ||
          m.from.address.toLowerCase().includes(q) ||
          m.to.some(t => t.address.toLowerCase().includes(q)) ||
          m.snippet.toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const total = filtered.length;
    const offset = filter.offset || 0;
    const limit = filter.limit || 50;
    return { messages: filtered.slice(offset, offset + limit), total };
  }

  public getMessage(id: string): MailMessageRecord | undefined {
    return this.store.get('mailbox-messages', id) as MailMessageRecord | undefined;
  }

  public getThread(threadId: string): MailMessageRecord[] {
    const all = (this.store.list('mailbox-messages') as MailMessageRecord[]) || [];
    return all
      .filter(m => m.threadId === threadId)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  public markMessageRead(id: string, isRead: boolean): MailMessageRecord {
    const msg = this.getMessage(id);
    if (!msg) throw new Error('Message not found');
    const updated = { ...msg, isRead, updatedAt: new Date().toISOString() };
    this.store.put('mailbox-messages', updated);
    this.events.publish('mailbox');
    return updated;
  }

  // --- Drafts Lifecycle & Approval ---
  public listDrafts(limit=100):MailDraftRecord[]{
    return (this.store.list('mailbox-drafts') as MailDraftRecord[]).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,Math.min(200,Math.max(1,limit)));
  }

  public createDraft(args: {
    fromAccount?: string;
    to: MailAddress[];
    cc?: MailAddress[];
    bcc?: MailAddress[];
    subject: string;
    textBody: string;
    htmlBody?: string;
    inReplyTo?: string;
    references?: string[];
    threadId?: string;
    attachments?: MailAttachmentMeta[];
    prospectId?: string;
    companyId?: string;
    opportunityId?: string;
    projectId?: string;
  }): MailDraftRecord {
    const draftId = 'draft-' + randomUUID();
    const draft: MailDraftRecord = {
      id: draftId,
      revision: 1,
      fromAccount: args.fromAccount || this.defaultAccount.email,
      to: args.to,
      cc: args.cc || [],
      bcc: args.bcc || [],
      subject: args.subject,
      textBody: args.textBody,
      htmlBody: args.htmlBody,
      inReplyTo: args.inReplyTo,
      references: args.references || [],
      threadId: args.threadId,
      attachments: args.attachments || [],
      prospectId: args.prospectId,
      companyId: args.companyId,
      opportunityId: args.opportunityId,
      projectId: args.projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.store.put('mailbox-drafts', draft);
    this.events.publish('mailbox');
    return draft;
  }

  public updateDraft(
    id: string,
    updates: Partial<Omit<MailDraftRecord, 'id' | 'revision' | 'createdAt' | 'approvalHash' | 'approvedBy' | 'approvedAt'>>
  ): MailDraftRecord {
    const draft = this.store.get('mailbox-drafts', id) as MailDraftRecord | undefined;
    if (!draft) throw new Error('Draft not found');

    // Updating draft increments revision and strictly wipes prior approval!
    const updated: MailDraftRecord = {
      ...draft,
      ...updates,
      revision: draft.revision + 1,
      approvalHash: undefined,
      approvalExpiresAt: undefined,
      approvedBy: undefined,
      approvedAt: undefined,
      updatedAt: new Date().toISOString()
    };

    this.store.put('mailbox-drafts', updated);
    this.events.publish('mailbox');
    return updated;
  }

  public approveDraft(draftId: string, principal: string, ttlMs: number = 3600000): MailDraftRecord {
    const draft = this.store.get('mailbox-drafts', draftId) as MailDraftRecord | undefined;
    if (!draft) throw new Error('Draft not found');
    if (!principal) throw new Error('Human principal required to approve draft');

    const approvalHash = computeDraftApprovalHash({
      draftId: draft.id,
      revision: draft.revision,
      fromAccount: draft.fromAccount,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      textBody: draft.textBody,
      htmlBody: draft.htmlBody,
      attachments: draft.attachments
    });

    const now = Date.now();
    const approved: MailDraftRecord = {
      ...draft,
      approvalHash,
      approvalExpiresAt: now + ttlMs,
      approvedBy: principal,
      approvedAt: now,
      updatedAt: new Date().toISOString()
    };

    this.store.put('mailbox-drafts', approved);
    this.events.publish('mailbox');
    return approved;
  }

  public async sendApprovedDraft(options: SendDraftOptions): Promise<MailMessageRecord> {
    const { draftId, actor, idempotencyKey } = options;
    const draft = this.store.get('mailbox-drafts', draftId) as MailDraftRecord | undefined;
    if (!draft) throw new Error('Draft not found');

    // Check idempotency if key provided
    const outboxKey = idempotencyKey || `draft-send-${draft.id}-rev${draft.revision}`;
    const existingSent = this.store.get('mailbox-outbox-sent', outboxKey);
    if (existingSent) {
      const existingMsg = this.getMessage(existingSent.messageRecordId);
      if (existingMsg) return existingMsg;
    }

    // Validate approval
    const validation = validateDraftApproval(draft);
    if (!validation.valid) {
      throw new Error(`Cannot send draft: ${validation.reason}`);
    }

    if (draft.to.length === 0) {
      throw new Error('Cannot send email without recipients');
    }

    const messageId = `<msg-${draft.id}-${draft.revision}@starlidigital.ro>`;
    const threadId = draft.threadId || draft.inReplyTo || messageId.slice(1, -1);

    // Atomically invalidate approval to prevent replay
    draft.approvalHash = undefined;
    draft.approvalExpiresAt = undefined;
    this.store.put('mailbox-drafts', draft);

    const sender = this.transport || ((args: SmtpSendArgs) => sendSmtpMail(args));
    const recipientAddresses = draft.to.map(t => t.address).join(', ');

    let result: SmtpSendResult;
    try {
      result = await sender({
        from: draft.fromAccount,
        to: recipientAddresses,
        subject: draft.subject,
        text: draft.textBody,
        messageId,
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        cc:draft.cc.map(recipient=>recipient.address),
        bcc:draft.bcc.map(recipient=>recipient.address),
      });
    } catch (err: any) {
      result = {
        success: false,
        stage: 'CONNECT',
        uncertain: true,
        message: err.message || String(err)
      };
    }

    const deliveryStatus = result.success
      ? 'ACCEPTED'
      : result.uncertain
      ? 'NEEDS_REVIEW'
      : 'FAILED';

    const sentRecord: MailMessageRecord = {
      id: 'mailmsg-' + randomUUID(),
      accountId: this.defaultAccount.id,
      folder: 'Sent',
      messageId: messageId.slice(1, -1),
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      threadId,
      direction: 'OUTBOUND',
      from: { address: draft.fromAccount, name: this.defaultAccount.displayName },
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      snippet: draft.textBody.slice(0, 160).replace(/\s+/g, ' '),
      textBody: draft.textBody,
      sanitizedHtmlBody: draft.htmlBody,
      hasHtml: !!draft.htmlBody,
      hasRemoteImages: false,
      attachments: draft.attachments,
      status: deliveryStatus,
      isRead: true,
      isStarred: false,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      prospectId: draft.prospectId,
      companyId: draft.companyId,
      opportunityId: draft.opportunityId,
      projectId: draft.projectId
    };

    this.store.put('mailbox-messages', sentRecord);

    // Record outbox send idempotency
    this.store.put('mailbox-outbox-sent', {
      id: outboxKey,
      draftId: draft.id,
      revision: draft.revision,
      messageRecordId: sentRecord.id,
      status: deliveryStatus,
      sentAt: new Date().toISOString()
    });

    // If successfully sent, remove draft
    if (result.success) {
      this.store.remove('mailbox-drafts', draft.id);
    }

    // Emit CRM activity
    if (this.crmActivitySink) {
      try {
        await this.crmActivitySink({
          id: 'crmact-' + randomUUID(),
          kind: 'EMAIL_OUTBOUND',
          actor,
          occurredAt: sentRecord.date,
          prospectId: draft.prospectId,
          companyId: draft.companyId,
          opportunityId: draft.opportunityId,
          projectId: draft.projectId,
          sourceEventId: sentRecord.id,
          visibility: 'INTERNAL',
          redactedSummary: `Outbound email to ${recipientAddresses}: ${draft.subject} (${deliveryStatus})`,
          version: 1
        });
      } catch (err) {
        console.error('[mailbox] CRM activity sink error:', err);
      }
    }

    this.events.publish('mailbox');

    if (!result.success) {
      if (result.uncertain) {
        throw new Error(`SMTP outcome uncertain (${result.message}). Auto-resend disabled. Manual check required.`);
      } else {
        throw new Error(`SMTP send rejected at stage ${result.stage}: ${result.message}`);
      }
    }

    return sentRecord;
  }

  // --- Reply / Forward Helpers ---

  public prepareReply(originalMsgId: string, replyAll: boolean = false): MailDraftRecord {
    const original = this.getMessage(originalMsgId);
    if (!original) throw new Error('Original message not found');

    const ownAddress = this.defaultAccount.email.toLowerCase();
    const fromOwn=original.direction==='OUTBOUND'||original.from.address.toLowerCase()===ownAddress;
    const to: MailAddress[] = (fromOwn?original.to:[original.replyTo||original.from]).filter(recipient=>recipient.address.toLowerCase()!==ownAddress);
    if(!to.length)throw new Error('No external recipient found for this reply');
    const cc: MailAddress[] = [];

    if (replyAll) {
      // Add all original 'to' and 'cc' recipients except own address
      for (const rec of [...original.to, ...original.cc]) {
        if (rec.address.toLowerCase() !== ownAddress && !to.some(t => t.address.toLowerCase() === rec.address.toLowerCase())&&!cc.some(t=>t.address.toLowerCase()===rec.address.toLowerCase())) {
          cc.push(rec);
        }
      }
    }

    const subject = original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`;
    const references = [...(original.references || []), original.messageId];

    return this.createDraft({
      to,
      cc,
      subject,
      textBody: `\n\n--- On ${original.date}, ${original.from.address} wrote:\n> ${original.textBody?.split('\n').join('\n> ') || ''}`,
      inReplyTo: original.messageId,
      references,
      threadId: original.threadId,
      prospectId: original.prospectId,
      companyId: original.companyId,
      opportunityId: original.opportunityId,
      projectId: original.projectId
    });
  }

  public prepareForward(originalMsgId: string): MailDraftRecord {
    const original = this.getMessage(originalMsgId);
    if (!original) throw new Error('Original message not found');

    const subject = original.subject.startsWith('Fwd:') ? original.subject : `Fwd: ${original.subject}`;
    return this.createDraft({
      to: [],
      subject,
      textBody: `\n\n---------- Forwarded message ---------\nFrom: ${original.from.address}\nDate: ${original.date}\nSubject: ${original.subject}\n\n${original.textBody || ''}`,
      attachments: original.attachments,
      prospectId: original.prospectId,
      companyId: original.companyId,
      opportunityId: original.opportunityId,
      projectId: original.projectId
    });
  }

  // --- IMAP Sync Trigger ---

  public async syncMailbox(folder: string = 'INBOX'): Promise<any> {
    if(!this.defaultAccount.email||!this.defaultAccount.imapHost||!this.defaultAccount.imapUser||!this.defaultAccount.imapPass)throw new Error('MAILBOX_CONFIGURATION_REQUIRED');
    const lockId=`${this.defaultAccount.id}:${folder}`,lockOwner=randomUUID();
    this.store.db.exec('BEGIN IMMEDIATE');
    try{
      const current=this.store.get('mailbox-sync-leases',lockId);
      if(current&&current.expiresAt>Date.now())throw new Error('Mailbox synchronization is already in progress. Refresh shortly.');
      this.store.put('mailbox-sync-leases',{id:lockId,owner:lockOwner,expiresAt:Date.now()+5*60000});
      this.store.db.exec('COMMIT');
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    let client: ReturnType<ImapClientFactory>|undefined;
    try {
    client = this.imapClientFactory({
      host: this.defaultAccount.imapHost || '127.0.0.1',
      port: this.defaultAccount.imapPort || 993,
      secure: this.defaultAccount.imapSecure !== false,
      user: this.defaultAccount.imapUser || '',
      pass: this.defaultAccount.imapPass || ''
    });

      await client.connect();
      const res = await syncFolder({
        accountId: this.defaultAccount.id,
        folder,
        client,
        store: this.store,
        events: this.events,
        crmActivitySink: this.crmActivitySink
      });
      return res;
    } finally {
      try{await client?.close();}finally{if(this.store.get('mailbox-sync-leases',lockId)?.owner===lockOwner)this.store.remove('mailbox-sync-leases',lockId);}
    }
  }

  // --- Transactional Email Timeline Events ---

  public listTransactionalEvents(filter: { kind?: string; outboxId?: string; limit?: number } = {}): TransactionalEmailLifecycleEvent[] {
    const all = (this.store.list('transactional-email-events') as TransactionalEmailLifecycleEvent[]) || [];
    let filtered = all;
    if (filter.kind) {
      filtered = filtered.filter(e => e.kind === filter.kind);
    }
    if (filter.outboxId) {
      filtered = filtered.filter(e => e.outboxId === filter.outboxId);
    }
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return filtered.slice(0, filter.limit || 100);
  }
}

export function createMailboxServices(options: CreateMailboxServicesOptions): MailboxServices {
  return new MailboxServices(options);
}
