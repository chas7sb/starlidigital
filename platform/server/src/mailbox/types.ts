export type MailDirection = 'INBOUND' | 'OUTBOUND';

export type MailDeliveryStatus =
  | 'QUEUED'
  | 'ACCEPTED'
  | 'SENT'
  | 'DELIVERED'
  | 'DELAYED'
  | 'FAILED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'NEEDS_REVIEW';

export interface MailAddress {
  address: string;
  name?: string;
}

export interface MailAttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  contentId?: string;
  sha256?: string;
}

export interface MailMessageRecord {
  id: string;
  accountId: string;
  folder: string;
  uid?: number;
  uidValidity?: number;
  sourceTruncated?: boolean;
  messageId: string;
  inReplyTo?: string;
  references: string[];
  threadId: string;
  direction: MailDirection;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc?: MailAddress[];
  replyTo?: MailAddress;
  subject: string;
  snippet: string;
  textBody?: string;
  sanitizedHtmlBody?: string;
  hasHtml: boolean;
  hasRemoteImages: boolean;
  attachments: MailAttachmentMeta[];
  status: MailDeliveryStatus;
  isRead: boolean;
  isStarred: boolean;
  date: string; // ISO UTC
  createdAt: string;
  updatedAt: string;
  prospectId?: string;
  companyId?: string;
  opportunityId?: string;
  projectId?: string;
}

export interface MailDraftRecord {
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
  prospectId?: string;
  companyId?: string;
  opportunityId?: string;
  projectId?: string;
  approvalHash?: string;
  approvalExpiresAt?: number;
  approvedBy?: string;
  approvedAt?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MailboxSyncCursor {
  id: string; // `${accountId}:${folder}`
  accountId: string;
  folder: string;
  uidValidity: number;
  highestModSeq?: string;
  lastUid: number;
  syncedAt: string;
}

export interface TransactionalEmailLifecycleEvent {
  id: string;
  outboxId: string;
  providerId: string | null;
  kind: 'WELCOME' | 'RESET' | 'PAYMENT' | 'LIVE' | 'TEST' | 'PROPOSAL';
  eventType: 'QUEUED' | 'ACCEPTED' | 'DELIVERED' | 'DELAYED' | 'FAILED' | 'BOUNCED' | 'COMPLAINED' | 'NEEDS_REVIEW';
  recipientMasked: string;
  subject: string;
  error?: string | null;
  timestamp: string;
  relatedEntityId?: string | null;
}

export interface CrmMailActivity {
  id: string;
  kind: 'EMAIL_INBOUND' | 'EMAIL_OUTBOUND' | 'EMAIL_TRANSACTIONAL';
  actor: string;
  occurredAt: string;
  prospectId?: string;
  companyId?: string;
  opportunityId?: string;
  projectId?: string;
  sourceEventId: string;
  visibility: 'INTERNAL' | 'PUBLIC';
  redactedSummary: string;
  version: number;
}

export interface MailboxAccountConfig {
  id: string;
  email: string;
  displayName: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUser?: string;
  imapPass?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  pollIntervalMs?: number;
}
