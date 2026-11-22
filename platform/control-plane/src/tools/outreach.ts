import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';
import type { MailMessageRecord } from '../../../server/src/mailbox/types.js';
import { reserveOutreach, finishOutreach, getOutreachLimits, OutreachGuardError } from '../outreach-guard.js';

export function registerOutreachTools(ctx: ToolContext) {
  const { server, principal, mailboxServices, auditCall, store } = ctx;

  const isAdmin = principal.role === 'admin';
  const hasRead = hasScope(principal, 'read');
  const hasWrite = hasScope(principal, 'write');
  function threadHeaders(messageId?: string) {
    if(!messageId)return {};
    const original=mailboxServices?.getMessage(messageId) || store?.list('mailbox-messages').find(message=>message.messageId===messageId);
    if(!original)throw new Error('Original mailbox message not found; use inbox_search to obtain its message ID');
    return {inReplyTo:original.messageId,references:[...(original.references || []),original.messageId].slice(-25),threadId:original.threadId};
  }

  // Inspect budgets without reserving or sending anything.
  server.tool(
    'outreach_get_limits',
    'Read configured and effective recipient budgets, usage, remaining capacity and reset times, including unlimited mode when configured. Internal unlimited mode does not remove actual provider ceilings. Does not reserve capacity or send email.',
    {
      to: z.array(z.string().trim().email()).max(1000).optional().describe('Optional recipients whose domain budgets should be included.'),
      domains: z.array(z.string().trim().min(1).max(253)).max(100).optional().describe('Optional recipient domains to inspect.'),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasRead) {
        auditCall('outreach_get_limits', undefined, start, 'DENIED', args, undefined, 'Insufficient read scope');
        return errorResponse('Access denied: requires admin read scope', 'UNAUTHORIZED');
      }
      if (!store) return errorResponse('Durable outreach storage is unavailable', 'SERVICE_UNAVAILABLE');
      try {
        const result = getOutreachLimits(store, { recipients: args.to, domains: args.domains });
        auditCall('outreach_get_limits', undefined, start, 'SUCCESS', args, { inspected: true });
        return jsonResponse(result);
      } catch (err: any) {
        auditCall('outreach_get_limits', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Read outreach limits failed: ${err.message}`);
      }
    }
  );

  // 1. outreach_create_draft (Preserved identical contract)
  server.tool(
    'outreach_create_draft',
    'Create an email draft in Starli Mailbox (safe draft creation; sending requires human approval)',
    {
      to: z.array(z.string().trim().email()).min(1).max(1000).describe('Recipient email addresses; normalized unique recipients count toward budgets'),
      subject: z.string().min(1).describe('Email subject'),
      bodyText: z.string().min(1).describe('Plain text email content'),
      inReplyToMessageId: z.string().optional().describe('Message ID being replied to'),
      companyId: z.string().optional(),
      opportunityId: z.string().optional(),
      projectId: z.string().optional(),
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('outreach_create_draft', undefined, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires admin write scope', 'UNAUTHORIZED');
      }
      if (!mailboxServices) return errorResponse('Mailbox services not initialized');

      try {
        const toRecipients = [...new Set(args.to.map(email => email.trim().toLowerCase()))].sort().map(address => ({ address }));
        const draft = mailboxServices.createDraft({
          subject: args.subject,
          textBody: args.bodyText,
          to: toRecipients,
          ...threadHeaders(args.inReplyToMessageId),
          companyId: args.companyId,
          opportunityId: args.opportunityId,
          projectId: args.projectId,
        });

        auditCall('outreach_create_draft', draft.id, start, 'SUCCESS', args, { draftId: draft.id });
        return jsonResponse({
          status: 'DRAFT_CREATED',
          draftId: draft.id,
          subject: draft.subject,
          to: draft.to,
          note: 'Draft saved. External sending requires explicit human approval through admin console.',
        });
      } catch (err: any) {
        auditCall('outreach_create_draft', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Create draft failed: ${err.message}`);
      }
    }
  );

  // 2. outreach_send_email (Direct send tool)
  server.tool(
    'outreach_send_email',
    'Send an email explicitly requested by the operator through Starli Mailbox. External action: honor suppression, duplicate detection and rate limits. Reuse idempotencyKey on retries. SMTP acceptance does not prove delivery; inspect unconfirmed sends before retrying.',
    {
      to: z.array(z.string().trim().email()).min(1).max(1000).describe('Recipient email addresses; normalized unique recipients count toward budgets'),
      subject: z.string().min(1).describe('Email subject'),
      bodyText: z.string().min(1).describe('Plain text email content'),
      inReplyToMessageId: z.string().optional().describe('Message ID being replied to'),
      companyId: z.string().optional(),
      opportunityId: z.string().optional(),
      projectId: z.string().optional(),
      idempotencyKey: z.string().min(1).max(200).optional().describe('Stable request ID reused for retries; changing content under the same key fails.'),
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasWrite) {
        auditCall('outreach_send_email', undefined, start, 'DENIED', args, undefined, 'Insufficient write scope');
        return errorResponse('Access denied: requires admin write scope', 'UNAUTHORIZED');
      }
      if (!mailboxServices) return errorResponse('Mailbox services not initialized');

      let reservation: ReturnType<typeof reserveOutreach> | undefined;
      let transportStarted = false;
      try {
        if(!store)return errorResponse('Durable outreach storage is unavailable','SERVICE_UNAVAILABLE');
        const normalizedArgs = { ...args, to: [...new Set(args.to.map(email => email.trim().toLowerCase()))].sort() };
        reservation=reserveOutreach(store,principal.id,normalizedArgs);
        if(reservation.cached)return jsonResponse(reservation.record.result);
        const toRecipients = [...new Set(args.to.map(email => email.trim().toLowerCase()))].sort().map(address => ({ address }));
        const draft = mailboxServices.createDraft({
          subject: args.subject,
          textBody: args.bodyText,
          to: toRecipients,
          ...threadHeaders(args.inReplyToMessageId),
          companyId: args.companyId,
          opportunityId: args.opportunityId,
          projectId: args.projectId,
        });

        const actor = principal.email || 'admin@starlidigital.ro';
        mailboxServices.approveDraft(draft.id, actor);
        transportStarted = true;
        const sent = await mailboxServices.sendApprovedDraft({
          draftId: draft.id,
          actor,
        });

        auditCall('outreach_send_email', draft.id, start, 'SUCCESS', args, { messageId: sent.id });
        const result = {
          status: 'SENT',
          transportStatus: 'SMTP_ACCEPTED',
          deliveryConfirmed: false,
          messageId: sent.id,
          subject: sent.subject,
          to: sent.to,
          note: 'The SMTP transport accepted this message. Recipient delivery is not confirmed.',
        };
        finishOutreach(store,reservation.record,result);
        return jsonResponse(result);
      } catch (err: any) {
        if(store&&reservation&&!reservation.cached)finishOutreach(store,reservation.record,undefined,{definitelyNotSent:!transportStarted});
        auditCall('outreach_send_email', undefined, start, 'FAILED', args, undefined, err.message);
        if (err instanceof OutreachGuardError) {
          return { ...jsonResponse({ error: { code: err.code, message: err.message, ...err.details } }), isError: true };
        }
        return errorResponse(`Send email failed: ${err.message}`);
      }
    }
  );

  // 3. outreach_get_thread (Preserved identical contract)
  server.tool(
    'outreach_get_thread',
    'Get email thread messages and sanitized content by thread ID or message ID. (Read-Only)',
    {
      threadId: z.string().describe('Email thread identifier'),
    },
    async (args) => {
      const start = Date.now();
      if (!isAdmin || !hasRead) {
        auditCall('outreach_get_thread', args.threadId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires admin read scope', 'UNAUTHORIZED');
      }
      if (!mailboxServices) return errorResponse('Mailbox services not initialized');

      try {
        const result = mailboxServices.listMessages({
          threadId: args.threadId,
          limit: 50,
        });
        const sanitized = result.messages.map((m: MailMessageRecord) => ({
          id: m.id,
          direction: m.direction,
          from: m.from,
          to: m.to,
          subject: m.subject,
          date: m.date,
          snippet: m.snippet,
          textBody: m.textBody,
          hasAttachments: (m.attachments?.length ?? 0) > 0,
        }));

        auditCall('outreach_get_thread', args.threadId, start, 'SUCCESS', args, { count: sanitized.length });
        return jsonResponse(sanitized);
      } catch (err: any) {
        auditCall('outreach_get_thread', args.threadId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`Failed to get thread: ${err.message}`);
      }
    }
  );
}
