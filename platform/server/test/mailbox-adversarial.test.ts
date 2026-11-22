import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, redactSecrets } from '../src/mailbox/sanitizer.js';
import { parseRfc2822, parseAddressList, sanitizeHeaderValue } from '../src/mailbox/mime.js';

test('adversarial XSS: HTML entity-encoded javascript: and nested SVG vectors neutralized', () => {
  // Entity-encoded javascript: e.g. &#x6A;avascript:...
  const entityDirty = '<a href="&#x6A;avascript:alert(1)">Click me</a>';
  const res1 = sanitizeHtml(entityDirty);
  assert.equal(res1.sanitizedHtml.includes('javascript:'), false);
  assert.equal(res1.sanitizedHtml.includes('#blocked-unsafe-url'), true);

  // Decimal entity encoded
  const decDirty = '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">Click</a>';
  const res2 = sanitizeHtml(decDirty);
  assert.equal(res2.sanitizedHtml.includes('javascript:'), false);
  assert.equal(res2.sanitizedHtml.includes('#blocked-unsafe-url'), true);

  // Nested scripts inside malformed tags
  const nestedScript = '<<SCRIPT>alert("XSS");//<</SCRIPT>';
  const res3 = sanitizeHtml(nestedScript);
  assert.equal(res3.sanitizedHtml.toLowerCase().includes('script'), false);
  assert.equal(res3.sanitizedHtml.includes('alert'), false);
});

test('adversarial MIME: Header CRLF injection rejected', () => {
  const injectedSubject = 'Normal Subject\r\nBcc: victim@example.com\r\nX-Injected: malicious';
  const sanitized = sanitizeHeaderValue(injectedSubject);

  assert.equal(sanitized.includes('\r'), false);
  assert.equal(sanitized.includes('\n'), false);
  assert.equal(sanitized, 'Normal Subject Bcc: victim@example.com X-Injected: malicious');

  const rawMimeWithInjection = [
    'From: attacker@evil.com',
    'To: alex@starlidigital.ro',
    'Subject: Malicious\r\n Bcc: hidden@evil.com',
    'Message-ID: <attack-1@evil.com>',
    '',
    'Body text'
  ].join('\r\n');

  const parsed = parseRfc2822(rawMimeWithInjection);
  // Header line unfolding should fold without splitting into a separate header
  assert.equal(parsed.subject.includes('\n'), false);
  assert.equal(parsed.subject.includes('\r'), false);
});

test('adversarial MIME: Attachment path traversal and bounds protection', () => {
  const traversalMime = [
    'From: attacker@evil.com',
    'To: alex@starlidigital.ro',
    'Subject: Payload',
    'Content-Type: multipart/mixed; boundary="bound"',
    '',
    '--bound',
    'Content-Type: text/plain',
    '',
    'Here is file',
    '--bound',
    'Content-Type: application/octet-stream',
    'Content-Disposition: attachment; filename="../../../etc/passwd"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('root:x:0:0:...').toString('base64'),
    '--bound--'
  ].join('\r\n');

  const parsed = parseRfc2822(traversalMime);
  assert.equal(parsed.attachments.length, 1);
  const att = parsed.attachments[0];
  // Filename must not contain path traversal ../ and is safely base-named
  assert.equal(att.filename.includes('/'), false);
  assert.equal(att.filename.includes('\\'), false);
  assert.equal(att.filename.includes('..'), false);
  assert.equal(att.filename, 'passwd');
});

test('adversarial Privacy: Zero leakage of auth reset tokens, OTPs, or bearer secrets', () => {
  const rawLeak = [
    'Your Starli account password has been requested.',
    'Reset link: https://starlidigital.ro/reset-password?token=9f8e7d6c5b4a3120&expire=30m',
    'SMS backup code: 543210',
    'Bearer token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
  ].join('\n');

  const sanitized = redactSecrets(rawLeak);

  assert.equal(sanitized.includes('9f8e7d6c5b4a3120'), false);
  assert.equal(sanitized.includes('[REDACTED_TOKEN]'), true);
  assert.equal(sanitized.includes('543210'), false);
  assert.equal(sanitized.includes('[REDACTED_OTP]'), true);
  assert.equal(sanitized.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), false);
  assert.equal(sanitized.includes('[REDACTED_JWT]'), true);
});
