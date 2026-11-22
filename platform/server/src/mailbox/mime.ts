import { createHash, randomUUID } from 'node:crypto';
import type { MailAddress, MailAttachmentMeta } from './types.js';

export interface ParsedMimeMessage {
  messageId: string;
  inReplyTo?: string;
  references: string[];
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc?: MailAddress[];
  replyTo?: MailAddress;
  subject: string;
  date: string;
  textBody?: string;
  htmlBody?: string;
  attachments: Array<MailAttachmentMeta & { content?: Buffer }>;
}

export function parseAddressList(headerValue?: string): MailAddress[] {
  if (!headerValue || typeof headerValue !== 'string') return [];
  const results: MailAddress[] = [];
  // Split on commas not inside quotes
  const parts = headerValue.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = /(?:"?([^"]*)"?\s*)?<([^>]+)>/i.exec(trimmed);
    if (match) {
      const name = (match[1] || '').trim();
      const address = match[2].trim().toLowerCase();
      results.push({ address, ...(name ? { name } : {}) });
    } else {
      const plain = trimmed.replace(/[<>]/g, '').trim().toLowerCase();
      if (plain.includes('@')) {
        results.push({ address: plain });
      }
    }
  }
  return results;
}

export function parseSingleAddress(headerValue?: string): MailAddress {
  const list = parseAddressList(headerValue);
  return list[0] || { address: 'unknown@starlidigital.ro' };
}

export function extractMessageIds(headerValue?: string): string[] {
  if (!headerValue) return [];
  const matches = headerValue.match(/<[^>]+>/g);
  if (!matches) {
    const trimmed = headerValue.trim();
    return trimmed ? [trimmed] : [];
  }
  return matches.map(m => m.slice(1, -1).trim());
}

export function decodeMimeWord(word: string): string {
  // Handle RFC 2047 =?charset?encoding?encoded_text?=
  const regex = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;
  return word.replace(regex, (_, charset, encoding, text) => {
    try {
      const enc = encoding.toUpperCase();
      if (enc === 'B') {
        const buf = Buffer.from(text, 'base64');
        return buf.toString(charset.toLowerCase().includes('utf') ? 'utf8' : 'latin1');
      } else if (enc === 'Q') {
        const hexDecoded = text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__: string, hex: string) =>
          String.fromCharCode(parseInt(hex, 16))
        );
        return Buffer.from(hexDecoded, 'binary').toString('utf8');
      }
    } catch {
      return text;
    }
    return text;
  });
}

export function sanitizeHeaderValue(value: string): string {
  // Reject CRLF injection in email headers
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function parseHeaders(rawHeaders: string): Map<string, string> {
  const headers = new Map<string, string>();
  // Unfold headers (RFC 2822 line folding)
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const val = sanitizeHeaderValue(decodeMimeWord(line.slice(idx + 1).trim()));
      headers.set(key, val);
    }
  }
  return headers;
}

/**
 * Lightweight, robust MIME email parser that handles multipart/alternative,
 * multipart/mixed, base64 and quoted-printable transfer encodings without external native modules.
 */
export function parseRfc2822(rawEmail: string | Buffer): ParsedMimeMessage {
  const rawStr = typeof rawEmail === 'string' ? rawEmail : rawEmail.toString('utf8');
  const splitIdx = rawStr.indexOf('\r\n\r\n');
  const splitIdxAlt = splitIdx === -1 ? rawStr.indexOf('\n\n') : splitIdx;

  let headerPart = '';
  let bodyPart = '';
  if (splitIdxAlt !== -1) {
    headerPart = rawStr.slice(0, splitIdxAlt);
    const separatorLen = rawStr.startsWith('\r\n\r\n', splitIdxAlt) ? 4 : 2;
    bodyPart = rawStr.slice(splitIdxAlt + separatorLen);
  } else {
    headerPart = rawStr;
  }

  const headers = parseHeaders(headerPart);
  const rawMsgId = headers.get('message-id') || `<msg-${randomUUID()}@starlidigital.ro>`;
  const messageId = extractMessageIds(rawMsgId)[0] || rawMsgId.replace(/[<>]/g, '');

  const from = parseSingleAddress(headers.get('from'));
  const to = parseAddressList(headers.get('to'));
  const cc = parseAddressList(headers.get('cc'));
  const bcc = parseAddressList(headers.get('bcc'));
  const replyTo = headers.has('reply-to') ? parseSingleAddress(headers.get('reply-to')) : undefined;
  const subject = headers.get('subject') || '(Fără subiect)';
  const dateStr = headers.get('date');
  let date = new Date().toISOString();
  if (dateStr) {
    const parsed = Date.parse(dateStr);
    if (!isNaN(parsed)) date = new Date(parsed).toISOString();
  }

  const inReplyTo = headers.has('in-reply-to') ? extractMessageIds(headers.get('in-reply-to'))[0] : undefined;
  const references = extractMessageIds(headers.get('references'));

  const contentType = headers.get('content-type') || 'text/plain';
  const transferEncoding = headers.get('content-transfer-encoding') || '7bit';

  let textBody: string | undefined;
  let htmlBody: string | undefined;
  const attachments: Array<MailAttachmentMeta & { content?: Buffer }> = [];

  const boundaryMatch = /boundary="?([^";\s]+)"?/i.exec(contentType);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = bodyPart.split(new RegExp(`--${boundary}(?:--)?`));
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '--') continue;
      const partParsed = parseRfc2822(trimmed);
      if (partParsed.textBody && !textBody) textBody = partParsed.textBody;
      if (partParsed.htmlBody && !htmlBody) htmlBody = partParsed.htmlBody;
      for (const att of partParsed.attachments) {
        attachments.push(att);
      }
    }
  } else {
    // Single part
    let decoded = bodyPart;
    const enc = transferEncoding.toLowerCase().trim();
    if (enc === 'base64') {
      try {
        decoded = Buffer.from(bodyPart.replace(/\s+/g, ''), 'base64').toString('utf8');
      } catch {}
    } else if (enc === 'quoted-printable') {
      decoded = bodyPart.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
    }

    const contentDisposition = headers.get('content-disposition') || '';
    const isAttachment = /attachment/i.test(contentDisposition);
    const filenameMatch = /(?:filename|name)="?([^";\s]+)"?/i.exec(contentDisposition || contentType);

    if (isAttachment || filenameMatch) {
      const rawFilename = filenameMatch ? decodeMimeWord(filenameMatch[1]) : 'attachment.bin';
      // Strip directory traversal characters
      const filename = rawFilename.replace(/^.*[\\\/]/, '').replace(/[^a-zA-Z0-9_.-]/g, '_') || 'attachment.bin';
      const buf = enc === 'base64' ? Buffer.from(bodyPart.replace(/\s+/g, ''), 'base64') : Buffer.from(decoded, 'utf8');
      
      // Bounded attachment size check (25 MiB standard email ceiling)
      if (buf.length <= 25 * 1024 * 1024) {
        attachments.push({
          id: 'att-' + randomUUID(),
          filename,
          mimeType: contentType.split(';')[0].trim().toLowerCase(),
          byteSize: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'),
          content: buf
        });
      }
    } else if (contentType.toLowerCase().includes('text/html')) {
      htmlBody = decoded;
    } else {
      textBody = decoded;
    }
  }

  return {
    messageId,
    inReplyTo,
    references,
    from,
    to,
    cc,
    bcc: bcc.length > 0 ? bcc : undefined,
    replyTo,
    subject,
    date,
    textBody: textBody?.trim(),
    htmlBody: htmlBody?.trim(),
    attachments
  };
}
