import { createHash, randomUUID } from 'node:crypto';
import type { Store } from '../store.js';
import type { Events } from '../events.js';
import type {
  ImapClient,
  ImapClientFactory
} from './imap-client.js';
import { parseRfc2822 } from './mime.js';
import { sanitizeHtml, redactSecrets } from './sanitizer.js';
import type {
  CrmMailActivity,
  MailboxAccountConfig,
  MailboxSyncCursor,
  MailMessageRecord
} from './types.js';

export interface SyncFolderOptions {
  accountId: string;
  folder: string;
  client: ImapClient;
  store: Store;
  events: Events;
  crmActivitySink?: (activity: CrmMailActivity) => void | Promise<void>;
  maxFetchBatch?: number;
}

export interface SyncFolderResult {
  folder: string;
  uidValidity: number;
  newMessagesCount: number;
  lastUid: number;
  resetCursor: boolean;
  hasMore:boolean;
}

/**
 * Executes a durable, restart-safe IMAP synchronization for a single folder:
 * - Tracks UIDVALIDITY to detect mailbox mailbox recreate/resets without duplicating or dropping.
 * - Saves high-watermark lastUid in durable cursors.
 * - Deduplicates messages via normalized Message-ID and folder/UID.
 * - Parses MIME and extracts clean text & sanitized HTML (remote images blocked).
 * - Emits crmActivitySink events for inbound mail.
 */
export async function syncFolder(options: SyncFolderOptions): Promise<SyncFolderResult> {
  const { accountId, folder, client, store, events, crmActivitySink, maxFetchBatch = 50 } = options;
  const cursorId = `${accountId}:${folder}`;

  // 1. Inspect existing cursor
  const existingCursor = store.get('mailbox-cursors', cursorId) as MailboxSyncCursor | undefined;

  // 2. Select folder via IMAP
  const status = await client.selectFolder(folder);
  let startUid = 1;
  let resetCursor = false;

  if (existingCursor) {
    if (existingCursor.uidValidity !== status.uidValidity) {
      // UIDVALIDITY changed on server (e.g., server rebuild or migration)
      // Must reset cursor and start from 1, but do NOT delete already stored messages (deduplicated by messageId)
      resetCursor = true;
      startUid = 1;
    } else {
      startUid = existingCursor.lastUid + 1;
    }
  }

  // If mailbox has no messages or already up to date
  if (status.exists === 0 || startUid >= status.uidNext) {
    const updatedCursor: MailboxSyncCursor = {
      id: cursorId,
      accountId,
      folder,
      uidValidity: status.uidValidity,
      lastUid: Math.max(status.uidNext - 1, resetCursor?0:(existingCursor?.lastUid || 0)),
      syncedAt: new Date().toISOString()
    };
    store.put('mailbox-cursors', updatedCursor);
    return {
      folder,
      uidValidity: status.uidValidity,
      newMessagesCount: 0,
      lastUid: updatedCursor.lastUid,
      resetCursor,
      hasMore:false
    };
  }

  // 3. Fetch new messages bounded by batch
  const available=client.findUids?await client.findUids(startUid,maxFetchBatch):undefined;
  const endUid=available?(available.at(-1)??status.uidNext-1):Math.min(status.uidNext-1,startUid+maxFetchBatch-1);
  const fetchItems = available?.length===0?[]:await client.fetchRange(startUid, endUid);
  let newMessagesCount = 0;
  let maxObservedUid = resetCursor?0:(existingCursor?.lastUid || 0);

  for (const item of fetchItems) {
    if (!item.uid || item.uid < startUid || item.uid>endUid) continue;
    if (item.uid > maxObservedUid) {
      maxObservedUid = item.uid;
    }

    if (!item.raw) continue;

    const parsed = parseRfc2822(item.raw);
    const normalizedMsgId = parsed.messageId.trim().toLowerCase();

    // Check deduplication in store
    const existingMsg = store.list('mailbox-messages').find((m: any) =>
      m.accountId === accountId &&
      (m.messageId.trim().toLowerCase() === normalizedMsgId || (m.folder === folder && m.uid === item.uid && m.uidValidity===status.uidValidity))
    );

    if (existingMsg) {
      // Message already present; update flags/uid if needed
      continue;
    }

    const { sanitizedHtml, hasRemoteImages } = parsed.htmlBody
      ? sanitizeHtml(parsed.htmlBody)
      : { sanitizedHtml: undefined, hasRemoteImages: false };

    // Thread calculation
    const threadId = parsed.references[0] || parsed.inReplyTo || parsed.messageId;

    const msgRecord: MailMessageRecord = {
      id: 'mailmsg-' + randomUUID(),
      accountId,
      folder,
      uid: item.uid,
      uidValidity:status.uidValidity,
      sourceTruncated:!!item.sourceTruncated,
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      threadId,
      direction: folder.toLowerCase().includes('sent') ? 'OUTBOUND' : 'INBOUND',
      from: parsed.from,
      to: parsed.to,
      cc: parsed.cc,
      bcc: parsed.bcc,
      replyTo: parsed.replyTo,
      subject: parsed.subject,
      snippet: (parsed.textBody || '').slice(0, 160).replace(/\s+/g, ' '),
      textBody: parsed.textBody,
      sanitizedHtmlBody: sanitizedHtml,
      hasHtml: !!sanitizedHtml,
      hasRemoteImages,
      attachments: (item.sourceTruncated?[]:parsed.attachments).map(a => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        byteSize: a.byteSize,
        contentId: a.contentId,
        sha256: a.sha256
      })),
      status: 'DELIVERED',
      isRead: item.flags.includes('\\Seen'),
      isStarred: item.flags.includes('\\Flagged'),
      date: parsed.date,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    store.put('mailbox-messages', msgRecord);
    newMessagesCount++;

    // Emit CRM activity if sink available and message is inbound
    if (crmActivitySink && msgRecord.direction === 'INBOUND') {
      try {
        crmActivitySink({
          id: 'crmact-' + randomUUID(),
          kind: 'EMAIL_INBOUND',
          actor: msgRecord.from.address,
          occurredAt: msgRecord.date,
          sourceEventId: msgRecord.id,
          visibility: 'INTERNAL',
          redactedSummary: redactSecrets(
            `Inbound email from ${msgRecord.from.address}: ${msgRecord.subject} — ${msgRecord.snippet}`
          ),
          version: 1
        });
      } catch (err) {
        console.error('[mailbox-sync] CRM sink error:', err);
      }
    }
  }

  // 4. Update durable cursor
  const cursor: MailboxSyncCursor = {
    id: cursorId,
    accountId,
    folder,
    uidValidity: status.uidValidity,
    lastUid: Math.max(maxObservedUid,endUid),
    syncedAt: new Date().toISOString()
  };
  store.put('mailbox-cursors', cursor);
  events.publish('mailbox');

  return {
    folder,
    uidValidity: status.uidValidity,
    newMessagesCount,
    lastUid: cursor.lastUid,
    resetCursor,
    hasMore:cursor.lastUid<status.uidNext-1
  };
}
