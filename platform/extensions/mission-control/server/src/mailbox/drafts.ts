import { createHash } from 'node:crypto';
import type { MailAddress, MailAttachmentMeta, MailDraftRecord } from './types.js';

export interface ComputeApprovalHashArgs {
  draftId: string;
  revision: number;
  fromAccount: string;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachments: MailAttachmentMeta[];
}

/**
 * Computes a deterministic canonical digest of the draft state.
 * Any modification to the recipients, subject, body, or attachments
 * alters this digest, immediately invalidating any prior human approval.
 */
export function computeDraftApprovalHash(args: ComputeApprovalHashArgs): string {
  const normAddress = (addrs: MailAddress[]) =>
    addrs
      .map(a => `${(a.name || '').trim().toLowerCase()}<${a.address.trim().toLowerCase()}>`)
      .sort()
      .join(';');

  const normAttachments = (atts: MailAttachmentMeta[]) =>
    atts
      .map(a => `${a.filename}:${a.mimeType}:${a.byteSize}:${a.sha256 || ''}`)
      .sort()
      .join(';');

  const canonicalPayload = [
    `id=${args.draftId}`,
    `rev=${args.revision}`,
    `from=${args.fromAccount.trim().toLowerCase()}`,
    `to=${normAddress(args.to)}`,
    `cc=${normAddress(args.cc)}`,
    `bcc=${normAddress(args.bcc)}`,
    `subj=${args.subject.trim()}`,
    `text=${args.textBody.trim()}`,
    `html=${(args.htmlBody || '').trim()}`,
    `atts=${normAttachments(args.attachments)}`
  ].join('\n');

  return createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
}

export interface ValidateApprovalResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates human approval for sending a draft:
 * 1. Checks that an approval exists and was granted by an authenticated principal.
 * 2. Checks that the approval has not expired (typically 1 hour).
 * 3. Checks that the draft has not been edited or tampered with since approval (hash verification).
 */
export function validateDraftApproval(
  draft: MailDraftRecord,
  clock: () => number = Date.now
): ValidateApprovalResult {
  if (!draft.approvedBy || !draft.approvedAt || !draft.approvalHash) {
    return { valid: false, reason: 'Draft has not received explicit human approval' };
  }

  if (draft.approvalExpiresAt && draft.approvalExpiresAt <= clock()) {
    return { valid: false, reason: 'Human approval for this draft has expired' };
  }

  const expectedHash = computeDraftApprovalHash({
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

  if (draft.approvalHash !== expectedHash) {
    return { valid: false, reason: 'Draft was modified after approval was granted; approval invalidated' };
  }

  return { valid: true };
}
