export type MailTab = 'INBOX' | 'SENT' | 'DRAFTS' | 'TRANSACTIONAL';

export interface MailAddress {
  address: string;
  name?: string;
}

export interface MailAttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
}

export interface MailMessage {
  id: string;
  accountId: string;
  folder: string;
  messageId: string;
  inReplyTo?: string;
  references: string[];
  threadId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc?: MailAddress[];
  subject: string;
  snippet: string;
  textBody?: string;
  sourceTruncated?: boolean;
  sanitizedHtmlBody?: string;
  hasHtml: boolean;
  hasRemoteImages: boolean;
  attachments: MailAttachmentMeta[];
  status: string;
  isRead: boolean;
  isStarred: boolean;
  date: string;
  prospectId?: string;
  companyId?: string;
  opportunityId?: string;
  projectId?: string;
}

export interface MailDraft {
  id: string;
  revision: number;
  fromAccount: string;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  inReplyTo?: string;
  references: string[];
  threadId?: string;
  attachments: MailAttachmentMeta[];
  approvalHash?: string;
  approvalExpiresAt?: number;
  approvedBy?: string;
  approvedAt?: number;
  updatedAt: string;
}

export interface TransactionalEvent {
  id: string;
  outboxId: string;
  providerId: string | null;
  kind: string;
  eventType: string;
  recipientMasked: string;
  subject: string;
  error?: string | null;
  timestamp: string;
  relatedEntityId?: string | null;
}
