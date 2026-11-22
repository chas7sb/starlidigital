import {requireAdmin} from '../security.js';
import type { MailboxServices } from './service.js';

export function createMailboxGraphQL({ services }: { services: MailboxServices }) {
  const typeDefs = `
    type MailAddress {
      address: String!
      name: String
    }

    input MailAddressInput {
      address: String!
      name: String
    }

    type MailAttachmentMeta {
      id: String!
      filename: String!
      mimeType: String!
      byteSize: Int!
      contentId: String
      sha256: String
    }

    input MailAttachmentMetaInput {
      id: String!
      filename: String!
      mimeType: String!
      byteSize: Int!
      contentId: String
      sha256: String
    }

    type MailMessageRecord {
      id: String!
      accountId: String!
      folder: String!
      uid: Int
      messageId: String!
      inReplyTo: String
      references: [String!]!
      threadId: String!
      direction: String!
      from: MailAddress!
      to: [MailAddress!]!
      cc: [MailAddress!]!
      bcc: [MailAddress!]
      replyTo: MailAddress
      subject: String!
      snippet: String!
      textBody: String
      sourceTruncated:Boolean
      sanitizedHtmlBody: String
      hasHtml: Boolean!
      hasRemoteImages: Boolean!
      attachments: [MailAttachmentMeta!]!
      status: String!
      isRead: Boolean!
      isStarred: Boolean!
      date: String!
      createdAt: String!
      updatedAt: String!
      prospectId: String
      companyId: String
      opportunityId: String
      projectId: String
    }

    type MailDraftRecord {
      id: String!
      revision: Int!
      fromAccount: String!
      to: [MailAddress!]!
      cc: [MailAddress!]!
      bcc: [MailAddress!]!
      subject: String!
      textBody: String!
      htmlBody: String
      inReplyTo: String
      references: [String!]!
      threadId: String
      attachments: [MailAttachmentMeta!]!
      prospectId: String
      companyId: String
      opportunityId: String
      projectId: String
      approvalHash: String
      approvalExpiresAt: Float
      approvedBy: String
      approvedAt: Float
      createdAt: String!
      updatedAt: String!
    }

    type MailMessagesResult {
      messages: [MailMessageRecord!]!
      total: Int!
    }

    type MailboxAccountInfo {
      imapConfigured:Boolean!
      id: String!
      email: String!
      displayName: String!
      imapHost: String
      imapPort: Int
      imapSecure: Boolean
      smtpHost: String
      smtpPort: Int
      smtpSecure: Boolean
    }

    type TransactionalEmailEvent {
      id: String!
      outboxId: String!
      providerId: String
      kind: String!
      eventType: String!
      recipientMasked: String!
      subject: String!
      error: String
      timestamp: String!
      relatedEntityId: String
    }

    type SyncMailboxResult {
      hasMore:Boolean
      folder: String!
      uidValidity: Int!
      newMessagesCount: Int!
      lastUid: Int!
      resetCursor: Boolean!
    }

    extend type Query {
      mailboxDrafts(limit:Int = 100):[MailDraftRecord!]!
      mailboxAccount: MailboxAccountInfo!
      mailboxMessages(
        folder: String
        threadId: String
        search: String
        direction: String
        prospectId: String
        limit: Int
        offset: Int
      ): MailMessagesResult!
      mailboxMessage(id: String!): MailMessageRecord
      mailboxThread(threadId: String!): [MailMessageRecord!]!
      mailboxTransactionalEvents(kind: String, outboxId: String, limit: Int): [TransactionalEmailEvent!]!
    }

    extend type Mutation {
      mailboxCreateDraft(
        to: [MailAddressInput!]!
        cc: [MailAddressInput!]
        bcc: [MailAddressInput!]
        subject: String!
        textBody: String!
        htmlBody: String
        inReplyTo: String
        threadId: String
        prospectId: String
        companyId: String
        opportunityId: String
        projectId: String
      ): MailDraftRecord!

      mailboxUpdateDraft(
        id: String!
        to: [MailAddressInput!]
        cc: [MailAddressInput!]
        bcc: [MailAddressInput!]
        subject: String
        textBody: String
        htmlBody: String
      ): MailDraftRecord!

      mailboxApproveDraft(
        id: String!
        ttlMs: Float
      ): MailDraftRecord!

      mailboxSendApprovedDraft(
        draftId: String!
        idempotencyKey: String
      ): MailMessageRecord!

      mailboxPrepareReply(
        originalMsgId: String!
        replyAll: Boolean
      ): MailDraftRecord!

      mailboxPrepareForward(
        originalMsgId: String!
      ): MailDraftRecord!

      mailboxMarkRead(
        id: String!
        isRead: Boolean!
      ): MailMessageRecord!

      mailboxSync(
        folder: String
      ): SyncMailboxResult!
    }
  `;

  const resolvers = {
    Query: {
      mailboxDrafts:(_:unknown,{limit}:{limit?:number},context:any)=>{requireAdmin(context);return services.listDrafts(limit);},
      mailboxAccount: (_: any, __: any, context: any) => {
        requireAdmin(context);
        return services.getAccount();
      },
      mailboxMessages: (_: any, args: any, context: any) => {
        requireAdmin(context);
        return services.listMessages(args);
      },
      mailboxMessage: (_: any, { id }: { id: string }, context: any) => {
        requireAdmin(context);
        return services.getMessage(id);
      },
      mailboxThread: (_: any, { threadId }: { threadId: string }, context: any) => {
        requireAdmin(context);
        return services.getThread(threadId);
      },
      mailboxTransactionalEvents: (_: any, args: any, context: any) => {
        requireAdmin(context);
        return services.listTransactionalEvents(args);
      }
    },
    Mutation: {
      mailboxCreateDraft: (_: any, args: any, context: any) => {
        requireAdmin(context);
        return services.createDraft(args);
      },
      mailboxUpdateDraft: (_: any, { id, ...updates }: any, context: any) => {
        requireAdmin(context);
        return services.updateDraft(id, updates);
      },
      mailboxApproveDraft: (_: any, { id, ttlMs }: any, context: any) => {
        const admin = requireAdmin(context);
        return services.approveDraft(id, admin.id, ttlMs);
      },
      mailboxSendApprovedDraft: (_: any, { draftId, idempotencyKey }: any, context: any) => {
        const admin = requireAdmin(context);
        return services.sendApprovedDraft({ draftId, actor: admin.id, idempotencyKey });
      },
      mailboxPrepareReply: (_: any, { originalMsgId, replyAll }: any, context: any) => {
        requireAdmin(context);
        return services.prepareReply(originalMsgId, !!replyAll);
      },
      mailboxPrepareForward: (_: any, { originalMsgId }: any, context: any) => {
        requireAdmin(context);
        return services.prepareForward(originalMsgId);
      },
      mailboxMarkRead: (_: any, { id, isRead }: any, context: any) => {
        requireAdmin(context);
        return services.markMessageRead(id, isRead);
      },
      mailboxSync: (_: any, { folder }: any, context: any) => {
        requireAdmin(context);
        return services.syncMailbox(folder || 'INBOX');
      }
    }
  };

  return { typeDefs, resolvers };
}

